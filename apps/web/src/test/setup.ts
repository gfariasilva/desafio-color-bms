import "@testing-library/jest-dom/vitest";

// jsdom has no layout and no ResizeObserver. Recharts' ResponsiveContainer (FR-24 dashboard)
// measures its box with one, so this stand-in reports a fixed 640 × 288 box once observed.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const contentRect = { width: 640, height: 288 } as DOMRectReadOnly;
      this.callback([{ target, contentRect } as ResizeObserverEntry], this);
    }
    unobserve() {}
    disconnect() {}
  };
}
