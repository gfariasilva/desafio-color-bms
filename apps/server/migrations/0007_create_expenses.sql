CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`expense_category_id` integer,
	`description` text,
	`amount_cents` integer,
	`payment_date` text,
	`payment_means` text,
	`paid_from_till` integer DEFAULT false NOT NULL,
	`reference_month` text,
	`due_date` text,
	`expected_amount_cents` integer,
	`installment_number` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`expense_category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expenses_general_check" CHECK("expenses"."type" <> 'general' or ("expenses"."status" = 'paid' and "expenses"."expense_category_id" is not null and "expenses"."amount_cents" > 0 and "expenses"."payment_date" is not null and "expenses"."payment_means" is not null)),
	CONSTRAINT "expenses_paid_from_till_check" CHECK("expenses"."paid_from_till" = 0 or "expenses"."payment_means" = 'cash')
);
--> statement-breakpoint
CREATE INDEX `expenses_payment_date_idx` ON `expenses` (`payment_date`);--> statement-breakpoint
CREATE INDEX `expenses_expense_category_idx` ON `expenses` (`expense_category_id`);