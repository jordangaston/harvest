/**
 * SPIKE (throwaway): capture what the Advanced iMessage Kit webhook bridge
 * (webhook.photon.codes) actually delivers for a poll + votes.
 *
 * Goal: confirm (a) the bridge forwards poll events at all, and (b) whether the
 * payload carries pollMessageGuid + voter + option (the linkage the Spectrum
 * webhook lacks). Delete after the design decision lands.
 *
 * Run:   PORT=4599 npx tsx scripts/spike-poll-webhook.ts
 * Expose: ngrok http 4599   (use Jordan's static domain)
 * Then at webhook.photon.codes, register: server URL + API key (from dashboard)
 *        + webhook URL = https://<ngrok>/hook
 * Finally: send a poll into a chat from a device, vote, and watch this log.
 *
 * ponytail: bare node:http, no deps, no HMAC verify (spike only — we're reading
 * shapes, not trusting them). Add signature check when this graduates to real code.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4599);

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const ts = new Date().toISOString();
    console.log(`\n──────── ${ts}  ${req.method} ${req.url} ────────`);
    console.log('headers:', JSON.stringify(req.headers, null, 2));
    if (raw) {
      try {
        console.log('body:', JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        console.log('body (non-JSON):', raw.slice(0, 4000));
      }
    } else {
      console.log('body: <empty>');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});

server.listen(PORT, () => {
  console.log(`spike receiver listening on http://localhost:${PORT}`);
  console.log(`register webhook URL as https://<your-ngrok>/hook`);
});
