import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  Receipt,
  ShoppingCart,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  cashDifferenceLabel,
  dueAlertText,
  EXPORT_RETRY_MINUTES,
  formatCents,
  formatCivilDate,
  formatInstant,
  formatYearMonth,
  homeAlertCount,
  type AlertBill,
  type ExportQueueItem,
  type ExportQueueStatusResponse,
  type HomeAlertsResponse,
} from "@color-bms/core";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ITEMS } from "@/config/navigation";
import { api, QUERY_KEYS } from "@/lib/api";

const home = NAV_ITEMS[0];

/** The checks refresh every minute: the server retries the exports every 5 (FR-30). */
const REFRESH_MS = 60_000;

const LINK_CLASS =
  "shrink-0 rounded-md px-2 py-1 font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** FR-30 / FR-31: "1 planilha não foi gravada", "o backup do banco não foi gravado", or both. */
function pendingSummary(failed: readonly ExportQueueItem[]): string {
  const sheets = failed.filter((item) => item.kind !== "db_backup").length;
  const backup = failed.some((item) => item.kind === "db_backup");
  const sheetsText = sheets === 1 ? "1 planilha" : `${sheets} planilhas`;
  if (sheets === 0) return "o backup do banco não foi gravado";
  if (backup) return `${sheetsText} e o backup do banco não foram gravados`;
  return sheets === 1 ? "1 planilha não foi gravada" : `${sheetsText} não foram gravadas`;
}

/**
 * FR-27 "Backup pendente" (FR-30, FR-31): the spreadsheets and database backups that could not
 * be written to the OneDrive folder: each file with its reason and last try, the automatic
 * retry, a "Tentar agora" button, and a link to Configurações when the folder is the problem
 * (spec §7.4).
 */
function BackupPendingNotice() {
  // Its own observer of the shared query (no extra request): "Tentar agora" compares the
  // update time, and a parent's result object would be stale here.
  const status = useExportStatus();
  const queryClient = useQueryClient();
  /**
   * The status update that "Tentar agora" produced: its "still failing" message stays only
   * until the list is refreshed, so it never describes an older list.
   */
  const [retriedUpdateAt, setRetriedUpdateAt] = useState<number | null>(null);
  const retry = useMutation({
    mutationFn: api.retryExports,
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEYS.exportStatus, data);
      setRetriedUpdateAt(queryClient.getQueryState(QUERY_KEYS.exportStatus)?.dataUpdatedAt ?? null);
    },
  });
  const failed = failedExports(status.data);
  if (failed.length === 0) return null;
  const folderProblem = failed.some((item) => item.lastErrorCause === "folder");

  return (
    <div role="group" aria-label="Backup pendente" className="mb-2 text-destructive">
      <p className="flex items-start gap-2">
        <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>Backup pendente:</strong> {pendingSummary(failed)} no OneDrive. Nova tentativa a
          cada {EXPORT_RETRY_MINUTES} minutos.
        </span>
      </p>
      <ul className="ml-6 list-disc">
        {failed.map((item) => (
          <li key={item.id} className="break-words">
            {item.fileName}: {item.lastError}.
            {item.lastAttemptAt ? ` Última tentativa em ${formatInstant(item.lastAttemptAt)}.` : ""}
          </li>
        ))}
      </ul>
      <div className="ml-6 mt-1 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-foreground"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {retry.isPending ? "Tentando…" : "Tentar agora"}
        </Button>
        {folderProblem ? (
          <Link to="/configuracoes" className={LINK_CLASS}>
            Verificar a pasta
          </Link>
        ) : null}
        <span role="status" className="text-sm">
          {retry.isError ? "Não foi possível tentar agora." : null}
          {retry.isSuccess && retriedUpdateAt === status.dataUpdatedAt
            ? "Ainda não foi possível gravar. Verifique o motivo acima."
            : null}
        </span>
      </div>
    </div>
  );
}

/** FR-30: the export queue, shared by the alert count and the Backup pendente notice. */
function useExportStatus() {
  return useQuery({
    queryKey: QUERY_KEYS.exportStatus,
    queryFn: api.exportStatus,
    refetchInterval: REFRESH_MS,
  });
}

function failedExports(status: ExportQueueStatusResponse | undefined): ExportQueueItem[] {
  return status?.items.filter((item) => item.status === "failed") ?? [];
}

