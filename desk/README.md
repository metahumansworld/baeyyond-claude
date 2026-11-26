# desk

A mod for Claude Code (desktop app and terminal) that keeps what your sessions need from you in one place, on the Mac and on your phone, shows what this session is doing, and sends a local site to your phone over your tailnet.

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

## The hub (`/phone hub`)

One page with every session's asks, grouped by session, that you answer from your phone. Each session is a card named by its work and folder, saying whether it is still working, stopped on you (and for how long), idle, or closed. Under it are its asks, oldest first, with their buttons, a reply field and Done, and the sites it put on your tailnet. Filters by kind sit at the top.

- Every session running the desk starts the hub when it finds it down (a small Node server, `hub/server.mjs`, on `127.0.0.1:4791`) and feeds it a file in `~/.claude/desk-hub/`. The hub stops by itself after twelve hours with no session feeding it.
- An answer from the page goes to the session that asked, as your next message starting `Re: <title>`. If that session is closed, an open one leaves the answer in the desk for it, and the asker takes it if it opens again. While no session is open, answers wait in the hub, and the page says so.
- `/phone hub` puts the page on your tailnet with `tailscale serve`, with its QR code. The hub answers only requests that carry your own Tailscale login, which serve adds and no client can fake through it. Another person on your tailnet, a tagged device, or a page on the Mac gets nothing. Answers must come from the page itself (a header a cross-site form cannot send).
- The page draws everything as text, never as markup, and loads nothing from anywhere else.
- Needs Node (found on the `PATH`, in your login shell, or in `/opt/homebrew/bin`, `/usr/local/bin` or `~/.local/node/bin`).
- The page's faces are looked for in `~/.claude/desk-hub/fonts/` (`YYMono-Regular.otf`, `bricolage-latin.woff2`); none ship with the mod, and without them it falls back to the system's monospace and sans.

## Install

```bash
claude plugin install desk@baeyyond-claude
```

In the desktop app: + next to the prompt box, Plugins, Add marketplace `metahumansworld/baeyyond-claude`, then Add plugin.

## Tests

`claude plugin test desk` runs 30 tests: the asks across two sessions, the console's record, the serve rules against a config holding other handlers, the QR encoder (its codes were also read back by CoreImage's decoder), and the hub's feed and inbox, with an answer from the hub reaching the chat that asked and one for a closed session left in the desk for it.

## Licence

MIT, as the repository's `LICENSE`.
