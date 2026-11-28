import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Ask, Served } from '../types'
import { ASK, LIVE, REPLY, STORE, makeAsk, staleKeys } from './asks'
import type { Desk } from './asks'
import { HUB_PORT, HUB_VERSION, feedOf, forMe, isNewer, keyOf, lastPath, phonePortOf, pingVersion, provenPing, sitesOf } from './hub'
import { SERVE, exposeLine, hubServeAt, rekeyed } from './phone'

const SESSION_PANE = {
  plugin: 'desk',
  component: 'Pane',
  requestId: 'session',
  props: { title: 'This session', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const HOME = '/Users/t'
const DIR = `${HOME}/.claude/desk-hub`
const AT = { id: 'a1', sessionId: 's-me', cwd: '/Users/t/claude/allcompost', now: 1_000_000 }

test('the feed carries open asks and those closed in the last half hour, with replies, marks and what was taken', () => {
  const open = makeAsk({ title: 'Ship?', kind: 'approval' }, AT) as Ask
  const fresh = { ...(makeAsk({ title: 'Old', kind: 'review' }, { ...AT, id: 'a2' }) as Ask), state: 'replied' as const, closedAt: 5_000_000 }
  const gone = { ...(makeAsk({ title: 'Older', kind: 'review' }, { ...AT, id: 'a3' }) as Ask), state: 'done' as const, closedAt: 100 }
  const all: Desk = { asks: [open, fresh, gone], replies: new Map([['zz', { text: 'Square', at: 1, from: 'hub' }]]), live: new Map([['s-them', 9]]), store: 'st-1' }
  const feed = feedOf(all, { sid: 's-me', cwd: '/c', running: true, idleSince: 7, taken: ['r1'] }, [], 5_100_000)
  expect(feed.store).toBe('st-1')
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

type Ran = { exitCode: number; stdout: string }
type Run = (argv: string[]) => Ran | undefined
type How = { start?: number; now?: () => number; chat?: boolean; refuse?: (key: string) => string | undefined; run?: Run }

/** A moment near the real clock, where a time of 0 is far more than a day ago. */
const REAL = 1_795_800_000_000

/**
 * The engine with a hub folder in memory: files, a ping that finds the hub up, one session (or whichever
 * `sid` names when asked). The last argument is `run`, which answers a command first, or `how`, which may carry
 * it as `how.run`. `how.start` sets the clock, which then runs a second on at each reading, or `how.now`
 * gives every reading; with `how.chat` false nothing takes a prompt sent into the chat; `how.refuse` gives, for a
 * key, why the store will not take a value under it now.
 */
function engine(
  on: Parameters<TestBody>[1],
  sid: string | (() => string),
  mem: Map<string, unknown>,
  files: Map<string, string>,
  sent: string[],
  home = HOME,
  last: Run | How = {},
) {
  const how: How = typeof last === 'function' ? { run: last } : last
  const run: Run = how.run ?? (() => undefined)
  let t = how.start ?? 5_000_000
  on('store.keys', () => ({ value: [...mem.keys()] }))
  on('store.get', (_, e) => ({ value: mem.get(e.key) }))
  on('store.set', (_, e) => {
    const why = how.refuse?.(e.key)
    if (why !== undefined) return { deny: why }
    mem.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    mem.delete(e.key)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: how.now !== undefined ? how.now() : (t += 1000) }))
  on('clock.every', () => ({ value: undefined }))
  on('session.id', () => ({ value: typeof sid === 'string' ? sid : sid() }))
  on('session.cwd', () => ({ value: '/Users/t/claude/allcompost' }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__desk__${e.name}` } }))
  on('command.register', () => ({ value: { command: 'waiting' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' } }))
  on('ui.cancelNotify', () => ({ value: { isSent: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  if (how.chat !== false) {
    on('prompt.submit', (_, e) => {
      sent.push(e.text)
      return { text: e.text }
    })
  }
  on('process.run', (_, e) => {
    const mine = run([...e.argv])
    if (mine !== undefined) return { value: { ...mine, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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

// ── the hub's key ───────────────────────────────────────────────────────────────────────────

const KEY = 'ab'.repeat(32)
const KEY2 = 'ef'.repeat(32)
/** The tailnet ports of two starts of the hub, as their key files name them. */
const AT1 = 23456
const AT2 = 41234

test('a key is 64 hex characters; the proven ping reads it from its file and never sends it', () => {
  expect(keyOf(`${KEY}\n`)).toBe(KEY)
  expect(keyOf('AB'.repeat(32))).toBe('')
  expect(keyOf('ab'.repeat(16))).toBe('')
  expect(keyOf('')).toBe('')
  const argv = provenPing('http://127.0.0.1:4791', `${DIR}/secret`)
  expect(argv.slice(0, 2)).toEqual(['/bin/sh', '-c'])
  expect(argv.slice(3)).toEqual(['sh', 'http://127.0.0.1:4791', `${DIR}/secret`, '1'])
  expect(argv[2]).toMatch(/read -r k; \} 2>\/dev\/null < "\$f"/)
  // the only request is the nonce to /api/proof; the key goes to shasum on stdin, never to curl
  expect(String(argv[2]).match(/curl [^\n]*/g)).toEqual(['curl -s --noproxy "*" --max-time "$t" "$b/api/proof?n=$n") || exit 1'])
  expect(argv[2]).toMatch(/printf "desk-hub:%s:%s" "\$k" "\$n" \| shasum -a 256/)
  expect(String(argv[2]).includes('-K')).toBe(false)
})

test('a port opened to the tailnet is said plainly first: every device, and no login unless keyed', () => {
  expect(exposeLine(5173, 5173, false)).toBe('Opening :5173 to every device on your tailnet at :5173, with no login in front of it. /phone off 5173 closes it.')
  expect(exposeLine(HUB_PORT, HUB_PORT, true)).toMatch(/every device on your tailnet .* key/)
})

/** Whether a command could carry the hub's key anywhere: it reads the key file and is not the proven ping. */
const sendsKey = (argv: readonly string[]) => argv.join(' ').includes('secret') && !(argv[0] === '/bin/sh' && argv[2]?.includes('/api/proof?n=') && !argv[2]?.includes('-K'))

test('the session takes a listener for the hub only when it proves the key, and sends it no key', async ($, on) => {
  const ran: string[][] = []
  // a program that is not the hub holds the port: it cannot prove, and answers anything else as a newer hub
  engine(on, 's-me', new Map(), new Map(), [], HOME, argv => {
    ran.push(argv)
    if (argv[0] === '/bin/sh' && argv[2]?.includes('/api/proof?n=')) return { exitCode: 1, stdout: '' }
    if (argv[0] === '/bin/sh' && argv[2]?.includes('curl')) return { exitCode: 0, stdout: '{"name":"desk-hub","version":"9.9.9"}' }
    if (argv[0] === 'curl') return { exitCode: 0, stdout: '{"name":"desk-hub","version":"9.9.9"}' }
    if (argv[0] === 'lsof') return { exitCode: 0, stdout: `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnc 66 other 3u IPv4 0x1 0t0 TCP 127.0.0.1:${HUB_PORT} (LISTEN)\n` }
    return undefined
  })
  expect(await hubLine($, /:4791 is taken by another program|running on :4791/)).toMatch(/:4791 is taken by another program/)
  expect(ran.filter(sendsKey)).toEqual([])
  expect(ran.some(a => a[0] === 'kill')).toBe(false)
})

/** The engine for the hub's check: a proof that answers or not, and hub.json naming process 77 on the port. */
function checking(on: Parameters<TestBody>[1], ran: string[][], proof: () => string, files: Map<string, string>, started: () => void) {
  engine(on, 's-me', new Map(), files, [], HOME, argv => {
    ran.push(argv)
    if (argv[0] === '/bin/sh' && argv[2]?.includes('/api/proof?n=')) return { exitCode: proof() === '' ? 1 : 0, stdout: proof() }
    if (argv[0] === 'ps') return { exitCode: 0, stdout: argv[2] === '77' ? 'node /x/desk/hub/server.mjs --dir /d\n' : '' }
    if (argv[0] === 'lsof' && argv.includes('-p')) return { exitCode: 0, stdout: argv.includes('77') ? `H\nnode 77 t 20u IPv4 0x1 0t0 TCP 127.0.0.1:${HUB_PORT} (LISTEN)\n` : '' }
    if (argv[0] === 'kill' || argv[0] === '/bin/sleep') return { exitCode: 0, stdout: '' }
    if (argv[0] === '/bin/sh' && argv[2]?.includes('command -v node')) return { exitCode: 0, stdout: '/usr/local/bin/node\n' }
    if (argv[0] === '/bin/sh' && argv[2]?.includes('nohup')) {
      started()
      return { exitCode: 0, stdout: '' }
    }
    return undefined
  })
}

/** The pane's line on the hub, once the start's check has run. */
async function hubLine($: Parameters<TestBody>[0], pattern: RegExp) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'desktop' })
  let found: string | undefined
  for (let i = 0; i < 400 && found === undefined; i++) {
    found = (await ui.find({ type: 'Text', text: pattern }))?.text
    if (found === undefined) await new Promise<void>(r => later(r, 5))
  }
  await ui.unmount()
  return found
}

const PROVEN = `{"name":"desk-hub","version":"${HUB_VERSION}","proof":"${'cd'.repeat(32)}"}`

test('the session finds the hub by its proof, and leaves it be', async ($, on) => {
  const ran: string[][] = []
  checking(on, ran, () => PROVEN, new Map(), () => undefined)
  expect(await hubLine($, /running on :4791/)).not.toBe(undefined)
  expect(ran.some(a => a[0] === 'kill' || a[2]?.includes('nohup'))).toBe(false)
})

test('a hub too old to prove is known by its process on the port, and replaced', async ($, on) => {
  const ran: string[][] = []
  let proof = ''
  const files = new Map([[`${DIR}/hub.json`, JSON.stringify({ pid: 77, port: HUB_PORT, version: '0.2.0' })]])
  checking(on, ran, () => proof, files, () => (proof = PROVEN))
  // started, then found running by the checks after it
  expect(await hubLine($, /(started|running) on :4791/)).not.toBe(undefined)
  expect(ran.filter(a => a[0] === 'kill')).toEqual([['kill', '77']])
  expect(ran.find(a => a[0] === '/bin/sh' && a[2]?.includes('nohup'))?.slice(-2)).toEqual([DIR, String(HUB_PORT)])
  expect(ran.filter(sendsKey)).toEqual([])
})

/** The hub on the tailnet: a fake Tailscale that serves, and a check that opens. */
function tailnet(ran: string[][]) {
  return (argv: string[]): Ran | undefined => {
    ran.push(argv)
    const sub = argv.slice(1).join(' ')
    if (argv[0] === 'lsof') return { exitCode: 0, stdout: `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 x 20u IPv4 0x1 0t0 TCP 127.0.0.1:${HUB_PORT} (LISTEN)\n` }
    if (argv[0] === '/bin/sh' && argv[2]?.includes('/api/proof?n=')) return { exitCode: 0, stdout: `{"name":"desk-hub","version":"${HUB_VERSION}","proof":"${'cd'.repeat(32)}"}` }
    if (sub === 'serve status --json') return { exitCode: 0, stdout: '{}' }
    if (sub === 'status --json') return { exitCode: 0, stdout: JSON.stringify({ Self: { DNSName: 'mac.tail.ts.net.' } }) }
    if (sub.startsWith('serve --bg')) return { exitCode: 0, stdout: '' }
    return undefined
  }
}

test('/phone hub: the pane\'s link and code carry the key; the chat, the record and every command do not', async ($, on) => {
  const ran: string[][] = []
  const mem = new Map<string, unknown>()
  const files = new Map([[`${DIR}/secret`, `${KEY}\n${AT1}\n`]])
  engine(on, 's-me', mem, files, [], HOME, tailnet(ran))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const said = String((await $.command.run({ command: 'phone', args: 'hub' } as never)).text)

  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'desktop' })
  const link = await ui.find({ type: 'Link' })
  expect(String(link?.props.href)).toBe(`https://mac.tail.ts.net:${AT1}/${KEY}/`)
  expect(String(link?.props.label)).toBe(`https://mac.tail.ts.net:${AT1}/<key>/`)
  await ui.unmount()
  expect(said).toMatch(new RegExp(`^https://mac\\.tail\\.ts\\.net:${AT1} \\(new serve\\): opens \\(HTTP 200\\)\\.`))
  expect(said.includes(KEY)).toBe(false)
  expect(JSON.stringify(mem.get(`serve:${AT1}`)).includes(KEY)).toBe(false)
  expect(ran.some(a => a.join(' ').includes(KEY))).toBe(false)
  expect(ran.filter(sendsKey)).toEqual([]) // the check through the tailnet is the proven ping too
})

test('/phone hub before the hub has made its key: nothing is served', async ($, on) => {
  const ran: string[][] = []
  engine(on, 's-me', new Map(), new Map(), [], HOME, tailnet(ran))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const said = String((await $.command.run({ command: 'phone', args: 'hub' } as never)).text)
  expect(said).toBe('Not sent: the hub has not made its key yet; give it a moment and try again.')
  expect(ran.some(a => a.includes('--bg'))).toBe(false)
})

// ── round 3: each start of the hub has its own address ─────────────────────────────────────

test('the key file names the address of its start on its second line; a file without one names none', () => {
  expect(keyOf(`${KEY}\n${AT1}\n`)).toBe(KEY)
  expect(phonePortOf(`${KEY}\n${AT1}\n`)).toBe(AT1)
  expect(phonePortOf(`${KEY}\n`)).toBe(0)
  expect(phonePortOf(`${KEY}\n${HUB_PORT}\n`)).toBe(0)
  expect(phonePortOf(`${KEY}\n70000\n`)).toBe(0)
  expect(phonePortOf(`${KEY}\n1e4\n`)).toBe(0)
  expect(phonePortOf(`nokey\n${AT1}\n`)).toBe(0)
})

test('the hub\'s address is ready only when one handler sends it to 127.0.0.1 itself; anything else there is held, never reused', () => {
  const cfg = (proxy: string, path = '/') => ({ TCP: { [AT1]: { HTTPS: true } }, Web: { [`mac.tail.ts.net:${AT1}`]: { Handlers: { [path]: { Proxy: proxy } } } } })
  expect(hubServeAt({}, AT1, HUB_PORT)).toBe('free')
  expect(hubServeAt(cfg(`http://127.0.0.1:${HUB_PORT}`), AT1, HUB_PORT)).toBe('ready')
  expect(hubServeAt(cfg(`http://localhost:${HUB_PORT}`), AT1, HUB_PORT)).toBe('held')
  expect(hubServeAt(cfg(`http://[::1]:${HUB_PORT}`), AT1, HUB_PORT)).toBe('held')
  expect(hubServeAt(cfg(`http://127.0.0.1:${HUB_PORT}`, '/x'), AT1, HUB_PORT)).toBe('held')
  expect(hubServeAt(cfg('http://127.0.0.1:5173'), AT1, HUB_PORT)).toBe('held')
  expect(hubServeAt({ TCP: { [AT1]: { TCPForward: '127.0.0.1:22' } } }, AT1, HUB_PORT)).toBe('held')
})

test('/phone hub serves the hub at its own address for this start, to 127.0.0.1, never at :4791', async ($, on) => {
  const ran: string[][] = []
  const files = new Map([[`${DIR}/secret`, `${KEY}\n${AT1}\n`]])
  engine(on, 's-me', new Map(), files, [], HOME, tailnet(ran))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'phone', args: 'hub' } as never)
  expect(ran.filter(a => a.includes('--bg')).map(a => a.slice(-2))).toEqual([[`--https=${AT1}`, `http://127.0.0.1:${HUB_PORT}`]])
})

test('the code\'s text for a screen reader leaves the key out, as the label does', async ($, on) => {
  const files = new Map([[`${DIR}/secret`, `${KEY}\n${AT1}\n`]])
  engine(on, 's-me', new Map(), files, [], HOME, tailnet([]))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'phone', args: 'hub' } as never)
  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'desktop' })
  const alt = String((await ui.find({ type: 'Svg' }))?.props.alt)
  await ui.unmount()
  expect(alt).toBe(`QR code for https://mac.tail.ts.net:${AT1}/<key>/`)
  expect(alt.includes(KEY)).toBe(false)
})

