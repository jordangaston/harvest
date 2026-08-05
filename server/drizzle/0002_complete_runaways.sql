CREATE TABLE "import_job_recipes" (
	"import_job_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "import_job_recipes_import_job_id_recipe_id_pk" PRIMARY KEY("import_job_id","recipe_id")
);
--> statement-breakpoint
ALTER TABLE "import_job_recipes" ADD CONSTRAINT "import_job_recipes_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job_recipes" ADD CONSTRAINT "import_job_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;