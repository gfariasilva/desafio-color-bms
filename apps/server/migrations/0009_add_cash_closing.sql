ALTER TABLE `days` ADD `opening_cash_cents` integer;--> statement-breakpoint
ALTER TABLE `days` ADD `expected_cash_cents` integer;--> statement-breakpoint
ALTER TABLE `days` ADD `counted_cash_cents` integer;--> statement-breakpoint
ALTER TABLE `days` ADD `difference_cents` integer;--> statement-breakpoint
ALTER TABLE `days` ADD `note` text;--> statement-breakpoint
ALTER TABLE `payment_methods` ADD `is_cash` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- RN-07: the seeded "Dinheiro" (name_key from RN-12, migration 0005) is the cash method, so
-- its sales count as cash in the till. Flagged once here, so renaming it later changes nothing.
UPDATE `payment_methods` SET `is_cash` = 1 WHERE `name_key` = 'dinheiro';
