import { NavLink } from "react-router-dom";
import logo from "@/assets/logo.png";
import { NAV_ITEMS } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-4 py-4">
        <img src={logo} alt="Desafio Color" className="h-10 w-10" />
        <div className="leading-tight">
          <p className="font-semibold text-foreground">Color</p>
          <p className="text-xs text-muted-foreground">Gestão financeira</p>
        </div>
      </div>

      <nav aria-label="Navegação principal" className="flex-1 px-2 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  cn(
                    "group flex h-9 items-center gap-3 rounded-md px-3 font-medium outline-none transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    isActive && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary",
                  )
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1 truncate">{item.label}</span>
                <kbd
                  className="text-[10px] font-normal text-muted-foreground"
                  aria-label={`Atalho Alt+${item.shortcut}`}
                >
                  Alt+{item.shortcut}
                </kbd>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
