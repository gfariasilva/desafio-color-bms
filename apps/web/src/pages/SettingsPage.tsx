import { History } from "lucide-react";
import { HubLinkCard, UpcomingCard } from "@/components/layout/HubCards";
import { PageHeader } from "@/components/layout/PageHeader";
import { NAV_ITEMS } from "@/config/navigation";

const settingsArea = NAV_ITEMS.find((item) => item.path === "/configuracoes");

/** Sections that later backlog items will build (shown so the owner knows what is coming). */
const UPCOMING = [
  { label: "Pasta do OneDrive e alertas", requirements: "FR-33" },
  { label: "Backup e restauração", requirements: "FR-31, FR-32" },
];

/** Configurações: entry point to the settings sections. */
export function SettingsPage() {
  return (
    <>
      <PageHeader
        title={settingsArea?.label ?? "Configurações"}
        description={settingsArea?.description}
      />
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
