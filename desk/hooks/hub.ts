// The hub: every session's asks on one page, for the person's phone (hub/server.mjs).
//
// Each session feeds it: it writes feeds/<session>.json in the hub folder, ~/.claude/desk-hub,
// with what it reads from the desk's store, whether a turn runs, its served sites, and the
// hub's answers it has taken. The hub hands each answer from the page to one session in
// inbox.json (`by`): the asker while it reads the hub, else another, which leaves it in the store
// for the asker as the pane does. Any session that finds the hub down, or older than itself,
// starts it; it runs on its own on 127.0.0.1 and stops after half a day with no feed.
//
// Everything here but the functions taking `$` is pure, so it is tested alone.

import type { EngineInterface } from 'claude-code'

import type { Ask, Served } from '../types'
import type { Desk } from './asks'

export const HUB_PORT = 4791
/** Kept equal to VERSION in hub/server.mjs: a session replaces a hub older than itself. */
export const HUB_VERSION = '0.2.0'
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

/** The hub's process, as hub.json names it, if it is still the hub. */
async function hubPid($: EngineInterface, dir: string): Promise<number> {
  try {
    const v = JSON.parse(await $.fs.read(`${dir}/hub.json`)) as { pid?: unknown }
    const pid = typeof v.pid === 'number' ? v.pid : 0
    if (pid <= 0) return 0
    const ps = await $.process.run(['ps', '-p', String(pid), '-o', 'command='], { timeoutMs: 5000 })
    return ps.stdout.includes('server.mjs') ? pid : 0
  } catch {
    return 0
  }
}

/** Makes sure the hub runs, this version or newer; says how it stands, in a few words. */
export async function ensureHub($: EngineInterface, dir: string): Promise<string> {
  const url = `http://127.0.0.1:${HUB_PORT}/api/ping`
  const ping = await $.process.run(['curl', '-s', '--max-time', '1', url], { timeoutMs: 5000 })
  const running = pingVersion(ping.stdout)
  if (running !== undefined && !isNewer(HUB_VERSION, running)) return `running on :${HUB_PORT}`
  if (running !== undefined) {
    const pid = await hubPid($, dir)
    if (pid === 0) return `an older hub runs on :${HUB_PORT}, and this session cannot tell which process it is`
    await $.process.run(['kill', String(pid)], { timeoutMs: 5000 })
    await $.process.run(['/bin/sleep', '1'], { timeoutMs: 5000 })
  } else {
    const lsof = await $.process.run(['lsof', '-nP', `-iTCP:${HUB_PORT}`, '-sTCP:LISTEN'], { timeoutMs: 5000 })
    if (lsof.stdout.trim() !== '') return `:${HUB_PORT} is taken by another program`
  }
  const node = await findNode($)
  if (node === '') return 'not running: no node found to run it'
  const server = `${$.plugin.root}/hub/server.mjs`
  // detached, its output to a file, so this call returns while the hub runs on
  await $.process.run(
    ['/bin/sh', '-c', 'mkdir -p "$3" || exit 1; nohup "$1" "$2" --dir "$3" >> "$3/hub.log" 2>&1 < /dev/null &', 'sh', node, server, dir],
    { timeoutMs: 10_000 },
  )
  await $.process.run(['/bin/sleep', '1'], { timeoutMs: 5000 })
  const again = await $.process.run(['curl', '-s', '--max-time', '1', url], { timeoutMs: 5000 })
  return pingVersion(again.stdout) !== undefined ? `started on :${HUB_PORT}` : `did not start; see ${dir}/hub.log`
}
