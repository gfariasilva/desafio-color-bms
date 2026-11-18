# Especificação de Requisitos: Sistema de Gestão Financeira da Color

| | |
|---|---|
| **Versão** | 1.0 (rascunho para validação do proprietário) |
| **Data** | 18/11/2026 |
| **Fontes** | `DESAFIO_COLOR.docx` (documento do proprietário), [`00-analise-documento.md`](00-analise-documento.md) e [`01-entrevista.md`](01-entrevista.md) |
| **Idioma** | Interface em pt-BR. Código e documentação técnica em inglês. |

---

## Sumário
1. [Contexto e objetivos](#1-contexto-e-objetivos)
2. [Usuários e perfis](#2-usuários-e-perfis)
3. [Glossário](#3-glossário)
4. [Requisitos funcionais](#4-requisitos-funcionais)
5. [Regras de negócio](#5-regras-de-negócio)
6. [Modelo de dados (rascunho)](#6-modelo-de-dados-rascunho)
7. [Integrações: OneDrive](#7-integrações-onedrive)
8. [Requisitos não funcionais](#8-requisitos-não-funcionais)
9. [Escopo: MVP e fases futuras](#9-escopo-mvp-e-fases-futuras)
10. [Questões em aberto para o proprietário](#10-questões-em-aberto-para-o-proprietário)
11. [Premissas adotadas](#11-premissas-adotadas)

---

## 1. Contexto e objetivos

### 1.1 Contexto
A Color é uma papelaria e copiadora de pequeno porte em São Paulo. Hoje o controle financeiro funciona assim:
- **Uma planilha Excel é criada à mão todos os dias.** Ela tem uma **aba** para cada linha de venda (Acessórios, Carimbos, Toner etc.) e uma aba de saídas.
- **Planilhas mensais** consolidam entradas, despesas gerais e despesas fixas e chegam ao **saldo mensal**.
- As vendas no cartão passam por duas **maquininhas** (PagSeguro e Mercado Pago). Cada uma cobra uma taxa diferente, e o proprietário quer ver o **valor cheio** e o **valor real** (descontada a taxa).

### 1.2 Problemas a resolver
| # | Problema atual |
|---|---|
| P1 | Trabalho manual e repetitivo: criar a planilha do dia e copiar totais para as planilhas mensais. |
| P2 | Risco de erro em fórmulas, somas e cópias entre planilhas. |
| P3 | Taxas de maquininha calculadas à mão, ou não calculadas, sem histórico de mudanças de taxa. |
| P4 | Nenhuma conferência estruturada do dinheiro em caixa. |
| P5 | Despesas fixas sem controle de vencimento: risco de atraso e de esquecimento. |
| P6 | Sem visão gerencial: comparações entre meses e ranking das abas exigem trabalho manual. |

### 1.3 Objetivos
- **O1.** Substituir **definitivamente** as planilhas Excel por um sistema local, que passa a ser a **única fonte da verdade**.
- **O2.** Calcular automaticamente totais, taxas, valor líquido e saldo.
- **O3.** Controlar o caixa diário (fechamento com conferência) e as despesas fixas (vencimentos).
- **O4.** Manter **backups automáticos** no OneDrive:
  - planilhas legíveis por humanos, para consulta caso o sistema falhe;
  - cópia do banco de dados, para restaurar o sistema.
- **O5.** Oferecer 3 painéis (dashboards) simples para apoiar decisões.

### 1.4 Critérios de sucesso
| # | Critério | Como medir |
|---|---|---|
| CS-1 | O proprietário deixa de criar planilhas à mão em até **1 mês** após a implantação. | Relato do proprietário. Nenhuma planilha manual criada após o período paralelo. |
| CS-2 | Registrar uma venda leva **≤ 10 segundos**. | Cronometragem com o proprietário, média de 10 vendas. |
| CS-3 | Os totais diários e mensais **batem ao centavo** com uma conferência manual durante o período paralelo. | Comparação diária nas 2 primeiras semanas. |
| CS-4 | Fechar o dia leva **≤ 3 minutos**. | Cronometragem. |
| CS-5 | O backup de cada dia fechado chega ao OneDrive **no mesmo dia**, quando houver internet. | Conferência da pasta do OneDrive. |

---

## 2. Usuários e perfis

| Perfil | Quem | Acesso |
|---|---|---|
| **Proprietário** (único perfil) | O dono da loja | Acesso total a todas as funções. |

- Há **um único usuário**. O sistema não tem cadastro de usuários nem perfis.
- **Não há tela de login no PC.** O acesso é protegido pela conta do Windows.
- O sistema roda em **um único PC da loja** (Windows 11), com **um usuário por vez**.
- Ações sensíveis, como reabrir um dia ou mês e restaurar um backup, pedem apenas uma **confirmação** ("Tem certeza?") e um **motivo** onde indicado.
- **Fase 2:** com o acesso pelo celular, passa a ser exigida **senha** para qualquer acesso que não venha do próprio PC (ver §9).

---

## 3. Glossário

| Termo | Significado no sistema |
|---|---|
| **Aba** | Termo herdado da planilha. No sistema, designa uma **categoria de venda** (ex.: Toner, Papelaria). Exibida como "aba" na interface para manter a familiaridade. |
| **Entrada** | Receita: uma venda registrada. |
| **Saída** | Despesa: dinheiro que sai da empresa. |
| **Saídas diárias** | Despesas gerais esporádicas lançadas no dia em que acontecem (ex.: um lanche, combustível da moto). É a tela de lançamento de despesas gerais. Não é um tipo separado. |
| **Despesas gerais** | Despesas variáveis classificadas por categoria (Acessórios, Alimentação, fornecedores etc.). |
| **Despesas fixas** | Contas recorrentes mensais (Aluguel, Luz, impostos etc.), geradas a partir de um modelo, com vencimento. |
| **Fornecedores de materiais** | Grupo de categorias de despesa geral, uma por fornecedor (Kalunga, Suzano…). |
| **Forma de pagamento** | Como o cliente pagou: Dinheiro, Cartão de débito, Cartão de crédito, PIX/Depósito, Boleto bancário. |
| **Maquininha** | Terminal de cartão (PagSeguro, Mercado Pago) que cobra uma **taxa** por transação. |
| **Taxa** | Percentual cobrado pela maquininha sobre o valor da venda. Varia por maquininha, forma de pagamento e número de parcelas. |
| **Valor cheio / valor bruto** | Valor total cobrado do cliente. |
| **Valor real / valor líquido** | Valor bruto menos a taxa da maquininha. |
| **À vista / parcelado** | Crédito em 1 parcela, ou em 2 a 12 parcelas. |
| **Antecipação** | Recebimento antecipado das vendas no cartão mediante taxa extra. Fora do escopo do MVP. |
| **Estorno** | Devolução ou cancelamento de uma venda de um dia anterior. É registrado como um lançamento negativo na data de hoje. |
| **Troco inicial** | Dinheiro que já estava no caixa no início do dia. |
| **Sangria** | Retirada de dinheiro do caixa durante o dia (ex.: levar ao banco ou guardar). **Não é despesa.** |
| **Fechamento de caixa** | Conferência de fim de dia: o dinheiro contado comparado com o esperado. |
| **Diferença de caixa** | Dinheiro contado − dinheiro esperado. Positiva = sobra, negativa = falta. |
| **Dia fechado / mês fechado** | Período travado para edição. Só pode ser alterado depois de reaberto. |
| **Vencimento** | Data-limite de pagamento de uma despesa fixa. |
| **Regime de caixa** | Regra adotada: uma despesa conta no mês em que foi **paga**, não no mês a que se refere. |
| **Competência / mês de referência** | Mês a que a despesa se refere (ex.: a conta de Luz de outubro). É guardado, mas não entra no cálculo do saldo do MVP. |
| **Saldo mensal** | Entradas brutas − Taxas de maquininha − Total geral de despesas (ver RN-10). |
| **DAS** | Documento de Arrecadação do Simples Nacional (imposto unificado). |
| **DARE** | Documento de Arrecadação de Receitas Estaduais (SP), ex.: ICMS. |
| **DARF** | Documento de Arrecadação de Receitas Federais. |
| **TFE** | Taxa de Fiscalização de Estabelecimentos (Prefeitura de São Paulo). |
| **GPS** | Guia da Previdência Social (INSS). |
| **Backup pendente** | Exportação para o OneDrive que ainda não pôde ser gravada e aguarda nova tentativa. |

---

## 4. Requisitos funcionais

Convenções:
- "O proprietário" é o único usuário.
- Valores em R$ com 2 casas decimais.
- Datas no formato dd/mm/aaaa, fuso America/Sao_Paulo.

### 4.1 Vendas (entradas)

#### FR-01: Registrar venda
O sistema deve permitir registrar uma venda com os campos abaixo.

| Campo | Regras |
|---|---|
| Data | Padrão: hoje. Datas futuras não são aceitas. O dia não pode estar fechado. |
| Aba | Obrigatória. Apenas abas ativas. |
| Forma de pagamento | Obrigatória. Apenas formas ativas. |
| Maquininha | Obrigatória para Débito e Crédito. Opcional para PIX (PIX pela maquininha). Não se aplica a Dinheiro e Boleto. |
| Parcelas | Apenas para Crédito, de 1 a 12. Padrão: 1. |
| Valor bruto | Obrigatório, maior que 0. |
| Observação | Opcional. |

Uma venda tem exatamente **uma aba e uma forma de pagamento**. Pagamento dividido e compra de várias abas são registrados como várias vendas.

- **Dado** que o dia 18/11/2026 está aberto e existe taxa cadastrada para Mercado Pago / Crédito / 3x
  **Quando** o proprietário registra uma venda de R$ 150,00 em "Toner", Crédito, Mercado Pago, 3x
  **Então** a venda é salva com o valor bruto, o percentual da taxa vigente, o valor da taxa e o valor líquido (RN-01 a RN-03), e aparece na aba "Toner" do dia.
- **Dado** um dia fechado
  **Quando** o proprietário tenta registrar uma venda nessa data
  **Então** o sistema bloqueia e informa que o dia precisa ser reaberto (FR-09).
- **Dado** que não existe taxa vigente para a combinação maquininha/forma/parcelas na data da venda
  **Quando** o proprietário tenta salvar
  **Então** o sistema bloqueia e mostra "Cadastre a taxa de <maquininha> / <forma> / <n>x antes de registrar esta venda", com atalho para a tabela de taxas.
- **Dado** a tela de lançamento aberta
  **Quando** o proprietário registra uma venda usando apenas o teclado (valor → aba → forma → Enter)
  **Então** a venda é salva e o formulário fica pronto para a próxima, mantendo a data. O fluxo deve permitir cumprir o CS-2 (≤ 10 s).

#### FR-02: Calcular taxa e valor líquido
O sistema deve calcular e **gravar na própria venda** o percentual aplicado, o valor da taxa e o valor líquido, segundo RN-01 a RN-03.
- **Dado** que a taxa Mercado Pago / Débito era 1,99% até 31/10 e passou a 1,49% em 01/11
  **Quando** uma venda de outubro é consultada ou editada
  **Então** ela mantém 1,99%. Mudanças posteriores na tabela de taxas nunca recalculam vendas já salvas, exceto se a própria venda for editada (FR-03), quando vale a taxa vigente na data da venda.

#### FR-03: Editar ou excluir venda em dia aberto
- **Dado** uma venda em um dia **aberto**
  **Quando** o proprietário altera um campo ou exclui a venda
  **Então** a alteração é aplicada, os totais são recalculados e um registro é gravado no log de auditoria (FR-18) com os valores antes e depois.
- **Dado** uma venda em um dia **fechado**
  **Quando** o proprietário tenta editá-la ou excluí-la
  **Então** o sistema bloqueia e sugere reabrir o dia ou registrar um estorno (FR-04).

#### FR-04: Registrar estorno
O sistema deve permitir estornar, total ou parcialmente, uma venda de um dia anterior.
- **Dado** uma venda de R$ 80,00 em 10/11 (dia fechado), Débito, PagSeguro
  **Quando** o proprietário seleciona a venda e registra um estorno de R$ 80,00 com o motivo "produto com defeito"
  **Então** é criado em **hoje** (dia aberto) um lançamento do tipo estorno com valor bruto −R$ 80,00, mesma aba, forma, maquininha e parcelas, taxa e líquido negativos proporcionais (RN-04), ligado à venda original. A venda original não muda.
- **Dado** uma venda de R$ 80,00 que já teve R$ 50,00 estornados
  **Quando** o proprietário tenta estornar mais R$ 40,00
  **Então** o sistema bloqueia (a soma dos estornos não pode passar do valor original).
- **Dado** um estorno em dinheiro
  **Quando** o caixa do dia é fechado
  **Então** o valor estornado reduz o dinheiro esperado (RN-07).
- O **motivo** é obrigatório.

#### FR-05: Ver o dia por aba
O sistema deve exibir, para a data selecionada, cada aba com:
- a lista de vendas e estornos;
- o subtotal de cada forma de pagamento (bruto, taxa, líquido);
- o total da aba;
- o **total do dia**.

- **Dado** vendas em 3 abas no dia
  **Quando** o proprietário abre o dia
  **Então** vê as 3 abas com seus totais por forma, e as abas sem movimento aparecem com total R$ 0,00 (podendo ser recolhidas).

### 4.2 Despesas e caixa

#### FR-06: Registrar despesa geral (saída diária)
| Campo | Regras |
|---|---|
| Data de pagamento | Padrão: hoje. Não pode cair em dia fechado. Datas futuras não são aceitas. |
| Categoria | Obrigatória. Apenas categorias de despesa geral ativas. |
| Descrição | Opcional. |
| Valor | Obrigatório, maior que 0. |
| Meio de pagamento | Dinheiro, PIX, Cartão, Boleto ou Transferência/Débito em conta. |
| Pago com dinheiro do caixa? | Só quando o meio é Dinheiro. Padrão: sim. |

- **Dado** o dia de hoje aberto
  **Quando** o proprietário lança R$ 45,00 em "Abastecimento moto", Dinheiro, pago do caixa
  **Então** a despesa aparece nas saídas do dia, entra no total de despesas gerais do mês (RN-08) e reduz o dinheiro esperado no fechamento (RN-07).
- **Dado** uma despesa paga por PIX
  **Quando** o caixa é fechado
  **Então** ela **não** afeta o dinheiro esperado.
- Edição e exclusão seguem as mesmas regras de FR-03, com registro na auditoria.

#### FR-07: Registrar sangria
- **Dado** o dia de hoje aberto
  **Quando** o proprietário registra uma sangria de R$ 300,00 com a observação "depósito no banco"
  **Então** a sangria reduz o dinheiro esperado do dia e **não** entra em despesas nem no saldo mensal.

#### FR-08: Fechar o dia (fechamento de caixa)
- **Dado** um dia aberto com movimento
  **Quando** o proprietário inicia o fechamento
  **Então** o sistema mostra:
  - troco inicial: pré-preenchido com o dinheiro contado no último fechamento, editável;
  - vendas em dinheiro do dia (líquidas de estornos);
  - despesas pagas do caixa;
  - sangrias;
  - **dinheiro esperado** (RN-07);
  - campo para o **dinheiro contado**.
- **Dado** que o proprietário informa o dinheiro contado e confirma
  **Quando** o fechamento é gravado
  **Então**:
  - o dia passa a **fechado**;
  - a **diferença** (RN-07) é gravada;
  - a exportação da **planilha diária** e a atualização da **planilha mensal** entram na fila (FR-28, FR-29);
  - um **backup do banco** é gerado (FR-31).
- **Dado** que a diferença é diferente de R$ 0,00
  **Quando** o fechamento é confirmado
  **Então** o sistema mostra a diferença em destaque (sobra ou falta), pede uma observação opcional e permite fechar mesmo assim.
- **Dado** o primeiro dia de uso do sistema
  **Quando** o proprietário fecha o dia
  **Então** o troco inicial vem vazio e deve ser digitado.

#### FR-09: Reabrir o dia
- **Dado** um dia fechado em um mês **aberto**
  **Quando** o proprietário escolhe "Reabrir dia", confirma e informa um motivo
  **Então** o dia volta a aberto, o fechamento anterior fica no log de auditoria, e um novo fechamento será exigido (FR-08), gerando de novo a planilha diária.
- **Dado** um dia de um mês **fechado**
  **Quando** o proprietário tenta reabri-lo
  **Então** o sistema informa que é preciso reabrir o mês antes (FR-17).

### 4.3 Despesas fixas

#### FR-10: Manter modelos de despesa fixa
O proprietário pode cadastrar, editar, desativar e reordenar **modelos** de despesa fixa:
- nome;
- grupo (Gerais ou Taxas governo);
- subgrupo opcional (ex.: Telefonia);
- dia de vencimento (1–31);
- valor previsto (opcional);
- ativo (sim/não);
- para Empréstimos: total de parcelas e parcelas restantes.

Carga inicial (ver RN-12):
- **Gerais:** Água, Luz, Aluguel, Contador, Funcionário, GPS, Seguro loja, Telefonia – Vivo fixo, Telefonia – Vivo móvel, Banco, Empréstimos.
- **Taxas governo:** DAS, DARE, DARF, TFE.

- **Dado** um modelo desativado
  **Quando** o próximo mês é gerado
  **Então** nenhum lançamento é criado para ele, e os lançamentos passados continuam nos relatórios.

#### FR-11: Gerar as despesas fixas do mês
- **Dado** que o mês M ainda não tem despesas fixas geradas
  **Quando** o sistema é aberto em qualquer dia do mês M
  **Então** é criado, para cada modelo ativo, um lançamento com:
  - mês de referência M;
  - vencimento no dia configurado (ou no último dia do mês, se o dia não existir);
  - valor previsto;
  - status **pendente**.
- **Dado** que o mês M já foi gerado
  **Quando** o sistema é aberto de novo
  **Então** nada é duplicado.
- **Dado** um modelo de Empréstimo com 0 parcelas restantes
  **Quando** o mês é gerado
  **Então** nenhum lançamento é criado, e o modelo é desativado automaticamente.
- O proprietário também pode **adicionar manualmente** um lançamento fixo avulso no mês.

#### FR-12: Pagar ou dispensar despesa fixa
- **Dado** a Luz de novembro pendente, com valor previsto R$ 200,00
  **Quando** o proprietário a marca como paga, informando valor R$ 187,43, data 10/11/2026 e meio de pagamento PIX
  **Então** o status vira **pago**, e o valor entra nas despesas fixas do mês **da data de pagamento** (RN-09).
- **Dado** que a conta de Luz de outubro é paga em 10/11
  **Quando** o resumo é consultado
  **Então** ela conta em **novembro** (regime de caixa), e o mês de referência outubro fica registrado.
- **Dado** um lançamento que não se aplica no mês (ex.: TFE fora do mês de cobrança)
  **Quando** o proprietário o marca como **dispensado**
  **Então** ele sai dos alertas e não entra em nenhum total.
- **Dado** uma despesa fixa paga em dinheiro do caixa
  **Quando** o caixa daquele dia é fechado
  **Então** ela reduz o dinheiro esperado (RN-07).
- A data de pagamento não pode cair em dia fechado.

#### FR-13: Controlar parcelas de empréstimo
- **Dado** um empréstimo com 10 parcelas restantes
  **Quando** o lançamento do mês é **pago**
  **Então** o número de parcelas restantes cai para 9, e o lançamento mostra "parcela n de N".

### 4.4 Cadastros

#### FR-14: Gerenciar categorias (abas de venda e categorias de despesa)
O proprietário pode **criar, renomear, desativar, reativar e reordenar** categorias. A **exclusão** só é permitida se a categoria nunca foi usada.
- **Dado** a aba "Serviços de copiadora" com vendas registradas
  **Quando** o proprietário a renomeia para "Cópias e impressões"
  **Então** todas as vendas, inclusive as antigas, aparecem sob o novo nome, e os totais históricos não mudam.
- **Dado** uma categoria com lançamentos
  **Quando** o proprietário tenta excluí-la
  **Então** o sistema bloqueia e oferece **desativar**.
- **Dado** uma categoria desativada
  **Quando** o proprietário registra uma venda ou despesa
  **Então** ela não aparece na lista, mas continua nos relatórios e exportações dos períodos em que teve movimento.
- **Dado** um nome já usado por outra categoria do mesmo tipo
  **Quando** o proprietário tenta criar ou renomear para esse nome
  **Então** o sistema bloqueia (sem diferenciar maiúsculas e minúsculas).

#### FR-15: Gerenciar maquininhas, formas de pagamento e tabela de taxas
- As maquininhas e formas de pagamento seguem as mesmas regras de FR-14.
- A **tabela de taxas** tem uma linha por maquininha × forma × faixa de parcelas, com percentual e "vigente desde".

- **Dado** a taxa PagSeguro / Crédito / 2–6x de 4,99% desde 01/01/2026
  **Quando** o proprietário cadastra 4,59% vigente desde 01/12/2026
  **Então** vendas até 30/11 usam 4,99%, e vendas a partir de 01/12 usam 4,59%.
- **Dado** que duas faixas de parcelas se sobrepõem para a mesma maquininha, forma e data
  **Quando** o proprietário tenta salvar
  **Então** o sistema bloqueia.
- **Dado** uma nova maquininha "Stone"
  **Quando** o proprietário a cadastra e informa suas taxas
  **Então** ela fica disponível no lançamento de vendas, sem mudança no código.

### 4.5 Fechamento do mês e auditoria

#### FR-16: Fechar o mês
- **Dado** que todos os dias **com movimento** do mês estão fechados
  **Quando** o proprietário fecha o mês e confirma
  **Então**:
  - o mês fica **fechado**, e nenhum dia, venda ou despesa do mês pode ser alterado;
  - a planilha mensal é gerada na versão final;
  - um backup do banco é feito.
- **Dado** algum dia com movimento ainda aberto
  **Quando** o proprietário tenta fechar o mês
  **Então** o sistema lista os dias pendentes e bloqueia.
- **Dado** despesas fixas ainda **pendentes** cujo mês de referência é o mês que está sendo fechado
  **Quando** o proprietário fecha o mês
  **Então** o sistema avisa, mas permite fechar. As despesas continuam pendentes e entrarão no mês em que forem pagas.

#### FR-17: Reabrir o mês
- **Dado** um mês fechado
  **Quando** o proprietário escolhe "Reabrir mês", confirma e informa um motivo
  **Então** o mês volta a aberto (os dias continuam fechados até serem reabertos um a um), e a ação vai para a auditoria.

#### FR-18: Log de auditoria
O sistema grava automaticamente as seguintes ações:
- criação, edição e exclusão de vendas, estornos, despesas e sangrias;
- fechamento e reabertura de dias e meses;
- mudanças em categorias, taxas, maquininhas e configurações;
- restauração de backup.

Cada registro tem: data e hora, entidade, ação, valores antes e depois, e motivo (quando houver).
- **Dado** que uma venda foi editada de R$ 50,00 para R$ 5,00
  **Quando** o proprietário consulta a auditoria filtrando por data ou tipo
  **Então** vê o registro com os dois valores.
- Registros de auditoria **não podem** ser editados nem excluídos pela interface.

### 4.6 Relatórios
Todas as telas de relatório têm seletor de data ou mês, mostram valores em R$ e **não exigem impressão**.

#### FR-19: Relatório do Dia
Mostra:
- a matriz **aba × forma de pagamento** com bruto, taxa e líquido;
- os totais por aba, por forma e do dia;
- as saídas do dia e as sangrias;
- os dados do fechamento de caixa (se fechado).
- **Dado** um dia fechado
  **Quando** o relatório é aberto
  **Então** todos os valores coincidem com a planilha diária exportada desse dia.

#### FR-20: Relatório Mês – Entradas
Mostra:
- uma grade **dias × abas** com o total bruto de cada aba em cada dia;
- os totais por aba no mês;
- os totais do mês **por forma de pagamento** (bruto, taxa, líquido);
- a **Entrada mensal** (bruta), o total de taxas e o líquido.
- **Dado** um mês com vendas em 20 dias
  **Quando** o relatório é aberto
  **Então** a soma da coluna de cada aba é igual ao total dessa aba no mês, e a soma das abas é igual à Entrada mensal.

#### FR-21: Relatório Mês – Despesas gerais
Mostra o total de cada categoria no mês (por data de pagamento), com os fornecedores agrupados em "Fornecedores de materiais", o subtotal do grupo e o **total geral**. Permite ver os lançamentos de cada categoria.

#### FR-22: Relatório Mês – Despesas fixas
Mostra cada item (agrupado em Gerais e Taxas governo) com:
- vencimento, valor previsto, valor pago, data de pagamento e status;
- o **total pago no mês** (por data de pagamento);
- o total ainda pendente (informativo, fora do saldo).

#### FR-23: Resumo mensal
Mostra:
- **Entrada mensal** (bruta);
- **(−) Taxas de maquininha**;
- **(−) Total despesas gerais**;
- **(−) Total despesas fixas**;
- **Total geral de despesas**;
- **Saldo mensal** (RN-10).
- **Dado** os relatórios FR-20 a FR-22 de um mês
  **Quando** o resumo é aberto
  **Então** cada linha é igual ao total correspondente nesses relatórios.

### 4.7 Dashboards

#### FR-24: Dashboard "Como está este mês comparado ao anterior?"
Mostra, para o mês atual **até hoje** e para o **mesmo período do mês anterior** (dia 1 até o mesmo dia do mês), os valores abaixo e a variação % de cada um (RN-11):
- Entrada mensal;
- Taxas;
- Total de despesas;
- Saldo.

O total do mês anterior completo aparece como referência.
- **Dado** o dia 18/11
  **Quando** o dashboard é aberto
  **Então** ele compara 01–18/11 com 01–18/10.
- **Dado** que o mês anterior não tem dados (primeiro mês de uso)
  **Quando** o dashboard é aberto
  **Então** a variação aparece como "—" com a nota "sem dados do mês anterior".

#### FR-25: Dashboard "Quais abas vendem mais?"
Mostra o ranking das abas pela entrada bruta no mês selecionado, com valor, % do total e variação em relação ao mesmo período do mês anterior.
- **Dado** um mês com vendas
  **Quando** o dashboard é aberto
  **Então** as abas aparecem em ordem decrescente de entrada bruta. "Mais lucrativas" significa **maior faturamento**, não margem (ver Q-11).

#### FR-26: Dashboard "Estou ganhando mais do que gasto?"
Gráfico diário de **entradas brutas × despesas** (gerais + fixas pagas) para os **últimos 7 ou 30 dias** (seletor), com os totais do período e a diferença.
- **Dado** que o proprietário escolhe "30 dias"
  **Quando** o gráfico é exibido
  **Então** os dias sem movimento aparecem como zero, e os totais do período batem com a soma das barras.

### 4.8 Tela inicial

#### FR-27: Alertas
A tela inicial mostra os alertas abaixo, cada um com link para resolver:

| Alerta | Condição |
|---|---|
| Conta a vencer | Despesa fixa pendente com vencimento entre hoje e hoje + 3 dias. |
| Conta vencida | Despesa fixa pendente com vencimento antes de hoje. |
| Dia não fechado | Dia anterior a hoje com movimento e status aberto. |
| Diferença de caixa | No último fechamento, \|diferença\| > limite configurado (**padrão R$ 0,00**, ou seja, qualquer diferença). |
| Backup pendente | Há exportação ou backup na fila com falha (ver §7). |

- **Dado** que não há nenhuma condição ativa
  **Quando** a tela inicial abre
  **Então** aparece "Tudo em dia".
- A tela inicial também oferece **atalhos** para registrar venda, registrar despesa e fechar o dia.

### 4.9 Exportação, backup e configuração

#### FR-28: Exportar a planilha diária
Gera `Diária AAAA-MM-DD.xlsx` (layout em §7.3) na pasta do OneDrive.
- **Dado** que um dia é fechado
  **Quando** a exportação roda
  **Então** o arquivo é criado, ou **sobrescrito** se já existir.
- **Dado** um dia reaberto e fechado de novo
  **Quando** a exportação roda
  **Então** o arquivo anterior é substituído pela versão corrigida.
- Dias sem movimento **não** geram arquivo.

#### FR-29: Exportar a planilha mensal
Gera ou atualiza `Mensal AAAA-MM.xlsx` cada vez que um dia do mês é fechado, e na versão final quando o mês é fechado.

#### FR-30: Fila de exportação e novas tentativas
- **Dado** que o arquivo está aberto no Excel, ou a pasta não existe
  **Quando** a exportação falha
  **Então**:
  - o pedido fica na fila com o erro;
  - o alerta "Backup pendente" aparece;
  - uma nova tentativa é feita a cada 5 minutos e ao abrir o sistema.
- **Dado** um pedido pendente
  **Quando** uma tentativa dá certo
  **Então** o pedido sai da fila e o alerta some.
- O proprietário pode forçar "Tentar agora".

#### FR-31: Backup do banco de dados
- **Dado** um fechamento de dia, um fechamento de mês, ou a primeira abertura do sistema no dia
  **Quando** o backup roda
  **Então** uma cópia consistente do banco é gravada em `<pasta>/_backup-sistema/`, e a política de retenção RN-13 é aplicada.
- Uma falha no backup segue a mesma fila e o mesmo alerta de FR-30.

#### FR-32: Restaurar backup
- **Dado** a lista de backups disponíveis (data e hora)
  **Quando** o proprietário escolhe um, confirma e informa um motivo
  **Então**:
  - o sistema salva antes uma cópia de segurança do banco atual;
  - substitui o banco pelo backup escolhido;
  - reinicia;
  - registra a restauração na auditoria.
- **Dado** um PC novo com o sistema recém-instalado
  **Quando** o proprietário aponta um arquivo de backup
  **Então** o sistema volta exatamente ao estado daquele backup.

#### FR-33: Configurações
- pasta do OneDrive (com botão "Testar": cria e apaga um arquivo de teste);
- limite do alerta de diferença de caixa (padrão R$ 0,00);
- antecedência do alerta de contas a vencer (padrão 3 dias).

- **Dado** uma pasta inexistente ou sem permissão de escrita
  **Quando** o proprietário clica em "Testar"
  **Então** o sistema mostra o erro de forma clara, em português.

#### FR-34: Instalação e inicialização
- **Dado** o PC ligado
  **Quando** o Windows inicia
  **Então** o sistema inicia em segundo plano, e o atalho na área de trabalho abre a interface no navegador.
- **Dado** que o PC está sem internet
  **Quando** o proprietário usa o sistema
  **Então** todas as funções operam normalmente, exceto a sincronização do OneDrive, que é feita pelo próprio aplicativo do OneDrive quando a conexão voltar.

---

## 5. Regras de negócio

**Valores monetários:** são armazenados em **centavos inteiros**, sem ponto flutuante. Todos os arredondamentos usam **meio para cima** (0,005 → 0,01), sempre por venda, nunca sobre totais.

**RN-01: Taxa vigente.** A taxa de uma venda é o registro da tabela de taxas que atende a todas as condições abaixo. Se não houver nenhum, a venda é bloqueada (FR-01).
- mesma maquininha e forma de pagamento;
- parcelas dentro da faixa;
- **maior "vigente desde" ≤ data da venda**.

**RN-02: Valor da taxa.** `taxa_valor = arredondar(valor_bruto × taxa_percentual ÷ 100; 2 casas)`. Para Dinheiro, Boleto e PIX sem maquininha, `taxa_percentual = 0` e `taxa_valor = 0`.

**RN-03: Valor líquido.** `valor_liquido = valor_bruto − taxa_valor`.
*Exemplo:* R$ 150,00 a 3,79% → taxa R$ 5,69 (5,685 arredondado), líquido R$ 144,31.

**RN-04: Estorno.**
- `valor_bruto_estorno = −valor_estornado`.
- O percentual é o mesmo da venda original.
- `taxa_valor_estorno = −arredondar(valor_estornado × taxa_percentual_original ÷ 100; 2)`.
- `líquido = bruto − taxa`.
- A soma dos estornos de uma venda não pode passar do valor bruto original.
- Premissa: a maquininha devolve a taxa proporcional (ver Q-04).

**RN-05: Totais do dia.**
- Total da aba, por forma = Σ (vendas + estornos) dessa aba e forma no dia, separadamente para bruto, taxa e líquido.
- Total da aba = Σ formas.
- Total do dia = Σ abas.

**RN-06: Totais do mês (entradas).**
- Entrada mensal = Σ valor_bruto de vendas e estornos com data no mês.
- Taxas do mês = Σ taxa_valor.
- Líquido do mês = Entrada mensal − Taxas do mês.

**RN-07: Fechamento de caixa.**
```
Dinheiro esperado = Troco inicial
                  + Σ vendas em Dinheiro do dia (estornos em dinheiro já negativos)
                  − Σ despesas (gerais e fixas) pagas em Dinheiro com "pago do caixa = sim" na data
                  − Σ sangrias do dia
Diferença = Dinheiro contado − Dinheiro esperado   (>0 sobra, <0 falta)
```

**RN-08: Despesas gerais do mês.** Σ valor das despesas do tipo geral cuja **data de pagamento** cai no mês. Cada despesa pertence a **exatamente uma categoria**, e as categorias são independentes (ex.: uma compra na Kalunga vai para "Kalunga" **ou** para "Acessórios", nunca para as duas).

**RN-09: Despesas fixas do mês.** Σ valor pago das despesas do tipo fixa com status **pago** e **data de pagamento** no mês (**regime de caixa**). Despesas pendentes e dispensadas não entram.

**RN-10: Totais e saldo mensal.**
```
Total geral de despesas = Despesas gerais do mês + Despesas fixas do mês
Saldo mensal = Entrada mensal (bruta) − Taxas do mês − Total geral de despesas
```
As sangrias **não** entram no saldo, porque são movimentação interna.

**RN-11: Variação percentual (dashboards).**
`variação = (atual − anterior) ÷ |anterior| × 100`, com 1 casa decimal. Se `anterior = 0`, mostrar "—".

**RN-12: Cadastros iniciais.**
- **Abas de venda (9):** Acessórios, Carimbos, Cartuchos compatíveis, Recargas, Papelaria, Chaveiro, Toner, Serviços de copiadora, Personalizados.
- **Formas de pagamento:** Dinheiro, Cartão de débito, Cartão de crédito, PIX/Depósito, Boleto bancário.
- **Maquininhas:** PagSeguro, Mercado Pago (taxas a preencher, ver Q-01).
- **Categorias de despesa geral:** Acessórios, Carimbos, Chaves, Despesas gerais (loja), Despesas moto, Abastecimento moto, Diversos, Alimentação.
  - **Grupo Fornecedores de materiais:** Casa Forte, Nova Supri, Canal Verde, Jandaia, Kalunga, Suzano, Outros fornecedores.
- **Modelos de despesa fixa:** conforme FR-10.

**RN-13: Retenção de backups do banco.**
- Guardar os backups dos **últimos 30 dias**, no máximo 1 por dia (o mais recente do dia).
- Guardar também o **último backup de cada mês**, sem limite de tempo.
- Apagar os demais.

**RN-14: Travamento.**
- Nenhum registro (venda, estorno, despesa, sangria) pode ser criado, editado ou excluído com data em dia fechado ou em mês fechado.
- Um dia só pode ser reaberto se o mês estiver aberto.
- O mês só pode ser fechado se todos os dias com movimento estiverem fechados.

**RN-15: Datas.**
- Não são aceitos lançamentos com data futura, com uma exceção: o vencimento de despesa fixa pode ser futuro.
- O "dia" é o dia civil em America/Sao_Paulo.

---

## 6. Modelo de dados (rascunho)

> Rascunho conceitual. Os nomes técnicos finais (em inglês) serão definidos na arquitetura.

### 6.1 Entidades

| Entidade | Atributos principais |
|---|---|
| **CategoriaVenda** (aba) | id, nome (único), ordem, ativa |
| **CategoriaDespesa** | id, nome (único), grupo (`Geral` \| `Fornecedores de materiais`), ordem, ativa |
| **FormaPagamento** | id, nome, uso_maquininha (`obrigatória` \| `opcional` \| `não se aplica`), permite_parcelas, ativa |
| **Maquininha** | id, nome, ativa |
| **TaxaMaquininha** | id, maquininha, forma_pagamento, parcelas_de, parcelas_até, percentual, vigente_desde |
| **Dia** | data (chave), status (`aberto` \| `fechado`), troco_inicial, dinheiro_esperado, dinheiro_contado, diferença, observação, fechado_em |
| **Mês** | ano_mês (chave), status (`aberto` \| `fechado`), despesas_fixas_geradas (sim/não), fechado_em |
| **Venda** | id, data, criada_em, tipo (`venda` \| `estorno`), categoria_venda, forma_pagamento, maquininha?, parcelas?, valor_bruto, taxa_percentual, taxa_valor, valor_líquido, venda_original? (só estorno), motivo? (obrigatório no estorno), observação |
| **ModeloDespesaFixa** | id, nome, grupo (`Gerais` \| `Taxas governo`), subgrupo?, dia_vencimento, valor_previsto?, ativo, ordem, parcelas_total?, parcelas_restantes? |
| **Despesa** | id, tipo (`geral` \| `fixa`), categoria_despesa? (geral), modelo_despesa_fixa? (fixa), descrição, mês_referência? (fixa), vencimento? (fixa), valor_previsto? (fixa), status (`pendente` \| `pago` \| `dispensado`; despesas gerais nascem `pago`), valor, data_pagamento, meio_pagamento, pago_do_caixa, parcela_número? |
| **Sangria** | id, data, valor, observação |
| **RegistroAuditoria** | id, quando, entidade, entidade_id, ação, antes, depois, motivo? |
| **ItemFilaExportação** | id, tipo (`planilha diária` \| `planilha mensal` \| `backup banco`), referência (data/mês), status (`pendente` \| `concluído` \| `falha`), tentativas, último_erro, criado_em, concluído_em |
| **Configuração** | chave, valor (pasta OneDrive, limite diferença de caixa, antecedência de alertas) |

### 6.2 Relacionamentos
```
CategoriaVenda  1 ──── N  Venda
FormaPagamento  1 ──── N  Venda
Maquininha      1 ──── N  Venda            (opcional na venda)
Venda           1 ──── N  Venda (estornos) (auto-relacionamento: venda_original)
Dia             1 ──── N  Venda | Despesa (por data_pagamento) | Sangria   (por data)
Mês             1 ──── N  Dia
Maquininha      1 ──── N  TaxaMaquininha  N ──── 1  FormaPagamento
CategoriaDespesa   1 ──── N  Despesa (tipo geral)
ModeloDespesaFixa  1 ──── N  Despesa (tipo fixa; no máximo 1 por mês de referência, exceto avulsas)
```

### 6.3 Observações
- As categorias são referenciadas por **id**, então renomear não quebra o histórico.
- A venda grava uma **cópia** do percentual e dos valores calculados, então mudar a tabela de taxas não altera o passado.
- O dinheiro esperado e a diferença são **gravados no fechamento**, como registro histórico. Se o dia for reaberto e fechado de novo, são recalculados.
- Os totais diários e mensais **não são armazenados**: são sempre calculados a partir dos lançamentos.

---

## 7. Integrações: OneDrive

### 7.1 Papel
- **Mão única: sistema → OneDrive.** O sistema **nunca lê** as planilhas. Alterações feitas nelas são ignoradas e podem ser sobrescritas.
- Finalidades:
  1. **Planilhas .xlsx legíveis**, para consulta humana caso o sistema falhe.
  2. **Cópias do banco**, para restaurar o sistema (FR-31, FR-32).
- **Não há** importação de planilhas antigas.
- **Mecanismo:** o sistema grava os arquivos na **pasta local do OneDrive** no PC, e o **aplicativo OneDrive para Windows** faz a sincronização. Não há integração com a API da Microsoft.

### 7.2 Estrutura de pastas e nomes
```
<pasta configurada>/
├── 2026/
│   ├── 11 - Novembro/
│   │   ├── Diária 2026-11-01.xlsx
│   │   ├── Diária 2026-11-03.xlsx
│   │   └── Mensal 2026-11.xlsx
│   └── 12 - Dezembro/ …
└── _backup-sistema/
    ├── color-2026-11-18_1903.db
    └── …
```

### 7.3 Layout das planilhas
**Diária AAAA-MM-DD.xlsx**
- **Uma aba por categoria de venda** com movimento no dia.
  - Linhas: hora, tipo (venda/estorno), forma, maquininha, parcelas, valor cheio, taxa %, taxa R$, valor real, observação.
  - No fim: subtotal por forma de pagamento (cheio/taxa/real) e total da aba.
- **Aba "Saídas":** despesas do dia (categoria, descrição, meio, do caixa?, valor), total, e sangrias.
- **Aba "Resumo do dia":** matriz aba × forma, total do dia, e fechamento de caixa (troco inicial, esperado, contado, diferença).

**Mensal AAAA-MM.xlsx**
- **Aba "Entradas":** grade dias × abas, totais por forma de pagamento, Entrada mensal, taxas, líquido.
- **Aba "Despesas gerais":** por categoria, com o grupo Fornecedores e o total.
- **Aba "Despesas fixas":** cada item com vencimento, valor pago, data de pagamento e status, e o total pago.
- **Aba "Resumo":** Total geral de despesas, Entrada mensal, Taxas, **Saldo mensal**.

**Formatos:**
- Moeda: R$ #.##0,00.
- Datas: dd/mm/aaaa.
- Os valores são gravados como **números**, não texto, para que somas manuais no Excel funcionem.

### 7.4 Tratamento de falhas
| Cenário | Comportamento |
|---|---|
| Arquivo aberto ou bloqueado no Excel | A gravação falha. O item fica na fila, aparece o alerta "Backup pendente", e há nova tentativa a cada 5 min. |
| Pasta inexistente, renomeada ou sem permissão | Mesmo comportamento. O alerta orienta a verificar a pasta em Configurações. |
| Sem internet | **Não é falha do sistema**: o arquivo é gravado localmente, e o OneDrive envia quando a conexão voltar. |
| Aplicativo OneDrive não instalado, deslogado ou com cota cheia | O sistema **não consegue detectar** (o arquivo é gravado localmente). Mitigação: verificar a configuração na implantação, e o proprietário deve conferir periodicamente o ícone do OneDrive (ver Q-07). |
| Queda de energia durante a gravação | Gravação **atômica**: escreve em arquivo temporário e depois renomeia, para nunca deixar uma planilha corrompida. O banco usa transações. |
| Disco do PC danificado | Restaurar o último backup do banco a partir do OneDrive em um PC novo (FR-32). Perda máxima: os lançamentos desde o último backup (no pior caso, os do dia corrente ainda não fechado). |

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| NFR-01 | Arquitetura | **Aplicação web local**: um servidor roda no PC, e a interface é acessada pelo navegador. O banco é **embutido, em um único arquivo** (ex.: SQLite). |
| NFR-02 | Plataforma | Windows 11. Inicia com o Windows e tem atalho na área de trabalho. Navegador: Edge ou Chrome atuais. |
| NFR-03 | Offline | 100% funcional **sem internet**. |
| NFR-04 | Desempenho | Salvar uma venda em < 1 s. Abrir qualquer relatório ou dashboard em < 2 s com 5 anos de dados. |
| NFR-05 | Usabilidade | Lançamento de venda totalmente operável pelo teclado. CS-2 (≤ 10 s por venda). Interface em **português (pt-BR)**, com R$ 1.234,56 e dd/mm/aaaa. |
| NFR-06 | Confiabilidade | Operações em transação. Nenhum dado perdido em queda de energia depois de uma operação confirmada. Exportações atômicas. |
| NFR-07 | Backup | Conforme FR-31 e RN-13. Restauração testada antes da implantação. |
| NFR-08 | Segurança | No MVP, o servidor aceita conexões **apenas do próprio PC** (localhost). Sem login (ver §2). |
| NFR-09 | Privacidade (LGPD) | **Nenhum dado de cliente** é armazenado (sem nome, CPF ou telefone). O único dado pessoal sensível é o valor do salário do funcionário, guardado só no PC e nos backups do OneDrive do proprietário. |
| NFR-10 | Custo | **R$ 0/mês**: sem hospedagem, serviços ou bibliotecas pagas. |
| NFR-11 | Manutenibilidade | Código e documentação técnica em **inglês**. Testes automatizados para todas as regras de negócio (RN-01 a RN-15). |
| NFR-12 | Precisão | Valores monetários em centavos inteiros. Os totais batem ao centavo (CS-3). |
| NFR-13 | Instalação | Instalação e atualização simples, feitas pelo desenvolvedor, sem exigir conhecimento técnico do proprietário. |

---

## 9. Escopo: MVP e fases futuras

### 9.1 MVP (Fase 1)
| Área | Requisitos |
|---|---|
| Vendas e estornos | FR-01 a FR-05 |
| Despesas gerais, sangria, fechamento de caixa | FR-06 a FR-09 |
| Despesas fixas (modelo, geração, pagamento, empréstimos) | FR-10 a FR-13 |
| Cadastros (categorias, maquininhas, formas, taxas) | FR-14, FR-15 |
| Fechamento/reabertura de mês e auditoria | FR-16 a FR-18 |
| 5 relatórios | FR-19 a FR-23 |
| 3 dashboards | FR-24 a FR-26 |
| Alertas | FR-27 |
| Exportação OneDrive, backup e restauração | FR-28 a FR-32 |
| Configurações e instalação | FR-33, FR-34 |

### 9.2 Fase 2: acesso pelo celular (somente leitura)
- Primeiro pela **rede Wi-Fi da loja** (endereço do PC na rede local).
- Depois **de fora da loja**, por um túnel/VPN gratuito (ex.: Tailscale ou Cloudflare Tunnel, a avaliar).
- Exige **senha**. Custo zero.

### 9.3 Fase 3: análises adicionais
- Dashboards extras: taxas pagas por maquininha (comparação PagSeguro × Mercado Pago), distribuição por forma de pagamento, evolução do saldo, vendas por dia da semana, projeção do saldo do mês.
- **Recebíveis:** quando o dinheiro do cartão realmente cai na conta (D+1, D+30, parcelas) e antecipação.
- **Visão por competência**, para o contador.

### 9.4 Fora do escopo
- Controle de estoque e custo por aba (margem por linha de produto).
- Cadastro de clientes, vendas a prazo e fiado (ver Q-10).
- Emissão de nota fiscal e integração com maquininhas, bancos ou contador.
- Vários usuários, perfis e permissões. Várias lojas.
- Importação das planilhas antigas.
- Leitura de alterações feitas nas planilhas do OneDrive.

### 9.5 Implantação
1. Antes da implantação:
   - cadastrar as taxas atuais (Q-01);
   - cadastrar os modelos de despesa fixa com dias de vencimento (Q-05, Q-06);
   - configurar a pasta do OneDrive;
   - testar o backup e a restauração.
2. **Entrar em uso no dia 1º de um mês.**
3. Informar à mão o troco inicial do primeiro dia.
4. **Período paralelo de 2 semanas:** o proprietário mantém a planilha atual, e os totais diários são comparados todos os dias (CS-3).
5. Depois do período paralelo, o Excel manual é abandonado, e as planilhas geradas pelo sistema passam a ser o backup.

---

## 10. Questões em aberto para o proprietário

| # | Questão | Impacto | Premissa até a resposta |
|---|---|---|---|
| Q-01 | Quais são as **taxas atuais** da PagSeguro e da Mercado Pago, por forma (débito, crédito à vista, crédito 2–12x, PIX pela maquininha)? Há tarifa fixa por transação, além do %? | Sem elas não é possível registrar vendas no cartão (RN-01). | Bloqueio até o cadastro. Apenas taxa %. |
| Q-02 | O senhor usa **antecipação** de recebíveis? | Muda a taxa efetiva. | Não usa. Se usar, a antecipação entra embutida no % cadastrado. |
| Q-03 | **PIX:** o cliente paga pela maquininha (com taxa), direto na conta (sem taxa), ou os dois? **Boleto:** quem emite, há tarifa, e o boleto conta na data da venda ou na data do pagamento? | Taxa e data da entrada. | PIX: as duas opções, com maquininha opcional. Boleto: sem taxa e contado na data da venda. |
| Q-04 | Quando a venda no cartão é **estornada**, a maquininha devolve a taxa? | Valor líquido do estorno (RN-04). | Devolve proporcionalmente. |
| Q-05 | Quais despesas fixas são realmente **mensais**, e qual o **dia de vencimento** de cada uma? (TFE, por exemplo, costuma ser anual.) "Telefonia" inclui algo além de Vivo fixo e Vivo móvel? | Geração do mês e alertas (FR-11). | Todas mensais. As que não se aplicam no mês são marcadas como "dispensado". |
| Q-06 | Quantos **empréstimos** estão ativos, com quantas parcelas restantes e qual o valor? | Carga inicial (FR-13). | Cadastro na implantação. |
| Q-07 | O PC da loja tem o **aplicativo OneDrive** instalado e conectado à conta certa? Qual pasta usar? Há espaço livre na conta? | Sem isso não há backup fora do PC. | Verificação obrigatória na implantação. |
| Q-08 | Existe **suprimento** de caixa (colocar dinheiro no caixa durante o dia, além do troco inicial)? | Fórmula do caixa (RN-07). | Não existe. |
| Q-09 | Em "Personalizados", há **sinal** (adiantamento) e restante pago depois? | Como registrar. | Cada pagamento é registrado como uma venda na data em que é recebido. |
| Q-10 | Existe venda **a prazo / fiado** (cliente leva e paga depois)? | Precisaria de contas a receber. | Não existe (fora do escopo). |
| Q-11 | Ao pedir "abas mais lucrativas", o senhor aceita ver **as que mais faturam**? Lucro por aba exigiria ligar compras às abas, o que contradiz a regra de categorias independentes. | Dashboard FR-25. | Ranking por faturamento. |

---

## 11. Premissas adotadas

| # | Premissa | Origem |
|---|---|---|
| A-01 | "CHAVEIRO" duplicado no documento é erro de digitação. Há uma única aba "Chaveiro". | Entrevista (Q15) |
| A-02 | Uma venda = uma aba + uma forma de pagamento. Pagamento dividido = várias vendas. | Entrevista (Q4) |
| A-03 | A taxa é calculada e arredondada **por venda** (meio para cima, 2 casas). | Analista |
| A-04 | As entradas contam na **data da venda**. O recebimento real do cartão fica fora do MVP. | Entrevista (Q6) |
| A-05 | O saldo usa **entradas brutas menos taxas** (fórmula RN-10). | Entrevista (Q6) |
| A-06 | As despesas contam pela **data de pagamento** (regime de caixa). | Entrevista (Q12) |
| A-07 | "Saídas diárias" e "Despesas gerais" são o mesmo cadastro, então não há dupla contagem. | Entrevista (Q10) |
| A-08 | As categorias de despesa são independentes. Cada despesa tem exatamente uma categoria. | Entrevista (Q11) |
| A-09 | Usuário único, sem login no PC. A conta do Windows protege o acesso. | Entrevista (Q13) |
| A-10 | O sistema é a única fonte da verdade. OneDrive tem mão única, via pasta local sincronizada. | Entrevista (Q16, Q17) |
| A-11 | Uma única loja, um único PC, um usuário por vez. | Entrevista (Q2, Q3) |
| A-12 | O troco inicial é pré-preenchido com o dinheiro contado no fechamento anterior e pode ser editado. | Analista |
| A-13 | O dashboard "mês atual × anterior" compara **o mesmo intervalo de dias** (1 até o dia de hoje). | Analista |
| A-14 | Os meios de pagamento de **despesas** (Dinheiro, PIX, Cartão, Boleto, Transferência/Débito em conta) são uma lista fixa, não cadastrável, no MVP. | Analista |
| A-15 | Dias sem movimento não precisam ser fechados e não geram planilha diária. | Analista |
| A-16 | Lançamentos com data em dia fechado exigem reabrir o dia. Isso vale também para despesas fixas pagas por banco. | Analista |
| A-17 | O alerta de diferença de caixa dispara com qualquer diferença (\|diferença\| > R$ 0,00). | Entrevista |
| A-18 | O aplicativo OneDrive para Windows está instalado e sincronizando no PC da loja (a confirmar em Q-07). | Entrevista (Q17) |
