ALTER TABLE "saved_recipes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "saved_recipes" CASCADE;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipes_user_idx" ON "recipes" USING btree ("user_id","created_at" DESC NULLS LAST);