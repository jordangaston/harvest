/**
 * SPIKE (throwaway): consume the RAW advanced poll stream on our Free/shared plan,
 * bypassing the Spectrum `app.messages` enrichment that dropped votes (resolvePoll →
 * client.polls.get() returns empty title → Zod-throw → skipUnmappable eats the vote).
 *
 * Proves whether the raw vote event carries what we need to bookkeep tallies ourselves:
 *   pollMessageGuid (→ links to our poll), delta.optionIdentifier, delta.type
 *   (voted/unvoted), and the voter identity — with option text mapped from the poll we
 *   created (create() returns options[].optionIdentifier + text).
 *
 * Replicates exactly how @spectrum-ts/imessage builds its shared-mode client
 * (createCloudClients → shared branch): createGrpcClient at imessage.spectrum.photon.codes,
 * token minted from project creds.
 *
 * Run: npx tsx --env-file=.env --env-file=.env.local scripts/spike-poll-raw.ts [handle] [listenSec]
 * Delete after the design decision lands.
 */
import { createGrpcClient } from '@photon-ai/advanced-imessage/grpc';

const RECIPIENT = process.argv[2] ?? '+15128267702';
const LISTEN_SECONDS = Number(process.argv[3] ?? 180);
const CHAT_GUID = `any;-;${RECIPIENT}`;
const ADDRESS = process.env.SPECTRUM_IMESSAGE_ADDRESS ?? 'imessage.spectrum.photon.codes:443';

async function mintSharedToken(): Promise<string> {
  const pid = process.env.PHOTON_PROJECT_ID!;
  const sec = process.env.PHOTON_PROJECT_SECRET!;
  const basic = Buffer.from(`${pid}:${sec}`).toString('base64');
  const res = await fetch(`https://spectrum.photon.codes/projects/${pid}/imessage/tokens`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'content-type': 'application/json' },
  });
  const body = (await res.json()) as { succeed: boolean; data: { type: string; token: string; expiresIn: number } };
  console.log(`[raw] token minted: type=${body.data.type} ttl=${body.data.expiresIn}s`);
  return body.data.token;
}

async function main() {
  const token = await mintSharedToken();
  const client = createGrpcClient({ address: ADDRESS, token, tls: true, retry: true, autoIdempotency: true });
  console.log(`[raw] gRPC client @ ${ADDRESS}`);

  // Map optionIdentifier -> text from the poll we create (raw stream votes carry only the id).
  const optionText = new Map<string, string>();

  // 1) CREATE a poll via the advanced client (does create() work on shared?)
  let pollGuid = '';
  try {
    const poll = await client.polls.create(CHAT_GUID, '🗳️ RAW spike — pick MANY:', ['Pizza', 'Tacos', 'Sushi']);
    pollGuid = poll.pollMessageGuid;
    for (const o of poll.options) optionText.set(o.optionIdentifier, o.text);
    console.log('[raw] CREATE OK. pollMessageGuid=', pollGuid);
    console.log('[raw] options:', JSON.stringify(poll.options));
  } catch (e) {
    console.error('[raw] CREATE FAILED:', (e as Error).message);
  }

  // 2) Does get() work on shared, or return the empty title that broke the SDK path?
  if (pollGuid) {
    try {
      const got = await client.polls.get(pollGuid);
      console.log('[raw] GET OK. title=', JSON.stringify(got.title), 'votes=', JSON.stringify(got.votes));
    } catch (e) {
      console.error('[raw] GET FAILED (this is what breaks app.messages):', (e as Error).message);
    }
  }

  // 3) Subscribe to the RAW poll stream and dump every vote event.
  console.log(`[raw] subscribing to raw poll events for ${LISTEN_SECONDS}s — vote now (pick several, then change)…`);
  const t = setTimeout(() => { console.log('[raw] window over.'); process.exit(0); }, LISTEN_SECONDS * 1000);
  t.unref?.();

  for await (const event of client.polls.subscribeEvents()) {
    const e: any = event;
    const kind = e?.delta?.type;
    if (kind === 'created' || kind === 'optionAdded') {
      for (const o of e.delta.options ?? []) optionText.set(o.optionIdentifier, o.text);
    }
    const optId = e?.delta?.optionIdentifier;
    const label = optId ? (optionText.get(optId) ?? `<unknown id ${optId}>`) : '';
    console.log(`\n[raw] EVENT delta=${kind} poll=${e?.pollMessageGuid} voter=${e?.actor?.id ?? e?.actor?.address ?? '?'} option=${label}`);
    console.log('      full:', JSON.stringify(e, (_k, v) => (typeof v === 'function' ? '[fn]' : v)));
  }
}

main().catch((e) => { console.error('[raw] fatal:', e); process.exit(1); });
