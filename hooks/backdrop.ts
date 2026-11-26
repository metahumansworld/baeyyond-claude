// The backdrop: the owner's picture of Ardhanarishvara, traced, alive, under binary rain,
// with the baeYYond mark glowing at its centre. ONE Svg, the backdrop's whole answer, drawn
// with isInteractive and sized 100% by 100%: the form the app is known to draw. (Seven
// picture layers stacked in Boxes drew nothing in the app, on any screen.) One Svg holds at
// most 131,072 characters, so the picture is a lighter trace (about 70,000) and the
// galaxies turn as drawn spirals over it.
//
// Every motion has a reason:
//   galaxies turn, waterfalls fall, stars twinkle, ripples spread from the yogi, light
//   climbs the axis (the picture is alive); one bright orb rises the axis for each tool call
//   in flight; the rain, the light and the mark's glow quicken while work or tests run; a
//   failed tool turns the third eye, the eyes, the rain and the mark red; an edit sends one
//   bright ripple from the yogi; a turn's end sends one shooting star.
// Where the words sit, a 'darken' cap keeps the art's shapes but holds its brightest parts
// down, so the art shows and words stay readable: text 7.5:1, muted 3.7:1 over the brightest
// patch (measured at 1000x650 with the sidebar open). A flat veil hid the art to do the same.
//
// Time is anchored: loops take a negative delay from the clock, and one-shots from their
// age, so a redraw continues every animation where it was instead of starting it again.

import type { Mode } from '../types'
import { LOGO_D, LOGO_H, LOGO_W } from './logo-path'
import PICTURE from './trace/picture'
import { AXIS, CELL, FALLS, GROUND, H, RAIN as RAIN_COLUMNS, ROWS, SPHERES, STARS, W } from './trace/parts'

/** How strongly the veil darkens the band where the chat's words sit (0: no veil). */
export const VEIL = 0
/** The brightest the art may be inside that band: a 'darken' blend caps each part of the
 *  picture at this color and leaves everything darker as it is. null: no cap. */
export const CLAMP: string | null = '#1f2a78'
/** Where the words sit, in the picture's frame: measured from the app with its sidebar open
 *  (the backdrop spans the whole window; the words run from 28% to 88% of its width). */
export const VEIL_BAND = { x0: 440, x1: 1420 }

/** The mark's width in the picture's frame (1600 wide), and how bright each part of it is. */
export const LOGO_SPAN = 560
export const GLOW = { mark: 0.26, near: 0.18, low: 0.14, high: 0.3 }

/** The four galaxies of the picture: centre, size, tilt. */
const GALAXIES: readonly [number, number, number, number][] = [
  [338, 183, 104, -12],
  [1263, 183, 104, 12],
  [415, 591, 70, -8],
  [1183, 591, 70, 8],
]

export type SceneState = {
  mode: Mode
  /** Tool calls in flight: one orb each, six at most. */
  running: number
  /** Seconds since the last edit, or null for none. */
  editAge: number | null
  /** Seconds since the last turn ended, or null for none. */
  doneAge: number | null
  /** Seconds since a tool last failed, or null for none. */
  failAge?: number | null
  /** The clock, in seconds: loops are anchored to it. */
  now: number
  held: boolean
}

/** Where the third eye sits on the brow, on the axis. */
const THIRD_EYE_Y = 270
const EDIT_S = 3.2
const DONE_S = 1.8
/** One flash of the whole picture: a quick rise and a slow fall, never more than one a second. */
const FLASH_S = 1.6
/** The picture flashes by itself this often, in seconds, besides on events. */
const FLASH_EVERY = 30
/** All three eyes close and open together on this cycle, in seconds. */
const BLINK_S = 10
const f1 = (n: number) => Math.round(n * 10) / 10

