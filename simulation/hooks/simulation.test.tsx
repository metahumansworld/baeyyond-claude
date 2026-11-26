import Perch, { frame, moving, ROWS, type Cell, type PerchProps } from './perch'
import { expect, test } from 'claude-code/testing'

import type { Mode } from '../types'
import { kindOf } from './register'
import { FLOOR, scene } from './backdrop'
import { PACE, RAIN_INK, encodeCells, rainCells } from './rain'
import { COLORS, INK } from './look'
import { logoBadge } from './logo'

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

const at = (mode: Mode, running: number, extra: Partial<Parameters<typeof scene>[0]> = {}) =>
  scene({ mode, running, editAge: null, doneAge: null, failAge: null, now: 0, held: false, ...extra })

test('the backdrop, one Svg, stays under the 131,072-character cap in every state', async () => {
  const modes: Mode[] = ['idle', 'working', 'tests', 'error']
  let largest = 0
  for (const mode of modes) {
    for (let running = 0; running <= 6; running++) {
      largest = Math.max(largest, at(mode, running, { editAge: 0, doneAge: 0, held: true, now: 12345.6 }).length)
    }
  }
  expect(largest).toBeLessThan(131072)
})

test('the backdrop keeps no picture, font or script', async () => {
  for (const svg of [at('tests', 3, { editAge: 1, doneAge: 1 }), at('error', 0), logoBadge('idle')]) {
    expect(/<image|<script|<foreignObject|@import|<!\[CDATA|\\/.test(svg)).toBe(false)
    // the only href is the mark's own, a local fragment
    expect(svg.replace(/<use href="#mk"\/>/g, '')).not.toContain('href')
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

test('the third eye is red, blinks with the two eyes, and a failure turns all three red', async () => {
  const idle = at('idle', 0)
  expect(idle.match(/class="lid"/g)?.length).toBe(3)
  expect(new Set(idle.match(/class="lid" style="animation-delay:[^"]+"/g)).size).toBe(1)
  expect(idle).toContain('#ff3048')
  expect(idle).not.toContain('#ff6b80')
  expect(at('error', 0)).toContain('#ff6b80')
  // the eyes come after the cap, so darken cannot turn the red blue
  expect(idle.indexOf('class="lid"')).toBeGreaterThan(idle.indexOf('mix-blend-mode:darken'))
})

test('the whole picture flashes by itself, and once on an edit, an ended turn or a failure', async () => {
  const idle = at('idle', 0)
  expect(idle.match(/class="fl"/g)?.length).toBe(1)
  expect(idle).not.toContain('class="fo"')
  expect(idle.indexOf('class="fl"')).toBeGreaterThan(idle.indexOf('mix-blend-mode:darken'))
  expect(at('error', 0, { failAge: 0.2 })).toContain('fill="#ff4060"')
  expect(at('idle', 0, { editAge: 0.2 }).match(/class="fo"/g)?.length).toBe(1)
  expect(at('idle', 0, { doneAge: 5 })).not.toContain('class="fo"')
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

test('a failed tool shows on the rail, and the perch on the composer turns red', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: 'exit 1', isError: true }) as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  await settle()

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /failed 1/ }))?.text).toMatch(/contrast 0\.1/)
  await pane.unmount()

  const cell = await $.ui.mount({
    plugin: 'simulation', surface: 'desktop', component: 'BesidePrompt',
    props: { maxColumns: 20, floatRows: 8, floatColumns: 80, isWorking: false } as never,
  })
  const perch = await cell.find({ type: 'Client' })
  expect(String(perch?.props.module)).toMatch(/perch\.tsx$/)
  expect((perch?.props.props as PerchProps).mode).toBe('error')
  await cell.unmount()
})

test('the backdrop draws the scene, and hold motion in the console pauses it', async ($, on) => {
  engine(on)
  const BACKDROP = {
    plugin: 'simulation', surface: 'desktop', component: 'Backdrop',
    props: { scene: 'simulation', plugin: 'simulation', glass: false },
  } as const
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'hold' })
  await pane.unmount()

  const ui = await $.ui.mount(BACKDROP)
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs).toHaveLength(1)
  expect(svgs[0]?.props.isInteractive).toBe(true)
  expect(String(svgs[0]?.props.source)).toContain('animation-play-state:paused')
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
    return String(svgs[0]?.props.source).includes('class="burst"')
  }

  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/sun.ts', old_string: 'a', new_string: 'b' })
  await settle()
  expect(await ripple()).toBe(true)

  await $.tool.call({ tool: 'Grep', pattern: 'sun' })
  await settle()
  expect(await ripple()).toBe(false)
})

