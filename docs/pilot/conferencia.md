# Conferência diária: período paralelo (CS-3)

> Durante as **2 primeiras semanas** de uso real, o proprietário continua com a planilha do Excel, e os totais de cada dia são comparados com o sistema (spec §9.5 item 4, CS-3: **batem ao centavo**).
> Imprima esta página. Os números do sistema estão em **Relatórios › Relatório do dia** (Alt+6), do dia já **fechado**.

## Como conferir (5 minutos por dia)

1. Feche o dia no sistema e termine a planilha do dia no Excel.
2. Abra o **Relatório do dia** e compare o **Total do dia (bruto)** com o total da planilha. Anote na tabela 1.
3. **Bateu?** Pronto. **Não bateu?** Compare **aba por aba** e, na aba que difere, **forma por forma** (tabela 2), até achar o lançamento.
4. Anote o **motivo** e a **correção**:

| Código | Motivo | O que fazer |
|---|---|---|
| **S** | Erro do **sistema** (cálculo, taxa, total) | Avisar o desenvolvedor. Ele cria um item no backlog e anota o número. |
| **D** | Erro de **digitação no sistema** | Reabrir o dia, corrigir e fechar de novo (o motivo da reabertura fica na Auditoria). |
| **E** | Erro na planilha do **Excel** | Corrigir o Excel. O sistema fica como está. |
| **O** | Outro (explicar) | Anotar e conversar na visita. |

Também vale conferir as **taxas** (Taxa total do dia) e o **dinheiro esperado** do fechamento, se a planilha tiver esses números.

## 1. Resumo dos 14 dias

| Dia | Data | Total Excel (R$) | Total sistema (R$) | Diferença (R$) | Motivo (S/D/E/O) | Correção / item do backlog | Visto |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |
| 11 | | | | | | | |
| 12 | | | | | | | |
| 13 | | | | | | | |
| 14 | | | | | | | |

Dias em que a loja não abriu: escreva "fechada" na linha e passe para o próximo dia aberto (são **14 dias de calendário**, a partir do dia 1º).

## 2. Detalhe de um dia que não bateu

Use uma cópia por dia com diferença. As linhas seguem a ordem das abas do Relatório do dia (a mesma da planilha).

Data: ___/___/______

| Aba | Forma de pagamento | Excel (R$) | Sistema (R$) | Diferença (R$) |
|---|---|---|---|---|
| Acessórios | | | | |
| Carimbos | | | | |
| Cartuchos compatíveis | | | | |
| Recargas | | | | |
| Papelaria | | | | |
| Chaveiro | | | | |
| Toner | | | | |
| Serviços de copiadora | | | | |
| Personalizados | | | | |
| **Total do dia** | | | | |

Lançamento que explica a diferença (hora, valor, aba, forma): ____________________________________________

Motivo (S/D/E/O): ______ · Correção: ____________________________________________ · Item do backlog: #______

## 3. No fim das 2 semanas

- [ ] Todos os dias têm linha na tabela 1, e toda diferença tem motivo e correção.
- [ ] Todo motivo **S** tem item no backlog e está corrigido (ou com data para a correção).
- [ ] O **total do mês até o dia 14** no sistema (Relatórios › Mês – Entradas) bate com a soma da planilha.
- [ ] Resultado copiado para [`resultado-piloto.md`](resultado-piloto.md) (CS-3).
