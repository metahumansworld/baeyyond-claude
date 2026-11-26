import { expect, test } from 'claude-code/testing'

import type { Mode } from '../types'
import { kindOf } from './register'
import { LAYERS, motion } from './backdrop'

const PANE = {
  plugin: 'simulation',
  component: 'Pane',
  requestId: 'console',
  surface: 'desktop',
  props: { title: 'console', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// Nothing sits beneath the plugin: each hook here stands for the engine.
// The clock jumps five seconds a reading, so the one-second hold never waits.
// The hold's queue runs after the call returns, as it does in a session; give it a moment.
const { setTimeout: later } = globalThis as unknown as { setTimeout: (run: () => void, ms: number) => void }
const settle = () => new Promise<void>(resolve => later(resolve, 50))

function engine(on: any, step = 5000) {
  let t = 0
  on('clock.now', () => ({ value: (t += step) }))
  on('clock.sleep', () => ({ value: undefined }))
  on('theme.set', () => ({ value: { isDrawn: true } }) as never)
  on('session.cwd', () => ({ value: '/work/matrix-sim' }))
}

const at = (mode: Mode, running: number, extra: Partial<Parameters<typeof motion>[0]> = {}) =>
  motion({ mode, running, editAge: null, doneAge: null, now: 0, held: false, ...extra })

test('every Svg of the backdrop stays under the 131,072-character cap', async () => {
  const modes: Mode[] = ['idle', 'working', 'tests', 'error']
  let largest = Math.max(...LAYERS.map(l => l.length))
  for (const mode of modes) {
    for (let running = 0; running <= 6; running++) {
      largest = Math.max(largest, at(mode, running, { editAge: 0, doneAge: 0, held: true, now: 12345.6 }).length)
    }
  }
  expect(LAYERS).toHaveLength(7)
  expect(largest).toBeLessThan(131072)
})

test('the backdrop keeps no picture, font or script', async () => {
  for (const svg of [...LAYERS, at('tests', 3, { editAge: 1, doneAge: 1 })]) {
    expect(/<image|<script|<foreignObject|href|@import|<!\[CDATA|\\/.test(svg)).toBe(false)
  }
})

test('each call in flight is one more orb, six at most', async () => {
  const orbs = (n: number) => (at('working', n).match(/class="orb"/g) ?? []).length
  expect(orbs(0)).toBe(0)
  expect(orbs(3)).toBe(3)
  expect(orbs(9)).toBe(6)
})

test('a redraw continues the motion where it was', async () => {
  const delay = (now: number) => at('idle', 0, { now }).match(/class="beam"[^>]*animation-delay:(-[\d.]+)s/)?.[1]
  expect(delay(0)).toBe('-0')
  expect(delay(2.5)).toBe('-2.5')
  expect(delay(8.5)).toBe('-2.5')
})

test('a failure turns the third eye and the rain red', async () => {
  expect(at('error', 0)).toContain('url(#rglow)')
  expect(at('idle', 0)).not.toContain('url(#rglow)')
})

test('a test command pours and a plain command does not', async () => {
  expect(kindOf('Bash', 'npm test')).toBe('test')
  expect(kindOf('Bash', 'pnpm run test -- --watch=false')).toBe('test')
  expect(kindOf('Bash', 'cargo test')).toBe('test')
  expect(kindOf('Bash', 'ls -la')).toBe('run')
  expect(kindOf('Edit', '')).toBe('edit')
  expect(kindOf('Grep', '')).toBe('read')
})

test('a file edit loads the next frame, named in the console', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/rain.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/sun.ts', old_string: 'a', new_string: 'b' })
  await settle()

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /EYES/ }))?.text).toMatch(/frame 02 · loaded by Edit sun\.ts/)
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('a failed tool shows on the rail and in the band', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'exit 1', isError: true }) as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  await settle()

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /failed 1/ }))?.text).toMatch(/contrast 0\.1/)
  await pane.unmount()

  const band = await $.ui.mount({
    plugin: 'simulation', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10 } as never,
  })
  expect((await band.find({ type: 'Text', text: /npm run lint/ }))).toBeDefined()
  expect((await band.find({ type: 'Text', text: /^failed$/ }))).toBeDefined()
  await band.unmount()
})

test('the backdrop draws the scene, and hold motion pauses it', async ($, on) => {
  engine(on)
  const BACKDROP = {
    plugin: 'simulation', surface: 'desktop', component: 'Backdrop',
    props: { scene: 'simulation', plugin: 'simulation', glass: false },
  } as const
  const band = await $.ui.mount({
    plugin: 'simulation', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10 } as never,
  })
  await band.press({ key: 'hold' })
  await band.unmount()

  const ui = await $.ui.mount(BACKDROP)
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(8)
  expect(String(svgs[7]?.props.source)).toContain('animation-play-state:paused')
  await ui.unmount()
})

test('an edit sends one ripple from the yogi, and the next call does not replay it', async ($, on) => {
  engine(on, 1000)
  on('tool.call', () => ({ result: 'ok' }) as never)
  const BACKDROP = {
    plugin: 'simulation', surface: 'desktop', component: 'Backdrop',
    props: { scene: 'simulation', plugin: 'simulation', glass: false },
  } as const
  const ripple = async () => {
    const ui = await $.ui.mount(BACKDROP)
    const svgs = await ui.findAll({ type: 'Svg' })
    await ui.unmount()
    return String(svgs[svgs.length - 1]?.props.source).includes('class="burst"')
  }

  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/sun.ts', old_string: 'a', new_string: 'b' })
  await settle()
  expect(await ripple()).toBe(true)

  await $.tool.call({ tool: 'Grep', pattern: 'sun' })
  await settle()
  expect(await ripple()).toBe(false)
})
