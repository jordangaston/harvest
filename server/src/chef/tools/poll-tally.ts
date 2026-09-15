import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db.js';
import { pollVotes, threadMessages } from '../../schema.js';
import type { ChefTool, TurnContext } from './types.js';

/** One option's standing: its text, how many selected it, and who did (voter handles). */
export interface OptionTally {
  optionIdentifier: string;
  text: string;
  count: number;
  voters: string[];
}

/**
 * The current standings of a poll: every option (from the `type='poll'` anchor row's option map)
 * with its selected-vote count and voters. An option with no votes is present at count 0 — a poll
 * with no votes yet returns every option at 0, a valid empty state, not an error. Returns [] only
 * when the anchor row is missing (no such poll).
 */
export async function pollTally(db: Database, pollMessageGuid: string): Promise<OptionTally[]> {
  const [anchor] = await db
    .select({ body: threadMessages.body })
    .from(threadMessages)
    .where(and(eq(threadMessages.type, 'poll'), eq(threadMessages.externalId, pollMessageGuid)))
    .limit(1);
  if (!anchor) return [];
  const options: { optionIdentifier: string; text: string }[] = anchor.body ? (JSON.parse(anchor.body).options ?? []) : [];

  const selected = await db
    .select({ optionIdentifier: pollVotes.optionIdentifier, voter: pollVotes.voter })
    .from(pollVotes)
    .where(and(eq(pollVotes.pollMessageGuid, pollMessageGuid), eq(pollVotes.selected, true)));

  const votersByOption = new Map<string, string[]>();
  for (const { optionIdentifier, voter } of selected) {
    const voters = votersByOption.get(optionIdentifier) ?? [];
    voters.push(voter);
    votersByOption.set(optionIdentifier, voters);
  }
  return options.map((o) => {
    const voters = votersByOption.get(o.optionIdentifier) ?? [];
    return { optionIdentifier: o.optionIdentifier, text: o.text, count: voters.length, voters };
  });
}

/**
 * Reads a poll's current standings for the chef — each option's text, vote count, and voters (from
 * `poll_votes` where `selected=true`, joined to the anchor row's option map). A poll with no votes
 * returns every option at count 0 (a valid empty state). Reads only.
 */
export class PollTallyTool implements ChefTool {
  readonly id = 'poll__tally';

  private constructor(
    private readonly ctx: TurnContext,
    private readonly db: Database,
  ) {}

  static create(ctx: TurnContext, db: Database): PollTallyTool {
    return new PollTallyTool(ctx, db);
  }

  canRun(): boolean {
    return true;
  }

  asMastraTool() {
    return createTool({
      id: this.id,
      description:
        "Read a poll's current standings — pass `pollMessageGuid`. Returns { options: [{ text, count, " +
        'voters }] }, one per option, sorted as sent. A poll with no votes yet returns every option at ' +
        'count 0. Reads only.',
      inputSchema: z.object({ pollMessageGuid: z.string() }),
      execute: async ({ pollMessageGuid }) => this.run(pollMessageGuid),
    });
  }

  async run(pollMessageGuid: string): Promise<{ options: { text: string; count: number; voters: string[] }[] }> {
    const tally = await pollTally(this.db, pollMessageGuid);
    return { options: tally.map((t) => ({ text: t.text, count: t.count, voters: t.voters })) };
  }
}
