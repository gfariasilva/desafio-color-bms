import { Component, Suspense, type ReactNode } from "react";

/**
 * Wraps a page loaded on demand (`React.lazy`). If its file cannot be loaded (the tab still
 * runs an older version after a pilot update, or the server is restarting), the page shows a
 * pt-BR message instead of the whole app going blank.
 */
export function LazyPage({ name, children }: { name: string; children: ReactNode }) {
  return (
    <LoadErrorBoundary name={name}>
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        {children}
      </Suspense>
    </LoadErrorBoundary>
  );
}

class LoadErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <p role="alert" className="text-destructive">
          Não foi possível abrir os {this.props.name}. Recarregue a página (F5).
        </p>
      );
    }
    return this.props.children;
  }
}
