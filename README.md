# simulation

A theme mod for the Claude desktop app's Code tab: a CLI simulation in a real room, dark only, with sound, where every motion has a reason.

Behind the conversation sits a traced picture of Ardhanarishvara, half Shiva and half Parvati, above a meditating yogi, among galaxies and floating mountains with waterfalls, all in ultramarine, under falling binary rain. The picture is pure vector: seven still layers that never repaint, and one layer of motion over them.

## What moves, and why

- The galaxies turn, the waterfalls fall, ripples spread from the yogi, and light climbs the axis of light. The picture is alive.
- One bright orb rises the axis for each tool call in flight.
- The rain and the light quicken while Claude works or runs tests.
- A failed tool turns the third eye, the eyes and the rain red.
- A file edit sends one bright ripple from the yogi and loads the next frame.
- A finished turn sends one shooting star across the sky.

A veil over the chat column keeps your words readable (text 11.7:1, muted text 5.8:1 on the brightest part of the picture). The band above the prompt has a hold motion button. With Reduce Motion on, the scene rests still. The `/console` pane shows the picture's eyes, a rain rail with one lane per tool call, and a log.

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

The traced layers in `hooks/trace/` are generated from the source picture with potrace and are not meant to be edited by hand.
