// ==== tipos util =====
import type { LineStatus, MarkKind, ValidationOptions } from '@/types/nacham'

const defaultOptions: Required<ValidationOptions> = {
    checkTransCount: true,
    checkDebitos: true,
    checkCreditos: true,
    checkTotalesControl: true,
    includeAdendasInTrans: true,
    serialFromName: '',
}

// Definición local para evitar conflictos
type LineMark = { start: number; end: number; type: MarkKind; note?: string }

// ===== mensajes =====
type WorkerInMsg =
    | { type: 'validate-file'; buffer: ArrayBuffer; options?: ValidationOptions }
    | { type: 'validate-text'; text: string; options?: ValidationOptions }

type WorkerOutMsg =
    | { type: 'progress'; pct: number }
    | {
        type: 'done'
        lineStatus: LineStatus[]
        lineReason: (string | undefined)[]
        globalErrors: string[]
        lineMarks?: LineMark[][]
        isDevolucion?: boolean
    }

// Extensión opcional para avisar “corté en prechecks”
type WorkerDoneMsg = WorkerOutMsg & { precheckFailed?: boolean }

type AllowedInfo = {
    allowed: Set<string> | null
    label: string // para tooltip
}

// ✅ Tipar el contexto del worker (nada de `any`)
declare const self: DedicatedWorkerGlobalScope

// Helper para postear mensajes tipados (sin any)
const ctx = self as unknown as DedicatedWorkerGlobalScope
const post = (msg: WorkerOutMsg): void => { ctx.postMessage(msg) }

// ===== helpers =====
const validStart = new Set(['1', '5', '6', '7', '8', '9'])
const toBig = (s: string) => BigInt((s || '').trim() || '0')
const pad3 = (n: number) => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n))

// Convierte BigInt en centavos a "1234.56" (solo texto)
export const fmtCentsTxt = (
    cents: bigint | number | string,
    thousandSep = ',',
    decimalSep = '.'
): string => {
    // a BigInt siempre, sin perder precisión
    let bi = typeof cents === 'bigint' ? cents : BigInt(String(cents));

    const sign = bi < 0n ? '-' : '';
    if (bi < 0n) bi = -bi;

    // parte entera y fracción (2 decimales)
    const intPart = bi / 100n;
    const fracPart = (bi % 100n).toString().padStart(2, '0');

    // formateo de miles sobre string (no Number)
    let s = intPart.toString();
    // inserta thousandSep cada 3
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, thousandSep);

    return `${sign}${s}${decimalSep}${fracPart}`;
}
// helper para progreso
const postProgress = (pct: number) =>
    post({ type: 'progress', pct } satisfies WorkerOutMsg);

// Secuencia cíclica para el identificador (A..Z 0..9)
const SECUENCIA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Dado "007" -> "G"
const calcIdentFromSerial = (serialStr?: string | null): string | null => {
    if (!serialStr) return null;
    const n = parseInt(serialStr, 10);
    if (!Number.isFinite(n)) return null;
    const idx = (n - 1) % SECUENCIA.length;
    return SECUENCIA[idx];
}

// ✅ Formatea BigInt / número con separador de miles (solo visual para tooltips)
const fmt = (v: bigint | number | string) => {
    const s = typeof v === 'bigint' ? v.toString() : String(v ?? '')
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') // 123456 -> 123,456
}

// ✅ Parseo de montos con 2 decimales implícitos → BigInt en centavos
const toCents = (s: string) => {
    const raw = (s || '').trim() || '0'
    // asume sólo dígitos (con ceros a la izquierda). Si hubiese signos, ajustá acá.
    return BigInt(raw)
}

