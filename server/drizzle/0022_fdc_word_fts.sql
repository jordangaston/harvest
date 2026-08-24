-- Word-tokenised FTS mirror of fdc_foods.description_normalized, complementary to the trigram
-- index (0002_fdc_fts): a word query for `cumin` matches the WORD cumin, never `cucumber`. Feeds
-- the word retriever the FoodMatcher fuses with trigram via RRF (matcher-accuracy-proposal).
CREATE VIRTUAL TABLE `fdc_foods_word_fts` USING fts5(
	`description_normalized`,
	content='fdc_foods',
	content_rowid='fdc_id',
	tokenize='unicode61'
);
--> statement-breakpoint
INSERT INTO `fdc_foods_word_fts`(`fdc_foods_word_fts`) VALUES('rebuild');
--> statement-breakpoint
CREATE TRIGGER `fdc_foods_word_fts_ai` AFTER INSERT ON `fdc_foods` BEGIN
	INSERT INTO `fdc_foods_word_fts`(`rowid`, `description_normalized`) VALUES (new.`fdc_id`, new.`description_normalized`);
END;
--> statement-breakpoint
CREATE TRIGGER `fdc_foods_word_fts_ad` AFTER DELETE ON `fdc_foods` BEGIN
	INSERT INTO `fdc_foods_word_fts`(`fdc_foods_word_fts`, `rowid`, `description_normalized`) VALUES ('delete', old.`fdc_id`, old.`description_normalized`);
END;
--> statement-breakpoint
CREATE TRIGGER `fdc_foods_word_fts_au` AFTER UPDATE ON `fdc_foods` BEGIN
	INSERT INTO `fdc_foods_word_fts`(`fdc_foods_word_fts`, `rowid`, `description_normalized`) VALUES ('delete', old.`fdc_id`, old.`description_normalized`);
	INSERT INTO `fdc_foods_word_fts`(`rowid`, `description_normalized`) VALUES (new.`fdc_id`, new.`description_normalized`);
END;
