CREATE TABLE `expense_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`category_group` text NOT NULL,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_name_key_unique` ON `expense_categories` (`name_key`);--> statement-breakpoint
CREATE TABLE `sale_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_categories_name_key_unique` ON `sale_categories` (`name_key`);