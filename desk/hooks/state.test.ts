// The hub's reading of the feeds (hub/state.mjs): which asks the page shows when sessions end,
// close asks, write a moment apart, read different stores, or carry a stamp from a clock since set back.

import { expect, test } from 'claude-code/testing'

import type { Ask } from '../types'
import { FEED_MS, FEED_RECENT_MS } from './hub'
// @ts-ignore: state.mjs is the hub's plain JavaScript, run by node, with no types of its own
import * as hub from '../hub/state.mjs'

type Page = {
  reading: boolean
  sessions: { sid: string; state: string; closedSince: number; folder: string; asks: { id: string; state: string; pending: string }[] }[]
}
type HubFeed = { sid: string; at: number; store: string }

const AHEAD_MS: number = hub.AHEAD_MS
const CURRENT_MS: number = hub.CURRENT_MS
const FRESH_MS: number = hub.FRESH_MS
const RECENT_MS: number = hub.RECENT_MS
const cleanFeed: (v: unknown) => HubFeed = hub.cleanFeed
const stateOf: (input: { feeds: HubFeed[]; inbox: object[]; now: number; home: string; version: string }) => Page = hub.stateOf
const canAnswer: (state: Page, inbox: object[], askId: string) => { sid?: string; error?: string } = hub.canAnswer

const HOME = '/Users/t'
/** A fixed moment near the real clock: every time below is counted from it. */
const T = 1_795_800_000_000
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
/** The store the feeds below name, unless they say otherwise. */
const STORE = 'st-one'

const ask = (id: string, sessionId: string, over: Partial<Ask> = {}): Ask => ({
  id,
  sessionId,
  where: 'the desk',
  cwd: `${HOME}/work`,
  title: `Ask ${id}?`,
  detail: '',
  kind: 'approval',
  options: ['Yes', 'No'],
  link: '',
  askedAt: T - 2 * HOUR,
  state: 'open',
  reply: '',
  closedAt: 0,
  ...over,
})

/** A feed as the hub holds it: through cleanFeed, as server.mjs reads a feed file. */
const feed = (sid: string, at: number, asks: Ask[] = [], over: Record<string, unknown> = {}): HubFeed =>
  cleanFeed({ v: 1, sid, version: '0.2.2', store: STORE, cwd: `${HOME}/work`, running: false, idleSince: at - MIN, asks, pending: {}, live: {}, sites: [], taken: [], at, ...over })

/** The same from a session on 0.2.0, which names no store. */
const unnamed = (sid: string, at: number, asks: Ask[] = [], over: Record<string, unknown> = {}): HubFeed =>
  feed(sid, at, asks, { version: '0.2.0', store: undefined, ...over })

const view = (feeds: HubFeed[], now: number, inbox: object[] = []): Page => stateOf({ feeds, inbox, now, home: HOME, version: 'test' })

/** The asks on the page and how each stands, by id. */
const shown = (st: Page): Record<string, string> => Object.fromEntries(st.sessions.flatMap(s => s.asks.map(a => [a.id, a.state] as const)))

// ── one store ───────────────────────────────────────────────────────────────────────────────

test('one store: an ask held only by the feed of a session that ended is not shown once a current feed of that store lacks it', () => {
  const left = feed('s-ended', T - 6 * HOUR, [ask('x', 's-asker')])
  const open = feed('s-open', T, [ask('w', 's-open')])
  for (const feeds of [[left, open], [open, left]]) {
    const st = view(feeds, T + SEC)
    expect(shown(st)).toEqual({ w: 'open' })
    expect(st.sessions.some(s => s.sid === 's-asker')).toBe(false)
    expect(canAnswer(st, [], 'x')).toEqual({ error: 'The hub does not know that ask.' })
  }
  // and with a current feed that holds no ask at all
  expect(shown(view([left, feed('s-open', T)], T + SEC))).toEqual({})
})

