// The terminal's rain. A terminal draws no picture, so the simulation falls there as real
// characters: binary streams in the blanks behind the chat, drawn into one Raster the size of
// the window and repainted on a clock. The interface always wins: a cell shows only where the
// interface left a blank, so the rain can never cover a word.
//
// Each frame is worked out from the tick alone, so it is pure, it is tested alone, and a
// resized window or a reloaded mod simply carries on. The streams are the art's: a near-white
// head, the rain's blue tail fading to the navy, red after a failure; work and tests bring
// more streams and quicken them.

import type { Mode } from '../types'

/** One frame every this many ms: ten a second, under the hundred and twenty a surface takes. */
export const RAIN_TICK = 100
/** The biggest Raster a terminal takes. */
export const RAIN_MAX = { columns: 512, rows: 256 } as const

/** How often a column carries a stream (one in `every`), and how fast streams fall (cells a tick). */
export const PACE: Record<Mode, { every: number; speed: number }> = {
  idle: { every: 4, speed: 0.35 },
  working: { every: 3, speed: 0.6 },
  tests: { every: 2, speed: 0.9 },
  error: { every: 4, speed: 0.25 },
}

/** A stream's colours from its head up: head, near, tail, dim, faint. */
export const RAIN_INK = {
  blue: [0xeef2ff, 0x9fb2ff, 0x5f7cff, 0x34439c, 0x1c2466],
  red: [0xffd6db, 0xff8a96, 0xff3b55, 0x7c2634, 0x3d0f18],
} as const

/** The terminal's own colour, in a Raster cell. */
const DEFAULT = 0x01000000
const SPACE = 0x20
const ZERO = 0x30
const ONE = 0x31

const hash = (a: number, b: number) => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * The rain at `tick`, row-major, as the Raster's triplets `[codePoint, foreground, background]`.
 * `busy` (a model turn is running) quickens an idle rain as work does.
 */
export function rainCells(columns: number, rows: number, tick: number, mode: Mode, busy = false): Uint32Array {
  const cols = Math.max(1, Math.min(columns, RAIN_MAX.columns))
  const tall = Math.max(1, Math.min(rows, RAIN_MAX.rows))
  const pace = PACE[mode === 'idle' && busy ? 'working' : mode]
  const ink = mode === 'error' ? RAIN_INK.red : RAIN_INK.blue
  const cells = new Uint32Array(cols * tall * 3)
  for (let i = 0; i < cols * tall; i++) {
    cells[i * 3] = SPACE
    cells[i * 3 + 1] = DEFAULT
    cells[i * 3 + 2] = DEFAULT
  }

  for (let c = 0; c < cols; c++) {
    const h = hash(c, 7)
    if (h % pace.every !== 0) continue
    const length = 6 + ((h >>> 3) % 12)
    const speed = pace.speed * (0.6 + ((h >>> 8) % 100) / 125)
    const period = tall + length + 4 + ((h >>> 12) % tall)
    const head = Math.floor(tick * speed + ((h >>> 16) % period)) % period
    for (let k = 0; k < length; k++) {
      const y = head - k
      if (y < 0 || y >= tall) continue
      // the head flickers every tick, the tail every few, as the art's rain does
      const flicker = k === 0 ? tick : Math.floor(tick / 6)
      const bit = hash(c * 131 + y, flicker + k) & 1 ? ONE : ZERO
      const shade = k === 0 ? 0 : k <= 2 ? 1 : k < length / 2 ? 2 : k < length * 0.8 ? 3 : 4
      const at = (y * cols + c) * 3
      cells[at] = bit
      cells[at + 1] = ink[shade] ?? DEFAULT
    }
  }
  return cells
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 of the cells' little-endian bytes, as a Raster's `cells` wants. */
export function encodeCells(cells: Uint32Array): string {
  const bytes = new Uint8Array(cells.length * 4)
  for (let i = 0; i < cells.length; i++) {
    const w = cells[i] ?? 0
    bytes[i * 4] = w & 0xff
    bytes[i * 4 + 1] = (w >>> 8) & 0xff
    bytes[i * 4 + 2] = (w >>> 16) & 0xff
    bytes[i * 4 + 3] = (w >>> 24) & 0xff
  }
  const at = (k: number) => bytes[k] ?? 0
  const ch = (k: number) => B64[k & 63] ?? ''
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (at(i) << 16) | (at(i + 1) << 8) | at(i + 2)
    out += ch(n >>> 18) + ch(n >>> 12) + ch(n >>> 6) + ch(n)
  }
  const left = bytes.length - i
  if (left === 1) {
    const n = at(i) << 16
    out += ch(n >>> 18) + ch(n >>> 12) + '=='
  } else if (left === 2) {
    const n = (at(i) << 16) | (at(i + 1) << 8)
    out += ch(n >>> 18) + ch(n >>> 12) + ch(n >>> 6) + '='
  }
  return out
}
