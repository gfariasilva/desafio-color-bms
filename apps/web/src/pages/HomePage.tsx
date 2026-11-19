import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { formatCivilDate, formatInstant } from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ITEMS } from "@/config/navigation";
import { api, QUERY_KEYS } from "@/lib/api";

const home = NAV_ITEMS[0];

/**
 * FR-27 (pilot slice): the "Dia não fechado" alert: earlier days with movement still open, each
 * with a link to close it. The other alerts and "Tudo em dia" come in #23.
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

/** Início: the alerts (FR-27, pilot slice) and the system status. */
export function HomePage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });

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
            </dl>
          )}
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