test('the cost of the rule: an ask only an ended session\'s feed holds is not shown when a current feed of its store lacks it, were it open in truth', () => {
  // The hub believes a current feed's silence, and cannot tell an ask the store let go from one that
  // feed did not read. So if a current feed's reading is wrong, or behind by more than the slack (a
  // write the store dropped, a session that reads late), an ask that is open in truth leaves the page
  // until a current feed of its store holds it. This is what the rule costs, pinned here on purpose.
  const asker = feed('s-asker', T - CURRENT_MS - SEC, [ask('x', 's-asker', { askedAt: T - 5 * MIN })])
  const behind = feed('s-open', T, [ask('w', 's-open')])
  expect(shown(view([asker, behind], T + SEC))).toEqual({ w: 'open' })
  // it is back as soon as a current feed holds it
  expect(shown(view([asker, feed('s-open', T + 2 * SEC, [ask('w', 's-open'), ask('x', 's-asker')])], T + 3 * SEC))).toEqual({ w: 'open', x: 'open' })
})

test('with every session closed, the newest feed is still believed, however old it is', () => {
  // Right as a rule, and the page can be behind the store here: no session has written since, so
  // what was closed or asked after that last feed is not on the page until one writes again.
  const older = feed('s-one', T - 3 * 24 * HOUR, [ask('y', 's-two')])
  const newest = feed('s-two', T - 2 * 24 * HOUR, [ask('y', 's-two'), ask('v', 's-two', { askedAt: T - 50 * HOUR })])
  const st = view([older, newest], T)
  expect(shown(st)).toEqual({ y: 'open', v: 'open' })
  expect(st.reading).toBe(false)
  expect(st.sessions.find(s => s.sid === 's-two')?.state).toBe('closed')
})

test('of two old feeds with no fresh one, the newer is believed and what only the older holds is not shown', () => {
  // The same holds here: the newer feed is the last reading there is, not the store as it stands now.
  const older = feed('s-one', T - 5 * HOUR, [ask('x', 's-one')])
  const newer = feed('s-two', T - 2 * HOUR, [ask('y', 's-two')])
  expect(shown(view([older, newer], T))).toEqual({ y: 'open' })
  expect(shown(view([newer, older], T))).toEqual({ y: 'open' })
})

test('a new ask shows while another open session\'s feed is a moment behind or ahead, whichever wrote last', () => {
  const x = ask('x', 's-a', { askedAt: T - SEC })
  const now = T + 3 * SEC
  // the asker wrote last: the other session's feed is two seconds older and has not read the ask yet
  expect(shown(view([feed('s-a', T, [x]), feed('s-b', T - 2 * SEC)], now))).toEqual({ x: 'open' })
  // the other session wrote last, from a read of the store made before the ask was there
  expect(shown(view([feed('s-a', T, [x]), feed('s-b', T + 2 * SEC)], now))).toEqual({ x: 'open' })
  // the same with a third session, and with the feeds in any order
  const three = [feed('s-c', T + SEC, [ask('w', 's-c')]), feed('s-b', T + 2 * SEC), feed('s-a', T, [x])]
  expect(shown(view(three, now))).toEqual({ w: 'open', x: 'open' })
  expect(shown(view([...three].reverse(), now))).toEqual({ w: 'open', x: 'open' })
  // right up to the slack: the asker's feed is the oldest that still counts
  expect(shown(view([feed('s-a', T, [x]), feed('s-b', T + CURRENT_MS - 1)], T + CURRENT_MS))).toEqual({ x: 'open' })
})

test('the slack is two fresh spans, counted from the newest feed of the store and not from the clock', () => {
  expect(CURRENT_MS).toBe(2 * FRESH_MS)
  const x = ask('x', 's-a')
  // one millisecond inside, shown; at the slack, not: and the same a week later, when all are old
  for (const now of [T + CURRENT_MS, T + 7 * 24 * HOUR]) {
    expect(shown(view([feed('s-a', T, [x]), feed('s-b', T + CURRENT_MS - 1)], now))).toEqual({ x: 'open' })
    expect(shown(view([feed('s-a', T, [x]), feed('s-b', T + CURRENT_MS)], now))).toEqual({})
  }
})

