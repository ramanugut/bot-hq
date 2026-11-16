import { ApiError } from './api';

export type SpaceKind = 'company' | 'customer' | 'personal' | 'custom';
export interface KnowledgeSpace { id: string; name: string; kind: SpaceKind; description: string; entries: number }
export interface KnowledgeEntrySummary {
  id: string; spaceId: string; title: string; kind: 'text' | 'image' | 'document';
  fileName: string | null; size: number | null; updatedAt: number; updatedBy: string; snippet?: string;
}
export interface KnowledgeEntry extends KnowledgeEntrySummary {
  body: string; createdAt: number;
  links: { title: string; id: string | null }[];
  revisions: { id: number; title: string; at: number; by: string }[];
}

/** A save the server refused because the text looks like it holds a password or key; resend with confirmed. */
export class SecretWarning extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/knowledge${path}`, {
    method, credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parse<T>(res);
}

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  let msg = res.statusText;
  let secret = false;
  try { const j = await res.json(); msg = j.error ?? msg; secret = !!j.secret; } catch { /* not json */ }
  if (res.status === 409 && secret) throw new SecretWarning(msg);
  throw new ApiError(res.status, msg);
}

export const knowledgeApi = {
  spaces: () => call<{ spaces: KnowledgeSpace[] }>('GET', '/spaces').then((r) => r.spaces),
  entries: (spaceId: string | null, q = '') =>
    call<{ entries: KnowledgeEntrySummary[] }>('GET', `/entries?${new URLSearchParams({ ...(spaceId ? { space: spaceId } : {}), ...(q ? { q } : {}) })}`).then((r) => r.entries),
  entry: (id: string) => call<{ entry: KnowledgeEntry }>('GET', `/entries/${id}`).then((r) => r.entry),
  revision: (id: string, rev: number) => call<{ revision: { title: string; body: string } }>('GET', `/entries/${id}/revisions/${rev}`).then((r) => r.revision),
  create: (p: { spaceId: string; title: string; body: string; confirmed?: boolean }) => call<{ entry: KnowledgeEntry }>('POST', '/entries', p).then((r) => r.entry),
  update: (id: string, p: { title?: string; body?: string; spaceId?: string; confirmed?: boolean }) => call<{ entry: KnowledgeEntry }>('PATCH', `/entries/${id}`, p).then((r) => r.entry),
  restore: (id: string, revisionId: number) => call<{ entry: KnowledgeEntry }>('POST', `/entries/${id}/restore`, { revisionId }).then((r) => r.entry),
  remove: (id: string) => call<{ ok: true }>('DELETE', `/entries/${id}`),
  upload: async (spaceId: string, file: File, confirmed = false) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('spaceId', spaceId);
    if (confirmed) fd.append('confirmed', '1');
    const res = await fetch('/api/knowledge/upload', { method: 'POST', credentials: 'include', body: fd });
    return parse<{ entry: KnowledgeEntry; extracted: boolean | null }>(res);
  },
  fileUrl: (id: string, download = false) => `/api/knowledge/entries/${id}/file${download ? '?download=1' : ''}`,
  botSpaces: (botId: string) => call<{ teammate: boolean; spaceIds: string[] }>('GET', `/bots/${botId}`),
  setBotSpaces: (botId: string, spaceIds: string[]) => call<{ spaceIds: string[] }>('PUT', `/bots/${botId}`, { spaceIds }),
};

export const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.svg,.pdf,.docx,.doc,.pptx,.xlsx,.xls,.odt,.rtf,.html,.htm,.csv,.json,.txt,.md';
