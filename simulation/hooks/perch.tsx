// The perch: the baeYYond mark sitting on the composer's top edge, as the app's own mascot
// sits there. Text alone (a float beside the prompt holds no picture and no glow), and one
// line of plain letters, each one cell wide in any monospace font: half blocks three rows tall
// wrapped and gapped in the app (26 Nov). Every ten seconds the mark decodes out of binary,
// left to right, a light sweeps across it, and it rests.

import type { ClientModule } from 'claude-code'

export type PerchProps = { now: number; mode: string; held: boolean }
type PerchState = { t0: number; ticks: number }

const TICK = 100
/** One decode, sweep and rest, in ms. */
export const CYCLE = 10_000
const DECODE_MS = 1300
const SWEEP_MS = 1200

const MARK = 'YY'
const NAME = 'baeYYond'
/** The mark in one row: YY, then the name. */
export const ROWS = [`${MARK} ${NAME}`]
export const COLUMNS = Math.max(...ROWS.map(r => [...r].length))
const NAME_ROW = 0
const NAME_AT = MARK.length + 1

const INK = {
  idle: { yy: '#8292ff', name: '#6f80ff', bit: '#34439c', near: '#b4bfff', peak: '#eef1ff' },
  error: { yy: '#ff6b7a', name: '#ff7d75', bit: '#7c2634', near: '#ffb0a8', peak: '#fff0ee' },
} as const

/** One cell of a frame: the character and its colour. */
export type Cell = { ch: string; color: string }

/**
 * The mark at `t` ms into the cycle: decoding (unresolved cells show a 0 or 1), the sweep
 * (a light across the columns), or at rest. Pure, so it is tested alone.
 */
export function frame(t: number, mode: string, still = false): Cell[][] {
  const ink = mode === 'error' ? INK.error : INK.idle
  const at = still ? CYCLE / 2 : ((t % CYCLE) + CYCLE) % CYCLE
  const sweep = at >= DECODE_MS && at < DECODE_MS + SWEEP_MS ? ((at - DECODE_MS) / SWEEP_MS) * (COLUMNS + 4) - 2 : null
  const bucket = Math.floor(at / 120) // the bits change a few times as they wait

  return ROWS.map((row, r) =>
    [...row].map((ch, c) => {
      if (ch === ' ') return { ch, color: ink.name }
      const base = r === NAME_ROW && c >= NAME_AT ? ink.name : ink.yy
      if (at < DECODE_MS && at < 100 + c * 50) {
        return { ch: (c * 7 + r * 3 + bucket) % 2 === 0 ? '0' : '1', color: ink.bit }
      }
      if (sweep !== null) {
        const d = Math.abs(c - sweep)
        return { ch, color: d < 0.75 ? ink.peak : d < 2 ? ink.near : base }
      }
      return { ch, color: base }
    }),
  )
}

/** Whether a frame at `t` moves at all: the decode and the sweep do, the rest does not. */
export const moving = (t: number) => {
  const at = ((t % CYCLE) + CYCLE) % CYCLE
  return at < DECODE_MS + SWEEP_MS + TICK
}

const Perch: ClientModule<PerchProps, PerchState> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    const t0 = props.now
    let n = 0
    surface.setState({ t0, ticks: 0 })
    surface.every(TICK, () => {
      n += 1
      // redraws only while the mark moves; rests with nobody looking or with less motion asked
      if (moving(t0 + n * TICK) && surface.isWindowFocused && !surface.isMotionReduced) {
        surface.setState({ t0, ticks: n })
      }
    })
  }
  const st = surface.state ?? { t0: props.now, ticks: 0 }
  const cells = frame(st.t0 + st.ticks * TICK, props.mode, surface.isMotionReduced || props.held)

  // each row as runs of one colour
  const rows = cells.map(row => {
    const runs: Cell[] = []
    for (const cell of row) {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.color === cell.color) last.ch += cell.ch
      else runs.push({ ...cell })
    }
    return Text({ children: runs.map(run => Text({ color: run.color, bold: true, children: run.ch })) })
  })

  return Box({ flexDirection: 'column', children: rows })
}

export default Perch
