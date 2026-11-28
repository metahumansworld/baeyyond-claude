// A one-time comparison of the hub's view (desk/hub/state.mjs) with 0.2.0. It needs the repository's
// history, so it is kept here, outside the folder that ships.
//
//   node --test checks/state-vs-0.2.0.test.mjs
//
// For feeds that are all current, of one store, none stamped ahead, the page is what 0.2.0 drew, field
// for field: nothing but the rule changed. The 0.2.0 function is read from the history with git and
// loaded in memory, and `claude plugin test` gives a test no process to ask git with; so this one runs
// under node, and is skipped where the history is not at hand. The rule itself is tested in
// desk/hooks/state.test.ts.
//
// It stands while 0.2.x keeps the page's shape; when the shape is changed on purpose, it goes.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CURRENT_MS, RECENT_MS, cleanFeed, stateOf } from '../desk/hub/state.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DESK_0_2_0 = '7d63c5593718a1c2a18ba0b941dda0f5808f9a83'
const HOME = '/Users/t'
/** A fixed moment: every time below is counted from it. */
const T = 1_795_800_000_000
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

async function stateOf020() {
  let source
  try {
    source = execFileSync('git', ['show', `${DESK_0_2_0}:desk/hub/state.mjs`], {
      cwd: HERE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // no configuration from the home folder or the system
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    })
  } catch {
    return undefined
  }
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).stateOf
}