test('the slack covers several of a session\'s feed beats and stays well under the time a closed ask rides in live feeds', () => {
  // an open session must stay current through a few missed beats
  expect(CURRENT_MS).toBeGreaterThanOrEqual(3 * FEED_MS)
  // a feed within the slack of the newest must have been written after any ask live feeds let go was closed
  expect(CURRENT_MS * 10).toBeLessThanOrEqual(FEED_RECENT_MS)
})

test('an ask the newest feed holds as closed in the last quarter hour still shows, folded as recent', () => {
  const now = T + SEC
  const was = ask('z', 's-a')
  const done = ask('z', 's-a', { state: 'done', closedAt: now - 5 * MIN })
  const replied = ask('r', 's-a', { state: 'replied', reply: 'Yes', closedAt: now - RECENT_MS + SEC })
  const long = ask('l', 's-a', { state: 'done', closedAt: now - RECENT_MS })
  const st = view([feed('s-ended', T - 6 * HOUR, [was]), feed('s-a', T, [done, replied, long])], now)
  expect(shown(st)).toEqual({ z: 'done', r: 'replied' })
  // the same when the feed that still says open is current too: the newer one says how it stands
  expect(shown(view([feed('s-b', T - 5 * SEC, [was]), feed('s-a', T, [done])], now))).toEqual({ z: 'done' })
  expect(canAnswer(st, [], 'z')).toEqual({ error: 'That ask is closed already.' })
})

test('with one session only, its feed is the newest and all its asks show, open ones first', () => {
  const now = T + 2 * SEC
  const asks = [
    ask('c', 's-a', { state: 'replied', reply: 'No', closedAt: now - MIN, askedAt: T - 3 * HOUR }),
    ask('b', 's-a', { askedAt: T - HOUR }),
    ask('a', 's-a', { askedAt: T - 2 * HOUR }),
    ask('o', 's-other', { askedAt: T - 4 * HOUR }),
  ]
  const st = view([feed('s-a', T, asks, { pending: { o: 'Square' } })], now)
  expect(st.sessions.map(s => [s.sid, s.state, s.asks.map(a => a.id)])).toEqual([
    ['s-other', 'closed', ['o']],
    ['s-a', 'held', ['a', 'b', 'c']],
  ])
  expect(st.sessions[0]?.asks[0]?.pending).toBe('Square')
  expect(st.reading).toBe(true)
  // and the same hours after it closed: the last reading there is
  expect(shown(view([feed('s-a', T, asks)], T + 9 * HOUR))).toEqual({ o: 'open', a: 'open', b: 'open' })
})

test('a session that ended keeps its card while an open session still holds its ask: closed since its own last feed, in its own folder', () => {
  const q = ask('q', 's-ended')
  const p = ask('p', 's-gone', { askedAt: T - 40 * HOUR })
  // its feed is not believed for asks any more, and still says when it last wrote, where it worked,
  // and the mark of a session the store has since forgotten
  const left = feed('s-ended', T - 6 * HOUR, [q, ask('x', 's-ended')], { cwd: `${HOME}/claude/desk`, live: { 's-gone': T - 30 * HOUR } })
  const open = feed('s-open', T, [q, p], { live: { 's-ended': T - 6 * HOUR - 20 * SEC } })
  const st = view([left, open], T + SEC)
  expect(st.sessions.map(s => [s.sid, s.state, s.closedSince, s.folder, s.asks.map(a => a.id)])).toEqual([
    ['s-gone', 'closed', T - 30 * HOUR, '~/work', ['p']],
    ['s-ended', 'closed', T - 6 * HOUR, '~/claude/desk', ['q']],
  ])
  expect(canAnswer(st, [], 'q')).toEqual({ sid: 's-ended' })
})

// ── two stores, and feeds that name none ────────────────────────────────────────────────────

