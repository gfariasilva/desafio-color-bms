import { describe, expect, it } from "vitest";
import { formatFileSize } from "./file-size";

describe("formatFileSize (FR-32: the list of backups)", () => {
  it("shows bytes, KB, MB and GB in pt-BR", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
    expect(formatFileSize(1023)).toBe("1023 bytes");
    expect(formatFileSize(1536)).toBe("1,5 KB");
    expect(formatFileSize(12.34 * 1024 * 1024)).toBe("12,3 MB");
    expect(formatFileSize(3 * 1024 ** 3)).toBe("3 GB");
  });
});
