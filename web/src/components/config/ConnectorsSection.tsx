import { useCallback, useEffect, useState } from 'react';
import type { ConnectorApply, ConnectorTool, ConnectorView } from '@shared/types';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { configApi, type ConnectorAuth, type ConnectorsListing } from '../../lib/configApi';
import { relativeShort } from '../../lib/time';
import { useStore } from '../../store';
import { ConfirmButton, Field, Segmented, Switch } from './ui';

/**
 * Settings → Connectors: outside MCP servers (a URL, optionally a key), each for all Bots or chosen ones.
 * The server tests the connection, keeps secrets to itself and restarts the Bots a change affects.
 */
export function ConnectorsSection() {
  const [data, setData] = useState<ConnectorsListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ConnectorView | 'new' | null>(null);
  const [applied, setApplied] = useState<ConnectorApply[] | null>(null);
  const load = useCallback(() => {
    configApi.connectors().then((d) => { setData(d); setLoadError(null); }).catch((e) => setLoadError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const done = (result: ConnectorApply[] | null) => { setEditing(null); setApplied(result); load(); };
  const canEdit = !!data?.canEdit;

  return (
    <>
      <div className="app-settings__head">
        <h1>Connectors</h1>
        <p>Give your Bots tools from other services through MCP, the same kind of connector you add in Claude or ChatGPT. Choose which Bots get each one.</p>
      </div>

      {applied && applied.length > 0 && <AppliedNote applied={applied} onClose={() => setApplied(null)} />}
      {loadError && <div className="cfg-error">{loadError}</div>}
      {data && !canEdit && <div className="cfg-field__hint">Only the owner of this Botly can add or change connectors.</div>}

      {editing === 'new' && data && <ConnectorEditor bots={data.bots} onCancel={() => setEditing(null)} onSaved={done} />}

      <section className="cfg-section">
        <div className="conn-head">
          <div className="cfg-section__label">{data ? `${data.connectors.length} connector${data.connectors.length === 1 ? '' : 's'}` : 'Connectors'}</div>
          {canEdit && editing !== 'new' && <button type="button" className="cfg-btn cfg-btn--primary" onClick={() => { setApplied(null); setEditing('new'); }}>Add connector</button>}
        </div>
        {!data && !loadError ? <div className="cfg-card"><div className="cfg-empty cfg-empty--flat">Loading…</div></div>
          : data && data.connectors.length === 0 && editing !== 'new' ? (
            <div className="cfg-empty">No connectors yet. Add one with its MCP address (and a key, if it needs one), then choose which Bots can use it.</div>
          ) : (
            <div className="conn-list">
              {data?.connectors.map((c) => editing && editing !== 'new' && editing.id === c.id
                ? <ConnectorEditor key={c.id} bots={data.bots} current={c} onCancel={() => setEditing(null)} onSaved={done} />
                : <ConnectorCard key={c.id} c={c} bots={data.bots} canEdit={canEdit} onEdit={() => { setApplied(null); setEditing(c); }} onChanged={done} />)}
            </div>
          )}
        <div className="cfg-field__hint">
          Works with MCP servers you reach by URL: open ones, ones with a secret in the URL, and ones that take an API key or token.
          Connectors that sign in through a pop-up (like Gmail or Notion in Claude) aren’t supported yet. Bots ask you before using a connector to change anything.
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function initials(label: string) {
  return label.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
}

function whoGetsIt(c: ConnectorView, bots: ConnectorsListing['bots']): string {
  if (c.scope === 'all') return 'All Bots';
  const names = c.botIds.map((id) => bots.find((b) => b.id === id)?.name).filter(Boolean) as string[];
  return names.length ? names.join(', ') : 'No Bots';
}

function StatusChip({ c }: { c: ConnectorView }) {
  if (!c.enabled) return <span className="cfg-chip cfg-chip--muted">Off</span>;
  if (!c.status) return <span className="cfg-chip cfg-chip--muted">Not checked</span>;
  return c.status.ok ? <span className="conn-chip conn-chip--ok">Connected</span> : <span className="conn-chip conn-chip--bad">Can’t connect</span>;
}

function ConnectorCard({ c, bots, canEdit, onEdit, onChanged }: { c: ConnectorView; bots: ConnectorsListing['bots']; canEdit: boolean; onEdit: () => void; onChanged: (a: ConnectorApply[] | null) => void }) {
  const [showTools, setShowTools] = useState(false);
  const [busy, setBusy] = useState<'test' | 'toggle' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (kind: 'test' | 'toggle', fn: () => Promise<ConnectorApply[] | null>) => {
    setBusy(kind); setError(null);
    try { onChanged(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const checked = c.status ? `checked ${relativeShort(c.status.at) === 'now' ? 'just now' : `${relativeShort(c.status.at)} ago`}` : '';
  return (
    <div className={`conn-card${c.enabled ? '' : ' is-off'}`}>
      <div className="conn-card__top">
        <span className="conn-tile" aria-hidden>{initials(c.label)}</span>
        <div className="cfg-row__text">
          <div className="conn-card__title">{c.label} <StatusChip c={c} /></div>
          <div className="cfg-row__sub">
            {c.status?.ok ? `${c.status.toolCount} tool${c.status.toolCount === 1 ? '' : 's'} · ` : ''}{whoGetsIt(c, bots)}
            {c.auth !== 'none' ? ` · key ${c.secretHint ?? ''}` : ''}
          </div>
          <div className="conn-card__url"><code className="cfg-code">{c.url}</code></div>
        </div>
        {canEdit && <Switch on={c.enabled} label={c.enabled ? `Turn ${c.label} off` : `Turn ${c.label} on`} disabled={!!busy} onChange={(on) => run('toggle', async () => (await configApi.updateConnector(c.id, { enabled: on })).applied)} />}
      </div>
      {c.enabled && c.status && !c.status.ok && <div className="cfg-error">{c.status.error}</div>}
      {error && <div className="cfg-error">{error}</div>}
      <div className="conn-card__actions">
        {c.status?.ok && c.tools.length > 0 && (
          <button type="button" className="cfg-btn cfg-btn--secondary" aria-expanded={showTools} onClick={() => setShowTools((v) => !v)}>{showTools ? 'Hide tools' : 'Show tools'}</button>
        )}
        {canEdit && <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy} onClick={() => run('test', async () => { await configApi.testConnector(c.id); return null; })}>{busy === 'test' ? 'Checking…' : 'Check connection'}</button>}
        {canEdit && <button type="button" className="cfg-btn cfg-btn--secondary" onClick={onEdit}>Edit</button>}
        <span className="conn-card__spacer" />
        {checked && <span className="conn-card__when">{checked}</span>}
        {canEdit && <ConfirmButton confirmLabel="Remove" onConfirm={async () => { try { onChanged((await configApi.deleteConnector(c.id)).applied); } catch (e) { setError((e as Error).message); } }}>Remove</ConfirmButton>}
      </div>
      {showTools && <ToolList tools={c.tools} />}
    </div>
  );
}

function ToolList({ tools }: { tools: ConnectorTool[] }) {
  return (
    <ul className="conn-tools">
      {tools.map((t) => (
        <li key={t.name}><code>{t.name}</code>{t.description ? <span> · {t.description}</span> : null}</li>
      ))}
    </ul>
  );
}

function AppliedNote({ applied, onClose }: { applied: ConnectorApply[]; onClose: () => void }) {
  const text = (a: ConnectorApply) =>
    a.result === 'restarted' ? `${a.name} restarted with the change.`
      : a.result === 'waiting' ? `${a.name} is busy and picks it up when it finishes.`
        : a.result === 'manual' ? a.message ?? `Restart ${a.name} to load it.`
          : `${a.name}: ${a.message ?? 'could not be restarted.'}`;
  const bad = applied.some((a) => a.result === 'error');
  return (
    <div className={`conn-note${bad ? ' is-bad' : ''}`} role="status">
      <div>{applied.map((a) => <div key={a.botId}>{text(a)}</div>)}<div className="conn-note__sub">Start a new chat for a Bot to see its new tools.</div></div>
      <button type="button" className="cfg-btn cfg-btn--secondary" onClick={onClose}>OK</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

type AuthKind = ConnectorAuth['type'];

function ConnectorEditor({ bots, current, onCancel, onSaved }: { bots: ConnectorsListing['bots']; current?: ConnectorView; onCancel: () => void; onSaved: (a: ConnectorApply[]) => void }) {
  const storeBots = useStore((s) => s.bots);
  const [label, setLabel] = useState(current?.label ?? '');
  const [url, setUrl] = useState('');
  const [authKind, setAuthKind] = useState<AuthKind>(current?.auth ?? 'none');
  const [header, setHeader] = useState(current?.authHeader ?? 'X-API-Key');
  const [secret, setSecret] = useState('');
  const [scope, setScope] = useState<'all' | 'some'>(current?.scope ?? 'all');
  const [picked, setPicked] = useState<Set<string>>(new Set(current?.botIds ?? []));
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; error: string | null; tools: ConnectorTool[] } | null>(null);
  const [showTools, setShowTools] = useState(false);

  // A saved key is kept unless a new one is typed (it is never sent back to the browser).
  const keepsSecret = !!current && current.auth === authKind && (authKind !== 'header' || current.authHeader === header) && !!current.secretHint;
  const auth = (): ConnectorAuth => authKind === 'none' ? { type: 'none' }
    : authKind === 'bearer' ? { type: 'bearer', ...(secret.trim() ? { value: secret.trim() } : {}) }
      : { type: 'header', header: header.trim(), ...(secret.trim() ? { value: secret.trim() } : {}) };
  const form = () => ({ label: label.trim(), url: url.trim(), auth: auth(), scope, botIds: scope === 'some' ? [...picked] : [] });

  const runTest = async () => {
    setBusy('test'); setError(null); setTest(null);
    try { setTest(await configApi.tryConnector({ ...form(), id: current?.id })); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save'); setError(null);
    try {
      const r = current ? await configApi.updateConnector(current.id, form()) : await configApi.addConnector(form());
      onSaved(r.applied);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  };
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const canSave = label.trim() && (current || url.trim()) && (scope === 'all' || picked.size > 0) && (authKind === 'none' || secret.trim() || keepsSecret) && (authKind !== 'header' || header.trim());

  return (
    <section className="cfg-editor conn-editor" aria-label={current ? `Edit ${current.label}` : 'Add a connector'}>
      <div className="conn-editor__title">{current ? `Edit ${current.label}` : 'Add a connector'}</div>
      <div className="cfg-grid conn-editor__grid">
        <Field label="Name" htmlFor="conn-name">
          <input id="conn-name" className="text-input" placeholder="For example WHMCS" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} autoFocus={!current} />
        </Field>
        <Field label="MCP server URL" htmlFor="conn-url" hint={current ? <>Saved: <code className="cfg-code">{current.url}</code>. Leave empty to keep it.</> : 'The address the service gives you for MCP, starting with https://'}>
          <input id="conn-url" className="text-input" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder={current ? 'Keep the saved address' : 'https://example.com/mcp'} value={url} onChange={(e) => { setUrl(e.target.value); setTest(null); }} />
        </Field>
      </div>

      <Field label="Authentication" hint={authKind === 'none' ? 'For servers that need only the URL, including ones with a secret code in the URL.' : authKind === 'bearer' ? 'Sent as “Authorization: Bearer <key>”, which most servers expect.' : 'For servers that read the key from their own header, like X-API-Key.'}>
        <Segmented<AuthKind> label="Authentication" value={authKind} onChange={(v) => { setAuthKind(v); setTest(null); }} options={[{ value: 'none', label: 'None' }, { value: 'bearer', label: 'API key or token' }, { value: 'header', label: 'Custom header' }]} />
      </Field>
      {authKind !== 'none' && (
        <div className="cfg-grid conn-editor__grid">
          {authKind === 'header' && (
            <Field label="Header name" htmlFor="conn-header">
              <input id="conn-header" className="text-input" spellCheck={false} value={header} onChange={(e) => { setHeader(e.target.value); setTest(null); }} />
            </Field>
          )}
          <Field label={authKind === 'bearer' ? 'API key or token' : 'Key'} htmlFor="conn-secret" hint={keepsSecret ? `Saved key ${current?.secretHint}. Leave empty to keep it.` : undefined}>
            <input id="conn-secret" className="text-input" type="password" autoComplete="new-password" spellCheck={false} placeholder={keepsSecret ? 'Keep the saved key' : 'Paste it here'} value={secret} onChange={(e) => { setSecret(e.target.value); setTest(null); }} />
          </Field>
        </div>
      )}

      <Field label="Which Bots can use it">
        <Segmented<'all' | 'some'> label="Which Bots can use it" value={scope} onChange={setScope} options={[{ value: 'all', label: 'All Bots' }, { value: 'some', label: 'Choose Bots' }]} />
      </Field>
      {scope === 'all' ? <div className="cfg-field__hint">Every Bot gets it, including Bots you create later.</div> : (
        <div className="conn-bots" role="group" aria-label="Bots">
          {bots.map((b) => {
            const bot = storeBots.find((x) => x.id === b.id);
            return (
              <label key={b.id} className={`conn-bot${picked.has(b.id) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} />
                {bot ? <BotAvatarFor bot={bot} size={24} /> : <span className="conn-tile conn-tile--small" aria-hidden>{initials(b.name)}</span>}
                <span>{b.name}</span>
              </label>
            );
          })}
        </div>
      )}

      {test && (test.ok
        ? <div className="conn-test is-ok">Connected · {test.tools.length} tool{test.tools.length === 1 ? '' : 's'} {test.tools.length > 0 && <button type="button" className="link-btn link-btn--small" onClick={() => setShowTools((v) => !v)}>{showTools ? 'hide' : 'show'}</button>}</div>
        : <div className="cfg-error">{test.error}</div>)}
      {test?.ok && showTools && <ToolList tools={test.tools} />}
      {error && <div className="cfg-error">{error}</div>}

      <div className="conn-editor__foot">
        <button type="button" className="cfg-btn cfg-btn--secondary" disabled={!!busy || (!current && !url.trim())} onClick={runTest}>{busy === 'test' ? 'Checking…' : 'Test connection'}</button>
        <span className="conn-card__spacer" />
        <button type="button" className="cfg-btn cfg-btn--secondary" disabled={busy === 'save'} onClick={onCancel}>Cancel</button>
        <button type="button" className="cfg-btn cfg-btn--primary" disabled={!canSave || !!busy} onClick={save}>{busy === 'save' ? 'Saving and updating Bots…' : current ? 'Save' : 'Add connector'}</button>
      </div>
    </section>
  );
}
