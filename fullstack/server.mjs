/**
 * Tier 2: interactive browser harness for @omnidim-ai/client.
 *
 * One local server that:
 *  - serves the harness page + the package's built UMD (dist/index.global.js);
 *  - runs a MOCK WebSocket at /mock/chat that speaks the documented wire
 *    protocol (echoes your mic back as `media` so you hear yourself, sends
 *    transcript events, and lets you trigger barge-in / hangup from stdin) so
 *    you can exercise the real AudioWorklet + mic path with NO backend;
 *  - creates a REAL session SERVER-SIDE (POST /local/create-session) using the
 *    API key from the OMNIDIM_API_KEY env var, so the key never touches the
 *    browser (mirrors the real architecture).
 *
 * Run:
 *   npm run serve
 *   # optional, for the "Start (real)" button:
 *   OMNIDIM_API_KEY=... OMNIDIM_API_BASE=http://localhost:8069 OMNIDIM_AGENT_ID=123 npm run serve
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const PKG_DIST = dirname(require.resolve('@omnidim-ai/client'));
const UMD = readFileSync(join(PKG_DIST, 'index.global.js'), 'utf8');
const PAGE = readFileSync(join(dirname(new URL(import.meta.url).pathname), 'index.html'), 'utf8');

const PORT = Number(process.env.PORT || 8080);
const API_BASE = (process.env.OMNIDIM_API_BASE || 'http://localhost:8069').replace(/\/+$/, '');
const API_KEY = process.env.OMNIDIM_API_KEY || '';
const AGENT_ID = process.env.OMNIDIM_AGENT_ID || '';

const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.url === '/omnidimension-client.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    return res.end(UMD);
  }
  if (req.method === 'POST' && req.url === '/local/create-session') {
    // Server-side create: the browser posts the credentials here (or they come
    // from env vars); the key is used only for this call to your backend and is
    // never handed to the SDK / WebSocket. Credentials from the request body
    // win over env vars, so you can paste them in the UI.
    let bodyIn = {};
    try {
      const raw = await readBody(req);
      bodyIn = raw ? JSON.parse(raw) : {};
    } catch { bodyIn = {}; }
    const apiKey = (bodyIn.apiKey || API_KEY || '').trim();
    const agentId = String(bodyIn.agentId || AGENT_ID || '').trim();
    const apiBase = (bodyIn.apiBase || API_BASE || '').replace(/\/+$/, '');
    if (!apiKey || !agentId) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'not_configured',
        error_description: 'Enter an API key and agent id in the UI (or set OMNIDIM_API_KEY + OMNIDIM_AGENT_ID before starting the server).',
      }));
    }
    try {
      const upstream = await fetch(`${apiBase}/api/v1/sessions/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ agent_id: Number(agentId), type: 'voice' }),
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, { 'content-type': 'application/json' });
      return res.end(text);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'upstream_unreachable', error_description: String(e) }));
    }
  }
  res.writeHead(404).end('not found');
});

// --- mock WS: speaks the documented wire protocol -----------------------
const wss = new WebSocketServer({ server, path: '/mock/chat' });
let live = null;
let heardChunks = 0;

wss.on('connection', (ws) => {
  live = ws;
  heardChunks = 0;
  console.log('[mock] client connected');
  // Agent greeting (cumulative snapshot, final).
  send(ws, { event: 'system', media: { payload: 'Hi' } });
  send(ws, { event: 'last_system_message', media: { payload: 'Hi, this is the mock agent. Say something and you will hear it echoed back.' } });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'audio' && typeof msg.data === 'string') {
      // Echo the mic straight back as playback audio: proves capture ->
      // encode -> send -> receive -> decode -> playback end to end.
      send(ws, { event: 'media', media: { payload: msg.data } });
      heardChunks += 1;
      if (heardChunks % 8 === 0) {
        // ~every ~1s of audio, surface a fake transcript.
        send(ws, { event: 'partial_text', media: { payload: `heard ${heardChunks} chunks...` } });
        send(ws, { event: 'user', media: { payload: `heard ${heardChunks} chunks` } });
      }
    }
  });
  ws.on('close', () => { console.log('[mock] client disconnected'); if (live === ws) live = null; });
});

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// stdin controls for the mock conversation.
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (buf) => {
    const k = buf.toString();
    if (k === 'c') { send(live, { event: 'clear' }); console.log('[mock] -> clear (barge-in)'); }
    else if (k === 'e') { send(live, { event: 'end_call', media: { payload: { reason: 'hangup' } } }); console.log('[mock] -> end_call(hangup)'); }
    else if (k === 'b') { send(live, { event: 'end_call', media: { payload: { reason: 'user_limit_reached' } } }); console.log('[mock] -> end_call(user_limit_reached)'); }
    else if (k === 'q' || k === '') { console.log('\n[mock] bye'); process.exit(0); }
  });
}

server.listen(PORT, () => {
  console.log(`\n  testbed on  http://localhost:${PORT}`);
  console.log(`  mock WS at  ws://localhost:${PORT}/mock/chat`);
  console.log(`  real mode:  ${API_KEY && AGENT_ID ? `configured (base ${API_BASE}, agent ${AGENT_ID})` : 'not configured (set OMNIDIM_API_KEY + OMNIDIM_AGENT_ID)'}`);
  console.log(`\n  while a mock call is live, in THIS terminal press:`);
  console.log(`    c = barge-in (clear)   e = hangup   b = insufficient_balance   q = quit\n`);
});
