import test from 'node:test';
import assert from 'node:assert/strict';
import { describePreview, summarizeCheck } from '../server/dist/lib/video-preview.js';

// Shape of `hyperframes check --json` (0.9.58), trimmed to the fields the preview reads.
const check = {
  ok: false,
  lint: { ok: true, errorCount: 0, warningCount: 0, findings: [] },
  layout: {
    ok: false, errorCount: 1, warningCount: 0,
    findings: [{ code: 'text_occluded', severity: 'error', time: 3.3333, selector: 'div.panel-header', message: 'Text is hidden beneath an opaque element.' }],
  },
  contrast: {
    ok: false, errorCount: 1, warningCount: 0,
    findings: [{ code: 'contrast_aa_failure', severity: 'error', message: 'Contrast is 3.21:1; WCAG AA requires 4.5:1.', selector: 'div > span' }],
  },
  craft: {
    ok: true, errorCount: 0, warningCount: 1,
    findings: [{ code: 'film_silent', severity: 'warning', message: 'This 20 s film has no sound source.' }],
  },
  audio: { ok: true, errorCount: 0, warningCount: 0, findings: [{ code: 'audio_none', severity: 'info', message: 'No sound.' }] },
};

test('check results are counted, errors listed first, info left out', () => {
  const s = summarizeCheck(check);
  assert.equal(s.errors, 2);
  assert.equal(s.warnings, 1);
  assert.deepEqual(s.issues.map((i) => i.code), ['text_occluded', 'contrast_aa_failure', 'film_silent']);
  assert.equal(s.issues[0].time, 3.33);
  assert.equal(s.issues[0].where, 'div.panel-header');
});

test('a missing or odd check result does not throw', () => {
  assert.deepEqual(summarizeCheck(null), { errors: 0, warnings: 0, issues: [] });
  assert.deepEqual(summarizeCheck({ layout: { findings: 'nope' } }), { errors: 0, warnings: 0, issues: [] });
});

test('the bot is told to fix errors before rendering, and to ask once it is clean', () => {
  const withErrors = describePreview({ sheets: ['/lib/v/.preview/review-beats.jpg'], ...summarizeCheck(check) }, '/lib/v');
  assert.match(withErrors, /Check: 2 errors, 1 warning\./);
  assert.match(withErrors, /\[error\] layout\/text_occluded at 3\.33s \(div\.panel-header\)/);
  assert.match(withErrors, /review-beats\.jpg/);
  assert.match(withErrors, /Do not render yet/);
  const clean = describePreview({ sheets: [], errors: 0, warnings: 0, issues: [], failure: 'no review sheets were made: boom' }, '/lib/v');
  assert.match(clean, /Preview problem: no review sheets were made/);
  assert.match(clean, /ask before rendering \/lib\/v/);
});
