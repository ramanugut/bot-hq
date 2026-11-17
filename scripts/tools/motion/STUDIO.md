# Botly Motion Studio

Read this before any video that is more than a quick promo: a launch film, a brand or luxury ad, a 3D product
reveal, a music-synced piece, an explainer, or anything the person calls premium, cinematic or "like <a reference>".
A quick promo from a few lines is still `make_promo_video`.

It sits on top of the official HyperFrames skill. Where the two differ, this page wins in Botly.

## Where things are

- `SKILLS=/opt/botly/node/lib/node_modules/hyperframes/dist/skills`
- Read `$SKILLS/hyperframes/SKILL.md` first, then the reference its "What to read" table names for this video
  (launch, explainer, music, data, vertical, 3D, character), plus `references/story.md`, `references/spec.md`,
  `references/motion.md`, `references/sound.md` and `references/review.md` as you reach each step.
- CLI details: `$SKILLS/hyperframes-cli/SKILL.md`. Media: `$SKILLS/media-use/SKILL.md`, free parts only (below).
- Projects live in your Library: `/root/botly/files/<your bot id>/videos/<name>`.

## Botly differences from the official skill

- Run the CLI as `hyperframes <command>`. It is already set up with this server's Chromium. Never `npx hyperframes`,
  never `plugin-cli.mjs`, never install or update HyperFrames or its skills.
- The Studio preview and the desktop app are not available. `preview_video_project` is the preview: it runs
  `hyperframes check`, captures the review sheets (each scene, every cut, phone width) and shows the scene sheet in
  the chat. `render_video_project` is the delivery render.
- No HeyGen account. Never run `events`, `usage`, `auth`, `billing`, `templates`, `cloud`, `lambda`, `cloudrun`,
  `publish`, `share`, `open`, `present`, `preview`, `reverse` or `snapshot --describe`, and never `media-use generate`
  or `heygen`. Do not ask the person to sign in anywhere.
- Free media only:
  - Voice-over: `python3 -m edge_tts --voice en-ZA-LeahNeural --text "..." --write-media vo.mp3` (or `en-ZA-LukeNeural`).
  - Sound effects: the bundled ones in `$SKILLS/media-use/audio/`, or Openverse (CC0 or CC BY, credit it in the reply).
  - Music: a track the person gives you, or a CC0/CC BY track; say where it came from. Place cuts with `hyperframes beats`.
  - Images: the product's real screens and logo. A web page as a picture:
    `chromium --headless --no-sandbox --hide-scrollbars --window-size=1440,900 --screenshot=/path.png URL`.
- One render or preview runs at a time on this server, and a render stops after 10 minutes. Keep films at 1080p,
  30 fps, 15 to 45 seconds. There is no graphics card: keep each 3D shot under 6 seconds, low-poly, and preview
  it before building more.
- Libraries live in the project's `assets/`, not on a CDN: copy GSAP from `/opt/botly/app/scripts/tools/promo/template/gsap.min.js`;
  for 3D, `curl -fsSLo assets/three.module.min.js https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js`.
  A working seek-driven Three.js shot to start from: `/opt/botly/app/docs/motion-benchmark/3d-test/index.html`.

## The director's order

1. **Brief.** Product, audience, the one feeling, where it plays (landscape for YouTube or a website, portrait for
   Reels, TikTok and Status), length, must-say lines, real assets. Ask at most three questions; otherwise assume
   and say what you assumed.
2. **Three storylines** in words only, genuinely different films (`references/story.md`). Offer them with
   `ask_user`: one option per storyline (a short title as the label, its two-sentence pitch as the description),
   your pick marked as recommended. Do not list them in your reply as well. Skip this if they asked for no stops.
3. **SPEC.md** in the project (`references/spec.md`): every adjective as a number (seconds, eases, sizes,
   colours), the shots by time, and the defaults you will not use.
4. **Build.** One scene per sub-composition. Search the catalog before hand-writing an effect, transition,
   title, chart or caption style: `hyperframes catalog <words> --json`, then `hyperframes add <name>` in the project.
   Real screens and logos, music and sound on visible actions (`references/sound.md`).
5. **Preview.** `preview_video_project`. Open every sheet it lists and look. Fix every error, weigh every
   warning, preview again. Repeat until there are no errors and the sheets pass the scorecard.
6. **Ask.** The scene sheet is already in the chat. In two lines, say what the film does and what changed since
   the last preview, then ask with `ask_user`: "Render it" (recommended) and "Change something first". Skip the
   question only if they asked for no stops.
7. **Render** with `render_video_project`, then write the delivery note (`references/review.md`).

## The Botly scorecard

Every film passes all seven before you ask to render:

1. **Every word is readable.** Nothing hidden, cut off or overlapping; reading text at least 28 px on the 1080 px
   side; each line stays up for at least 0.3 s per word plus 0.5 s.
2. **One idea per shot.**
3. **The camera moves for a reason.** No endless slow zoom; nothing frozen for more than 3 s unless it is a
   deliberate hold.
4. **Cuts land on the music** (`hyperframes beats`).
5. **Clean sound.** A music bed, sounds on the visible actions, a clear voice, even levels.
6. **Looks like the brand, not a template.** One palette, at most two typefaces, the real logo and real screens.
7. **The gut test.** Would the owner post it on their own page today without changing anything?

Banned defaults: every element fading up from below; a slow zoom on every scene; centred text on a gradient in
every scene; a whoosh on every cut; emoji standing in for icons; invented UI or placeholder images.

## Benchmarks

`/opt/botly/app/docs/MOTION-BENCHMARK.md` holds four test briefs with reference films. When the owner asks for a
benchmark run, make the named brief with this process and compare it with the reference and the scorecard.
