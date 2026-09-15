/**
 * Q-01 probe (WI-3): does `events.catchUp(seq)` replay POLL deltas on our Free/shared plan?
 *
 * We proved live `subscribeEvents` carries votes (spike-poll-raw.ts); the loop-worker's seam
 * recovery additionally needs `catchUp(cursor)` to replay the vote deltas that landed while the
 * worker was down. This creates a poll, records the head sequence, self-casts a vote, then runs
 * ONLY `catchUp(priorSeq)` and reports whether the `voted` delta replays.
 *
 * Run: npx tsx --env-file=.env --env-file=.env.local scripts/spike-poll-catchup.ts [handle]
 * Delete after Q-01 lands.
 */
import { createAdvancedClient } from '../src/imessage/advanced-client.js';

const RECIPIENT = process.argv[2] ?? '+15128267702';
const CHAT_GUID = `any;-;${RECIPIENT}`;

async function main() {
  const client = createAdvancedClient();

  // 1) Establish a cursor BEFORE the vote: the newest sequence seen right now.
  let priorSeq = 0;
  {
    const stream = client.events.catchUp(0);
    for await (const e of stream) {
      if (e.type === 'catchup.complete') {
        priorSeq = e.headSequence;
        break;
      }
    }
    await stream.close();
  }
  console.log('[catchup] priorSeq (head before vote) =', priorSeq);

  // 2) Create a poll + self-cast a vote on its first option.
  const poll = await client.polls.create(CHAT_GUID, '🗳️ Q-01 catchUp probe', ['Pizza', 'Tacos', 'Sushi']);
  console.log('[catchup] created poll', poll.pollMessageGuid, 'opt=', poll.options[0]?.optionIdentifier);
  await client.polls.vote(poll.pollMessageGuid, poll.options[0]!.optionIdentifier);
  console.log('[catchup] self-vote cast; waiting 3s for durability…');
  await new Promise((r) => setTimeout(r, 3000));

  // 3) catchUp from priorSeq ONLY (no live subscribe) — does the voted delta replay?
  let sawVote = false;
  const stream = client.events.catchUp(priorSeq);
  for await (const e of stream) {
    if (e.type === 'catchup.complete') break;
    if (e.type === 'poll.changed') {
      console.log('[catchup] poll delta:', JSON.stringify({ seq: e.sequence, delta: e.delta, guid: e.pollMessageGuid }));
      if (e.delta.type === 'voted' && e.pollMessageGuid === poll.pollMessageGuid) sawVote = true;
    }
  }
  await stream.close();

  console.log(sawVote ? '[catchup] ✅ Q-01 CONFIRMED: catchUp replays the voted delta' : '[catchup] ❌ Q-01 FAILED: no voted delta in catchUp — seam recovery must use subscribeEvents from a saved cursor');
  process.exit(sawVote ? 0 : 1);
}

main().catch((e) => {
  console.error('[catchup] probe error:', e);
  process.exit(2);
});
