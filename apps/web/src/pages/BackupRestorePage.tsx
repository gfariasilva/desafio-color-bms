import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import {
  BACKUP_SOURCE_LABELS,
  formatCivilDate,
  formatFileSize,
  formatInstant,
  type BackupFile,
  type BackupUploadResponse,
} from "@color-bms/core";
import { RestoreConfirmCard } from "@/components/backup/RestoreConfirmCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, QUERY_KEYS } from "@/lib/api";

/** FR-32: how often the page asks whether the server is back after a restore. */
const RESTART_POLL_MS = 1000;
/** After this long without the server, the page says how to start it again. */
const RESTART_TIMEOUT_MS = 90_000;

/** What the confirmation card is about: a backup of the list, or an uploaded file. */
type Target =
  { kind: "list"; backup: BackupFile } | { kind: "upload"; upload: BackupUploadResponse };

const keyOf = (backup: BackupFile) => `${backup.source}:${backup.name}`;
const whenOf = (backup: BackupFile) => `${formatCivilDate(backup.date)} ${backup.time}`;

function describeTarget(target: Target): { what: string; backupAt: string | null } {
  if (target.kind === "list") {
    const label = BACKUP_SOURCE_LABELS[target.backup.source];
    return {
      what: `o backup de ${whenOf(target.backup)} (${label})`,
      backupAt: whenOf(target.backup),
    };
  }
  const at = target.upload.at ? formatInstant(target.upload.at) : null;
  return { what: `o arquivo ${target.upload.name}`, backupAt: at };
}

/**
 * Configurações › Backup e restauração (FR-31, FR-32): the automatic backup's state, the
 * backups on OneDrive and on this PC with a "Restaurar" button each, and "Restaurar de um
 * arquivo" for a new PC. A restore asks "Tem certeza?" with a reason, then the server
 * restarts: the page waits for it (a new `startId`) and shows the result.
 */
