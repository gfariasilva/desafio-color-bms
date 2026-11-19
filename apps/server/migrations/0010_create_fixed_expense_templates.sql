CREATE TABLE `fixed_expense_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`template_group` text NOT NULL,
	`subgroup` text,
	`due_day` integer,
	`expected_amount_cents` integer,
	`is_loan` integer DEFAULT false NOT NULL,
	`installments_total` integer,
	`installments_remaining` integer,
	`sort_order` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	CONSTRAINT "fixed_expense_templates_due_day_check" CHECK("fixed_expense_templates"."due_day" is null or "fixed_expense_templates"."due_day" between 1 and 31),
	CONSTRAINT "fixed_expense_templates_expected_amount_check" CHECK("fixed_expense_templates"."expected_amount_cents" is null or "fixed_expense_templates"."expected_amount_cents" > 0),
	CONSTRAINT "fixed_expense_templates_installments_check" CHECK(("fixed_expense_templates"."installments_total" is null and "fixed_expense_templates"."installments_remaining" is null) or ("fixed_expense_templates"."is_loan" = 1 and "fixed_expense_templates"."installments_total" >= 1 and "fixed_expense_templates"."installments_remaining" between 0 and "fixed_expense_templates"."installments_total"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fixed_expense_templates_name_key_unique` ON `fixed_expense_templates` (`name_key`);