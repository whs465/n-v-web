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
    }

// Extensión opcional para avisar “corté en prechecks”
type WorkerDoneMsg = WorkerOutMsg & { precheckFailed?: boolean }

// ✅ Tipar el contexto del worker (nada de `any`)
declare const self: DedicatedWorkerGlobalScope

// Helper para postear mensajes tipados (sin any)
const post = (m: WorkerOutMsg | WorkerDoneMsg) => self.postMessage(m)

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

    // — LOTE: ID 5 vs 8 y secuencia global de lotes —
    let currentLotId5: string | null = null;   // concat 84–98 del reg 5 (8+7)
    let currentLotSeq5: number | null = null;  // sólo el sufijo de 7 dígitos del reg 5
    let lastLotSeq: number | null = null;      // secuencia global (entre lotes)

    // — Adendas por REG 6 —
    let current6Index: number | null = null;
    let current6AllowsAdenda: boolean = false;   // indicador 87
    let current6SeqSuffix: string | null = null; // 96–102 (7 dígitos)
    let current7Count: number = 0;               // cuántas 7 asociadas llevamos

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
                note: `Identificador incorrecto. Esperado: ${expectedId}, Actual: ${actualId} (serial ${serialFromName}).`
            });
        } else {
            pushUnique(lineMarks[0], {
                start: 35, end: 36, type: 'ok',
                note: `Identificador correcto (${expectedId}) derivado del serial ${serialFromName}.`
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

    const step = Math.max(1, Math.floor(recsCount / 20)) // ~5%

    for (let i = 0; i < recsCount; i++) {
        const off = i * 106
        const r = compact.slice(off, off + 106)
        const t = r[0]

        // tipo inválido
        if (!validStart.has(t)) {
            lineStatus[i] = 'error'
            lineReason[i] = 'Tipo de registro inválido (columna 1).'
        }

        if (t === '5') {
            fileCount5++
            // console.log('[worker] lote abre', { idx: i });
            // abre lote
            loteStart = i
            count6 = 0
            count7 = 0
            sumDeb = BigInt(0)
            sumCred = BigInt(0)
            sumControl = BigInt(0)

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
                        note: `Juliano incorrecto. Esperado: ${expected}, Actual: ${julianStr}`
                    })
                } else {
                    pushUnique(lineMarks[i], {
                        start: 79, end: 82, type: 'ok',
                        note: `Juliano correcto (${julianStr})`
                    })
                }
            }

            // === LOTE: capturar ID del 5 (84–98 => slice(83,98)) ===
            {
                const code5: string = r.slice(83, 91);   // 84–91 (8)
                const seq5: string = r.slice(91, 98);   // 92–98 (7)
                currentLotId5 = code5 + seq5;

                // Validar código
                if (code5 !== SEQ_CODE_EXPECTED) {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 91, type: 'error',
                        note: `Código de lote inválido (esperado ${SEQ_CODE_EXPECTED})`
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 83, end: 91, type: 'ok',
                        note: 'Código de lote correcto'
                    });
                }

                // Validar consecutivo (7 dígitos)
                if (!/^\d{7}$/.test(seq5)) {
                    pushUnique(lineMarks[i], {
                        start: 91, end: 98, type: 'error',
                        note: 'Consecutivo de lote inválido (debe ser 7 dígitos 0-padded)'
                    });
                    currentLotSeq5 = null;
                } else {
                    const seqNum5: number = parseInt(seq5, 10);
                    currentLotSeq5 = seqNum5;
                    pushUnique(lineMarks[i], {
                        start: 91, end: 98, type: 'ok',
                        note: `Consecutivo de lote en 5: ${seq5}`
                    });
                }
            }

        } else if (t === '6' && loteStart >= 0) {
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
            // si querés distinguir débitos/créditos, ajustá aquí según tu regla
            sumCred += val

            count6++

            // Código participante receptor 4–11 => slice(3,11)
            const codRec = toBig(r.slice(3, 11))
            sumControl += codRec
            // console.debug('[worker] reg6', { idx: i, val: val.toString(), codRec: codRec.toString() });

            // — Contexto para adendas del 6 —
            current6Index = i;
            current7Count = 0;

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
                    note: `Indicador de adenda: ${adendaFlag === '1' ? 'permite' : 'no permite'}`
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
                                note: `Consecutivo esperado ${pad7(expectedNum)}, encontrado ${seqNum}`
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
                            note: `Transacción de 7 (${seq7Tx}) ≠ secuencia del 6 (${current6SeqSuffix})`
                        });
                        // opcional: ayuda visual en el 6
                        pushUnique(lineMarks[current6Index], {
                            start: 95, end: 102, type: 'info',
                            note: 'Secuencia del 6 esperada por sus adendas'
                        });
                    } else {
                        pushUnique(lineMarks[i], {
                            start: 87, end: 94, type: 'ok',
                            note: 'Adenda enlazada al 6 correcto'
                        });
                    }
                } else {
                    pushUnique(lineMarks[i], {
                        start: 87, end: 94, type: 'error',
                        note: 'Referencia de transacción de 7 inválida'
                    });
                }

                // incrementar contador de adendas vistas para este 6
                current7Count += 1;
            }

        } else if (t === '8' && loteStart >= 0) {
            // Chequeo final del 6 actual antes de cerrar lote
            if (current6Index !== null) {
                if (current6AllowsAdenda && current7Count === 0) {
                    pushUnique(lineMarks[current6Index], {
                        start: 86, end: 87, type: 'error',
                        note: 'Indicó adendas pero no se encontró ninguna'
                    });
                }
            }

            // Reset contexto 6 para el próximo ciclo/lote
            current6Index = null;
            current6AllowsAdenda = false;
            current6SeqSuffix = null;
            current7Count = 0;

            // Acumular lo declarado en cada 8:
            const decCtrl = toBig(r.slice(10, 20)); // 11–20
            const decDeb = toBig(r.slice(20, 38)); // 21–38
            const decCred = toBig(r.slice(38, 56)); // 39–56
            fileSumCtrl += decCtrl;
            fileSumDeb += decDeb;
            fileSumCred += decCred;
            // #Trans/Adenda: 5–10 => slice(4,10)
            // Totales de Control: 11–20 => slice(10,20)
            // Valor Débitos: 21–38 => slice(20,38)
            // Valor Créditos: 39–56 => slice(38,56)
            const declaredTrans = parseInt(r.slice(4, 10).trim() || '0', 10)
            const declaredCtrl = toBig(r.slice(10, 20))
            const declaredDeb = toCents(r.slice(20, 38))  // 21–38
            const declaredCred = toCents(r.slice(38, 56))  // 39–56

            const gotTrans = count6 + count7

            const checks: string[] = []
            let ok = true

            // Transacciones (5–10 => slice 4..10)
            const okTrans = gotTrans === declaredTrans
            if (!okTrans) {
                ok = false
                checks.push(`Trans esperadas ${declaredTrans}, calc ${gotTrans}`)
                pushUnique(lineMarks[i], {
                    start: 4, end: 10, type: 'error',
                    note: `Transacciones ❌. Esperado: ${declaredTrans}, Calculado: ${gotTrans}`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 4, end: 10, type: 'ok',
                    note: `Transacciones ✅ (${declaredTrans})`
                })
            }

            // Débitos (21–38 => slice 20..38)
            const okDeb = sumDeb === declaredDeb
            if (!okDeb) {
                ok = false
                checks.push(`Débitos esperados ${declaredDeb} ≠ suma ${sumDeb}`)
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

            // Créditos (39–56 => slice 38..56)
            const okCred = sumCred === declaredCred
            if (!okCred) {
                ok = false
                checks.push(`Créditos esperados ${declaredCred} ≠ suma ${sumCred}`)
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

            // Totales de Control (11–20 => slice 10..20)
            const okCtrl = sumControl === declaredCtrl
            if (!okCtrl) {
                ok = false
                checks.push(`Totales de Control esperados ${declaredCtrl} ≠ suma ${sumControl}`)
                pushUnique(lineMarks[i], {
                    start: 10, end: 20, type: 'error',
                    note: `Totales de Control ❌ Esperado: ${fmt(declaredCtrl)}, Suma: ${fmt(sumControl)}`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 10, end: 20, type: 'ok',
                    note: `Totales de Control ✅ (${fmt(declaredCtrl)})`
                })
            }

            // Pinta 5..8
            for (let j = loteStart; j <= i; j++) lineStatus[j] = ok ? 'ok' : 'error'
            if (!ok && checks.length) lineReason[i] = checks.join(' | ')

            // === LOTE: comparar ID 5 (84–98) con 8 (92–106) y secuencia global ===
            {
                // En 8: 92–99 (8) + 100–106 (7) => slice(91,99) y slice(99,106)
                const code8: string = r.slice(91, 99);
                const seq8: string = r.slice(99, 106);
                const id8: string = code8 + seq8;

                // 8: validar formato local (código + 7 dígitos)
                if (code8 !== SEQ_CODE_EXPECTED) {
                    pushUnique(lineMarks[i], {
                        start: 91, end: 99, type: 'error',
                        note: `Código de lote en 8 inválido (esperado ${SEQ_CODE_EXPECTED})`
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 91, end: 99, type: 'ok',
                        note: 'Código de lote en 8 correcto'
                    });
                }

                if (!/^\d{7}$/.test(seq8)) {
                    pushUnique(lineMarks[i], {
                        start: 99, end: 106, type: 'error',
                        note: 'Consecutivo de lote en 8 inválido (debe ser 7 dígitos 0-padded)'
                    });
                } else {
                    pushUnique(lineMarks[i], {
                        start: 99, end: 106, type: 'ok',
                        note: `Consecutivo de lote en 8: ${seq8}`
                    });
                }

                // Comparar 5 vs 8 (deben ser idénticos)
                if (currentLotId5 !== null) {
                    if (id8 !== currentLotId5) {
                        // Marcar error en 8, y también marcar en 5 para ayudar al usuario
                        pushUnique(lineMarks[i], {
                            start: 91, end: 106, type: 'error',
                            note: `ID de lote en 8 (${code8}+${seq8}) ≠ ID en 5 (${currentLotId5})`
                        });
                        pushUnique(lineMarks[loteStart], {
                            start: 83, end: 98, type: 'info',
                            note: 'Este es el ID de lote en 5 que no coincide con el 8 correspondiente'
                        });
                    } else {
                        pushUnique(lineMarks[i], {
                            start: 91, end: 106, type: 'ok',
                            note: 'ID de lote en 8 coincide con el registrado en 5'
                        });
                    }
                }

                // Secuencia global entre lotes (usa el consecutivo del 8)
                if (/^\d{7}$/.test(seq8)) {
                    const seq8Num: number = parseInt(seq8, 10);
                    if (lastLotSeq === null) {
                        lastLotSeq = seq8Num;
                        // primera vez: ok suave
                        pushUnique(lineMarks[i], {
                            start: 99, end: 106, type: 'ok',
                            note: `Consecutivo global base ${pad7(seq8Num)}`
                        });
                    } else {
                        const expectedNum: number = lastLotSeq + 1;
                        if (seq8Num !== expectedNum) {
                            pushUnique(lineMarks[i], {
                                start: 99, end: 106, type: 'error',
                                note: `Consecutivo de lote esperado ${pad7(expectedNum)}, encontrado ${seq8}`
                            });
                            // avanzamos el cursor a lo encontrado para seguir comparando desde ahí
                            lastLotSeq = seq8Num;
                        } else {
                            pushUnique(lineMarks[i], {
                                start: 99, end: 106, type: 'ok',
                                note: `Consecutivo de lote correcto (${seq8})`
                            });
                            lastLotSeq = seq8Num;
                        }
                    }
                }

                // (el resto de tus checks del 8 se mantienen igual aquí)
            }


            // cerrar lote
            loteStart = -1
            count6 = 0
            count7 = 0
            sumDeb = BigInt(0)
            sumCred = BigInt(0)
            sumControl = BigInt(0)
            // se reseteá el ID del lote en curso
            currentLotId5 = null;
        } else if (t === '9') {
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