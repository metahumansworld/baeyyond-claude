// What the simulation is doing, and what fell on the rail.

/** idle: no turn; working: a turn runs; tests: a test command runs; error: a tool failed. */
export type Mode = 'idle' | 'working' | 'tests' | 'error'

export type Sim = {
  /** How many edits have loaded a new frame of the simulation; the console names it. */
  world: number
  mode: Mode
  /** When a file was last edited, in `$.clock.now()` ms (0: never): one bright ripple from the yogi. */
  editAt: number
  /** When a turn last ended, in `$.clock.now()` ms (0: never): one shooting star. */
  doneAt: number
  /** Tool calls in flight, one orb each. */
  running: number
  /** The tool call that loaded this world, for the console. */
  loadedBy: string
}

/** One lane on the rain rail. */
export type Fall = {
  id: string
  kind: 'read' | 'edit' | 'run' | 'test' | 'fail'
  label: string
  isDone: boolean
  ms: number
}

declare module 'claude-code' {
  interface PluginState {
    simulation: {
      sim: Shaped<Sim>
      falls: Shaped<Fall[]>
      held: boolean
      lastCommand: string
      theme: string
    }
  }
}
