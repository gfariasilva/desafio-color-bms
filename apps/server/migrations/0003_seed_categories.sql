-- RN-12: initial sale tabs and general-expense categories (FR-14).
-- Seeded by a migration so it runs once: categories the owner deletes never come back.
-- name_key = categoryNameKey(name) from @color-bms/core (checked by test/categories.test.ts).
INSERT INTO `sale_categories` (`name`, `name_key`, `sort_order`, `active`) VALUES
	('Acessórios', 'acessorios', 1, 1),
	('Carimbos', 'carimbos', 2, 1),
	('Cartuchos compatíveis', 'cartuchos compativeis', 3, 1),
	('Recargas', 'recargas', 4, 1),
	('Papelaria', 'papelaria', 5, 1),
	('Chaveiro', 'chaveiro', 6, 1),
	('Toner', 'toner', 7, 1),
	('Serviços de copiadora', 'servicos de copiadora', 8, 1),
	('Personalizados', 'personalizados', 9, 1);
--> statement-breakpoint
INSERT INTO `expense_categories` (`name`, `name_key`, `category_group`, `sort_order`, `active`) VALUES
	('Acessórios', 'acessorios', 'general', 1, 1),
	('Carimbos', 'carimbos', 'general', 2, 1),
	('Chaves', 'chaves', 'general', 3, 1),
	('Despesas gerais (loja)', 'despesas gerais (loja)', 'general', 4, 1),
	('Despesas moto', 'despesas moto', 'general', 5, 1),
	('Abastecimento moto', 'abastecimento moto', 'general', 6, 1),
	('Diversos', 'diversos', 'general', 7, 1),
	('Alimentação', 'alimentacao', 'general', 8, 1),
	('Casa Forte', 'casa forte', 'suppliers', 9, 1),
	('Nova Supri', 'nova supri', 'suppliers', 10, 1),
	('Canal Verde', 'canal verde', 'suppliers', 11, 1),
	('Jandaia', 'jandaia', 'suppliers', 12, 1),
	('Kalunga', 'kalunga', 'suppliers', 13, 1),
	('Suzano', 'suzano', 'suppliers', 14, 1),
	('Outros fornecedores', 'outros fornecedores', 'suppliers', 15, 1);
