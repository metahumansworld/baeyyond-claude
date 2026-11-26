// The asks: what a session needs from the person, kept where every session sees it.
//
// An ask lives in `$.store` under `ask:<id>`, so the pane in any session lists every
// session's. Only the asking session can put a reply into its own chat (`$.prompt.submit`
// reaches this session alone), so a reply typed in another session's pane is left under
// `reply:<id>` and the asker's poll takes it. Each session marks `live:<sessionId>` as it
// polls, so a pane can say when the asker is closed and a reply will wait for it.
//
// Everything here but `loadAll` is pure, so it is tested alone.

import type { EngineInterface } from 'claude-code'

import type { Ask, AskKind, AskView } from '../types'

export const ASK = 'ask:'
export const REPLY = 'reply:'
export const LIVE = 'live:'
/** How often each session reads the store. */
export const POLL_MS = 2000
/** How often a session renews its mark. */
export const MARK_MS = 30_000
/** A session counts as open while its mark is this fresh. */
export const LIVE_MS = 90_000
/** Closed asks, and marks of sessions gone, are kept this long. */
export const KEEP_MS = 24 * 3600_000

export const KINDS: readonly AskKind[] = ['review', 'decision', 'approval', 'answer']

/** The buttons an ask gets when the asker names none. */
export function defaultOptions(kind: AskKind): string[] {
  if (kind === 'approval') return ['Yes', 'No']
  if (kind === 'review') return ['Looks good']
  return []
}

/** A reply as the asking session reads it: the ask named, then the person's words. */
export function replyText(ask: Pick<Ask, 'id' | 'title'>, text: string): string {
  return `Re: ${ask.title} (desk ask ${ask.id})\n\n${text}`
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** The model's input, made into an ask; `error` when it cannot be one. */
export function makeAsk(
  input: Record<string, unknown>,
  at: { id: string; sessionId: string; cwd: string; now: number },
): Ask | { error: string } {
  const title = clip(input.title, 240)
  if (title === '') return { error: 'An ask needs a title: the question or request in one line.' }
  const kind = KINDS.includes(input.kind as AskKind) ? (input.kind as AskKind) : 'answer'
  const given = Array.isArray(input.options) ? input.options.map(o => clip(o, 48)).filter(o => o !== '') : []
  const options = (given.length > 0 ? given : defaultOptions(kind)).slice(0, 4)
  const folder = at.cwd.split('/').filter(Boolean).pop() ?? at.cwd
  return {
    id: at.id,
    sessionId: at.sessionId,
    where: clip(input.topic, 60) || folder,
    cwd: at.cwd,
    title,
    detail: clip(input.detail, 2000),
    kind,
    options,
    link: clip(input.link, 500),
    askedAt: at.now,
    state: 'open',
    reply: '',
    closedAt: 0,
  }
}

/** An open ask of this session with the same title, which a new one would repeat. */
export function sameAsk(asks: readonly Ask[], sessionId: string, title: string): Ask | undefined {
  const t = title.trim().toLowerCase()
  return asks.find(a => a.state === 'open' && a.sessionId === sessionId && a.title.toLowerCase() === t)
}

/** A stored value that is an ask this version can read. */
export function isAsk(v: unknown): v is Ask {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Record<string, unknown>
  return (
    typeof a.id === 'string' &&
    typeof a.sessionId === 'string' &&
    typeof a.title === 'string' &&
    typeof a.askedAt === 'number' &&
    (a.state === 'open' || a.state === 'replied' || a.state === 'done') &&
    Array.isArray(a.options)
  )
}

/** A short age: now, 4m, 3h, 2d. */
export function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** The pane's list: open asks, this session's first, each group oldest first (waiting longest). */
export function viewOf(
  asks: readonly Ask[],
  sessionId: string,
  live: ReadonlyMap<string, number>,
  pending: ReadonlyMap<string, string>,
  now: number,
): AskView[] {
  return asks
    .filter(a => a.state === 'open')
    .map(a => ({
      ...a,
      isMine: a.sessionId === sessionId,
      isLive: a.sessionId === sessionId || now - (live.get(a.sessionId) ?? 0) < LIVE_MS,
      pending: pending.get(a.id) ?? '',
    }))
    .sort((x, y) => Number(y.isMine) - Number(x.isMine) || x.askedAt - y.askedAt)
}

/** What rides with the person's prompt for the model: this session's open asks, or nothing. */
export function contextBlock(asks: readonly Ask[], sessionId: string, now: number): string | undefined {
  const mine = asks.filter(a => a.state === 'open' && a.sessionId === sessionId)
  if (mine.length === 0) return undefined
  const lines = mine.map(a => `- ${a.id} [${a.kind}] ${a.title} (open ${ago(now - a.askedAt)})`)
  return [
    "Open asks of this session in the user's Waiting-on-you pane (desk mod). Do not ask these again;",
    'refer to one by its title. Call mcp__desk__resolve when one is settled in chat or no longer applies.',
    ...lines,
  ].join('\n')
}

/** A reply left for an ask by another session's pane. */
export type Reply = { text: string; at: number; from: string }

export const isReply = (v: unknown): v is Reply =>
  typeof v === 'object' && v !== null && typeof (v as Reply).text === 'string'

/** Everything the desk keeps, read in one pass. */
export type Desk = { asks: Ask[]; replies: Map<string, Reply>; live: Map<string, number> }

export async function loadAll($: EngineInterface): Promise<Desk> {
  const keys = await $.store.keys()
  const desk: Desk = { asks: [], replies: new Map(), live: new Map() }
  await Promise.all(
    keys.map(async key => {
      if (key.startsWith(ASK)) {
        const v = await $.store.get(key)
        if (isAsk(v)) desk.asks.push(v)
      } else if (key.startsWith(REPLY)) {
        const v = await $.store.get(key)
        if (isReply(v)) desk.replies.set(key.slice(REPLY.length), v)
      } else if (key.startsWith(LIVE)) {
        const v = await $.store.get(key)
        if (typeof v === 'number') desk.live.set(key.slice(LIVE.length), v)
      }
    }),
  )
  return desk
}

/** The store keys a poll may delete: closed asks and marks older than a day, replies whose ask is gone. */
export function staleKeys(desk: Desk, now: number): string[] {
  const out: string[] = []
  const ids = new Set(desk.asks.map(a => a.id))
  for (const a of desk.asks) if (a.state !== 'open' && now - a.closedAt > KEEP_MS) out.push(ASK + a.id)
  for (const [sid, at] of desk.live) if (now - at > KEEP_MS) out.push(LIVE + sid)
  for (const id of desk.replies.keys()) if (!ids.has(id)) out.push(REPLY + id)
  return out
}
