# recsys gold sets

`eval:recsys` scores every registered recommender against the `*.json` files here. Each file is a
`GoldSet` (see `src/eval/recsys/types.ts`); the runner merges the `queries` of every file.

```jsonc
{
  "queries": [
    {
      "anchor": "<recipeId>",          // the query recipe
      "relevant": ["<recipeId>", ...], // ids that count as correct neighbors
      "candidates": ["<recipeId>", ...],// the pool to rank (must include the relevant ids)
      "cuisine": "italian"             // optional — buckets the per-cuisine diagnostic
    }
  ]
}
```

The content is produced by the Tier specs (`tier1-metadata-eval`, `tier2-gold-set`), not by this
core. This directory ships empty on purpose — the runner prints a "generate a test set" hint until a
gold file lands.