test('a feed keeps the name of its store: a string, clipped, and empty when it gives none', () => {
  expect(cleanFeed({ sid: 's', at: 1, store: 'st-x' }).store).toBe('st-x')
  expect(cleanFeed({ sid: 's', at: 1 }).store).toBe('')
  expect(cleanFeed({ sid: 's', at: 1, store: 7 }).store).toBe('')
  expect(cleanFeed({ sid: 's', at: 1, store: 'x'.repeat(200) }).store).toBe('x'.repeat(80))
})

test('two stores: the ask of a store whose sessions have all ended is shown while a session of another store writes', () => {
  const ended = feed('s-dev', T - 6 * HOUR, [ask('x', 's-dev')], { store: 'st-dev' })
  const open = feed('s-open', T, [ask('w', 's-open')])
  for (const feeds of [[ended, open], [open, ended]]) {
    const st = view(feeds, T + SEC)
    expect(shown(st)).toEqual({ x: 'open', w: 'open' })
    expect(canAnswer(st, [], 'x')).toEqual({ sid: 's-dev' })
  }
  // and days on, the other store's sessions writing all the while
  const later = T + 3 * 24 * HOUR
  expect(shown(view([ended, feed('s-open', later), feed('s-also', later - 9 * SEC)], later + SEC))).toEqual({ x: 'open' })
  // within its own store the rule is the same: a newer feed of that store that lacks the ask ends it
  expect(shown(view([ended, open, feed('s-dev-2', T - HOUR, [], { store: 'st-dev' })], T + SEC))).toEqual({ w: 'open' })
})

test('feeds that name no store: an ended one\'s ask goes once any feed is current and lacks it, and a current one never makes a named feed old', () => {
  // a file left by a session on 0.2.0 is judged as the first build of this fix judged every feed: against the newest of all
  const left = unnamed('s-old', T - 6 * HOUR, [ask('x', 's-old')])
  expect(shown(view([left, unnamed('s-open', T)], T + SEC))).toEqual({})
  expect(shown(view([left, feed('s-open', T)], T + SEC))).toEqual({})
  expect(shown(view([left], T + SEC))).toEqual({ x: 'open' })
  // a session still on 0.2.0 writes on; the named feed of a session that ended stays believed in its own store.
  // The ask it shows open may have been closed over half an hour before, by a session on 0.2.0 whose feed
  // has since let it go: the README's mixed-versions limit, until every open session names its store.
  const named = feed('s-new', T - 6 * HOUR, [ask('n', 's-new')])
  expect(shown(view([named, unnamed('s-open', T, [ask('u', 's-open')])], T + SEC))).toEqual({ n: 'open', u: 'open' })
  // where both hold an ask, the newer says how it stands
  const closed = ask('n', 's-new', { state: 'done', closedAt: T - MIN })
  expect(shown(view([named, unnamed('s-open', T, [closed])], T + SEC))).toEqual({ n: 'done' })
  // and a named feed of the same store does make it old
  expect(shown(view([named, unnamed('s-open', T), feed('s-other', T - SEC)], T + SEC))).toEqual({})
})

// ── stamps from a clock since set back ──────────────────────────────────────────────────────
//
// A stamp ahead of the hub's clock was written before the clock went back. Its file may be that of a
// session still open: one on this version writes again at its next poll, and until then, or on 0.2.0
// until the clock has caught up with its last stamp, its file is the one stamped ahead. So such a file
// is believed too, and each side of the clock, ahead and not, is judged by its own newest.

