// simulation: a CLI in a real room, and behind it the owner's picture of Ardhanarishvara,
// traced, alive and under binary rain, with baeYYond glowing at its centre (see backdrop.ts).
// Ultramarine is the simulation, white is the one who runs it, amber is the real,
// red is a failure. Each tool call in flight is an orb rising the axis of light, work
// and tests quicken the rain, a file edit sends a ripple from the yogi and loads the
// next frame, a turn's end sends one shooting star, and contrast follows the work.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fall, Mode, Sim } from '../types'
import { scene } from './backdrop'
import { COLOR_PROBLEMS, INK, look } from './look'
import { logoBadge } from './logo'
import { CONTRAST, RAIN, horizon, rail } from './scene'

const START: Sim = { world: 0, mode: 'idle', editAt: 0, doneAt: 0, running: 0, loadedBy: 'session start' }
// Change a tag when its fields change: it declines what an earlier version stored.
export const simAtom = atom({ plugin: 'simulation', key: 'sim' } as const, START, { shape: 'sim-3' })
export const fallsAtom = atom({ plugin: 'simulation', key: 'falls' } as const, [] as Fall[], { shape: 'falls-1' })
export const heldAtom = atom({ plugin: 'simulation', key: 'held' } as const, false)
export const commandAtom = atom({ plugin: 'simulation', key: 'lastCommand' } as const, '')
/** What the last $.theme.set answered: 'drawn', or why nothing draws the theme. */
export const themeAtom = atom({ plugin: 'simulation', key: 'theme' } as const, 'not set yet')

// Which surfaces have asked for the backdrop, and when (module memory: a reload clears it).
const asked = new Map<string, number>()

const PANE = 'console'
const HOLD_MS = 1000 // each state holds a second, so a burst of calls cannot flicker the world

const READS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'NotebookRead'])
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const TEST_COMMAND =
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(pytest|jest|vitest|mocha|rspec|phpunit|tox)\b|\b(go|cargo|deno|swift|dotnet|mix|flutter)\s+test\b|\bmake\s+(test|check)\b|\bplugin\s+test\b/

/**
 * A change to the world. `steps` moves the frame on, `calls` adds to the calls in flight,
 * `zero` clears them. `edit` and `done` stamp the swap's time on `editAt` and `doneAt`;
 * the backdrop plays each once from that time, so a later redraw never replays it.
 */
type Change = Partial<Omit<Sim, 'world' | 'running' | 'editAt' | 'doneAt'>> & {
  steps?: number
  calls?: number
  zero?: boolean
  edit?: boolean
  done?: boolean
}

export function kindOf(tool: string, command: string): Fall['kind'] {
  if (EDITS.has(tool)) return 'edit'
  if (READS.has(tool)) return 'read'
  if (tool === 'Bash' && TEST_COMMAND.test(command)) return 'test'
  return 'run'
}

const bar = (n: number) => '▮'.repeat(n) + '▯'.repeat(4 - n)
const worldLabel = (world: number) => `frame ${String(world).padStart(2, '0')}`

// The module's own memory; a reload starts it over, which only resets the hold.
let lastSwap = 0
let pending: Change | null = null
let queue: Promise<void> = Promise.resolve()
let hasSound = true

async function setLook($: EngineInterface, mode: Mode) {
  let result
  try {
    result = await $.theme.set(look(mode, hasSound))
  } catch (error) {
    if (!hasSound) throw error
    hasSound = false // a build that takes no sound: keep the look without it
    $.ui.log(`simulation: sound left out: ${String(error)}`)
    result = await $.theme.set(look(mode, false))
  }
  const said = result.isDrawn ? 'drawn' : `not drawn: ${result.reason}`
  if (!result.isDrawn) $.ui.log(`simulation: theme ${said}`)
  await update($, themeAtom, () => said)
}

// Apply a change to the world, held to one swap a second. Changes that come
// inside the second are joined, and world steps add up, so no edit is lost.
function shift($: EngineInterface, change: Change): Promise<void> {
  const steps = (pending?.steps ?? 0) + (change.steps ?? 0)
  const calls = change.zero === true ? 0 : (pending?.calls ?? 0) + (change.calls ?? 0)
  const zero = change.zero === true || (pending?.zero === true && change.zero !== false)
  pending = {
    ...(pending ?? {}),
    ...change,
    // a one-shot set inside the second survives a later change that does not name it
    edit: change.edit ?? pending?.edit,
    done: change.done ?? pending?.done,
    steps,
    calls,
    zero,
  }
  // One flush at a time: each waits for the last, then takes whatever has gathered.
  queue = queue.then(() => flush($)).catch(error => $.ui.log(`simulation: ${String(error)}`))

  return queue
}

