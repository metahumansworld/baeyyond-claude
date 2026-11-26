// The hub's view of every session, made from the feeds the sessions write. Pure, so it is tested alone.
//
// Each session running this desk writes feeds/<sid>.json: when it wrote, its folder, whether a turn
// runs, the asks it reads from the shared store, replies left for other sessions, the marks of
// sessions it saw, its served sites, and the answers from the hub it has taken. The newest feed
// that holds an ask says how that ask stands.

/** A feed this new means its session is open and reads the hub's answers. */
export const FRESH_MS = 30_000
/** A session's mark this new means it is open (an older desk, which writes no feed). */
export const LIVE_MS = 90_000
/** Closed asks stay on the page this long, folded under the session. */
export const RECENT_MS = 15 * 60_000
/** Answers the sessions took are kept this long, so the page can say so. */
export const KEEP_TAKEN_MS = 15 * 60_000
/** Answers never taken are kept this long. */
export const KEEP_WAITING_MS = 7 * 24 * 3600_000

const KINDS = ['review', 'decision', 'approval', 'answer']
const STATES = ['open', 'replied', 'done']

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** A feed as far as the hub trusts it; undefined when it is not one. */
export function cleanFeed(v) {
  if (typeof v !== 'object' || v === null) return undefined
  if (typeof v.sid !== 'string' || v.sid === '' || typeof v.at !== 'number') return undefined
  const asks = Array.isArray(v.asks) ? v.asks.map(cleanAsk).filter(Boolean) : []
  const pending = {}
  for (const [id, t] of Object.entries(v.pending ?? {})) if (typeof t === 'string') pending[id] = t.slice(0, 4000)
  const live = {}
  for (const [sid, at] of Object.entries(v.live ?? {})) if (typeof at === 'number') live[sid] = at
  const sites = Array.isArray(v.sites)
    ? v.sites
        .filter(s => s && typeof s.port === 'number' && typeof s.url === 'string' && /^https:\/\//.test(s.url))
        .map(s => ({ port: s.port, url: s.url.slice(0, 300) }))
    : []
  const taken = Array.isArray(v.taken) ? v.taken.filter(r => typeof r === 'string').slice(-200) : []
  return {
    sid: v.sid.slice(0, 80),
    at: v.at,
    version: str(v.version, 20),
    cwd: str(v.cwd, 500),
    running: v.running === true,
    idleSince: num(v.idleSince),
    asks,
    pending,
    live,
    sites,
    taken,
  }
}

function cleanAsk(a) {
  if (typeof a !== 'object' || a === null) return undefined
  if (typeof a.id !== 'string' || typeof a.sessionId !== 'string' || typeof a.title !== 'string') return undefined
  if (!STATES.includes(a.state)) return undefined
  return {
    id: a.id.slice(0, 40),
    sessionId: a.sessionId.slice(0, 80),
    where: str(a.where, 60),
    cwd: str(a.cwd, 500),
    title: str(a.title, 240),
    detail: str(a.detail, 2000),
    kind: KINDS.includes(a.kind) ? a.kind : 'answer',
    options: Array.isArray(a.options) ? a.options.filter(o => typeof o === 'string').map(o => o.slice(0, 48)).slice(0, 4) : [],
    link: str(a.link, 500),
    askedAt: num(a.askedAt),
    state: a.state,
    reply: str(a.reply, 4000),
    closedAt: num(a.closedAt),
  }
}

/** A folder as the page shows it: the home folder as ~. */
export function tilde(cwd, home) {
  if (home && (cwd === home || cwd.startsWith(home + '/'))) return '~' + cwd.slice(home.length)
  return cwd
}

const base = cwd => cwd.split('/').filter(Boolean).pop() ?? cwd

/** The session that should take an answer: the asker while it reads the hub, else the first that does. */
export function takerOf(askerSid, feeds, now) {
  const fresh = feeds.filter(f => now - f.at < FRESH_MS).map(f => f.sid).sort()
  if (fresh.includes(askerSid)) return askerSid
  return fresh[0] ?? ''
}

/**
 * The inbox brought up to date with the feeds: each answer marked taken once a session took it,
 * handed to a session that reads the hub, and dropped when old. Returns the new list and whether it changed.
 */
export function routeInbox(inbox, feeds, now) {
  const taken = new Set(feeds.flatMap(f => f.taken))
  let changed = false
  const out = []
  for (const e of inbox) {
    let next = e
    if (!e.takenAt && taken.has(e.rid)) next = { ...next, takenAt: now }
    if (!next.takenAt) {
      const by = feeds.some(f => f.sid === next.by && now - f.at < FRESH_MS) ? next.by : takerOf(next.sid, feeds, now)
      if (by !== next.by) next = { ...next, by }
    }
    const keep = next.takenAt ? now - next.takenAt < KEEP_TAKEN_MS : now - next.at < KEEP_WAITING_MS
    if (next !== e || !keep) changed = true
    if (keep) out.push(next)
  }
  return { inbox: out, changed }
}

/** Everything the page draws. */
export function stateOf({ feeds, inbox, now, home, version }) {
  const sorted = [...feeds].sort((x, y) => y.at - x.at)
  const asks = new Map()
  const pending = new Map()
  const live = new Map()
  for (const f of sorted) {
    for (const a of f.asks) {
      if (asks.has(a.id)) continue
      asks.set(a.id, a)
      if (f.pending[a.id] !== undefined) pending.set(a.id, f.pending[a.id])
    }
    for (const [sid, at] of Object.entries(f.live)) live.set(sid, Math.max(live.get(sid) ?? 0, at))
    live.set(f.sid, Math.max(live.get(f.sid) ?? 0, f.at))
  }

  const shown = [...asks.values()].filter(a => a.state === 'open' || now - a.closedAt < RECENT_MS)
  const bySid = new Map()
  for (const a of shown) {
    if (!bySid.has(a.sessionId)) bySid.set(a.sessionId, [])
    bySid.get(a.sessionId).push({ ...a, pending: pending.get(a.id) ?? '' })
  }
  for (const f of sorted) {
    if (now - f.at < FRESH_MS && f.sites.length > 0 && !bySid.has(f.sid)) bySid.set(f.sid, [])
  }

  const sessions = []
  for (const [sid, list] of bySid) {
    const feed = sorted.find(f => f.sid === sid)
    const fresh = feed !== undefined && now - feed.at < FRESH_MS
    const open = list.filter(a => a.state === 'open')
    const seen = live.get(sid) ?? 0
    let state
    if (fresh) state = feed.running ? 'working' : open.length > 0 ? 'held' : 'idle'
    else state = now - seen < LIVE_MS ? 'open' : 'closed'
    const oldest = open.reduce((m, a) => Math.min(m, a.askedAt), Infinity)
    const heldSince = state === 'held' ? Math.max(feed.idleSince, oldest === Infinity ? 0 : oldest) : 0
    const latest = [...list].sort((x, y) => y.askedAt - x.askedAt)[0]
    const cwd = feed?.cwd || latest?.cwd || ''
    list.sort((x, y) => Number(y.state === 'open') - Number(x.state === 'open') || x.askedAt - y.askedAt)
    sessions.push({
      sid,
      name: latest?.where || base(cwd) || 'a session',
      folder: tilde(cwd, home),
      state,
      heldSince,
      closedSince: state === 'closed' ? seen : 0,
      oldest: oldest === Infinity ? 0 : oldest,
      asks: list.map(({ cwd: _c, sessionId: _s, where: _w, ...a }) => a),
      sites: fresh ? feed.sites : [],
    })
  }
  sessions.sort((x, y) => (x.oldest || Infinity) - (y.oldest || Infinity) || x.name.localeCompare(y.name))

  const answers = {}
  for (const e of inbox) {
    answers[e.askId] = { rid: e.rid, words: e.words, done: e.done, at: e.at, takenAt: e.takenAt ?? 0, waiting: !e.by && !e.takenAt }
  }
  const newest = sorted[0]?.at ?? 0
  return { now, version, reading: newest > 0 && now - newest < FRESH_MS, readAt: newest, sessions, answers }
}

/** Whether the page may answer this ask now: the ask as the hub knows it, or why not. */
export function canAnswer(state, inbox, askId) {
  for (const s of state.sessions) {
    const a = s.asks.find(x => x.id === askId)
    if (a === undefined) continue
    if (a.state !== 'open') return { error: 'That ask is closed already.' }
    if (a.pending !== '') return { error: 'An answer to that ask is already on its way.' }
    if (inbox.some(e => e.askId === askId && !e.takenAt)) return { error: 'You answered that one already; it is on its way.' }
    return { sid: s.sid }
  }
  return { error: 'The hub does not know that ask.' }
}
