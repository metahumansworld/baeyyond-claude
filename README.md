# simulation

A theme mod for the Claude desktop app's Code tab: a CLI simulation in a real room, dark only, with sound, where every motion has a reason.

Behind the conversation sits a traced picture of Ardhanarishvara, half Shiva and half Parvati, above a meditating yogi, among galaxies and floating mountains with waterfalls, all in ultramarine, under falling binary rain, with the baeYYond mark glowing at its centre. The whole backdrop is one pure-vector SVG, under the app's 131,072-character limit for one drawing.

## What moves, and why

- The galaxies turn, the waterfalls fall, stars twinkle, ripples spread from the yogi, and light climbs the axis of light. The picture is alive.
- The baeYYond mark glows at the centre, breathing faster while Claude works.
- One bright orb rises the axis for each tool call in flight.
- The rain and the light quicken while Claude works or runs tests.
- A failed tool turns the third eye, the eyes, the rain and the mark red.
- A file edit sends one bright ripple from the yogi and loads the next frame.
- A finished turn sends one shooting star across the sky.

Where your words sit, a darken cap holds the picture's brightest parts down so they stay readable (text 7.5:1, muted text 3.7:1 over the brightest part, measured at 1000x650). At the window's foot the art fades into the composer's own navy, and the composer's ring is the rain's blue, so the prompt reads as part of the picture. The baeYYond mark sits on the composer's top edge: every ten seconds it decodes out of binary and a light sweeps across it. With Reduce Motion on, the scene rests still. The `/console` pane shows the picture's eyes, a rain rail with one lane per tool call, a log, a hold-motion button, a small glowing baeYYond badge, and whether the app is drawing the theme.

## Where it shows

- **Desktop app (Code tab):** everything above, with sound.
- **Terminal (Claude Code):** a terminal draws no picture, so the rain falls as real `0` and `1` characters in the blank space behind the chat, never over words, red after a failure and faster while work runs, with the mark on the prompt. It needs the default full-screen layout (not `CLAUDE_CODE_NO_FLICKER=0`, and not inside tmux).
- **Mobile app:** not yet. A session opened on a phone over Remote Control shows the app's own look.

## Install

At the prompt of a terminal session:

```
/plugin install simulation --marketplace metahumansworld/baeyyond-claude
```

Answer `y` to add the marketplace, then choose a scope.

From a shell:

```bash
claude plugin install simulation --marketplace metahumansworld/baeyyond-claude
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `metahumansworld/baeyyond-claude`, then Add plugin.

## Building the picture

The traced picture in `simulation/hooks/trace/` and the mark in `simulation/hooks/logo-path.ts` are generated with potrace and are not meant to be edited by hand.

A backdrop must be one `Svg` filling the window: an earlier version stacked seven SVGs in positioned boxes, and the app drew nothing. Glass stays off: with any glass setting, even over a 1 KB scene, the desktop app drew no art at all.

## Also here: desk

A second mod in this marketplace, in [`desk/`](desk/README.md): a Waiting-on-you pane where every session puts what it needs from you (answered with buttons or a reply, straight into the session that asked), a hub page with every session's asks grouped by session that you answer from your phone over your tailnet (`/phone hub`), a console of what this session is doing, and `/phone <port>` to open a local site on your phone as a QR code.

```bash
claude plugin install desk@baeyyond-claude
```

## Licence

The code is MIT (see `LICENSE`). The baeYYond name and mark are not covered by it: all rights to them are reserved (see `TRADEMARK.md`).