test('an open session\'s file stamped ahead, not written since the clock went back, keeps its asks on the page beside a file of its store that is not ahead', () => {
  for (const make of [feed, unnamed]) {
    // the clock went back two minutes: one session has not written since (its next poll has not come, or it is on
    // 0.2.0 with nothing new to say), the other wrote a second ago
    const quiet = make('s-quiet', T + 2 * MIN, [ask('q', 's-quiet'), ask('both', 's-busy')])
    const busy = make('s-busy', T - SEC, [ask('both', 's-busy'), ask('new', 's-busy', { askedAt: T - 5 * SEC })])
    for (const feeds of [[quiet, busy], [busy, quiet]]) expect(shown(view(feeds, T))).toEqual({ q: 'open', both: 'open', new: 'open' })
    // Beside the old file of a session that ended, with no session having written since the clock went back: the quiet
    // one stays, and the old file is believed as well, being the newest that is not ahead. The hub cannot tell it
    // from the honest last feed of the next test. It is out again as soon as an open session writes.
    const left = make('s-ended', T - 6 * HOUR, [ask('gone', 's-ended')])
    expect(shown(view([left, quiet], T))).toEqual({ q: 'open', both: 'open', gone: 'open' })
    expect(shown(view([left, quiet, busy], T))).toEqual({ q: 'open', both: 'open', new: 'open' })
    // The other half. At its next poll the quiet session, its clock behind its last stamp, writes its file again
    // (hub.test.ts). The file is then not ahead, and the newest of its side: the old file is hours behind it,
    // outranked, and its ask is gone.
    const again = make('s-quiet', T + 2 * SEC, [ask('q', 's-quiet'), ask('both', 's-busy')])
    for (const feeds of [[left, again], [again, left]]) expect(shown(view(feeds, T + 2 * SEC))).toEqual({ q: 'open', both: 'open' })
  }
})

test('the clock set back, then every session closed: the last honest feed is believed, being the newest that is not ahead', () => {
  const x = ask('x', 's-c')
  const y = ask('y', 's-c', { askedAt: T - 3 * MIN })
  for (const make of [feed, unnamed]) {
    const feeds = [make('s-a', T + HOUR, [ask('g', 's-a')]), make('s-b', T + HOUR - 20 * SEC), make('s-c', T, [x, y])]
    // Two minutes after its write, and twenty. The first build's cap read the two ahead as written now, and the
    // honest one fell out of the slack. The two ahead are believed too, so what only they hold shows as well.
    for (const since of [2 * MIN, 20 * MIN]) {
      expect(shown(view(feeds, T + since))).toEqual({ x: 'open', y: 'open', g: 'open' })
      expect(shown(view([...feeds].reverse(), T + since))).toEqual({ x: 'open', y: 'open', g: 'open' })
    }
  }
})

test('where a file stamped ahead and one that is not both hold an ask, the one that is not ahead says how it stands', () => {
  // the quiet session's file still has the ask open; the other wrote after the clock went back, and after the ask closed
  const closed = ask('z', 's-busy', { state: 'done', closedAt: T - MIN })
  const stale = feed('s-quiet', T + HOUR, [ask('z', 's-busy'), ask('q', 's-quiet')])
  const fresh = feed('s-busy', T, [closed])
  for (const feeds of [[stale, fresh], [fresh, stale]]) expect(shown(view(feeds, T + SEC))).toEqual({ z: 'done', q: 'open' })
  // whatever stores the two name, or none
  expect(shown(view([feed('s-quiet', T + HOUR, [ask('z', 's-busy')], { store: 'st-other' }), unnamed('s-busy', T, [closed])], T + SEC))).toEqual({ z: 'done' })
  expect(shown(view([unnamed('s-quiet', T + HOUR, [ask('z', 's-busy')]), fresh], T + SEC))).toEqual({ z: 'done' })
})

test('a file stamped ahead that is a minute or more behind the newest ahead file of its store is not believed', () => {
  const g = ask('g', 's-ended')
  const quiet = feed('s-quiet', T + HOUR, [ask('q', 's-quiet')])
  const busy = feed('s-busy', T, [ask('w', 's-busy')])
  expect(shown(view([feed('s-ended', T + HOUR - CURRENT_MS, [g]), quiet, busy], T + SEC))).toEqual({ q: 'open', w: 'open' })
  // one millisecond nearer, it counts; and in another store it is judged by that store's own files
  expect(shown(view([feed('s-ended', T + HOUR - CURRENT_MS + 1, [g]), quiet, busy], T + SEC))).toEqual({ g: 'open', q: 'open', w: 'open' })
  expect(shown(view([feed('s-ended', T + HOUR - CURRENT_MS, [g], { store: 'st-dev' }), quiet, busy], T + SEC))).toEqual({ g: 'open', q: 'open', w: 'open' })
  // a file that names no store is counted against every ahead file
  expect(shown(view([unnamed('s-ended', T + HOUR - CURRENT_MS, [g]), quiet, busy], T + SEC))).toEqual({ q: 'open', w: 'open' })
})

