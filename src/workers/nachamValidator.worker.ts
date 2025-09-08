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
type InMsg =
    | { type: 'validate-file'; buffer: ArrayBuffer }
    | { type: 'validate-text'; text: string }

type OutMsg =
    | { type: 'progress'; pct: number }
    | {
        type: 'done'
        lineStatus: LineStatus[]
        lineReason: (string | undefined)[]
        globalErrors: string[]
        lineMarks: LineMark[][]
    }

// ===== helpers =====
const validStart = new Set(['1', '5', '6', '7', '8', '9'])
const toBig = (s: string) => BigInt((s || '').trim() || '0')
const pad3 = (n: number) => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n))

// Convierte BigInt en centavos a "1234.56" (solo texto)
const fmtCentsTxt = (n: bigint) => {
    const s = n.toString();
    const neg = s.startsWith('-');
    let t = neg ? s.slice(1) : s;
    if (t.length <= 2) t = t.padStart(3, '0');
    const i = t.slice(0, -2);
    const d = t.slice(-2);
    return (neg ? '-' : '') + i + '.' + d;
}

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

    // --- Identificador (Tipo 1 pos 36) vs serial de nombre de archivo ---
    // options.serialFromName debe traerse desde la UI
    const serialFromName: string | undefined = opts.serialFromName
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

    // si falló algo, devolvés y salís
    if (globalErrors.length) {
        (self as any).postMessage({
            type: 'done',
            lineStatus: new Array(recsCount), lineReason: new Array(recsCount),
            globalErrors, lineMarks: Array.from({ length: recsCount }, () => [])
        })
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

        } else if (t === '6' && loteStart >= 0) {
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

        } else if (t === '7' && loteStart >= 0) {
            fileCount7++
            count7++
        } else if (t === '8' && loteStart >= 0) {
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
                    note: `Transacciones no coinciden. Esperado: ${declaredTrans}, Calculado: ${gotTrans}`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 4, end: 10, type: 'ok',
                    note: `Transacciones OK (${declaredTrans})`
                })
            }

            // Débitos (21–38 => slice 20..38)
            const okDeb = sumDeb === declaredDeb
            if (!okDeb) {
                ok = false
                checks.push(`Débitos esperados ${declaredDeb} ≠ suma ${sumDeb}`)
                pushUnique(lineMarks[i], {
                    start: 20, end: 38, type: 'error',
                    note: `Débitos no coinciden. Esperado: ${fmtMoney(declaredDeb)}, Suma: ${fmtMoney(sumDeb)}`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 20, end: 38, type: 'ok',
                    note: `Débitos OK (${fmtMoney(declaredDeb)})`
                })
            }

            // Créditos (39–56 => slice 38..56)
            const okCred = sumCred === declaredCred
            if (!okCred) {
                ok = false
                checks.push(`Créditos esperados ${declaredCred} ≠ suma ${sumCred}`)
                pushUnique(lineMarks[i], {
                    start: 38, end: 56, type: 'error',
                    note: `Créditos no coinciden. Esperado: ${fmtMoney(declaredCred)}, Suma: ${fmtMoney(sumCred)}`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 38, end: 56, type: 'ok',
                    note: `Créditos OK (${fmtMoney(declaredCred)})`
                })
            }

            // Totales de Control (11–20 => slice 10..20)
            const okCtrl = sumControl === declaredCtrl
            if (!okCtrl) {
                ok = false
                checks.push(`Totales de Control esperados ${declaredCtrl} ≠ suma ${sumControl}`)
                pushUnique(lineMarks[i], {
                    start: 10, end: 20, type: 'error',
                    note: `Totales de Control no coinciden. Esperado: ${fmt(declaredCtrl)}, Suma: ${fmt(sumControl)}`
                })
            } else {
                pushUnique(lineMarks[i], {
                    start: 10, end: 20, type: 'ok',
                    note: `Totales de Control OK (${fmt(declaredCtrl)})`
                })
            }

            // Pinta 5..8
            for (let j = loteStart; j <= i; j++) lineStatus[j] = ok ? 'ok' : 'error'
            if (!ok && checks.length) lineReason[i] = checks.join(' | ')

            // cerrar lote
            loteStart = -1
            count6 = 0
            count7 = 0
            sumDeb = BigInt(0)
            sumCred = BigInt(0)
            sumControl = BigInt(0)
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
            ; (self as any).postMessage({ type: 'progress', pct: Math.floor((i / Math.max(1, recsCount)) * 100) } as OutMsg)
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
                note: `Lotes: esperado ${expLots}, declarado ${decLots}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 1, end: 7, type: 'ok',
                note: `Lotes correctos (${expLots})`
            });
        }

        // 2) Bloques 8–13
        if (decBlocks !== expBlocks) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 7, end: 13, type: 'error',
                note: `Bloques: esperado ${expBlocks}, declarado ${decBlocks}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 7, end: 13, type: 'ok',
                note: `Bloques correctos (${expBlocks})`
            });
        }

        // 3) Transacciones + adendas 14–21
        if (decTranAd !== expTranAd) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 13, end: 21, type: 'error',
                note: `Trans/Adenda: esperado ${expTranAd}, declarado ${decTranAd}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 13, end: 21, type: 'ok',
                note: `Trans/Adenda correctos (${expTranAd})`
            });
        }

        // 4) Totales de control 22–31
        if (decCtrl !== expCtrl) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 21, end: 31, type: 'error',
                note: `Totales de Control: esperado ${expCtrl.toString()}, declarado ${decCtrl.toString()}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 21, end: 31, type: 'ok',
                note: `Totales de Control correctos (${expCtrl.toString()})`
            });
        }

        // 5) Débitos 32–49 (formateo en centavos a texto)
        if (decDeb !== expDeb) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 31, end: 49, type: 'error',
                note: `Débitos: esperado ${fmtCentsTxt(expDeb)}, declarado ${fmtCentsTxt(decDeb)}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 31, end: 49, type: 'ok',
                note: `Débitos correctos (${fmtCentsTxt(expDeb)})`
            });
        }

        // 6) Créditos 50–67
        if (decCred !== expCred) {
            ok9 = false;
            pushUnique(lineMarks[first9Index], {
                start: 49, end: 67, type: 'error',
                note: `Créditos: esperado ${fmtCentsTxt(expCred)}, declarado ${fmtCentsTxt(decCred)}`
            });
        } else {
            pushUnique(lineMarks[first9Index], {
                start: 49, end: 67, type: 'ok',
                note: `Créditos correctos (${fmtCentsTxt(expCred)})`
            });
        }

        // Estado de la línea 9 principal
        lineStatus[first9Index] = ok9 ? 'ok' : 'error';
    } else {
        // No se encontró un 9 “principal”
        globalErrors.push('No se encontró el primer registro 9 (trailer).');
    }

    ; (self as any).postMessage({ type: 'progress', pct: 100 } as OutMsg)
        ; (self as any).postMessage({ type: 'done', lineStatus, lineReason, globalErrors, lineMarks } as OutMsg)
}

// ===== wiring =====
self.onmessage = (e: MessageEvent<InMsg>) => {
    const msg = e.data
    if (msg.type === 'validate-file') {
        const text = new TextDecoder('utf-8').decode(msg.buffer)
        const compact = text.replace(/^\uFEFF/, '').replace(/\r?\n/g, '')
        validateCompact(compact, (msg as any).options || {})
    } else if (msg.type === 'validate-text') {
        const compact = msg.text.replace(/^\uFEFF/, '').replace(/\r?\n/g, '')
        validateCompact(compact, (msg as any).options || {})
    }
}