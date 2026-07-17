/**
 * Tier 1: packaging + protocol smoke against the PUBLISHED artifact.
 *
 * Imports @omnidim-ai/client exactly as a customer would (from the packed
 * tarball installed into node_modules), then drives WebSession against a mock
 * WebSocket + fake audio engine. This proves the tarball's exports/types/files
 * are wired correctly — something the in-repo unit tests (which import ./src)
 * cannot catch.
 *
 * Run: npm run smoke
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// 1) ESM entry resolves and exports WebSession.
import { WebSession } from '@omnidim-ai/client';
assert.equal(typeof WebSession, 'function', 'ESM: WebSession should be a class');

// 2) CJS entry resolves too (require of the same package).
const require = createRequire(import.meta.url);
const cjs = require('@omnidim-ai/client');
assert.equal(typeof cjs.WebSession, 'function', 'CJS: WebSession should be a class');

// 3) UMD build ships and exposes the OmnidimensionClient global + WebSession.
// The exports map only allows the root subpath (correct for a browser SDK:
// CDNs like unpkg serve dist files by literal path via the "unpkg" field, not
// Node exports resolution), so locate the UMD relative to the resolved main.
const umdPath = join(dirname(require.resolve('@omnidim-ai/client')), 'index.global.js');
const umd = readFileSync(umdPath, 'utf8');
assert.ok(umd.includes('OmnidimensionClient'), 'UMD: global name present');
assert.ok(umd.includes('WebSession'), 'UMD: WebSession present in bundle');

// --- test doubles (no browser / no mic) --------------------------------
class MockWebSocket {
  constructor() {
    this.sent = [];
    this.closed = false;
    this.onopen = this.onclose = this.onerror = this.onmessage = null;
  }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  open() { this.onopen && this.onopen(); }
  receive(frame) { this.onmessage && this.onmessage({ data: JSON.stringify(frame) }); }
}

class FakeAudio {
  constructor() { this.enqueued = []; this.cleared = 0; this.muted = null; this.stopped = false; }
  async start(onChunk) { this.onChunk = onChunk; }
  enqueue(b64) { this.enqueued.push(b64); }
  clear() { this.cleared += 1; }
  setMuted(m) { this.muted = m; }
  stop() { this.stopped = true; }
}

function make() {
  const sockets = [];
  const audio = new FakeAudio();
  const statuses = [];
  const transcripts = [];
  const errors = [];
  const session = new WebSession({
    createWebSocket: () => { const ws = new MockWebSocket(); sockets.push(ws); return ws; },
    audioEngine: audio,
  });
  session.on('status', (s) => statuses.push(s));
  session.on('transcript', (t) => transcripts.push(t));
  session.on('error', (e) => errors.push(e));
  return { session, sockets, audio, statuses, transcripts, errors };
}

async function started() {
  const ctx = make();
  const p = ctx.session.start({ wsUrl: 'wss://x/chat?request_token=sess_t' });
  await Promise.resolve();
  ctx.sockets[0].open();
  await p;
  return ctx;
}

let checks = 0;
const ok = (label) => { checks += 1; console.log(`  ok  ${label}`); };

// connect -> active, and mic chunks go out as audio frames
{
  const { sockets, audio, statuses } = await started();
  assert.deepEqual(statuses, ['connecting', 'active']);
  audio.onChunk('QUJD');
  assert.deepEqual(JSON.parse(sockets[0].sent[0]), { type: 'audio', data: 'QUJD' });
  ok('connect -> active; mic chunk -> {type:"audio"}');
}

// media -> playback queue
{
  const { sockets, audio } = await started();
  sockets[0].receive({ event: 'media', media: { payload: 'UENN' } });
  assert.deepEqual(audio.enqueued, ['UENN']);
  ok('media event -> playback enqueue');
}

// clear -> flush (barge-in)
{
  const { sockets, audio } = await started();
  sockets[0].receive({ event: 'clear' });
  assert.equal(audio.cleared, 1);
  ok('clear event -> playback flush (barge-in)');
}

// end_call reason mapping
{
  const { sockets, statuses } = await started();
  sockets[0].receive({ event: 'end_call', media: { payload: { reason: 'user_limit_reached' } } });
  assert.deepEqual(statuses.at(-1), { state: 'ended', reason: 'insufficient_balance' });
  ok('end_call user_limit_reached -> ended(insufficient_balance)');
}

// transcripts: user + agent, partial + final
{
  const { sockets, transcripts } = await started();
  sockets[0].receive({ event: 'partial_text', media: { payload: 'hel' } });
  sockets[0].receive({ event: 'user', media: { payload: 'hello' } });
  sockets[0].receive({ event: 'last_system_message', media: { payload: 'Hi there!' } });
  assert.deepEqual(transcripts, [
    { role: 'user', text: 'hel', final: false },
    { role: 'user', text: 'hello', final: true },
    { role: 'agent', text: 'Hi there!', final: true },
  ]);
  ok('transcript events mapped for both roles');
}

// unknown events ignored
{
  const { sockets, errors, transcripts } = await started();
  sockets[0].receive({ event: 'mark' });
  sockets[0].receive({ event: 'brand_new_event' });
  assert.equal(errors.length, 0);
  assert.equal(transcripts.length, 0);
  ok('unknown wire events ignored');
}

// no API key anywhere on the instance
{
  const s = new WebSession();
  assert.ok(!JSON.stringify(Object.keys(s)).match(/api[_-]?key/i), 'no apiKey field');
  ok('no API-key field on the public surface');
}

console.log(`\nPACKAGING + PROTOCOL SMOKE PASSED (${checks} checks) against the packed tarball.`);
