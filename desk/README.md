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
- Each file names the store its session reads, and for each store the page believes only the files written within a minute of that store's newest: an ask shows while one of them holds it, standing as the newest that holds it says, so an ask closed since does not come back from the file of a session that has ended. A file stamped ahead of the clock, as after the clock is set back, is believed too, among the files stamped ahead; where it and one that is not ahead hold the same ask, the one that is not says how it stands.
- Limits. After the clock is set back, a store's newest file stamped before it, and the files stamped within a minute before that one, are believed while their stamps are ahead and, while a session of that store is open, for about a minute after the clock has passed them; and with them, until an open session writes again, which it does at its next poll, the newest file that is not ahead, however old; so a closed ask one of them holds can show as open. Once the clock passes such a stamp with every session of that store closed, the file that carries it is the store's newest: its asks stay on the page and the last session's open asks can leave the page, until a session of that store opens; with one open, the store's open asks can leave the page when the computer wakes from a sleep that carried the clock past such a stamp, until an open session's next poll. An ask held only by the file of a session on 0.2.1 or older can leave the page while another session writes, until a session on this version opens on that ask's store; and until the open sessions have restarted on this version, a closed ask can still show as open; restart the open sessions after updating. The file of a store whose name no open session carries is believed until it is deleted after seven days; deleting the file (in `~/.claude/desk-hub/feeds/`) clears it. An answer given on the page to an ask whose store has no open session (a development copy of the desk keeps a store of its own) can be handed to a session of another store, and is then lost.
- An answer from the page goes to the session that asked, as your next message starting `Re: <title>`. If that session is closed, an open one leaves the answer in the desk for it, and the asker takes it if it opens again. While no session is open, answers wait in the hub, and the page says so.
- `/phone hub` puts the page on your tailnet with `tailscale serve`, with its QR code. The link carries the hub's key: a random secret the hub makes new each time it starts, once it holds the port, and keeps in `~/.claude/desk-hub/secret` (0600; the folder is 0700, and the hub sets those modes at start and every few seconds). Any request without the key gets 404, so a program run by another account on the Mac gets nothing. Programs run by your own account are not kept out: they can read the key and the hub's files, and write its inbox, as they can everything else of yours. The sessions never send the key: they check the hub by asking it to prove it holds the key for a fresh random number, so a program that takes the port while the hub is down learns nothing from them. The phone cannot check who answers: its saved link carries the key to whatever listens on the port. So each start of the hub also gets its own address on your tailnet, a port chosen at random that none of its last thousand starts had, and the hub answers under its key only at that address. Once the hub has proven itself, the code in the session pane moves to the new address (a new serve, always to `127.0.0.1` itself), and the desk turns off the serve it made for the old one; the key is also renewed every 30 days while the hub runs, at the same address. The hub also answers only requests that carry your own Tailscale login, which serve adds and no client can fake through it, so another person on your tailnet or a tagged device gets nothing. Answers must come from the page itself (a header a cross-site form cannot send).
- What the phone link protects against: other people and devices on your tailnet, and programs of another account on this Mac that try the link without the key. What it does not protect against: programs of your own account. It also does not fully protect against another account on the same Mac. If a program of such an account takes the hub's port while the hub is down, and you open a saved phone link then, you may see its page instead of yours. It cannot read your asks or answer for you, because the sessions never send it anything and the hub's key for the next start never reaches it. So scan a new code after each restart of the hub (half a day with no session, an update, a restart of the Mac), and close old links: the old link stops opening, so scan the new code in the session pane or run `/phone hub`.
- The page draws everything as text, never as markup, and loads nothing from anywhere else.
- Needs Node (found on the `PATH`, in your login shell, or in `/opt/homebrew/bin`, `/usr/local/bin` or `~/.local/node/bin`).
- The page's faces are looked for in `~/.claude/desk-hub/fonts/` (`YYMono-Regular.otf`, `bricolage-latin.woff2`); none ship with the mod, and without them it falls back to the system's monospace and sans.

## Install

```bash
claude plugin install desk --marketplace metahumansworld/baeyyond-claude
```

In the desktop app: + next to the prompt box, Plugins, Add marketplace `metahumansworld/baeyyond-claude`, then Add plugin.

## Tests

`claude plugin test desk` runs 76 tests: the asks across two sessions, the console's record, the serve rules against a config holding other handlers, the QR encoder (its codes were also read back by CoreImage's decoder), the hub's feed and inbox, with an answer from the hub reaching the chat that asked and one for a closed session left in the desk for it, and how the hub reads the files: which asks the page shows when a session ends, closes an ask, writes a moment behind another, reads another store or carries a stamp from a clock since set back. They also cover the hub's key in the link and the pane, and the session's proven check: no command it runs sends the key, a listener that cannot prove is not taken for the hub, and a hub too old to prove is known by its process; the hub is served only at its own address for each start, to `127.0.0.1`, and the pane's code moves there when the hub starts again while the old address is turned off. `node --test hub/server.test.mjs`, from `desk/`, runs 21 more against the real hub on test ports (`DESK_HUB_TEST_PORT`, default 47913, and the five after it) in folders of their own (under `DESK_HUB_TEST_TMP`, default the system's temp folder), with a stand-in for Tailscale: 404 without the key, the proof, a stand-in listener that gets no key, eight hubs started together agreeing on one key, a hub that loses the port writing none, a new key at each start so that a key caught by a program holding the port while the hub was down opens nothing, renewal while running but not on one failed read, an address of its own at each start that the hub alone answers the key at, and the file modes. `node --test checks/state-vs-0.2.0.test.mjs`, run in the repository's folder, is a one-time comparison that needs the repository's history: for files of one store, all written within the minute and none stamped ahead of the clock, the page is what 0.2.0 drew. In a copy without that history, such as a shallow clone or an installed copy, it skips and says so.

## Licence

MIT, as the repository's `LICENSE`.
