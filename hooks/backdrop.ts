// The backdrop: the owner's picture of Ardhanarishvara, traced into seven still layers,
// and one layer of motion over it. Each still layer is its own Svg (each Svg holds at most
// 131,072 characters, and the picture needs about 820,000), so they never repaint; only
// the motion layer moves.
//
// Every motion has a reason:
//   galaxies turn, waterfalls fall, ripples spread from the yogi, light climbs the axis
//   (the picture is alive); one bright orb rises the axis for each tool call in flight;
//   the rain and the light quicken while work or tests run; a failed tool turns the third
//   eye, the eyes and the rain red; an edit sends one bright ripple from the yogi; a turn's
//   end sends one shooting star. Binary rain falls over all of it: the simulation.
// Over the chat column a veil keeps words readable (text 11.7:1, muted 5.8:1 on the
// brightest patch, measured on a 1440×900 rest frame).
//
// Time is anchored: loops take a negative delay from the clock, and one-shots from their
// age, so a redraw continues every animation where it was instead of starting it again.

import type { Mode } from '../types'
import L1 from './trace/layer-1'
import L2 from './trace/layer-2'
import L3 from './trace/layer-3'
import L4 from './trace/layer-4'
import L5 from './trace/layer-5'
import L6 from './trace/layer-6'
import L7 from './trace/layer-7'
import { AXIS, CELL, COL, DEFS, FALLS, GALAXIES, GROUND, H, RAIN as RAIN_COLUMNS, ROWS, SPHERES, STARS, W } from './trace/parts'

export const LAYERS: readonly string[] = [L1, L2, L3, L4, L5, L6, L7]

/** How strongly the veil darkens the chat column: 0.88 passes the text floor, 0.75 does not. */
export const VEIL = 0.88

export type MotionState = {
  mode: Mode
  /** Tool calls in flight: one orb each, six at most. */
  running: number
  /** Seconds since the last edit, or null for none. */
  editAge: number | null
  /** Seconds since the last turn ended, or null for none. */
  doneAge: number | null
  /** The clock, in seconds: loops are anchored to it. */
  now: number
  held: boolean
}

const EDIT_S = 3.2
const DONE_S = 1.8
const f1 = (n: number) => Math.round(n * 10) / 10

