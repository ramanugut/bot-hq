# Motion Engine (`make_motion_graphic`)

Motion graphics videos made from text alone: animated type, numbers, lists, charts, quotes and a logo ending.
Code: `scripts/tools/motion/`. It sits next to the promo engine (`scripts/tools/promo/`, photos and voice-over)
and uses the same renderer (HyperFrames 0.9.53 + GSAP), the same Chromium and the same single render slot.

The design spec this follows is "Botly Motion Engine: Motion Graphics Formula" (the Claude doc).

## How a video is made

```
storyboard JSON ──► Style DNA (seeded) ──► compile (palette, fonts, motion tokens)
                 └► components (HTML)  ──► index.html + runtime/engine.js (one paused GSAP timeline)
                                        ──► quality gate ──► hyperframes render ──► MP4
```

1. **Style DNA** (`src/dna.js`): 8 axes + hue = 127,401,984 combinations. A seed (any text) picks every axis
   that is not locked, always the same way. 10 compatibility rules repair bad combinations.
   16 presets (`--styles`). `remixDNA` changes one axis.
2. **Compile** (`src/compile.js`, `src/color.js`): OKLCH palette with five roles and enforced contrast
   (text 4.5:1, accent 3:1), 12 font pairings, 8 motion personalities (exact GSAP eases), safe margins
   per format.
3. **Components** (`src/components.js`, `src/styles.js`): 13 beats. Markup only; every component reads only
   CSS variables, so any component works in any style.
4. **Runtime** (`runtime/engine.js`, runs in the page): waits for fonts, shrinks text to fit, then builds one
   paused timeline. Seeded randomness only. No clock, timers or network.
5. **Quality gate** (`src/checks.js`):
   - storyboard rules: components, 2 to 4 s beats on a 0.5 s grid, last beat 2.5 s or more, word limits,
     no component twice in a row, the duration adds up
   - palette contrast and no linear eases
   - page check in headless Chromium (`index.html?botly-check`, read with `--dump-dom`): at the end of each
     beat the text on screen must equal the storyboard text, be fully visible, meet minimum sizes and sit
     inside the safe area
   - optional `--deep`: `hyperframes check` (slow on the server, so off by default)

## Commands

```
node scripts/tools/motion/make-motion.mjs --spec sb.json --check            # rules only (seconds)
node scripts/tools/motion/make-motion.mjs --spec sb.json --preview DIR      # one PNG per beat
node scripts/tools/motion/make-motion.mjs --spec sb.json --out video.mp4    # render
node scripts/tools/motion/make-motion.mjs --dna SEED                        # print a seed's style
node scripts/tools/motion/make-motion.mjs --styles                          # presets and axes
cd scripts/tools/motion && npm test                                          # unit tests, no browser
node scripts/tools/motion/test/sweep.mjs 30                                 # 30 random styles through the page check
```

Exit code 2 means the storyboard broke a rule; `--json` prints the list. The bot tool returns that list to the
bot to fix, so a weak storyboard never reaches the render queue.

Environment overrides: `BOTLY_HYPERFRAMES`, `BOTLY_CHROME` (else `HYPERFRAMES_BROWSER_PATH`,
`/usr/local/bin/chromium`, PATH), `BOTLY_GSAP` (else the promo engine's vendored copy).

## The bot tool

`make_motion_graphic` in `server/src/agent/tools.ts`. Needs approval like the other video tools.
Images (`ui-pan.image`, `logo-sting.logo`) must be inside the bot's own Library (realpath-checked) and are
copied into the build. With no style or seed, each video gets a new seed, and the tool reports it so the bot
can reuse the look.

## Server needs

Nothing new: Node 22, `/usr/local/bin/chromium` and `hyperframes@0.9.53` are already installed by
`scripts/extras.sh` for the promo engine. Fonts (21 files, 418 KB, all OFL-1.1) are in `scripts/tools/motion/fonts/`.

## Measured (this branch, x86 sandbox; not yet measured on the t4g.small)

- `--check`: about 2 seconds.
- 13-beat preview: about 10 seconds.
- 15-second 1080p draft render: 53 seconds.
- 45 random styles across 16:9, 9:16 and 1:1: all passed the page check.

## Adding a component

Add its markup to `RENDER` in `src/components.js`, its animation to `ANIM` in `runtime/engine.js`, its CSS
to `src/styles.js`, its rules to `REQUIRED` and `beatTexts` in `src/storyboard.js`, then add it to
`examples/all-components.json` and run the sweep. Mark every piece of visible text with the `text()` helper
so the gate checks it.
