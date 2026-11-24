# Restaurar um backup do banco

> Quem executa: o proprietário (pela tela) ou o desenvolvedor.
> Use a **restauração pela tela** (#22, FR-32). O **passo a passo manual** abaixo dela fica
> só para quando o sistema não abre.

## Pela tela (recomendado)

1. Abra **Configurações** (Alt+9) › **Backup e restauração**.
2. Na lista **Backups disponíveis**, escolha o backup mais recente antes do problema (data e hora; origem "OneDrive" ou "Este PC") e clique em **Restaurar**.
3. Leia o aviso, digite o **motivo** e tecle **Enter** (Esc cancela).
4. O sistema salva antes uma **cópia de segurança do banco atual** (em "Este PC"), troca o banco e reinicia sozinho. Aguarde a mensagem "Backup de dd/mm/aaaa hh:mm restaurado.".
5. Confira o Relatório do Dia do último dia fechado. Se escolheu o backup errado, restaure a **cópia de segurança** (a linha "Este PC" com a hora da restauração).

**PC novo (sistema recém-instalado):** em **Restaurar de um arquivo**, escolha o arquivo `color-AAAA-MM-DD_HHMM.db` da pasta `_backup-sistema` do OneDrive (se o OneDrive mostrar uma nuvem no arquivo, abra a pasta e espere baixar), digite o motivo e tecle **Enter**. Depois confira a pasta do OneDrive em **Configurações** e clique em **Testar** (o caminho pode ser outro no PC novo).

A restauração fica registrada na **Auditoria** (tipo "Backup", ação "Restauração", com o motivo).

## Passo a passo manual (quando o sistema não abre)

## Onde estão os backups

| Pasta | Quando é gravado |
|---|---|
| `<pasta do OneDrive>\_backup-sistema\` | A cada fechamento de dia e na primeira abertura do sistema no dia. |
| `%LOCALAPPDATA%\ColorBMS\data\backups\` | Antes de cada atualização que muda o banco (migração). |

O nome do arquivo diz a data e a hora (horário de São Paulo): `color-2026-11-18_1903.db` = 18/11/2026 às 19:03.
Arquivos terminados em `.tmp` são gravações interrompidas: **não use**.

## Passo a passo

1. **Feche o sistema.** Feche a janela do sistema e dê dois cliques em `parar.cmd`, na pasta `%LOCALAPPDATA%\ColorBMS` (com o instalador, #24: Menu Iniciar › Sistema Color › Parar o Sistema Color). (Não finalize o `node` no Gerenciador de Tarefas: ele seria reiniciado sozinho em poucos segundos.)
2. **Abra a pasta de dados:** tecle `Win + R`, digite `%LOCALAPPDATA%\ColorBMS\data` e tecle Enter. (Antes do início do uso real, a pasta é `data-treino`.)
3. **Guarde o banco atual** (para poder voltar atrás): crie a pasta `antes-da-restauracao` e **mova** para ela os arquivos `color.db`, `color.db-wal` e `color.db-shm` (os dois últimos podem não existir).
4. **Copie o backup escolhido** para a pasta de dados e **renomeie** a cópia para `color.db`.
   - Escolha o backup mais recente antes do problema. Se o OneDrive mostrar o arquivo com uma nuvem, abra-o uma vez (ou "Sempre manter neste dispositivo") para baixá-lo antes de copiar.
5. **Inicie o sistema:** dê dois cliques em `iniciar.cmd` (na mesma pasta, ou Menu Iniciar › Sistema Color › Iniciar o Sistema Color), que abre a tela Início.
6. **Confira:** em Início, o status deve aparecer como "Conectado". A pasta do OneDrive volta junto com o banco: confira-a em **Configurações** e clique em **Testar** (num PC novo, o caminho pode ser outro). Abra o Relatório do Dia do último dia fechado e compare os totais com o esperado.
7. Se algo der errado, feche o sistema, apague o `color.db` restaurado e mova de volta os arquivos da pasta `antes-da-restauracao`.

## Teste antes da implantação (NFR-07)

Fazer **uma vez no PC da loja**, antes do go-live (#27). Desde o #22, a restauração do teste pode ser feita **pela tela** (seção acima); repita uma vez também pelo passo a passo manual:

- [ ] Em **Configurações** (Alt+9), conferir a **Pasta do OneDrive** e clicar em **Testar**: deve aparecer "Pasta OK". Início não deve mostrar "Pasta do OneDrive não configurada".
- [ ] Registrar uma venda de teste, fechar o dia e ver o arquivo novo em `_backup-sistema\`.
- [ ] Registrar uma segunda venda de teste (sem fechar).
- [ ] Restaurar o backup pelo passo a passo acima.
- [ ] Conferir que a primeira venda está lá e a segunda não.
- [ ] Desfazer o teste (o reset do go-live, #27, apaga os dados de teste).

Data do teste: ___/___/______ · Resultado: ______________________
