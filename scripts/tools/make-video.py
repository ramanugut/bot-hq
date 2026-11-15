#!/usr/bin/env python3
"""Make a short vertical promo video from images, with captions, optional voice-over and music.
Free: ffmpeg for video, edge-tts (Microsoft Edge voices) for the voice-over.

  python3 make-video.py --images a.png b.png c.png --captions "Fast hosting" "From R49/month" "mumatec.co.za" \\
      --voice "Fast, reliable South African web hosting from just R49 a month." --out promo.mp4 [--music song.mp3] [--size 1080x1920] [--seconds 3]
"""
import argparse, os, shutil, subprocess, sys, tempfile

p = argparse.ArgumentParser()
p.add_argument('--images', nargs='+', required=True)
p.add_argument('--captions', nargs='*', default=[])
p.add_argument('--voice', default='', help='voice-over text (spoken with edge-tts)')
p.add_argument('--voice-name', default='en-ZA-LeahNeural')
p.add_argument('--music', default='')
p.add_argument('--size', default='1080x1920', help='1080x1920 for Reels/TikTok, 1080x1080 square, 1920x1080 YouTube')
p.add_argument('--seconds', type=float, default=3.0, help='seconds per image (stretched to fit the voice-over)')
p.add_argument('--out', required=True)
a = p.parse_args()
if not shutil.which('ffmpeg'):
    sys.exit('ffmpeg is not installed: apt-get install -y ffmpeg')
W, H = (int(x) for x in a.size.lower().split('x'))
tmp = tempfile.mkdtemp()
voice = ''
if a.voice:
    voice = os.path.join(tmp, 'voice.mp3')
    # The bot's terminal may run a Python of its own without edge-tts: try each one, then the edge-tts command.
    tries = [[py, '-m', 'edge_tts'] for py in dict.fromkeys([sys.executable, '/usr/bin/python3', '/usr/local/bin/python3']) if py and os.path.exists(py)]
    if shutil.which('edge-tts'): tries.append([shutil.which('edge-tts')])
    errors = []
    for base in tries:
        r = subprocess.run(base + ['--voice', a.voice_name, '--text', a.voice, '--write-media', voice], capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(voice) and os.path.getsize(voice) > 1000:
            break
        errors.append(f"{' '.join(base)}: {(r.stderr or r.stdout).strip().splitlines()[-1:] or ['failed']}")
    else:
        print('voice-over skipped. Tried:\n  ' + '\n  '.join(errors) + '\nFix: pip3 install --break-system-packages edge-tts', file=sys.stderr)
        voice = ''
per = a.seconds
if voice:
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', voice], capture_output=True, text=True).stdout or 0)
    if dur > 0: per = max(per, (dur + 0.6) / len(a.images))
font = next((f for f in ['/usr/share/fonts/opentype/inter/Inter-Bold.otf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if os.path.exists(f)), '')
clips = []
for i, img in enumerate(a.images):
    out = os.path.join(tmp, f'c{i}.mp4'); frames = int(per * 30)
    vf = (f"scale={W*2}:{H*2}:force_original_aspect_ratio=increase,crop={W*2}:{H*2},"
          f"zoompan=z='min(zoom+0.0009,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps=30")
    cap = a.captions[i] if i < len(a.captions) else ''
    if cap:
        txt = os.path.join(tmp, f't{i}.txt'); open(txt, 'w').write(cap)
        vf += (f",drawtext=textfile='{txt}':{'fontfile=' + font + ':' if font else ''}fontsize={int(W*0.07)}:fontcolor=white:"
               f"box=1:boxcolor=black@0.45:boxborderw={int(W*0.025)}:x=(w-text_w)/2:y=h*0.78")
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-i', img, '-vf', vf, '-t', f'{per:.2f}', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', out], check=True)
    clips.append(out)
lst = os.path.join(tmp, 'list.txt'); open(lst, 'w').write(''.join(f"file '{c}'\n" for c in clips))
silent = os.path.join(tmp, 'v.mp4')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', silent], check=True)
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', silent]
if voice: cmd += ['-i', voice]
if a.music: cmd += ['-stream_loop', '-1', '-i', a.music]
if voice and a.music:
    cmd += ['-filter_complex', '[2:a]volume=0.18[m];[1:a][m]amix=inputs=2:duration=first[a]', '-map', '0:v', '-map', '[a]']
elif voice: cmd += ['-map', '0:v', '-map', '1:a']
elif a.music: cmd += ['-map', '0:v', '-map', '1:a', '-shortest']
cmd += ['-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', a.out] if (voice or a.music) else ['-c', 'copy', '-movflags', '+faststart', a.out]
subprocess.run(cmd, check=True)
print(a.out)
