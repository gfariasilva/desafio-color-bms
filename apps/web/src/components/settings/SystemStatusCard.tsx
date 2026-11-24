import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { formatInstant, type StartupCheck } from "@color-bms/core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, QUERY_KEYS } from "@/lib/api";

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

/**
 * Configurações › Status do sistema (moved from Início by #23): version, database, server
 * time, the last backup (#25) and the startup checks (#26). Checks in error are also alerts on
 * Início (FR-27).
 */
export function SystemStatusCard() {
  const health = useQuery({ queryKey: QUERY_KEYS.health, queryFn: api.health });
  const backup = useQuery({ queryKey: QUERY_KEYS.backupStatus, queryFn: api.backupStatus });

  return (
    <section aria-labelledby="system-status-title" className="max-w-xl">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
          <CardTitle id="system-status-title" className="text-base">
            Status do sistema
          </CardTitle>
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
    </section>
  );
}
