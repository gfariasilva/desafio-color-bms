import { Link } from "react-router-dom";
import { CatalogListManager, type CatalogListKind } from "@/components/catalog/CatalogListManager";
import { PageHeader } from "@/components/layout/PageHeader";

const HEADERS: Record<CatalogListKind, { title: string; description: string }> = {
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
  payment_method: {
    title: "Formas de pagamento",
    description:
      "Como o cliente pagou. A coluna Maquininha diz se a venda passa pela maquininha (e paga taxa); Parcelas, se pode ser parcelada.",
  },
  card_machine: {
    title: "Maquininhas",
    description:
      "Terminais de cartão. Depois de cadastrar uma maquininha, informe as taxas dela na Tabela de taxas.",
  },
};

/**
 * Cadastros › Abas de venda / Categorias de despesa (FR-14) and Formas de pagamento /
 * Maquininhas (FR-15).
 */
export function CatalogListPage({ kind }: { kind: CatalogListKind }) {
  return (
    <>
      <PageHeader title={HEADERS[kind].title} description={HEADERS[kind].description} />
      <p className="-mt-3 mb-4 flex gap-4">
        <Link to="/cadastros" className="text-primary underline-offset-4 hover:underline">
          ← Cadastros
        </Link>
        {kind === "card_machine" && (
          <Link to="/cadastros/taxas" className="text-primary underline-offset-4 hover:underline">
            Tabela de taxas →
          </Link>
        )}
      </p>
      <CatalogListManager kind={kind} />
    </>
  );
}
