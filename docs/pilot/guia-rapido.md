# Sistema Color: guia rápido

> Imprima e deixe ao lado do computador. Abra o sistema pelo atalho **Sistema Color** na área de trabalho.
> **Alt + número** abre cada tela: **Alt+1** Início · **Alt+2** Vendas · **Alt+3** Despesas · **Alt+4** Despesas fixas · **Alt+5** Fechamento · **Alt+6** Relatórios.
> Em todos os formulários: **Enter salva**, **Tab** passa para o próximo campo e **Esc** cancela.

## Venda (Alt+2)

1. Digite o **valor** (ex.: `25,50`).
2. **Tab** → **Aba**: tecle o **número** que aparece ao lado (1–9) ou as primeiras letras do nome.
3. **Tab** → **Forma de pagamento**: número ou letras.
4. Cartão: **Tab** → **Maquininha** e, no crédito parcelado, **Parcelas**.
5. **Enter** salva. O cursor volta para o valor, pronto para a próxima venda.

- Pagamento dividido (parte em dinheiro, parte no cartão) = **duas vendas**.
- Errou uma venda **de hoje**? Use **Editar** ou **Excluir** na lista abaixo do formulário.
- "Sem taxa cadastrada para esta combinação": avise o desenvolvedor (a taxa da maquininha não foi cadastrada).

## Estorno (cancelamento de venda de outro dia)

1. Em Vendas, mude a **Data** para o dia da venda original e clique em **Estornar** na venda.
2. Digite o **valor do estorno** (pode ser parcial) e o **motivo** (ex.: produto com defeito). **Enter**.

O estorno entra no dia de **hoje**, com valor negativo. **Depois, volte a Data para hoje** antes da próxima venda.

## Despesa do dia (Alt+3)

1. **Valor** → **Categoria** → **Meio de pagamento** → **Descrição** (opcional) → **Enter**.
2. Pagou com o **dinheiro da gaveta**? Deixe marcado **"Pago com dinheiro do caixa"** (só vale com Dinheiro).

## Sangria (Alt+3, mais abaixo)

Dinheiro **retirado** da gaveta que **não é despesa** (ex.: levar para o banco ou para casa).
**Valor da sangria** → **Observação** (ex.: "depósito no banco") → **Enter**.

## Conta fixa (Luz, Água, aluguel, parcela de empréstimo…) (Alt+4)

1. **Contas do mês** → **Pagar** na conta.
2. Confira a **data** e o **valor pago** → **Meio de pagamento** → **Enter**.
3. Pagou com o dinheiro da gaveta? Escolha **Dinheiro** e deixe marcado **"Pago com dinheiro do caixa"**.

**Não** registre conta fixa como sangria: ela já tem o lugar certo aqui.

## Fechar o dia (Alt+5)

1. Conte o dinheiro da gaveta.
2. **Troco inicial**: já vem preenchido com o dinheiro contado no último fechamento; confira. (No **primeiro dia** de uso, digite à mão.)
3. Digite o **Dinheiro contado** → **Enter**.
4. Se aparecer **diferença**: confira a contagem. Se estiver certa, escreva uma **observação** (ex.: "troco dado a mais") e tecle **Enter** de novo ("Fechar mesmo assim").

Depois de fechado, o dia não aceita mudanças. O sistema faz o **backup no OneDrive** sozinho.

## Reabrir um dia (Alt+5)

Para corrigir um dia já fechado: escolha a **Data** → **Reabrir dia** → escreva o **motivo** → **Enter**. Corrija e **feche o dia de novo**.

## Conferir o dia (Alt+6 → Relatório do dia)

Totais por aba e por forma de pagamento, despesas, sangrias e o fechamento. Durante as **2 primeiras semanas**, compare com a planilha do Excel e anote na folha de conferência.

## Se algo der errado

- **A tela não abre ou mostra erro de conexão:** espere 1 minuto e recarregue (**F5**). Se continuar, abra a pasta `%LOCALAPPDATA%\ColorBMS` (tecle **Win + R**, cole o caminho e tecle Enter) e dê dois cliques em **`iniciar.cmd`**.
- **Início mostra um alerta** (backup pendente, dia não fechado, relógio errado): anote ou tire uma foto e avise o desenvolvedor.
- **Lançou algo errado e não sabe corrigir:** anote o dia, o valor e o que aconteceu, e avise. Tudo o que é alterado fica registrado na Auditoria; nada se perde.
- **Nunca** apague nem mova arquivos das pastas `ColorBMS` ou `_backup-sistema`.

Desenvolvedor: ______________________ · Telefone/WhatsApp: ______________________
