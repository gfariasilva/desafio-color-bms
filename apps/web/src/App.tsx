import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { NAV_ITEMS } from "@/config/navigation";
import { AuditPage } from "@/pages/AuditPage";
import { CatalogPage } from "@/pages/CatalogPage";
import { CardFeesPage } from "@/pages/CardFeesPage";
import { ExpensesPage } from "@/pages/ExpensesPage";
import { CatalogListPage } from "@/pages/CatalogListPage";
import { HomePage } from "@/pages/HomePage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { SalesPage } from "@/pages/SalesPage";
import { SettingsPage } from "@/pages/SettingsPage";

/** Areas that already have their own page; the others show a placeholder. */
const BUILT_AREAS = new Set(["/", "/vendas", "/despesas", "/cadastros", "/configuracoes"]);

/** Opt in to React Router v7 behaviour now, so a future upgrade changes nothing. */
export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="vendas" element={<SalesPage />} />
        <Route path="despesas" element={<ExpensesPage />} />
        <Route path="cadastros" element={<CatalogPage />} />
        <Route path="cadastros/abas" element={<CatalogListPage kind="sale" />} />
        <Route path="cadastros/categorias-despesa" element={<CatalogListPage kind="expense" />} />
        <Route
          path="cadastros/formas-pagamento"
          element={<CatalogListPage kind="payment_method" />}
        />
        <Route path="cadastros/maquininhas" element={<CatalogListPage kind="card_machine" />} />
        <Route path="cadastros/taxas" element={<CardFeesPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="configuracoes/auditoria" element={<AuditPage />} />
        {NAV_ITEMS.filter((item) => !BUILT_AREAS.has(item.path)).map((item) => (
          <Route key={item.path} path={item.path} element={<PlaceholderPage item={item} />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

const queryClient = new QueryClient({
  // Local server: no need to refetch when the window regains focus.
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={ROUTER_FUTURE}>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
