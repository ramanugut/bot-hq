#!/usr/bin/env bash
# Free extras the bots use. Safe to run again: it only installs what is missing.
#   - MarkItDown: turns PDF, Word, PowerPoint, Excel, web pages and more into text (read_document tool)
#   - SearXNG: a private, free web search on 127.0.0.1:8888 (free_search tool)
# Run as root:  bash /opt/hq/app/scripts/extras.sh
set -uo pipefail
mkdir -p /var/log/hq

main() {
  # ---------- MarkItDown, in its own Python environment so the system's Python stays untouched
  if ! command -v markitdown >/dev/null 2>&1; then
    echo "Installing the document reader (MarkItDown)..."
    apt-get install -y -qq python3-venv >/dev/null 2>&1 || true
    python3 -m venv /opt/hq/markitdown >/var/log/hq/markitdown.log 2>&1 \
      && /opt/hq/markitdown/bin/pip install -q --upgrade pip >>/var/log/hq/markitdown.log 2>&1 \
      && /opt/hq/markitdown/bin/pip install -q 'markitdown[pdf,docx,pptx,xlsx,xls,outlook]' >>/var/log/hq/markitdown.log 2>&1 \
      && ln -sf /opt/hq/markitdown/bin/markitdown /usr/local/bin/markitdown \
      && echo "  document reader ready" \
      || { echo "  note: MarkItDown did not install:"; tail -5 /var/log/hq/markitdown.log; }
  fi

  # ---------- HyperFrames: renders the promo videos (HTML + GSAP -> MP4 with this server's Chromium)
  if [ ! -x /opt/hq/node/bin/hyperframes ] || ! /opt/hq/node/bin/hyperframes --version 2>/dev/null | grep -q '^0\.9\.53'; then
    echo "Installing the video engine (HyperFrames)..."
    PATH=/opt/hq/node/bin:$PATH npm i -g --no-audit --no-fund hyperframes@0.9.53 >/var/log/hq/hyperframes.log 2>&1 \
      && echo "  video engine ready" || { echo "  note: HyperFrames did not install"; tail -5 /var/log/hq/hyperframes.log; }
  fi

  # A 'hyperframes' command for the bots' terminals: our Node, this server's Chromium, no telemetry.
  cat >/usr/local/bin/hyperframes <<'SH'
#!/bin/sh
export PATH=/opt/hq/node/bin:$PATH HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1
[ -z "$HYPERFRAMES_BROWSER_PATH" ] && [ -x /usr/local/bin/chromium ] && export HYPERFRAMES_BROWSER_PATH=/usr/local/bin/chromium
exec /opt/hq/node/bin/hyperframes "$@"
SH
  chmod 755 /usr/local/bin/hyperframes

  # ---------- SearXNG in Docker, reachable only from this server
  local dir=/opt/hq/searxng
  if ! command -v docker >/dev/null 2>&1; then
    echo "Installing Docker (for the free web search)..."
    apt-get install -y -qq docker.io >/var/log/hq/docker.log 2>&1 || { echo "  note: Docker did not install"; tail -5 /var/log/hq/docker.log; return 0; }
    systemctl enable --now docker >/dev/null 2>&1 || true
  fi
  if [ ! -f "$dir/settings.yml" ]; then
    mkdir -p "$dir"
    cat >"$dir/settings.yml" <<YML
use_default_settings: true
general:
  instance_name: "Botly search"
server:
  secret_key: "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  limiter: false
  image_proxy: false
  public_instance: false
search:
  safe_search: 0
  formats: [html, json]
YML
    chmod 755 "$dir"; chmod 644 "$dir/settings.yml"
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx searxng; then
    echo "Starting the free web search (SearXNG)..."
    docker rm -f searxng >/dev/null 2>&1 || true
    docker run -d --name searxng --restart unless-stopped \
      -p 127.0.0.1:8888:8080 \
      -v "$dir:/etc/searxng" \
      -e SEARXNG_BASE_URL=http://127.0.0.1:8888/ \
      -e GRANIAN_WORKERS=1 -e UWSGI_WORKERS=1 -e UWSGI_THREADS=2 \
      --memory 400m \
      docker.io/searxng/searxng:latest >/var/log/hq/searxng.log 2>&1 || { echo "  note: SearXNG did not start"; tail -5 /var/log/hq/searxng.log; return 0; }
    for _ in $(seq 1 40); do
      curl -fsS 'http://127.0.0.1:8888/search?q=test&format=json' >/dev/null 2>&1 && { echo "  free web search ready"; return 0; }
      sleep 2
    done
    echo "  note: SearXNG started but does not answer yet; check: docker logs searxng | tail"
  fi
}
main "$@"
