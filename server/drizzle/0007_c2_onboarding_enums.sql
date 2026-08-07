CREATE TYPE "public"."age_band" AS ENUM('under_24', 'from_25_to_34', 'from_35_to_44', 'from_45_to_54', 'over_55');--> statement-breakpoint
CREATE TYPE "public"."cook_time" AS ENUM('before_5pm', 'from_5_to_6pm', 'from_6_to_7pm', 'from_7_to_8pm', 'after_8pm');--> statement-breakpoint
CREATE TYPE "public"."goal" AS ENUM('eat_healthier', 'save_money', 'improve_cooking', 'organize_recipes', 'plan_meals', 'meal_prepping', 'try_new_cuisines');--> statement-breakpoint
CREATE TYPE "public"."how_heard" AS ENUM('tiktok', 'google_search', 'youtube', 'instagram', 'pinterest', 'email_newsletter', 'app_store_search', 'facebook', 'friend', 'other');--> statement-breakpoint
CREATE TYPE "public"."nutrition_source" AS ENUM('parsed', 'computed');--> statement-breakpoint
CREATE TYPE "public"."recipe_source" AS ENUM('social_media', 'recipe_websites', 'printed_handwritten');--> statement-breakpoint
CREATE TYPE "public"."weekday" AS ENUM('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');--> statement-breakpoint
CREATE TYPE "public"."when_cook" AS ENUM('morning_plan_ahead', 'lunchtime', 'evening_ready', 'weekly_schedule', 'meal_prep');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "goals" "goal"[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recipe_sources" "recipe_source"[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cook_days" "weekday"[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "when_cook" "when_cook";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cook_time" "cook_time";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "how_heard" "how_heard";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age" "age_band";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp with time zone;