// Send to phone: a local server put on the person's tailnet with `tailscale serve`, so the
// phone opens it at https://<this mac>.<tailnet>.ts.net:<port>, reachable inside the tailnet
// only (serve, never funnel).
//
// The serve config may hold the person's own handlers. The desk never changes one: it reuses
// a handler that already sends to the asked port, picks a port no handler has, and turns off
// only a serve it made itself and still finds sending where it left it. It never resets.
//
// Everything here but `sendToPhone` and `stopServe` is pure, so it is tested alone.

import type { EngineInterface } from 'claude-code'

import type { PhoneLink, Served } from '../types'
import { qrRows } from './qr'

export const TAILSCALE = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
export const SERVE = 'serve:'

/** `tailscale serve status --json`, as far as the desk reads it. */
export type ServeConfig = {
  TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean; TCPForward?: string }>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string }> }>
}

export type Handler = { host: string; port: number; path: string; proxy: string }

export function handlers(cfg: ServeConfig): Handler[] {
  const out: Handler[] = []
  for (const [hostPort, web] of Object.entries(cfg.Web ?? {})) {
    const at = hostPort.lastIndexOf(':')
    const host = hostPort.slice(0, at)
    const port = Number(hostPort.slice(at + 1))
    for (const [path, h] of Object.entries(web.Handlers ?? {})) out.push({ host, port, path, proxy: h.Proxy ?? '' })
  }
  return out
}

/** The local port a proxy target sends to, or 0: http://127.0.0.1:4317, localhost:3000, 3000. */
export function proxyPort(proxy: string): number {
  const m = /^(?:https?(?:\+insecure)?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])?:?(\d{2,5})(?:\/.*)?$/.exec(proxy.trim())
  return m === null ? 0 : Number(m[1])
}

/** The ports the serve config holds, of any kind. */
export function takenPorts(cfg: ServeConfig): Set<number> {
  const out = new Set<number>()
  for (const p of Object.keys(cfg.TCP ?? {})) out.add(Number(p))
  for (const h of handlers(cfg)) out.add(h.port)
  return out
}

/** A handler at the root already sending to this local port, which the phone may simply use. */
export function existingFor(cfg: ServeConfig, localPort: number): Handler | undefined {
  return handlers(cfg).find(h => h.path === '/' && proxyPort(h.proxy) === localPort)
}

/** The tailnet port for a local one: the same number when no handler has it, else the next free. */
export function pickPort(cfg: ServeConfig, localPort: number): number {
  const taken = takenPorts(cfg)
  if (!taken.has(localPort)) return localPort
  for (let p = 8000; p < 65535; p++) if (!taken.has(p) && p !== localPort) return p
  throw new Error('no free port for the serve')
}

export const urlOf = (dns: string, port: number) => `https://${dns.replace(/\.$/, '')}${port === 443 ? '' : `:${port}`}`

/** Where the local server listens, from `lsof -iTCP:<port> -sTCP:LISTEN`: the proxy target, or none. */
export function targetFromLsof(out: string, port: number): string {
  const names = out
    .split('\n')
    .slice(1)
    .map(line => line.trim().split(/\s+/).slice(-2, -1)[0] ?? '')
    .filter(n => n.endsWith(`:${port}`))
  if (names.length === 0) return ''
  if (names.some(n => n.startsWith('*:') || n.startsWith('127.0.0.1:') || n.startsWith('0.0.0.0:'))) return `http://127.0.0.1:${port}`
  if (names.some(n => n.startsWith('[::1]:') || n.startsWith('[::]:'))) return `http://[::1]:${port}`
  return `http://127.0.0.1:${port}`
}

/** What the link's check from this Mac says, in a line: curl's status and body. */
export function checkLine(status: number, body: string): string {
  if (status === 0) return 'not reached from this Mac yet; give it a few seconds, or check that Tailscale is on.'
  if (/Blocked request\. This host .* is not allowed/i.test(body)) {
    return `the server refuses the tailnet name (Vite: add ".ts.net" to server.allowedHosts).`
  }
  if (status >= 200 && status < 400) return `opens (HTTP ${status}).`
  return `answers HTTP ${status}.`
}

/** The ask a port must pass: a whole number in range. */
export function portOf(text: string): number {
  const n = Number(text.trim().replace(/^:/, ''))
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 0
}

