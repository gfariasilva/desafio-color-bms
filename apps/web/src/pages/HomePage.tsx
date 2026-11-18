import { useQuery } from "@tanstack/react-query";
import { formatInstant } from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ITEMS } from "@/config/navigation";
import { api } from "@/lib/api";

const home = NAV_ITEMS[0];

/** Início. For now it only shows the system status (walking skeleton). Alerts come in FR-27. */
export function HomePage() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });

  return (
    <>
      <PageHeader title={home?.label ?? "Início"} description={home?.description} />

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
