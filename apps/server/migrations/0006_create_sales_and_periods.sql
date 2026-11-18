CREATE TABLE `days` (
	`date` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE TABLE `months` (
	`year_month` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`fixed_expenses_generated` integer DEFAULT false NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE TABLE `sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`created_at` text NOT NULL,
	`type` text NOT NULL,
	`sale_category_id` integer NOT NULL,
	`payment_method_id` integer NOT NULL,
	`card_machine_id` integer,
	`installments` integer,
	`gross_cents` integer NOT NULL,
	`fee_rate_ppm` integer NOT NULL,
	`fee_cents` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`original_sale_id` integer,
	`reason` text,
	`note` text,
	FOREIGN KEY (`sale_category_id`) REFERENCES `sale_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_machine_id`) REFERENCES `card_machines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sales_net_check" CHECK("sales"."net_cents" = "sales"."gross_cents" - "sales"."fee_cents")
);
--> statement-breakpoint
CREATE INDEX `sales_date_idx` ON `sales` (`date`);--> statement-breakpoint
CREATE INDEX `sales_sale_category_idx` ON `sales` (`sale_category_id`);--> statement-breakpoint
CREATE INDEX `sales_payment_method_idx` ON `sales` (`payment_method_id`);--> statement-breakpoint
CREATE INDEX `sales_card_machine_idx` ON `sales` (`card_machine_id`);--> statement-breakpoint
CREATE INDEX `sales_original_sale_idx` ON `sales` (`original_sale_id`);