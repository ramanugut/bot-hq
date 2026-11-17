#!/usr/bin/env python3
"""Botly promo engine: a polished vertical promo video from a short JSON brief.

  python3 /opt/botly/app/scripts/tools/promo/make-promo.py --spec brief.json --out /root/botly/files/<bot>/promo.mp4

Design and motion come from the template (HyperFrames + GSAP): text that always fits, cinematic
push-ins, transitions, price cards with counting numbers, a call-to-action close, a story progress bar
and word-by-word captions timed to a free South African voice-over (edge-tts).

Brief (JSON):
{
  "brand": {"name": "Mumatec Hosting", "url": "mumatechosting.co.za", "logo": "/path/logo.png",
            "accent": "#19C3F3", "accent2": "#8AF04A", "deep": "#0B1F4B"},
  "voice": "en-ZA-LeahNeural",          # or en-ZA-LukeNeural; "" for no voice-over
  "music": "/path/music.mp3",           # optional, kept quiet under the voice
  "captions": true,                     # word-by-word captions of the voice-over
  "scenes": [
    {"type": "hero", "image": "/path/a.png", "kicker": "New", "title": "Fast *South African* hosting",
     "sub": "From R49 a month", "say": "Your website deserves fast, local hosting."},
    {"type": "points", "image": "/path/b.png", "title": "Why Mumatec",
     "points": ["Free SSL", "Daily backups", "Local support"], "say": "..."},
    {"type": "prices", "title": "Pick your plan",
     "plans": [{"name": "Starter", "price": "R49", "per": "/mo", "features": ["1 site", "10 GB"]},
               {"name": "Business", "price": "R99", "per": "/mo", "popular": true, "features": ["5 sites"]}],
     "say": "..."},
    {"type": "cta", "title": "Launch online *today*", "button": "Order now", "say": "..."}
  ]
}
Top level: "style": neon | minimal | editorial | playful | luxury (default neon),
           "format": portrait (1080x1920) | square (1080x1080) | landscape (1920x1080) (default portrait).
Scene types: hero, image, points, prices, cta, and
  quote    {"quote": "...", "author": "Thabo M.", "role": "Owner, Kloof Cafe", "avatar": "/path.png", "stars": 5}
  compare  {"title": "...", "before": {"label": "Before", "text": "...", "image": "/path"}, "after": {...}}
  steps    {"title": "How it works", "steps": ["Pick a plan", "Add your domain", "Go live"]}
  stats    {"title": "...", "stats": [{"value": "99.9%", "label": "uptime"}, {"value": "2,500+", "label": "sites"}]}
  phone    {"title": "...", "sub": "...", "screenshot": "/path/tall-website-screenshot.png"}  (scrolls inside a phone)
Any scene may use "video": "/path/clip.mp4" instead of "image" as its moving background (muted).
Optional per scene: "duration" (seconds; otherwise it follows the voice-over), "transition"
(zoom, whip, wipe, flash, rise, slide, fade). *Starred words* in titles take the accent colour.
"""
import argparse, asyncio, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, 'template')
STYLES = {'neon': 0.7, 'minimal': 0.7, 'editorial': 0.75, 'playful': 0.6, 'luxury': 1.0}  # transition length, must match engine.js
FORMATS = {'portrait': (1080, 1920, 1.0), 'square': (1080, 1080, 0.74), 'landscape': (1920, 1080, 0.8)}
FORMAT_ALIASES = {'vertical': 'portrait', '9:16': 'portrait', 'reel': 'portrait', 'story': 'portrait', '1:1': 'square', 'feed': 'square',
                  'horizontal': 'landscape', '16:9': 'landscape', 'youtube': 'landscape', 'wide': 'landscape'}
DEFAULT_DUR = {'hero': 3.6, 'image': 3.2, 'points': 4.6, 'prices': 5.2, 'cta': 4.2, 'quote': 5.0, 'compare': 5.0, 'steps': 5.4, 'stats': 4.4, 'phone': 5.6}


def die(msg):
    print(f'make-promo: {msg}', file=sys.stderr)
    sys.exit(1)


async def speak(text, voice, mp3):
    """Voice-over with the time of every word (edge-tts WordBoundary events)."""
    import edge_tts
    words = []
    com = edge_tts.Communicate(text, voice, boundary='WordBoundary')
    with open(mp3, 'wb') as f:
        async for chunk in com.stream():
            if chunk['type'] == 'audio':
                f.write(chunk['data'])
            elif chunk['type'] == 'WordBoundary':
                s = chunk['offset'] / 1e7
                words.append({'text': chunk['text'], 's': s, 'e': s + chunk['duration'] / 1e7})
    return words


