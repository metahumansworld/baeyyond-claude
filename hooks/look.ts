// The look: ultramarine for the simulation, amber for the real, red for failure alone.
// Set again on each mode change, so the room's hum follows the work.

import type { ThemeSetArgs, ThemeSound } from 'claude-code'

import type { Mode } from '../types'
import { makeColors } from './make-colors.js'

export const INK = {
  s0: '#010208', s1: '#02040f', s2: '#040617', s3: '#060a20',
  text: '#e2e6ff', secondary: '#a9b4ff', muted: '#959fe8',
  edge: '#1c2466', ultra: '#6f80ff', amber: '#ffb347', red: '#ff7d75', ok: '#5fd3b0',
} as const

export const { theme: COLORS, problems: COLOR_PROBLEMS } = makeColors({
  label: 'Simulation',
  only: 'dark',
  roles: { accent: INK.amber, danger: INK.red, success: INK.ok, warning: '#ffd27a', pro: INK.ultra },
  dark: {
    gray: {
      anchors: {
        'surface-0': INK.s0,
        'surface-1': INK.s1,
        'surface-2': INK.s2,
        'surface-3': INK.s3,
        'text-primary': INK.text,
        'text-secondary': INK.secondary,
        'text-muted': INK.muted,
      },
    },
    git: { added: INK.ok, removed: INK.red, modified: INK.amber },
  },
})

// Words are real, so they sit on near-solid ground and never dim with the simulation.
const STYLE: ThemeSetArgs['style'] = {
  Text: { fontFamily: ['mono'], fontSize: 13, lineHeight: 21, color: INK.text },
  Heading: { fontFamily: ['mono'], fontWeight: 'semibold', color: '#ffffff', letterSpacing: 0.5 },
  UserMessage: { backgroundColor: INK.s3, borderColor: INK.edge, borderWidth: 1, radius: 10, paddingX: 13, paddingY: 9 },
  AssistantMessage: { backgroundColor: '#010208f5', radius: 8, padding: 14 },
  ToolUse: { color: INK.secondary, fontFamily: ['mono'], backgroundColor: '#010208f5', borderColor: INK.edge, borderWidth: 1, radius: 4, paddingX: 10 },
}

// The room's machines: a low hum that rises with contrast, rain ticks that follow the rain,
// and a hiss while tests pour.
const HUM: Record<Mode, number> = { idle: 0.16, working: 0.24, tests: 0.3, error: 0.08 }
const TICKS: Record<Mode, number> = { idle: 0.25, working: 0.8, tests: 4, error: 0.1 }

export function sound(mode: Mode): ThemeSound {
  const layers: NonNullable<ThemeSound['ambience']>['layers'][number][] = [
    { wave: 'sine', notes: ['A1', 'E2'], drone: true, gain: HUM[mode], filter: { type: 'lowpass', hz: 260 }, tremolo: { hz: 0.12, depth: 0.25 } },
    { wave: 'crackle', scatter: TICKS[mode], gain: 0.12, release: 0.05, filter: { type: 'highpass', hz: 1800 } },
  ]
  if (mode === 'tests') layers.push({ wave: 'pink', drone: true, gain: 0.07, filter: { type: 'highpass', hz: 2400 } })

  return {
    ambience: { layers, reverb: 0.25 },
    cues: {
      send: { layers: [{ wave: 'triangle', notes: ['A5'], gain: 0.1, attack: 0.002, release: 0.05 }] },
      tool: { layers: [{ wave: 'crackle', gain: 0.12, attack: 0.002, release: 0.04 }] },
      done: { layers: [{ wave: 'sine', notes: ['E5', 'B4'], step: 0.09, gain: 0.12, release: 0.5 }], reverb: 0.3 },
      ask: { layers: [{ wave: 'bell', notes: ['C6'], gain: 0.1, release: 0.8 }], reverb: 0.3 },
      error: {
        layers: [
          { wave: 'sine', notes: ['A3'], glide: -12, gain: 0.18, release: 0.9 },
          { wave: 'brown', gain: 0.1, release: 0.4 },
        ],
      },
      compact: { layers: [{ wave: 'pink', gain: 0.08, release: 1, filter: { type: 'lowpass', hz: 4000, to: 300 } }] },
      click: { layers: [{ wave: 'bell', notes: ['C5', 'D5', 'F5', 'G5', 'A5'], gain: 0.08, release: 0.6 }] },
    },
  }
}

export function look(mode: Mode, withSound = true): ThemeSetArgs {
  return {
    colors: COLORS,
    backdrop: { scene: 'simulation', glass: false },
    style: STYLE,
    ...(withSound ? { sound: sound(mode) } : {}),
  }
}
