import { ChevronRight, Construction, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";

interface HubLinkCardProps {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** A link to a sub-page on a hub page (Cadastros, Configurações). */
export function HubLinkCard({ to, label, description, icon: Icon }: HubLinkCardProps) {
  return (
    <Link
      to={to}
      className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center gap-3 p-4">
          <Icon className="h-5 w-5 text-primary" aria-hidden />
          <div className="flex-1">
            <p className="font-medium">{label}</p>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardContent>
      </Card>
    </Link>
  );
}

/** A section a later backlog item will build, shown so the owner knows what is coming. */
export function UpcomingCard({ label, requirements }: { label: string; requirements: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4 text-muted-foreground">
        <Construction className="h-5 w-5" aria-hidden />
        <span>
          <span className="font-medium text-foreground">{label}</span>: em construção (
          {requirements}).
        </span>
      </CardContent>
    </Card>
  );
}