export function BackupRestorePage({ restartPollMs = RESTART_POLL_MS }: { restartPollMs?: number }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: QUERY_KEYS.backupStatus, queryFn: api.backupStatus });
  const files = useQuery({ queryKey: QUERY_KEYS.backupFiles, queryFn: api.backupFiles });

  const [target, setTarget] = useState<Target | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Set while the server restarts: the start id of the server that is stopping. */
  const [restartingFrom, setRestartingFrom] = useState<string | null>(null);
  const [restartTimedOut, setRestartTimedOut] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Where focus goes back when the confirmation is cancelled. */
  const returnFocus = useRef<HTMLElement | null>(null);

  // FR-32 "reinicia": wait for the new server, then reload every query from it.
  useEffect(() => {
    if (restartingFrom === null) return;
    let stopped = false;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > RESTART_TIMEOUT_MS) setRestartTimedOut(true);
      api
        .backupStatus()
        .then(async (answer) => {
          if (stopped || answer.startId === restartingFrom) return;
          stopped = true;
          clearInterval(timer);
          await queryClient.resetQueries();
          setRestartingFrom(null);
          setRestartTimedOut(false);
          setTarget(null);
        })
        // The server is down while it restarts: keep asking.
        .catch(() => {});
    }, restartPollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [restartingFrom, restartPollMs, queryClient]);

  function openFor(next: Target, from: HTMLElement | null) {
    returnFocus.current = from;
    setTarget(next);
  }

  function cancel() {
    setTarget(null);
    returnFocus.current?.focus();
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // The same file can be chosen again after a refusal.
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    setTarget(null);
    setUploading(true);
    try {
      const uploaded = await api.uploadBackup(file);
      openFor({ kind: "upload", upload: uploaded }, fileInput.current);
    } catch (failure) {
      setUploadError(
        failure instanceof Error ? failure.message : "Não foi possível enviar o arquivo.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function confirm(reason: string) {
    if (!target) return;
    const answer = await api.restoreBackup(
      target.kind === "list"
        ? { source: target.backup.source, name: target.backup.name, reason }
        : { source: "upload", reason },
    );
    setRestartingFrom(answer.startId);
  }

  const lastRestore = status.data?.lastRestore ?? null;
  const backups = files.data?.backups ?? [];

  if (restartingFrom !== null) {
    return (
      <>
        <PageHeader title="Backup e restauração" />
        <p role="status" className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 animate-spin" aria-hidden />
          Restaurando o backup: o sistema está reiniciando. Aguarde, não feche esta janela.
        </p>
        {restartTimedOut ? (
          <p role="alert" className="mt-2 text-destructive">
            O sistema ainda não voltou. Feche o navegador e abra o sistema de novo pelo atalho da
            área de trabalho.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Backup e restauração"
        description="Cópias do banco de dados no OneDrive e neste PC. Restaurar volta o sistema ao estado de um backup."
      />
      <p className="-mt-3 mb-4">
        <Link to="/configuracoes" className="text-primary underline-offset-4 hover:underline">
          ← Configurações
        </Link>
      </p>

      {lastRestore ? (
        <p
          role={lastRestore.ok ? "status" : "alert"}
          className={`mb-4 flex items-start gap-2 ${lastRestore.ok ? "" : "text-destructive"}`}
        >
          {lastRestore.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-rainbow-green" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{lastRestore.message}</span>
        </p>
      ) : null}

      <Card className="mb-4 max-w-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Backup automático</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Pasta</dt>
            <dd className="break-words">
              {status.data?.folder ?? (
                <>
                  Não configurada.{" "}
                  <Link
                    to="/configuracoes"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Configurar
                  </Link>
                </>
              )}
            </dd>
            <dt className="text-muted-foreground">Último backup</dt>
            <dd>
              {status.data?.lastSuccess ? formatInstant(status.data.lastSuccess.at) : "Nenhum"}
            </dd>
          </dl>
          <p className="text-sm text-muted-foreground">
            Um backup é gravado a cada fechamento de dia e de mês, e na primeira abertura do sistema
            no dia. Ficam os dos últimos 30 dias (o mais recente de cada dia) e o último de cada
            mês. Uma falha aparece em Início como &quot;Backup pendente&quot;.
          </p>
        </CardContent>
      </Card>

      {target ? (
        <RestoreConfirmCard
          key={target.kind === "list" ? keyOf(target.backup) : `upload:${target.upload.name}`}
          {...describeTarget(target)}
          onConfirm={confirm}
          onCancel={cancel}
        />
      ) : null}

      <section aria-labelledby="backups-title" className="mb-6 max-w-2xl">
        <h2 id="backups-title" className="mb-2 font-semibold">
          Backups disponíveis
        </h2>
        {files.isLoading ? <p className="text-muted-foreground">Carregando…</p> : null}
        {files.isError ? (
          <p role="alert" className="text-destructive">
            Não foi possível ler a lista de backups. Recarregue a página.
          </p>
        ) : null}
        {files.data && backups.length === 0 ? (
          <p className="text-muted-foreground">Nenhum backup encontrado.</p>
        ) : null}
        {backups.length > 0 ? (
          <Table aria-label="Backups disponíveis">
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Tamanho</TableHead>
                <TableHead>
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((backup) => {
                const key = keyOf(backup);
                const selected = target?.kind === "list" && keyOf(target.backup) === key;
                return (
                  <TableRow key={key} className={selected ? "bg-muted" : undefined}>
                    <TableCell>{formatCivilDate(backup.date)}</TableCell>
                    <TableCell>{backup.time}</TableCell>
                    <TableCell>{BACKUP_SOURCE_LABELS[backup.source]}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {formatFileSize(backup.sizeBytes)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Restaurar o backup de ${whenOf(backup)} (${BACKUP_SOURCE_LABELS[backup.source]})`}
                        onClick={(event) => openFor({ kind: "list", backup }, event.currentTarget)}
                      >
                        Restaurar
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
        {files.data ? (
          <p className="mt-2 text-sm text-muted-foreground break-words">
            OneDrive: {files.data.oneDriveFolder ?? "pasta não configurada"} · Este PC:{" "}
            {files.data.localFolder} (cópias feitas antes de cada atualização e antes de cada
            restauração).
          </p>
        ) : null}
      </section>

      <section aria-labelledby="restore-file-title" className="max-w-2xl">
        <h2 id="restore-file-title" className="mb-1 font-semibold">
          Restaurar de um arquivo
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">
          Para um PC novo: escolha um arquivo <code>color-AAAA-MM-DD_HHMM.db</code> da pasta{" "}
          <code>_backup-sistema</code> do OneDrive.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="restore-file">Arquivo de backup (.db)</Label>
          <Input
            id="restore-file"
            ref={fileInput}
            type="file"
            accept=".db"
            disabled={uploading}
            onChange={(event) => void upload(event)}
            className="max-w-md"
          />
        </div>
        {uploading ? (
          <p role="status" className="mt-2 text-sm">
            Verificando o arquivo…
          </p>
        ) : null}
        {uploadError ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {uploadError}
          </p>
        ) : null}
      </section>
    </>
  );
}
