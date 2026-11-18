import { ChevronRight, Construction, Tags, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { NAV_ITEMS } from "@/config/navigation";

const catalogArea = NAV_ITEMS.find((item) => item.path === "/cadastros");

const SECTIONS = [
  {
    to: "/cadastros/abas",
    label: "Abas de venda",
    description: "As abas em que as vendas são registradas (Toner, Papelaria…).",
    icon: Tags,
  },
  {
    to: "/cadastros/categorias-despesa",
    label: "Categorias de despesa",
    description: "Categorias das saídas diárias, incluindo os fornecedores de materiais.",
    icon: Wallet,
  },
];

/** Sections that later backlog items will build (shown so the owner knows what is coming). */
const UPCOMING = [{ label: "Maquininhas, formas de pagamento e taxas", requirements: "FR-15" }];

/** Cadastros: entry point to the master-data lists (FR-14, FR-15). */
export function CatalogPage() {
  return (
    <>
      <PageHeader
        title={catalogArea?.label ?? "Cadastros"}
        description={catalogArea?.description}
      />

      <div className="grid max-w-xl gap-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center gap-3 p-4">
                <section.icon className="h-5 w-5 text-primary" aria-hidden />
                <div className="flex-1">
                  <p className="font-medium">{section.label}</p>
                  <p className="text-muted-foreground">{section.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
              </CardContent>
            </Card>
          </Link>
        ))}

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
