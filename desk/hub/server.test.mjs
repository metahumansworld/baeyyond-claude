// The hub's key, against the real server on test ports in folders of their own.
//
//   node --test hub/server.test.mjs
//   DESK_HUB_TEST_PORT=47913 DESK_HUB_TEST_TMP=/some/folder node --test hub/server.test.mjs
//
// Never the hub's own port or folder: the tests use DESK_HUB_TEST_PORT to DESK_HUB_TEST_PORT+5
// (above 20000) and folders made under DESK_HUB_TEST_TMP (the system's temp folder by default),
// and every command the session's code runs here is refused if it names port 4791. The hubs here
// ask a stand-in for Tailscale (`--tailscale`), which names this Mac mac.tail.ts.net and its owner
// owner@example.com; the real Tailscale is never run.

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

import { ensureHub, provenPing } from '../hooks/hub.ts'
import { PHONE_PORTS, digest, phonePort, unlock } from './key.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.DESK_HUB_TEST_PORT ?? '47913')
if (!(PORT > 20000 && PORT + 5 < 65536)) throw new Error('a test port above 20000, please')
const SQUAT = PORT + 1
const RACE = PORT + 2
const HELD = PORT + 3
const RENEW = PORT + 4
const ADDR = PORT + 5
const OWNER = 'owner@example.com'
const MAC = 'mac.tail.ts.net'
const TMP = process.env.DESK_HUB_TEST_TMP ?? tmpdir()
const BASE = `http://127.0.0.1:${PORT}`
let root = ''
let dir = ''
let hub
let key = ''
/** The tailnet port of the running test hub's address, from its key file. */
let at = 0
let tailscale = ''

const mode = async p => (await stat(p)).mode & 0o777
const get = (path, init) => fetch(BASE + path, { redirect: 'manual', ...init })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const isKey = v => /^[0-9a-f]{64}$/.test(v)
const keyFile = async d => (await readFile(join(d, 'secret'), 'utf8').catch(() => '')).split('\n')
const readKey = async d => (await keyFile(d))[0].trim()
const readAt = async d => Number((await keyFile(d))[1]) || 0

