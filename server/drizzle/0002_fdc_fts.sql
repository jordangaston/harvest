CREATE VIRTUAL TABLE `fdc_foods_fts` USING fts5(
	`description_normalized`,
	content='fdc_foods',
	content_rowid='fdc_id',
	tokenize='trigram'
);
--> statement-breakpoint
CREATE TRIGGER `fdc_foods_fts_ai` AFTER INSERT ON `fdc_foods` BEGIN
	INSERT INTO `fdc_foods_fts`(`rowid`, `description_normalized`) VALUES (new.`fdc_id`, new.`description_normalized`);
END;
--> statement-breakpoint
CREATE TRIGGER `fdc_foods_fts_ad` AFTER DELETE ON `fdc_foods` BEGIN
	INSERT INTO `fdc_foods_fts`(`fdc_foods_fts`, `rowid`, `description_normalized`) VALUES ('delete', old.`fdc_id`, old.`description_normalized`);
END;
--> statement-breakpoint
CREATE TRIGGER `fdc_foods_fts_au` AFTER UPDATE ON `fdc_foods` BEGIN
	INSERT INTO `fdc_foods_fts`(`fdc_foods_fts`, `rowid`, `description_normalized`) VALUES ('delete', old.`fdc_id`, old.`description_normalized`);
	INSERT INTO `fdc_foods_fts`(`rowid`, `description_normalized`) VALUES (new.`fdc_id`, new.`description_normalized`);
END;
