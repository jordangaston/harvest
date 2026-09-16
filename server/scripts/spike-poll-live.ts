/**
 * SPIKE (throwaway): prove whether our current Free/shared plan can (1) SEND a native
 * iMessage poll and (2) RECEIVE inbound votes on the live Spectrum `app.messages` stream
 * (NOT the webhook — the webhook is message-only). If votes arrive as `poll_option`
 * content, we can build the feature with our own vote bookkeeping; no advanced kit needed.
 *
 * Run:   npx tsx scripts/spike-poll-live.ts [recipientHandle] [listenSeconds]
 *   e.g. npx tsx scripts/spike-poll-live.ts +15128267702 180
 *
 * It sends a clearly-labelled test poll to the recipient, then logs every inbound
 * message for the listen window. Vote on the poll from that device and watch the log.
 * Delete after the design decision lands.
 *
 * ponytail: logs raw tuple shape + narrows on content.type; no persistence, no HMAC.
 */
import { Spectrum, poll } from '@spectrum-ts/core';
import { imessage } from '@spectrum-ts/imessage';

const RECIPIENT = process.argv[2] ?? '+15128267702';
const LISTEN_SECONDS = Number(process.argv[3] ?? 180);
const CHAT_GUID = `any;-;${RECIPIENT}`;

async function main() {
  const app = await Spectrum({
    projectId: process.env.PHOTON_PROJECT_ID!,
    projectSecret: process.env.PHOTON_PROJECT_SECRET!,
    providers: [imessage.config()],
    webhookSecret: process.env.SPECTRUM_WEBHOOK_SECRET,
  });
  const im = imessage(app);
  console.log(`[spike] project=${app.config?.slug ?? '(none)'} → sending poll to ${RECIPIENT}`);

  // 1) SEND — does space.send(poll(...)) work on Free/shared, or throw a plan error?
  let space;
  try {
    space = await im.space.get(CHAT_GUID);
  } catch (e) {
    console.log(`[spike] space.get failed (${(e as Error).message}); trying space.create`);
    space = await im.space.create(RECIPIENT);
  }
  try {
    const sent = await space.send(poll('🗳️ Spike test — pick one (ignore me):', 'Pizza', 'Tacos', 'Sushi'));
    console.log('[spike] SEND OK. returned:', JSON.stringify(sent, (_k, v) => (typeof v === 'function' ? '[fn]' : v))?.slice(0, 500));
  } catch (e) {
    console.error('[spike] SEND FAILED:', (e as Error).message);
    console.error('[spike] → this is the "can Free/shared send polls at all" answer.');
    process.exit(1);
  }

  // 2) RECEIVE — open the live stream and watch for a poll_option vote.
  console.log(`[spike] listening on app.messages for ${LISTEN_SECONDS}s — vote on the poll now…`);
  const timer = setTimeout(() => {
    console.log('[spike] listen window over. done.');
    process.exit(0);
  }, LISTEN_SECONDS * 1000);
  timer.unref?.();

  for await (const tuple of app.messages) {
    // shape is [Space, Message]; find the member with .content
    const msg: any = Array.isArray(tuple) ? tuple.find((x: any) => x && 'content' in x) ?? tuple[1] : tuple;
    const c = msg?.content;
    const type = c?.type ?? '(unknown)';
    const line = `[spike] inbound dir=${msg?.direction} type=${type} sender=${msg?.sender?.id ?? '?'}`;
    if (type === 'poll_option') {
      console.log('★★★ VOTE RECEIVED ★★★');
      console.log(line);
      console.log('    full content:', JSON.stringify(c, (_k, v) => (typeof v === 'function' ? '[fn]' : v), 2));
    } else {
      console.log(line, type === 'text' ? `text=${JSON.stringify(c?.text)}` : '');
    }
  }
}

main().catch((e) => {
  console.error('[spike] fatal:', e);
  process.exit(1);
});
