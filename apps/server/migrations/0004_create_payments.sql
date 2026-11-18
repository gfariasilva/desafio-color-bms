CREATE TABLE `card_fees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_machine_id` integer NOT NULL,
	`payment_method_id` integer NOT NULL,
	`installments_from` integer NOT NULL,
	`installments_to` integer NOT NULL,
	`rate_ppm` integer NOT NULL,
	`valid_from` text NOT NULL,
	FOREIGN KEY (`card_machine_id`) REFERENCES `card_machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `card_fees_lookup_idx` ON `card_fees` (`card_machine_id`,`payment_method_id`,`valid_from`);--> statement-breakpoint
CREATE INDEX `card_fees_payment_method_idx` ON `card_fees` (`payment_method_id`);--> statement-breakpoint
CREATE TABLE `card_machines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_machines_name_key_unique` ON `card_machines` (`name_key`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`machine_usage` text NOT NULL,
	`allows_installments` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_methods_name_key_unique` ON `payment_methods` (`name_key`);