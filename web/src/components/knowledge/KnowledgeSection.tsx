import { useEffect, useState } from 'react';
import type { Bot } from '@shared/types';
import { knowledgeApi, type KnowledgeSpace } from '../../lib/knowledgeApi';
import { useConfigUI } from '../../configStore';
import { Switch } from '../config/ui';

/** Bot settings: which knowledge spaces this bot may read. Only Teammate bots use knowledge at all. */
export function KnowledgeSection({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [spaces, setSpaces] = useState<KnowledgeSpace[] | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const teammate = bot.mode === 'teammate';

  useEffect(() => {
    let alive = true;
    Promise.all([knowledgeApi.spaces(), knowledgeApi.botSpaces(bot.id)])
      .then(([s, b]) => { if (alive) { setSpaces(s); setIds(b.spaceIds); } })
      .catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [bot.id]);

  const toggle = async (id: string, on: boolean) => {
    const next = on ? [...ids, id] : ids.filter((x) => x !== id);
    setIds(next);
    try { setIds((await knowledgeApi.setBotSpaces(bot.id, next)).spaceIds); } catch (e) { setError((e as Error).message); }
  };

  return (
    <section className="cfg-section">
      <div className="cfg-section__label">Knowledge</div>
      <div className="cfg-card">
        <div className="cfg-row">
          <div className="cfg-row__text">
            <div className="cfg-row__sub">
              {teammate
                ? `Spaces ${bot.name} searches before answering about your business. Only Customer-safe should be on for a bot that talks to customers.`
                : `Only Teammate bots use company knowledge. Set “Used as” to Teammate above and save to turn these on.`}
            </div>
          </div>
          <button type="button" className="cfg-btn cfg-btn--secondary" onClick={() => { onClose(); useConfigUI.getState().setView('knowledge'); }}>Open Knowledge</button>
        </div>
        {spaces?.map((s) => (
          <div key={s.id} className={`cfg-row${teammate ? '' : ' is-disabled'}`}>
            <div className="cfg-row__text">
              <div className="cfg-row__title">{s.name} <span className="cfg-row__count">{s.entries} {s.entries === 1 ? 'entry' : 'entries'}</span></div>
              <div className="cfg-row__sub">{s.description}</div>
            </div>
            <Switch on={teammate && ids.includes(s.id)} disabled={!teammate} label={`${bot.name} can read ${s.name}`} onChange={(v) => void toggle(s.id, v)} />
          </div>
        ))}
        {error && <div className="cfg-row"><div className="cfg-row__sub is-error">{error}</div></div>}
      </div>
    </section>
  );
}
