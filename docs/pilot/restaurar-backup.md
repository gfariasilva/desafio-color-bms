# Restaurar um backup do banco (piloto)

> Procedimento manual do piloto (#25). A restauração pela tela vem com o item #22 (FR-32).
> Quem executa: o desenvolvedor, ou o proprietário seguindo este passo a passo.

## Onde estão os backups

| Pasta | Quando é gravado |
|---|---|
| `<pasta do OneDrive>\_backup-sistema\` | A cada fechamento de dia e na primeira abertura do sistema no dia. |
| `%LOCALAPPDATA%\ColorBMS\data\backups\` | Antes de cada atualização que muda o banco (migração). |

O nome do arquivo diz a data e a hora (horário de São Paulo): `color-2026-11-18_1903.db` = 18/11/2026 às 19:03.
Arquivos terminados em `.tmp` são gravações interrompidas: **não use**.

## Passo a passo

1. **Feche o sistema.** Feche a aba do navegador e encerre o servidor (no piloto: feche a janela do servidor, ou finalize o processo `node` no Gerenciador de Tarefas).
2. **Abra a pasta de dados:** tecle `Win + R`, digite `%LOCALAPPDATA%\ColorBMS\data` e tecle Enter.
3. **Guarde o banco atual** (para poder voltar atrás): crie a pasta `antes-da-restauracao` e **mova** para ela os arquivos `color.db`, `color.db-wal` e `color.db-shm` (os dois últimos podem não existir).
4. **Copie o backup escolhido** para a pasta de dados e **renomeie** a cópia para `color.db`.
   - Escolha o backup mais recente antes do problema. Se o OneDrive mostrar o arquivo com uma nuvem, abra-o uma vez (ou "Sempre manter neste dispositivo") para baixá-lo antes de copiar.
5. **Inicie o sistema** e abra `http://127.0.0.1:3210`.
6. **Confira:** em Início, o status deve aparecer como "Conectado". Abra o Relatório do Dia do último dia fechado e compare os totais com o esperado.
7. Se algo der errado, feche o sistema, apague o `color.db` restaurado e mova de volta os arquivos da pasta `antes-da-restauracao`.

## Teste antes da implantação (NFR-07)

Fazer **uma vez no PC da loja**, antes do go-live (#27):

- [ ] Configurar a pasta do OneDrive (`config.json` na pasta de dados) e reiniciar o sistema. Exemplo de `config.json` (no JSON, cada `\` do caminho é escrita **dobrada**, `\\`, ou use `/`):

  ```json
  { "oneDriveFolder": "C:\\Users\\dono\\OneDrive\\Color" }
  ```

  Depois de reiniciar, Início não deve mostrar "Pasta do OneDrive não configurada".
- [ ] Registrar uma venda de teste, fechar o dia e ver o arquivo novo em `_backup-sistema\`.
- [ ] Registrar uma segunda venda de teste (sem fechar).
- [ ] Restaurar o backup pelo passo a passo acima.
- [ ] Conferir que a primeira venda está lá e a segunda não.
- [ ] Desfazer o teste (o reset do go-live, #27, apaga os dados de teste).

Data do teste: ___/___/______ · Resultado: ______________________