test('the limit, pinned: once the clock has passed the stamp of a file written before it went back, with every session closed, the honest last feed is outranked and its asks leave the page', () => {
  // Stamps are all the hub has. A file written before the clock went back an hour carries a stamp an hour on.
  // The last session wrote after, by the clock as it now stands, and closed. While that stamp is ahead, both are
  // believed. Once the clock has passed it, it is a stamp like any other, and the newer of the two: the honest
  // last feed is an hour behind it and no longer current, until a session opens and writes. This is a limit of the
  // rule (README, limits), pinned here on purpose.
  const before = feed('s-a', T + HOUR, [ask('g', 's-a')])
  const last = feed('s-c', T, [ask('x', 's-c')])
  expect(shown(view([before, last], T + 59 * MIN))).toEqual({ g: 'open', x: 'open' })
  expect(shown(view([before, last], T + HOUR + 10 * SEC))).toEqual({ g: 'open' })
  // a session opens and writes: the page is right again
  const opened = feed('s-d', T + HOUR + 2 * MIN, [ask('x', 's-c')])
  expect(shown(view([before, last, opened], T + HOUR + 2 * MIN + SEC))).toEqual({ x: 'open' })
})

test('only feeds stamped ahead: the newest by its raw stamp is believed, and what only an older one holds is not shown', () => {
  const older = feed('s-a', T + HOUR, [ask('x', 's-a'), ask('z', 's-a')])
  const newer = feed('s-b', T + HOUR + 5 * MIN, [ask('y', 's-b')])
  expect(shown(view([older, newer], T))).toEqual({ y: 'open' })
  expect(shown(view([newer, older], T))).toEqual({ y: 'open' })
  // two within the slack of each other both count, and the newer says how an ask stands
  const near = feed('s-b', T + HOUR + 20 * SEC, [ask('y', 's-b'), ask('z', 's-a', { state: 'done', closedAt: T - MIN })])
  expect(shown(view([older, near], T))).toEqual({ x: 'open', y: 'open', z: 'done' })
  // the newest of a store is always believed, whatever its stamp: here one no clock gives
  expect(shown(view([feed('s-a', Number.POSITIVE_INFINITY, [ask('x', 's-a')])], T))).toEqual({ x: 'open' })
})

test('a feed two seconds ahead of the clock is read as written now: it is current and makes nothing else old', () => {
  const little = feed('s-a', T + 2 * SEC, [ask('x', 's-a')])
  // 59 seconds before the clock: by the raw stamps, 61 behind the other
  const other = feed('s-b', T - CURRENT_MS + SEC, [ask('y', 's-b')])
  expect(shown(view([little, other], T))).toEqual({ x: 'open', y: 'open' })
  expect(shown(view([other, little], T))).toEqual({ x: 'open', y: 'open' })
  // and it counts as the newest that is not ahead: beside it, the old file of a session that ended is out.
  // Without the allowance an open session a moment ahead would leave that file its side's newest, and believed.
  expect(shown(view([little, feed('s-ended', T - 6 * HOUR, [ask('g', 's-ended')])], T))).toEqual({ x: 'open' })
  // at the allowance a stamp is still read as now, and a file two minutes behind it is old; one millisecond
  // past, it is ahead, on a side of its own, and the other file is its own side's newest
  const edge = (by: number) => shown(view([feed('s-a', T + by, [ask('x', 's-a')]), feed('s-b', T - 2 * CURRENT_MS, [ask('y', 's-b')])], T))
  expect(edge(AHEAD_MS)).toEqual({ x: 'open' })
  expect(edge(AHEAD_MS + 1)).toEqual({ x: 'open', y: 'open' })
})

