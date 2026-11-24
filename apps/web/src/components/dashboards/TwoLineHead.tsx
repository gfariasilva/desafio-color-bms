import { TableHead } from "@/components/ui/table";

/** A right-aligned column header with a muted second line (e.g. the days compared). */
export function TwoLineHead({ title, detail }: { title: string; detail: string }) {
  return (
    <TableHead className="text-right align-bottom">
      <span className="block">{title}</span>
      <span className="block text-xs font-normal">{detail}</span>
    </TableHead>
  );
}
