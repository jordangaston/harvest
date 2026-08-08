// Runnable checks for the meal-plan pure logic (no test runner in the mobile
// package). Run: `node lib/__checks__/meal-plan-checks.ts`. Node 24 strips types.
import assert from "node:assert";
import { mondayOf, toISO, weekDates, formatWeekRange, weekdayName, fromISO } from "../week.ts";
import { filterCards } from "../filterCards.ts";
import type { RecipeCard } from "../api/types.ts";

// --- week.ts ---
// Fri 2026-08-07 → Monday is 2026-08-03; the week ends Sun 2026-08-09.
const fri = fromISO("2026-08-07");
assert.equal(toISO(mondayOf(fri)), "2026-08-03", "mondayOf(Fri) is that Monday");
assert.equal(weekdayName(fri), "Friday", "weekday name");
const mon = mondayOf(fri);
assert.equal(weekDates(mon).length, 7, "seven days");
assert.equal(toISO(weekDates(mon)[6]), "2026-08-09", "week ends Sunday");
assert.equal(formatWeekRange(mon), "03 Aug 2026 – 09 Aug 2026", "week range label");
// A Monday maps to itself; a Sunday maps back to the prior Monday.
assert.equal(toISO(mondayOf(fromISO("2026-08-03"))), "2026-08-03", "Monday → itself");
assert.equal(toISO(mondayOf(fromISO("2026-08-09"))), "2026-08-03", "Sunday → prior Monday");

// --- filterCards.ts ---
const cards: RecipeCard[] = [
  { id: "a", title: "Maple Soy Chicken", total_minutes: 25, ingredient_names: ["chicken thighs", "soy sauce"], cookbook_ids: ["cb1"] },
  { id: "b", title: "Beef Stew", total_minutes: 90, ingredient_names: ["beef", "carrot"], cookbook_ids: ["cb2"] },
  { id: "c", title: "Egg Fried Rice", ingredient_names: ["egg", "rice"], cookbook_ids: ["cb1"] }, // null total_minutes
];

assert.deepEqual(filterCards(cards, {}).map((c) => c.id), ["a", "b", "c"], "empty filter = identity");
assert.deepEqual(filterCards(cards, { search: "chicken" }).map((c) => c.id), ["a"], "title substring, case-insensitive");
assert.deepEqual(filterCards(cards, { ingredients: ["chicken"] }).map((c) => c.id), ["a"], "ingredient substring match");
assert.deepEqual(filterCards(cards, { ingredients: ["chicken", "soy"] }).map((c) => c.id), ["a"], "ingredient AND both present");
assert.deepEqual(filterCards(cards, { ingredients: ["chicken", "beef"] }).map((c) => c.id), [], "ingredient AND excludes when not all present");
assert.deepEqual(filterCards(cards, { maxMinutes: 30 }).map((c) => c.id), ["a"], "time bucket keeps <=; excludes null total_minutes");
assert.deepEqual(filterCards(cards, { cookbookId: "cb1" }).map((c) => c.id), ["a", "c"], "cookbook membership");

console.log("meal-plan-checks: all assertions passed");
