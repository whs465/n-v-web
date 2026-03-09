import { FIELD_MAPS } from "@/core/nacham/fieldMaps";
import { slice1 } from "@/core/nacham/parser";
import type { FieldMap, FileProfile, NachamRecord } from "@/core/nacham/types";

type ProfileMatcher = {
  profile: FileProfile;
  match: (tipoServicio: string, descripcion: string) => boolean;
};

const PROFILE_MATCHERS: ProfileMatcher[] = [
  {
    profile: "ppd_prenotific",
    match: (tipoServicio, descripcion) =>
      tipoServicio === "PPD" && descripcion.startsWith("PRENOTIFIC"),
  },
  {
    profile: "ppd_devolucion",
    match: (tipoServicio, descripcion) =>
      tipoServicio === "PPD" && descripcion.startsWith("DEVOLUCION"),
  },
  {
    profile: "ppd_traslados",
    match: (tipoServicio, descripcion) =>
      tipoServicio === "PPD" && descripcion.startsWith("TRASLAD"),
  },
  {
    profile: "ctx_pagos",
    match: (tipoServicio, descripcion) =>
      tipoServicio === "CTX" && descripcion.startsWith("PAGOS"),
  },
  {
    profile: "ppd_pagos",
    match: (tipoServicio, descripcion) =>
      tipoServicio === "PPD" && descripcion.startsWith("PAGOS"),
  },
];

export function detectFileProfile(records: NachamRecord[]): {
  profile: FileProfile;
  fieldMap: FieldMap;
} {
  for (const record of records) {
    if (record.type !== "5") continue;
    const tipoServicio = slice1(record.raw, 51, 53).trim().toUpperCase();
    const descripcionLote = slice1(record.raw, 54, 63)
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    for (const rule of PROFILE_MATCHERS) {
      if (rule.match(tipoServicio, descripcionLote)) {
        return { profile: rule.profile, fieldMap: FIELD_MAPS[rule.profile] };
      }
    }
  }
  return { profile: "default", fieldMap: FIELD_MAPS.default };
}

