// The desk's values: the asks waiting on the person, across sessions.

/** review: look at something; decision: pick one; approval: a yes before an action; answer: a fact only the person has. */
export type AskKind = 'review' | 'decision' | 'approval' | 'answer'

/** open: waiting; replied: the person answered from the pane; done: closed with no answer sent. */
export type AskState = 'open' | 'replied' | 'done'

/** One ask, as `$.store` keeps it under `ask:<id>`, shared by every session. */
export type Ask = {
  id: string
  /** The session that asked: the one a reply goes to. */
  sessionId: string
  /** A few words naming that session's work, or its folder's name. */
  where: string
  cwd: string
  title: string
  detail: string
  kind: AskKind
  /** Answers drawn as buttons, the asker's pick first. */
  options: string[]
  /** A file or URL to look at; empty for none. */
  link: string
  /** `$.clock.now()` ms. */
  askedAt: number
  state: AskState
  /** What the person answered; empty when none. */
  reply: string
  /** `$.clock.now()` ms; 0 while open. */
  closedAt: number
}

/** An ask as the pane draws it: who asked, whether that session is open, and a reply on its way. */
export type AskView = Ask & {
  isMine: boolean
  /** The asking session left a mark in the last minute and a half. */
  isLive: boolean
  /** A reply sent from another session's pane that the asker has not taken yet; empty for none. */
  pending: string
}

/** A tool call in flight. */
export type Running = { id: string; tool: string; label: string; startedAt: number }
/** A file this session edited, how often, and when last. */
export type Touched = { path: string; edits: number; at: number }
/** A test command and how it ended. */
export type TestRun = { id: string; command: string; state: 'running' | 'pass' | 'fail'; startedAt: number; ms: number }
/** One turn: its number, its start, its length (0 while it runs), the prompt's first words. */
export type TurnTime = { n: number; startedAt: number; ms: number; prompt: string }
/** A local server's port seen in a command or its output. */
export type Server = { port: number; seen: string; at: number }

/** The session console's record. */
export type Activity = {
  running: Running[]
  files: Touched[]
  tests: TestRun[]
  turns: TurnTime[]
  servers: Server[]
}

/** A local port the desk put on the tailnet, as `$.store` keeps it under `serve:<httpsPort>`. */
export type Served = { httpsPort: number; localPort: number; target: string; url: string; at: number; by: string }

/** The phone link the pane shows: the link, its QR code's modules, and what was checked. */
export type PhoneLink = {
  localPort: number
  url: string
  /** Rows of the QR code, '1' dark and '0' light. */
  qr: string[]
  /** The check of the link from this Mac, in a line. */
  check: string
  /** The desk made this serve, so it may turn it off; false for a link that was already there. */
  isOurs: boolean
  httpsPort: number
}

declare module 'claude-code' {
  interface PluginState {
    desk: {
      asks: Shaped<AskView[]>
      /** The minute, so the pane's ages move on. */
      minute: number
      activity: Shaped<Activity>
      /** Moves on every poll while a call runs, so running times count up. */
      beat: number
      phone: Shaped<PhoneLink[]>
      /** The phone step in progress or its last error, in a line; empty for none. */
      phoneNote: string
      /** How the hub stands, in a few words; empty before the first check. */
      hub: string
    }
  }
}
