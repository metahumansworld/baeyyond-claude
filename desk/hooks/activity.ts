// The session console's record: what runs now, the files edited, the test runs and how they
// ended, how long each turn took, and the local servers seen in commands and their output.
// Pure, so it is tested alone; register.tsx feeds it from tool calls and turns.

import type { Activity, Running, TestRun } from '../types'

export const EMPTY: Activity = { running: [], files: [], tests: [], turns: [], servers: [] }

const CAP = { files: 200, tests: 40, turns: 100, servers: 8 } as const

export const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|mocha|rspec|phpunit|tox)\b|\b(go|cargo|deno|swift|dotnet|mix|flutter)\s+test\b|\bmake\s+(test|check)\b|\bplugin\s+test\b/

/** A count of failures in a test run's output, read as a failure even where the exit code passed. */
const FAILED_COUNT = /\b[1-9]\d*\s+(failed|failing|fail|failures?|errors?)\b|^\(fail\)|^FAIL\b|^FAILED\b/m

/** Local server addresses in text: localhost, 127.0.0.1, 0.0.0.0 or [::1], with a port. */
const LOCAL = /(?<![\w.-])(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/g

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p

/** One line naming a call: the command, the file, the pattern, the agent's task. */
export function labelOf(tool: string, input: Record<string, unknown>): string {
  const clip = (s: string) => (s.length > 70 ? s.slice(0, 69) + '…' : s)
  if (tool === 'Bash') return clip(str(input.description) || str(input.command).split('\n')[0] || 'Bash')
  if (str(input.file_path) !== '') return base(str(input.file_path))
  if (str(input.notebook_path) !== '') return base(str(input.notebook_path))
  if (tool === 'Grep' || tool === 'Glob') return clip(str(input.pattern))
  if (tool === 'WebFetch') return clip(str(input.url).replace(/^https?:\/\//, ''))
  if (tool === 'WebSearch') return clip(str(input.query))
  if (tool === 'Agent' || tool === 'Task') return clip(str(input.description) || 'agent')
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp !== null) return `${mcp[1]} · ${mcp[2]}`
  return tool
}

/** The file a call edits, or none. */
export function editedPath(tool: string, input: Record<string, unknown>): string {
  if (!EDITS.has(tool)) return ''
  return str(input.file_path) || str(input.notebook_path)
}

export const isTestCommand = (tool: string, input: Record<string, unknown>) =>
  tool === 'Bash' && TEST_COMMAND.test(str(input.command))

/** How a test run ended: the tool's error, or a failure count in its output. */
export function testOutcome(isError: boolean, output: string): 'pass' | 'fail' {
  return isError || FAILED_COUNT.test(output) ? 'fail' : 'pass'
}

/** A tool's result as text: Bash's streams, a string, or the record as JSON. */
export function textOf(result: unknown): string {
  if (typeof result === 'string') return result
  if (typeof result === 'object' && result !== null) {
    const r = result as Record<string, unknown>
    const streams = [r.stdout, r.stderr, r.output, r.content].filter((v): v is string => typeof v === 'string')
    if (streams.length > 0) return streams.join('\n')
  }
  try {
    return JSON.stringify(result) ?? ''
  } catch {
    return ''
  }
}

/** Ports of local servers named in text, in order, each once; low and odd ports left out. */
export function localPorts(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(LOCAL)) {
    const port = Number(m[1])
    if (port >= 1024 && port <= 65535 && !out.includes(port)) out.push(port)
  }
  return out
}

/** A path as the console shows it: under the session's folder, relative; else whole. */
export function shortPath(path: string, cwd: string): string {
  const root = cwd.endsWith('/') ? cwd : cwd + '/'
  return path.startsWith(root) ? path.slice(root.length) : path.replace(/^\/Users\/[^/]+/, '~')
}

/** A duration: 850ms, 12s, 3m 12s, 2h 3m. */
export function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms))
  if (m < 1000) return `${m}ms`
  const s = Math.floor(m / 1000)
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}m ${s % 60}s`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

export function started(a: Activity, run: Running, test: boolean): Activity {
  const tests: TestRun[] = test
    ? [...a.tests, { id: run.id, command: run.label, state: 'running' as const, startedAt: run.startedAt, ms: 0 }].slice(-CAP.tests)
    : a.tests
  return { ...a, running: [...a.running, run], tests }
}

export function ended(
  a: Activity,
  id: string,
  now: number,
  out: { edited: string; outcome: 'pass' | 'fail' | 'skip' | ''; ports: number[]; seen: string },
): Activity {
  const run = a.running.find(r => r.id === id)
  let files = a.files
  if (out.edited !== '') {
    const had = files.find(f => f.path === out.edited)
    files = [
      ...files.filter(f => f.path !== out.edited),
      { path: out.edited, edits: (had?.edits ?? 0) + 1, at: now },
    ].slice(-CAP.files)
  }
  // a test the person refused never ran: it leaves the list
  const tests =
    out.outcome === ''
      ? a.tests
      : out.outcome === 'skip'
        ? a.tests.filter(t => t.id !== id)
        : a.tests.map(t => (t.id === id ? { ...t, state: out.outcome as 'pass' | 'fail', ms: now - t.startedAt } : t))
  let servers = a.servers
  for (const port of out.ports) {
    servers = [...servers.filter(s => s.port !== port), { port, seen: out.seen, at: now }].slice(-CAP.servers)
  }
  return { ...a, running: run === undefined ? a.running : a.running.filter(r => r.id !== id), files, tests, servers }
}

export function turnStarted(a: Activity, now: number, prompt: string): Activity {
  const n = (a.turns[a.turns.length - 1]?.n ?? 0) + 1
  const line = prompt.replace(/\s+/g, ' ').trim()
  const short = line.length > 60 ? line.slice(0, 59) + '…' : line
  return { ...a, turns: [...a.turns, { n, startedAt: now, ms: 0, prompt: short }].slice(-CAP.turns) }
}

/** A turn's end: the engine's own measure of it when given, else from its start. */
export function turnEnded(a: Activity, now: number, durationMs = 0): Activity {
  const last = a.turns[a.turns.length - 1]
  if (last === undefined || last.ms !== 0) return a
  const ms = durationMs > 0 ? durationMs : Math.max(1, now - last.startedAt)
  // calls a stopped turn left behind are no longer running
  return { ...a, turns: [...a.turns.slice(0, -1), { ...last, ms }], running: [] }
}

/** The time the turns took, summed; a running turn counts up to now. */
export function workTime(a: Activity, now: number): number {
  return a.turns.reduce((sum, t) => sum + (t.ms !== 0 ? t.ms : now - t.startedAt), 0)
}
