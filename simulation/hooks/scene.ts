// The console pane's drawings: a strip of the owner's picture across the eyes and the
// third eye (red when a tool fails), and the rain rail, one lane per tool call.
// The backdrop itself is in backdrop.ts.

import type { Fall, Mode } from '../types'
import { EYES } from './trace/parts'

export const CONTRAST: Record<Mode, number> = { idle: 0.2, working: 0.6, tests: 1, error: 0.1 }
export const RAIN: Record<Mode, number> = { idle: 1, working: 2, tests: 4, error: 1 }

const r1 = (n: number) => Math.round(n * 10) / 10

/** The console's strip: the band of the picture across the eyes, glinting; red on a failure. */
export function horizon(mode: Mode): string {
  const glint = mode === 'error' ? '#ff6b80' : '#e8eeff'
  const third = mode === 'error' ? '#ff4d64' : '#cfd8ff'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="520 275 560 120" width="328" height="70" preserveAspectRatio="xMidYMid slice"><rect x="520" y="275" width="560" height="120" fill="#020410"/>${EYES}` +
    `<ellipse cx="722" cy="366" rx="11" ry="4" fill="${glint}" opacity=".7"/><ellipse cx="872" cy="366" rx="11" ry="4" fill="${glint}" opacity=".7"/>` +
    `<circle cx="800" cy="290" r="9" fill="${third}" opacity=".45"/></svg>`
}

const FALL_COLOR: Record<Fall['kind'], string> = { read: '#6f80ff', run: '#6f80ff', edit: '#ffb347', test: '#e2e6ff', fail: '#ff6159' }

/** The rain rail: one lane per tool call, newest on the right; a test run takes six lanes. */
export function rail(falls: readonly Fall[]): string {
  const lanes: { color: string; n: number; isHead: boolean }[] = []
  for (const f of falls) {
    const color = FALL_COLOR[f.kind]
    const n = Math.max(3, Math.min(16, Math.round(3 + Math.log2(1 + f.ms / 100) * 1.6)))
    if (f.kind === 'test') {
      for (let k = 0; k < 6; k++) lanes.push({ color, n: f.isDone ? 16 - (k % 3) : 8 + ((k * 5) % 7), isHead: !f.isDone })
    } else lanes.push({ color, n: f.isDone ? n : 4, isHead: !f.isDone })
  }
  const shown = lanes.slice(-12)
  const out: string[] = []
  shown.forEach((l, i) => {
    const x = 14 + i * 26
    out.push(`<path d="M${x - 4} 0V250" stroke="#0e1339"/>`)
    for (let k = 0; k < l.n; k++) {
      const head = k === l.n - 1
      const fill = head && l.color === '#e2e6ff' ? '#ffffff' : l.color
      out.push(`<rect x="${x - 3}" y="${r1(6 + k * 14.5)}" width="6" height="9" fill="${fill}" fill-opacity="${head ? 1 : r1(Math.max(0.18, 0.85 - (l.n - k) * 0.05))}"/>`)
    }
  })
  if (shown.length === 0) out.push('<path d="M14 125H314" stroke="#2a3480" stroke-dasharray="2 6"/>')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 328 250" width="328" height="250"><rect width="328" height="250" fill="#000000"/>${out.join('')}</svg>`
}