function ts($: EngineInterface, args: string[]) {
  return $.process.run([TAILSCALE, ...args], { timeoutMs: 20_000 })
}

async function config($: EngineInterface): Promise<ServeConfig> {
  const r = await ts($, ['serve', 'status', '--json'])
  if (r.exitCode !== 0) throw new Error(`tailscale serve status: ${(r.stderr || r.stdout).trim()}`)
  const text = r.stdout.trim()
  return text === '' ? {} : (JSON.parse(text) as ServeConfig)
}

async function dnsName($: EngineInterface): Promise<string> {
  const r = await ts($, ['status', '--json'])
  if (r.exitCode !== 0) throw new Error(`tailscale status: ${(r.stderr || r.stdout).trim()}`)
  const self = (JSON.parse(r.stdout) as { Self?: { DNSName?: string; Online?: boolean } }).Self
  const name = (self?.DNSName ?? '').replace(/\.$/, '')
  if (name === '') throw new Error('Tailscale has no name for this Mac; is it signed in?')
  return name
}

async function check($: EngineInterface, url: string): Promise<string> {
  const r = await $.process.run(['curl', '-sS', '--max-time', '20', '-w', '\n__status__%{http_code}', url], {
    timeoutMs: 25_000,
  })
  const at = r.stdout.lastIndexOf('\n__status__')
  const status = at === -1 ? 0 : Number(r.stdout.slice(at + 11)) || 0
  return checkLine(status, at === -1 ? r.stdout : r.stdout.slice(0, at))
}

/**
 * Puts a local port on the tailnet (or finds it there already) and makes its link and code.
 * `note` reports each step as it goes.
 */
export async function sendToPhone(
  $: EngineInterface,
  localPort: number,
  by: string,
  note: (line: string) => Promise<void>,
): Promise<PhoneLink> {
  await note(`Looking for a server on :${localPort}…`)
  const lsof = await $.process.run(['lsof', '-nP', `-iTCP:${localPort}`, '-sTCP:LISTEN'], { timeoutMs: 10_000 })
  const target = targetFromLsof(lsof.stdout, localPort)
  if (target === '') throw new Error(`nothing listens on :${localPort} on this Mac.`)

  const cfg = await config($)
  const dns = await dnsName($)
  const had = existingFor(cfg, localPort)
  let httpsPort: number
  let isOurs = false
  if (had !== undefined) {
    httpsPort = had.port
  } else {
    httpsPort = pickPort(cfg, localPort)
    await note(`Serving :${localPort} on your tailnet at :${httpsPort}…`)
    const r = await ts($, ['serve', '--bg', `--https=${httpsPort}`, target])
    if (r.exitCode !== 0) throw new Error(`tailscale serve: ${(r.stderr || r.stdout).trim()}`)
    isOurs = true
    const url = urlOf(dns, httpsPort)
    const served: Served = { httpsPort, localPort, target, url, at: await $.clock.now(), by }
    await $.store.set(SERVE + httpsPort, served)
  }
  const url = urlOf(dns, httpsPort)
  await note(`Checking ${url} from this Mac…`)
  return { localPort, url, qr: qrRows(url), check: await check($, url), isOurs, httpsPort }
}

/** Turns off a serve the desk made, if the config still sends that port where the desk left it. */
export async function stopServe($: EngineInterface, httpsPort: number): Promise<string> {
  const v = (await $.store.get(SERVE + httpsPort)) as Served | undefined
  if (v === undefined || typeof v.localPort !== 'number') return `the desk did not make the serve on :${httpsPort}; left as it is.`
  const cfg = await config($)
  const now = handlers(cfg).filter(h => h.port === httpsPort)
  if (now.length === 0) {
    await $.store.delete(SERVE + httpsPort)
    return `:${httpsPort} was already off.`
  }
  if (now.length !== 1 || now[0]?.path !== '/' || proxyPort(now[0].proxy) !== v.localPort) {
    return `:${httpsPort} was changed since the desk made it; left as it is.`
  }
  const r = await ts($, ['serve', `--https=${httpsPort}`, 'off'])
  if (r.exitCode !== 0) throw new Error(`tailscale serve off: ${(r.stderr || r.stdout).trim()}`)
  await $.store.delete(SERVE + httpsPort)
  return `${v.url} is off.`
}
