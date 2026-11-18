export type Theme = "light" | "dark";

const STORAGE_KEY = "color-bms-theme";

/** Reads the saved theme. Storage can be unavailable, so failures fall back to light. */
export function getStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Applies the theme to <html> (Tailwind `darkMode: "class"`) and remembers it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not critical: the theme just won't be remembered.
  }
}
