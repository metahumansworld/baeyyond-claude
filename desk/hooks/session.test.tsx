import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { dur, labelOf, localPorts, shortPath, testOutcome, textOf } from './activity'
import { checkLine, existingFor, pickPort, portOf, proxyPort, targetFromLsof, urlOf } from './phone'
import { qrModules, qrSvg, qrText } from './qr'

/** A serve config that already holds three of the person's handlers, which the desk must leave alone. */
const CONFIG = {
  TCP: { '10000': { HTTPS: true }, '443': { HTTPS: true }, '8443': { HTTPS: true } },
  Web: {
    'mac.tail.ts.net:10000': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4317' } } },
    'mac.tail.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4750' } } },
    'mac.tail.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4770' } } },
  },
}

const SESSION_PANE = {
  plugin: 'desk',
  component: 'Pane',
  requestId: 'session',
  props: {
    title: 'This session',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

type On = Parameters<TestBody>[1]

/** What a run of the fake Tailscale was given as environment, and words it prints in place of its JSON. */
type Fake = { envs?: (Record<string, string> | undefined)[]; words?: string }

/** The engine under the mod, with a fake Tailscale: `argvs` records every command the mod ran. */
function engine(on: On, argvs: string[][], serve: { cfg: typeof CONFIG | Record<string, unknown> }, fake: Fake = {}) {
  let t = 9_000_000
  const mem = new Map<string, unknown>()
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
  on('session.id', () => ({ value: 's-me' }))
  on('session.cwd', () => ({ value: '/Users/x/proj' }))
  on('session.usage', () => ({ value: { startedAt: 1_000_000, context: {}, rateLimits: [], cost: { usd: 1.5 } } as never }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__desk__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'client' } }))
  on('ui.cancelNotify', () => ({ value: { isSent: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    argvs.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'lsof') {
      return argv[2] === '-iTCP:9999'
        ? { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
        : ok(`COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 1 x 20u IPv4 0x1 0t0 TCP 127.0.0.1:${argv[2]?.slice(6)} (LISTEN)\n`)
    }
    if (argv[0] === 'curl') return ok('<html>hi</html>\n__status__200')
    const sub = argv.slice(1).join(' ')
    if (argv[0]?.endsWith('/Tailscale')) fake.envs?.push(e.init?.env)
    if (fake.words !== undefined && sub.endsWith('status --json')) return ok(fake.words)
    if (sub === 'serve status --json') return ok(JSON.stringify(serve.cfg))
    if (sub === 'status --json') return ok(JSON.stringify({ Self: { DNSName: 'mac.tail.ts.net.', Online: true } }))
    if (sub.startsWith('serve --bg --https=')) {
      const port = sub.split(' ')[2]?.slice(8) ?? ''
      const target = sub.split(' ')[3] ?? ''
      serve.cfg = {
        ...serve.cfg,
        Web: { ...(serve.cfg.Web as object), [`mac.tail.ts.net:${port}`]: { Handlers: { '/': { Proxy: target } } } },
      }
      return ok('')
    }
    if (sub.endsWith(' off')) return ok('')
    return { value: { exitCode: 1, stdout: '', stderr: `unexpected: ${sub}`, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return mem
}

test('a call is named by what it does', () => {
  expect(labelOf('Bash', { command: 'npm test\nmore', description: '' })).toBe('npm test')
  expect(labelOf('Bash', { command: 'x', description: 'Run the tests' })).toBe('Run the tests')
  expect(labelOf('Edit', { file_path: '/a/b/register.tsx' })).toBe('register.tsx')
  expect(labelOf('mcp__stitch__get_screen', {})).toBe('stitch · get_screen')
  expect(textOf({ stdout: 'a', stderr: 'b' })).toBe('a\nb')
})

test('a test run fails on its error or on a count of failures, and passes on none', () => {
  expect(testOutcome(false, ' 12 pass\n 0 fail')).toBe('pass')
  expect(testOutcome(false, ' 11 pass\n 1 fail')).toBe('fail')
  expect(testOutcome(true, 'ok')).toBe('fail')
  expect(testOutcome(false, 'Tests: 3 failed, 9 passed')).toBe('fail')
})

test('local servers are found in commands and output; paths and durations read short', () => {
  expect(localPorts('  ➜  Local:   http://localhost:5173/\n curl 127.0.0.1:4317/x and [::1]:8080 :80 localhost:80')).toEqual([5173, 4317, 8080])
  expect(shortPath('/Users/x/proj/hooks/a.ts', '/Users/x/proj')).toBe('hooks/a.ts')
  expect(shortPath('/Users/x/other/a.ts', '/Users/x/proj')).toBe('~/other/a.ts')
  expect([dur(850), dur(12_400), dur(192_000), dur(7_380_000)]).toEqual(['850ms', '12s', '3m 12s', '2h 3m'])
})

test('the serve config is read, never reused wrongly, and a new port avoids every handler', () => {
  expect(proxyPort('http://127.0.0.1:4317')).toBe(4317)
  expect(proxyPort('localhost:3000')).toBe(3000)
  expect(proxyPort('https+insecure://localhost:8443/x')).toBe(8443)
  expect(existingFor(CONFIG, 4317)?.port).toBe(10000)
  expect(existingFor(CONFIG, 5173)).toBe(undefined)
  expect(pickPort(CONFIG, 5173)).toBe(5173)
  expect(pickPort(CONFIG, 443)).toBe(8000)
  expect(pickPort(CONFIG, 8443)).toBe(8000)
  expect(urlOf('mac.tail.ts.net.', 443)).toBe('https://mac.tail.ts.net')
  expect(urlOf('mac.tail.ts.net', 5173)).toBe('https://mac.tail.ts.net:5173')
  expect(portOf(':5173')).toBe(5173)
  expect(portOf('abc')).toBe(0)
  expect(portOf('70000')).toBe(0)
})

test('where a server listens decides the target; a check reads Vite\'s refusal', () => {
  const head = 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n'
  expect(targetFromLsof(head + 'node 1 x 20u IPv6 0x1 0t0 TCP [::1]:5173 (LISTEN)\n', 5173)).toBe('http://[::1]:5173')
  expect(targetFromLsof(head + 'node 1 x 20u IPv4 0x1 0t0 TCP *:5173 (LISTEN)\n', 5173)).toBe('http://127.0.0.1:5173')
  expect(targetFromLsof('', 5173)).toBe('')
  expect(checkLine(403, 'Blocked request. This host ("mac.tail.ts.net") is not allowed.')).toMatch(/allowedHosts/)
  expect(checkLine(200, '<html>')).toBe('opens (HTTP 200).')
  expect(checkLine(0, '')).toMatch(/not reached/)
})

test('the code is square, sized by version, and drawn for each surface', () => {
  const m = qrModules('https://my-laptop.example-tailnet.ts.net:5173')
  expect(m.length).toBe(33)
  expect(m.every(r => r.length === 33)).toBe(true)
  // the three finders' corners are dark, and the module beside each finder's ring is light
  expect([m[0]?.[0], m[0]?.[32], m[32]?.[0], m[1]?.[1]]).toEqual([true, true, true, false])
  const rows = m.map(r => r.map(d => (d ? '1' : '0')).join(''))
  expect(qrSvg(rows)).toMatch(/^<svg [^>]*viewBox="0 0 41 41"/)
  const text = qrText(rows)
  expect(text.length).toBe(19)
  expect(text.every(l => [...l].length === 37)).toBe(true)
  expect(() => qrModules('x'.repeat(400))).toThrow()
})

test('the session pane counts edits, tests, turns and servers from real calls', async ($, on) => {
  engine(on, [], { cfg: CONFIG })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash' && String((e as { command?: string }).command).includes('fail')) return { result: { stdout: '1 fail' }, isError: true }
    if (e.tool === 'Bash' && String((e as { command?: string }).command).includes('dev')) return { result: { stdout: '  Local: http://localhost:5173/' } }
    return { result: {} }
  })
  await $.session.start({ cwd: '/Users/x/proj', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'build the desk', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/Users/x/proj/hooks/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/Users/x/proj/hooks/a.ts', old_string: 'b', new_string: 'c' })
  await $.tool.call({ tool: 'Bash', command: 'claude plugin test desk' })
  await $.tool.call({ tool: 'Bash', command: 'npm test -- fail' })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev' })
  await $.turn.complete({ answer: 'done', durationMs: 192_000, isAborted: false, turnId: 't1', reason: 'answer' })

  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^hooks\/a\.ts/ }))?.text).toMatch(/^hooks\/a\.ts ×2/)
  expect((await ui.find({ type: 'Text', text: /runs · / }))?.text).toBe('2 runs · 1 passed · 1 failed')
  expect((await ui.find({ type: 'Text', text: /^✗ / }))?.text).toMatch(/^✗ npm test -- fail/)
  expect((await ui.find({ type: 'Text', text: /^#1 / }))?.text).toBe('#1 3m 12s build the desk')
  expect((await ui.find({ type: 'Text', text: /turn · working/ }))?.text).toMatch(/^1 turn · working 3m 12s · open .* · \$1\.50$/)
  expect(await ui.find({ type: 'Button', key: 'phone:5173' })).not.toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /Nothing running/ }))?.text).toBe('Nothing running.')
  await ui.unmount()
})

test('send to phone serves a new port, draws the code, and stops only its own serve', async ($, on) => {
  const argvs: string[][] = []
  const serve = { cfg: CONFIG as Record<string, unknown> }
  const mem = engine(on, argvs, serve)
  on('tool.call', () => ({ result: { stdout: 'Local: http://localhost:5173/' } }))
  await $.session.start({ cwd: '/Users/x/proj', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run dev' })

  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'desktop' })
  await ui.press({ key: 'phone:5173' })
  const tailscale = argvs.filter(a => a[0]?.endsWith('/Tailscale')).map(a => a.slice(1).join(' '))
  expect(tailscale).toContain('serve --bg --https=5173 http://127.0.0.1:5173')
  expect(tailscale.some(c => /reset|10000|=443\b|8443/.test(c))).toBe(false)
  expect(mem.get('serve:5173')).toEqual(expect.objectContaining({ localPort: 5173, url: 'https://mac.tail.ts.net:5173' }))
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props.alt)).toBe('QR code for https://mac.tail.ts.net:5173')
  expect((await ui.find({ type: 'Text', text: /Checked from this Mac/ }))?.text).toMatch(/opens \(HTTP 200\)/)

  expect(String((await $.command.run({ command: 'phone', args: '' } as never)).text)).toBe(
    ':5173 → https://mac.tail.ts.net:5173 (/phone off 5173)',
  )
  await ui.press({ key: 'off:5173' })
  expect(argvs.map(a => a.slice(1).join(' '))).toContain('serve --https=5173 off')
  expect(mem.has('serve:5173')).toBe(false)
  await ui.unmount()
})