test('/phone hub when another serve holds the hub\'s address: nothing is served, and the person\'s serve is left as it is', async ($, on) => {
  const ran: string[][] = []
  const files = new Map([[`${DIR}/secret`, `${KEY}\n${AT1}\n`]])
  const base = tailnet(ran)
  engine(on, 's-me', new Map(), files, [], HOME, argv => {
    if (argv.slice(1).join(' ') === 'serve status --json') {
      ran.push(argv)
      return { exitCode: 0, stdout: JSON.stringify({ Web: { [`mac.tail.ts.net:${AT1}`]: { Handlers: { '/': { Proxy: `http://localhost:${HUB_PORT}` } } } } }) }
    }
    return base(argv)
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const said = String((await $.command.run({ command: 'phone', args: 'hub' } as never)).text)
  expect(said).toMatch(new RegExp(`^Not sent: :${AT1}, the hub's address on your tailnet for this start, is held by another serve`))
  expect(ran.some(a => a.includes('--bg') || a.includes('off'))).toBe(false)
})

test('/phone hub with a key file that names no address: nothing is served', async ($, on) => {
  const ran: string[][] = []
  engine(on, 's-me', new Map(), new Map([[`${DIR}/secret`, `${KEY}\n`]]), [], HOME, tailnet(ran))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const said = String((await $.command.run({ command: 'phone', args: 'hub' } as never)).text)
  expect(said).toBe('Not sent: the hub has no address for the phone yet; it takes one when it starts again.')
  expect(ran.some(a => a.includes('--bg'))).toBe(false)
})

/** Tailscale with a serve config that keeps what is served and turned off. */
function serving(ran: string[][], cfg: { Web: Record<string, { Handlers: Record<string, { Proxy: string }> }> }) {
  const base = tailnet(ran)
  return (argv: string[]): Ran | undefined => {
    const sub = argv.slice(1).join(' ')
    if (sub === 'serve status --json') {
      ran.push(argv)
      return { exitCode: 0, stdout: JSON.stringify(cfg) }
    }
    const on = /^serve --bg --https=(\d+) (\S+)$/.exec(sub)
    if (on !== null) cfg.Web[`mac.tail.ts.net:${on[1]}`] = { Handlers: { '/': { Proxy: String(on[2]) } } }
    const off = /^serve --https=(\d+) off$/.exec(sub)
    if (off !== null) {
      ran.push(argv)
      delete cfg.Web[`mac.tail.ts.net:${off[1]}`]
      return { exitCode: 0, stdout: '' }
    }
    return base(argv)
  }
}

test('when the hub starts again, the code moves to its new address, the old address is turned off, and the pane says to scan again', async ($, on) => {
  const ran: string[][] = []
  const mem = new Map<string, unknown>()
  const cfg = { Web: {} }
  const files = new Map([[`${DIR}/secret`, `${KEY}\n${AT1}\n`]])
  engine(on, 's-me', mem, files, [], HOME, serving(ran, cfg))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'phone', args: 'hub' } as never)
  expect(Object.keys(cfg.Web)).toEqual([`mac.tail.ts.net:${AT1}`])
  files.set(`${DIR}/secret`, `${KEY2}\n${AT2}\n`) // a new start of the hub: a new key, at a new address
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true }) // the hub's check runs again
  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'desktop' })
  let href = ''
  for (let i = 0; i < 400 && !href.includes(KEY2); i++) {
    href = String((await ui.find({ type: 'Link' }))?.props.href ?? '')
    if (!href.includes(KEY2)) await new Promise<void>(r => later(r, 5))
  }
  // the new key is never shown at the old address: an old address may hold a page planted there
  expect(href).toBe(`https://mac.tail.ts.net:${AT2}/${KEY2}/`)
  expect((await ui.find({ type: 'Text', text: /new key at a new address: scan the code again/ })) !== undefined).toBe(true)
  await ui.unmount()
  for (let i = 0; i < 400 && mem.has(`serve:${AT1}`); i++) await new Promise<void>(r => later(r, 5))
  expect(Object.keys(cfg.Web)).toEqual([`mac.tail.ts.net:${AT2}`])
  expect(cfg.Web).toEqual({ [`mac.tail.ts.net:${AT2}`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${HUB_PORT}` } } } })
  expect(ran.some(a => a.slice(1).join(' ') === `serve --https=${AT1} off`)).toBe(true)
  expect(mem.has(`serve:${AT1}`)).toBe(false)
  expect(mem.has(`serve:${AT2}`)).toBe(true)
  expect(ran.some(a => a.join(' ').includes(KEY) || a.join(' ').includes(KEY2))).toBe(false)
})

test('a session with no code for the hub turns off the serve the desk made for its earlier address, and makes none', async ($, on) => {
  const ran: string[][] = []
  const mem = new Map<string, unknown>([[`serve:${AT1}`, { httpsPort: AT1, localPort: HUB_PORT, target: `http://127.0.0.1:${HUB_PORT}`, url: `https://mac.tail.ts.net:${AT1}`, at: 1, by: 's-gone' }]])
  const cfg = { Web: { [`mac.tail.ts.net:${AT1}`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${HUB_PORT}` } } } } }
  engine(on, 's-me', mem, new Map([[`${DIR}/secret`, `${KEY2}\n${AT2}\n`]]), [], HOME, serving(ran, cfg))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  for (let i = 0; i < 400 && mem.has(`serve:${AT1}`); i++) await new Promise<void>(r => later(r, 5))
  expect(cfg.Web).toEqual({})
  expect(mem.has(`serve:${AT1}`)).toBe(false)
  expect(ran.some(a => a.includes('--bg'))).toBe(false)
})

test('a key renewed while the hub runs keeps its address: the code takes the new key there, and nothing is served again', async ($, on) => {
  const ran: string[][] = []
  const files = new Map([[`${DIR}/secret`, `${KEY}\n${AT1}\n`]])
  engine(on, 's-me', new Map(), files, [], HOME, serving(ran, { Web: {} }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'phone', args: 'hub' } as never)
  files.set(`${DIR}/secret`, `${KEY2}\n${AT1}\n`)
  const served = ran.filter(a => a.includes('--bg')).length
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'desktop' })
  let href = ''
  for (let i = 0; i < 400 && !href.includes(KEY2); i++) {
    href = String((await ui.find({ type: 'Link' }))?.props.href ?? '')
    if (!href.includes(KEY2)) await new Promise<void>(r => later(r, 5))
  }
  await ui.unmount()
  expect(href).toBe(`https://mac.tail.ts.net:${AT1}/${KEY2}/`)
  expect(ran.filter(a => a.includes('--bg')).length).toBe(served)
})

test('a link with a key takes the new one; one without, or a key that is none, is left as it is', () => {
  const link = { localPort: HUB_PORT, url: `https://mac.tail.ts.net:${AT1}/${KEY}/`, qr: [], check: '', isOurs: true, httpsPort: AT1 }
  expect(rekeyed(link, KEY2)?.url).toBe(`https://mac.tail.ts.net:${AT1}/${KEY2}/`)
  expect((rekeyed(link, KEY2)?.qr.length ?? 0) > 0).toBe(true)
  expect(rekeyed(link, KEY)).toBe(undefined)
  expect(rekeyed(link, '')).toBe(undefined)
  expect(rekeyed({ ...link, url: 'https://mac.tail.ts.net:5173' }, KEY2)).toBe(undefined)
})

test('a reply the asker takes from the store closes the ask with its time, on a clock like the real one: it stays in the store and rides in the feed as closed', async ($, on) => {
  const mem = new Map<string, unknown>()
  const files = new Map<string, string>()
  const sent: string[] = []
  const mine = makeAsk({ title: 'Which logo?', kind: 'decision' }, { ...AT, id: 'zz2', now: REAL - 3600_000 }) as Ask
  mem.set(ASK + 'zz2', mine)
  mem.set(REPLY + 'zz2', { text: 'Round', at: REAL - 60_000, from: 's-other' })
  engine(on, 's-me', mem, files, sent, HOME, { start: REAL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const feed = await fed(files, 's-me')

  expect(sent).toEqual(['Re: Which logo? (desk ask zz2)\n\nRound'])
  expect(mem.has(REPLY + 'zz2')).toBe(false)
  // with the clock at 5,000,000 a closing time of 0 is under a day old, and tidying leaves the ask be either way
  const stored = mem.get(ASK + 'zz2') as Ask | undefined
  expect(stored?.state).toBe('replied')
  expect(stored?.reply).toBe('Round')
  expect(stored?.closedAt).toBeGreaterThan(REAL)
  const carried = (feed.asks as Ask[]).find(a => a.id === 'zz2')
  expect(carried?.state).toBe('replied')
  expect(carried?.closedAt).toBeGreaterThan(REAL)
  // and after the next pass, which reads the store again
  await $.command.run({ command: 'waiting' } as never)
  expect((mem.get(ASK + 'zz2') as Ask | undefined)?.state).toBe('replied')
  expect(sent.length).toBe(1)
})

test('replies the chat refuses leave their asks open in the store, though the reopening of the first lands before the pass tidies', async ($, on) => {
  const mem = new Map<string, unknown>()
  const files = new Map<string, string>()
  // a dozen replies in one pass: while the later ones are taken, the refusal of the first comes back and reopens its ask
  const ids = Array.from({ length: 12 }, (_, i) => `zz${10 + i}`)
  for (const id of ids) {
    mem.set(ASK + id, makeAsk({ title: `Which logo, ${id}?`, kind: 'decision' }, { ...AT, id, now: REAL - 3600_000 }) as Ask)
    mem.set(REPLY + id, { text: 'Round', at: REAL - 60_000, from: 's-other' })
  }
  engine(on, 's-me', mem, files, [], HOME, { start: REAL, chat: false })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fed(files, 's-me')
  // the reopenings run beside the pass: give them a moment, then read the store as the next pass leaves it
  const open = (id: string) => (mem.get(ASK + id) as Ask | undefined)?.state === 'open'
  for (let i = 0; i < 100 && !ids.every(open); i++) await new Promise<void>(r => later(r, 5))
  await $.command.run({ command: 'waiting' } as never)

  expect(ids.filter(id => !mem.has(ASK + id))).toEqual([])
  expect(ids.filter(open)).toEqual(ids)
  const carried = JSON.parse(files.get(`${DIR}/feeds/s-me.json`) ?? '{}').asks as Ask[]
  expect(carried.filter(c => c.state === 'open').map(c => c.id).sort()).toEqual(ids)
})

test('a store names itself once: the first pass makes the name, each session reads it again on every pass and puts it in its feed, and tidying leaves it', async ($, on) => {
  const mem = new Map<string, unknown>()
  const files = new Map<string, string>()
  let who = 's-one'
  // day-old things, for the pass's tidying to take
  const old = { ...(makeAsk({ title: 'Old', kind: 'review' }, { ...AT, id: 'old', sessionId: 's-gone' }) as Ask), state: 'done' as const, closedAt: REAL - 2 * 24 * 3600_000 }
  mem.set(ASK + 'old', old)
  mem.set(LIVE + 's-gone', REAL - 2 * 24 * 3600_000)
  engine(on, () => who, mem, files, [], HOME, { start: REAL })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const one = await fed(files, 's-one')
  const name = String(mem.get(STORE) ?? '')
  expect(name.length).toBeGreaterThan(8)
  expect(one.store).toBe(name)
  expect(mem.has(ASK + 'old')).toBe(false)
  expect(mem.has(LIVE + 's-gone')).toBe(false)
  expect(staleKeys({ asks: [old], replies: new Map(), live: new Map([['s-gone', 1]]), store: name }, REAL + 365 * 24 * 3600_000)).toEqual([ASK + 'old', LIVE + 's-gone'])

  // a second session on the same store reads the name and makes no other
  who = 's-two'
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const two = await fed(files, 's-two')
  expect(two.store).toBe(name)
  expect(mem.get(STORE)).toBe(name)

  // read again on every pass, never kept: when the store holds another name, the next feed carries that one
  mem.set(STORE, 'st-theirs')
  await $.command.run({ command: 'waiting' } as never)
  expect(JSON.parse(files.get(`${DIR}/feeds/s-two.json`) ?? '{}').store).toBe('st-theirs')
  expect(mem.get(STORE)).toBe('st-theirs')
})

/** Files that keep every text written to them: here, each feed a session wrote, in order. */
class Kept extends Map<string, string> {
  texts: string[] = []
  set(path: string, text: string) {
    this.texts.push(text)
    return super.set(path, text)
  }
  /** The store named in each feed written, first to last. */
  get named(): string[] {
    return this.texts.map(text => String(JSON.parse(text).store))
  }
}

test('two sessions name a new store at once, the other\'s name landing before this one reads back: its feeds carry the name it read, never the one it made', async ($, on) => {
  /** A store on which another session's name replaces this one's as it is set. */
  class Raced extends Map<string, unknown> {
    set(key: string, value: unknown) {
      return super.set(key, key === STORE && !this.has(STORE) ? 'st-theirs' : value)
    }
  }
  const mem = new Raced()
  const files = new Kept()
  engine(on, 's-me', mem, files, [], HOME, { start: REAL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fed(files, 's-me')
  // from the first feed on, the very pass that made a name
  expect(files.named.length).toBeGreaterThan(0)
  expect(files.named.filter(name => name !== 'st-theirs')).toEqual([])
})

test('two sessions name a new store at once, the other\'s name landing after this one has read back: that pass\'s feed carries the name it made, and the next pass takes the store\'s', async ($, on) => {
  /** A store on which another session's name lands just after this one has read its own back. */
  class Late extends Map<string, unknown> {
    landed = false
    get(key: string) {
      const value = super.get(key)
      if (key === STORE && value !== undefined && !this.landed) {
        this.landed = true
        super.set(STORE, 'st-theirs')
      }
      return value
    }
  }
  const mem = new Late()
  const files = new Kept()
  engine(on, 's-me', mem, files, [], HOME, { start: REAL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fed(files, 's-me')
  await $.command.run({ command: 'waiting' } as never)

  const made = files.named[0] ?? ''
  expect(made).not.toBe('st-theirs')
  expect(made.length).toBeGreaterThan(8)
  // the store's name is taken, and never written over
  expect(files.named.at(-1)).toBe('st-theirs')
  expect(mem.get(STORE)).toBe('st-theirs')
})

test('the store refuses a name: that pass\'s feed goes out without one, and the next pass tries again', async ($, on) => {
  const mem = new Map<string, unknown>()
  const files = new Kept()
  let refusals = 1
  engine(on, 's-me', mem, files, [], HOME, { start: REAL, refuse: key => (key === STORE && refusals-- > 0 ? 'the store is full' : undefined) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fed(files, 's-me')
  await $.command.run({ command: 'waiting' } as never)

  expect(files.named[0]).toBe('')
  const name = String(mem.get(STORE) ?? '')
  expect(name.length).toBeGreaterThan(8)
  expect(files.named.at(-1)).toBe(name)
})

test('a read of the keys that misses the name does not write a new one over it: the pass asks for the name by its key before it makes one', async ($, on) => {
  /** A store whose list of keys leaves the name out, though the name is there. */
  class Missed extends Map<string, unknown> {
    sets: string[] = []
    keys() {
      return [...super.keys()].filter(key => key !== STORE).values() as ReturnType<Map<string, unknown>['keys']>
    }
    set(key: string, value: unknown) {
      this.sets.push(key)
      return super.set(key, value)
    }
  }
  const mem = new Missed()
  mem.set(STORE, 'st-kept')
  mem.sets.length = 0
  const files = new Kept()
  engine(on, 's-me', mem, files, [], HOME, { start: REAL })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fed(files, 's-me')
  await $.command.run({ command: 'waiting' } as never)

  expect(mem.sets.filter(key => key === STORE)).toEqual([])
  expect(mem.get(STORE)).toBe('st-kept')
  expect(files.named.filter(name => name !== 'st-kept')).toEqual([])
})

test('a quiet session whose clock goes back acts again at its next pass: the feed is written with the new stamp, the live mark set and the sites read; with the clock running forward nothing is written twice inside the feed\'s beat', async ($, on) => {
  const SEC = 1000
  const MIN = 60 * SEC
  const mem = new Map<string, unknown>()
  const files = new Kept()
  let now = REAL
  mem.set(ASK + 'zq1', makeAsk({ title: 'Which week?', kind: 'answer' }, { ...AT, id: 'zq1', now: REAL - 3600_000 }) as Ask)
  engine(on, 's-me', mem, files, [], HOME, { now: () => now })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await fed(files, 's-me')
  const pass = () => $.command.run({ command: 'waiting' } as never)
  /** Each feed this session wrote, first to last. */
  const feeds = () => files.texts.map(text => JSON.parse(text)).filter(f => f.sid === 's-me')
  await pass()
  const first = feeds().length
  expect(first).toBeGreaterThan(0)
  expect(feeds().at(-1).at).toBe(REAL)
  expect(mem.get(LIVE + 's-me')).toBe(REAL)

  // The control. The clock stands, then runs forward four seconds, inside the feed's beat: nothing is written.
  await pass()
  now = REAL + 4 * SEC
  await pass()
  expect(feeds().length).toBe(first)
  // At the beat it writes, and again ten seconds on. The mark, set every thirty, stays.
  now = REAL + 10 * SEC
  await pass()
  now = REAL + 20 * SEC
  await pass()
  expect(feeds().length).toBe(first + 2)
  expect(feeds().at(-1).at).toBe(REAL + 20 * SEC)
  expect(mem.get(LIVE + 's-me')).toBe(REAL)

  // The clock goes back thirteen seconds, with nothing new: behind the last feed, not behind the mark. Nothing in
  // the feed has changed, and it is written again, with the new stamp; and then not again while the clock stands.
  now = REAL + 7 * SEC
  await pass()
  expect(feeds().length).toBe(first + 3)
  expect(feeds().at(-1).at).toBe(REAL + 7 * SEC)
  expect(mem.get(LIVE + 's-me')).toBe(REAL)
  await pass()
  expect(feeds().length).toBe(first + 3)

  // The clock goes back ten minutes, with nothing new: the next pass writes the feed with the new stamp and sets
  // the live mark, which the feed carries.
  now = REAL - 10 * MIN
  await pass()
  expect(feeds().length).toBe(first + 4)
  expect(feeds().at(-1).at).toBe(REAL - 10 * MIN)
  expect(mem.get(LIVE + 's-me')).toBe(REAL - 10 * MIN)
  expect(feeds().at(-1).live['s-me']).toBe(REAL - 10 * MIN)
  expect(feeds().at(-1).asks.map((a: Ask) => a.id)).toEqual(['zq1'])

  // And the sites are read again: a link made since is in the first feed after the clock goes back once more.
  const link: Served = { httpsPort: 5173, localPort: 5173, target: '', url: 'https://m.t.ts.net:5173', at: 0, by: 's-me' }
  mem.set(SERVE + '5173', link)
  now = REAL - 11 * MIN
  await pass()
  expect(feeds().at(-1).sites).toEqual([{ port: 5173, url: 'https://m.t.ts.net:5173' }])
})
