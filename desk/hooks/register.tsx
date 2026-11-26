// The desk: what the person's sessions need from them, and what this one is doing.
//
// Waiting on you. A session that needs a review, a decision, an approval or an answer puts it
// in the pane with the model tool `mcp__desk__ask`, instead of leaving it in the chat where it
// gets buried and asked again. Every session's pane lists every session's open asks (asks.ts
// keeps them in `$.store`). Buttons and a reply field answer one: the answer reaches the session
// that asked as a user turn, and closes the ask. A new ask raises a notification. A standing
// section of the system prompt tells the model to use the pane, and each prompt carries this
// session's open asks so the model does not ask them again.
//
// This session (/desk). What runs now, the files edited, the test runs and how they ended, the
// time each turn took and the session's total (activity.ts), and the local servers seen.
//
// Send to phone (/phone <port>, or the button by a server). The port goes on the tailnet with
// `tailscale serve`, and the pane shows the link as a QR code (phone.ts, qr.ts).
//
// The hub (hub.ts, hub/). One page with every session's asks, grouped by session, answered from
// the phone. Each session feeds it and takes the answers it hands back; `/phone hub` puts it on
// the tailnet.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ask, AskState, AskView, PhoneLink, Running, Served } from '../types'
import {
  EMPTY,
  dur,
  editedPath,
  ended,
  isTestCommand,
  labelOf,
  localPorts,
  shortPath,
  started,
  testOutcome,
  textOf,
  turnEnded,
  turnStarted,
  workTime,
} from './activity'
import {
  ASK,
  LIVE,
  MARK_MS,
  POLL_MS,
  REPLY,
  ago,
  contextBlock,
  isAsk,
  loadAll,
  makeAsk,
  replyText,
  sameAsk,
  staleKeys,
  viewOf,
} from './asks'
import type { Desk } from './asks'
import { ENSURE_MS, FEED_MS, HUB_PORT, ensureHub, feedOf, forMe, hubFolder, sitesOf } from './hub'
import type { Site } from './hub'
import { SERVE, portOf, sendToPhone, stopServe } from './phone'
import { qrSvg, qrText } from './qr'

type Engine = EngineInterface

export const WAITING = 'waiting'
const WAITING_TITLE = 'Waiting on you'
export const SESSION = 'session'
const SESSION_TITLE = 'This session'

export const asksAtom = atom({ plugin: 'desk', key: 'asks' } as const, [] as AskView[], { shape: 'asks-1' })
export const minuteAtom = atom({ plugin: 'desk', key: 'minute' } as const, 0)
export const activityAtom = atom({ plugin: 'desk', key: 'activity' } as const, EMPTY, { shape: 'activity-1' })
export const beatAtom = atom({ plugin: 'desk', key: 'beat' } as const, 0)
export const phoneAtom = atom({ plugin: 'desk', key: 'phone' } as const, [] as PhoneLink[], { shape: 'phone-1' })
export const phoneNoteAtom = atom({ plugin: 'desk', key: 'phoneNote' } as const, '')
export const hubAtom = atom({ plugin: 'desk', key: 'hub' } as const, '')

/** The standing instruction, the same in every session (a varying one would break the cache). */
export const GUIDE = [
  '# Waiting on the user (desk)',
  "The user keeps a Waiting-on-you pane: one list, across all their sessions, of what each session needs from them. Asks left only in the chat get buried and asked again, so:",
  '- Whenever your work waits on the user (a review, a decision, an approval before an action, or an answer only they have), call mcp__desk__ask with it, then say it in one line in your reply. One call per ask; when the answer is a choice, give the options, your pick first.',
  "- Never ask again what is already open. This session's open asks ride with each user message, and mcp__desk__list lists them; point to an open one by its title instead.",
  '- A reply from the pane arrives as a user message starting "Re: <title> (desk ask <id>)", and that closes the ask. When the user settles one in the chat instead, or it no longer applies, call mcp__desk__resolve with its id.',
  '- Progress notes, questions you can answer yourself, and anything that does not wait on the user stay out of the pane.',
].join('\n')

