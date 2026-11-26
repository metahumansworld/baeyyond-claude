// The desk's hub: every session's asks on one page, for the person's phone.
//
// It listens on 127.0.0.1 only. The phone reaches it through `tailscale serve` (the desk's
// `/phone 4791`), which tells it who is asking in the Tailscale-User-Login header and strips any
// copy a client sends. So the hub answers only requests that carry its owner's login: the user
// this Mac is signed in to Tailscale as. A tagged device, another person's, or a page on this Mac
// carries none, and gets nothing.
//
// The sessions start it (any one that finds it down) and feed it: each writes feeds/<sid>.json
// in the hub folder. An answer from the page goes into inbox.json, handed to the session that
// asked while it reads the hub, else to another that does, which leaves it in the desk's store
// for the asker. The hub writes inbox.json and hub.json alone, and reads the feeds.
//
//   node server.mjs [--port 4791] [--dir ~/.claude/desk-hub]

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canAnswer, cleanFeed, routeInbox, stateOf } from './state.mjs'

/** Kept equal to HUB_VERSION in hooks/hub.ts: a session replaces a hub older than itself. */
export const VERSION = '0.2.0'

const HERE = dirname(fileURLToPath(import.meta.url))
const TAILSCALE = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const STEP_MS = 2000
/** With no session feeding it this long, the hub stops; the next session starts it again. */
const IDLE_STOP_MS = 12 * 3600_000

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? dflt : argv[i + 1]
}
const PORT = Number(arg('port', '4791'))
const DIR = arg('dir', join(homedir(), '.claude', 'desk-hub'))
const FEEDS = join(DIR, 'feeds')
const INBOX = join(DIR, 'inbox.json')
const HOME = homedir()
const startedAt = Date.now()

const log = line => process.stdout.write(`${new Date().toISOString()} ${line}\n`)

// ── what the sessions wrote ─────────────────────────────────────────────────────────────────

/** The last good copy of each feed, by file: a feed caught half written keeps its last copy. */
const feedCache = new Map()

async function loadFeeds() {
  const names = (await readdir(FEEDS).catch(() => [])).filter(n => n.endsWith('.json'))
  const now = Date.now()
  for (const n of [...feedCache.keys()]) if (!names.includes(n)) feedCache.delete(n)
  for (const n of names) {
    const path = join(FEEDS, n)
    const st = await stat(path).catch(() => undefined)
    if (st === undefined) continue
    if (now - st.mtimeMs > 7 * 24 * 3600_000) {
      await unlink(path).catch(() => undefined)
      feedCache.delete(n)
      continue
    }
    const had = feedCache.get(n)
    if (had !== undefined && had.mtimeMs === st.mtimeMs) continue
    try {
      const feed = cleanFeed(JSON.parse(await readFile(path, 'utf8')))
      if (feed !== undefined) feedCache.set(n, { mtimeMs: st.mtimeMs, feed })
    } catch {
      // half written: the last copy stands until the next one
    }
  }
  return [...feedCache.values()].map(v => v.feed)
}

// ── the answers from the page ───────────────────────────────────────────────────────────────

let inbox = []
let saving = Promise.resolve()

async function loadInbox() {
  try {
    const v = JSON.parse(await readFile(INBOX, 'utf8'))
    inbox = Array.isArray(v.entries) ? v.entries : []
  } catch {
    inbox = []
  }
}

function saveInbox() {
  const text = JSON.stringify({ v: 1, at: Date.now(), entries: inbox })
  saving = saving.then(async () => {
    const tmp = `${INBOX}.${process.pid}.tmp`
    await writeFile(tmp, text)
    await rename(tmp, INBOX)
  })
  return saving
}

async function step() {
  const feeds = await loadFeeds()
  const routed = routeInbox(inbox, feeds, Date.now())
  if (routed.changed) {
    inbox = routed.inbox
    await saveInbox()
  }
  return feeds
}

// ── who may ask ─────────────────────────────────────────────────────────────────────────────

let owner = { login: '', at: 0 }

function tailscaleStatus() {
  return new Promise((resolve, reject) => {
    execFile(TAILSCALE, ['status', '--json'], { timeout: 10_000, maxBuffer: 8 << 20 }, (err, out) =>
      err ? reject(err) : resolve(out),
    )
  })
}

/** The login this Mac is signed in to Tailscale as, lower case; renewed every five minutes. */
async function ownerLogin() {
  if (owner.login !== '' && Date.now() - owner.at < 300_000) return owner.login
  try {
    const s = JSON.parse(await tailscaleStatus())
    const login = String(s.User?.[String(s.Self?.UserID)]?.LoginName ?? '').toLowerCase()
    if (login !== '') owner = { login, at: Date.now() }
  } catch (err) {
    log(`tailscale status failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return owner.login
}

/** The names the hub answers to: this Mac, and its name on the tailnet. */
function hostOk(host) {
  const h = String(host ?? '').toLowerCase()
  return (
    h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}` || h === `[::1]:${PORT}` || /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net(:\d+)?$/.test(h)
  )
}

// ── answering ───────────────────────────────────────────────────────────────────────────────

const SAFE = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
}
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...SAFE, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra })
  res.end(body)
}
const json = (res, status, v) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(v))
const text = (res, status, t) => send(res, status, 'text/plain; charset=utf-8', t + '\n')

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8', { 'Content-Security-Policy': CSP }],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8', {}],
  '/fonts/YYMono-Regular.otf': ['fonts/YYMono-Regular.otf', 'font/otf', { 'Cache-Control': 'max-age=86400' }],
  '/fonts/bricolage-latin.woff2': ['fonts/bricolage-latin.woff2', 'font/woff2', { 'Cache-Control': 'max-age=86400' }],
}