async function flush($: EngineInterface) {
  if (pending === null) return
  const wait = lastSwap + HOLD_MS - (await $.clock.now())
  if (wait > 0) await $.clock.sleep(wait)
  if (pending === null) return
  const { steps: n = 0, calls = 0, zero = false, edit, done, ...rest } = pending
  pending = null
  lastSwap = await $.clock.now()
  const before = await read($, simAtom)
  const after: Sim = {
    ...before,
    ...rest,
    world: before.world + n,
    running: zero ? 0 : Math.max(0, before.running + calls),
    editAt: edit === true ? lastSwap : before.editAt,
    doneAt: done === true ? lastSwap : before.doneAt,
  }
  if (JSON.stringify(after) === JSON.stringify(before)) return
  await update($, simAtom, () => after)
  if (after.mode !== before.mode) await setLook($, after.mode)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = COLOR_PROBLEMS.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) $.ui.toast(unpainted)
    const sim = await read($, simAtom)
    await setLook($, sim.mode)
    await $.command.register({ name: 'console', description: 'Open the simulation console: the eyes, the rain rail and the log' })
    void $.ui.open({ id: PANE, title: 'console' })

    return next(e)
  })

  on('command.run', { command: 'console' }, async $ => {
    await $.ui.open({ id: PANE, title: 'console' })

    return { text: 'Console open.' }
  })

  on('turn.start', async ($, e, next) => {
    void shift($, { mode: 'working', zero: true })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void shift($, { mode: 'idle', done: true, zero: true })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const command = e.tool === 'Bash' ? String((e as { command?: unknown }).command ?? '') : ''
    const kind = kindOf(e.tool, command)
    const started = await $.clock.now()
    const target = String((e as { file_path?: unknown }).file_path ?? (e as { pattern?: unknown }).pattern ?? command).split('/').pop() ?? ''
    const fall: Fall = { id: e.tool_use_id, kind, label: `${e.tool} ${target}`.trim().slice(0, 36), isDone: false, ms: 0 }
    await update($, fallsAtom, list => [...list, fall].slice(-40))
    if (command !== '') await update($, commandAtom, () => command.split('\n')[0]!.slice(0, 48))

    const sim = await read($, simAtom)
    if (kind === 'test') void shift($, { mode: 'tests', calls: 1 })
    else void shift($, { calls: 1, ...(sim.mode === 'error' || sim.mode === 'idle' ? { mode: 'working' as const } : {}) })

    const ran = await next(e)
    const ms = (await $.clock.now()) - started
    const hasFailed = ran.deny === undefined && ran.isError === true
    await update($, fallsAtom, list =>
      list.map(one => (one.id === fall.id ? { ...one, isDone: true, ms, kind: hasFailed ? 'fail' : one.kind } : one)),
    )

    if (hasFailed) {
      void shift($, { mode: 'error', calls: -1 })
    } else if (kind === 'edit' && ran.deny === undefined) {
      void shift($, { steps: 1, edit: true, loadedBy: fall.label, calls: -1 })
    } else if (kind === 'test') {
      void shift($, { mode: 'working', calls: -1 })
    } else {
      void shift($, { calls: -1 })
    }

    return ran
  })

  // The world itself.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.plugin !== $.plugin.name) return next(e)
    const { Svg } = $.ui.resolve(e)
    const sim = await read($, simAtom)
    const held = await read($, heldAtom)
    const now = await $.clock.now()
    asked.set(e.surface, now)
    const age = (at: number) => (at > 0 ? (now - at) / 1000 : null)
    const alt = `Ardhanarishvara, half Shiva and half Parvati, above a meditating yogi, among galaxies and floating mountains with waterfalls, under binary rain at level ${RAIN[sim.mode]}, with ${sim.running} orbs rising the axis of light, and baeYYond glowing at the centre`

    // One Svg, the whole answer, as the app is known to draw it (see backdrop.ts).
    return (
      <Svg
        source={scene({ mode: sim.mode, running: sim.running, editAge: age(sim.editAt), doneAge: age(sim.doneAt), now: now / 1000, held })}
        alt={alt}
        isInteractive
      />
    )
  })

  // The band: the world's state in words, and the hold.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const sim = await read($, simAtom)
    const held = await read($, heldAtom)
    const last = await read($, commandAtom)
    const theme = await read($, themeAtom)
    const folder = (await $.session.cwd()).split('/').pop() ?? ''

    return (
      <Box flexDirection="row" gap={2} alignItems="center">
        {Svg !== undefined && <Svg source={logoBadge(sim.mode)} alt="baeYYond" width={80} height={20} />}
        {theme !== 'drawn' && <Text color={INK.red}>backdrop {theme}</Text>}
        <Text color={INK.amber}>op@sim ~/{folder} $</Text>
        <Text color={INK.text}>{last === '' ? ' ' : last}</Text>
        <Text color={INK.secondary}>rain {bar(RAIN[sim.mode])}</Text>
        <Text color={INK.secondary}>contrast {CONTRAST[sim.mode].toFixed(1)}</Text>
        <Text color={sim.mode === 'error' ? INK.red : INK.secondary}>{sim.mode === 'error' ? 'failed' : worldLabel(sim.world)}</Text>
        <Button key="hold" label={held ? '▶ resume motion' : '❚❚ hold motion'} onPress={() => update($, heldAtom, h => !h)} />
      </Box>
    )
  })

  // The console: the eyes of the picture, the rain rail, the log.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Svg = 'Svg' in els ? els.Svg : undefined // the terminal draws the words alone
    const sim = await read($, simAtom)
    const falls = await read($, fallsAtom)
    const failed = falls.filter(f => f.kind === 'fail').length
    const colour: Record<Fall['kind'], string> = { read: INK.ultra, run: INK.ultra, edit: INK.amber, test: INK.text, fail: INK.red }
    const theme = await read($, themeAtom)
    const now = await $.clock.now()
    const seen = [...asked].map(([surface, at]) => `${surface} ${Math.round((now - at) / 1000)}s ago`).join(', ')

    return (
      <Box flexDirection="column" gap={1}>
        {Svg !== undefined && <Svg source={logoBadge(sim.mode)} alt="baeYYond" width={200} height={49} />}
        <Text color={theme === 'drawn' ? INK.muted : INK.red}>
          THEME · {theme} · backdrop asked by {seen === '' ? 'no surface yet' : seen}
        </Text>
        <Text color={INK.muted}>EYES · {worldLabel(sim.world)} · loaded by {sim.loadedBy}</Text>
        {Svg !== undefined && <Svg source={horizon(sim.mode)} alt={sim.mode === 'error' ? 'The eyes of Ardhanarishvara, red: a tool failed' : 'The eyes and the third eye of Ardhanarishvara'} width={328} height={70} />}
        <Text color={INK.muted}>RAIN RAIL · one lane per tool call</Text>
        {Svg !== undefined && <Svg source={rail(falls)} alt={`${falls.length} tool calls on the rail, ${failed} failed`} width={328} height={250} />}
        <Text color={INK.secondary}>
          rain {bar(RAIN[sim.mode])} · orbs {sim.running} · contrast {CONTRAST[sim.mode].toFixed(1)} · failed {failed}
        </Text>
        <Text color={INK.muted}>LOG</Text>
        {falls.length === 0 && <Text color={INK.muted}>No tool calls yet. The simulation idles.</Text>}
        {falls.slice(-12).reverse().map(f => (
          <Text key={f.id} color={f.isDone ? INK.secondary : INK.text}>
            <Text color={colour[f.kind]}>▾ </Text>
            {f.label} · {f.isDone ? (f.kind === 'fail' ? 'failed' : `${(f.ms / 1000).toFixed(1)}s`) : 'running'}
          </Text>
        ))}
      </Box>
    )
  })

  // The turn line in terminal verbs; a tool row keeps the app's own words.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.mode === 'tool-use' || e.props.message !== null) return next(e)
    const sim = await read($, simAtom)
    const word =
      sim.mode === 'tests' ? 're-running the simulation'
        : e.props.mode === 'thinking' ? 'compiling the next frame'
          : e.props.mode === 'responding' ? 'streaming'
            : 'dialing the carrier'

    return next({ ...e, props: { ...e.props, word } })
  })

  // The hint keeps the app's words and says the line is open.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    const state = e.props.isWorking ? '-- carrier busy --' : '-- carrier open --'

    return next({ ...e, props: { ...e.props, hint: e.props.hint === '' ? state : `${state} ${e.props.hint}` } })
  })

  // Change the simulation by hand.
  on('ui.render', { component: 'ContextMenu' }, async ($, e, next) => {
    if (e.props.link !== undefined || e.props.selection !== undefined) return next(e)
    const { Button, Text } = $.ui.resolve(e)
    const sim = await read($, simAtom)

    return (
      <Button key="reload" onPress={() => shift($, { steps: 1, edit: true, loadedBy: 'your hand' })}>
        ↯ Load the next frame <Text dimColor>{worldLabel(sim.world + 1)}</Text>
      </Button>
    )
  })
}
