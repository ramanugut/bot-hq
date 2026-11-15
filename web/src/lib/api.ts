import type { Bot, ChatInfo, ComputerState, LiveState, Routine, Row, Toolkit, User } from '@shared/types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface AppsResponse { apps: Toolkit[]; connected: string[]; categories: string[]; total: number }

export interface RoomMember { id: string; name: string; label: string; avatarShape: string; avatarColor: string }

export const api = {
  me: () => req<{ user: User | null; devLogin: boolean; googleLogin?: boolean; features?: { voice: boolean; apps: boolean } }>('GET', '/auth/me'),
  upload: async (botId: string, file: File) => {
    const fd = new FormData(); fd.append('file', file);
    const res = await fetch(`/api/bots/${botId}/upload`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error ?? m; } catch { /* */ } throw new ApiError(res.status, m); }
    return res.json() as Promise<{ ok: true; path: string; name: string; size: number }>;
  },
  passwordLogin: (email: string, password: string) => req<{ ok: true }>('POST', '/auth/password', { email, password }),
  devLogin: (email: string, name?: string) => req<{ ok: true }>('POST', '/auth/dev', { email, name }),
  setTimezone: (tz: string) => req<{ ok: true }>('POST', '/me/timezone', { tz }),
  pushKey: () => req<{ key: string }>('GET', '/push/key'),
  pushSubscribe: (sub: unknown) => req<{ ok: true }>('POST', '/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => req<{ ok: true }>('POST', '/push/unsubscribe', { endpoint }),
  pushTest: () => req<{ ok: true }>('POST', '/push/test'),
  usage: () => req<{ usage: { plan?: string; windows: { label: string; usedPercent: number; resetsAt: number | null }[]; checkedAt: number } | null }>('GET', '/usage'),
  presence: () => req<{ ok: true }>('POST', '/presence'),
  logout: () => req<{ ok: true }>('POST', '/auth/logout'),

  bots: () => req<{ bots: Bot[]; live: LiveState[] }>('GET', '/bots'),
  createBot: (b: Pick<Bot, 'name' | 'avatarShape' | 'avatarColor' | 'mode'>) => req<{ bot: Bot }>('POST', '/bots', b),
  markRead: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/read`),
  rows: (id: string) => req<{ generation: number; rows: Row[] }>('GET', `/bots/${id}/rows`),
  send: (id: string, text: string) => req<{ row: Row }>('POST', `/bots/${id}/messages`, { text }),
  interrupt: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/interrupt`),
  fresh: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/fresh`),
  chats: (id: string) => req<{ chats: ChatInfo[] }>('GET', `/bots/${id}/chats`),
  chatAction: (id: string, gen: number, action: 'open' | 'rename' | 'archive' | 'unarchive' | 'delete' | 'merge', body?: { title?: string; into?: number }) =>
    req<{ ok: true; chats: ChatInfo[] }>('POST', `/bots/${id}/chats/${gen}/${action}`, body ?? {}),
  heartbeatNow: (id: string) => req<{ ok: true }>('POST', `/bots/${id}/heartbeat`),
  screenPower: (id: string, action: 'sleep' | 'wake') => req<{ computer: ComputerState }>('POST', `/bots/${id}/screen/${action}`),

  approve: (approvalId: string, decision: 'allow' | 'always' | 'deny') => req<{ ok: true }>('POST', `/approvals/${approvalId}`, { decision }),
  answer: (id: string, seq: number, answer: string) => req<{ ok: true }>('POST', `/bots/${id}/cards/${seq}/answer`, { answer }),
  dismiss: (id: string, seq: number) => req<{ ok: true }>('POST', `/bots/${id}/cards/${seq}/dismiss`),

  routines: (id: string) => req<{ routines: Routine[] }>('GET', `/bots/${id}/routines`),
  setRoutine: (rid: string, enabled: boolean) => req<{ routine: Routine }>('PATCH', `/routines/${rid}`, { enabled }),

  computer: () => req<{ computer: ComputerState }>('GET', '/computer'),
  ensureComputer: () => req<{ computer: ComputerState }>('POST', '/computer/ensure'),

  apps: (search = '', category = '') => req<AppsResponse>('GET', `/apps?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}`),
  connect: (slug: string, botId?: string, seq?: number) => req<{ redirectUrl: string }>('POST', `/apps/${slug}/connect`, { botId, seq }),
  disconnect: (slug: string) => req<{ ok: true }>('DELETE', `/apps/${slug}`),

  roomMembers: (id: string) => req<{ members: RoomMember[] }>('GET', `/rooms/${id}/members`),
  setRoomMembers: (id: string, botIds: string[]) => req<{ ok: true; members: string[] }>('PUT', `/rooms/${id}/members`, { botIds }),
  createRoom: (name: string, botIds: string[]) => req<{ id: string }>('POST', '/rooms', { name, botIds }),
};

/** Open a Composio redirect in a centered popup. */
export function openPopup(url: string) {
  const w = 520, h = 680;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  return window.open(url, 'grokbot-connect', `width=${w},height=${h},left=${left},top=${top}`);
}
