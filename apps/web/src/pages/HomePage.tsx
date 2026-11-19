import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, DatabaseBackup, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatCivilDate, formatInstant, type StartupCheck } from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ITEMS } from "@/config/navigation";
import { api, QUERY_KEYS } from "@/lib/api";

const home = NAV_ITEMS[0];

/**
 * #25: the pilot backup's notices. A failure shows "Backup pendente" (the FR-27 alert name)
 * with the reason; a missing OneDrive folder is a warning. #23 folds them into the alert list.
 */
function BackupNotices() {
  const status = useQuery({ queryKey: QUERY_KEYS.backupStatus, queryFn: api.backupStatus });
  // #26: trial mode never backs up, whatever the folder: no "configure it" prompt then.
  const health = useQuery({ queryKey: QUERY_KEYS.health, queryFn: api.health });
  if (status.isError) {
    return <p className="mb-2 text-destructive">Não foi possível verificar o backup.</p>;
  }
  if (!status.data) return null;
  const { configured, lastFailure } = status.data;
  if (!configured && health.data?.trial) {
    return <p className="mb-2 text-muted-foreground">Modo treino: sem backup no OneDrive.</p>;
  }
  if (!configured) {
    return (
      <p className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-rainbow-orange" aria-hidden />
        <span>Pasta do OneDrive não configurada: os backups não estão sendo gravados.</span>
        {/* FR-27: each alert links to where it is fixed (FR-33, Configurações). */}
        <Link
          to="/configuracoes"
          className="rounded-md px-2 py-1 font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Configurar
        </Link>
      </p>
    );
  }
  if (!lastFailure) return null;
  return (
    <p className="mb-2 flex items-start gap-2 text-destructive">
      <DatabaseBackup className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <strong>Backup pendente:</strong> {lastFailure.message}. Tentativa em{" "}
        {formatInstant(lastFailure.at)}. Nova tentativa no próximo fechamento do dia ou ao reiniciar
        o sistema.
      </span>
    </p>
  );
}

/**
 * FR-27 (pilot slice): the "Dia não fechado" alert: earlier days with movement still open, each
 * with a link to close it, and the backup notices (#25). The other alerts and "Tudo em dia"
 * come in #23.
 */
function AlertsCard() {
  const unclosed = useQuery({
    queryKey: QUERY_KEYS.unclosedDays,
    queryFn: api.cashClosing.unclosed,
  });

  return (
    <section aria-labelledby="alerts-title" className="mb-4 max-w-xl">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle id="alerts-title" className="text-base">
            Alertas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <BackupNotices />
          {unclosed.isPending ? <p className="text-muted-foreground">Verificando…</p> : null}
          {unclosed.isError ? (
            <p className="text-destructive">Não foi possível verificar os alertas.</p>
          ) : null}
          {unclosed.data?.length === 0 ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-rainbow-green" aria-hidden />
              Nenhum dia anterior pendente de fechamento.
            </p>
          ) : null}
          {unclosed.data && unclosed.data.length > 0 ? (
            <ul className="divide-y">
              {unclosed.data.map((date) => (
                <li key={date} className="flex min-h-9 items-center justify-between gap-3 py-1">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rainbow-orange" aria-hidden />
                    Dia {formatCivilDate(date)} não fechado
                  </span>
                  <Link
                    to={`/fechamento?data=${date}`}
                    aria-label={`Fechar o dia ${formatCivilDate(date)}`}
                    className="rounded-md px-2 py-1 font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Fechar
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

const CHECK_STATUS = {
  ok: { label: "OK", Icon: CheckCircle2, className: "text-rainbow-green" },
  warning: { label: "Atenção", Icon: AlertTriangle, className: "text-rainbow-orange" },
  error: { label: "Erro", Icon: XCircle, className: "text-destructive" },
} as const;

/**
 * #26: the server's startup checks (time zone, clock, port, data and OneDrive folders), one
 * line each, with an icon and a text label (color alone is not enough).
 */
function StartupChecks({ checks }: { checks: StartupCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <ul aria-label="Verificações" className="mt-3 space-y-1 border-t pt-3">
      {checks.map((check) => {
        const { label, Icon, className } = CHECK_STATUS[check.status];
        return (
          <li
            key={check.id}
            className={`flex items-start gap-2 ${check.status === "error" ? "text-destructive" : ""}`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-hidden />
            <span className="break-words">
              <span className="sr-only">{label}: </span>
              {check.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Início: the alerts (FR-27, pilot slice) and the system status. */
export function HomePage() {
  const health = useQuery({ queryKey: QUERY_KEYS.health, queryFn: api.health });
  const backup = useQuery({ queryKey: QUERY_KEYS.backupStatus, queryFn: api.backupStatus });

  return (
    <>
      <PageHeader title={home?.label ?? "Início"} description={home?.description} />

      <AlertsCard />

      <Card className="max-w-xl">
        <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
          <CardTitle className="text-base">Status do sistema</CardTitle>
          {health.isPending && <Badge variant="secondary">Verificando…</Badge>}
          {health.isSuccess && <Badge variant="success">Conectado</Badge>}
          {health.isError && <Badge variant="destructive">Sem conexão</Badge>}
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {health.isSuccess && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <dt className="text-muted-foreground">Versão</dt>
              <dd>{health.data.version}</dd>
              <dt className="text-muted-foreground">Banco de dados</dt>
              <dd>
                SQLite {health.data.db.sqliteVersion} ({health.data.db.journalMode.toUpperCase()})
              </dd>
              <dt className="text-muted-foreground">Hora do servidor</dt>
              <dd className="tabular-nums">{formatInstant(health.data.serverTime)}</dd>
              {/* #25: when the newest backup in the OneDrive folder was made. */}
              {backup.data?.configured && (
                <>
                  <dt className="text-muted-foreground">Último backup</dt>
                  <dd className="tabular-nums">
                    {backup.data.lastSuccess ? formatInstant(backup.data.lastSuccess.at) : "Nenhum"}
                  </dd>
                </>
              )}
            </dl>
          )}
          {health.isSuccess && <StartupChecks checks={health.data.checks} />}
          {health.isError && (
            <p className="text-destructive">
              Não foi possível falar com o servidor. Verifique se o sistema está em execução.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
