import {
  BarChart3,
  CalendarClock,
  FileSpreadsheet,
  Home,
  ListChecks,
  Lock,
  Receipt,
  Settings,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  path: string;
  /** pt-BR label shown in the UI. */
  label: string;
  /** Short pt-BR description shown on the page header. */
  description: string;
  icon: LucideIcon;
  /** Alt + this digit opens the page (NFR-05: keyboard-first). */
  shortcut: number;
  /** Spec requirements this area will implement. */
  requirements: string;
}

/** Main areas of the app (spec §4). The order defines the sidebar and the Alt+N shortcuts. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: "/",
    label: "Início",
    description: "Alertas e atalhos do dia.",
    icon: Home,
    shortcut: 1,
    requirements: "FR-27",
  },
  {
    path: "/vendas",
    label: "Vendas",
    description: "Registrar vendas e estornos e ver o dia por aba.",
    icon: ShoppingCart,
    shortcut: 2,
    requirements: "FR-01 a FR-05",
  },
  {
    path: "/despesas",
    label: "Despesas",
    description: "Saídas diárias (despesas gerais) e sangrias.",
    icon: Receipt,
    shortcut: 3,
    requirements: "FR-06, FR-07",
  },
  {
    path: "/despesas-fixas",
    label: "Despesas fixas",
    description: "Contas do mês, vencimentos e empréstimos.",
    icon: CalendarClock,
    shortcut: 4,
    requirements: "FR-10 a FR-13",
  },
  {
    path: "/fechamento",
    label: "Fechamento",
    description: "Fechamento de caixa do dia e fechamento do mês.",
    icon: Lock,
    shortcut: 5,
    requirements: "FR-08, FR-09, FR-16, FR-17",
  },
  {
    path: "/relatorios",
    label: "Relatórios",
    description: "Relatório do dia, entradas, despesas e resumo mensal.",
    icon: FileSpreadsheet,
    shortcut: 6,
    requirements: "FR-19 a FR-23",
  },
  {
    path: "/dashboards",
    label: "Dashboards",
    description: "Comparação com o mês anterior, ranking das abas e entradas × despesas.",
    icon: BarChart3,
    shortcut: 7,
    requirements: "FR-24 a FR-26",
  },
  {
    path: "/cadastros",
    label: "Cadastros",
    description: "Abas de venda, categorias de despesa, maquininhas, formas e taxas.",
    icon: ListChecks,
    shortcut: 8,
    requirements: "FR-14, FR-15",
  },
  {
    path: "/configuracoes",
    label: "Configurações",
    description: "Pasta do OneDrive, alertas, backup e auditoria.",
    icon: Settings,
    shortcut: 9,
    requirements: "FR-18, FR-28 a FR-33",
  },
];