export function motion(st: MotionState): string {
  const loop = (per: number, off = 0) => `-${f1((((st.now + off * per) % per) + per) % per)}s`
  const once = (age: number) => `${f1(-age)}s`
  const err = st.mode === 'error'
  const busy = st.mode === 'working' || st.mode === 'tests'
  const speed = st.mode === 'tests' ? 0.45 : busy ? 0.65 : 1
  const head = err ? '#ff8a96' : '#eef2ff'
  const tail = err ? '#ff3b55' : '#5f7cff'

  let s =
    // An explicit size: inside a Box an Svg draws at its markup's own width, capped at the
    // slot, so a large 16:10 size fills the window's width; a bare viewBox gave it none.
    `<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2400" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${DEFS}` +
    `<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd8ff" stop-opacity="0"/><stop offset=".25" stop-color="#cfd8ff" stop-opacity=".9"/><stop offset=".85" stop-color="#cfd8ff" stop-opacity=".9"/><stop offset="1" stop-color="#cfd8ff" stop-opacity="0"/></linearGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="#e8eeff"/><stop offset=".35" stop-color="#9fb2ff" stop-opacity=".55"/><stop offset="1" stop-color="#5f7cff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="rglow"><stop offset="0" stop-color="#ffd6db"/><stop offset=".35" stop-color="#ff4d64" stop-opacity=".6"/><stop offset="1" stop-color="#ff2040" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="veil" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GROUND}" stop-opacity="0"/><stop offset=".07" stop-color="${GROUND}" stop-opacity="${VEIL}"/><stop offset=".93" stop-color="${GROUND}" stop-opacity="${VEIL}"/><stop offset="1" stop-color="${GROUND}" stop-opacity="0"/></linearGradient>` +
    `</defs><style>` +
    `.fall{fill:none;stroke:#dfe6ff;stroke-linecap:round;stroke-dasharray:3 10;opacity:.5;animation:fall linear infinite}@keyframes fall{from{stroke-dashoffset:26}to{stroke-dashoffset:0}}` +
    `.tw{fill:#dfe6ff;animation:tw ease-in-out infinite}@keyframes tw{0%,100%{opacity:.15}50%{opacity:.9}}` +
    `.rn{writing-mode:vertical-rl;text-orientation:upright;font-family:ui-monospace,monospace;font-size:15px;fill:${tail};animation:rn linear infinite}.rn .a{fill-opacity:.22}.rn .b{fill-opacity:.6}.rn .h{fill:${head}}` +
    `@keyframes rn{from{transform:translateY(-${ROWS * CELL}px)}to{transform:translateY(${H}px)}}` +
    `.beam{animation:beam 6s ease-in-out infinite}@keyframes beam{0%,100%{opacity:.35}50%{opacity:.75}}` +
    `.sph{animation:sph 4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}@keyframes sph{0%,100%{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}` +
    `.rip{fill:none;stroke:#c9d4ff;animation:rip 9s linear infinite;transform-box:fill-box;transform-origin:center}@keyframes rip{from{transform:scale(.12);opacity:.8;stroke-width:3}to{transform:scale(1);opacity:0;stroke-width:.6}}` +
    `.climb{animation:climb linear infinite}@keyframes climb{from{transform:translateY(0);opacity:0}8%{opacity:1}92%{opacity:1}to{transform:translateY(-560px);opacity:0}}` +
    `.orb{animation:orb 2.6s linear infinite}@keyframes orb{from{transform:translateY(0);opacity:0}10%{opacity:1}90%{opacity:1}to{transform:translateY(-640px);opacity:0}}` +
    `.burst{fill:none;stroke:#eef2ff;animation:burst ${EDIT_S}s ease-out both;transform-box:fill-box;transform-origin:center}@keyframes burst{from{transform:scale(.1);opacity:1;stroke-width:6}to{transform:scale(1);opacity:0;stroke-width:1}}` +
    `.shoot{animation:shoot ${DONE_S}s ease-in both}@keyframes shoot{from{transform:translate(0,0);opacity:0}15%{opacity:1}to{transform:translate(-720px,260px);opacity:0}}` +
    `.eye{animation:eye 3s ease-in-out infinite}@keyframes eye{0%,100%{opacity:.5}50%{opacity:1}}` +
    (st.held ? `*{animation-play-state:paused!important}` : '') +
    `@media (prefers-reduced-motion: reduce){*{animation:none!important}}` +
    `</style>`

  s += GALAXIES
  s += `<g>${FALLS}</g><g>${STARS}</g>`

  // ripples from the yogi and from the lower sphere
  for (const [cy, rx] of [[700, 330], [812, 420]] as const) {
    for (let i = 0; i < 3; i++) {
      s += `<ellipse class="rip" cx="${AXIS}" cy="${cy}" rx="${rx}" ry="${f1(rx * 0.16)}" opacity="0" style="animation-delay:${loop(9, i / 3 + (cy > 800 ? 1 / 6 : 0))}"/>`
    }
  }

  // the axis beam, its spheres and the third eye
  s += `<rect class="beam" x="${AXIS - 2}" y="0" width="4" height="${H}" fill="url(#beam)" opacity=".5" style="animation-delay:${loop(6)}"/>`
  ;(SPHERES as unknown as [number, number][]).forEach(([y, r], i) => {
    const red = err && y === 270
    s += `<circle class="sph" cx="${AXIS}" cy="${y}" r="${f1(r * 2.4)}" fill="url(#${red ? 'rglow' : 'glow'})" opacity=".7" style="animation-delay:${loop(4, i * 0.21)}"/>`
  })
  // light climbing from the yogi to the third eye, always
  for (let i = 0; i < 3; i++) {
    s += `<circle class="climb" cx="${AXIS}" cy="690" r="4" fill="#eef2ff" opacity="0" style="animation-duration:${f1(7 * speed)}s;animation-delay:${loop(7 * speed, i / 3)}"/>`
  }
  // one bright orb per tool call in flight, from the lower sphere to the crown
  const orbs = Math.min(Math.max(0, st.running), 6)
  for (let i = 0; i < orbs; i++) {
    s += `<circle class="orb" cx="${AXIS}" cy="808" r="9" fill="url(#glow)" opacity="0" style="animation-delay:${loop(2.6, i / orbs)}"/>`
  }

  // the eyes of both halves
  for (const [x, y] of [[722, 366], [872, 366]] as const) {
    s += `<ellipse class="eye" cx="${x}" cy="${y}" rx="11" ry="4" fill="${err ? '#ff6b80' : '#e8eeff'}" opacity=".6" style="animation-delay:${loop(3)}"/>`
  }

  // one-shots, continued at their age and gone once played
  if (st.editAge !== null && st.editAge >= 0 && st.editAge < EDIT_S) {
    s += `<ellipse class="burst" cx="${AXIS}" cy="700" rx="380" ry="62" opacity="0" style="animation-delay:${once(st.editAge)}"/>`
  }
  if (st.doneAge !== null && st.doneAge >= 0 && st.doneAge < DONE_S) {
    s += `<g class="shoot" opacity="0" style="animation-delay:${once(st.doneAge)}"><path d="M1280 70l90 -32" stroke="#eef2ff" stroke-width="2.4" stroke-linecap="round"/><circle cx="1280" cy="70" r="3" fill="#fff"/></g>`
  }

  // binary rain, dimmer over the chat column
  s += '<g>'
  for (const [x, bits, dur, off, op] of RAIN_COLUMNS as unknown as [number, string, number, number, number][]) {
    const d = dur * speed
    s += `<text class="rn" x="${x}" y="0" opacity="${err ? Math.min(0.9, op * 1.2) : op}" transform="translate(0 ${f1(off * H)})" style="animation-duration:${f1(d)}s;animation-delay:${loop(d, off)}"><tspan class="a">${bits.slice(0, 12)}</tspan><tspan class="b">${bits.slice(12, -1)}</tspan><tspan class="h">${bits.slice(-1)}</tspan></text>`
  }
  s += '</g>'

  // the veil, over everything in the chat column, motion included
  s += `<rect x="${COL.x0 - 60}" y="0" width="${COL.x1 - COL.x0 + 120}" height="${H}" fill="url(#veil)"/>`

  return s + '</svg>'
}