const ask = (id, sessionId, over = {}) => ({
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

/** A feed as the hub holds it, naming the one store every feed here reads. */
const feed = (sid, at, asks = [], over = {}) =>
  cleanFeed({ v: 1, sid, version: '0.2.3', store: 'st-one', cwd: `${HOME}/work`, running: false, idleSince: at - MIN, asks, pending: {}, live: {}, sites: [], taken: [], at, ...over })

const shown = st => Object.fromEntries(st.sessions.flatMap(s => s.asks.map(a => [a.id, a.state])))

/** Numbers from 0 up to 1, the same every run. */
function dice(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Some sessions of one store, all current, with asks, replies, marks, sites and answers in every mix. */
function anyCurrent(rand) {
  const int = n => Math.floor(rand() * n)
  const pick = list => list[int(list.length)]
  const sids = ['s-a', 's-b', 's-c', 's-d', 's-e'].slice(0, 1 + int(5))
  const askers = [...sids, 's-gone']
  // the page looked at just before the newest stamp, just after, a while after, and days after
  const now = T + pick([-400, 0, 1500, 20 * SEC, 45 * SEC, 100 * SEC, 20 * MIN, 3 * HOUR, 3 * 24 * HOUR])
  const pool = Array.from({ length: int(7) }, (_, i) =>
    ask(`k${i}`, pick(askers), {
      askedAt: now - int(30 * HOUR),
      kind: pick(['review', 'decision', 'approval', 'answer', 'other']),
      where: pick(['the desk', 'a theme', '']),
      cwd: pick([`${HOME}/work`, `${HOME}/claude/desk`, '/srv/site']),
      options: pick([[], ['Yes', 'No'], ['Looks good']]),
    }),
  )
  const closed = a => ({ ...a, state: pick(['replied', 'done']), reply: pick(['', 'Yes']), closedAt: now - pick([MIN, 10 * MIN, RECENT_MS - SEC, RECENT_MS, 2 * HOUR]) })
  const feeds = sids.map((sid, i) => {
    // every feed within the slack of the newest, which is the first
    const at = i === 0 ? T : T - int(CURRENT_MS)
    const asks = pool.filter(() => rand() < 0.7).map(a => (rand() < 0.3 ? closed(a) : a))
    return feed(sid, at, asks, {
      running: rand() < 0.3,
      idleSince: pick([0, at - int(10 * MIN)]),
      cwd: pick([`${HOME}/work`, `${HOME}/claude/desk`, '']),
      pending: Object.fromEntries(asks.filter(() => rand() < 0.2).map(a => [a.id, 'On its way'])),
      live: Object.fromEntries(askers.filter(() => rand() < 0.5).map(s => [s, now - pick([5 * SEC, MIN, 100 * SEC, 24 * HOUR])])),
      sites: rand() < 0.3 ? [{ port: 5173, url: 'https://m.t.ts.net:5173' }] : [],
      taken: rand() < 0.3 ? ['r1'] : [],
    })
  })
  const inbox = Array.from({ length: int(3) }, (_, i) => ({
    rid: `r${i}`,
    askId: pick([...pool.map(a => a.id), 'zz']),
    sid: pick(askers),
    words: pick(['Yes', '']),
    done: rand() < 0.3,
    at: now - int(HOUR),
    by: pick(['', ...sids]),
    takenAt: pick([0, now - SEC]),
  }))
  // in any order: the hub reads the feed files as the folder lists them
  for (let i = feeds.length - 1; i > 0; i--) {
    const j = int(i + 1)
    ;[feeds[i], feeds[j]] = [feeds[j], feeds[i]]
  }
  return { feeds, inbox, now, home: HOME, version: 'test' }
}

test('for feeds of one store that are all current, the page is what 0.2.0 drew, field for field', async t => {
  const old = await stateOf020()
  if (old === undefined) return t.skip('the 0.2.0 source is read with git show, and the repository\'s history is not at hand')

  // the comparison can tell the two apart: 0.2.0 brought back as open what only an ended session's feed held
  const ghost = { feeds: [feed('s-ended', T - 6 * HOUR, [ask('x', 's-asker')]), feed('s-open', T)], inbox: [], now: T + SEC, home: HOME, version: 'test' }
  assert.deepEqual(shown(old(ghost)), { x: 'open' })
  assert.deepEqual(shown(stateOf(ghost)), {})

  const rand = dice(20261127)
  const seen = { rounds: 0, severalFeeds: 0, withAsks: 0, open: 0, recent: 0, pending: 0 }
  for (let i = 0; i < 500; i++) {
    const input = anyCurrent(rand)
    const drawn = stateOf(input)
    assert.deepStrictEqual(drawn, old(input), `round ${i} differs from 0.2.0`)
    const asks = drawn.sessions.flatMap(s => s.asks)
    seen.rounds++
    if (input.feeds.length > 1) seen.severalFeeds++
    if (asks.length > 0) seen.withAsks++
    seen.open += asks.filter(a => a.state === 'open').length
    seen.recent += asks.filter(a => a.state !== 'open').length
    seen.pending += asks.filter(a => a.pending !== '').length
  }
  t.diagnostic(`compared with 0.2.0: ${JSON.stringify(seen)}`)
  // the rounds were not empty pages
  assert.ok(seen.severalFeeds > 300 && seen.withAsks > 300 && seen.open > 500 && seen.recent > 50 && seen.pending > 50, JSON.stringify(seen))

  // and by hand: a moment apart either way, a closed copy beside an open one, one session, one long closed, none
  const x = ask('x', 's-a', { askedAt: T - SEC })
  const done = ask('z', 's-a', { state: 'done', closedAt: T - 5 * MIN })
  for (const feeds of [
    [feed('s-a', T, [x]), feed('s-b', T - 2 * SEC)],
    [feed('s-a', T, [x]), feed('s-b', T + 2 * SEC)],
    [feed('s-b', T - 5 * SEC, [ask('z', 's-a')]), feed('s-a', T, [done])],
    [feed('s-a', T, [x, done, ask('o', 's-other')], { pending: { o: 'Square' } })],
    [feed('s-two', T - 2 * 24 * HOUR, [ask('y', 's-two')])],
    [],
  ]) {
    const input = { feeds, inbox: [], now: T + 3 * SEC, home: HOME, version: 'test' }
    assert.deepStrictEqual(stateOf(input), old(input))
  }
})
