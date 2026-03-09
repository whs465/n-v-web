import type { FieldDef, NachamRecord } from "@/core/nacham/types";

export const RECORD_LEN = 106;

export function sanitizeCompactText(raw: string): string {
  return String(raw || "").replace(/\uFEFF/g, "").replace(/\r?\n/g, "");
}

export function splitCompactToRows(compact: string, len = RECORD_LEN): string[] {
  if (!compact) return [];
  const out: string[] = [];
  for (let i = 0; i + len <= compact.length; i += len) {
    out.push(compact.slice(i, i + len));
  }
  return out;
}

export function parseRowsToRecords(rows: string[]): NachamRecord[] {
  return rows.map((raw, index) => ({
    index,
    line: index + 1,
    type: String(raw[0] || ""),
    raw,
  }));
}

export function slice1(raw: string, start: number, end: number): string {
  return String(raw || "").slice(start - 1, end);
}

export function extractFields(raw: string, defs: FieldDef[]) {
  return defs.map((def, idx) => {
    const value = slice1(raw, def.start, def.end);
    return {
      id: idx + 1,
      name: def.name,
      length: def.end - def.start + 1,
      position: `${def.start}-${def.end}`,
      value,
    };
  });
}

