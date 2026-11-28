// The hub: every session's asks on one page, for the person's phone (hub/server.mjs).
//
// Each session feeds it: it writes feeds/<session>.json in the hub folder, ~/.claude/desk-hub,
// with what it reads from the desk's store and that store's name, whether a turn runs, its served
// sites, and the hub's answers it has taken. The hub hands each answer from the page to one session in
// inbox.json (`by`): the asker while it reads the hub, else another, which leaves it in the store
// for the asker as the pane does. Any session that finds the hub down, or older than itself,
// starts it; it runs on its own on 127.0.0.1 and stops after half a day with no feed.
//
// A session never sends the hub's key anywhere. It asks whatever listens on the port to prove
// it holds the key (`provenPing`), and takes it for the hub only when the proof is right; a hub
// too old to prove is known by its process, as hub.json names it, listening on the port.
//
// Everything here but the functions taking `$` is pure, so it is tested alone.

import type { EngineInterface } from 'claude-code'

import type { Ask, Served } from '../types'
import type { Desk } from './asks'

export const HUB_PORT = 4791
/** Kept equal to VERSION in hub/server.mjs: a session replaces a hub older than itself. */
export const HUB_VERSION = '0.2.3'
/** A feed is written when it changes, and at least this often, so the hub knows the session is open. */
export const FEED_MS = 10_000
/** How often a session checks that the hub runs. */
export const ENSURE_MS = 30_000
/** Closed asks ride in the feed this long, so the page can say where an answer got to. */
export const FEED_RECENT_MS = 30 * 60_000

export type Site = { port: number; url: string }

export type Feed = {
  v: 1
  sid: string
  version: string
  /** The name of the store this session reads (asks.ts, STORE); empty when it has none. */
  store: string
  cwd: string
  /** A turn of this session runs now. */
  running: boolean
  /** When its last turn ended; 0 when unknown. */
  idleSince: number
  asks: Ask[]
  /** Replies waiting in the store for their askers, by ask id. */
  pending: Record<string, string>
  /** The marks of open sessions, as this one reads them. */
  live: Record<string, number>
  sites: Site[]
  /** The hub's answers this session has taken. */
  taken: string[]
}

/** An answer from the page, as the hub hands it out. */
export type InboxEntry = {
  rid: string
  askId: string
  sid: string
  words: string
  done: boolean
  at: number
  /** The session that takes it; empty while none reads the hub. */
  by: string
  takenAt: number
}

export type Me = { sid: string; cwd: string; running: boolean; idleSince: number; taken: readonly string[] }

/** What this session tells the hub, all but the time it is written. */
export function feedOf(all: Desk, me: Me, sites: readonly Site[], now: number): Feed {
  const asks = all.asks.filter(a => a.state === 'open' || now - a.closedAt < FEED_RECENT_MS)
  return {
    v: 1,
    sid: me.sid,
    version: HUB_VERSION,
    store: all.store,
    cwd: me.cwd,
    running: me.running,
    idleSince: me.idleSince,
    asks,
    pending: Object.fromEntries([...all.replies].map(([id, r]) => [id, r.text] as const)),
    live: Object.fromEntries(all.live),
    sites: [...sites],
    taken: [...me.taken],
  }
}

/** The tailnet links this session made, as the page lists them under it; the hub's own left out. */
export function sitesOf(served: readonly Served[], sid: string): Site[] {
  return served.filter(v => v.by === sid && v.localPort !== HUB_PORT).map(v => ({ port: v.localPort, url: v.url }))
}

const isEntry = (v: unknown): v is InboxEntry => {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return typeof e.rid === 'string' && typeof e.askId === 'string' && typeof e.by === 'string' && typeof e.words === 'string'
}

/** The answers the hub handed this session that it has not taken yet, from inbox.json's text. */
export function forMe(text: string, sid: string, taken: ReadonlySet<string>): InboxEntry[] | undefined {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return undefined
  }
  const entries = (v as { entries?: unknown })?.entries
  if (!Array.isArray(entries)) return undefined
  return entries.filter(isEntry).filter(e => e.by === sid && !e.takenAt && !taken.has(e.rid))
}

