ALTER TABLE "recipes" ADD COLUMN "servings_estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "calories" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "grams_of_fat" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "grams_of_saturated_fat" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "grams_of_carbohydrate" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "grams_of_fiber" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "grams_of_sugar" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "grams_of_protein" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "milligrams_of_sodium" numeric;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "nutrition_source" "nutrition_source";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "onboarding";