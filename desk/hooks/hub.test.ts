import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Ask, Served } from '../types'
import { ASK, LIVE, REPLY, makeAsk } from './asks'
import type { Desk } from './asks'
import { HUB_PORT, HUB_VERSION, feedOf, forMe, isNewer, lastPath, pingVersion, sitesOf } from './hub'

const HOME = '/Users/t'
const DIR = `${HOME}/.claude/desk-hub`
const AT = { id: 'a1', sessionId: 's-me', cwd: '/Users/t/claude/allcompost', now: 1_000_000 }

test('the feed carries open asks and those closed in the last half hour, with replies, marks and what was taken', () => {
  const open = makeAsk({ title: 'Ship?', kind: 'approval' }, AT) as Ask
  const fresh = { ...(makeAsk({ title: 'Old', kind: 'review' }, { ...AT, id: 'a2' }) as Ask), state: 'replied' as const, closedAt: 5_000_000 }
  const gone = { ...(makeAsk({ title: 'Older', kind: 'review' }, { ...AT, id: 'a3' }) as Ask), state: 'done' as const, closedAt: 100 }
  const all: Desk = { asks: [open, fresh, gone], replies: new Map([['zz', { text: 'Square', at: 1, from: 'hub' }]]), live: new Map([['s-them', 9]]) }
  const feed = feedOf(all, { sid: 's-me', cwd: '/c', running: true, idleSince: 7, taken: ['r1'] }, [], 5_100_000)
  expect(feed.asks.map(a => a.id)).toEqual(['a1', 'a2'])
  expect(feed.pending).toEqual({ zz: 'Square' })
  expect(feed.live).toEqual({ 's-them': 9 })
  expect(feed.taken).toEqual(['r1'])
  expect(feed.running).toBe(true)
  expect(feed.version).toBe(HUB_VERSION)
})

test('the sites are the tailnet links this session made, never the hub itself', () => {
  const v = (localPort: number, by: string): Served => ({ httpsPort: localPort, localPort, target: '', url: `https://m.t.ts.net:${localPort}`, at: 0, by })
  expect(sitesOf([v(5173, 's-me'), v(3000, 's-them'), v(HUB_PORT, 's-me')], 's-me')).toEqual([{ port: 5173, url: 'https://m.t.ts.net:5173' }])
})

test('the inbox gives a session only what the hub handed it and it has not taken; a half-written inbox is no list', () => {
  const e = (rid: string, by: string, takenAt = 0) => ({ rid, askId: 'a1', sid: 's-me', words: 'Yes', done: false, at: 1, by, takenAt })
  const text = JSON.stringify({ v: 1, entries: [e('r1', 's-me'), e('r2', 's-them'), e('r3', 's-me', 5), e('r4', 's-me'), { junk: true }] })
  expect(forMe(text, 's-me', new Set(['r4']))?.map(x => x.rid)).toEqual(['r1'])
  expect(forMe('{"v":1,"entr', 's-me', new Set())).toBe(undefined)
})

test('versions compare by number, and only the hub answers a ping', () => {
  expect(isNewer('0.10.0', '0.9.1')).toBe(true)
  expect(isNewer('0.2.0', '0.2.0')).toBe(false)
  expect(isNewer('0.1.9', '0.2.0')).toBe(false)
  expect(pingVersion('{"name":"desk-hub","version":"0.2.0"}')).toBe('0.2.0')
  expect(pingVersion('<html>vite</html>')).toBe(undefined)
  expect(pingVersion('{"name":"other","version":"1"}')).toBe(undefined)
  expect(lastPath('Welcome to zsh\n/Users/t/.local/node/bin/node\n')).toBe('/Users/t/.local/node/bin/node')
})

