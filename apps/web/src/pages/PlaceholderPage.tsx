import { Construction } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import type { NavItem } from "@/config/navigation";

/** Temporary page for areas that are not built yet. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <CardContent className="flex items-center gap-3 p-4 text-muted-foreground">
          <Construction className="h-5 w-5" aria-hidden />
          <span>
            Em construção. Esta área vai cobrir os requisitos{" "}
            <span className="font-medium text-foreground">{item.requirements}</span> da
            especificação.
          </span>
        </CardContent>
      </Card>
    </>
  );
}
