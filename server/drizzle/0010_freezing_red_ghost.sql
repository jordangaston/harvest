CREATE TYPE "public"."grocery_aisle" AS ENUM('produce', 'meat_seafood', 'dairy_eggs_fridge', 'bakery', 'pantry', 'herbs_spices', 'frozen', 'beverages', 'household', 'other');--> statement-breakpoint
CREATE TABLE "grocery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric,
	"unit" text,
	"quantity_text" text,
	"aisle" "grocery_aisle" NOT NULL,
	"icon" text DEFAULT 'default' NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"source_recipe_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_items" ADD CONSTRAINT "grocery_items_source_recipe_id_recipes_id_fk" FOREIGN KEY ("source_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grocery_items_user_idx" ON "grocery_items" USING btree ("user_id");