export const ASK_TOOL = {
  name: 'ask',
  description:
    "Put something that waits on the user (a review, a decision, an approval, or an answer only they have) in their Waiting-on-you pane, so it is not buried in the chat. Say it in one line in your reply too. An open ask with the same title is not added again. Their answer arrives as a user message starting \"Re: <title>\".",
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The ask in one line, as a question or request: "Push 0.5.0 to GitHub?"' },
      kind: {
        type: 'string',
        enum: ['review', 'decision', 'approval', 'answer'],
        description: 'review: look at something; decision: pick one of several; approval: a yes before an action; answer: a fact only they have.',
      },
      detail: { type: 'string', description: 'What they need to answer it, in a few lines: what each choice leads to, what is already done.' },
      options: {
        type: 'array',
        items: { type: 'string' },
        maxItems: 4,
        description: 'Up to four short answers drawn as buttons, your pick first: ["Yes, push", "Not now"]. Approvals default to Yes/No.',
      },
      link: { type: 'string', description: 'A file path or URL to look at, if there is one.' },
      topic: { type: 'string', description: 'A few words naming this session\'s work, shown beside the ask in other sessions: "simulation theme".' },
    },
    required: ['title', 'kind'],
  },
  isDeferred: false,
} as const

export const RESOLVE_TOOL = {
  name: 'resolve',
  description: "Close one of this session's open asks in the user's Waiting-on-you pane: the user settled it in the chat, or it no longer applies.",
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The ask\'s id, as mcp__desk__ask returned it.' },
      outcome: { type: 'string', description: 'What was settled, in a few words.' },
    },
    required: ['id'],
  },
  isDeferred: false,
} as const

export const LIST_TOOL = {
  name: 'list',
  description: "List this session's open asks in the user's Waiting-on-you pane, so you do not ask them again.",
  inputSchema: { type: 'object', properties: {} },
  isDeferred: false,
} as const

/** The module's own: who this session is, the poll, and what the panes last drew. */
const desk = {
  sid: '',
  cwd: '',
  last: '',
  minute: -1,
  markedAt: 0,
  inFlight: undefined as undefined | Promise<void>,
  again: false,
  running: 0,
  beat: 0,
  phoneBusy: false,
  timer: undefined as undefined | { cancel: () => void },
  notified: new Set<string>(),
  drafts: new Map<string, string>(),
  // the hub
  hubDir: '',
  hubTimer: undefined as undefined | { cancel: () => void },
  ensuring: false,
  inTurn: false,
  idleSince: 0,
  inboxAt: 0,
  taken: [] as string[],
  feedSig: '',
  feedAt: 0,
  sites: [] as Site[],
  sitesAt: 0,
}

const quiet = (p: Promise<unknown>) => void p.catch(() => undefined)

const newId = (now: number) =>
  'a' + now.toString(36).slice(-5) + Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')

// ── Waiting on you ──────────────────────────────────────────────────────────────────────────

/** Close an open ask; the ask as it was, or undefined when it was not open. */
async function closeAsk($: Engine, id: string, state: AskState, reply: string): Promise<Ask | undefined> {
  const v = await $.store.get(ASK + id)
  if (!isAsk(v) || v.state !== 'open') return undefined
  await $.store.set(ASK + id, { ...v, state, reply, closedAt: await $.clock.now() })
  return v
}

/** An answer to one of this session's asks: closed, then sent into this chat as the person's words. */
async function deliver($: Engine, id: string, text: string): Promise<void> {
  const ask = await closeAsk($, id, 'replied', text)
  if (ask === undefined) return
  $.prompt.submit({ text: replyText(ask, text), asUser: true }).catch(async (err: unknown) => {
    // the session would not take it: open the ask again, so the answer is not lost
    await $.store.set(ASK + id, { ...ask, state: 'open', reply: '', closedAt: 0 })
    $.ui.toast(`desk: the answer to "${ask.title}" was not sent (${String(err)}); it is open again.`)
  })
}

// ── The hub ─────────────────────────────────────────────────────────────────────────────────

