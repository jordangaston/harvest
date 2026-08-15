# S1 + S2 — backend live demo

A single live pass through the real Fastify routes → services → repositories → Postgres (via `app.inject` against a real DB). Proves S1 (`GET /v1/recipes` expand), S2 (POST/GET/DELETE `/v1/meal-plan`, position append, date-range), and F-06 (recipe delete cascades entries away). Captured 2026-08-07.

```
# Meal Planning — backend live demo (real Postgres, via Fastify inject)
user created: fb700e6f-02bc-4e60-bd9d-a8096c26a967

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)
recipe persisted: 757b634c-7ef4-480d-947e-f8067d2a08f1

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### S1 · GET /v1/recipes?expand=ingredient_names,cookbook_ids
{
  "recipes": [
    {
      "id": "757b634c-7ef4-480d-947e-f8067d2a08f1",
      "title": "Maple Soy Chicken Thighs",
      "image_url": "https://img/chicken.jpg",
      "total_minutes": 25,
      "ingredient_names": [
        "chicken thighs",
        "soy sauce"
      ],
      "cookbook_ids": []
    }
  ],
  "page_token": null
}

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### S2 · POST /v1/meal-plan (breakfast) → 201
{
  "status": 201,
  "entry": {
    "id": "ae1304df-e386-42c5-b192-87f0dacecf3b",
    "date": "2026-08-07",
    "meal": "breakfast",
    "position": 0,
    "recipe": {
      "id": "757b634c-7ef4-480d-947e-f8067d2a08f1",
      "title": "Maple Soy Chicken Thighs",
      "image_url": "https://img/chicken.jpg"
    }
  }
}

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### S2 · POST (lunch) → position appended
{
  "status": 201,
  "position": 0
}

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### S2 · GET /v1/meal-plan week
{
  "entries": [
    {
      "id": "ae1304df-e386-42c5-b192-87f0dacecf3b",
      "date": "2026-08-07",
      "meal": "breakfast",
      "position": 0,
      "recipe": {
        "id": "757b634c-7ef4-480d-947e-f8067d2a08f1",
        "title": "Maple Soy Chicken Thighs",
        "image_url": "https://img/chicken.jpg"
      }
    },
    {
      "id": "39b09ca1-1bdb-4b6f-a88c-ff4ebc77dd3e",
      "date": "2026-08-07",
      "meal": "lunch",
      "position": 0,
      "recipe": {
        "id": "757b634c-7ef4-480d-947e-f8067d2a08f1",
        "title": "Maple Soy Chicken Thighs",
        "image_url": "https://img/chicken.jpg"
      }
    }
  ]
}

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### S2 · DELETE one entry → 204 (204 expected)

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### F-06 · DELETE the recipe → 204; entries cascade away

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### S2 · GET week after deleting the recipe (cascade)
{
  "entries": []
}

stdout | tests/integration/zzz-demo-mealplan.test.ts > DEMO > meal planning end-to-end (S1 + S2 + cascade)

### errors: bad range / unknown recipe / no-auth
{
  "badRange": {
    "error": {
      "code": "INVALID_RANGE",
      "message": "start and end must be valid dates no more than 31 days apart"
    }
  },
  "unknownRecipe": {
    "error": {
      "code": "NOT_FOUND",
      "message": "not found"
    }
  },
  "noAuthStatus": 401
}
```
