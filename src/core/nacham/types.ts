export type RecordType = "1" | "5" | "6" | "7" | "8" | "9";

export type FieldDef = {
  name: string;
  start: number; // 1-based inclusive
  end: number; // 1-based inclusive
};

export type FieldMap = Record<string, FieldDef[]>;

export type NachamRecord = {
  index: number;
  line: number;
  type: string;
  raw: string;
};

export type FileProfile =
  | "default"
  | "ppd_prenotific"
  | "ppd_devolucion"
  | "ppd_traslados"
  | "ctx_pagos"
  | "ppd_pagos";