export function scene(st: SceneState): string {
  const loop = (per: number, off = 0) => `-${f1((((st.now + off * per) % per) + per) % per)}s`
  const once = (age: number) => `${f1(-age)}s`
  const err = st.mode === 'error'
  const busy = st.mode === 'working' || st.mode === 'tests'
  const speed = st.mode === 'tests' ? 0.45 : busy ? 0.65 : 1
  const head = err ? '#ff8a96' : '#eef2ff'
  const tail = err ? '#ff3b55' : '#5f7cff'
  const mark = err ? '#d92a45' : '#2a33d9'
  const glow = err ? '#ff4d64' : '#5868ff'
  const k = LOGO_SPAN / LOGO_W
  const lx = f1(W / 2 - LOGO_SPAN / 2)
  const ly = f1(H / 2 - (LOGO_H * k) / 2)
  const markPer = busy ? 3.2 : 6

  let s =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><defs>` +
    `<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd8ff" stop-opacity="0"/><stop offset=".25" stop-color="#cfd8ff" stop-opacity=".9"/><stop offset=".85" stop-color="#cfd8ff" stop-opacity=".9"/><stop offset="1" stop-color="#cfd8ff" stop-opacity="0"/></linearGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="#e8eeff"/><stop offset=".35" stop-color="#9fb2ff" stop-opacity=".55"/><stop offset="1" stop-color="#5f7cff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="rglow"><stop offset="0" stop-color="#ffd6db"/><stop offset=".35" stop-color="#ff4d64" stop-opacity=".6"/><stop offset="1" stop-color="#ff2040" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="core"><stop offset="0" stop-color="#dfe6ff" stop-opacity=".8"/><stop offset=".4" stop-color="#7d90ff" stop-opacity=".35"/><stop offset="1" stop-color="#3f52d8" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="veil" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GROUND}" stop-opacity="0"/><stop offset=".07" stop-color="${GROUND}" stop-opacity="${VEIL}"/><stop offset=".93" stop-color="${GROUND}" stop-opacity="${VEIL}"/><stop offset="1" stop-color="${GROUND}" stop-opacity="0"/></linearGradient>` +
    `<filter id="lb" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="26"/></filter>` +
    `<filter id="lc" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>` +
    `<filter id="eg" x="-150%" y="-300%" width="400%" height="700%"><feGaussianBlur stdDeviation="5"/></filter>` +
    `<g id="mk" transform="translate(0 ${LOGO_H}) scale(.1 -.1)"><path d="${LOGO_D}"/></g>` +
    `</defs><style>` +
    `.fall{fill:none;stroke:#dfe6ff;stroke-linecap:round;stroke-dasharray:3 10;opacity:.5;animation:fall linear infinite}@keyframes fall{from{stroke-dashoffset:26}to{stroke-dashoffset:0}}` +
    `.tw{fill:#dfe6ff;animation:tw ease-in-out infinite}@keyframes tw{0%,100%{opacity:.15}50%{opacity:.9}}` +
    `.gal{animation:gal linear infinite;transform-box:fill-box;transform-origin:center}@keyframes gal{to{transform:rotate(-360deg)}}` +
    `.arm{fill:none;stroke:#b8c4f6;stroke-linecap:round}` +
    `.rn{writing-mode:vertical-rl;text-orientation:upright;font-family:ui-monospace,monospace;font-size:15px;fill:${tail};animation:rn linear infinite}.rn .a{fill-opacity:.22}.rn .b{fill-opacity:.6}.rn .h{fill:${head}}` +
    `@keyframes rn{from{transform:translateY(-${ROWS * CELL}px)}to{transform:translateY(${H}px)}}` +
    `.beam{animation:beam 6s ease-in-out infinite}@keyframes beam{0%,100%{opacity:.35}50%{opacity:.75}}` +
    `.sph{animation:sph 4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}@keyframes sph{0%,100%{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}` +
    `.rip{fill:none;stroke:#c9d4ff;animation:rip 9s linear infinite;transform-box:fill-box;transform-origin:center}@keyframes rip{from{transform:scale(.12);opacity:.8;stroke-width:3}to{transform:scale(1);opacity:0;stroke-width:.6}}` +
    `.climb{animation:climb linear infinite}@keyframes climb{from{transform:translateY(0);opacity:0}8%{opacity:1}92%{opacity:1}to{transform:translateY(-560px);opacity:0}}` +
    `.orb{animation:orb 2.6s linear infinite}@keyframes orb{from{transform:translateY(0);opacity:0}10%{opacity:1}90%{opacity:1}to{transform:translateY(-640px);opacity:0}}` +
    `.burst{fill:none;stroke:#eef2ff;animation:burst ${EDIT_S}s ease-out both;transform-box:fill-box;transform-origin:center}@keyframes burst{from{transform:scale(.1);opacity:1;stroke-width:6}to{transform:scale(1);opacity:0;stroke-width:1}}` +
    `.shoot{animation:shoot ${DONE_S}s ease-in both}@keyframes shoot{from{transform:translate(0,0);opacity:0}15%{opacity:1}to{transform:translate(-720px,260px);opacity:0}}` +
    `.lid{animation:lid ${BLINK_S}s ease-in-out infinite;transform-box:fill-box;transform-origin:center}@keyframes lid{0%,100%{transform:scaleY(.06)}25%,70%{transform:scaleY(1)}}` +
    `.fl{mix-blend-mode:screen;animation:fl ${FLASH_EVERY}s ease-out infinite}@keyframes fl{0%,100%{opacity:0}1.5%{opacity:.3}5%{opacity:0}}` +
    `.fo{mix-blend-mode:screen;animation:fo ${FLASH_S}s ease-out both}@keyframes fo{0%{opacity:0}20%{opacity:.38}100%{opacity:0}}` +
    `.lg{animation:lg ${markPer}s ease-in-out infinite}@keyframes lg{0%,100%{opacity:${GLOW.low}}50%{opacity:${GLOW.high}}}` +
    (st.held ? `*{animation-play-state:paused!important}` : '') +
    `@media (prefers-reduced-motion: reduce){*{animation:none!important}}` +
    `</style>`

  // the picture
  s += PICTURE

  // the galaxies: a bright core and two arms each, turning slowly
  GALAXIES.forEach(([cx, cy, r, tilt], i) => {
    const per = f1((80 + i * 13) * speed)
    s +=
      `<g transform="translate(${cx} ${cy}) rotate(${tilt}) scale(1 .6)">` +
      `<ellipse rx="${f1(r * 0.55)}" ry="${f1(r * 0.55)}" fill="url(#core)"/>` +
      `<g class="gal" style="animation-duration:${per}s;animation-delay:${loop(per)}">` +
      `<path class="arm" d="M0 0C${f1(r * 0.3)} ${f1(-r * 0.4)} ${f1(r * 0.8)} ${f1(-r * 0.3)} ${f1(r * 0.95)} ${f1(r * 0.1)}" stroke-width="3" opacity=".35"/>` +
      `<path class="arm" d="M0 0C${f1(-r * 0.3)} ${f1(r * 0.4)} ${f1(-r * 0.8)} ${f1(r * 0.3)} ${f1(-r * 0.95)} ${f1(-r * 0.1)}" stroke-width="3" opacity=".35"/>` +
      `</g></g>`
  })

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
    if (y === THIRD_EYE_Y) return // the third eye is drawn as an eye, over the cap
    s += `<circle class="sph" cx="${AXIS}" cy="${y}" r="${f1(r * 2.4)}" fill="url(#glow)" opacity=".7" style="animation-delay:${loop(4, i * 0.21)}"/>`
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


  // the veil and the cap, over everything in the band where the words sit
  const band = `x="${VEIL_BAND.x0 - 60}" y="0" width="${VEIL_BAND.x1 - VEIL_BAND.x0 + 120}" height="${H}"`
  if (VEIL > 0) s += `<rect ${band} fill="url(#veil)"/>`
  if (CLAMP !== null) {
    s += `<linearGradient id="cap" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset=".07" stop-color="${CLAMP}"/><stop offset=".93" stop-color="${CLAMP}"/><stop offset="1" stop-color="#fff"/></linearGradient>`
    s += `<rect ${band} fill="url(#cap)" style="mix-blend-mode:darken"/>`
  }

  // the whole picture flashes: by itself every half minute, and once on an edit, a turn's
  // end (pale) or a failure (red); over the cap so the middle flashes too, gently enough
  // that words stay readable at the peak (each flash is one rise and fall, never 3 a second)
  s += `<rect class="fl" width="${W}" height="${H}" fill="#9fb0ff" opacity="0" style="animation-delay:${loop(FLASH_EVERY)}"/>`
  const events: [number | null | undefined, string][] = [[st.editAge, '#b8c6ff'], [st.doneAge, '#9fb0ff'], [st.failAge, '#ff4060']]
  for (const [a, colour] of events) {
    if (a !== null && a !== undefined && a >= 0 && a < FLASH_S) {
      s += `<rect class="fo" width="${W}" height="${H}" fill="${colour}" opacity="0" style="animation-delay:${once(a)}"/>`
    }
  }

  // the three eyes, over the cap so the red stays red: they close and open together, the
  // third eye on the brow glowing red, and the two eyes turning red too when a tool fails
  const lid = `style="animation-delay:${loop(BLINK_S)}"`
  const eye = (x: number, y: number, rx: number, ry: number, colour: string, turn = 0) =>
    `<g transform="translate(${x} ${y}) rotate(${turn})"><g class="lid" ${lid}>` +
    `<ellipse rx="${rx * 1.9}" ry="${ry * 2.4}" fill="${colour}" opacity=".55" filter="url(#eg)"/>` +
    `<path d="M${-rx} 0Q0 ${-ry * 1.6} ${rx} 0Q0 ${ry * 1.6} ${-rx} 0Z" fill="${colour}" opacity=".9"/>` +
    `</g></g>`
  const pair = err ? '#ff6b80' : '#dfe6ff'
  s += eye(722, 366, 13, 5, pair) + eye(872, 366, 13, 5, pair) + eye(AXIS, THIRD_EYE_Y, 12, 5, '#ff3048', 90)

  // the mark, over the veil: a wide breathing glow, a near glow, and the mark itself
  s +=
    `<g transform="translate(${lx} ${ly}) scale(${f1(k * 1000) / 1000})">` +
    `<g class="lg" fill="${glow}" filter="url(#lb)" style="animation-delay:${loop(markPer)}"><use href="#mk"/></g>` +
    `<g fill="${glow}" opacity="${GLOW.near}" filter="url(#lc)"><use href="#mk"/></g>` +
    `<g fill="${mark}" opacity="${GLOW.mark}"><use href="#mk"/></g>` +
    `</g>`

  return s + '</svg>'
}