test('the mark sits at the centre over the cap, glows, and turns red on a failure', async () => {
  const rest = at('idle', 0)
  expect(rest).toContain('translate(520 445.2)')
  expect(rest).toContain('filter="url(#lb)"')
  expect(rest.indexOf('mix-blend-mode:darken')).toBeLessThan(rest.indexOf('translate(520 445.2)'))
  expect(rest).not.toContain('url(#veil)')
  expect(at('error', 0)).toContain('#ff4d64')
})

test('above the composer only the mark stays: other mods\' rows are left out', async ($, on) => {
  engine(on)
  const row = (plugin: string) => ({ plugin, tree: { type: 'Text', props: {}, children: [plugin] } })
  const list = await $.ui.mount({
    plugin: 'simulation', surface: 'desktop', component: 'AbovePromptList',
    props: { rows: [row('simulation'), row('session-cost')], hasSurvey: false } as never,
  })
  expect(await list.find({ type: 'Text', text: /^simulation$/ })).toBeDefined()
  expect(await list.find({ type: 'Text', text: /^session-cost$/ })).toBeUndefined()
  await list.unmount()
})

test('the perch floats on the composer, and steps aside where there is no room', async ($, on) => {
  engine(on)
  const mount = (floatColumns: number) => $.ui.mount({
    plugin: 'simulation', surface: 'desktop', component: 'BesidePrompt',
    props: { maxColumns: 20, floatRows: 8, floatColumns, isWorking: false } as never,
  })
  const roomy = await mount(80)
  const float = (await roomy.findAll({ type: 'Box' })).find(b => b.props.position === 'absolute')
  expect(float?.props.anchor).toBe('above')
  expect(float?.props.right).toBe(0)
  expect(await roomy.find({ type: 'Client' })).toBeDefined()
  await roomy.unmount()
  const tight = await mount(4)
  expect(await tight.find({ type: 'Client' })).toBeUndefined()
  await tight.unmount()
})

test('the mark decodes out of binary, a light sweeps it, then it rests', async () => {
  const text = (cells: Cell[][]) => cells.map(r => r.map(c => c.ch).join('')).join('\n')
  const rest = frame(6000, 'idle')
  expect(text(rest)).toBe(ROWS.join('\n'))
  expect(text(rest)).toContain('baeYYond')
  // at the start of the cycle the cells are bits, and by the end of the decode they are the mark
  expect(text(frame(50, 'idle'))).toMatch(/[01]/)
  expect(text(frame(50, 'idle'))).not.toContain('baeYYond')
  expect(text(frame(1250, 'idle'))).toBe(ROWS.join('\n'))
  // the sweep lights one column at a time
  const lit = frame(1900, 'idle').flat().filter(c => c.color === '#eef1ff').length
  expect(lit).toBeGreaterThan(0)
  expect(frame(6000, 'idle').flat().some(c => c.color === '#eef1ff')).toBe(false)
  // red on a failure, and still (the resting mark) when held, at any moment
  expect(frame(6000, 'error').flat().some(c => c.color === '#ff7d75')).toBe(true)
  expect(text(frame(50, 'idle', true))).toBe(ROWS.join('\n'))
  expect(moving(500)).toBe(true)
  expect(moving(6000)).toBe(false)
})

test('the perch draws the mark in rows, and holds still when motion is held', async () => {
  const text = (el: unknown): string => {
    const n = el as { props?: { children?: unknown } }
    const kids = n?.props?.children
    if (typeof kids === 'string') return kids
    return Array.isArray(kids) ? kids.map(text).join(n === el && (el as { type?: string }).type === 'Box' ? '\n' : '') : ''
  }
  const mk = (type: string) => (props: Record<string, unknown>) => ({ type, props })
  let state: unknown
  const surface = {
    elements: { Box: mk('Box'), Text: mk('Text') }, get state() { return state },
    setState: (s: unknown) => { state = s }, every: () => () => {}, isWindowFocused: true, isMotionReduced: false,
  } as never
  // now at 0 is the start of the decode (bits), but a hold draws the resting mark
  expect(text(Perch({ now: 0, mode: 'idle', held: true }, surface))).toBe(ROWS.join('\n'))
  expect(text(Perch({ now: 0, mode: 'idle', held: false }, surface))).toMatch(/[01]/)
})