/** Runs a command as the session's engine would, refusing any that names the hub's own port. */
function run(argv, opts = {}) {
  if (argv.some(a => /(^|\D)4791(\D|$)/.test(a))) throw new Error('never the real port')
  if (argv[0] === '/bin/sh' && String(argv[2]).includes('nohup') && !String(argv[2]).includes('--port')) throw new Error('a start with no port')
  return new Promise(resolve =>
    execFile(argv[0], argv.slice(1), { timeout: opts.timeoutMs ?? 10_000 }, (err, stdout, stderr) =>
      resolve({ exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
    ),
  )
}
/** The engine as ensureHub uses it: real commands and files, the mod's folder this one's parent. */
const engine = { plugin: { root: dirname(HERE) }, fs: { read: p => readFile(p, 'utf8') }, process: { run } }

function spawnHub(port, d, extra = []) {
  const h = spawn(process.execPath, [join(HERE, 'server.mjs'), '--port', String(port), '--dir', d, '--tailscale', tailscale, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] })
  h.out = ''
  h.stdout.on('data', c => (h.out += c))
  h.stderr.on('data', c => (h.out += c))
  h.done = new Promise(r => h.once('exit', code => ((h.code = code), r(code))))
  return h
}
async function stopHub(h) {
  if (h.code === undefined && h.exitCode === null) h.kill('SIGTERM')
  await h.done
}
/** Status of a raw request, so paths reach the hub as written. */
function status(port, target, host = `127.0.0.1:${port}`, headers = {}) {
  return new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1')
    let got = ''
    const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')
    s.setTimeout(3000, () => (s.destroy(), resolve(0)))
    s.on('connect', () => s.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\n${extra}Connection: close\r\n\r\n`))
    s.on('data', d => (got += d))
    s.on('error', () => resolve(0))
    s.on('close', () => resolve(Number(got.split(' ')[1]) || 0))
  })
}
async function waitFor(check, tries = 100, ms = 50) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true
    await sleep(ms)
  }
  return false
}

async function start() {
  hub = spawnHub(PORT, dir)
  const up = await waitFor(async () => {
    if (!hub.out.includes('desk hub ')) return false // logged once its key is written
    key = await readKey(dir)
    at = await readAt(dir)
    return isKey(key) && (await status(PORT, `/${key}/api/ping`)) === 200
  })
  if (!up) throw new Error(`the test hub did not start: ${hub.out}`)
}
const halt = () => stopHub(hub)

before(async () => {
  await mkdir(TMP, { recursive: true })
  root = await mkdtemp(join(TMP, 'desk-hub-test-'))
  dir = join(root, 'hub')
  // a stand-in for Tailscale's `status --json`: this Mac's name and its owner, nothing else
  tailscale = join(root, 'tailscale')
  const status = { Self: { UserID: 1, DNSName: `${MAC}.` }, User: { 1: { LoginName: OWNER } } }
  await writeFile(tailscale, `#!/bin/sh\nprintf '%s' '${JSON.stringify(status)}'\n`, { mode: 0o755 })
  // an old folder: open modes, a feed and an inbox already there
  await mkdir(join(dir, 'feeds'), { recursive: true, mode: 0o755 })
  await chmod(dir, 0o755)
  await chmod(join(dir, 'feeds'), 0o755)
  await writeFile(join(dir, 'feeds', 's1.json'), '{}', { mode: 0o644 })
  await writeFile(join(dir, 'inbox.json'), '{"v":1,"entries":[]}', { mode: 0o644 })
  await start()
})
after(async () => {
  if (hub) await halt()
  await rm(root, { recursive: true, force: true })
})

test('the key is made on first start: 256 bits as hex, in a 0600 file; the folder 0700, old files 0600', async () => {
  assert.match(key, /^[0-9a-f]{64}$/)
  assert.equal(await mode(join(dir, 'secret')), 0o600)
  assert.equal(await mode(dir), 0o700)
  assert.equal(await mode(join(dir, 'feeds')), 0o700)
  assert.equal(await mode(join(dir, 'feeds', 's1.json')), 0o600)
  assert.equal(await mode(join(dir, 'inbox.json')), 0o600)
  assert.equal(await mode(join(dir, 'hub.json')), 0o600)
})

test('without the key, every path is 404 and says nothing of the hub', async () => {
  const wrong = key.replace(/^./, c => (c === 'a' ? 'b' : 'a'))
  for (const path of ['/', '/api/ping', '/api/state', '/app.js', '/api/proof', '/api/proof?n=xyz', `/${wrong}/api/ping`, `/${wrong}/`, `/${key.slice(0, 63)}/api/ping`, `/x${key}/api/ping`]) {
    const r = await get(path, { headers: { 'Tailscale-User-Login': 'someone@example.com', 'X-Desk-Hub': '1' } })
    assert.equal(r.status, 404, path)
    assert.equal(await r.text(), 'Not here.\n', path)
  }
})

test('an answer without the key is 404 before its body is read, and nothing lands in the inbox', async () => {
  const before = await readFile(join(dir, 'inbox.json'), 'utf8')
  const r = await get('/api/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Desk-Hub': '1', 'Tailscale-User-Login': 'someone@example.com' },
    body: JSON.stringify({ askId: 'a1', words: 'yes' }),
  })
  assert.equal(r.status, 404)
  assert.equal(await readFile(join(dir, 'inbox.json'), 'utf8'), before)
})

test('with the key, the ping answers; the key alone sends to its page', async () => {
  assert.deepEqual(await (await get(`/${key}/api/ping`)).json(), { name: 'desk-hub', version: '0.2.3' })
  const r = await get(`/${key}`)
  assert.equal(r.status, 302)
  assert.equal(r.headers.get('location'), `${key}/`)
})

test('with the key, the Host check still stands', async () => {
  assert.equal(await status(PORT, `/${key}/api/state`, 'elsewhere.example'), 421)
})

// ── fix 1: the key goes to no process that has not proven it is the hub ─────────────────────

test('the hub proves it holds the key for a fresh nonce; the session checks the proof with the key in no argument', async () => {
  const n = 'ab'.repeat(16)
  const r = await (await get(`/api/proof?n=${n}`)).json()
  assert.deepEqual(r, { name: 'desk-hub', version: '0.2.3', proof: createHash('sha256').update(`desk-hub:${key}:${n}`).digest('hex') })
  const argv = provenPing(BASE, join(dir, 'secret'), 2)
  assert.equal(argv.some(a => a.includes(key)), false)
  const out = await run(argv)
  assert.equal(JSON.parse(out.stdout).version, '0.2.3')
  assert.equal(JSON.parse(out.stdout).name, 'desk-hub')
})