/**
 * The hub's answers handed to this session: to its own asks, sent into this chat as the pane
 * sends them; to another session's, left in the store for it. Done closes the ask either way.
 */
async function takeFromHub($: Engine, all: Desk, now: number): Promise<void> {
  const path = `${desk.hubDir}/inbox.json`
  const st = (await $.fs.exists(path)) ? await $.fs.stat(path) : undefined
  if (st === undefined || st.mtimeMs === desk.inboxAt) return
  const mine = forMe(await $.fs.read(path).catch(() => ''), desk.sid, new Set(desk.taken))
  // half written: read again on the next poll
  if (mine === undefined) return
  desk.inboxAt = st.mtimeMs
  for (const e of mine) {
    const ask = all.asks.find(a => a.id === e.askId)
    if (ask !== undefined && ask.state === 'open') {
      if (e.done) {
        await closeAsk($, e.askId, 'done', '')
        await $.store.delete(REPLY + e.askId)
        ask.state = 'done'
        ask.closedAt = now
      } else if (ask.sessionId === desk.sid) {
        await deliver($, e.askId, e.words)
        ask.state = 'replied'
        ask.reply = e.words
        ask.closedAt = now
      } else {
        await $.store.set(REPLY + e.askId, { text: e.words, at: now, from: 'hub' })
        all.replies.set(e.askId, { text: e.words, at: now, from: 'hub' })
      }
    }
    desk.taken = [...desk.taken, e.rid].slice(-200)
  }
}

/** This session's feed to the hub, written when it changes and every ten seconds. */
async function feedHub($: Engine, all: Desk, now: number): Promise<void> {
  if (now - desk.sitesAt >= FEED_MS) {
    desk.sitesAt = now
    desk.sites = sitesOf(await servedByDesk($), desk.sid)
  }
  const me = { sid: desk.sid, cwd: desk.cwd, running: desk.inTurn, idleSince: desk.idleSince, taken: desk.taken }
  const feed = feedOf(all, me, desk.sites, now)
  const sig = JSON.stringify(feed)
  if (sig === desk.feedSig && now - desk.feedAt < FEED_MS) return
  await $.fs.write(`${desk.hubDir}/feeds/${desk.sid.replace(/[^A-Za-z0-9_-]/g, '_')}.json`, JSON.stringify({ ...feed, at: now }))
  desk.feedSig = sig
  desk.feedAt = now
}

