ALTER TABLE `Mark` RENAME COLUMN `epubcfi` TO `anchor`;--> statement-breakpoint
ALTER TABLE `Book` ADD `format` text DEFAULT 'epub' NOT NULL;--> statement-breakpoint
ALTER TABLE `Mark` ADD `anchorType` text DEFAULT 'cfi' NOT NULL;