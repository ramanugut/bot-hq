import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** How much of the ChatGPT subscription is used. Hidden when it can't be read. */
export function UsageMeter() {
  const [u, setU] = useState<Awaited<ReturnType<typeof api.usage>>['usage']>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.usage().then((r) => { if (alive) setU(r.usage); }).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!u?.windows.length) return null;
  return (
    <div className="usage-meter" title="Shared with your other ChatGPT and Codex use">
      <div className="usage-meter__head">ChatGPT allowance{u.plan ? ` · ${u.plan}` : ''}</div>
      {u.windows.map((w) => {
        const left = Math.round(100 - w.usedPercent);
        return (
          <div key={w.label} className="usage-meter__row">
            <span className="usage-meter__label">{w.label}</span>
            <span className="usage-meter__bar"><i style={{ width: `${w.usedPercent}%`, background: w.usedPercent > 85 ? 'var(--color-danger, #E5484D)' : w.usedPercent > 60 ? 'var(--color-warn, #F5A524)' : 'var(--bot-action, #30A46C)' }} /></span>
            <span className="usage-meter__val">{left}% left{w.resetsAt ? ` · resets ${until(w.resetsAt)}` : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function until(t: number): string {
  const m = Math.max(0, Math.round((t - Date.now()) / 60_000));
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${m % 60}m`;
  return `in ${Math.round(h / 24)}d`;
}
