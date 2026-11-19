import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation } from "react-router-dom";
import { todayCivilDate, formatCivilDate } from "@color-bms/core";
import { Badge } from "@/components/ui/badge";
import { NAV_ITEMS } from "@/config/navigation";
import { api, QUERY_KEYS } from "@/lib/api";
import { useNavShortcuts } from "@/hooks/use-nav-shortcuts";
import { AppSidebar } from "./AppSidebar";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell() {
  useNavShortcuts();
  const { pathname } = useLocation();
  // #26: trial mode (training data before go-live) is flagged on every screen.
  const health = useQuery({ queryKey: QUERY_KEYS.health, queryFn: api.health });
  // The area that owns the current page, also for sub-pages such as /configuracoes/auditoria.
  // ("/despesas" must not match "/despesas-fixas", so a sub-page needs the "/" after the area.)
  const current = NAV_ITEMS.find(
    (item) => pathname === item.path || (item.path !== "/" && pathname.startsWith(`${item.path}/`)),
  );

  return (
    <div className="flex min-h-screen flex-col">
      {/* Brand accent: the only rainbow in the app chrome (docs/design-system.md). */}
      <div className="rainbow-gradient h-1 w-full shrink-0" aria-hidden />
      <div className="flex flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center justify-between border-b px-6">
            <span className="font-medium text-muted-foreground">{current?.label ?? ""}</span>
            <div className="flex items-center gap-3">
              {health.data?.trial ? (
                <Badge
                  variant="warning"
                  title="Modo treino: dados de teste, guardados à parte ao iniciar o uso real."
                >
                  TREINO
                </Badge>
              ) : null}
              <span className="tabular-nums text-muted-foreground" title="Hoje (America/Sao_Paulo)">
                {formatCivilDate(todayCivilDate())}
              </span>
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 px-6 py-5">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
