ALTER TABLE `expenses` ADD `fixed_expense_template_id` integer REFERENCES fixed_expense_templates(id);--> statement-breakpoint
ALTER TABLE `expenses` ADD `fixed_expense_group` text;--> statement-breakpoint
CREATE INDEX `expenses_reference_month_idx` ON `expenses` (`reference_month`);--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_template_month_unique` ON `expenses` (`fixed_expense_template_id`,`reference_month`) WHERE "expenses"."fixed_expense_template_id" is not null;