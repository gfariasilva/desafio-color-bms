/**
 * Category / chart colors come from the brand rainbow (docs/design-system.md).
 * Use them for sale tabs ("abas"), expense categories and chart series, assigned by the
 * category's display order so a category keeps the same color everywhere.
 */
export const CATEGORY_COLOR_VARS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
] as const;

/** CSS color for the category at `index` (0-based). Cycles after 6 categories. */
export function categoryColor(index: number): string {
  const size = CATEGORY_COLOR_VARS.length;
  const variable = CATEGORY_COLOR_VARS[((index % size) + size) % size];
  return `hsl(var(${variable}))`;
}
