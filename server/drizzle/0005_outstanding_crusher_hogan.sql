ALTER TABLE "cookbooks" DROP CONSTRAINT "cookbooks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "cookbooks" ADD CONSTRAINT "cookbooks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;