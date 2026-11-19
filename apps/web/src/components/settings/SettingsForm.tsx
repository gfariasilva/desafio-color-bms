import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import {
  folderTestRequestSchema,
  formatMoneyInput,
  MAX_DUE_SOON_DAYS,
  parseMoneyText,
  settingsInputSchema,
  type FolderTestResponse,
  type SettingsResponse,
} from "@color-bms/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, QUERY_KEYS } from "@/lib/api";

type Field = "oneDriveFolder" | "cashDifferenceLimitCents" | "dueSoonDays";

/**
 * FR-33: Configurações. The OneDrive folder (with "Testar") and the two alert thresholds, in one
 * form: Enter in any field saves, focus returns to the folder (NFR-05).
 */
export function SettingsForm({ settings }: { settings: SettingsResponse }) {
  const queryClient = useQueryClient();
  const [folder, setFolder] = useState(settings.oneDriveFolder ?? "");
  const [limit, setLimit] = useState(formatMoneyInput(settings.cashDifferenceLimitCents));
  const [days, setDays] = useState(String(settings.dueSoonDays));
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<FolderTestResponse | null>(null);

  const refs = {
    oneDriveFolder: useRef<HTMLInputElement>(null),
    cashDifferenceLimitCents: useRef<HTMLInputElement>(null),
    dueSoonDays: useRef<HTMLInputElement>(null),
  } satisfies Record<Field, unknown>;
  const folderFromEnv = settings.oneDriveFolderSource === "env";

  useEffect(() => {
    refs.oneDriveFolder.current?.focus();
    // Only on the first render: the page has just opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function fail(message: string, field: Field) {
    setSaved("");
    setError(message);
    refs[field].current?.focus();
  }

  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (response) => {
      queryClient.setQueryData(QUERY_KEYS.settings, response);
      // Início shows the backup state and the folder check: refresh them.
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.backupStatus });
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.health });
      setError("");
      setSaved("Configurações salvas.");
      refs.oneDriveFolder.current?.focus();
    },
    onError: (failure) =>
      fail(
        failure instanceof ApiError
          ? failure.message
          : "Não foi possível salvar. Verifique se o sistema está rodando.",
        "oneDriveFolder",
      ),
  });

  const runTest = useMutation({
    mutationFn: api.testOneDriveFolder,
    onSuccess: (result) => setTest(result),
    onError: () =>
      setTest({
        ok: false,
        message: "Não foi possível testar. Verifique se o sistema está rodando.",
      }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTest(null);
    const cents = parseMoneyText(limit);
    if (cents === null) {
      fail("Informe o limite em reais, por exemplo 10,00.", "cashDifferenceLimitCents");
      return;
    }
    // NaN for anything but digits: the shared schema then gives its pt-BR message.
    const dayCount = /^\s*\d+\s*$/.test(days) ? Number(days) : Number.NaN;
    const parsed = settingsInputSchema.safeParse({
      oneDriveFolder: folder,
      cashDifferenceLimitCents: cents,
      dueSoonDays: dayCount,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      fail(issue?.message ?? "Dados inválidos.", (issue?.path[0] as Field) ?? "oneDriveFolder");
      return;
    }
    save.mutate(parsed.data);
  }

  function onTest() {
    setError("");
    setSaved("");
    const parsed = folderTestRequestSchema.safeParse({ folder });
    if (!parsed.success) {
      setTest({ ok: false, message: parsed.error.issues[0]?.message ?? "Pasta inválida." });
      refs.oneDriveFolder.current?.focus();
      return;
    }
    runTest.mutate(parsed.data.folder);
  }

  return (
    <form aria-label="Configurações" onSubmit={onSubmit} className="grid max-w-xl gap-3">
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">OneDrive</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-4 pt-0">
          <Label htmlFor="settings-folder">Pasta do OneDrive</Label>
          <div className="flex gap-2">
            <Input
              id="settings-folder"
              ref={refs.oneDriveFolder}
              value={folder}
              readOnly={folderFromEnv}
              placeholder="C:\Users\dono\OneDrive\Color"
              aria-describedby="settings-folder-help"
              onChange={(event) => {
                setFolder(event.target.value);
                setTest(null);
              }}
            />
            <Button type="button" variant="outline" onClick={onTest} disabled={runTest.isPending}>
              Testar
            </Button>
          </div>
          <p id="settings-folder-help" className="text-sm text-muted-foreground">
            {folderFromEnv
              ? "Definida pela variável de ambiente COLOR_BMS_ONEDRIVE_DIR (desenvolvimento e testes): não pode ser alterada aqui."
              : "Onde ficam os backups do sistema e as planilhas. Deixe em branco para não gravar no OneDrive."}
          </p>
          {settings.trial ? (
            <p className="text-sm text-muted-foreground">
              Modo treino: nada é gravado no OneDrive, qualquer que seja a pasta.
            </p>
          ) : null}
          {test?.ok ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-rainbow-green" aria-hidden />
              {test.message}
            </p>
          ) : null}
          {test && !test.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {test.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-base">Alertas da tela inicial</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="settings-limit">Limite da diferença de caixa (R$)</Label>
            <Input
              id="settings-limit"
              ref={refs.cashDifferenceLimitCents}
              inputMode="decimal"
              className="text-right tabular-nums"
              value={limit}
              aria-describedby="settings-limit-help"
              onChange={(event) => setLimit(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
            <p id="settings-limit-help" className="text-sm text-muted-foreground">
              Avisa quando a diferença do fechamento passa deste valor. 0,00 = qualquer diferença.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-days">Antecedência das contas a vencer (dias)</Label>
            <Input
              id="settings-days"
              ref={refs.dueSoonDays}
              inputMode="numeric"
              className="text-right tabular-nums"
              value={days}
              aria-describedby="settings-days-help"
              onChange={(event) => setDays(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
            <p id="settings-days-help" className="text-sm text-muted-foreground">
              Contas que vencem de hoje até esse número de dias (0 a {MAX_DUE_SOON_DAYS}).
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
        <p role="status" className="min-h-5 text-sm text-muted-foreground">
          {saved}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