// ── the file that brought asks back on 27 Nov 2026, in its shapes ───────────────────────────
//
// The feed a session on 0.2.0 left when it ended, with the fields, counts and lengths of the real
// file: three open decisions another session asked, thirteen marks, nothing pending, served or taken.
// Every id, title, detail, folder and link here is made up.

/** Made-up words, n characters of them. */
const words = (n: number, w = 'lorem ipsum dolor sit amet ') => w.repeat(Math.ceil(n / w.length)).slice(0, n)
const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`

const ENDED = uuid(1)
const ASKER = uuid(2)
const WROTE = T
const CLOSED = WROTE + 7 * HOUR + 10 * MIN
const GHOSTS = ['aghost01', 'aghost02', 'aghost03']

const decision = (id: string, options: string[], lens: [number, number], over: Partial<Ask> = {}): Ask => ({
  id,
  sessionId: ASKER,
  where: words(16),
  cwd: `${HOME}/${words(16, 'folder')}`,
  title: words(lens[0]),
  detail: words(lens[1]),
  kind: 'decision',
  options,
  link: `${HOME}/${words(59 - HOME.length - 1, 'page')}`,
  askedAt: WROTE - 43 * MIN,
  state: 'open',
  reply: '',
  closedAt: 0,
  ...over,
})

const threeOpen = [
  decision('aghost01', [words(21), words(20), 'Not yet'], [49, 437]),
  decision('aghost02', [words(37), words(44), 'Not yet'], [58, 412]),
  decision('aghost03', [words(17), words(23)], [64, 334]),
]

const marks = (count: number, at: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [uuid(i + 1), at - (i % 2) * 17 * HOUR - i * SEC]))

const leftBehind = unnamed(ENDED, WROTE, threeOpen, {
  cwd: `${HOME}/${words(171 - HOME.length - 1, 'deep/')}`,
  idleSince: WROTE - 5 * MIN,
  live: marks(13, WROTE),
})

/** The feed of a session still open, in the shapes of one read the next day: nine marks, eleven answers taken. */
const openFeed = (make: typeof feed, sid: string, at: number, asks: Ask[]) =>
  make(sid, at, asks, { idleSince: at - 4 * MIN, live: marks(9, at), taken: Array.from({ length: 11 }, (_, i) => `rmade${i}`) })

const answered = threeOpen.map((a, i): Ask => ({ ...a, state: 'replied', reply: a.options[0] ?? '', closedAt: CLOSED + i * MIN }))

test('the three asks of the feed left behind on 27 Nov stay closed: recent while live feeds hold them, then gone, and never open again', () => {
  // with the open sessions still on 0.2.0, as they were that day, and after they restart on this version
  for (const make of [unnamed, feed]) {
    // five minutes after the answers: the asker's feed holds them as replied, and that is how they stand
    let at = CLOSED + 7 * MIN
    expect(shown(view([leftBehind, openFeed(make, ASKER, at, answered)], at + SEC))).toEqual(Object.fromEntries(GHOSTS.map(id => [id, 'replied'])))
    // twenty minutes after: still in the live feed, past the page's quarter hour
    at = CLOSED + 22 * MIN
    expect(shown(view([leftBehind, openFeed(make, ASKER, at, answered)], at + SEC))).toEqual({})
    // past the half hour, live feeds carry them no longer, and the old file is the only one that names them
    at = CLOSED + 33 * MIN
    const other = decision('astill01', [words(20), words(23), 'Not yet'], [61, 767], { link: '', state: 'replied', reply: words(20), closedAt: at - 3 * MIN })
    const st = view([leftBehind, openFeed(make, ASKER, at, [other]), openFeed(make, uuid(3), at - 4 * SEC, [other])], at + SEC)
    expect(shown(st)).toEqual({ astill01: 'replied' })
    for (const id of GHOSTS) expect(canAnswer(st, [], id)).toEqual({ error: 'The hub does not know that ask.' })
    // and the next morning, with every session closed since the evening
    expect(shown(view([leftBehind, openFeed(make, ASKER, at, [other])], at + 12 * HOUR))).toEqual({})
  }
})
