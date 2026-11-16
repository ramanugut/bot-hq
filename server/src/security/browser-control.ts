import WebSocket from 'ws';
import { isIP } from 'node:net';

export type BrowserAction =
  | { action: 'inspect' }
  | { action: 'navigate'; url: string }
  | { action: 'click'; selector: string }
  | { action: 'type'; selector: string; text: string };

/**
 * Reject internal endpoints by default. This prevents accidental direct
 * navigation to metadata/localhost, but is NOT a complete network egress
 * sandbox (a page can redirect or load subresources).
 */
export function publicBrowserUrl(raw: string): string {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only public HTTP(S) websites without embedded credentials are allowed');
  }
  const host = url.hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || !host.includes('.') || isIP(host) || host === 'localhost' ||
      host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.home.arpa') ||
      host.endsWith('.test') || host.endsWith('.invalid')) {
    throw new Error('Private host or IP address is not allowed for browser navigation');
  }
  return url.href;
}

function localCdpEndpoint(raw: string): URL {
  const endpoint = new URL(raw);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || !endpoint.port ||
      endpoint.pathname !== '/') {
    throw new Error('Botly browser must use a local, port-specific CDP endpoint');
  }
  return endpoint;
}

async function browserPage(cdpUrl: string): Promise<string> {
  const root = localCdpEndpoint(cdpUrl);
  const res = await fetch(new URL('/json/list', root), { signal: AbortSignal.timeout(4_000) });
  if (!res.ok) throw new Error('The bot browser is unavailable');
  const pages: any = await res.json();
  if (!Array.isArray(pages)) throw new Error('Unexpected browser response');
  const page = pages.find((x: any) => x?.type === 'page' && typeof x?.webSocketDebuggerUrl === 'string' && !String(x.url).startsWith('chrome-extension://'));
  if (!page) throw new Error('No browser tab is ready; open the bot live screen first');
  const ws = new URL(page.webSocketDebuggerUrl);
  if (ws.protocol !== 'ws:' || ws.hostname !== root.hostname || ws.port !== root.port) {
    throw new Error('Browser returned a CDP endpoint outside the bot session');
  }
  return ws.href;
}

/** Exactly one CDP call per connection. No browser JS, Node REPL or shell exposure. */
async function commandOnPage(cdpUrl: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  const pageWs = await browserPage(cdpUrl);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(pageWs, { handshakeTimeout: 3000, maxPayload: 2 * 1024 * 1024 });
    let settled = false;
    const settle = (err?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (err) reject(err); else resolve(result);
    };
    const timer = setTimeout(() => settle(new Error('Browser did not respond in time')), 10_000);
    socket.on('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
    socket.on('message', (payload) => {
      let body: any;
      try { body = JSON.parse(payload.toString()); } catch { return; }
      if (body.id !== 1) return;
      if (body.error) settle(new Error(String(body.error.message ?? 'Browser action failed')));
      else settle(undefined, body.result);
    });
    socket.on('error', (err) => settle(err));
    socket.on('close', () => { if (!settled) settle(new Error('Browser disconnected')); });
  });
}

async function evaluate(cdpUrl: string, expression: string): Promise<any> {
  const result = await commandOnPage(cdpUrl, 'Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (result?.exceptionDetails) throw new Error('Browser could not perform the requested action');
  return result?.result?.value;
}

/** Structured, limited browser operations. The caller MUST gate writes with Botly approvals. */
export async function runBrowserAction(cdpUrl: string, args: BrowserAction): Promise<string> {
  if (args.action === 'inspect') {
    const data = await evaluate(cdpUrl, `JSON.stringify({title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,9000)})`);
    return typeof data === 'string' ? data.slice(0,11000) : 'No readable page contents';
  }
  if (args.action === 'navigate') {
    const url = publicBrowserUrl(args.url);
    const result = await commandOnPage(cdpUrl, 'Page.navigate', { url });
    if (result?.errorText) throw new Error(String(result.errorText).slice(0,160));
    return 'Navigation requested. Use browser_inspect to verify the loaded page.';
  }
  if (args.action === 'click') {
    const selector = args.selector.trim();
    if (!selector || selector.length > 500) throw new Error('Provide a CSS selector (up to 500 characters)');
    const pos = await evaluate(cdpUrl,
      `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) throw new Error('Requested element was not found');
    await commandOnPage(cdpUrl, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await commandOnPage(cdpUrl, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    return 'Click sent. Use browser_inspect to verify the result.';
  }
  if (args.action === 'type') {
    const selector = args.selector.trim();
    if (!selector || selector.length > 500 || typeof args.text !== 'string' || args.text.length > 2000) {
      throw new Error('Invalid selector or text (max 2000 characters)');
    }
    const prepared = await evaluate(cdpUrl, `(() => {
      const e=document.querySelector(${JSON.stringify(selector)});
      if (!e || !(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) ||
          e.type==='password' || e.type==='hidden' || e.disabled || e.readOnly) return false;
      e.focus(); e.select(); return true;
    })()`);
    if (prepared !== true) throw new Error('Field was not found, is protected or cannot be edited');
    await commandOnPage(cdpUrl, 'Input.insertText', { text: args.text });
    return 'Text entered. Use browser_inspect to verify before submitting.';
  }
  throw new Error('Unsupported browser action');
}
