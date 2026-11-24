const sizeFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * A file size in pt-BR, for the list of backups (FR-32): "512 bytes", "1,5 KB", "12,3 MB".
 * Uses 1 KB = 1024 bytes, like Windows Explorer.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${sizeFormatter.format(value)} ${units[unit]}`;
}
