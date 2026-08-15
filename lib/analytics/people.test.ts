import { test } from "node:test";
import assert from "node:assert/strict";
import { toPeopleProperties } from "./people.ts";

test("maps a full onboarding payload to people-properties with signup_at", () => {
  const props = toPeopleProperties(
    {
      goals: ["eat_healthier", "save_money"],
      recipe_sources: ["social_media"],
      cook_days: ["mon", "wed"],
      when_cook: "evening_ready",
      cook_time: "from_6_to_7pm",
      how_heard: "tiktok",
      age: "from_25_to_34",
    },
    "2026-08-07T00:00:00.000Z",
  );
  assert.deepEqual(props, {
    signup_at: "2026-08-07T00:00:00.000Z",
    goals: ["eat_healthier", "save_money"],
    recipe_sources: ["social_media"],
    cook_days: ["mon", "wed"],
    when_cook: "evening_ready",
    cook_time: "from_6_to_7pm",
    how_heard: "tiktok",
    age: "from_25_to_34",
  });
});

test("omits undefined answers but always sets signup_at", () => {
  const props = toPeopleProperties({ goals: ["organize_recipes"] }, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(props, { signup_at: "2026-01-01T00:00:00.000Z", goals: ["organize_recipes"] });
});

test("an empty payload yields just signup_at", () => {
  assert.deepEqual(toPeopleProperties({}, "2026-01-01T00:00:00.000Z"), {
    signup_at: "2026-01-01T00:00:00.000Z",
  });
});
