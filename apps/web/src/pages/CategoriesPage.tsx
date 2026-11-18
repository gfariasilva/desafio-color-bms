import { Link } from "react-router-dom";
import type { CategoryKind } from "@color-bms/core";
import { CategoryManager } from "@/components/catalog/CategoryManager";
import { PageHeader } from "@/components/layout/PageHeader";

const HEADERS: Record<CategoryKind, { title: string; description: string }> = {
  sale: {
    title: "Abas de venda",
    description:
      "Cada venda é registrada em uma aba. Renomear não altera os totais já registrados.",
  },
  expense: {
    title: "Categorias de despesa",
    description:
      "Cada saída diária pertence a uma categoria. Os fornecedores ficam no grupo Fornecedores de materiais.",
  },
};

/** Cadastros › Abas de venda / Categorias de despesa (FR-14). */
export function CategoriesPage({ kind }: { kind: CategoryKind }) {
  return (
    <>
      <PageHeader title={HEADERS[kind].title} description={HEADERS[kind].description} />
      <p className="-mt-3 mb-4">
        <Link to="/cadastros" className="text-primary underline-offset-4 hover:underline">
          ← Cadastros
        </Link>
      </p>
      <CategoryManager kind={kind} />
    </>
  );
}