test('a serve another session made is turned off from here by the desk\'s own record', async ($, on) => {
  const argvs: string[][] = []
  const serve = {
    cfg: { ...CONFIG, Web: { ...CONFIG.Web, 'mac.tail.ts.net:5199': { Handlers: { '/': { Proxy: 'http://127.0.0.1:5199' } } } } } as Record<string, unknown>,
  }
  const mem = engine(on, argvs, serve)
  mem.set('serve:5199', { httpsPort: 5199, localPort: 5199, target: 'http://127.0.0.1:5199', url: 'https://mac.tail.ts.net:5199', at: 1, by: 's-other' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(String((await $.command.run({ command: 'phone', args: 'off 5199' } as never)).text)).toBe('https://mac.tail.ts.net:5199 is off.')
  expect(argvs.map(a => a.slice(1).join(' '))).toContain('serve --https=5199 off')
})

test('a port already on the tailnet is reused, never served again or turned off', async ($, on) => {
  const argvs: string[][] = []
  engine(on, argvs, { cfg: CONFIG })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const said = await $.command.run({ command: 'phone', args: '4317' } as never)
  expect(String(said.text)).toMatch(/^https:\/\/mac\.tail\.ts\.net:10000 \(already served\)/)
  expect(argvs.some(a => a.includes('--bg') || a.includes('off'))).toBe(false)

  const ui = await $.ui.mount({ ...SESSION_PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'off:10000' })).toBe(undefined)
  expect((await ui.findAll({ type: 'Text', text: /█/ })).length).toBeGreaterThan(10)
  await ui.unmount()

  const off = await $.command.run({ command: 'phone', args: 'off 10000' } as never)
  expect(String(off.text)).toMatch(/did not make the serve on :10000/)
  expect(argvs.some(a => a.includes('off'))).toBe(false)
})

test('nothing listening: no serve, and the pane says why', async ($, on) => {
  const argvs: string[][] = []
  engine(on, argvs, { cfg: CONFIG })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const said = await $.command.run({ command: 'phone', args: '9999' } as never)
  expect(String(said.text)).toBe('Not sent: nothing listens on :9999 on this Mac.')
  expect(argvs.some(a => a[0]?.endsWith('/Tailscale'))).toBe(false)
})

test('Tailscale is run as a command wherever the session runs: every run carries TAILSCALE_BE_CLI', async ($, on) => {
  const argvs: string[][] = []
  const envs: (Record<string, string> | undefined)[] = []
  engine(on, argvs, { cfg: CONFIG as Record<string, unknown> }, { envs })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'phone', args: '5173' } as never)
  // the serve config, the Mac's name, and the serve itself
  expect(envs.length).toBeGreaterThan(2)
  expect(envs.every(e => e?.TAILSCALE_BE_CLI === '1')).toBe(true)
})

test('Tailscale printing words in place of its data is said as it is, and nothing is served', async ($, on) => {
  const argvs: string[][] = []
  engine(on, argvs, { cfg: CONFIG }, { words: 'The Tailscale GUI failed to start: no session.\nmore\n' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const said = await $.command.run({ command: 'phone', args: '5173' } as never)
  expect(String(said.text)).toBe('Not sent: tailscale serve status answered in words, not data: The Tailscale GUI failed to start: no session.')
  expect(argvs.some(a => a.includes('--bg'))).toBe(false)
})