test('a listener that is not the hub gets nothing of the key from the session, and is not taken for the hub', async () => {
  const seen = []
  const squat = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      seen.push(JSON.stringify({ url: req.url, headers: req.headers, body }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // it says it is the hub, newer than any, with a proof it made up
      res.end(JSON.stringify({ name: 'desk-hub', version: '9.9.9', proof: 'cd'.repeat(32) }))
    })
  })
  await new Promise(r => squat.listen(SQUAT, '127.0.0.1', r))
  try {
    const line = await ensureHub(engine, dir, SQUAT)
    assert.equal(line, `:${SQUAT} is taken by another program`)
    assert.ok(seen.length >= 1, 'the session asked the listener')
    const all = seen.join('\n')
    assert.equal(all.includes(key), false, 'the listener saw the key')
    assert.equal(all.includes(digest(key).toString('hex')), false)
  } finally {
    await new Promise(r => squat.close(r))
  }
})

test('the session takes the real hub for the hub, by its proof', async () => {
  assert.equal(await ensureHub(engine, dir, PORT), `running on :${PORT}`)
})

// ── fix 2: hubs started together never split or empty the key ───────────────────────────────

test('an empty or malformed key never opens the hub, even with no key loaded', async () => {
  for (const path of ['//api/state', '/.//api/state', '//api/ping']) assert.equal(await status(PORT, path), 404, path)
  const k = 'ef'.repeat(32)
  assert.equal(unlock(Buffer.alloc(0), '//api/state'), undefined)
  assert.equal(unlock(digest(''), '//api/state'), undefined)
  assert.equal(unlock(digest(''), '/'), undefined)
  assert.equal(unlock(digest('x'), '/x/api/state'), undefined)
  assert.equal(unlock(digest(k), `/${k}/api/state`), '/api/state')
  assert.equal(unlock(digest(k), `/${k}`), '')
})

test('a hub that cannot take the port writes no key, and leaves a file it finds alone', async () => {
  const d = await mkdtemp(join(root, 'held-'))
  const holder = net.createServer()
  await new Promise(r => holder.listen(HELD, '127.0.0.1', r))
  try {
    const a = spawnHub(HELD, d)
    assert.equal(await a.done, 1)
    assert.equal(await readFile(join(d, 'secret'), 'utf8').catch(() => 'none'), 'none')
    await writeFile(join(d, 'secret'), 'not a key\n', { mode: 0o600 })
    const b = spawnHub(HELD, d)
    assert.equal(await b.done, 1)
    assert.equal(await readFile(join(d, 'secret'), 'utf8'), 'not a key\n')
  } finally {
    await new Promise(r => holder.close(r))
  }
  // the port free: the hub that holds it replaces the bad file whole
  const c = spawnHub(HELD, d)
  try {
    assert.ok(await waitFor(async () => isKey(await readKey(d)) && (await status(HELD, `/${await readKey(d)}/api/ping`)) === 200))
  } finally {
    await stopHub(c)
  }
})

test('eight hubs started together on a fresh folder agree on one key, the one in the file', async () => {
  for (let round = 0; round < 12; round++) {
    const d = await mkdtemp(join(root, 'race-'))
    const hubs = Array.from({ length: 8 }, () => spawnHub(RACE, d))
    try {
      let winner
      const settled = await waitFor(
        () => {
          winner = hubs.find(h => h.out.includes('desk hub ') && h.code === undefined)
          return winner !== undefined && hubs.every(h => h === winner || h.code !== undefined)
        },
        200,
        25,
      )
      assert.ok(settled, `round ${round}: no single hub took the port`)
      const fileKey = await readKey(d)
      assert.ok(isKey(fileKey), `round ${round}: the file holds no key`)
      assert.equal(await status(RACE, `/${fileKey}/api/ping`), 200, `round ${round}: the hub refuses the file's key`)
      assert.equal(await status(RACE, '/.//api/ping'), 404, `round ${round}: an empty key opens the hub`)
      assert.equal((await run(provenPing(`http://127.0.0.1:${RACE}`, join(d, 'secret'), 2))).stdout === '', false, `round ${round}: no proof`)
      for (const h of hubs) if (h !== winner) assert.equal(h.code, 1)
    } finally {
      await Promise.all(hubs.map(stopHub))
    }
  }
})

