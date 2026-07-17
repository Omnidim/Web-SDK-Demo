# Full-stack example: @omnidim-ai/client

A complete, runnable example of the correct architecture: your **server**
creates the session with your API key, and the **browser** connects to the
returned `ws_url` with `WebSession`. Also includes a mock WebSocket server so
you can exercise the whole audio path with **no backend at all**.

```bash
npm install
npm run serve          # http://localhost:8080
```

Open http://localhost:8080:

- **Start (mock)** needs no backend. It echoes your mic back so you hear
  yourself and streams fake transcripts, exercising the real mic ->
  AudioWorklet -> playback path.
- **Start (real)** creates a session against your backend. Put your API key,
  agent id, and API base in the form; the key is posted to this local server
  (never into the SDK / WebSocket), which calls `POST /api/v1/sessions/create`
  and hands the browser only the `ws_url`.

Point real mode at your backend with the form fields, or set env vars:

```bash
OMNIDIM_API_KEY=... OMNIDIM_AGENT_ID=48152 OMNIDIM_API_BASE=https://omnidim.io npm run serve
```

`npm run smoke` runs a headless packaging + protocol check against the
installed package (no browser needed).

## Files

- `server.mjs` - static server + mock WS (`/mock/chat`) + server-side create proxy (`/local/create-session`).
- `index.html` - the browser UI using `WebSession`.
- `smoke.mjs` - headless protocol test against a mock WebSocket.
