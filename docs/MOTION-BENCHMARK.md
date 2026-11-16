# Motion benchmark

Four test films that show whether Botly's videos are getting better. Each one is made twice: once with the quick
promo engine (`make_promo_video`, the "before") and once with Botly Motion Studio (`scripts/tools/motion/STUDIO.md`,
the "after"). A change to the video system is kept only if the "after" films clearly beat the "before" films on the
scorecard below.

The reference films are for direction only: pace, light, type and energy. Nothing from them is copied or used in a
Botly video.

## The scorecard

1. **Every word is readable.** Nothing hidden, cut off or overlapping; on screen long enough to read.
2. **One idea per shot.**
3. **The camera moves for a reason.** No endless zooming, no long frozen stretches.
4. **Cuts land on the music.**
5. **Clean sound.** Clear voice, music and effects at even levels.
6. **Looks like a brand, not a template.** One palette, at most two typefaces, the real logo and screens.
7. **The gut test.** Would the owner post it on their own page today?

Score each 0 (fails), 1 (passes) or 2 (would hold up next to the reference).

## The briefs

| # | Film | Format | Length | Reference |
|---|---|---|---|---|
| 1 | **Mumatec Premium**: luxury ad. Black and warm gold, serif titles, slow drift, at most six words on screen, soft music. Ends on "Hosting that just works." | Landscape | 20 s | L'Odyssée de Cartier (Cartier, 2012): pace, light and restraint only |
| 2 | **Meet Botly**: software launch. Real Botly screens, the camera gliding over the app, a task typed, the bot working, the result arriving. | Landscape | 30–45 s | The HyperFrames launch films (hyperframes.heygen.com/launch-videos): made with the same engine, so the realistic bar |
| 3 | **The Box**: 3D product reveal. A server box turning slowly, light sweeping across it, Botly's mint glow, ends on the name. | Landscape | 15 s | Apple's iPhone 17 Pro launch film (2025): lighting and camera only |
| 4 | **Black Friday**: high-energy promo. Fast cuts on the beat, huge type, R59 / R79 / R120 slamming in, ends on "Grab yours." | Portrait | 15 s | Spotify Wrapped motion system by Vucko (2021–2023): kinetic type and colour |

The "before" briefs for the promo engine are in `docs/motion-benchmark/` (1, 2 and 4; the promo engine has no 3D).
`botly-app-phone.png` is a phone screenshot of the Botly app for brief 2 (taken from a test copy, so it shows sample chats). Mumatec's real logo is not in the
repository: add it before scoring item 6 ("looks like a brand") for the Mumatec films.

To render a "before" on the server:

```bash
python3 /opt/botly/app/scripts/tools/promo/make-promo.py --spec /opt/botly/app/docs/motion-benchmark/1-mumatec-premium.json --out /root/botly/before-1.mp4
```

To make an "after", ask a bot in the app: "Benchmark run: make brief 1 from docs/MOTION-BENCHMARK.md with Motion Studio."

## Results

| Date | Film | Before | After | Notes |
|---|---|---|---|---|
| 16 Nov 2026 | 1, 2, 4 | `before-*.jpg` (one frame every 2.6 s; 1.6 s for 4). Rendered in a test sandbox without voice-over (the voice service was unreachable there), so scenes are shorter than on the server | Not yet made | First baseline; the engine renders correctly with HyperFrames 0.9.58. Seen: the same left-aligned layout in every scene with empty space beside it; blurred blobs as the only background; a near-blank frame between scenes; in the portrait film the content fills only the middle third and the type is too small for a phone. Tidy, not premium. |
| 16 Nov 2026 | 3 (test) | The promo engine has no 3D | `3d-test/` | Not a film: a 6 s Three.js shot to measure speed. 1080p, 30 fps, no GPU: 32 s to render on 4 x86 cores, so roughly 2 minutes expected on the t4g.small (estimate, not measured). Check passed with no errors, yet the box is too dark and the light strip clips to white: the automatic check does not replace looking. |
