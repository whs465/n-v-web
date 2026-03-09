import type { FieldDef, FieldMap, FileProfile } from "@/core/nacham/types";

const BASE_FIELD_MAP: FieldMap = {
  "1": [
    { name: "Tipo de registro", start: 1, end: 1 },
    { name: "Código de prioridad", start: 2, end: 3 },
    { name: "Código participante destino inmediato", start: 4, end: 13 },
    { name: "Código participante origen inmediato", start: 14, end: 23 },
    { name: "Fecha de creación del archivo", start: 24, end: 31 },
    { name: "Hora de creación del archivo", start: 32, end: 35 },
    { name: "Identificador del archivo", start: 36, end: 36 },
    { name: "Tamaño del registro", start: 37, end: 39 },
    { name: "Factor de ablocamiento", start: 40, end: 41 },
    { name: "Código de formato", start: 42, end: 42 },
    { name: "Nombre entidad destino", start: 43, end: 65 },
    { name: "Nombre entidad origen", start: 66, end: 88 },
    { name: "Código de referencia", start: 89, end: 96 },
    { name: "Reservado", start: 97, end: 106 },
  ],
  "5": [
    { name: "Tipo de registro", start: 1, end: 1 },
    { name: "Código clase de transacción por lote", start: 2, end: 4 },
    { name: "Nombre originador", start: 5, end: 20 },
    { name: "Datos discrecionales del originador", start: 21, end: 40 },
    { name: "Identificador originador", start: 41, end: 50 },
    { name: "Tipo servicio", start: 51, end: 53 },
    { name: "Descripción del lote", start: 54, end: 63 },
    { name: "Fecha descriptiva", start: 64, end: 71 },
    { name: "Fecha efectiva de la transacción", start: 72, end: 79 },
    { name: "Fecha de compensación Juliana", start: 80, end: 82 },
    { name: "Código estado del originador", start: 83, end: 83 },
    { name: "Participante originador", start: 84, end: 91 },
    { name: "Numero lote", start: 92, end: 98 },
  ],
  "6": [
    { name: "Tipo de registro", start: 1, end: 1 },
    { name: "Código clase de transacción por lote", start: 2, end: 3 },
    { name: "Código participante receptor", start: 4, end: 11 },
    { name: "Dígito de chequeo", start: 12, end: 12 },
    { name: "Número de cuenta del receptor", start: 13, end: 29 },
    { name: "Valor de la transacción", start: 30, end: 47 },
    { name: "Número de identificación del receptor", start: 48, end: 62 },
    { name: "Nombre del receptor", start: 63, end: 84 },
    { name: "Datos discrecionales", start: 85, end: 86 },
    { name: "Indicador de registro de adenda", start: 87, end: 87 },
    { name: "Número de secuencia", start: 88, end: 102 },
    { name: "Reservado", start: 103, end: 106 },
  ],
  "8": [
    { name: "Tipo de registro", start: 1, end: 1 },
    { name: "Código clase de transacción por lote", start: 2, end: 4 },
    { name: "Número de trans./adenda", start: 5, end: 10 },
    { name: "Totales control", start: 11, end: 20 },
    { name: "Valor total de débitos", start: 21, end: 38 },
    { name: "Valor total de créditos", start: 39, end: 56 },
    { name: "Identificador del originador", start: 57, end: 66 },
    { name: "Código de autenticación", start: 67, end: 85 },
    { name: "Reservado", start: 86, end: 91 },
    { name: "ID participante originador", start: 92, end: 99 },
    { name: "Número de lote", start: 100, end: 106 },
  ],
  "9": [
    { name: "Tipo de registro", start: 1, end: 1 },
    { name: "Cantidad de lotes", start: 2, end: 7 },
    { name: "Número de bloques", start: 8, end: 13 },
    { name: "Número de trans./adenda", start: 14, end: 21 },
    { name: "Totales control", start: 22, end: 31 },
    { name: "Valor total de débitos", start: 32, end: 49 },
    { name: "Valor total de créditos", start: 50, end: 67 },
    { name: "Reservado", start: 68, end: 106 },
  ],
};

