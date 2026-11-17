import { memo, type ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** Tone from an explicit word, or guessed from the text ("At risk" → warn). */
function toneOf(explicit: string | undefined, text: string): Tone {
  const t = (explicit ?? '').trim().toLowerCase();
  if (t === 'good' || t === 'ok' || t === 'green') return 'good';
  if (t === 'warn' || t === 'warning' || t === 'amber' || t === 'orange') return 'warn';
  if (t === 'bad' || t === 'red' || t === 'danger' || t === 'critical') return 'bad';
  if (t === 'neutral') return 'neutral';
  const s = text.toLowerCase();
  if (/\b(critical|down|failing|failed|urgent|outage)\b/.test(s)) return 'bad';
  if (/\b(at risk|risk|attention|warning|degraded|slow|overdue)\b/.test(s)) return 'warn';
  if (/\b(healthy|all clear|good|ok|working|on track|up)\b/.test(s)) return 'good';
  return 'neutral';
}

const cells = (line: string) => line.split('|').map((c) => c.trim());

/**
 * ```stats
 * Monthly recurring revenue | R1,030.22 | Expected recurring income
 * Outstanding invoices | R29,577.75 | 380 unpaid invoices | bad
 * ```
 * One card per line: label | value | note (optional) | tone (optional: good, warn, bad).
 */
function StatCards({ text }: { text: string }) {
  const rows = text.split('\n').map((l) => l.trim()).filter(Boolean).map(cells).filter((r) => r.length >= 2);
  if (!rows.length) return null;
  return (
    // Even rows: 4 cards as 2 × 2, 2 side by side, otherwise up to 3 a row.
    <div className="md-stats" data-cols={rows.length === 4 || rows.length === 2 ? 2 : Math.min(rows.length, 3)}>
      {rows.map(([label, value, note, tone], i) => (
        <div key={i} className={`md-stat md-stat--${tone ? toneOf(tone, '') : 'neutral'}`}>
          <div className="md-stat__label">{label}</div>
          <div className="md-stat__value">{value}</div>
          {note ? <div className="md-stat__note">{note}</div> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * ```verdict
 * At risk | 17 Nov 2026 · live WHMCS data
 * ```
 * A coloured status pill and a short note beside it. An optional third cell sets the tone.
 */
function Verdict({ text }: { text: string }) {
  const [label, note, tone] = cells(text.trim().split('\n')[0] ?? '');
  if (!label) return null;
  return (
    <div className="md-verdict">
      <span className={`md-verdict__pill md-verdict__pill--${toneOf(tone, label)}`}>{label}</span>
      {note ? <span className="md-verdict__note">{note}</span> : null}
    </div>
  );
}

const blocks: Record<string, (p: { text: string }) => ReactElement | null> = { stats: StatCards, verdict: Verdict };

/** The language and text of a fenced block, when `pre` holds exactly one `code` element. */
function fenced(node: any): { lang: string; text: string } | null {
  const code = node?.children?.find((c: any) => c.type === 'element');
  if (!code || code.tagName !== 'code') return null;
  const cls: string[] = ([] as string[]).concat(code.properties?.className ?? []);
  const lang = cls.map(String).find((c) => c.startsWith('language-'))?.slice(9) ?? '';
  const text = (code.children ?? []).map((c: any) => (typeof c.value === 'string' ? c.value : '')).join('');
  return { lang, text };
}

const components: Components = {
  a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  table: ({ node: _n, ...props }) => (
    <div className="md-table"><table {...props} /></div>
  ),
  pre: ({ node, ...props }) => {
    const f = fenced(node);
    const Block = f ? blocks[f.lang] : undefined;
    if (f && Block) return <Block text={f.text} />;
    return <pre {...props} />;
  },
};

/** Assistant message markdown: paragraphs, lists, blockquotes, inline code, code blocks (screen 02), tables,
 *  plus two report blocks the bots are told about: ```stats (summary cards) and ```verdict (status pill). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
});
