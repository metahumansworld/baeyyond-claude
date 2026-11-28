import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Ask } from '../types'
import { ASK, LIVE, REPLY, ago, contextBlock, makeAsk, replyText, sameAsk, staleKeys, viewOf } from './asks'
import { GUIDE } from './register'

const AT = { id: 'a1', sessionId: 's-me', cwd: '/Users/x/claude/allcompost', now: 1_000_000 }

const WAITING = {
  plugin: 'desk',
  component: 'Pane',
  requestId: 'waiting',
  props: {
    title: 'Waiting on you',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

/** The engine beneath the mod, as a test stands it up: an in-memory store, a clock, one session. */
function engine(on: Parameters<TestBody>[1], sid: string, mem: Map<string, unknown>, sent: string[], contexts: string[] = []) {
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
  on('session.cwd', () => ({ value: '/Users/x/claude/allcompost' }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__desk__${e.name}` } }))
  on('command.register', () => ({ value: { command: 'waiting' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' } }))
  on('ui.cancelNotify', () => ({ value: { isSent: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    contexts.push(...(e.context ?? []))
    return { text: e.text }
  })
}

test('an ask is made from the model input, with buttons by kind', () => {
  const a = makeAsk({ title: '  Push 0.5.0?  ', kind: 'approval' }, AT)
  if ('error' in a) throw new Error(a.error)
  expect(a.title).toBe('Push 0.5.0?')
  expect(a.options).toEqual(['Yes', 'No'])
  expect(a.where).toBe('allcompost')
  expect(a.state).toBe('open')

  const b = makeAsk({ title: 'Which name?', kind: 'decision', options: ['A', 'B', 'C', 'D', 'E'], topic: 'naming' }, AT)
  if ('error' in b) throw new Error(b.error)
  expect(b.options).toEqual(['A', 'B', 'C', 'D'])
  expect(b.where).toBe('naming')

  const c = makeAsk({ title: 'x', kind: 'nonsense' }, AT)
  expect('error' in c ? '' : c.kind).toBe('answer')
  expect('error' in makeAsk({ kind: 'review' }, AT)).toBe(true)
})

test('the same open title from the same session is a repeat; another session or a closed one is not', () => {
  const a = makeAsk({ title: 'Push?', kind: 'approval' }, AT) as Ask
  expect(sameAsk([a], 's-me', ' push? ')?.id).toBe('a1')
  expect(sameAsk([a], 's-other', 'Push?')).toBe(undefined)
  expect(sameAsk([{ ...a, state: 'done' }], 's-me', 'Push?')).toBe(undefined)
})

test('the list puts this session first, each group oldest first, and knows a closed asker', () => {
  const base = makeAsk({ title: 'x', kind: 'answer' }, AT) as Ask
  const asks: Ask[] = [
    { ...base, id: 'o-new', sessionId: 's-o', askedAt: 30 },
    { ...base, id: 'm-new', sessionId: 's-me', askedAt: 20 },
    { ...base, id: 'o-old', sessionId: 's-gone', askedAt: 10 },
    { ...base, id: 'm-old', sessionId: 's-me', askedAt: 5 },
    { ...base, id: 'shut', sessionId: 's-me', askedAt: 1, state: 'replied' },
  ]
  const now = 200_000
  const view = viewOf(asks, 's-me', new Map([['s-o', now - 1000], ['s-gone', now - 600_000]]), new Map([['o-new', 'yes']]), now)
  expect(view.map(v => v.id)).toEqual(['m-old', 'm-new', 'o-old', 'o-new'])
  expect(view.find(v => v.id === 'o-old')?.isLive).toBe(false)
  expect(view.find(v => v.id === 'o-new')?.isLive).toBe(true)
  expect(view.find(v => v.id === 'o-new')?.pending).toBe('yes')
})

test('the prompt carries only this session\'s open asks', () => {
  const a = makeAsk({ title: 'Push?', kind: 'approval' }, AT) as Ask
  expect(contextBlock([a, { ...a, id: 'b', sessionId: 's-o' }], 's-me', AT.now + 240_000)).toContain('- a1 [approval] Push? (open 4m)')
  expect(contextBlock([{ ...a, state: 'done' }], 's-me', AT.now)).toBe(undefined)
  expect(replyText(a, 'Yes')).toBe('Re: Push? (desk ask a1)\n\nYes')
  expect(ago(59_000)).toBe('now')
  expect(ago(3 * 3600_000)).toBe('3h')
  expect(ago(72 * 3600_000)).toBe('3d')
})

test('tidying drops day-old closed asks, gone sessions\' marks and orphan replies, never an open ask', () => {
  const a = makeAsk({ title: 'x', kind: 'answer' }, AT) as Ask
  const now = 100 * 3600_000
  const keys = staleKeys(
    {
      asks: [{ ...a, id: 'old', state: 'done', closedAt: 1 }, { ...a, id: 'open', askedAt: 1 }, { ...a, id: 'fresh', state: 'done', closedAt: now - 10 }],
      replies: new Map([['gone', { text: 't', at: 1, from: 's' }], ['open', { text: 't', at: 1, from: 's' }]]),
      live: new Map([['s-old', 1], ['s-new', now]]),
      store: 'st-1',
    },
    now,
  )
  expect(keys.sort()).toEqual([ASK + 'old', LIVE + 's-old', REPLY + 'gone'].sort())
})

test('the standing instruction names the three tools and is the same text every time', () => {
  expect(GUIDE).toContain('mcp__desk__ask')
  expect(GUIDE).toContain('mcp__desk__list')
  expect(GUIDE).toContain('mcp__desk__resolve')
  expect(GUIDE).not.toMatch(/\d{4}-\d{2}-\d{2}/)
})

test('the model asks, the pane shows it, a button answers it into this chat and closes it', async ($, on) => {
  const mem = new Map<string, unknown>()
  const sent: string[] = []
  engine(on, 's-me', mem, sent)
  await $.session.start({ cwd: '/Users/x/claude/allcompost', surface: 'desktop', isInteractive: true })

  const made = await $.tool.call({ tool: 'mcp__desk__ask', title: 'Push 0.5.0 to GitHub?', kind: 'approval', options: ['Yes, push', 'Not now'], detail: 'Three commits.' })
  expect(String(made.result)).toMatch(/^Registered a/)
  const again = await $.tool.call({ tool: 'mcp__desk__ask', title: 'push 0.5.0 to github?', kind: 'approval' })
  expect(String(again.result)).toMatch(/^Already open as/)
  expect([...mem.keys()].filter(k => k.startsWith(ASK)).length).toBe(1)

  const ui = await $.ui.mount({ ...WAITING, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Push 0\.5\.0/ }))?.text).toBe('Push 0.5.0 to GitHub?')
  expect((await ui.find({ type: 'Text', text: /this session/ }))?.text).toMatch(/^Approval · this session/)
  const yes = await ui.find({ type: 'Button', text: 'Yes, push' })
  expect(yes).not.toBe(undefined)
  await ui.press({ key: yes?.key ?? '' })

  expect(sent.length).toBe(1)
  expect(sent[0]).toMatch(/^Re: Push 0\.5\.0 to GitHub\? \(desk ask a[0-9a-z]+\)\n\nYes, push$/)
  const stored = [...mem.entries()].find(([k]) => k.startsWith(ASK))?.[1] as Ask
  expect(stored.state).toBe('replied')
  expect(stored.reply).toBe('Yes, push')
  expect((await ui.find({ type: 'Text', text: /Nothing is waiting/ }))?.text).toBe('Nothing is waiting on you.')
  await ui.unmount()
})

test('another session\'s ask: the answer is left for it, and the asker takes it on its next poll', async ($, on) => {
  const mem = new Map<string, unknown>()
  const sent: string[] = []
  const theirs = makeAsk({ title: 'Which logo?', kind: 'decision', options: ['Round', 'Square'], topic: 'baeyyond site' }, { ...AT, id: 'zz1', sessionId: 's-them', now: 4_000_000 }) as Ask
  mem.set(ASK + 'zz1', theirs)
  mem.set(LIVE + 's-them', 4_990_000)
  engine(on, 's-me', mem, sent)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...WAITING, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /goes to the session/ }))?.text).toBe('Your answer goes to the session working on baeyyond site.')
  await ui.press({ key: (await ui.find({ type: 'Button', text: 'Square' }))?.key ?? '' })

  expect(sent.length).toBe(0) // this session never writes into another's chat
  expect(mem.get(REPLY + 'zz1')).toEqual({ text: 'Square', at: expect.any(Number), from: 's-me' })
  expect((await ui.find({ type: 'Text', text: /^Sent:/ }))?.text).toMatch(/^Sent: "Square"/)
  await ui.unmount()
})

test('the asking session delivers a reply left for it, once', async ($, on) => {
  const mem = new Map<string, unknown>()
  const sent: string[] = []
  const mine = makeAsk({ title: 'Which logo?', kind: 'decision' }, { ...AT, id: 'zz2', sessionId: 's-them', now: 4_000_000 }) as Ask
  mem.set(ASK + 'zz2', mine)
  mem.set(REPLY + 'zz2', { text: 'Round', at: 4_100_000, from: 's-me' })
  engine(on, 's-them', mem, sent)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'waiting' } as never)

  expect(sent).toEqual(['Re: Which logo? (desk ask zz2)\n\nRound'])
  expect(mem.has(REPLY + 'zz2')).toBe(false)
  expect((mem.get(ASK + 'zz2') as Ask).state).toBe('replied')
})

test('Done closes an ask without a word to the session; resolve closes only this session\'s own', async ($, on) => {
  const mem = new Map<string, unknown>()
  const sent: string[] = []
  const theirs = makeAsk({ title: 'Theirs', kind: 'review' }, { ...AT, id: 'th1', sessionId: 's-them' }) as Ask
  mem.set(ASK + 'th1', theirs)
  engine(on, 's-me', mem, sent)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__desk__ask', title: 'Look at the page', kind: 'review' })
  const id = [...mem.keys()].find(k => k.startsWith(ASK) && k !== ASK + 'th1')?.slice(ASK.length) ?? ''

  expect(String((await $.tool.call({ tool: 'mcp__desk__resolve', id: 'th1' })).result)).toMatch(/another session/)
  expect(String((await $.tool.call({ tool: 'mcp__desk__list' })).result)).toMatch(/Look at the page[\s\S]*1 more open from other sessions/)

  const ui = await $.ui.mount({ ...WAITING, surface: 'desktop' })
  const dones = await ui.findAll({ type: 'Button', text: 'Done' })
  expect(dones.length).toBe(2)
  await ui.press({ key: dones[0]?.key ?? '' })
  expect((mem.get(ASK + id) as Ask).state).toBe('done')
  expect(sent.length).toBe(0)

  expect(String((await $.tool.call({ tool: 'mcp__desk__resolve', id })).result)).toMatch(/already closed/)
  await ui.unmount()
})

test('the prompt carries the open asks and the system prompt gets the standing section', async ($, on) => {
  const mem = new Map<string, unknown>()
  const sent: string[] = []
  const context: string[] = []
  engine(on, 's-me', mem, sent, context)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'x', scope: 'shared' }] }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__desk__ask', title: 'Pick a port', kind: 'answer' })
  await $.prompt.submit({ text: 'hello' } as never)
  expect(context.join('\n')).toMatch(/\[answer\] Pick a port/)

  const composed = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.map(s => s.id)).toEqual(['intro', 'desk:waiting'])
})

test('the pane draws on every surface', async ($, on) => {
  const mem = new Map<string, unknown>()
  engine(on, 's-me', mem, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__desk__ask', title: 'Everywhere?', kind: 'approval' })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...WAITING, surface })
    expect((await ui.find({ type: 'Text', text: /Everywhere/ }))?.text).toBe('Everywhere?')
    expect(await ui.find({ type: 'Input' })).not.toBe(undefined)
    await ui.unmount()
  }
})