const OVERRIDES: Record<FileProfile, Partial<FieldMap>> = {
  default: {},
  ppd_prenotific: {},
  ppd_devolucion: {
    "7": [
      { name: "Tipo de registro", start: 1, end: 1 },
      { name: "Código Tipo de Registro Adenda", start: 2, end: 3 },
      { name: "Causal de devolución", start: 4, end: 6 },
      { name: "Número de Secuencia de la Transacción Original", start: 7, end: 21 },
      { name: "Fecha de Muerte", start: 22, end: 29 },
      { name: "Código del Participante Receptor de la Transacción Original", start: 30, end: 37 },
      { name: "Información Adicional", start: 38, end: 81 },
      { name: "Número de Secuencia del Registro Adenda", start: 82, end: 96 },
      { name: "Reservado", start: 97, end: 106 },
    ],
  },
  ppd_traslados: {
    "7": [
      { name: "Tipo de registro", start: 1, end: 1 },
      { name: "Código Tipo de Registro Adenda", start: 2, end: 3 },
      { name: "Código EAN ó NIT del facturador", start: 4, end: 16 },
      { name: "Código del Servicio", start: 17, end: 46 },
      { name: "Descripción del servicio", start: 47, end: 61 },
      { name: "Reservado", start: 62, end: 83 },
      { name: "Numero de secuencia de registro de adenda", start: 84, end: 87 },
      { name: "Numero de secuencia de transacción del registro de detalle de transacción", start: 88, end: 94 },
      { name: "Reservado", start: 95, end: 106 },
    ],
  },
  ctx_pagos: {
    "7": [
      { name: "Tipo de registro", start: 1, end: 1 },
      { name: "Código tipo de registro adenda", start: 2, end: 3 },
      { name: "Código EAN 13 o NIT", start: 4, end: 16 },
      { name: "Descripción del servicio", start: 17, end: 31 },
      { name: "Número de referencia de factura", start: 32, end: 51 },
      { name: "Valor factura", start: 52, end: 69 },
      { name: "Reservado", start: 70, end: 83 },
      { name: "Numero de secuencia de registro adenda", start: 84, end: 87 },
      { name: "Numero de secuencia de transacción del registro de detalle de transacciones", start: 88, end: 94 },
      { name: "Reservado", start: 95, end: 106 },
    ],
  },
  ppd_pagos: {
    "7": [
      { name: "Tipo de registro", start: 1, end: 1 },
      { name: "Código tipo de registro adenda", start: 2, end: 3 },
      { name: "Identificación del originador", start: 4, end: 18 },
      { name: "Reservado", start: 19, end: 20 },
      { name: "Propósito de la transacción", start: 21, end: 30 },
      { name: "Numero de factura o cuenta", start: 31, end: 54 },
      { name: "Reservado", start: 55, end: 56 },
      { name: "Información libre del originador", start: 57, end: 80 },
      { name: "Reservado", start: 81, end: 83 },
      { name: "Numero de secuencia de registro adenda", start: 84, end: 87 },
      { name: "Numero de secuencia de registro detalle", start: 88, end: 94 },
      { name: "Reservado", start: 95, end: 106 },
    ],
  },
};

function cloneFieldDefs(list: FieldDef[]): FieldDef[] {
  return list.map((f) => ({ ...f }));
}

function buildFieldMap(overrides: Partial<FieldMap>): FieldMap {
  const out: FieldMap = {};
  for (const [type, fields] of Object.entries(BASE_FIELD_MAP)) {
    out[type] = cloneFieldDefs(fields);
  }
  for (const [type, fields] of Object.entries(overrides || {})) {
    out[type] = cloneFieldDefs(fields || []);
  }
  return out;
}

export const FIELD_MAPS: Record<FileProfile, FieldMap> = {
  default: buildFieldMap(OVERRIDES.default),
  ppd_prenotific: buildFieldMap(OVERRIDES.ppd_prenotific),
  ppd_devolucion: buildFieldMap(OVERRIDES.ppd_devolucion),
  ppd_traslados: buildFieldMap(OVERRIDES.ppd_traslados),
  ctx_pagos: buildFieldMap(OVERRIDES.ctx_pagos),
  ppd_pagos: buildFieldMap(OVERRIDES.ppd_pagos),
};