// ✅ Formatea BigInt de centavos a “9,999,999.99” (sólo visual)
const fmtMoney = (cents: bigint) => {
    const neg = cents < 0n ? '-' : ''
    const abs = cents < 0n ? -cents : cents
    const asStr = abs.toString().padStart(3, '0') // al menos 3 para cortar 2 decimales
    const whole = asStr.slice(0, -2) || '0'
    const frac = asStr.slice(-2)
    const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${neg}${wholeFmt}.${frac}`
}

// ✅ No dupliques marcas; si ya existe, MERGEA la nota (no la pierdas)
const pushUnique = (arr: LineMark[], mark: LineMark) => {
    const i = arr.findIndex(
        (m) => m.start === mark.start && m.end === mark.end && m.type === mark.type
    )
    if (i === -1) {
        arr.push({ ...mark })
    } else if (mark.note) {
        const ex = arr[i]
        if (!ex.note) ex.note = mark.note
        else if (!ex.note.includes(mark.note)) ex.note = `${ex.note} | ${mark.note}`
    }
}
// Devuelve 1..365/366 ó null si la fecha no es válida
const dayOfYear = (yyyy: number, mm: number, dd: number): number | null => {
    if (yyyy < 1900 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
    const d = new Date(yyyy, mm - 1, dd)
    if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null
    const start = new Date(yyyy, 0, 1)
    return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1
}

const norm = (s: string) => (s || '').trim().toUpperCase()

function getAllowedClassesForLot(ts: string, lotClass: string, desc: string): AllowedInfo {
    const t = norm(ts)
    const c = norm(lotClass)
    const d = norm(desc)

    // Regla 1: PPD/CTX + 220 + PRENOTIFICAC -> 33, 23, 53 
    if ((t === 'PPD' || t === 'CTX') && c === '220' && d.startsWith('PRENOTIFIC')) {
        return { allowed: new Set(['33', '23', '53']), label: 'PPD/CTX 220 PRENOTIFIC → {33,23,53}' }
    }

    // Regla 2: PPD/CTX + 220 + PAGOS -> 32, 22
    if ((t === 'PPD' || t === 'CTX') && c === '220' && d.startsWith('PAGOS')) {
        return { allowed: new Set(['32', '22', '52']), label: 'PPD/CTX 220 PAGOS → {32,22,52}' }
    }

    // Regla 3: PPD + 225 + TRASLADOS -> 27, 37
    if (t === 'PPD' && c === '225' && d.startsWith('TRASLADOS')) {
        return { allowed: new Set(['27', '37', '55']), label: 'PPD 225 TRASLADOS → {27,37,55}' }
    }

    return { allowed: null, label: '' } // sin restricción
}

// ===== core =====
function validateCompact(rawCompact: string, optionsIn: ValidationOptions) {
    const compact = rawCompact
    const opts = { ...defaultOptions, ...optionsIn }

    const total = compact.length
    const recsCount = Math.floor(total / 106)

    const lineStatus: LineStatus[] = new Array(recsCount)
    const lineReason: (string | undefined)[] = new Array(recsCount)
    const lineMarks: LineMark[][] = Array.from({ length: recsCount }, () => [])
    const globalErrors: string[] = []

    // === DETECCIÓN DE DEVOLUCIÓN (Registro 1, pos 14–23) ===
    // r0 ocupa 0..105, 14–23 => slice(13,23)
    if (total >= 106) {
        const r0 = compact.slice(0, 106)
        const marca = r0.slice(13, 23).trim()
        if (marca === '011111111') {
            // Es devolución → NO validar nada, devolver vacío
            const emptyStatus = new Array<LineStatus>(recsCount)
            const emptyReason = new Array<string | undefined>(recsCount)
            const emptyMarks = Array.from({ length: recsCount }, () => [] as LineMark[])

            post({ type: 'progress', pct: 100 })
            post({
                type: 'done',
                lineStatus: emptyStatus,
                lineReason: emptyReason,
                globalErrors: [],       // ← sin errores
                lineMarks: emptyMarks,  // ← sin marcas
                isDevolucion: true,
            } as WorkerOutMsg)
            return
        }
    }

    let currentLotClass5: string | null = null;   // clase 2–4 capturada del 5

    // — LOTE: ID 5 vs 8 y secuencia global de lotes —
    let currentLotId5: string | null = null;   // concat 84–98 del reg 5 (8+7)
    let lastLotSeq: number | null = null;      // secuencia global (entre lotes)

    // — Adendas por REG 6 —
    let current6Index: number | null = null;
    let current6AllowsAdenda: boolean = false;   // indicador 87
    let current6SeqSuffix: string | null = null; // 96–102 (7 dígitos)
    let current7Count: number = 0;               // cuántas 7 asociadas llevamos

    // NUEVO: referencias únicas por 6 (adendas 7)
    let current7Refs: Set<string> | null = null                   // valores únicos
    let current7RefFirstIdx: Map<string, number> | null = null    // primera ocurrencia

    const pad4 = (n: number) => n.toString().padStart(4, '0');

    // — Secuenciación global de registros tipo 6 (88–102 = 8+7) —
    let lastSeq6: number | null = null;   // guarda el último consecutivo visto (solo sufijo de 7 dígitos)
    const pad7 = (n: number) => n.toString().padStart(7, '0');
    const SEQ_CODE_EXPECTED = '00001683';

    // --- Identificador (Tipo 1 pos 36) vs serial de nombre de archivo ---
    // options.serialFromName debe traerse desde la UI
    const serialFromName = opts.serialFromName // <- opts = { ...defaultOptions, ...options }

    const expectedId = calcIdentFromSerial(serialFromName)

    // ===== ACUMULADORES / CONTADORES A NIVEL ARCHIVO =====
    let fileCount5 = 0;          // # de lotes (tipo 5)
    let fileCount6 = 0;          // # de detalles (tipo 6)
    let fileCount7 = 0;          // # de adendas (tipo 7)

    let fileSumCtrl = 0n;        // suma de Totales de Control (11–20 de TODOS los tipo 8)
    let fileSumDeb = 0n;        // suma de Débitos declarados (21–38 de TODOS los 8)
    let fileSumCred = 0n;        // suma de Créditos declarados (39–56 de TODOS los 8)

    let first9Index = -1;        // índice del PRIMER registro 9
    let first9Text = '';        // texto completo del PRIMER registro 9

    if (recsCount >= 1 && expectedId) {
        const r0 = compact.slice(0, 106); // registro tipo 1
        const actualId = r0.slice(35, 36); // pos 36 (1-index)
        if (actualId !== expectedId) {
            lineStatus[0] = 'error';
            pushUnique(lineMarks[0], {
                start: 35, end: 36, type: 'error',
                note: `Identificador de archivo ❌. Esperado: ${expectedId}, Actual: ${actualId} (serial ${serialFromName}).`
            });
        } else {
            pushUnique(lineMarks[0], {
                start: 35, end: 36, type: 'ok',
                note: `Identificador de archivo ✅ (${expectedId}) derivado del serial ${serialFromName}.`
            });
        }
    } else if (!expectedId) {
        // si no viene serial, no marcamos error; simplemente no podemos validar
        // (opcional) globalErrors.push('No se pudo validar identificador: falta serial del nombre de archivo.');
    }

    if (total % 106 !== 0) globalErrors.push('Número de caracteres del archivo NO es múltiplo de 106.')
    // firma en tipo 1 (pos 14–23)
    if (recsCount >= 1) {
        const r0 = compact.slice(0, 106)
        const isType1 = r0[0] === '1'
        const firma = r0.slice(14, 23)

        if (!(isType1 && firma === '000016832')) {
            globalErrors.push('El registro no contiene la firma NACHAM.')
        }
    } else {
        globalErrors.push('Archivo demasiado corto para validar la firma.')
    }

    // primer carácter válido (1/5/6/7/8/9)
    const badTypes: number[] = []
    for (let i = 0; i < recsCount; i++) {
        const r = compact.slice(i * 106, i * 106 + 106)
        if (!validStart.has(r[0])) badTypes.push(i)
    }
    if (badTypes.length) globalErrors.push(`Se detectaron ${badTypes.length} registro(s) con tipo inválido (columna 1).`)

    if (globalErrors.length) {
        post({ type: 'progress', pct: 100 } satisfies WorkerOutMsg)

        const emptyStatus: LineStatus[] = Array(recsCount).fill(undefined)
        const emptyReason: (string | undefined)[] = Array(recsCount).fill(undefined)
        const emptyMarks: LineMark[][] = Array.from({ length: recsCount }, () => [])

        post({
            type: 'done',
            lineStatus: emptyStatus,
            lineReason: emptyReason,
            globalErrors,
            lineMarks: emptyMarks,
            precheckFailed: true,
        } as WorkerDoneMsg)

        return
    }

    // variables por lote (5..8)
    let loteStart = -1
    let count6 = 0
    let count7 = 0
    let sumDeb = BigInt(0)
    let sumCred = BigInt(0)
    let sumControl = BigInt(0)

    let countDeb6 = 0
    let lotNeedsUniqueAdendaRef = false

    let lotClass5: string | null = null
    let lotTS5: string | null = null
    let lotDesc5: string | null = null
    let allowed6ForLot: AllowedInfo = { allowed: null, label: '' }

    let lotRec6Code: string | null = null
    let lotRec6Mismatch = false

    // — Por lote: receptor esperado para registros 6 —
    let expectedRecipientInLot: string | null = null; // 8 chars (4–11)
    let expectedCheckDigitInLot: string | null = null; // 1 char (12)

    const step = Math.max(1, Math.floor(recsCount / 20)) // ~5%

    // —— Seguimiento PRENOTIFIC ——
    // Bandera por lote, y primer 6 encontrado dentro de ese lote
    let lotIsPrenotific = false
    let lotFirst6Index: number | null = null

    // Secuencia global entre lotes PRENOTIFIC (primer 6 de cada lote)
    let prenotificExpectedSeq: number | null = null

    console.log('[worker] prechecks', lineMarks?.flat().filter(m => m.type === 'error').length ?? 0)

    for (let i = 0; i < recsCount; i++) {
        const off = i * 106
        const r = compact.slice(off, off + 106)
        const t = r[0]

        // tipo inválido
        if (!validStart.has(t)) {
            lineStatus[i] = 'error'
            lineReason[i] = 'Tipo de registro inválido (columna 1).'
        }


        if (t === '1') {
            // === Reg. 1: Fecha de creación (24–31) ===
            // Posiciones 24–31 -> slice(23, 31) en base 0
            const fechaStr = r.slice(23, 31); // AAAAMMDD

            // Parse
            const yyyy = parseInt(fechaStr.slice(0, 4), 10);
            const mm = parseInt(fechaStr.slice(4, 6), 10);
            const dd = parseInt(fechaStr.slice(6, 8), 10);

            const doy = dayOfYear(yyyy, mm, dd); // ya la usas con el reg. 5
            if (doy === null) {
                // Fecha inválida
                lineStatus[i] = 'error';
                pushUnique(lineMarks[i], {
                    start: 23, end: 31, type: 'error',
                    note: `Fecha de creación ❌ (AAAAMMDD=${fechaStr})`
                });
            } else {
                // Fecha válida (marcado suave)
                pushUnique(lineMarks[i], {
                    start: 23, end: 31, type: 'ok',
                    note: `Fecha de creación ✅ (${fechaStr})`
                });
            }
        }
        else if (t === '5') {
            fileCount5++
            // console.log('[worker] lote abre', { idx: i });
            // abre lote
            loteStart = i
            count6 = 0
            count7 = 0
            sumDeb = BigInt(0)
            sumCred = BigInt(0)
            sumControl = BigInt(0)

            lotClass5 = r.slice(1, 4)      // 2–4
            lotTS5 = r.slice(50, 53)     // 51–53
            lotDesc5 = r.slice(53, 63).trim()     // 54–63
            allowed6ForLot = getAllowedClassesForLot(lotTS5, lotClass5, lotDesc5)

            // NUEVO: sólo si CTX + PAGOS activamos la validación de referencia única
            lotNeedsUniqueAdendaRef = (lotTS5 === 'CTX' && lotDesc5 === 'PAGOS')

            lotRec6Code = null
            lotRec6Mismatch = false

            expectedRecipientInLot = null;
            expectedCheckDigitInLot = null;

            // Clase de transacción del lote (5): posiciones 2–4 => slice(1,4)
            currentLotClass5 = r.slice(1, 4);

            lotIsPrenotific = false
            lotFirst6Index = null

            // Descripción 5: pos 54–63 => slice(53,63)
            const lotDesc = r.slice(53, 63).trim().toUpperCase()
            if (lotDesc.startsWith('PRENOTIFIC')) {
                lotIsPrenotific = true
                pushUnique(lineMarks[i], {
                    start: 53, end: 63, type: 'info',
                    note: 'Lote PRENOTIFIC'
                })
            }

            // (opcional, pinta suave en el 5)
            pushUnique(lineMarks[i], {
                start: 1, end: 4, type: 'info',
                note: `Clase del lote: ${currentLotClass5}`
            });


            // === Reg. 5: Fecha (72–79) y Juliano (80–82) ===
            const fechaStr = r.slice(71, 79)   // AAAAMMDD
            const julianStr = r.slice(79, 82)  // DDD

            const yyyy = parseInt(fechaStr.slice(0, 4), 10)
            const mm = parseInt(fechaStr.slice(4, 6), 10)
            const dd = parseInt(fechaStr.slice(6, 8), 10)

            const doy = dayOfYear(yyyy, mm, dd)
            if (doy === null) {
                lineStatus[i] = 'error'
                pushUnique(lineMarks[i], {
                    start: 71, end: 79, type: 'error',
                    note: `Fecha inválida (AAAAMMDD=${fechaStr})`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 71, end: 79, type: 'ok',
                    note: `Fecha válida (${fechaStr})`
                })
                const expected = pad3(doy)
                if (julianStr !== expected) {
                    lineStatus[i] = 'error'
                    pushUnique(lineMarks[i], {
                        start: 79, end: 82, type: 'error',
                        note: `Juliano ❌. Esperado: ${expected}, Actual: ${julianStr}`
                    })
                } else {
                    pushUnique(lineMarks[i], {
                        start: 79, end: 82, type: 'ok',
                        note: `Juliano ✅ (${julianStr})`
                    })
                }
            }

            // === LOTE: capturar ID del 5 (84–98 => slice(83,98)) ===
            {
                const code5: string = r.slice(83, 91);   // 84–91 (8)
                const seq5: string = r.slice(91, 98);   // 92–98 (7)

                // Validar código
                if (code5 !== SEQ_CODE_EXPECTED) {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 91, type: 'error',
                        note: `Número de lote ❌ (esperado ${SEQ_CODE_EXPECTED})`
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 91, type: 'ok',
                        note: 'Número de lote ✅'
                    });
                }

                // Validar consecutivo (7 dígitos)
                if (!/^\d{7}$/.test(seq5)) {
                    pushUnique(lineMarks[i], {
                        start: 91, end: 98, type: 'error',
                        note: 'Número de lote ❌ (debe ser 7 dígitos 0-padded)'
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 91, end: 98, type: 'ok',
                        note: `Número de lote: ${seq5}`
                    });
                }
            }

        } else if (t === '6' && loteStart >= 0) {

            // Clase de transacción del 6 (2–3)
            const code6 = r.slice(1, 3)

            // Guardamos SOLO el primer 6 del lote PRENOTIFIC
            if (lotIsPrenotific && lotFirst6Index === null) {
                lotFirst6Index = i
            }

            if (allowed6ForLot.allowed) {
                if (!allowed6ForLot.allowed.has(code6)) {
                    pushUnique(lineMarks[i], {
                        start: 1, end: 3, type: 'error',
                        note: `Código Transacción (${code6}) ❌ para el lote: ${allowed6ForLot.label}`
                    })
                    // si querés, también podés marcar el 5 de referencia:
                    if (loteStart >= 0) {
                        pushUnique(lineMarks[loteStart], {
                            start: 1, end: 63, type: 'info',
                            note: `Este lote restringe los códigos de transacción a ${Array.from(allowed6ForLot.allowed).join(', ')}`
                        })
                    }
                } else {
                    // feedback suave de OK
                    pushUnique(lineMarks[i], {
                        start: 1, end: 3, type: 'ok',
                        note: `Código de Transacción (${code6}) ✅ (${allowed6ForLot.label})`
                    })
                }
            }

            if (current6Index !== null) {
                if (current6AllowsAdenda && current7Count === 0) {
                    pushUnique(lineMarks[current6Index], {
                        start: 86, end: 87, type: 'error',
                        note: 'Indicó adendas pero no se encontró ninguna'
                    });
                }
            }

            fileCount6++
            // Valor de la transacción 30–47 => slice(29,47) → en CENTAVOS
            const val = toCents(r.slice(29, 47))

            // Clase 2–3 => slice(1,3). Si es 27/37/55 => DÉBITO, de lo contrario CRÉDITO
            const cls = r.slice(1, 3)
            const isDebit = (cls === '27' || cls === '37' || cls === '55')
            if (isDebit) {
                sumDeb += val
                countDeb6++
            } else {
                sumCred += val
            }

            count6++

            // Código participante receptor 4–11 => slice(3,11)
            const codRec = toBig(r.slice(3, 11))
            sumControl += codRec
            // console.debug('[worker] reg6', { idx: i, val: val.toString(), codRec: codRec.toString() });

            // — Contexto para adendas del 6 —
            current6Index = i;
            current7Count = 0;

            if (lotNeedsUniqueAdendaRef) {
                current7Refs = new Set()
                current7RefFirstIdx = new Map()
            } else {
                current7Refs = null
                current7RefFirstIdx = null
            }

            // Indicador de adenda 87–87 => slice(86,87)
            const adendaFlag = r.slice(86, 87);
            current6AllowsAdenda = (adendaFlag === '1');

            if (adendaFlag !== '0' && adendaFlag !== '1') {
                pushUnique(lineMarks[i], {
                    start: 86, end: 87, type: 'error',
                    note: 'Indicador de adenda inválido (debe ser 0 o 1)'
                });
            } else {
                pushUnique(lineMarks[i], {
                    start: 86, end: 87, type: 'ok',
                    note: `Indicador de adenda: ${adendaFlag === '1' ? '✅' : '❌'}`
                });
            }

            // Sufijo de secuencia del 6: 96–102 => slice(95,102)
            const seq6 = r.slice(95, 102);
            if (/^\d{7}$/.test(seq6)) {
                current6SeqSuffix = seq6;
                // (si querés marcar ok suave)
                pushUnique(lineMarks[i], {
                    start: 95, end: 102, type: 'ok',
                    note: `Secuencia 6: ${seq6}`
                });
            } else {
                current6SeqSuffix = null;
                pushUnique(lineMarks[i], {
                    start: 95, end: 102, type: 'error',
                    note: 'Secuencia 6 inválida (debe ser 7 dígitos)'
                });
            }

            // === Validación: mismo receptor y dígito de chequeo para todos los 6 del lote ===
            // Participante Receptor 4–11 => slice(3,11) (8 chars)
            // Dígito de chequeo       12  => slice(11,12) (1 char)
            {
                const recv: string = r.slice(3, 11);
                const chk: string = r.slice(11, 12);

                if (expectedRecipientInLot === null) {
                    // Primer 6 del lote fija el "esperado"
                    expectedRecipientInLot = recv;
                    expectedCheckDigitInLot = chk;

                    // Marcas suaves de OK para dar feedback al usuario
                    pushUnique(lineMarks[i], {
                        start: 3, end: 11, type: 'ok',
                        note: `Receptor de lote fijado: ${recv}`
                    });
                    pushUnique(lineMarks[i], {
                        start: 11, end: 12, type: 'ok',
                        note: `Dígito de chequeo fijado: ${chk}`
                    });
                } else {
                    // Comparar con lo esperado
                    if (recv !== expectedRecipientInLot) {
                        pushUnique(lineMarks[i], {
                            start: 3, end: 11, type: 'error',
                            note: `Receptor ❌ (esperado ${expectedRecipientInLot}, encontrado ${recv})`
                        });
                    } else {
                        pushUnique(lineMarks[i], {
                            start: 3, end: 11, type: 'ok',
                            note: 'Receptor ✅'
                        });
                    }

                    if (chk !== expectedCheckDigitInLot) {
                        pushUnique(lineMarks[i], {
                            start: 11, end: 12, type: 'error',
                            note: `Dígito de chequeo distinto en lote ❌ (esperado ${expectedCheckDigitInLot}, encontrado ${chk})`
                        });
                    } else {
                        pushUnique(lineMarks[i], {
                            start: 11, end: 12, type: 'ok',
                            note: 'Dígito de chequeo ✅'
                        });
                    }
                }
            }


            {  // >>> NUEVO: validar consistencia de Participante Receptor pos 4–11 (slice 3,11)
                const codRec = r.slice(3, 11)        // exacto, sin trim
                if (lotRec6Code === null) {
                    lotRec6Code = codRec               // baseline del lote
                } else if (codRec !== lotRec6Code) {
                    lotRec6Mismatch = true
                    lineStatus[i] = 'error'
                    pushUnique(lineMarks[i], {
                        start: 3, end: 11, type: 'error',
                        note: `Participante Receptor ❌ Esperado ${lotRec6Code}, encontrado ${codRec}.`
                    })
                }
            }

            // === Validación: Número de Secuencia (pos 88-102 => slice(87,102)) ===
            {
                const seqCode = r.slice(87, 95);         // 88-95
                const seqNum = r.slice(95, 102);        // 96-102

                // 1) Código fijo "00001683"
                if (seqCode !== SEQ_CODE_EXPECTED) {
                    pushUnique(lineMarks[i], {
                        start: 87, end: 95, type: 'error',
                        note: `Código de Originador ❌ (esperado ${SEQ_CODE_EXPECTED})`
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 87, end: 95, type: 'ok',
                        note: 'Código de Originador ✅'
                    });
                }

                // 2) Sufijo: 7 dígitos y secuencial
                const is7Digits: boolean = /^\d{7}$/.test(seqNum);
                if (!is7Digits) {
                    pushUnique(lineMarks[i], {
                        start: 95, end: 102, type: 'error',
                        note: 'Consecutivo ❌ (debe ser 7 dígitos 0-padded)'
                    });
                } else {
                    const current: number = parseInt(seqNum, 10);

                    if (lastSeq6 === null) {
                        // Primer 6: base
                        lastSeq6 = current;
                        pushUnique(lineMarks[i], {
                            start: 95, end: 102, type: 'ok',
                            note: `Consecutivo base ${pad7(current)}`
                        });
                    } else {
                        const expectedNum: number = lastSeq6 + 1
                        if (current !== expectedNum) {
                            pushUnique(lineMarks[i], {
                                start: 95, end: 102, type: 'error',
                                note: `Consecutivo ❌ Esperado ${pad7(expectedNum)}, encontrado ${seqNum}`
                            });
                            // Opción A: continuar contando desde el encontrado
                            lastSeq6 = current;
                        } else {
                            pushUnique(lineMarks[i], {
                                start: 95, end: 102, type: 'ok',
                                note: `Consecutivo ✅ (${seqNum})`
                            });
                            lastSeq6 = current;
                        }
                    }
                }
            }     // fin validación secuencia

        } else if (t === '7' && loteStart >= 0) {
            fileCount7++
            count7++

            // — Validaciones de adenda asociada a un 6 previo —
            if (current6Index === null) {
                // 7 sin 6 anterior: marcar todo el 7 como error leve
                pushUnique(lineMarks[i], {
                    start: 0, end: 106, type: 'error',
                    note: 'Adenda sin registro 6 precedente'
                });
            } else {
                // a) Si el 6 dijo "no adenda", cualquier 7 es error
                if (!current6AllowsAdenda) {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 87, type: 'error',
                        note: 'Adenda inesperada: el 6 indicó que no lleva adendas'
                    });
                    // Opcional: remarcar el flag del 6
                    pushUnique(lineMarks[current6Index], {
                        start: 86, end: 87, type: 'info',
                        note: 'Este 6 indicó que no hay adendas'
                    });
                }

                // b) Validar secuencia de adenda 84–87 => slice(83,87) = 4 dígitos 0001,0002...
                const seq7 = r.slice(83, 87);
                const is4 = /^\d{4}$/.test(seq7);
                const expected4 = pad4(current7Count + 1);
                if (!is4) {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 87, type: 'error',
                        note: 'Nº de adenda inválido (debe ser 4 dígitos 0-padded)'
                    });
                } else if (seq7 !== expected4) {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 87, type: 'error',
                        note: `Nº de adenda esperado ${expected4}, encontrado ${seq7}`
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 87, type: 'ok',
                        note: `Adenda #${expected4}`
                    });
                }

                // c) Validar vínculo con secuencia del 6: 7.pos 88–94 => slice(87,94) debe == 6.pos 96–102
                const seq7Tx = r.slice(87, 94);
                if (current6SeqSuffix && /^\d{7}$/.test(seq7Tx)) {
                    if (seq7Tx !== current6SeqSuffix) {
                        pushUnique(lineMarks[i], {
                            start: 87, end: 94, type: 'error',
                            note: `Transacción de 7 (${seq7Tx}) ≠ secuencia del 6 (${current6SeqSuffix}) ❌`
                        });
                        // opcional: ayuda visual en el 6
                        pushUnique(lineMarks[current6Index], {
                            start: 95, end: 102, type: 'info',
                            note: 'Secuencia del 6 esperada por sus adendas'
                        });
                    } else {
                        pushUnique(lineMarks[i], {
                            start: 87, end: 94, type: 'ok',
                            note: 'Adenda enlazada al 6 ✅'
                        });
                    }
                }

                // d) Referencia única por 6 (aplica SOLO si el lote lo requiere)
                if (lotNeedsUniqueAdendaRef && current7Refs && current7RefFirstIdx) {
                    const rawRef = r.slice(31, 51)   // 32–51
                    const normRef = rawRef.trim()      // normalizamos (si querés conservar espacios internos, no los toques)

                    if (normRef.length === 0) {
                        // Referencia vacía: lo marcamos como error (opcional)
                        pushUnique(lineMarks[i], {
                            start: 31, end: 51, type: 'error',
                            note: 'Referencia (pos. 32–51) vacía en adenda'
                        })
                        lineStatus[i] = 'error'
                    } else if (current7Refs.has(normRef)) {
                        // Duplicado dentro del MISMO 6 → error
                        pushUnique(lineMarks[i], {
                            start: 31, end: 51, type: 'error',
                            note: `Referencia duplicada para este 6: “${normRef}”`
                        })
                        // Señalá la primera ocurrencia para ayudar a ubicarla
                        const firstIdx = current7RefFirstIdx.get(normRef)
                        if (typeof firstIdx === 'number') {
                            pushUnique(lineMarks[firstIdx], {
                                start: 31, end: 51, type: 'info',
                                note: 'Primera ocurrencia de esta referencia'
                            })
                        }
                        lineStatus[i] = 'error'
                    } else {
                        // Primera vez que aparece en este 6 → OK suave
                        current7Refs.add(normRef)
                        current7RefFirstIdx.set(normRef, i)
                        pushUnique(lineMarks[i], {
                            start: 31, end: 51, type: 'ok',
                            note: 'Referencia única ✅'
                        })
                    }
                }

                // ── Validación: Código Tipo de Registro Adenda (pos 2–3) sólo '05' o '99'
                const adendaCode = r.slice(1, 3)
                if (adendaCode !== '05') {
                    // pinta error sobre 2–3
                    pushUnique(lineMarks[i], {
                        start: 1, end: 3, type: 'error',
                        note: `Código de adenda ❌ (${adendaCode}). Permitido: 05`
                    })
                    // si querés marcar la fila como error de lote:
                    lineStatus[i] = 'error'
                } else {
                    // pinta validación OK sobre 2–3 (suave, para tranquilidad del usuario)
                    pushUnique(lineMarks[i], {
                        start: 1, end: 3, type: 'ok',
                        note: `Código de adenda ✅ (${adendaCode})`
                    })
                }

                // incrementar contador de adendas vistas para este 6
                current7Count += 1;
            }

        } else if (t === '8' && loteStart >= 0) {
            // — Cierre de 6 pendiente antes de cerrar lote
            if (current6Index !== null) {
                if (current6AllowsAdenda && current7Count === 0) {
                    pushUnique(lineMarks[current6Index], {
                        start: 86, end: 87, type: 'error',
                        note: 'Indicó adendas pero no se encontró ninguna'
                    });
                }
            }
            // Reset contexto 6
            current6Index = null;
            current6AllowsAdenda = false;
            current6SeqSuffix = null;
            current7Count = 0;

            current7Refs = null
            current7RefFirstIdx = null

            // === Declarados en 8 ===
            const declaredTrans = parseInt(r.slice(4, 10).trim() || '0', 10); // 5–10
            const declaredCtrl = toBig(r.slice(10, 20));                   // 11–20
            const declaredDeb = toCents(r.slice(20, 38));                   // 21–38
            const declaredCred = toCents(r.slice(38, 56));                   // 39–56

            // Para totales de archivo
            fileSumCtrl += declaredCtrl;
            fileSumDeb += declaredDeb;
            fileSumCred += declaredCred;

            const gotTrans = count6 + count7;

            const checks: string[] = [];
            let okTrans = true, okCtrl = true;
            const okCred = true

            // Transacciones
            if (gotTrans !== declaredTrans) {
                okTrans = false;
                checks.push(`Trans esperadas ${declaredTrans}, calc ${gotTrans}`);
                pushUnique(lineMarks[i], {
                    start: 4, end: 10, type: 'error',
                    note: `Transacciones ❌. Esperado: ${declaredTrans}, Calculado: ${gotTrans}`
                });
            } else {
                pushUnique(lineMarks[i], {
                    start: 4, end: 10, type: 'ok',
                    note: `Transacciones ✅ (${declaredTrans})`
                });
            }

            const okDeb = (sumDeb === declaredDeb)
            if (!okDeb) {
                checks.push(`Débitos esperados ${fmtMoney(declaredDeb)} ≠ suma ${fmtMoney(sumDeb)}`)
                pushUnique(lineMarks[i], {
                    start: 20, end: 38, type: 'error',
                    note: `Débitos ❌ Esperado: ${fmtMoney(declaredDeb)}, Suma: ${fmtMoney(sumDeb)}`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 20, end: 38, type: 'ok',
                    note: `Débitos ✅ (${fmtMoney(declaredDeb)})`
                })
            }

            {  // === Reglas PRENOTIFIC: validar ÚNICAMENTE el primer 6 del lote ===
                if (lotIsPrenotific) {
                    if (lotFirst6Index === null) {
                        // No se encontró ningún 6 en el lote PRENOTIFIC
                        pushUnique(lineMarks[loteStart], {
                            start: 53, end: 63, type: 'error',
                            note: 'Lote PRENOTIFIC sin registro 6 ❌'
                        })
                        pushUnique(lineMarks[i], {
                            start: 3, end: 11, type: 'error',
                            note: 'Cierre de PRENOTIFIC sin detalle (6) ❌'
                        })
                    } else {
                        const i6 = lotFirst6Index
                        const r6 = compact.slice(i6 * 106, i6 * 106 + 106)

                        // Consecutivo en 6: pos 13–29 => slice(12,29)
                        const seqStr = r6.slice(12, 29).trim()
                        const seqNum = /^\d+$/.test(seqStr) ? parseInt(seqStr, 10) : NaN

                        // Zeros 48–62 => slice(47,62)
                        const field4862 = r6.slice(47, 62)
                        const isSingleZero = field4862.trim() === '0'

                        // Zeros: marcar ok/error
                        if (!isSingleZero) {
                            pushUnique(lineMarks[i6], {
                                start: 47, end: 62, type: 'error',
                                note: 'Identificador debe ser 0 en el registro de control ❌'
                            })
                        } else {
                            pushUnique(lineMarks[i6], {
                                start: 47, end: 62, type: 'ok',
                                note: 'Identificador 0 ✅'
                            })
                        }

                        // Secuencia global entre lotes PRENOTIFIC (solo el PRIMER 6 de cada lote)
                        if (!Number.isFinite(seqNum)) {
                            pushUnique(lineMarks[i6], {
                                start: 12, end: 29, type: 'error',
                                note: `Consecutivo registro control ❌ (${seqStr})`
                            })
                        } else if (prenotificExpectedSeq === null) {
                            // primer lote PRENOTIFIC: fijamos base
                            prenotificExpectedSeq = seqNum + 1
                            pushUnique(lineMarks[i6], {
                                start: 12, end: 29, type: 'ok',
                                note: `Consecutivo registro control  base (${seqNum})`
                            })
                        } else {
                            const expected: number = prenotificExpectedSeq
                            if (seqNum !== expected) {
                                pushUnique(lineMarks[i6], {
                                    start: 12, end: 29, type: 'error',
                                    note: `Registro de control ❌. Esperado: ${expected}, encontrado: ${seqNum}`
                                })
                                // sincronizamos para el siguiente lote
                                prenotificExpectedSeq = seqNum + 1
                            } else {
                                pushUnique(lineMarks[i6], {
                                    start: 12, end: 29, type: 'ok',
                                    note: `Consecutivo registro de control ✅ (${seqNum})`
                                })
                                prenotificExpectedSeq = expected + 1
                            }
                        }
                    }
                }
            }

            {// --- Clase de transacción 5 (2–4) vs 8 (2–4) ---
                const class8 = r.slice(1, 4);   // posiciones 2–4 en el 8

                if (currentLotClass5 !== null) {
                    if (class8 !== currentLotClass5) {
                        // Marca error en el 8 y referencia en el 5
                        pushUnique(lineMarks[i], {
                            start: 1, end: 4, type: 'error',
                            note: `Clase en 8 (${class8}) ≠ clase en 5 (${currentLotClass5})`
                        });
                        pushUnique(lineMarks[loteStart], {
                            start: 1, end: 4, type: 'info',
                            note: `Clase del lote (5): ${currentLotClass5}`
                        });

                        // (opcional) refleja en el estado del lote para que se pinte rojo
                        // si ya usás 'checks' y pintás 5..8 en rojo cuando hay errores:
                        checks.push('Clase 5 vs 8 no coincide');
                        // si querés que esta regla haga fallar el lote
                    } else {
                        // Ok visual en el 8
                        pushUnique(lineMarks[i], {
                            start: 1, end: 4, type: 'ok',
                            note: `Clase 8 coincide con 5 (${class8})`
                        });
                    }
                }
            }

            // --- Créditos (39–56) ---
            // Regla nueva: si el lote trae **algún** reg 6 de DÉBITO (27/37/55),
            // el valor de CRÉDITO declarado en 8 DEBE SER 0.
            if (countDeb6 > 0) {
                const okCredZero = (declaredCred === 0n)
                if (!okCredZero) {
                    checks.push(`Créditos en 8 deben ser 0 para lotes de débito; encontrado ${fmtMoney(declaredCred)}`)
                    pushUnique(lineMarks[i], {
                        start: 38, end: 56, type: 'error',
                        note: `Créditos ❌ Esperado: 0, Encontrado: ${fmtMoney(declaredCred)}`
                    })
                } else {
                    pushUnique(lineMarks[i], {
                        start: 38, end: 56, type: 'ok',
                        note: 'Créditos ✅ (0 para lote de débito)'
                    })
                }
            } else {
                // Lote sin débitos => validación normal (crédito informado = suma de créditos de reg 6)
                const okCred = (sumCred === declaredCred)
                if (!okCred) {
                    checks.push(`Créditos esperados ${fmtMoney(declaredCred)} ≠ suma ${fmtMoney(sumCred)}`)
                    pushUnique(lineMarks[i], {
                        start: 38, end: 56, type: 'error',
                        note: `Créditos ❌ Esperado: ${fmtMoney(declaredCred)}, Suma: ${fmtMoney(sumCred)}`
                    })
                } else {
                    pushUnique(lineMarks[i], {
                        start: 38, end: 56, type: 'ok',
                        note: `Créditos ✅ (${fmtMoney(declaredCred)})`
                    })
                }
            }
            // Totales de Control
            if (sumControl !== declaredCtrl) {
                okCtrl = false;
                checks.push(`Totales de Control esperados ${fmt(declaredCtrl)} ≠ suma ${fmt(sumControl)}`);
                pushUnique(lineMarks[i], {
                    start: 10, end: 20, type: 'error',
                    note: `Totales de Control ❌ Esperado: ${fmt(declaredCtrl)}, Suma: ${fmt(sumControl)}`
                });
            } else {
                pushUnique(lineMarks[i], {
                    start: 10, end: 20, type: 'ok',
                    note: `Totales de Control ✅ (${fmt(declaredCtrl)})`
                });
            }

            // === ID de lote 5 (84–98) vs 8 (92–106) y secuencia global ===
            // En 8: 92–99 (código) y 100–106 (consecutivo)
            const code8 = r.slice(91, 99);
            const seq8 = r.slice(99, 106);
            const id8 = code8 + seq8;

            if (code8 !== SEQ_CODE_EXPECTED) {
                pushUnique(lineMarks[i], {
                    start: 91, end: 99, type: 'error',
                    note: `Número de lote en 8 ❌ Esperado ${SEQ_CODE_EXPECTED}`
                });
            } else {
                pushUnique(lineMarks[i], {
                    start: 91, end: 99, type: 'ok',
                    note: 'Número de lote en 8 ✅'
                });
            }

            if (!/^\d{7}$/.test(seq8)) {
                pushUnique(lineMarks[i], {
                    start: 99, end: 106, type: 'error',
                    note: 'Número de lote en 8 ❌ (7 dígitos 0-padded)'
                });
            } else {
                pushUnique(lineMarks[i], {
                    start: 99, end: 106, type: 'ok',
                    note: `Número de lote en 8: ${seq8}`
                });
            }

            if (currentLotId5 !== null) {
                if (id8 !== currentLotId5) {
                    checks.push('ID 5≠8');
                    pushUnique(lineMarks[i], {
                        start: 91, end: 106, type: 'error',
                        note: `ID de lote en 8 (${code8}+${seq8}) ≠ ID en 5 (${currentLotId5})`
                    });
                    pushUnique(lineMarks[loteStart], {
                        start: 83, end: 98, type: 'info',
                        note: 'ID de lote en 5 que no coincide con el 8 correspondiente ❌'
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 91, end: 106, type: 'ok',
                        note: 'ID de lote en 8 coincide con el registrado en 5 ✅'
                    });
                }
            }

            // Secuencia global de lotes por 8
            if (/^\d{7}$/.test(seq8)) {
                const seqNum = parseInt(seq8, 10);
                if (lastLotSeq === null) {
                    lastLotSeq = seqNum;
                    pushUnique(lineMarks[i], {
                        start: 99, end: 106, type: 'ok',
                        note: `Consecutivo global base ${pad7(seqNum)}`
                    });
                } else {
                    if (lastLotSeq !== null) {
                        const expected: number = lastLotSeq + 1;
                        if (seqNum !== expected) {
                            pushUnique(lineMarks[i], {
                                start: 99, end: 106, type: 'error',
                                note: `Consecutivo de lote ❌ Esperado ${pad7(expected)}, encontrado ${seq8}`
                            });
                            // avanzamos el cursor a lo encontrado
                            lastLotSeq = seqNum;
                        } else {
                            pushUnique(lineMarks[i], {
                                start: 99, end: 106, type: 'ok',
                                note: `Consecutivo de lote ✅ (${seq8})`
                            });
                            lastLotSeq = seqNum;
                        }
                    }
                }
            }

            // >>> Consistencia de participante receptor 6 dentro del lote
            if (lotRec6Mismatch) {
                checks.push('Inconsistencias de Participante Receptor en registros 6 del lote.');
            }

            // Resultado final del lote (una sola vez)
            const lotOk = okTrans && okDeb && okCred && okCtrl && !lotRec6Mismatch;
            for (let j = loteStart; j <= i; j++) lineStatus[j] = lotOk ? 'ok' : 'error';
            if (!lotOk && checks.length) lineReason[i] = checks.join(' | ');

            // Cerrar lote / reset
            loteStart = -1;
            count6 = 0; count7 = 0;
            sumDeb = 0n; sumCred = 0n; sumControl = 0n;
            countDeb6 = 0

            currentLotId5 = null;
            lotRec6Code = null;
            lotRec6Mismatch = false;
            expectedRecipientInLot = null;
            expectedCheckDigitInLot = null;
            lotClass5 = null
            lotTS5 = null
            lotDesc5 = null
            allowed6ForLot = { allowed: null, label: '' }
            currentLotClass5 = null;
            currentLotClass5 = null;
            lotIsPrenotific = false
            lotFirst6Index = null
        }
        else if (t === '9') {
            if (first9Index === -1) {
                first9Index = i;
                first9Text = r;
            } else {
                // resto de 9 => relleno informativo
                pushUnique(lineMarks[i], {
                    start: 0, end: 106, type: 'info',
                    note: 'Registro 9 de relleno'
                });
            }
        }

        if (i % step === 0) {
            const pct = Math.floor((i / Math.max(1, recsCount)) * 100);
            postProgress(pct);
        }
    }

    if (first9Index >= 0) {
        const r9 = first9Text;

        // Declarados en el trailer (posiciones 1-index):
        const decLots = parseInt(r9.slice(1, 7).trim() || '0', 10);   // 2–7
        const decBlocks = parseInt(r9.slice(7, 13).trim() || '0', 10);  // 8–13
        const decTranAd = parseInt(r9.slice(13, 21).trim() || '0', 10); // 14–21
        const decCtrl = toBig(r9.slice(21, 31));                       // 22–31
        const decDeb = toBig(r9.slice(31, 49));                       // 32–49
        const decCred = toBig(r9.slice(49, 67));                       // 50–67

        // Esperados por nuestro cálculo a nivel archivo:
        const expLots = fileCount5;
        const expBlocks = Math.ceil(recsCount / 10);     // bloques de 10
        const expTranAd = fileCount6 + fileCount7;
        const expCtrl = fileSumCtrl;
        const expDeb = fileSumDeb;
        const expCred = fileSumCred;

        let ok9 = true;

        // 1) Lotes 2–7
        if (decLots !== expLots) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 1, end: 7, type: 'error',
                note: `Lotes ❌ Esperado ${expLots}, declarado ${decLots}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 1, end: 7, type: 'ok',
                note: `Lotes ✅ (${expLots})`
            });
        }

        // 2) Bloques 8–13
        if (decBlocks !== expBlocks) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 7, end: 13, type: 'error',
                note: `Bloques ❌ Esperado ${expBlocks}, declarado ${decBlocks}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 7, end: 13, type: 'ok',
                note: `Bloques ✅ (${expBlocks})`
            });
        }

        // 3) Transacciones + adendas 14–21
        if (decTranAd !== expTranAd) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 13, end: 21, type: 'error',
                note: `Trans/Adenda ❌ Esperado ${expTranAd}, declarado ${decTranAd}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 13, end: 21, type: 'ok',
                note: `Trans/Adenda ✅ (${fmt(expTranAd)})`
            });
        }

        // 4) Totales de control 22–31
        if (decCtrl !== expCtrl) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 21, end: 31, type: 'error',
                note: `Totales de Control ❌ Esperado ${expCtrl.toString()}, declarado ${decCtrl.toString()}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 21, end: 31, type: 'ok',
                note: `Totales Control ✅ (${fmt(expCtrl.toString())})`
            });
        }

        // 5) Débitos 32–49 (formateo en centavos a texto)
        if (decDeb !== expDeb) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 31, end: 49, type: 'error',
                note: `Débitos ❌ Esperado ${fmtCentsTxt(expDeb, ',', '.')}, declarado ${fmtCentsTxt(decDeb, ',', '.')}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 31, end: 49, type: 'ok',
                note: `Débitos ✅ (${fmtCentsTxt(expDeb, ',', '.')})`
            });
        }

        // 6) Créditos 50–67
        if (decCred !== expCred) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 49, end: 67, type: 'error',
                note: `Créditos ❌ Esperado ${fmtCentsTxt(expCred, ',', '.')}, declarado ${fmtCentsTxt(decCred, ',', '.')}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 49, end: 67, type: 'ok',
                note: `Créditos ✅ (${fmtCentsTxt(expCred, ',', '.')})`
            });
        }

        // Estado de la línea 9 principal
        lineStatus[first9Index] = ok9 ? 'ok' : 'error';
    } else {
        // No se encontró un 9 “principal”
        globalErrors.push('No se encontró el primer registro 9 (trailer).');
    }

    postProgress(100);
    post({
        type: 'done',
        lineStatus,
        lineReason,
        globalErrors,
        lineMarks,
    } satisfies WorkerOutMsg);
}

// ===== wiring =====
self.onmessage = (e: MessageEvent<WorkerInMsg>) => {
    const msg = e.data
    if (msg.type === 'validate-file') {
        const text = new TextDecoder('utf-8').decode(msg.buffer)
        const compact = text.replace(/^\uFEFF/, '').replace(/\r?\n/g, '')
        validateCompact(compact, msg.options ?? {})
    } else if (msg.type === 'validate-text') {
        const compact = msg.text.replace(/^\uFEFF/, '').replace(/\r?\n/g, '')
        validateCompact(compact, msg.options ?? {})
    }
}