/** Checks that the hub runs, starting it when it does not; one check at a time. */
async function keepHub($: Engine): Promise<void> {
  if (desk.ensuring || desk.hubDir === '') return
  desk.ensuring = true
  try {
    const line = await ensureHub($, desk.hubDir)
    await update($, hubAtom, () => line)
  } catch (err) {
    await update($, hubAtom, () => `could not check: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    desk.ensuring = false
  }
}

/**
 * Read the store, take replies left for this session, tidy, and redraw what changed. A call while
 * a pass runs waits for it and then for one more, so its caller sees the store as it left it.
 */
export async function refresh($: Engine): Promise<void> {
  if (desk.sid === '') return
  if (desk.inFlight !== undefined) {
    desk.again = true
    return desk.inFlight
  }
  desk.inFlight = passes($)
  try {
    await desk.inFlight
  } finally {
    desk.inFlight = undefined
  }
}

async function passes($: Engine): Promise<void> {
  do {
    desk.again = false
    await pass($)
  } while (desk.again)
}

async function pass($: Engine): Promise<void> {
  const now = await $.clock.now()
  if (now - desk.markedAt >= MARK_MS) {
    desk.markedAt = now
    await $.store.set(LIVE + desk.sid, now)
  }
  const all = await loadAll($)
  if (desk.hubDir !== '') {
    try {
      await takeFromHub($, all, now)
    } catch {
      // the inbox is read again on the next poll
    }
  }

  for (const [id, r] of [...all.replies]) {
    const ask = all.asks.find(a => a.id === id)
    if (ask === undefined || ask.sessionId !== desk.sid) continue
    all.replies.delete(id)
    await $.store.delete(REPLY + id)
    if (ask.state !== 'open') continue
    await deliver($, id, r.text)
    ask.state = 'replied'
  }
  for (const a of all.asks) {
    if (a.state !== 'open' && desk.notified.delete(a.id)) void $.ui.cancelNotify('desk:' + a.id)
  }
  for (const key of staleKeys(all, now)) await $.store.delete(key)
  if (desk.hubDir !== '') {
    try {
      await feedHub($, all, now)
    } catch {
      // written again on the next poll
    }
  }

  const pending = new Map([...all.replies].map(([id, r]) => [id, r.text] as const))
  const view = viewOf(all.asks, desk.sid, all.live, pending, now)
  const sig = JSON.stringify(view)
  if (sig !== desk.last) {
    desk.last = sig
    await update($, asksAtom, () => view)
  }
  const minute = Math.floor(now / 60_000)
  if (minute !== desk.minute) {
    desk.minute = minute
    await update($, minuteAtom, () => minute)
  }
  // while a call runs, its time counts up in the session pane
  if (desk.running > 0) await update($, beatAtom, () => ++desk.beat)
}

/** The pane's answer to one ask: here, sent at once; another session's, left for it to take. */
async function answer($: Engine, ask: AskView, text: string): Promise<void> {
  const t = text.trim()
  if (t === '') return
  if (ask.sessionId === desk.sid) await deliver($, ask.id, t)
  else await $.store.set(REPLY + ask.id, { text: t, at: await $.clock.now(), from: desk.sid })
  desk.drafts.delete(ask.id)
  await refresh($)
}

async function done($: Engine, ask: AskView): Promise<void> {
  await closeAsk($, ask.id, 'done', '')
  await $.store.delete(REPLY + ask.id)
  desk.drafts.delete(ask.id)
  await refresh($)
}

async function serveAsk($: Engine, input: Record<string, unknown>) {
  const now = await $.clock.now()
  const all = await loadAll($)
  const twin = sameAsk(all.asks, desk.sid, typeof input.title === 'string' ? input.title : '')
  if (twin !== undefined) {
    return {
      result: `Already open as ${twin.id} (asked ${ago(now - twin.askedAt) === 'now' ? 'just now' : `${ago(now - twin.askedAt)} ago`}), not added again. Point the user to it by its title instead of asking again.`,
    }
  }
  const made = makeAsk(input, { id: newId(now), sessionId: desk.sid, cwd: desk.cwd, now })
  if ('error' in made) return { deny: made.error }
  await $.store.set(ASK + made.id, made)
  desk.notified.add(made.id)
  quiet($.ui.notify(made.title, { title: `${WAITING_TITLE} · ${made.where}`, key: 'desk:' + made.id }))
  quiet($.ui.open({ id: WAITING, title: WAITING_TITLE }))
  await refresh($)
  return {
    result: `Registered ${made.id} in the user's Waiting-on-you pane. Say it in one line in your reply too, and do not ask it again. Their answer comes as a user message starting "Re: ${made.title}".`,
  }
}

async function serveResolve($: Engine, input: Record<string, unknown>) {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const v = await $.store.get(ASK + id)
  if (!isAsk(v)) return { result: `No ask ${id}.` }
  if (v.sessionId !== desk.sid) return { result: `${id} is another session's ask; only it, or the user, closes it.` }
  if (v.state !== 'open') return { result: `${id} was already closed.` }
  const outcome = typeof input.outcome === 'string' ? input.outcome.trim().slice(0, 200) : ''
  await closeAsk($, id, 'done', outcome)
  await refresh($)
  return { result: `Closed ${id}: ${v.title}.` }
}

async function serveList($: Engine) {
  const now = await $.clock.now()
  const all = await loadAll($)
  const mine = all.asks.filter(a => a.state === 'open' && a.sessionId === desk.sid)
  const others = all.asks.filter(a => a.state === 'open' && a.sessionId !== desk.sid).length
  const lines = mine.map(a => `${a.id} [${a.kind}] ${a.title} (open ${ago(now - a.askedAt)})`)
  const tail = others > 0 ? `\n${others} more open from other sessions.` : ''
  return { result: (lines.length > 0 ? lines.join('\n') : 'No open asks from this session.') + tail }
}

const KIND_LABEL = { review: 'Review', decision: 'Decision', approval: 'Approval', answer: 'Answer' } as const

/** Where an answer to another session's ask goes, in a line. */
function routeLine(a: AskView): string {
  if (a.pending !== '') return `Sent: "${a.pending}". It reaches ${a.where} when that session next reads the desk.`
  if (a.isLive) return `Your answer goes to the session working on ${a.where}.`
  return `That session is not open now; your answer waits for it.`
}

// ── Send to phone ───────────────────────────────────────────────────────────────────────────

async function phone($: Engine, port: number): Promise<string> {
  if (port === 0) return 'Give a port: /phone 5173.'
  if (desk.phoneBusy) return 'A send to phone is already running.'
  desk.phoneBusy = true
  try {
    quiet($.ui.open({ id: SESSION, title: SESSION_TITLE }))
    const link = await sendToPhone($, port, desk.sid, async line => {
      await update($, phoneNoteAtom, () => line)
    })
    await update($, phoneAtom, list => [...list.filter(l => l.localPort !== port), link])
    await update($, phoneNoteAtom, () => '')
    quiet($.ui.notify(link.url, { title: `:${port} is on your tailnet`, key: `desk:phone:${port}` }))
    return `${link.url} (${link.isOurs ? 'new serve' : 'already served'}): ${link.check}`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await update($, phoneNoteAtom, () => `Send to phone: ${msg}`)
    return `Not sent: ${msg}`
  } finally {
    desk.phoneBusy = false
  }
}

/** Every serve the desk made and has not turned off, from any session. */
async function servedByDesk($: Engine): Promise<Served[]> {
  const keys = (await $.store.keys()).filter(k => k.startsWith(SERVE))
  const out: Served[] = []
  for (const k of keys) {
    const v = (await $.store.get(k)) as Served | undefined
    if (v !== undefined && typeof v.httpsPort === 'number') out.push(v)
  }
  return out.sort((a, b) => a.httpsPort - b.httpsPort)
}

async function stopPhone($: Engine, link: PhoneLink): Promise<string> {
  try {
    const said = await stopServe($, link.httpsPort)
    await update($, phoneAtom, list => list.filter(l => l.httpsPort !== link.httpsPort))
    await update($, phoneNoteAtom, () => said)
    quiet($.ui.cancelNotify(`desk:phone:${link.localPort}`))
    return said
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await update($, phoneNoteAtom, () => `Stop: ${msg}`)
    return msg
  }
}

// ── This session ───────────────────────────────────────────────────────────────────────────

/** A tool call through the session pane's record: running while it runs, then what it did. */
async function track<R extends { deny?: string; isError?: boolean; result?: unknown }>(
  $: Engine,
  e: { tool: string; tool_use_id?: string },
  run: () => Promise<R>,
): Promise<R> {
  const input = e as unknown as Record<string, unknown>
  const now = await $.clock.now()
  const id = e.tool_use_id ?? `${e.tool}@${now}`
  const test = isTestCommand(e.tool, input)
  const call: Running = { id, tool: e.tool, label: labelOf(e.tool, input), startedAt: now }
  desk.running++
  await update($, activityAtom, a => started(a, call, test))
  let ran: R | undefined
  try {
    ran = await run()
    return ran
  } finally {
    desk.running = Math.max(0, desk.running - 1)
    const end = await $.clock.now()
    const denied = ran === undefined || ran.deny !== undefined
    const failed = !denied && ran?.isError === true
    const output = denied ? '' : textOf(ran?.result)
    const edited = !denied && !failed ? editedPath(e.tool, input) : ''
    const command = typeof input.command === 'string' ? input.command : ''
    const ports = denied ? [] : localPorts(`${command}\n${output.slice(0, 200_000)}`)
    const outcome = !test ? '' : denied ? 'skip' : testOutcome(failed, output)
    await update($, activityAtom, a => ended(a, id, end, { edited, outcome, ports, seen: call.label }))
  }
}

const TEST_MARK = { running: '…', pass: '✓', fail: '✗' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    desk.sid = await $.session.id()
    desk.cwd = await $.session.cwd()
    await Promise.all([
      $.tool.register(ASK_TOOL),
      $.tool.register(RESOLVE_TOOL),
      $.tool.register(LIST_TOOL),
      $.command.register({ name: 'waiting', description: 'Show what your sessions are waiting on you for' }),
      $.command.register({ name: 'desk', description: 'Show what this session is doing: runs, files, tests, turn times' }),
      $.command.register({
        name: 'phone',
        description: 'Send a local server to your phone over your tailnet, as a QR code',
        argumentHint: '<port> | hub | off <port>',
      }),
    ])
    desk.timer?.cancel()
    desk.timer = $.clock.every(POLL_MS, () => quiet(refresh($)))
    // the hub: its folder, the answers this session took before a reload, and the server itself
    try {
      desk.hubDir = await hubFolder($)
      const own = `${desk.hubDir}/feeds/${desk.sid.replace(/[^A-Za-z0-9_-]/g, '_')}.json`
      const had = (desk.hubDir !== '' && (await $.fs.exists(own)) ? JSON.parse(await $.fs.read(own)) : {}) as { taken?: unknown }
      if (Array.isArray(had.taken)) desk.taken = had.taken.filter((r): r is string => typeof r === 'string').slice(-200)
    } catch {
      // no feed yet: nothing taken
    }
    // after a reload mid-turn, the turn record the session keeps says whether a turn still runs
    try {
      const last = (await read($, activityAtom)).turns.at(-1)
      desk.inTurn = last !== undefined && last.ms === 0
      desk.idleSince = last !== undefined && last.ms > 0 ? last.startedAt + last.ms : 0
    } catch {
      // unknown: the next turn says
    }
    desk.hubTimer?.cancel()
    desk.hubTimer = $.clock.every(ENSURE_MS, () => quiet(keepHub($)))
    quiet(keepHub($))
    try {
      await refresh($)
      if ((await read($, asksAtom)).length > 0) quiet($.ui.open({ id: WAITING, title: WAITING_TITLE }))
    } catch {
      // the poll tries again in a moment
    }
    return next(e)
  })

  on('command.run', { command: 'waiting' }, async $ => {
    await $.ui.open({ id: WAITING, title: WAITING_TITLE })
    await refresh($)
    const n = (await read($, asksAtom)).length
    return { text: n === 0 ? 'Nothing is waiting on you.' : `${n} waiting on you.` }
  })

  on('command.run', { command: 'desk' }, async $ => {
    await $.ui.open({ id: SESSION, title: SESSION_TITLE })
    return { text: 'Session pane opened.' }
  })

  on('command.run', { command: 'phone' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      const mine = await servedByDesk($)
      if (mine.length === 0) return { text: 'The desk has nothing on your tailnet. /phone <port> sends a local server.' }
      return { text: mine.map(v => `:${v.localPort} → ${v.url} (/phone off ${v.httpsPort})`).join('\n') }
    }
    if (words[0] === 'hub') return { text: await phone($, HUB_PORT) }
    if (words[0] === 'off') {
      const port = words[1] === 'hub' ? HUB_PORT : portOf(words[1] ?? '')
      if (port === 0) return { text: 'Give the port: /phone off 5173.' }
      const link = (await read($, phoneAtom)).find(l => l.httpsPort === port || l.localPort === port)
      if (link !== undefined) return { text: await stopPhone($, link) }
      // a serve another session (or an earlier one) made: the store knows it, by either port
      const made = (await servedByDesk($)).find(v => v.httpsPort === port || v.localPort === port)
      return { text: await stopServe($, made?.httpsPort ?? port) }
    }
    return { text: await phone($, portOf(words[0] ?? '')) }
  })

  // the standing instruction, last of the session's sections
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    return { sections: [...composed.sections, { id: 'desk:waiting', text: GUIDE, scope: 'session' as const }] }
  })

  // each prompt carries this session's open asks, so the model does not ask them again
  on('prompt.submit', async ($, e, next) => {
    if (desk.sid === '') return next(e)
    const all = await loadAll($)
    const block = contextBlock(all.asks, desk.sid, await $.clock.now())
    return next(block === undefined ? e : { ...e, context: [...(e.context ?? []), block] })
  })

  // the desk's own tools are served here; every other call goes through the session's record
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'mcp__desk__ask') return serveAsk($, input)
    if (e.tool === 'mcp__desk__resolve') return serveResolve($, input)
    if (e.tool === 'mcp__desk__list') return serveList($)
    return track($, e, () => next(e))
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      desk.inTurn = true
      await update($, activityAtom, a => turnStarted(a, now, e.text))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      desk.running = 0
      desk.inTurn = false
      desk.idleSince = now
      await update($, activityAtom, a => turnEnded(a, now, e.durationMs))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: WAITING }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
    const list = await read($, asksAtom)
    await read($, minuteAtom) // redraws as the minutes pass, so the ages move on
    const now = await $.clock.now()

    if (list.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text>Nothing is waiting on you.</Text>
          <Text dimColor wrap="wrap">
            Your sessions put here what they need from you: a review, a decision, an approval, an answer.
          </Text>
        </Box>
      )
    }

    const mine = list.filter(a => a.isMine).length
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>
          {list.length} waiting{mine > 0 && mine < list.length ? ` · ${mine} from this session` : ''}
        </Text>
        {list.map(a => (
          <Box key={a.id} flexDirection="column" borderStyle="round" paddingX={1}>
            <Text dimColor>
              {KIND_LABEL[a.kind]} · {a.isMine ? 'this session' : a.where} · {ago(now - a.askedAt)}
            </Text>
            <Text bold wrap="wrap">
              {a.title}
            </Text>
            {a.detail !== '' && (
              <Text dimColor wrap="wrap">
                {a.detail}
              </Text>
            )}
            {a.link !== '' &&
              (/^https?:\/\//.test(a.link) ? <Link href={a.link} label={a.link} /> : <Text dimColor>{a.link}</Text>)}
            {!a.isMine && (
              <Text dimColor wrap="wrap">
                {routeLine(a)}
              </Text>
            )}
            {a.pending === '' && (
              <Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
                {a.options.map((o, i) => (
                  <Button key={`${a.id}:${i}`} label={o} onPress={() => answer($, a, o)} />
                ))}
                <Button key={`${a.id}:done`} label="Done" onPress={() => done($, a)} />
              </Box>
            )}
            {a.pending === '' && (
              <Input
                key={`${a.id}:reply`}
                placeholder="Reply…"
                submitLabel="send"
                value={desk.drafts.get(a.id) ?? ''}
                onInput={v => {
                  desk.drafts.set(a.id, v)
                }}
                onSubmit={v => quiet(answer($, a, v))}
              />
            )}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SESSION }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    const a = await read($, activityAtom)
    await read($, beatAtom)
    await read($, minuteAtom)
    const links = await read($, phoneAtom)
    const note = await read($, phoneNoteAtom)
    const hub = await read($, hubAtom)
    const now = await $.clock.now()
    const usage = await $.session.usage().catch(() => undefined)
    const turn = a.turns[a.turns.length - 1]
    const isTurnRunning = turn !== undefined && turn.ms === 0
    const passed = a.tests.filter(t => t.state === 'pass').length
    const failed = a.tests.filter(t => t.state === 'fail').length
    const files = [...a.files].reverse()
    const cost = usage?.cost !== undefined ? ` · $${usage.cost.usd.toFixed(2)}` : ''
    const open = usage !== undefined ? ` · open ${dur(now - usage.startedAt)}` : ''
    const head = (t: string) => (
      <Text bold dimColor>
        {t}
      </Text>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {head('Now')}
          {a.running.length === 0 && (
            <Text dimColor>{isTurnRunning ? `Turn ${turn.n} thinking · ${dur(now - turn.startedAt)}` : 'Nothing running.'}</Text>
          )}
          {a.running.map(r => (
            <Text key={r.id} wrap="truncate-end">
              ● {r.label} <Text dimColor>{dur(now - r.startedAt)}</Text>
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          {head('Turns')}
          <Text dimColor>
            {a.turns.length} {a.turns.length === 1 ? 'turn' : 'turns'} · working {dur(workTime(a, now))}
            {open}
            {cost}
          </Text>
          {[...a.turns]
            .reverse()
            .slice(0, 5)
            .map(t => (
              <Text key={`turn${t.n}`} wrap="truncate-end">
                #{t.n} {t.ms === 0 ? `${dur(now - t.startedAt)}…` : dur(t.ms)} <Text dimColor>{t.prompt}</Text>
              </Text>
            ))}
        </Box>

        <Box flexDirection="column">
          {head('Tests')}
          {a.tests.length === 0 ? (
            <Text dimColor>No test runs yet.</Text>
          ) : (
            <Text dimColor>
              {a.tests.length} {a.tests.length === 1 ? 'run' : 'runs'} · {passed} passed · {failed} failed
            </Text>
          )}
          {[...a.tests]
            .reverse()
            .slice(0, 5)
            .map(t => (
              <Text key={t.id} wrap="truncate-end">
                {TEST_MARK[t.state]} {t.command}{' '}
                <Text dimColor>
                  {t.state === 'running' ? dur(now - t.startedAt) : `${dur(t.ms)} · ${ago(now - t.startedAt)}`}
                </Text>
              </Text>
            ))}
        </Box>

        <Box flexDirection="column">
          {head('Files')}
          {files.length === 0 ? (
            <Text dimColor>No files edited yet.</Text>
          ) : (
            <Text dimColor>{files.length} edited</Text>
          )}
          {files.slice(0, 8).map(f => (
            <Text key={f.path} wrap="truncate-start">
              {shortPath(f.path, desk.cwd)}{' '}
              <Text dimColor>
                ×{f.edits} · {ago(now - f.at)}
              </Text>
            </Text>
          ))}
          {files.length > 8 && <Text dimColor>+{files.length - 8} more</Text>}
        </Box>

        <Box flexDirection="column">
          {head('Servers')}
          {a.servers.length === 0 && <Text dimColor>No local server seen yet. /phone &lt;port&gt; sends one anyway.</Text>}
          {[...a.servers].reverse().map(s => (
            <Box key={`srv${s.port}`} flexDirection="row" gap={1} alignItems="center">
              <Text wrap="truncate-end">
                :{s.port} <Text dimColor>{s.seen}</Text>
              </Text>
              <Button key={`phone:${s.port}`} label="Send to phone" onPress={() => quiet(phone($, s.port))} />
            </Box>
          ))}
          {note !== '' && (
            <Text dimColor wrap="wrap">
              {note}
            </Text>
          )}
        </Box>

        <Box flexDirection="column">
          {head('Hub')}
          <Text dimColor wrap="wrap">
            {hub === '' ? 'Checking…' : hub}
            {links.some(l => l.localPort === HUB_PORT) ? '' : ` · /phone hub puts it on your tailnet`}
          </Text>
        </Box>

        {links.map(l => (
          <Box key={`link${l.httpsPort}`} flexDirection="column" gap={1}>
            {head(`Phone · :${l.localPort}`)}
            <Link href={l.url} label={l.url} />
            {'Svg' in els && e.surface !== 'terminal' ? (
              <els.Svg source={qrSvg(l.qr)} alt={`QR code for ${l.url}`} width={176} height={176} />
            ) : (
              <Box flexDirection="column">
                {qrText(l.qr).map((line, i) => (
                  <Text key={`qr${l.httpsPort}:${i}`} color="#ffffff" backgroundColor="#000000">
                    {line}
                  </Text>
                ))}
              </Box>
            )}
            <Text dimColor wrap="wrap">
              Checked from this Mac: {l.check} Reachable inside your tailnet only.
            </Text>
            {l.isOurs ? (
              <Button key={`off:${l.httpsPort}`} label="Stop serving" onPress={() => quiet(stopPhone($, l))} />
            ) : (
              <Text dimColor>This link was already served; the desk leaves it as it is.</Text>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