def audio_len(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def hyperframes_cmd():
    for c in (shutil.which('hyperframes'), '/opt/botly/node/bin/hyperframes'):
        if c and os.path.exists(c):
            return [c]
    return ['npx', '-y', 'hyperframes@0.9.58']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--spec', required=True, help='JSON brief (file path, or - for stdin)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--quality', default='standard', choices=['draft', 'standard', 'high'], help='draft renders faster for a preview')
    ap.add_argument('--keep', action='store_true', help='keep the build folder (for debugging)')
    ap.add_argument('--preview', metavar='DIR', help='do not render: save one still per scene (PNG) into DIR to check the design quickly')
    a = ap.parse_args()

    spec = json.load(sys.stdin if a.spec == '-' else open(a.spec))
    scenes = spec.get('scenes') or []
    if not scenes:
        die('the brief has no scenes')
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        die('ffmpeg is not installed')

    build = tempfile.mkdtemp(prefix='promo-')
    shutil.copytree(TEMPLATE, build, dirs_exist_ok=True)
    os.makedirs(os.path.join(build, 'assets'), exist_ok=True)

    def asset(path, kind):
        if not path:
            return None
        if not os.path.isfile(path):
            die(f'{kind} not found: {path}')
        name = f"{len(os.listdir(os.path.join(build, 'assets')))}-{re.sub(r'[^A-Za-z0-9._-]', '_', os.path.basename(path))}"
        shutil.copy(path, os.path.join(build, 'assets', name))
        return f'assets/{name}'

    brand = dict(spec.get('brand') or {})
    brand['logo'] = asset(brand.get('logo'), 'logo')
    style = str(spec.get('style') or 'neon').lower()
    if style not in STYLES:
        die(f'unknown style "{style}"; use one of {", ".join(STYLES)}')
    fmt = str(spec.get('format') or 'portrait').lower()
    fmt = FORMAT_ALIASES.get(fmt, fmt)
    if fmt not in FORMATS:
        die(f'unknown format "{fmt}"; use portrait, square or landscape')
    W, H, FS = FORMATS[fmt]
    TR = STYLES[style]

    voice = spec.get('voice', 'en-ZA-LeahNeural')
    say_any = voice and any((s.get('say') or '').strip() for s in scenes)
    voice_ok = bool(say_any)
    if say_any:
        try:
            import edge_tts  # noqa: F401
        except ImportError:
            print('voice-over skipped: edge-tts is not installed (pip3 install --break-system-packages edge-tts)', file=sys.stderr)
            voice_ok = False

    # Voice-over per scene, then the timeline: each scene lasts as long as its line (or its default).
    t = 0.0
    out_scenes, captions, audio_tags, media_tags = [], [], [], []
    for i, s in enumerate(scenes):
        s = dict(s)
        s['type'] = s.get('type') if s.get('type') in DEFAULT_DUR else 'hero'
        s['image'] = asset(s.get('image'), 'image')
        s['avatar'] = asset(s.get('avatar'), 'avatar')
        s['screenshot'] = asset(s.get('screenshot') or (s.get('image') and None), 'screenshot')
        if s['type'] == 'phone' and not s['screenshot']:
            if s['image']:
                s['screenshot'], s['image'] = s['image'], None
            else:
                die(f'scene {i + 1} (phone) needs a "screenshot"')
        for side in ('before', 'after'):
            if isinstance(s.get(side), dict):
                s[side] = dict(s[side], image=asset(s[side].get('image'), f'{side} image'))
        video = asset(s.get('video'), 'video')
        lead = 0.35 if i == 0 else TR * 0.8  # let the transition land before speaking
        dur = float(s.get('duration') or DEFAULT_DUR[s['type']])
        line = (s.get('say') or '').strip()
        if voice_ok and line:
            mp3 = os.path.join(build, 'assets', f'voice-{i}.mp3')
            try:
                words = asyncio.run(speak(line, voice, mp3))
                length = audio_len(mp3)
                if length > 0.3:
                    dur = max(dur, lead + length + 0.45)
                    audio_tags.append(f'<audio class="clip" src="assets/voice-{i}.mp3" data-start="{t + lead:.3f}" data-duration="{length:.3f}" data-track-index="2" data-volume="1"></audio>')
                    captions += [{'text': w['text'], 's': round(t + lead + w['s'], 3), 'e': round(t + lead + w['e'], 3)} for w in words]
            except Exception as e:  # noqa: BLE001
                print(f'voice-over skipped for scene {i + 1}: {e}', file=sys.stderr)
        s['start'] = round(t, 3)
        s['dur'] = round(dur, 3)
        if video:
            s['video'] = video
            media_tags.append(f'<video id="v{i}" class="clip" src="{video}" muted playsinline data-start="{t:.3f}" data-duration="{dur + TR:.3f}" data-track-index="1"></video>')
        out_scenes.append(s)
        t += dur
    total = round(t + 0.3, 3)

    music = asset(spec.get('music'), 'music')
    if music:
        vol = 0.12 if captions else 0.5
        audio_tags.append(f'<audio class="clip" src="{music}" data-start="0" data-duration="{total}" data-track-index="3" data-volume="{vol}" data-fade-in="0.5" data-fade-out="1.5"></audio>')

    promo = {
        'style': style, 'format': fmt, 'W': W, 'H': H, 'fs': FS,
        'brand': brand,
        'scenes': out_scenes,
        'captions': captions if spec.get('captions', True) else [],
        'progress': spec.get('progress', True),
        'duration': total,
    }
    with open(os.path.join(build, 'spec.js'), 'w') as f:
        f.write('window.PROMO = ' + json.dumps(promo, ensure_ascii=False) + ';\n')
    html = open(os.path.join(build, 'index.html')).read()
    caps = bool(promo['captions'])
    classes = f'st-{style} fmt-{fmt} {"has-captions" if caps else "no-captions"}'
    html = (html.replace('{{DURATION}}', str(total)).replace('{{W}}', str(W)).replace('{{H}}', str(H))
            .replace('{{RESOLUTION}}', fmt).replace('{{CLASSES}}', classes)
            .replace('<!--MEDIA-->', '\n      '.join(media_tags + audio_tags)))
    open(os.path.join(build, 'index.html'), 'w').write(html)

    env = dict(os.environ, HYPERFRAMES_NO_TELEMETRY='1', HYPERFRAMES_NO_UPDATE_CHECK='1', HYPERFRAMES_SKIP_SKILLS='1')
    env['PATH'] = '/opt/botly/node/bin:' + env.get('PATH', '')
    for chrome in ('/usr/local/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'):
        if os.path.exists(chrome) and 'HYPERFRAMES_BROWSER_PATH' not in os.environ:
            env['HYPERFRAMES_BROWSER_PATH'] = chrome
            break
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        at = ','.join(f"{sc['start'] + min(sc['dur'] * 0.75, sc['dur'] - 0.2):.2f}" for sc in out_scenes)
        r = subprocess.run(hyperframes_cmd() + ['snapshot', build, '--at', at, '--no-end', '-o', a.preview], env=env, capture_output=True, text=True)
        shutil.rmtree(build, ignore_errors=True)
        if r.returncode != 0:
            print((r.stdout + r.stderr)[-2000:], file=sys.stderr)
            die('preview failed')
        print('\n'.join(sorted(os.path.join(a.preview, f) for f in os.listdir(a.preview) if f.endswith('.png'))))
        return
    quality = {'draft': 'draft', 'standard': 'looks', 'high': 'delivery'}[a.quality]
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    print(f'Rendering {total:.1f}s {style} {fmt} video, {len(out_scenes)} scenes{" with voice-over" if captions else ""}... (2 to 6 minutes)', flush=True)
    cmd = hyperframes_cmd() + ['render', build, '-o', out, '--quality', quality, '--fps', '30', '--low-memory-mode', '--quiet']
    if a.quality != 'high':
        cmd += ['--crf', '21', '--max-bitrate', '7M']  # sharp on a phone, small enough to share
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        print((r.stdout + r.stderr)[-3000:], file=sys.stderr)
        die(f'render failed (build kept at {build})')
    if not a.keep:
        shutil.rmtree(build, ignore_errors=True)
    else:
        print(f'build folder: {build}')
    if say_any and not captions:
        print('note: the video has no voice-over (see the messages above)')
    print(out)


if __name__ == '__main__':
    main()
