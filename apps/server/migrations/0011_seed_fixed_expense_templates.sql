-- RN-12 / FR-10: initial fixed-expense templates, in display order (Gerais, then Taxas governo).
-- Seeded by a migration so it runs once and writes no audit rows.
-- name_key = fixedExpenseTemplateNameKey() from @color-bms/core: subgroup + name, ignoring
-- case and accents (checked by test/fixed-expense-templates.test.ts).
-- Due days, expected amounts and loan installments are left empty: the owner fills them in
-- at installation (Q-05, Q-06).
INSERT INTO `fixed_expense_templates` (`name`, `name_key`, `template_group`, `subgroup`, `is_loan`, `sort_order`, `active`) VALUES
	('Água', 'agua', 'general', NULL, 0, 1, 1),
	('Luz', 'luz', 'general', NULL, 0, 2, 1),
	('Aluguel', 'aluguel', 'general', NULL, 0, 3, 1),
	('Contador', 'contador', 'general', NULL, 0, 4, 1),
	('Funcionário', 'funcionario', 'general', NULL, 0, 5, 1),
	('GPS', 'gps', 'general', NULL, 0, 6, 1),
	('Seguro loja', 'seguro loja', 'general', NULL, 0, 7, 1),
	('Vivo fixo', 'telefonia – vivo fixo', 'general', 'Telefonia', 0, 8, 1),
	('Vivo móvel', 'telefonia – vivo movel', 'general', 'Telefonia', 0, 9, 1),
	('Banco', 'banco', 'general', NULL, 0, 10, 1),
	('Empréstimos', 'emprestimos', 'general', NULL, 1, 11, 1),
	('DAS', 'das', 'government_fees', NULL, 0, 12, 1),
	('DARE', 'dare', 'government_fees', NULL, 0, 13, 1),
	('DARF', 'darf', 'government_fees', NULL, 0, 14, 1),
	('TFE', 'tfe', 'government_fees', NULL, 0, 15, 1);
