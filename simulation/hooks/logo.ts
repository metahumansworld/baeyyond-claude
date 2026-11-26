// The owner's mark, baeYYond, as a small glowing badge for the band and the console.
// The backdrop draws its own, larger, at the centre of the picture (backdrop.ts).

import type { Mode } from '../types'
import { LOGO_D, LOGO_H, LOGO_W } from './logo-path'

// potrace draws at 10 units a pixel with y up; this puts it back in pixels, y down.
const GLYPHS = `<g transform="translate(0 ${LOGO_H}) scale(.1 -.1)"><path d="${LOGO_D}"/></g>`

/** A small glowing mark on the band's and the console's own dark ground; red on a failure. */
export function logoBadge(mode: Mode): string {
  const err = mode === 'error'
  const pad = 40

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_W + pad * 2}" height="${LOGO_H + pad * 2}" viewBox="${-pad} ${-pad} ${LOGO_W + pad * 2} ${LOGO_H + pad * 2}">` +
    `<defs><filter id="bb" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="18"/></filter></defs>` +
    `<g fill="${err ? '#ff4d64' : '#5868ff'}" opacity=".85" filter="url(#bb)">${GLYPHS}</g>` +
    `<g fill="${err ? '#ff7d75' : '#6f80ff'}">${GLYPHS}</g>` +
    `</svg>`
  )
}
