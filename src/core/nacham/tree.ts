import { slice1 } from "@/core/nacham/parser";
import type { NachamRecord } from "@/core/nacham/types";

export type BatchNode = {
  id: string;
  batchNo: number;
  start: number;
  end: number;
  headerIndex: number;
  controlIndex: number;
  entryCount: number;
  addendaCount: number;
  orderCount: number;
  transferCount: number;
  prenotificCounts: Record<string, number>;
  debitTotal8: string;
  creditTotal8: string;
  tregcontrolCount: number;
  key5: string;
  useKey6: boolean;
  key6: string;
};

export type TreeSummary = {
  hasHeader1: boolean;
  hasControl9: boolean;
  batches: BatchNode[];
  counts: Record<string, number>;
  totalOrders: number;
  totalTransfers: number;
  prenotificTotals: Record<string, number>;
  fileDebitTotal9: string;
  fileCreditTotal9: string;
  totalTregcontrol: number;
};

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1;
}

export function buildTree(records: NachamRecord[]): TreeSummary {
  const counts: Record<string, number> = { 1: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  for (const rec of records) counts[rec.type] = (counts[rec.type] || 0) + 1;

  const hasHeader1 = records.length > 0 && records[0].type === "1";
  const hasControl9 = records.length > 0 && records[records.length - 1].type === "9";

  const first9 = records.find((r) => r.type === "9");
  const fileDebitTotal9 = first9 ? slice1(first9.raw, 32, 49).trim() : "";
  const fileCreditTotal9 = first9 ? slice1(first9.raw, 50, 67).trim() : "";

  const batches: BatchNode[] = [];
  const prenotificTotals: Record<string, number> = {};
  let totalOrders = 0;
  let totalTransfers = 0;
  let totalTregcontrol = 0;
  let current: BatchNode | null = null;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.type === "5") {
      if (current) {
        current.end = i - 1;
        const finalKey = current.useKey6 && current.key6 ? current.key6 : current.key5 || "";
        current.id = finalKey ? `${finalKey} · Lote ${current.batchNo}` : `Lote ${current.batchNo}`;
        batches.push(current);
      }
      const batchNo = batches.length + 1;
      const key5 = slice1(rec.raw, 85, 91).trim();
      current = {
        id: "",
        batchNo,
        start: i,
        end: i,
        headerIndex: i,
        controlIndex: -1,
        entryCount: 0,
        addendaCount: 0,
        orderCount: 0,
        transferCount: 0,
        prenotificCounts: {},
        debitTotal8: "",
        creditTotal8: "",
        tregcontrolCount: 0,
        key5,
        useKey6: key5 === "0001683",
        key6: "",
      };
      if (!current.useKey6) current.id = key5 ? `${key5} · Lote ${batchNo}` : `Lote ${batchNo}`;
      continue;
    }

    if (!current) continue;
    if (rec.type === "6") {
      current.entryCount++;
      if (current.useKey6 && !current.key6) {
        current.key6 = slice1(rec.raw, 5, 11).trim();
        const finalKey = current.key6 || current.key5 || "";
        current.id = finalKey ? `${finalKey} · Lote ${current.batchNo}` : `Lote ${current.batchNo}`;
      }
      const receiver = slice1(rec.raw, 63, 84).trim().toUpperCase();
      if (/^\d+$/.test(receiver)) {
        current.orderCount++;
        totalOrders++;
      }
      if (/^TR\d+$/.test(receiver)) {
        current.transferCount++;
        totalTransfers++;
      }
      if (receiver.startsWith("PRENOTIFIC")) {
        inc(current.prenotificCounts, receiver);
        inc(prenotificTotals, receiver);
      }
      if (receiver.startsWith("TREG")) {
        current.tregcontrolCount++;
        totalTregcontrol++;
      }
    }
    if (rec.type === "7") current.addendaCount++;
    if (rec.type === "8") {
      current.controlIndex = i;
      current.debitTotal8 = slice1(rec.raw, 21, 38).trim();
      current.creditTotal8 = slice1(rec.raw, 39, 56).trim();
      current.end = i;
      const finalKey = current.useKey6 && current.key6 ? current.key6 : current.key5 || "";
      current.id = finalKey ? `${finalKey} · Lote ${current.batchNo}` : `Lote ${current.batchNo}`;
      batches.push(current);
      current = null;
      continue;
    }
    current.end = i;
  }
  if (current) batches.push(current);

  return {
    hasHeader1,
    hasControl9,
    batches,
    counts,
    totalOrders,
    totalTransfers,
    prenotificTotals,
    fileDebitTotal9,
    fileCreditTotal9,
    totalTregcontrol,
  };
}

