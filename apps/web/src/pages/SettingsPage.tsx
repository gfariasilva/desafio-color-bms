import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { HubLinkCard, UpcomingCard } from "@/components/layout/HubCards";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { NAV_ITEMS } from "@/config/navigation";
import { api, QUERY_KEYS } from "@/lib/api";

const settingsArea = NAV_ITEMS.find((item) => item.path === "/configuracoes");

/** Sections that later backlog items will build (shown so the owner knows what is coming). */
const UPCOMING = [{ label: "Backup e restauração", requirements: "FR-31, FR-32" }];

/** Configurações: the settings form (FR-33), then the other settings sections. */
export function SettingsPage() {
  const settings = useQuery({ queryKey: QUERY_KEYS.settings, queryFn: api.settings });
  return (
    <>
      <PageHeader
        title={settingsArea?.label ?? "Configurações"}
        description={settingsArea?.description}
      />
      <div className="mb-6">
        {settings.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {settings.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar as configurações. Recarregue a página.
          </p>
        ) : null}
        {/* Mounted once the values arrive, so the form starts filled in and focused. */}
        {settings.data ? <SettingsForm settings={settings.data} /> : null}
      </div>
      <div className="grid max-w-xl gap-2">
        <HubLinkCard
          to="/configuracoes/auditoria"
          label="Auditoria"
          description="Histórico de criações, edições, exclusões e fechamentos."
          icon={History}
        />
        {UPCOMING.map((section) => (
          <UpcomingCard key={section.label} {...section} />
        ))}
      </div>
    </>
  );
}
