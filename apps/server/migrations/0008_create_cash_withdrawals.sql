CREATE TABLE `cash_withdrawals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	CONSTRAINT "cash_withdrawals_amount_check" CHECK("cash_withdrawals"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `cash_withdrawals_date_idx` ON `cash_withdrawals` (`date`);