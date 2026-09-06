/**
 * The meal-reminder announce shell (meal-reminders WI-01). NOT a stack objective — no `objectives`
 * row of this definition is ever created and it has no tasks. It exists only so a reminder turn can
 * reuse the objective-turn machinery (`prepareBriefing` + the chef agent): the consumer resolves
 * today's plan under the lock, then runs `respond` with a `ReminderIntent`, and the briefing folds a
 * one-line "announce tonight's dinner" instruction. Resident tools are empty — `chat__send` is always
 * present and is all an announcement needs (the recipe cards are its `plan_url`/recipe `url`s).
 */
export const reminderObjective = {
  id: 'meal_reminder',
  instructions:
    "You're sending a scheduled reminder about tonight's meal — the household didn't just message you. " +
    'Announce the planned course warmly in one short text (name the dish or two), then share each recipe ' +
    'as a card (one chat__send, type "richlink", the recipe `url`). No questions, no follow-up — just the ' +
    'heads-up and the recipe. Keep it to a line or two.',
  tools: [] as string[],
};
