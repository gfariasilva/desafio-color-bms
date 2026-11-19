CREATE TABLE `export_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`reference` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_error_cause` text,
	`created_at` text NOT NULL,
	`last_attempt_at` text,
	`done_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `export_queue_open_item_unique` ON `export_queue` (`kind`,`reference`) WHERE "export_queue"."status" <> 'done';--> statement-breakpoint
CREATE INDEX `export_queue_status_idx` ON `export_queue` (`status`);