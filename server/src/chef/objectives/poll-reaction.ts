/**
 * The poll-reaction shell (WI-4). NOT a stack objective — no `objectives` row of this definition is
 * ever created and it has no tasks. It exists only so a debounced vote-reaction turn can reuse the
 * objective-turn machinery (`prepareBriefing` + the chef agent): the poll consumer debounces a burst
 * of votes, then runs `respond` with a `PollIntent`, and the briefing folds a one-line "votes came in,
 * here are the standings" instruction. Resident tools are empty — `chat__send` is always present and a
 * standings summary is all a reaction needs.
 */
export const pollReactionObjective = {
  id: 'poll_reaction',
  instructions:
    "Votes just came in on a poll you sent — the household didn't message you. Look at the standings " +
    'below and send ONE short, warm text: name the current leader (or the tie), and if a clear winner ' +
    'has emerged offer to act on it ("Tacos it is — want me to plan that?"). If it\'s still early or ' +
    'tied, a light nudge is fine. No card, no questions beyond the one offer. Keep it to a line or two.',
  tools: [] as string[],
};
