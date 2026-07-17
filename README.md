# OmniDimension Web SDK demo

Live demos for [`@omnidim-ai/client`](https://www.npmjs.com/package/@omnidim-ai/client),
the browser SDK for OmniDimension web call Sessions (microphone capture, audio
playback, barge-in, transcripts).

## Live playground

**https://omnidim.github.io/Web-SDK-Demo/**

Paste a `ws_url` from your server (`POST /api/v1/sessions/create`) and talk to
your agent. The page loads the SDK from the CDN, so there is no build step.

## What's here

- `index.html` - the hosted playground (single file, loads the SDK from unpkg).
- `vanilla.html` - a minimal ~30-line page.
- `fullstack/` - the recommended architecture: your server creates the session
  with your API key and hands the browser only the `ws_url`. Includes a mock
  WebSocket server so you can test the whole audio path with no backend.

## Run the full-stack example

```bash
cd fullstack
npm install
npm run serve      # http://localhost:8080
```

- **Start (mock)** needs no backend: it echoes your mic back and streams fake
  transcripts.
- **Start (real)** creates a session against your backend (key stays on the
  local server, never in the browser) and connects to the returned `ws_url`.

## The two-step integration

1. Server-side, with your API key:

   ```bash
   curl -X POST https://omnidim.io/api/v1/sessions/create \
     -H "Authorization: Bearer $OMNIDIM_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"agent_id": 123, "type": "voice"}'
   # -> { "session_id": ..., "token": "sess_...", "expires_at": ..., "ws_url": "wss://..." }
   ```

2. In the browser, hand the SDK only the `ws_url`:

   ```js
   import { WebSession } from '@omnidim-ai/client';
   const session = new WebSession();
   session.on('transcript', (t) => console.log(t.role, t.text));
   await session.start({ wsUrl });
   ```

Docs: https://docs.omnidim.io/docs/sdks/web
