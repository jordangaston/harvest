import { RecipeCard } from "../../components/recime/RecipeCard";
import type { Study } from "../types.ts";

export const RecipeCardStudy: Study = {
  name: "RecipeCard",
  group: "Cards",
  controls: [
    { kind: "text", key: "title", label: "Title", default: "Miso Butter Salmon" },
    { kind: "boolean", key: "hasImage", label: "Has image", default: true },
  ],
  render: ({ title, hasImage }) => (
    <RecipeCard
      id="demo"
      title={String(title)}
      imageUrl={hasImage ? "https://picsum.photos/seed/harvest/300/300" : undefined}
    />
  ),
};
