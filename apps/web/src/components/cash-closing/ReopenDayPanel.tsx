import {
  DAY_REOPEN_REASON_MAX,
  formatCivilDate,
  reopenDayInputSchema,
  type ReopenDayInput,
} from "@color-bms/core";
import { ReopenPanel } from "./ReopenPanel";

interface ReopenDayPanelProps {
  /** The closed day (FR-09). */
  date: string;
  /** Reopens the day; rejects with an Error whose message is pt-BR (shown in the alert). */
  onReopen: (input: ReopenDayInput) => Promise<unknown>;
}

/**
 * FR-09: "Reabrir dia" under a closed day's summary (confirmation + reason, Enter reopens,
 * Esc cancels). After a reopening the page shows the closing form again (a new closing is
 * required).
 */
export function ReopenDayPanel({ date, onReopen }: ReopenDayPanelProps) {
  return (
    <ReopenPanel
      actionLabel="Reabrir dia"
      formLabel="Reabrir o dia"
      warning={`O dia ${formatCivilDate(date)} volta a aberto e precisará ser fechado de novo. O fechamento atual fica na auditoria.`}
      reasonId="reopen-reason"
      reasonMax={DAY_REOPEN_REASON_MAX}
      placeholder="ex.: venda esquecida"
      schema={reopenDayInputSchema}
      failureMessage="Não foi possível reabrir o dia."
      onReopen={onReopen}
    />
  );
}