/** The engine with a hub folder in memory: files, a ping that finds the hub up, one session. */
function engine(on: Parameters<TestBody>[1], sid: string, mem: Map<string, unknown>, files: Map<string, string>, sent: string[], home = HOME) {
  let t = 5_000_000
  on('store.keys', () => ({ value: [...mem.keys()] }))
  on('store.get', (_, e) => ({ value: mem.get(e.key) }))
  on('store.set', (_, e) => {
    mem.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    mem.delete(e.key)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: (t += 1000) }))
  on('clock.every', () => ({ value: undefined }))
  on('session.id', () => ({ value: sid }))
  on('session.cwd', () => ({ value: '/Users/t/claude/allcompost' }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__desk__${e.name}` } }))
  on('command.register', () => ({ value: { command: 'waiting' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' } }))
  on('ui.cancelNotify', () => ({ value: { isSent: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('process.run', (_, e) => {
    const cmd = e.argv.join(' ')
    if (cmd.includes('printf %s "$HOME"')) return { value: { exitCode: home === '' ? 1 : 0, stdout: home, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'curl') return { value: { exitCode: 0, stdout: `{"name":"desk-hub","version":"${HUB_VERSION}"}`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 1, stdout: '', stderr: 'not in this test', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.stat', (_, e) => {
    if (!files.has(e.path)) return { deny: 'ENOENT' }
    return { value: { kind: 'file', size: files.get(e.path)?.length ?? 0, mtimeMs: 42, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const v = files.get(e.path)
    if (v === undefined) return { deny: 'ENOENT' }
    return { value: v }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
}

const inbox = (...entries: object[]) => JSON.stringify({ v: 1, entries })

/** The first poll runs from the timer, beside the start's own; wait until it has written the feed. */
const later = (globalThis as unknown as { setTimeout: (run: () => void, ms: number) => void }).setTimeout
async function fed(files: Map<string, string>, sid: string) {
  for (let i = 0; i < 200 && !files.has(`${DIR}/feeds/${sid}.json`); i++) await new Promise<void>(r => later(r, 5))
  return JSON.parse(files.get(`${DIR}/feeds/${sid}.json`) ?? '{}')
}

test('an answer from the hub to this session\'s ask arrives in this chat, closes the ask, and the feed says it was taken', async ($, on) => {
  const mem = new Map<string, unknown>()
  const files = new Map<string, string>()
  const sent: string[] = []
  const mine = makeAsk({ title: 'Push desk 0.2.0?', kind: 'approval', options: ['Yes, push', 'Not yet'] }, { ...AT, id: 'ah1', now: 4_000_000 }) as Ask
  mem.set(ASK + 'ah1', mine)
  files.set(`${DIR}/inbox.json`, inbox({ rid: 'r1', askId: 'ah1', sid: 's-me', words: 'Yes, push', done: false, at: 4_500_000, by: 's-me', takenAt: 0 }))
  engine(on, 's-me', mem, files, sent)
  await $.session.start({ cwd: '/Users/t/claude/allcompost', surface: 'desktop', isInteractive: true })
  const feed = await fed(files, 's-me')

  expect(sent).toEqual(['Re: Push desk 0.2.0? (desk ask ah1)\n\nYes, push'])
  expect((mem.get(ASK + 'ah1') as Ask).state).toBe('replied')
  expect(feed.taken).toEqual(['r1'])
  expect(feed.asks.find((a: Ask) => a.id === 'ah1').state).toBe('replied')
  expect(typeof feed.at).toBe('number')
})

test('an answer the hub hands on for a closed session waits in the store for it; Done closes without a word', async ($, on) => {
  const mem = new Map<string, unknown>()
  const files = new Map<string, string>()
  const sent: string[] = []
  const theirs = makeAsk({ title: 'Which week?', kind: 'answer' }, { ...AT, id: 'zz1', sessionId: 's-gone', now: 1_000 }) as Ask
  const other = makeAsk({ title: 'Look at the grid', kind: 'review' }, { ...AT, id: 'zz2', sessionId: 's-gone', now: 2_000 }) as Ask
  mem.set(ASK + 'zz1', theirs)
  mem.set(ASK + 'zz2', other)
  mem.set(LIVE + 's-gone', 10)
  files.set(
    `${DIR}/inbox.json`,
    inbox(
      { rid: 'r1', askId: 'zz1', sid: 's-gone', words: 'week 49', done: false, at: 3, by: 's-me', takenAt: 0 },
      { rid: 'r2', askId: 'zz2', sid: 's-gone', words: '', done: true, at: 4, by: 's-me', takenAt: 0 },
      { rid: 'r3', askId: 'zz1', sid: 's-gone', words: 'not mine', done: false, at: 5, by: 's-other', takenAt: 0 },
    ),
  )
  engine(on, 's-me', mem, files, sent)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const feed = await fed(files, 's-me')

  expect(sent.length).toBe(0) // never into another session's chat
  expect(mem.get(REPLY + 'zz1')).toEqual({ text: 'week 49', at: expect.any(Number), from: 'hub' })
  expect((mem.get(ASK + 'zz2') as Ask).state).toBe('done')
  expect(feed.taken).toEqual(['r1', 'r2'])
  expect(feed.pending).toEqual({ zz1: 'week 49' })
})

test('a session with no hub folder runs the desk as before', async ($, on) => {
  const mem = new Map<string, unknown>()
  const sent: string[] = []
  const files = new Map<string, string>()
  engine(on, 's-me', mem, files, sent, '')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const made = await $.tool.call({ tool: 'mcp__desk__ask', title: 'Still works?', kind: 'answer' })
  expect(String(made.result)).toMatch(/^Registered a/)
  expect(files.size).toBe(0) // no feed written anywhere
})