test('the art fades into the composer\'s navy at the window\'s foot, over everything, so its panel shows no edge', () => {
  const s = at('idle', 0, { doneAge: 0.2 })
  // the art keeps its own frame inside an outer svg measured in points
  expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><svg viewBox="0 0 1600 1000"')).toBe(true)
  // the floor is drawn last, over the flashes, held to the bottom edge by points, not by the frame
  const floorAt = s.indexOf('fill="url(#floor)"')
  expect(floorAt).toBeGreaterThan(s.lastIndexOf('class="fo"'))
  expect(floorAt).toBeGreaterThan(s.lastIndexOf('class="fl"'))
  const all = FLOOR.solid + FLOOR.fade
  expect(s).toContain(`<rect y="100%" width="100%" height="${all}" transform="translate(0 -${all})" fill="url(#floor)"/>`)
  // clear at its top, the composer's own ground (surface-1) from the fade's end down
  expect(s).toContain(`<stop offset="0.000" stop-color="${FLOOR.color}" stop-opacity="0.000"/>`)
  expect(s).toContain(`<stop offset="${(FLOOR.fade / all).toFixed(3)}" stop-color="${FLOOR.color}" stop-opacity="1.000"/>`)
  expect(FLOOR.color).toBe(INK.s1)
  // the art's frame closes before the floor, and the floor closes the outer svg
  expect(s.endsWith('fill="url(#floor)"/></svg>')).toBe(true)
  expect(s.indexOf('</svg><defs><linearGradient id="floor"')).toBeGreaterThan(0)
})

test('the composer\'s ring is the rain\'s blue, not amber', () => {
  const dark = (COLORS as unknown as { inputs: { dark: Record<string, string> } }).inputs.dark
  expect(dark['role-accent-fill']).toBe('#576df2')
  expect(INK.rain).toBe('#5f7cff')
})

test('the terminal rain: binary streams in the art\'s blues, blank elsewhere, red after a failure, moving', () => {
  const cols = 60
  const rows = 20
  const frame = rainCells(cols, rows, 40, 'idle')
  expect(frame.length).toBe(cols * rows * 3)
  const blue = new Set<number>(RAIN_INK.blue)
  let drops = 0
  for (let i = 0; i < cols * rows; i++) {
    const [ch, fg, bg] = [frame[i * 3] ?? -1, frame[i * 3 + 1] ?? -1, frame[i * 3 + 2] ?? -1]
    expect(bg).toBe(0x01000000) // never a background: the interface keeps its own
    if (ch === 0x20) {
      expect(fg).toBe(0x01000000) // a blank stays unpainted
    } else {
      expect(ch === 0x30 || ch === 0x31).toBe(true)
      expect(blue.has(fg)).toBe(true)
      drops += 1
    }
  }
  expect(drops).toBeGreaterThan(0)
  // only some columns carry a stream, and work brings more of them than idle
  const columnsWith = (cells: Uint32Array) => {
    const seen = new Set<number>()
    for (let i = 0; i < cols * rows; i++) if (cells[i * 3] !== 0x20) seen.add(i % cols)
    return seen.size
  }
  expect(columnsWith(frame)).toBeLessThan(cols / 2)
  expect(PACE.tests.every).toBeLessThan(PACE.idle.every)
  // a failure turns it red
  const red = new Set<number>(RAIN_INK.red)
  const failed = rainCells(cols, rows, 40, 'error')
  for (let i = 0; i < cols * rows; i++) if (failed[i * 3] !== 0x20) expect(red.has(failed[i * 3 + 1] ?? -1)).toBe(true)
  // and it falls: a later tick is another frame
  expect(encodeCells(rainCells(cols, rows, 41, 'idle'))).not.toBe(encodeCells(frame))
})

test('the rain\'s cells are packed as the Raster wants them: little-endian triplets in padded base64', () => {
  expect(encodeCells(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
  expect(encodeCells(Uint32Array.of(0x31))).toBe('MQAAAA==')
})

test('the terminal draws the rain as one Raster the window\'s size; the desktop app draws none', async ($, on) => {
  engine(on)
  on('clock.every', () => ({ value: { cancel: () => undefined } }) as never)
  const mount = (surface: string) => $.ui.mount({
    plugin: 'simulation', surface, component: 'Underlay',
    props: { columns: 70, rows: 22, isWorking: false, view: {} },
  } as never)
  const term = await mount('terminal')
  const raster = await term.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(70)
  expect(raster?.props.rows).toBe(22)
  expect(String(raster?.props.cells).length).toBe(Math.ceil((70 * 22 * 12) / 3) * 4)
  await term.unmount()
  const desk = await mount('desktop')
  expect(await desk.find({ type: 'Raster' })).toBeUndefined()
  await desk.unmount()
})