/** Whether version a is newer than b: 0.10.0 after 0.9.1. */
export function isNewer(a: string, b: string): boolean {
  const x = a.split('.').map(n => Number(n) || 0)
  const y = b.split('.').map(n => Number(n) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** The hub's version from its ping, or undefined when what answered is not the hub. */
export function pingVersion(stdout: string): string | undefined {
  try {
    const v = JSON.parse(stdout) as { name?: unknown; version?: unknown }
    return v.name === 'desk-hub' && typeof v.version === 'string' ? v.version : undefined
  } catch {
    return undefined
  }
}

/** The hub's key as its file holds it (the first line), or empty when the text is not one. */
export function keyOf(text: string): string {
  const k = (text.split('\n')[0] ?? '').trim()
  return /^[0-9a-f]{64}$/.test(k) ? k : ''
}

/**
 * The tailnet port of the hub's address for this start, from the key file's second line, written
 * with the key in one step; 0 when the file holds none. Each start has its own, so the phone's link
 * for a new key is always at an address no earlier start answered on.
 */
export function phonePortOf(text: string): number {
  if (keyOf(text) === '') return 0
  const line = (text.split('\n')[1] ?? '').trim()
  const n = /^\d{1,5}$/.test(line) ? Number(line) : 0
  return n >= 1 && n <= 65535 && n !== HUB_PORT ? n : 0
}

/**
 * The hub's ping with proof: a fresh random nonce goes to `<base>/api/proof`, and the answer is
 * printed only when it carries sha256("desk-hub:<key>:<nonce>") worked out here from the key
 * file. The key is never sent, and never in any process's arguments (`printf` and `[` are the
 * shell's own); a listener that is not the hub gets a nonce it can do nothing with, and prints nothing.
 */
export function provenPing(base: string, keyFile: string, maxTimeS = 1): string[] {
  const script = [
    'b=$1 f=$2 t=$3',
    '{ IFS= read -r k; } 2>/dev/null < "$f" || exit 1',
    'case $k in *[!0-9a-f]*) exit 1 ;; esac',
    '[ ${#k} -eq 64 ] || exit 1',
    'n=$(od -An -N16 -tx1 /dev/urandom | tr -d " \\n")',
    '[ ${#n} -eq 32 ] || exit 1',
    'out=$(curl -s --noproxy "*" --max-time "$t" "$b/api/proof?n=$n") || exit 1',
    'want=$(printf "desk-hub:%s:%s" "$k" "$n" | shasum -a 256 | cut -c1-64)',
    '[ ${#want} -eq 64 ] || exit 1',
    'case $out in *"\\"proof\\":\\"$want\\""*) printf %s "$out" ;; *) exit 1 ;; esac',
  ].join('\n')
  return ['/bin/sh', '-c', script, 'sh', base, keyFile, String(maxTimeS)]
}

/** The last path a shell printed, of the lines it printed. */
export function lastPath(stdout: string): string {
  return (
    stdout
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('/'))
      .pop() ?? ''
  )
}

// ── with the engine ─────────────────────────────────────────────────────────────────────────

const NODE_FINDER = [
  'command -v node',
  '[ -n "$SHELL" ] && "$SHELL" -lc "command -v node" 2>/dev/null',
  'for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.local/node/bin/node"; do [ -x "$p" ] && echo "$p" && exit 0; done; exit 1',
].join(' || ')

/** The hub's folder, ~/.claude/desk-hub; empty when the home folder cannot be found. */
export async function hubFolder($: EngineInterface): Promise<string> {
  const r = await $.process.run(['/bin/sh', '-c', 'printf %s "$HOME"'], { timeoutMs: 5000 })
  const home = r.stdout.trim()
  return home.startsWith('/') ? `${home}/.claude/desk-hub` : ''
}

async function findNode($: EngineInterface): Promise<string> {
  const r = await $.process.run(['/bin/sh', '-c', NODE_FINDER], { timeoutMs: 15_000 })
  return lastPath(r.stdout)
}

type HubProcess = { pid: number; version: string; proves: boolean }

/** The hub's process, as hub.json names it, when it is still the hub and listens on the port. */
async function hubProcess($: EngineInterface, dir: string, port: number): Promise<HubProcess | undefined> {
  try {
    const v = JSON.parse(await $.fs.read(`${dir}/hub.json`)) as { pid?: unknown; version?: unknown; proves?: unknown }
    const pid = typeof v.pid === 'number' && Number.isInteger(v.pid) ? v.pid : 0
    if (pid <= 0) return undefined
    const ps = await $.process.run(['ps', '-p', String(pid), '-o', 'command='], { timeoutMs: 5000 })
    if (!ps.stdout.includes('server.mjs')) return undefined
    const lsof = await $.process.run(['lsof', '-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN'], { timeoutMs: 5000 })
    if (lsof.stdout.trim() === '') return undefined
    return { pid, version: typeof v.version === 'string' ? v.version : '0', proves: v.proves === true }
  } catch {
    return undefined
  }
}

/** Makes sure the hub runs, this version or newer; says how it stands, in a few words. */
export async function ensureHub($: EngineInterface, dir: string, port = HUB_PORT): Promise<string> {
  const base = `http://127.0.0.1:${port}`
  const proven = async () => pingVersion((await $.process.run(provenPing(base, `${dir}/secret`), { timeoutMs: 5000 })).stdout)
  const running = await proven()
  if (running !== undefined && !isNewer(HUB_VERSION, running)) return `running on :${port}`
  const hub = await hubProcess($, dir, port)
  if (running !== undefined && hub === undefined) return `an older hub runs on :${port}, and this session cannot tell which process it is`
  if (running === undefined && hub === undefined) {
    const lsof = await $.process.run(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { timeoutMs: 5000 })
    if (lsof.stdout.trim() !== '') return `:${port} is taken by another program`
  }
  // this version's hub that missed one proof is left alone; one too old to prove is replaced
  if (running === undefined && hub !== undefined && hub.proves && !isNewer(HUB_VERSION, hub.version)) {
    return `the hub on :${port} did not prove itself this time; checked again soon`
  }
  if (hub !== undefined) {
    await $.process.run(['kill', String(hub.pid)], { timeoutMs: 5000 })
    await $.process.run(['/bin/sleep', '1'], { timeoutMs: 5000 })
  }
  const node = await findNode($)
  if (node === '') return 'not running: no node found to run it'
  const server = `${$.plugin.root}/hub/server.mjs`
  // detached, its output to a file, so this call returns while the hub runs on
  await $.process.run(
    [
      '/bin/sh',
      '-c',
      'umask 077; mkdir -p "$3" || exit 1; nohup "$1" "$2" --dir "$3" --port "$4" >> "$3/hub.log" 2>&1 < /dev/null &',
      'sh',
      node,
      server,
      dir,
      String(port),
    ],
    { timeoutMs: 10_000 },
  )
  await $.process.run(['/bin/sleep', '1'], { timeoutMs: 5000 })
  return (await proven()) !== undefined ? `started on :${port}` : `did not start; see ${dir}/hub.log`
}
