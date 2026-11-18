# Perguntas para o proprietário

> Lista para levar à Color. As respostas destravam o **piloto** (o sistema substituindo a planilha diária) e as próximas etapas.
> Referências entre parênteses (Q-xx, FR-xx) apontam para a especificação (`docs/spec.md`). Depois da conversa, as respostas entram na especificação e no backlog.

**Data da conversa:** ___/___/______

## Levar ou pedir ao proprietário

- [ ] Uma **cópia da planilha diária** de 2 ou 3 dias recentes (para conferir as abas, a ordem e os totais durante o período paralelo).
- [ ] Uma **cópia da planilha mensal** de um mês recente.
- [ ] **Prints das taxas** nos aplicativos da PagSeguro e do Mercado Pago (ou o contrato com as taxas).

---

## A. Antes do piloto (necessárias para começar)

**1. Taxas das maquininhas** (Q-01). Sem elas o sistema não aceita vendas no cartão.

Para **cada maquininha** (PagSeguro e Mercado Pago), qual é a taxa em %:

| Forma | PagSeguro | Mercado Pago |
|---|---|---|
| Débito | | |
| Crédito à vista (1x) | | |
| Crédito parcelado: de quantas a quantas parcelas cada taxa vale? (ex.: 2–6x, 7–12x) | | |
| PIX pela maquininha | | |

- Existe alguma **tarifa fixa por venda** (em R$), além da porcentagem?
- O senhor usa **antecipação** do dinheiro do cartão (Q-02)? Se sim, a taxa acima já inclui a antecipação?

**2. PIX e boleto** (Q-03)
- O cliente paga PIX **pela maquininha**, **direto na conta**, ou os dois?
- **Boleto:** quem emite? Tem tarifa? A venda conta no dia da venda ou no dia em que o cliente paga?

**3. Estorno no cartão** (Q-04). Quando uma venda no cartão é cancelada, a maquininha **devolve a taxa**?

**4. Dinheiro colocado no caixa durante o dia** (Q-08). Acontece de colocar dinheiro no caixa além do troco inicial (por exemplo, para ter troco)? Com que frequência?

**5. Contas pagas com o dinheiro do caixa**
- Quais contas fixas o senhor costuma pagar **com o dinheiro do caixa** (Luz, Água, funcionário…)? Com que frequência?
- Até essa parte ficar pronta no sistema, a combinação é registrar o pagamento como **sangria** com a observação começando por **"CONTA:"** (ex.: "CONTA: Luz outubro"). O senhor concorda?

**6. Rotina de fechamento**
- O senhor **conta todo o dinheiro do caixa** todos os dias ao fechar? A que horas costuma fechar?
- Quanto costuma deixar de **troco inicial** para o dia seguinte?
- A loja abre aos sábados, domingos e feriados?

**7. Data de início e período paralelo** (§9.5)
- Podemos começar **para valer no dia 1º de ______** (mês)?
- Antes disso: alguns **dias de teste** com o sistema, com dados de treino que depois são apagados.
- O senhor tem **cerca de 1 hora** para o treinamento?
- Durante as **2 primeiras semanas** o senhor continua preenchendo a planilha, e comparamos os totais todos os dias. Tudo bem?

**8. O computador da loja**
- É **Windows 11**? Usa **Edge** ou **Chrome**?
- Fica ligado o dia todo? É **desligado à noite**?
- O usuário do Windows tem **senha**?
- O **relógio** do computador está certo (data e hora)?
- Tem espaço livre no disco? (Vamos verificar na visita.)
- As atualizações do sistema serão feitas **pessoalmente, na loja**. Qual o melhor dia e horário para essas visitas (cerca de 20 min, sem atrapalhar o movimento)?

**9. OneDrive** (Q-07)
- O **aplicativo do OneDrive** está instalado e conectado na conta certa?
- Em **qual pasta** devemos guardar as cópias de segurança e as planilhas?
- Há **espaço livre** na conta do OneDrive?

**10. Quem usa o sistema**. Alguém além do senhor (por exemplo, o funcionário) vai **registrar vendas** ou **fechar o caixa**?

**11. Vendas com sinal** (Q-09). Nos produtos personalizados, o cliente paga um **sinal** e o restante depois? A combinação é registrar cada pagamento como uma venda no dia em que é recebido. Tudo bem?

---

## B. Antes do fim do primeiro mês (podem ser respondidas durante o piloto)

**12. Despesas fixas e vencimentos** (Q-05)
- Quais contas são realmente **mensais** e qual o **dia de vencimento** de cada uma?
- A TFE e outras taxas são anuais ou por parcela? Em quais meses?
- "Telefonia" inclui algo além de Vivo fixo e Vivo móvel?

**13. Empréstimos** (Q-06). Quantos empréstimos estão ativos? Para cada um: valor da parcela, quantas parcelas faltam e o dia de vencimento.

**14. Planilha mensal**. Como o senhor confere hoje o saldo do mês (para compararmos com o resumo mensal do sistema no fim do primeiro mês)?

---

## C. Podem esperar

**15. Vendas a prazo / fiado** (Q-10). Existe venda em que o cliente leva e paga depois? (Fora do escopo atual.)

**16. "Abas mais lucrativas"** (Q-11). No painel, mostrar as abas **que mais faturam** atende? Lucro por aba exigiria ligar cada compra a uma aba.

---

## Anotações

&nbsp;

&nbsp;

&nbsp;