function body(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const parts = []
    req.on('data', c => {
      size += c.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else parts.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

async function answer(req, res) {
  if (req.headers['x-desk-hub'] !== '1') return text(res, 403, 'Answers come from the hub page only.')
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host = ''
    try {
      host = new URL(origin).host.toLowerCase()
    } catch {}
    if (host !== String(req.headers.host ?? '').toLowerCase()) return text(res, 403, 'Answers come from the hub page only.')
  }
  if (!/^application\/json\b/.test(String(req.headers['content-type'] ?? ''))) return text(res, 415, 'Send JSON.')
  let v
  try {
    v = JSON.parse(await body(req, 16_384))
  } catch {
    return text(res, 400, 'That answer could not be read.')
  }
  const askId = typeof v.askId === 'string' && /^[a-z0-9]{1,40}$/.test(v.askId) ? v.askId : ''
  const words = typeof v.words === 'string' ? v.words.trim().slice(0, 4000) : ''
  const done = v.done === true
  if (askId === '' || (words === '') === !done) return text(res, 400, 'An answer is words, or done.')

  const feeds = await step()
  const now = Date.now()
  const state = stateOf({ feeds, inbox, now, home: HOME, version: VERSION })
  const ok = canAnswer(state, inbox, askId)
  if (ok.error !== undefined) return json(res, 409, { error: ok.error })
  const rid = 'r' + now.toString(36) + randomBytes(3).toString('hex')
  inbox.push({ rid, askId, sid: ok.sid, words: done ? '' : words, done, at: now, by: '', takenAt: 0 })
  inbox = routeInbox(inbox, feeds, now).inbox
  await saveInbox()
  const entry = inbox.find(e => e.rid === rid)
  return json(res, 200, { ok: true, rid, at: now, waiting: !entry?.by })
}

async function handle(req, res) {
  const path = new URL(req.url ?? '/', 'http://hub').pathname
  // the sessions' check that the hub is up, and which; it says nothing else
  if (path === '/api/ping') return json(res, 200, { name: 'desk-hub', version: VERSION })
  if (!hostOk(req.headers.host)) return text(res, 421, 'Not this hub.')
  const login = await ownerLogin()
  if (login === '') return text(res, 503, 'The hub cannot reach Tailscale to learn who owns this Mac.')
  const who = String(req.headers['tailscale-user-login'] ?? '').toLowerCase()
  if (who !== login) return text(res, 403, 'This hub answers only its owner, through Tailscale.')

  if (req.method === 'POST' && path === '/api/answer') return answer(req, res)
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Not here.')
  if (path === '/api/state') {
    const feeds = await step()
    return json(res, 200, stateOf({ feeds, inbox, now: Date.now(), home: HOME, version: VERSION }))
  }
  const file = FILES[path]
  if (file === undefined) return text(res, 404, 'Not here.')
  const [name, type, extra] = file
  // a font is looked for in the hub folder first, so a face that may not be published stays on this Mac
  if (name.startsWith('fonts/')) {
    try {
      return send(res, 200, type, await readFile(join(DIR, name)), extra)
    } catch {
      // then the copy read at start, if the mod ships one
    }
  }
  const held = page.get(name)
  if (held === undefined) return text(res, 404, 'Not here.')
  send(res, 200, type, held, extra)
}

// ── life ────────────────────────────────────────────────────────────────────────────────────

await mkdir(FEEDS, { recursive: true })
await loadInbox()

/** The page's files, read once at start: the hub keeps serving if the mod's folder moves or updates. */
const page = new Map()
for (const [name] of Object.values(FILES)) {
  try {
    page.set(name, await readFile(join(HERE, name)))
  } catch {
    // a font the mod does not ship
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    log(`error: ${err instanceof Error ? err.message : String(err)}`)
    if (!res.headersSent) text(res, 500, 'The hub failed on that.')
    else res.end()
  })
})
server.requestTimeout = 15_000
server.headersTimeout = 10_000

server.on('error', err => {
  log(`cannot listen on 127.0.0.1:${PORT}: ${err.message}`)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', async () => {
  await writeFile(join(DIR, 'hub.json'), JSON.stringify({ pid: process.pid, port: PORT, version: VERSION, startedAt, root: HERE }))
  log(`desk hub ${VERSION} on 127.0.0.1:${PORT}, pid ${process.pid}`)
  void ownerLogin()
})

const timer = setInterval(async () => {
  try {
    const feeds = await step()
    const newest = feeds.reduce((m, f) => Math.max(m, f.at), 0)
    if (Date.now() - Math.max(newest, startedAt) > IDLE_STOP_MS) stop('no session has fed the hub for 12 hours')
  } catch (err) {
    log(`step failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}, STEP_MS)

function stop(why) {
  log(`stopping: ${why}`)
  clearInterval(timer)
  server.close()
  saving.finally(() => process.exit(0))
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
