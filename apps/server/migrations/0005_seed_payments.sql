-- RN-12: initial payment methods and card machines (FR-15).
-- Seeded by a migration so it runs once: items the owner deletes never come back.
-- name_key = categoryNameKey(name) from @color-bms/core (checked by test/payments.test.ts).
-- machine_usage follows FR-01; PIX has an optional machine (Q-03 assumption).
-- No fee rows: the rates come from the owner (Q-01).
INSERT INTO `payment_methods` (`name`, `name_key`, `machine_usage`, `allows_installments`, `sort_order`, `active`) VALUES
	('Dinheiro', 'dinheiro', 'not_applicable', 0, 1, 1),
	('Cartão de débito', 'cartao de debito', 'required', 0, 2, 1),
	('Cartão de crédito', 'cartao de credito', 'required', 1, 3, 1),
	('PIX/Depósito', 'pix/deposito', 'optional', 0, 4, 1),
	('Boleto bancário', 'boleto bancario', 'not_applicable', 0, 5, 1);
--> statement-breakpoint
INSERT INTO `card_machines` (`name`, `name_key`, `sort_order`, `active`) VALUES
	('PagSeguro', 'pagseguro', 1, 1),
	('Mercado Pago', 'mercado pago', 2, 1);
