import { ChevronRight, Construction, History } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
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
        <Link
          to="/configuracoes/auditoria"
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Card className="transition-colors hover:bg-muted/50">
            <CardContent className="flex items-center gap-3 p-4">
              <History className="h-5 w-5 text-primary" aria-hidden />
              <div className="flex-1">
                <p className="font-medium">Auditoria</p>
                <p className="text-muted-foreground">
                  Histórico de criações, edições, exclusões e fechamentos.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            </CardContent>
          </Card>
        </Link>

        {UPCOMING.map((section) => (
          <Card key={section.label}>
            <CardContent className="flex items-center gap-3 p-4 text-muted-foreground">
              <Construction className="h-5 w-5" aria-hidden />
              <span>
                <span className="font-medium text-foreground">{section.label}</span>: em construção
                ({section.requirements}).
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
