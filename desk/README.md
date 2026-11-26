# desk

A mod for Claude Code (desktop app and terminal) that keeps what your sessions need from you in one place, shows what this session is doing, and sends a local site to your phone over your tailnet.

## Waiting on you (`/waiting`)

When a session needs a review, a decision, an approval or an answer from you, it puts it in the Waiting-on-you pane instead of leaving it in the chat, where it gets buried and asked again.

- One list across all your sessions, this session's first, each group oldest first.
- Each ask has its answers as buttons, a reply field, and Done (closes it without a word to the session).
- Your answer reaches the session that asked as your next message, starting `Re: <title>`, even when you answer from another session's pane: that session takes it on its next poll, within a couple of seconds.
- A new ask raises a notification.
- The model is told, in a standing section of the system prompt, to use the pane and never to ask an open item again; each of your prompts carries the session's open asks, and an ask with an open twin's title is refused.

The model's tools are `mcp__desk__ask`, `mcp__desk__list` and `mcp__desk__resolve`.

## This session (`/desk`)

What runs now and for how long, the files edited, the test runs and how they ended, each turn's time, the session's total and cost, and the local servers seen in commands and their output, each with a Send to phone button.

## Send to phone (`/phone <port>`)

Puts a local server on your tailnet with `tailscale serve` (tailnet only, never funnel) and shows the link as a QR code: an SVG in the desktop app, half blocks in a terminal. It checks the link from the Mac first and says when Vite refuses the tailnet name (add `.ts.net` to `server.allowedHosts`).

- `/phone` lists what the desk has served; `/phone off <port>` turns one off.
- Your own serve handlers are never changed: a port already served is reused as it is, a new serve takes a port no handler holds, and the desk turns off only a serve it made and still finds where it left it. It never resets the serve config.
- Needs the Tailscale app at `/Applications/Tailscale.app`, signed in, with HTTPS certificates on for the tailnet. A serve made with `--bg` stays on until turned off, across restarts.

## Install

```bash
claude plugin install desk@baeyyond-claude
```

In the desktop app: + next to the prompt box, Plugins, Add marketplace `metahumansworld/baeyyond-claude`, then Add plugin.

## Tests

`claude plugin test desk` runs 23 tests: the asks across two sessions, the console's record, the serve rules against a config holding other handlers, and the QR encoder (its codes were also read back by CoreImage's decoder).

## Licence

MIT, as the repository's `LICENSE`.
