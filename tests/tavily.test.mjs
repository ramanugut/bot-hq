import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TAVILY_API_KEY = 'tvly-mock-test-key-only';
const { publicWebUrl, tavilyApi, runTavily } = await import('../server/dist/tavily.js');

test('Tavily only accepts public web hostnames', () => {
  for (const bad of [
    'http://localhost:8787', 'http://127.0.0.1', 'http://169.254.169.254',
    'http://service.internal', 'http://192.168.1.5', 'https://anything.sslip.io',
    'file:///etc/passwd', 'ftp://example.com', 'https://user:password@example.com',
  ]) assert.throws(() => publicWebUrl(bad));
  assert.equal(publicWebUrl('https://docs.tavily.com/#overview'), 'https://docs.tavily.com/');
});

test('Tavily search uses server-side bearer auth and bounded inputs', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let call;
  globalThis.fetch = async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify({
      results: [{ title: 'Example', url: 'https://example.com', content: 'Found it' }],
      usage: { credits: 1 },
    }), { status: 200 });
  };
  const result = await runTavily('search', { query: 'latest news', count: 500 });
  assert.equal(call.url, 'https://api.tavily.com/search');
  assert.equal(call.options.headers.authorization, 'Bearer tvly-mock-test-key-only');
  const request = JSON.parse(call.options.body);
  assert.equal(request.max_results, 10);
  assert.equal(request.search_depth, 'basic');
  assert.match(result.output, /https:\/\/example\.com/);
  assert.doesNotMatch(result.output, /tvly-mock/);
});

test('Tavily extract blocks local URLs before sending any request', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new Error('should never be called'); };
  await assert.rejects(runTavily('extract', { urls: ['http://localhost/admin'] }), /public/);
});

test('Tavily API does not expose upstream error bodies or keys', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('tvly-secret-should-not-leak', { status: 401 });
  await assert.rejects(tavilyApi('search', { query: 'test' }), (err) => {
    assert.match(err.message, /rejected/);
    assert.doesNotMatch(err.message, /tvly-secret/);
    return true;
  });
});

test('Tavily research starts a mini job and retrieves completed report by ID', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const id = '123e4567-e89b-12d3-a456-426614174111';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(calls.length === 1
      ? { request_id: id, status: 'pending' }
      : { request_id: id, status: 'completed', content: 'Research findings',
          sources: [{ title: 'Source', url: 'https://example.com/report' }], usage: { credits: 16 } }),
    { status: calls.length === 1 ? 201 : 200 });
  };
  const started = await runTavily('research', { question: 'Review a product' });
  assert.match(started.output, new RegExp(id));
  assert.equal(JSON.parse(calls[0].options.body).model, 'mini');
  const result = await runTavily('research_status', { request_id: id });
  assert.match(calls[1].url, /\/research\/123e4567/);
  assert.equal(calls[1].options.method, 'GET');
  assert.match(result.output, /Research findings/);
  assert.match(result.output, /https:\/\/example\.com\/report/);
});