// ── round 2: a key never outlives its hub ───────────────────────────────────────────────────

/** A stand-in that holds the port while the hub is down and keeps what the phone's request carried. */
async function squatter(port, host) {
  const seen = []
  const s = http.createServer((req, res) => {
    seen.push({ url: req.url, login: req.headers['tailscale-user-login'] })
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<p>a page that is not the hub</p>')
  })
  await new Promise((resolve, reject) => {
    s.once('error', reject)
    s.listen(port, host, resolve)
  })
  return { seen, close: () => new Promise(r => s.close(r)) }
}

/** The phone's request as tailscale serve passes it on: the saved link's path at its address, and the owner's login. */
const phoneAsks = (k, port = at) => status(PORT, `/${k}/api/state`, `${MAC}:${port}`, { 'Tailscale-User-Login': OWNER })

test('a key caught by a program that held the port while the hub was down opens nothing once the hub is back', async () => {
  await halt()
  const caught = key
  const caughtAt = at
  const s = await squatter(PORT, '127.0.0.1')
  try {
    assert.equal(await phoneAsks(caught), 200) // the stand-in answered the phone
    assert.equal(s.seen[0]?.url, `/${caught}/api/state`)
    assert.equal(s.seen[0]?.login, OWNER)
  } finally {
    await s.close()
  }
  // a mode loosened while the hub was down is fixed by the next one, too
  await chmod(join(dir, 'secret'), 0o644)
  await chmod(dir, 0o755)
  await start()
  assert.notEqual(key, caught)
  assert.equal(await mode(join(dir, 'secret')), 0o600)
  assert.equal(await mode(dir), 0o700)
  // the caught key with the caught login, from this Mac: 404 everywhere, as any wrong key
  for (const path of ['/api/ping', '/api/state', '/', '/app.js']) {
    assert.equal(await status(PORT, `/${caught}${path}`, `127.0.0.1:${PORT}`, { 'Tailscale-User-Login': OWNER }), 404, path)
  }
  assert.equal(await status(PORT, `/${key}/api/ping`), 200)
  // and the new start is at another address: the new key is never answered at the one the stand-in held
  assert.notEqual(at, caughtAt)
  assert.equal(await phoneAsks(key, caughtAt), 421)
  assert.equal(await phoneAsks(key), 200)
})

test('a program bound beside the running hub, on 0.0.0.0, catches only a key that is dead once the hub is back', async t => {
  let s
  try {
    s = await squatter(PORT, '0.0.0.0')
  } catch (err) {
    return t.skip(`this Mac refuses the bind beside the hub (${err.code}): nothing to catch`)
  }
  try {
    assert.equal(await status(PORT, `/${key}/api/ping`), 200) // while the hub runs, 127.0.0.1 is the hub's
    assert.equal(s.seen.length, 0)
    await halt()
    const caught = key
    assert.equal(await phoneAsks(caught), 200)
    assert.equal(s.seen.at(-1)?.url, `/${caught}/api/state`)
    await start() // beside the stand-in still bound to 0.0.0.0
    assert.notEqual(key, caught)
    assert.equal(await status(PORT, `/${caught}/api/ping`, `127.0.0.1:${PORT}`, { 'Tailscale-User-Login': OWNER }), 404)
    assert.equal(await status(PORT, `/${key}/api/ping`), 200)
  } finally {
    await s.close()
  }
})

test('one failed read of the key file does not renew the key: the phone\'s link keeps opening', async () => {
  const had = key
  await chmod(join(dir, 'secret'), 0o000)
  try {
    await sleep(5000) // two steps of the hub, with a file it cannot read
  } finally {
    await chmod(join(dir, 'secret'), 0o600)
  }
  assert.equal(await readKey(dir), had)
  assert.equal(await status(PORT, `/${had}/api/ping`), 200)
})

test('a key file removed or changed while the hub runs gets a new key, and the old link stops opening', async () => {
  const had = key
  await writeFile(join(dir, 'secret'), 'cd'.repeat(32) + '\n', { mode: 0o600 })
  assert.ok(await waitFor(async () => isKey(await readKey(dir)) && (await readKey(dir)) !== 'cd'.repeat(32), 100, 50))
  key = await readKey(dir)
  assert.notEqual(key, had)
  assert.equal(await status(PORT, `/${had}/api/ping`), 404)
  assert.equal(await status(PORT, `/${'cd'.repeat(32)}/api/ping`), 404)
  assert.equal(await status(PORT, `/${key}/api/ping`), 200)
})