/** One dense alert line: an icon, the text (it names the alert) and the link that resolves it. */
function AlertRow({
  icon: Icon,
  iconClassName,
  children,
  action,
}: {
  icon: LucideIcon;
  iconClassName: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="flex min-h-9 items-center justify-between gap-3 py-1">
      <span className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`} aria-hidden />
        <span className="break-words">{children}</span>
      </span>
      {action}
    </li>
  );
}

/**
 * FR-27 Conta vencida / Conta a vencer: "Luz (10/2026), venceu há 2 dias (16/11/2026) ·
 * previsto R$ 200,00". The month is named only when it is not the current one. "Pagar" opens
 * the payment card on Contas do mês (`?pagar=`).
 */
function BillAlertRow({
  bill,
  kind,
  today,
}: {
  bill: AlertBill;
  kind: "overdue" | "due_soon";
  today: string;
}) {
  const otherMonth = bill.referenceMonth !== today.slice(0, 7);
  const name = otherMonth ? `${bill.label} (${formatYearMonth(bill.referenceMonth)})` : bill.label;
  return (
    <AlertRow
      icon={kind === "overdue" ? AlertCircle : CalendarClock}
      iconClassName={kind === "overdue" ? "text-destructive" : "text-rainbow-orange"}
      action={
        <Link
          to={`/despesas-fixas/mes?mes=${bill.referenceMonth}&pagar=${bill.id}`}
          aria-label={`Pagar ${name}`}
          className={LINK_CLASS}
        >
          Pagar
        </Link>
      }
    >
      <strong>{kind === "overdue" ? "Conta vencida:" : "Conta a vencer:"}</strong> {name},{" "}
      {dueAlertText(bill.dueDate, today)} ({formatCivilDate(bill.dueDate)})
      {bill.expectedAmountCents !== null
        ? ` · previsto ${formatCents(bill.expectedAmountCents)}`
        : ""}
    </AlertRow>
  );
}

/** FR-27 Diferença de caixa: the last closing's surplus or shortage above the limit (A-17). */
function CashDifferenceRow({
  cashDifference,
}: {
  cashDifference: NonNullable<HomeAlertsResponse["cashDifference"]>;
}) {
  const { date, differenceCents, limitCents } = cashDifference;
  return (
    <AlertRow
      icon={AlertTriangle}
      iconClassName="text-rainbow-orange"
      action={
        <Link
          to={`/fechamento?data=${date}`}
          aria-label={`Ver o fechamento de ${formatCivilDate(date)}`}
          className={LINK_CLASS}
        >
          Ver fechamento
        </Link>
      }
    >
      <strong>Diferença de caixa</strong> no fechamento de {formatCivilDate(date)}:{" "}
      {cashDifferenceLabel(differenceCents)}
      {/* The default limit R$ 0,00 (A-17) means "any difference": not worth repeating. */}
      {limitCents > 0 ? ` (limite ${formatCents(limitCents)})` : ""}
    </AlertRow>
  );
}

/**
 * FR-27: the alerts of Início, most urgent first, each with a link to where it is fixed, or
 * "Tudo em dia". Sources: GET /api/alerts (bills, open days, cash difference), the export
 * queue (Backup pendente), the backup configuration (#25) and the startup checks (#26).
 */
function AlertsCard() {
  const alerts = useQuery({
    queryKey: QUERY_KEYS.homeAlerts,
    queryFn: api.homeAlerts,
    refetchInterval: REFRESH_MS,
  });
  const exportStatus = useExportStatus();
  const backup = useQuery({ queryKey: QUERY_KEYS.backupStatus, queryFn: api.backupStatus });
  // #26: trial mode never backs up (no "configure it" prompt), and the startup checks.
  const health = useQuery({ queryKey: QUERY_KEYS.health, queryFn: api.health });

  const failedCount = failedExports(exportStatus.data).length;
  const trial = health.data?.trial ?? false;
  // #25/#20: in real use, no OneDrive folder means no backup at all.
  const folderMissing = backup.data !== undefined && !backup.data.configured && !trial;
  const startupErrors = health.data?.checks.filter((check) => check.status === "error") ?? [];
  const data = alerts.data;

  // "Tudo em dia" only when every source answered: an unknown state is never "all clear".
  const allClear =
    data !== undefined &&
    exportStatus.isSuccess &&
    backup.isSuccess &&
    health.isSuccess &&
    homeAlertCount({
      alerts: data,
      failedExports: failedCount,
      oneDriveNotConfigured: folderMissing,
      startupErrors: startupErrors.length,
    }) === 0;

  return (
    <section aria-labelledby="alerts-title" className="max-w-3xl">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle id="alerts-title" className="text-base">
            Alertas
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {exportStatus.isError ? (
            <p className="mb-2 text-destructive">Não foi possível verificar as planilhas.</p>
          ) : null}
          {backup.isError ? (
            <p className="mb-2 text-destructive">Não foi possível verificar o backup.</p>
          ) : null}
          <BackupPendingNotice />

          {alerts.isPending ? <p className="text-muted-foreground">Verificando…</p> : null}
          {alerts.isError ? (
            <p className="text-destructive">Não foi possível verificar os alertas.</p>
          ) : null}

          <ul className="divide-y empty:hidden">
            {startupErrors.map((check) => (
              <AlertRow
                key={check.id}
                icon={XCircle}
                iconClassName="text-destructive"
                action={
                  <Link to="/configuracoes" className={LINK_CLASS}>
                    Ver detalhes
                  </Link>
                }
              >
                <strong>Problema no PC:</strong> {check.message}
              </AlertRow>
            ))}
            {folderMissing ? (
              <AlertRow
                icon={AlertTriangle}
                iconClassName="text-rainbow-orange"
                action={
                  <Link to="/configuracoes" className={LINK_CLASS}>
                    Configurar
                  </Link>
                }
              >
                Pasta do OneDrive não configurada: os backups não estão sendo gravados.
              </AlertRow>
            ) : null}
            {data?.unclosedDays.map((date) => (
              <AlertRow
                key={date}
                icon={AlertTriangle}
                iconClassName="text-rainbow-orange"
                action={
                  <Link
                    to={`/fechamento?data=${date}`}
                    aria-label={`Fechar o dia ${formatCivilDate(date)}`}
                    className={LINK_CLASS}
                  >
                    Fechar
                  </Link>
                }
              >
                Dia {formatCivilDate(date)} não fechado
              </AlertRow>
            ))}
            {data?.overdueBills.map((bill) => (
              <BillAlertRow key={bill.id} bill={bill} kind="overdue" today={data.today} />
            ))}
            {data?.cashDifference ? (
              <CashDifferenceRow cashDifference={data.cashDifference} />
            ) : null}
            {data?.dueSoonBills.map((bill) => (
              <BillAlertRow key={bill.id} bill={bill} kind="due_soon" today={data.today} />
            ))}
          </ul>

          {allClear ? (
            <p role="status" className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-rainbow-green" aria-hidden />
              Tudo em dia
            </p>
          ) : null}
          {/* #26: trial mode is a note, not an alert. */}
          {trial && backup.data && !backup.data.configured ? (
            <p className="mt-2 text-muted-foreground">Modo treino: sem backup no OneDrive.</p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

const SHORTCUTS: readonly { label: string; path: string; icon: LucideIcon }[] = [
  { label: "Registrar venda", path: "/vendas", icon: ShoppingCart },
  { label: "Registrar despesa", path: "/despesas", icon: Receipt },
  { label: "Fechar o dia", path: "/fechamento", icon: Lock },
];

/** FR-27: the shortcuts to the day's main tasks, with their Alt+N keys (NFR-05). */
function ShortcutsCard() {
  return (
    <section aria-labelledby="shortcuts-title" className="max-w-3xl">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle id="shortcuts-title" className="text-base">
            Atalhos
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 p-4 pt-0">
          {SHORTCUTS.map(({ label, path, icon: Icon }) => {
            const shortcut = NAV_ITEMS.find((item) => item.path === path)?.shortcut;
            return (
              <Button key={path} asChild variant="outline">
                <Link
                  to={path}
                  aria-keyshortcuts={shortcut ? `Alt+${shortcut}` : undefined}
                  aria-label={label}
                >
                  <Icon aria-hidden />
                  {label}
                  {shortcut ? (
                    <kbd className="text-[10px] font-normal text-muted-foreground" aria-hidden>
                      Alt+{shortcut}
                    </kbd>
                  ) : null}
                </Link>
              </Button>
            );
          })}
        </CardContent>
      </Card>
    </section>
  );
}

/** Início: what needs attention today (FR-27) and the shortcuts to the day's tasks. */
export function HomePage() {
  return (
    <>
      <PageHeader title={home?.label ?? "Início"} description={home?.description} />
      <div className="grid gap-4">
        <AlertsCard />
        <ShortcutsCard />
      </div>
    </>
  );
}