// ── key renewal ─────────────────────────────────────────────────────────────────────────────

test('a running hub renews its key when it passes its age', async () => {
  const d = await mkdtemp(join(root, 'renew-'))
  const h = spawnHub(RENEW, d, ['--key-max-age-ms', '2500'])
  try {
    assert.ok(await waitFor(async () => isKey(await readKey(d))))
    const first = await readKey(d)
    assert.ok(await waitFor(async () => (await readKey(d)) !== first, 160, 50), 'the key was not renewed')
    const next = await readKey(d)
    assert.ok(isKey(next))
    assert.equal(await status(RENEW, `/${first}/api/ping`), 404)
    assert.equal(await status(RENEW, `/${next}/api/ping`), 200)
  } finally {
    await stopHub(h)
  }
})

// ── low ones ────────────────────────────────────────────────────────────────────────────────

test('a request the hub cannot read is 404, not 500', async () => {
  assert.equal(await status(PORT, '//['), 404)
})

test('a mode loosened while the hub runs is fixed again', async () => {
  await chmod(join(dir, 'secret'), 0o644)
  await chmod(join(dir, 'inbox.json'), 0o644)
  assert.ok(await waitFor(async () => (await mode(join(dir, 'secret'))) === 0o600 && (await mode(join(dir, 'inbox.json'))) === 0o600, 100, 50))
})

// ── round 3: each start of the hub has its own address ──────────────────────────────────────

test('the key file names this start\'s address on its second line, and hub.json keeps the ports taken', async () => {
  assert.ok(Number.isInteger(at) && at >= PHONE_PORTS[0] && at < PHONE_PORTS[1], String(at))
  assert.equal((await readFile(join(dir, 'secret'), 'utf8')).split('\n').length, 3) // key, port, end
  const v = JSON.parse(await readFile(join(dir, 'hub.json'), 'utf8'))
  assert.equal(v.phonePorts.at(-1), at)
})

test('each start takes an address of its own, never one an earlier start took', async () => {
  const d = await mkdtemp(join(root, 'addr-'))
  const seen = []
  for (let i = 0; i < 3; i++) {
    const h = spawnHub(ADDR, d)
    try {
      assert.ok(await waitFor(async () => h.out.includes('desk hub ') && isKey(await readKey(d))), h.out)
      seen.push(await readAt(d))
    } finally {
      await stopHub(h)
    }
  }
  assert.equal(new Set(seen).size, 3, String(seen))
  assert.deepEqual(JSON.parse(await readFile(join(d, 'hub.json'), 'utf8')).phonePorts, seen)
  // the choice itself: a port no earlier start took, when only one is left
  const used = []
  for (let p = PHONE_PORTS[0]; p < PHONE_PORTS[1]; p++) if (p !== 31337) used.push(p)
  assert.equal(phonePort(used, ADDR), 31337)
  assert.notEqual(phonePort([], 31337), 31337)
})

test('under its key, the hub answers only at its own address for this start', async () => {
  const who = { 'Tailscale-User-Login': OWNER }
  assert.equal(await status(PORT, `/${key}/api/state`, `${MAC}:${at}`, who), 200)
  for (const host of [`${MAC}:${at === PHONE_PORTS[0] ? at + 1 : at - 1}`, `${MAC}:${PORT}`, `${MAC}`, `other.tail.ts.net:${at}`, `127.0.0.1:${PORT}`, `localhost:${PORT}`]) {
    assert.equal(await status(PORT, `/${key}/api/state`, host, who), 421, host)
    assert.equal(await status(PORT, `/${key}/`, host, who), 421, host)
  }
  // the proof: from this Mac, or at its own address; an earlier address gets 404 like anything else
  const n = 'ab'.repeat(16)
  assert.equal(await status(PORT, `/api/proof?n=${n}`, `${MAC}:${at}`), 200)
  assert.equal(await status(PORT, `/api/proof?n=${n}`, `127.0.0.1:${PORT}`), 200)
  assert.equal(await status(PORT, `/api/proof?n=${n}`, `${MAC}:${PORT}`), 404)
})
