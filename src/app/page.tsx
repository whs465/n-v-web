'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import NachamVisor from '@/components/NachamVisor'
import NachamModal, { Field } from '@/components/NachamModal'
import * as XLSX from 'xlsx'
import { useNachamValidator } from '@/hooks/useNachamValidator'

function buildRuler(length: number) {
    let tens = "";
    let ones = "";
    for (let i = 1; i <= length; i++) {
        tens += i % 10 === 0 ? String((i / 10) % 10) : "·";
        ones += String(i % 10);
    }
    return { tens, ones };
}

function RulerOutside({
    lineLen,
    scrollerEl,
    onPickCol,
    onColW,
}: {
    lineLen: number;
    scrollerEl: HTMLDivElement | null;
    onPickCol: (col: number) => void;
    onColW: (w: number) => void;
}) {
    const { tens, ones } = useMemo(() => buildRuler(lineLen), [lineLen]);
    const rulerRef = useRef<HTMLDivElement>(null);
    const preRef = useRef<HTMLPreElement>(null);

    const onClickRuler = (e: React.MouseEvent<HTMLPreElement>) => {
        const pre = preRef.current;
        if (!pre) return;

        const rect = pre.getBoundingClientRect();
        const gutter = parseFloat(getComputedStyle(pre).paddingLeft) || 0;
        const scrollLeft = rulerRef.current?.scrollLeft ?? 0;

        const x = e.clientX - rect.left - gutter + scrollLeft;

        const contentWidth = pre.scrollWidth - gutter;
        const colW = contentWidth / lineLen;

        const col = Math.max(1, Math.min(lineLen, Math.floor(x / colW) + 1));
        onPickCol(col);
    };

    useEffect(() => {
        const pre = preRef.current;
        if (!pre) return;

        const measure = () => {
            const gutter = parseFloat(getComputedStyle(pre).paddingLeft) || 0;
            const contentWidth = pre.scrollWidth - gutter;
            const w = contentWidth / lineLen;
            if (w > 0) onColW(w);
        };

        const id1 = requestAnimationFrame(() => {
            const id2 = requestAnimationFrame(measure);
            return () => cancelAnimationFrame(id2);
        });

        return () => cancelAnimationFrame(id1);
    }, [lineLen, onColW]);


    useEffect(() => {
        const r = rulerRef.current;
        const v = scrollerEl;
        if (!r || !v) return;

        let lock = false;

        const fromViewer = () => {
            if (lock) return;
            lock = true;
            r.scrollLeft = v.scrollLeft;
            lock = false;
        };

        const fromRuler = () => {
            if (lock) return;
            lock = true;
            v.scrollLeft = r.scrollLeft;
            lock = false;
        };

        v.addEventListener("scroll", fromViewer, { passive: true });
        r.addEventListener("scroll", fromRuler, { passive: true });

        // alinear al montar
        r.scrollLeft = v.scrollLeft;

        return () => {
            v.removeEventListener("scroll", fromViewer);
            r.removeEventListener("scroll", fromRuler);
        };
    }, [scrollerEl]);

    return (
        <div ref={rulerRef} className="overflow-x-auto overflow-y-hidden bg-white">
            <pre
                ref={preRef}
                className="m-0 visor-mono text-slate-500 select-none whitespace-pre w-max cursor-crosshair"
                style={{ paddingLeft: "var(--visor-gutter)" }}
                onClick={onClickRuler}
                title="Click para marcar columna"
            >
                {tens}{"\n"}{ones}
            </pre>
        </div>
    );
}

const svgExportIcono = `
  <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="#217346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`

export default function Page() {
    const {
        isValidating,
        progress,
        lineStatus,
        lineMarks,
        globalErrors,
        validateText,
        reset: resetValidator,
    } = useNachamValidator();

    const [fileName, setFileName] = useState<string>('')
    const [records, setRecords] = useState<string[]>([])
    const [isOpen, setIsOpen] = useState(false)
    const [currentIndex, setCurrent] = useState(0)
    const [fields, setFields] = useState<Field[]>([])
    const [title, setTitle] = useState<string>('')
    const [nachamScrollerEl, setNachamScrollerEl] = useState<HTMLDivElement | null>(null);

    const [colMarker, setColMarker] = useState<number | null>(null);
    const [charW, setCharW] = useState<number>(8); // fallback
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [colW, setColW] = useState<number>(8);

    // medir ancho real de 1 char en la fuente mono
    useEffect(() => {
        if (!wrapperRef.current) return;
        const el = document.createElement("span");
        el.textContent = "0";
        el.style.position = "absolute";
        el.style.visibility = "hidden";
        el.style.fontFamily = "var(--font-mono)";
        el.style.fontSize = "16px";     // igual que visor/regla
        el.style.lineHeight = "20px";   // igual que visor/regla
        wrapperRef.current.appendChild(el);
        const w = el.getBoundingClientRect().width;
        wrapperRef.current.removeChild(el);
        if (w > 0) setCharW(w);
    }, []);

    // Valid/invalid quick state (preflight)
    const [isNachamValid, setIsNachamValid] = useState<boolean | null>(null)

    // Sombras de guía en visor
    const [badFromIndex, setBadFromIndex] = useState<number | null>(null)
    const [badRowSet, setBadRowSet] = useState<Set<number>>(new Set())

    const [toasts, setToasts] = useState<ToastItem[]>([])
    const toastIdRef = useRef(1)

    // Alto del visor (evita “titilar”)
    const [listHeight, setListHeight] = useState(560)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            setListHeight(Math.floor(window.innerHeight * 0.8))
        }
    }, [])

    // === Helpers toast ===

    // —— TOASTS con pausa en hover ——
    type ToastVariant = 'success' | 'error' | 'info'
    type ToastItem = {
        id: number
        text: string
        variant: ToastVariant
        duration: number
        remaining: number
        startAt: number
        timer?: number
    }

    type StructureCheck = {
        ok: boolean
        errors: string[]
        badIndex: number | null     // primer índice problemático
    }

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setColMarker(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);


    function validateNachamStructure(records: string[]): StructureCheck {
        const errs: string[] = []
        let badIndex: number | null = null

        let sawHeader1 = false
        let insideLot = false
        let last6Index = -1  // índice del 6 "padre" dentro del lote actual

        for (let i = 0; i < records.length; i++) {
            const r = records[i]
            const t = r[0]

            if (t === '1') {
                if (i !== 0 || sawHeader1) {
                    errs.push('Registro 1 fuera de lugar o duplicado.')
                    badIndex ??= i
                }
                sawHeader1 = true
                insideLot = false
                last6Index = -1

            } else if (t === '5') {
                // abre lote
                if (insideLot) {
                    errs.push('Nuevo registro 5 sin haber cerrado el lote anterior con 8.')
                    badIndex ??= i
                }
                insideLot = true
                last6Index = -1

            } else if (t === '6') {
                if (!insideLot) {
                    errs.push('Registro 6 fuera de lote (no hay 5 abierto).')
                    badIndex ??= i
                }
                // este 6 pasa a ser el "padre" de los 7 siguientes
                last6Index = i

            } else if (t === '7') {
                if (!insideLot) {
                    errs.push('Registro 7 fuera de lote (no hay 5 abierto).')
                    badIndex ??= i
                }
                // <<< CAMBIO: ya no exigimos "inmediatamente antes", sino "existe un 6 previo en el lote"
                if (last6Index === -1) {
                    errs.push('Registro 7 sin un 6 previo en el mismo lote.')
                    badIndex ??= i
                }
                // NO reseteamos last6Index para permitir 7 consecutivos

            } else if (t === '8') {
                if (!insideLot) {
                    errs.push('Registro 8 sin lote abierto (no hay 5 antes).')
                    badIndex ??= i
                }
                // cierra lote
                insideLot = false
                last6Index = -1

            } else if (t === '9') {
                // cierre de archivo / relleno: permitido sólo si no hay lote abierto
                if (insideLot) {
                    errs.push('Registro 9 dentro de un lote abierto (falta 8).')
                    badIndex ??= i
                }

            } else {
                errs.push(`Tipo de registro inválido en línea ${i + 1}.`)
                badIndex ??= i
            }
        }

        // si terminó el loop con lote abierto:
        if (insideLot) {
            errs.push('Archivo termina con un lote abierto (falta registro 8).')
        }

        return { ok: errs.length === 0, errors: errs, badIndex }
    }


    const removeToast = (id: number) => {
        setToasts((prev) => {
            // limpiar timers para evitar fugas
            const t = prev.find(x => x.id === id)
            if (t?.timer) window.clearTimeout(t.timer)
            return prev.filter(t => t.id !== id)
        })
    }

    const scheduleClose = useCallback((id: number, delay: number) => {
        const timer = window.setTimeout(() => removeToast(id), delay)
        setToasts(prev => prev.map(t => t.id === id ? { ...t, timer, startAt: Date.now(), remaining: delay } : t))
    }, [])

    const pauseToast = (id: number) => {
        setToasts(prev => prev.map(t => {
            if (t.id !== id) return t
            if (t.timer) window.clearTimeout(t.timer)
            const elapsed = Date.now() - t.startAt
            const remaining = Math.max(0, t.remaining - elapsed)
            return { ...t, remaining, timer: undefined }
        }))
    }

    const resumeToast = (id: number) => {
        setToasts(prev => {
            const t = prev.find(x => x.id === id)
            if (!t) return prev
            // si ya no queda tiempo, cerrar
            if (t.remaining <= 0) {
                requestAnimationFrame(() => removeToast(id))
                return prev
            }
            // reprogramar
            const timer = window.setTimeout(() => removeToast(id), t.remaining)
            return prev.map(x => x.id === id ? { ...x, timer, startAt: Date.now() } : x)
        })
    }

    const showErrors = useCallback((msgs: string[], duration = 8000) => {
        const base = duration
        const items = msgs.map(text => {
            const id = toastIdRef.current++
            return {
                id,
                text,
                variant: 'error' as ToastVariant,
                duration: base,
                remaining: base,
                startAt: Date.now(),
            }
        })
        setToasts(prev => {
            const next = [...prev, ...items]
            requestAnimationFrame(() => {
                items.forEach(it => scheduleClose(it.id, it.duration))
            })
            return next
        })
    }, [scheduleClose, setToasts])

    const showError = (msg: string) => showErrors([msg])

    // ¿Es devolución? (R1 pos 14–23 = "011111111")
    const isDevolucion = useMemo(() => {
        if (records.length === 0) return false
        const r0 = records[0]
        return r0[0] === '1' && /^ ?011111111$/.test(r0.slice(13, 23))
    }, [records])

    const firstNineIdx = useMemo(
        () => records.findIndex(r => r?.[0] === '9'),
        [records]
    )

    const isClickable = useCallback((idx: number) => {
        const t = records[idx]?.[0]
        if (!t) return false

        // Sólo permitir el primer 9; bloquear los 9 de relleno
        if (t === '9') return idx === firstNineIdx

        // Tipos válidos que sí abren modal
        return t === '1' || t === '5' || t === '6' || t === '7' || t === '8'
    }, [records, firstNineIdx])

    // Del nombre "0001683.007.1.XXX" => "007"
    const extractSerialFromName = (name: string): string | undefined => {
        const parts = (name || '').split('.');
        return parts.length >= 2 ? parts[1] : undefined;
    }

    const errCount = (lineMarks?.flat().filter(m => m.type === 'error').length ?? 0)
        + (globalErrors?.length ?? 0);
    //console.log('[ui] errCount=', lineMarks?.flat().filter(m => m.type === 'error'))

    // Archivo válido normal (NO devolución): worker terminó, sin errores
    const isFullyValid = useMemo(() => {
        const hasLines = (lineStatus?.length ?? 0) > 0
        return !isValidating && isNachamValid === true && hasLines && errCount === 0
    }, [isValidating, isNachamValid, lineStatus, errCount])

    // Export habilitado: válido normal o devolución
    const canExport = isFullyValid || isDevolucion

    // === Reset duro antes de cargar otro archivo ===
    const hardResetUI = () => {
        setIsOpen(false)
        setBadFromIndex(null)
        setBadRowSet(new Set())
        setRecords([])
        setIsNachamValid(null)
        resetValidator()
    }

    // === Parse de campos (idéntico a tus definiciones previas) ===

    useEffect(() => {
        if (isValidating) return
        if (!lineStatus?.length) return
        console.log('[ui] validation DONE. Num Registros=', records.length,
            'lineStatus=', lineStatus.length,
            'globalErrors=', globalErrors,
            'errLineas=', lineMarks?.flat().filter(m => m.type === 'error'))
    }, [isValidating, lineStatus, globalErrors, records.length, lineMarks])

    // === Cargar archivo + preflight + lanzar worker ===
    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.currentTarget
        if (!input.files?.length) return

        hardResetUI()

        const file = input.files[0]
        try {
            let text = await file.text()
            text = text.replace(/^\uFEFF/, '')
            const compact = text.replace(/\r?\n/g, '')
            const recs = compact.match(/.{106}/g) || []

            const r0 = recs[0] ?? ''
            const isDevolucionLocal = r0[0] === '1' && /^ ?011111111$/.test(r0.slice(13, 23))

            setFileName(file.name)
            input.value = ''
            setRecords(recs)

            const msgs: string[] = []

            // 1) múltiplo de 106
            const multiple106 = (compact.length % 106) === 0
            if (!multiple106) msgs.push('El número de caracteres del archivo no es múltiplo de 106.')

            const struct = validateNachamStructure(recs)
            if (!struct.ok) {
                // marca visual desde el primer problema
                setBadRowSet(new Set())                // aquí no sabemos filas con tipo inválido (ya lo hacés aparte si querés)
                setBadFromIndex(struct.badIndex ?? 0)  // guía roja desde ahí
                setIsNachamValid(false)                // bloquea export
                showErrors(struct.errors, 12000)       // tu toast de errores
                // NO lanzar worker => return
                return
            }

            // 2) firma en Tipo 1 pos 14–23 => slice(13,23).trim()
            let firmaOk = false

            if (typeof r0 === 'string') {
                const isType1 = r0[0] === '1'
                const firma14_23 = r0.slice(14, 23) // pos 14–23
                firmaOk = (isType1 && (firma14_23 === '000016832' || firma14_23 === '011111111'))
                if (!firmaOk) {
                    msgs.push('El archivo no contiene la firma esperada.')
                }
            } else {
                msgs.push('Archivo inválido: faltan registros para validar la firma del tipo 1.')
            }

            // 3) tipos válidos en primer carácter
            const validStart = new Set(['1', '5', '6', '7', '8', '9'])
            const badRows: number[] = []
            recs.forEach((r, i) => { if (!validStart.has(r[0])) badRows.push(i) })
            if (badRows.length) msgs.push(`Se detectaron ${badRows.length} registro(s) con tipo de registro inválido (caracter  1).`)

            // Sombras de guía
            let fromIdx: number | null = null
            if (!multiple106) {
                fromIdx = Math.floor(compact.length / 106)
            } else if (!firmaOk) {
                fromIdx = 0 // la firma ahora se valida en el registro 1
            } else if (badRows.length) {
                fromIdx = badRows[0]
            }
            setBadRowSet(new Set(badRows))
            setBadFromIndex(fromIdx)

            // Estado rápido para export
            const preflightOk = multiple106 && firmaOk && badRows.length === 0
            setIsNachamValid(preflightOk)

            if (!preflightOk) {
                if (msgs.length) showErrors(msgs, 10000)
                return
            }


            if (isDevolucionLocal) {
                setIsNachamValid(true)        // habilita export
                setBadRowSet(new Set())         // sin errores visuales
                setBadFromIndex(null)
                // limpiar cualquier resultado previo del worker
                resetValidator?.()

                // opcional: avisar con toast “info”
                //showErrors?.(['Archivo de devolución detectado — se omite validación. Puede exportar.'], 6000)

            } else {
                // Lanza validación pesada
                //console.log('[ui] validateText len=', compact.length)
                validateText(compact, {
                    checkTransCount: true,
                    checkCreditos: true,
                    checkDebitos: true,
                    checkTotalesControl: true,
                    includeAdendasInTrans: true,
                    serialFromName: extractSerialFromName(file.name),
                })
            }
            if (msgs.length) showErrors(msgs, 10000)
        } catch (err) {
            console.error(err)
            showErrors(['No se pudo leer el archivo.'], 8000)
            input.value = ''
            setBadRowSet(new Set())
            setBadFromIndex(null)
            setIsNachamValid(null)
        }
    }

    useEffect(() => {
        if (globalErrors.length) showErrors(globalErrors, 10000)
    }, [globalErrors, showErrors])

    // 1) Índice del PRIMER registro 9 real (los demás 9 son relleno)
    const firstNineIndex = useMemo(
        () => records.findIndex(r => r?.charAt(0) === '9'),
        [records]
    )

    // 2) Encontrar el '5' padre hacia atrás
    const findParentRecord = useCallback((idx: number, type: '5') => {
        for (let i = idx - 1; i >= 0; i--) {
            if (records[i]?.charAt(0) === type) return i
        }
        return null
    }, [records])

    // 3) ¿Se puede abrir la modal para este índice?
    const isRecordTypeClickable = useCallback((idx: number) => {
        const t = records[idx]?.charAt(0)
        if (!t) return false
        if (t === '9') return idx === firstNineIndex // sólo el primer 9
        return t === '1' || t === '5' || t === '6' || t === '7' || t === '8'
    }, [records, firstNineIndex])

    // 4) Parsear campos para la modal (usa lo que necesites en deps)
    const parseFields = useCallback((rec: string, idx: number) => {
        const type = rec.charAt(0)
        let flds: Field[] = []
        if (type === '1') {
            flds = [
                { id: 1, name: "Tipo de Registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                { id: 2, name: "Código de Prioridad", length: 2, position: "2-3", value: rec.slice(1, 3) },
                { id: 3, name: "Código Participante Destino Inmediato", length: 10, position: "4-13", value: rec.slice(3, 13) },
                { id: 4, name: "Código Participante Origen Inmediato", length: 10, position: "14-23", value: rec.slice(13, 23) },
                { id: 5, name: "Fecha de Creación del Archivo", length: 8, position: "24-31", value: rec.slice(23, 31) },
                { id: 6, name: "Hora de Creación del Archivo", length: 4, position: "32-35", value: rec.slice(31, 35) },
                { id: 7, name: "Identificador del Archivo", length: 1, position: "36-36", value: rec.slice(35, 36) },
                { id: 8, name: "Tamaño del Registro", length: 3, position: "37-39", value: rec.slice(36, 39) },
                { id: 9, name: "Factor de Ablocamiento", length: 2, position: "40-41", value: rec.slice(39, 41) },
                { id: 10, name: "Código de Formato", length: 1, position: "42-42", value: rec.slice(41, 42) },
                { id: 11, name: "Nombre Entidad Destino", length: 23, position: "43-65", value: rec.slice(42, 65) },
                { id: 12, name: "Nombre Entidad Origen", length: 23, position: "66-88", value: rec.slice(65, 88) },
                { id: 13, name: "Código de Referencia", length: 8, position: "89-96", value: rec.slice(88, 96) },
                { id: 14, name: "Reservado", length: 10, position: "97-106", value: rec.slice(96, 106) },
            ]
        } else if (type === '5') {
            flds = [
                { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                { id: 2, name: "Código clase de transacción por lote", length: 3, position: "2-4", value: rec.slice(1, 4) },
                { id: 3, name: "Nombre del originador", length: 16, position: "5-20", value: rec.slice(4, 20) },
                { id: 4, name: "Datos Discrecionales del originador", length: 20, position: "21-40", value: rec.slice(20, 40) },
                { id: 5, name: "Identificador del originador", length: 10, position: "41-50", value: rec.slice(40, 50) },
                { id: 6, name: "Tipo de Servicio", length: 3, position: "51-53", value: rec.slice(50, 53) },
                { id: 7, name: "Descripción del Lote", length: 10, position: "54-63", value: rec.slice(53, 63) },
                { id: 8, name: "Fecha Descriptiva", length: 8, position: "64-71", value: rec.slice(63, 71) },
                { id: 9, name: "Fecha Efectiva de la Transacción", length: 8, position: "72-79", value: rec.slice(71, 79) },
                { id: 10, name: "Fecha de Compensación Juliana", length: 3, position: "80-82", value: rec.slice(79, 82) },
                { id: 11, name: "Código estado del Originador", length: 1, position: "83-83", value: rec.slice(82, 83) },
                { id: 12, name: "Código Participante Originador", length: 8, position: "84-91", value: rec.slice(83, 91) },
                { id: 13, name: "Número de Lote", length: 7, position: "92-98", value: rec.slice(91, 98) },
                { id: 14, name: "Reservado", length: 8, position: "99-106", value: rec.slice(98, 106) },
            ]
        } else if (type === '6') {
            flds = [
                { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                { id: 2, name: "Código clase de transacción por lote", length: 2, position: "2-3", value: rec.slice(1, 3) },
                { id: 3, name: "Código participante receptor", length: 8, position: "4-11", value: rec.slice(3, 11) },
                { id: 4, name: "Dígito de chequeo", length: 1, position: "12-12", value: rec.slice(11, 12) },
                { id: 5, name: "Número de Cuenta del Receptor", length: 17, position: "13-29", value: rec.slice(12, 29) },
                { id: 6, name: "Valor de la Transacción", length: 18, position: "30-47", value: rec.slice(29, 47) },
                { id: 7, name: "Número de Identificación del Receptor", length: 15, position: "48-62", value: rec.slice(47, 62) },
                { id: 8, name: "Nombre del Receptor", length: 22, position: "63-84", value: rec.slice(62, 84) },
                { id: 9, name: "Datos Discrecionales", length: 2, position: "85-86", value: rec.slice(84, 86) },
                { id: 10, name: "Indicador de Registro de Adenda", length: 1, position: "87-87", value: rec.slice(86, 87) },
                { id: 11, name: "Número de Secuencia", length: 15, position: "88-102", value: rec.slice(87, 102) },
                { id: 12, name: "Reservado", length: 4, position: "103-106", value: rec.slice(102, 106) },
            ]
        } else if (type === '7') {
            const pi = findParentRecord(idx, '5')
            let ts = ''
            if (pi !== null) {
                const pr = records[pi]
                ts = pr.slice(50, 53).trim()
            }
            const p320321 = rec.slice(1, 3)
            if (p320321 === '99') {
                flds = [
                    { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                    { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
                    { id: 3, name: "Causal de Devolución", length: 3, position: "4-6", value: rec.slice(3, 6) },
                    { id: 4, name: "Número de Secuencia de la Transacción Original", length: 15, position: "7-21", value: rec.slice(6, 21) },
                    { id: 5, name: "Fecha de Muerte", length: 8, position: "22-29", value: rec.slice(21, 29) },
                    { id: 6, name: "Código del Participante Receptor de la Transacción Original", length: 8, position: "30-37", value: rec.slice(29, 37) },
                    { id: 7, name: "Información Adicional", length: 44, position: "38-81", value: rec.slice(37, 81) },
                    { id: 8, name: "Número de Secuencia del Registro Adenda", length: 15, position: "82-96", value: rec.slice(81, 96) },
                    { id: 9, name: "Reservado", length: 10, position: "97-106", value: rec.slice(96, 106) },
                ]
            } else if (p320321 === '05' && ts === 'CTX') {
                flds = [
                    { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                    { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
                    { id: 3, name: "Código EAN 13 o NIT", length: 13, position: "4-16", value: rec.slice(3, 16) },
                    { id: 4, name: "Descripción del servicio", length: 15, position: "17-31", value: rec.slice(16, 31) },
                    { id: 5, name: "Número de referencia de factura", length: 20, position: "32-51", value: rec.slice(31, 51) },
                    { id: 6, name: "Valor factura", length: 18, position: "52-69", value: rec.slice(51, 69) },
                    { id: 7, name: "Reservado", length: 14, position: "70-83", value: rec.slice(69, 83) },
                    { id: 8, name: "Número de Secuencia del Registro Adenda", length: 4, position: "84-87", value: rec.slice(83, 87) },
                    { id: 9, name: "Numero de secuencia de transacción del registro de detalle de transacciones", length: 7, position: "88-94", value: rec.slice(87, 94) },
                    { id: 10, name: "Reservado", length: 12, position: "95-106", value: rec.slice(94, 106) },
                ]
            } else if (p320321 === '05' && ts === 'PPD') {
                flds = [
                    { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                    { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
                    { id: 3, name: "Identificación del Originador", length: 13, position: "4-16", value: rec.slice(3, 16) },
                    { id: 4, name: "Identificación del Originador", length: 30, position: "17-46", value: rec.slice(16, 46) },
                    { id: 5, name: "Descripción del servicio", length: 15, position: "47-61", value: rec.slice(46, 61) },
                    { id: 6, name: "Reservado", length: 22, position: "62-83", value: rec.slice(61, 83) },
                    { id: 7, name: "Número de Secuencia del Registro Adenda", length: 4, position: "84-87", value: rec.slice(83, 87) },
                    { id: 8, name: "Numero de secuencia de transacción del registro de detalle de transacciones", length: 7, position: "88-94", value: rec.slice(87, 94) },
                    { id: 9, name: "Reservado", length: 12, position: "95-106", value: rec.slice(94, 106) },
                ]
            } else {
                flds = [
                    { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                    { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
                    { id: 3, name: "Identificación del Originador", length: 15, position: "4-18", value: rec.slice(3, 18) },
                    { id: 4, name: "Reservado", length: 1, position: "19-19", value: rec.slice(18, 19) },
                    { id: 5, name: "Proposito de la Transacción", length: 10, position: "21-30", value: rec.slice(20, 30) },
                    { id: 6, name: "Número de Factura/Cuenta", length: 24, position: "31-54", value: rec.slice(30, 54) },
                    { id: 7, name: "Reservado", length: 2, position: "55-56", value: rec.slice(54, 56) },
                    { id: 8, name: "Información Libre Originador", length: 24, position: "57-80", value: rec.slice(56, 80) },
                    { id: 9, name: "Reservado", length: 2, position: "81-83", value: rec.slice(80, 83) },
                    { id: 10, name: "Número de secuencia de Registro Adenda", length: 4, position: "84-87", value: rec.slice(83, 87) },
                    { id: 11, name: "Número de secuencia de Transacción del Registro de Detalle", length: 7, position: "88-94", value: rec.slice(87, 94) },
                    { id: 12, name: "Reservado", length: 12, position: "95-106", value: rec.slice(94, 106) },
                ]
            }
        } else if (type === '8') {
            flds = [
                { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                { id: 2, name: "Código Clase de Transacción por Lote", length: 3, position: "2-4", value: rec.slice(1, 4) },
                { id: 3, name: "Número de Trans./Adenda", length: 6, position: "5-10", value: rec.slice(4, 10) },
                { id: 4, name: "Totales de Control", length: 10, position: "11-20", value: rec.slice(10, 20) },
                { id: 5, name: "Valor Total de Débitos", length: 18, position: "21-38", value: rec.slice(20, 38) },
                { id: 6, name: "Valor Total de Créditos", length: 18, position: "39-56", value: rec.slice(38, 56) },
                { id: 7, name: "Identificador del Originador", length: 10, position: "57-66", value: rec.slice(56, 66) },
                { id: 8, name: "Código de Autenticación", length: 19, position: "67-85", value: rec.slice(66, 85) },
                { id: 9, name: "Reservado", length: 6, position: "86-91", value: rec.slice(85, 91) },
                { id: 10, name: "ID Participante Originador", length: 8, position: "92-99", value: rec.slice(91, 99) },
                { id: 11, name: "Número de Lote", length: 7, position: "100-106", value: rec.slice(99, 106) },
            ]
        } else if (type === '9') {
            flds = [
                { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
                { id: 2, name: "Cantidad de Lotes", length: 6, position: "2-7", value: rec.slice(1, 7) },
                { id: 3, name: "Número de Bloques", length: 6, position: "8-13", value: rec.slice(7, 13) },
                { id: 4, name: "Número de Trans./Adenda", length: 8, position: "14-21", value: rec.slice(13, 21) },
                { id: 5, name: "Totales de Control", length: 10, position: "22-31", value: rec.slice(21, 31) },
                { id: 6, name: "Valor Total de Débitos", length: 18, position: "32-49", value: rec.slice(31, 49) },
                { id: 7, name: "Valor Total de Créditos", length: 18, position: "50-67", value: rec.slice(49, 67) },
                { id: 8, name: "Reservado", length: 39, position: "68-106", value: rec.slice(67, 106) },
            ]
        }
        return flds
    }, [records, findParentRecord])



    // === Modal (click) ===
    const handleRowClick = useCallback((idx: number) => {
        // Si el tipo de registro no es válido, no abrir modal
        if (!isRecordTypeClickable(idx)) return;

        const rec = records[idx]
        const type = rec.charAt(0)
        let flds: Field[] = []
        let ttl = ''

        if (type === '1') {
            ttl = `🌟 Registro de Encabezado de Archivo`
            flds = parseFields(rec, idx)
        } else if (type === '5') {
            const ts = rec.slice(50, 53).trim()
            const desc = rec.slice(53, 63).trim()
            ttl = `🌟 Registro de Encabezado de Lote</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            flds = parseFields(rec, idx)
        } else if (type === '6') {
            const pi = findParentRecord(idx, '5')
            if (pi !== null) {
                const pr = records[pi]
                const ts = pr.slice(50, 53).trim()
                const desc = pr.slice(53, 63).trim()
                ttl = `🌟 Registro de Detalle de Transacciones</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            }
            flds = parseFields(rec, idx)
        } else if (type === '7') {
            const pi = findParentRecord(idx, '5')
            if (pi !== null) {
                const pr = records[pi]
                const ts = pr.slice(50, 53).trim()
                const desc = pr.slice(53, 63).trim()
                ttl = `🌟 Registro de Adenda de Transacción</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            }
            flds = parseFields(rec, idx)
        } else if (type === '8') {
            const pi = findParentRecord(idx, '5')
            if (pi !== null) {
                const pr = records[pi]
                const ts = pr.slice(50, 53).trim()
                const desc = pr.slice(53, 63).trim()
                ttl = `🌟 Registro de Control de Lote</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            }
            flds = parseFields(rec, idx)
        } else if (type === '9') {
            ttl = `🌟 Registro de Control de Archivo`
            flds = parseFields(rec, idx)
        }

        setTitle(ttl)
        setFields(flds)
        setCurrent(idx)
        setIsOpen(true)
    }, [records, isRecordTypeClickable, parseFields, findParentRecord])

    const closeModal = () => setIsOpen(false)
    const showPrev = () => currentIndex > 0 && handleRowClick(currentIndex - 1)
    const showNext = () => currentIndex < records.length - 1 && handleRowClick(currentIndex + 1)

    // === Export Excel (6 + adenda 7 al lado) ===
    const exportExcel = () => {
        if (!records.length) return
        if (!canExport) {
            showError('No se puede exportar: el archivo presenta errores.')
            return
        }

        const type6Indices = records
            .map((rec, idx) => ({ rec, idx }))
            .filter(({ rec }) => rec.charAt(0) === '6')
            .map(({ idx }) => idx)

        if (!type6Indices.length) {
            showError('No hay registros tipo 6 para exportar.')
            return
        }

        const first6Idx = type6Indices[0]
        const fields6 = parseFields(records[first6Idx], first6Idx).filter(f => f.name !== 'Tipo de registro')

        const nextIdx = first6Idx + 1
        const fields7 = records[nextIdx]?.charAt(0) === '7'
            ? parseFields(records[nextIdx], nextIdx).filter(f => f.name !== 'Tipo de registro')
            : []

        const headers = ['Registro', ...fields6.map(f => f.name), ...fields7.map(f => f.name)]

        const data = type6Indices.map((idx6, i) => {
            const row: Record<string, string | number> = { Registro: i + 1 }
            parseFields(records[idx6], idx6).filter(f => f.name !== 'Tipo de registro')
                .forEach(f => { row[f.name] = f.value.replace(/ /g, '·') })
            const idx7 = idx6 + 1
            if (records[idx7]?.charAt(0) === '7') {
                parseFields(records[idx7], idx7).filter(f => f.name !== 'Tipo de registro')
                    .forEach(f => { row[f.name] = f.value.replace(/ /g, '·') })
            } else {
                fields7.forEach(f => { row[f.name] = '' })
            }
            return row
        })

        const ws = XLSX.utils.json_to_sheet(data, { header: headers })
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Datos')
        XLSX.writeFile(wb, `${fileName || 'reporte'}.xlsx`, { bookType: 'xlsx' })
    }

    return (
        <>
            {/* Header */}
            <header className="w-full bg-white border-b border-[#BBC2C8] font-sans">
                <div className="max-w-[1000px] mx-auto flex items-center justify-between py-2 px-4">
                    <h1 className="m-0 text-xl font-semibold text-[#2D77C2]">Visor de archivos NACHAM</h1>

                    <div className="flex items-center space-x-4">
                        {fileName && (
                            <div className="flex items-center text-gray-700 text-sm truncate max-w-xs">
                                <span className="truncate">{fileName}</span>

                                {/* Archivo no NACHAM (errores duros de formato/firma) */}
                                {isNachamValid === false && (
                                    <span className="ml-2 px-2 py-0.5 text-xs rounded bg-red-100 text-red-700 border border-red-300">
                                        no NACHAM
                                    </span>
                                )}

                                {/* Progreso SOLO cuando realmente valida (no en devoluciones) */}
                                {!isDevolucion && isValidating && progress > 0 && progress < 100 && (
                                    <div className="ml-3 flex items-center gap-2 text-sm text-[#2D77C2]">
                                        <span>Validando archivo… {progress}%</span>
                                        <div className="w-28 h-1.5 bg-gray-200 rounded">
                                            <div className="h-1.5 bg-[#2D77C2] rounded" style={{ width: `${progress}%` }} />
                                        </div>
                                    </div>
                                )}

                                {/* ✅ Válido normal: escudo + export */}
                                {!isDevolucion && isFullyValid && (
                                    <>
                                        <span className="ml-2 inline-flex items-center text-green-600" title="Validado 💯">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"
                                                viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                                                <path d="M9 12l2 2 4-4" />
                                            </svg>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={exportExcel}
                                            className="ml-2 p-1 rounded hover:bg-gray-200 cursor-pointer transition"
                                            title="Exportar a Excel"
                                            dangerouslySetInnerHTML={{ __html: svgExportIcono }}
                                        />
                                    </>
                                )}

                                {/* 🔵 Devolución: badge “Devolución” + export; SIN escudo verde */}
                                {isDevolucion && (
                                    <>
                                        <span
                                            className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-300"
                                            title="Archivo de devolución (se omiten validaciones de consistencia)"
                                        >
                                            Devolución
                                        </span>
                                        <button
                                            type="button"
                                            onClick={exportExcel}
                                            className="ml-2 p-1 rounded hover:bg-gray-200 cursor-pointer transition"
                                            title="Exportar a Excel"
                                            dangerouslySetInnerHTML={{ __html: svgExportIcono }}
                                        />
                                    </>
                                )}

                                {/* ⚠ Errores (no devolución): badge y SIN export */}
                                {!isValidating && isNachamValid === true && !isDevolucion && errCount > 0 && (
                                    <div className="ml-3 flex items-center gap-2 text-sm">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-300">
                                            💩 Errores ({errCount})
                                        </span>                                        <button
                                            type="button"
                                            onClick={exportExcel}
                                            className="ml-2 p-1 rounded hover:bg-gray-200 cursor-pointer transition"
                                            title="Exportar a Excel"
                                            dangerouslySetInnerHTML={{ __html: svgExportIcono }}
                                        />
                                    </div>

                                )}
                            </div>
                        )}

                        <label
                            htmlFor="fileInput"
                            className="inline-block px-4 py-2 bg-green-600 hover:bg-green-700 active:bg-green-800
        text-white text-sm font-medium rounded shadow cursor-pointer transition"
                        >
                            Seleccionar NACHAM
                        </label>
                        <input id="fileInput" type="file" accept="*.*" className="hidden" onChange={handleFile} />
                    </div>
                </div>
            </header>


            {/* Main */}
            <main className="p-2 space-y-6">
                {records.length > 0 ? (
                    <div id="detail" className="m-2 rounded-xl p-[2px] bg-[linear-gradient(45deg,#C9F5FF_0%,#FFC7D1_48%,#8AB087_100%)] shadow-md">
                        <div
                            ref={wrapperRef}
                            className="relative rounded-[inherit] bg-white border border-gray-200 overflow-hidden"
                            style={{ ["--visor-gutter" as any]: "12px" }}
                        >
                            {/* ✅ OVERLAY VA AQUÍ */}
                            {colMarker !== null && (
                                <div
                                    className="pointer-events-none absolute top-0 bottom-0 z-20 column-guide"
                                    style={{
                                        left: `calc(var(--visor-gutter) + ${(colMarker - 1) * colW}px)`,
                                        width: "1px",
                                    }}
                                />
                            )}
                            <RulerOutside
                                lineLen={106}
                                scrollerEl={nachamScrollerEl}
                                onPickCol={setColMarker}
                                onColW={setColW}
                            />
                            <div className="border-t border-slate-200" />
                            <NachamVisor
                                records={records}
                                lineHeight={20}
                                height={listHeight}
                                onRowClick={handleRowClick}
                                selectedIndex={isOpen ? currentIndex : undefined}
                                badFromIndex={badFromIndex}
                                badRows={[...badRowSet]}
                                lineStatus={lineStatus}
                                lineMarks={lineMarks}
                                isClickable={isClickable}
                                onScrollerReady={(el) => setNachamScrollerEl(el)}
                            />
                        </div></div>
                ) : (
                    <p className="text-gray-600">Asegúrese de cargar un NACHAM en formato válido.</p>
                )}

                <NachamModal
                    isOpen={isOpen}
                    title={title}
                    fields={fields}
                    onClose={closeModal}
                    onPrev={showPrev}
                    onNext={showNext}
                    canPrev={currentIndex > 0}
                    canNext={currentIndex < records.length - 1}
                />
            </main>

            {/* —— Nuevo contenedor de TOASTS (con pausa en hover) —— */}
            <div className="fixed bottom-5 right-5 z-50 space-y-3 w-[min(430px,92vw)]">
                {toasts.map(t => {
                    const isErr = t.variant === 'error'
                    const isOk = t.variant === 'success'
                    const cardBase = isErr
                        ? 'bg-red-600 border-l-8 border-red-900'
                        : isOk
                            ? 'bg-green-600 border-l-8 border-green-900'
                            : 'bg-blue-600 border-l-8 border-blue-900'

                    return (
                        <div
                            key={t.id}
                            className={`text-white rounded-lg shadow-lg flex p-4 ${cardBase}`}
                            onMouseEnter={() => pauseToast(t.id)}
                            onMouseLeave={() => resumeToast(t.id)}
                            role="status"
                        >
                            {/* Icono */}
                            <div className="mr-3 flex items-start">
                                <svg className="w-7 h-7 mt-0.5" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                    <circle cx="12" cy="12" r="12" fill={isErr ? "#e74c3c" : isOk ? "#2ecc71" : "#3498db"} />
                                    <path d="M9.5 16L5 11.5L6.41 10.09L9.5 13.17L17.59 5.09L19 6.5L9.5 16Z" fill="white" />
                                </svg>
                            </div>

                            {/* Contenido */}
                            <div className="flex-1 text-sm">
                                <p className="font-semibold text-base leading-tight">
                                    {isErr ? 'Errores de validación' : isOk ? 'Éxito' : 'Aviso'}
                                </p>
                                <p className="mt-1 leading-snug whitespace-pre-wrap break-words">
                                    {t.text}
                                </p>
                            </div>

                            {/* Cerrar */}
                            <button
                                onClick={() => removeToast(t.id)}
                                className="text-white hover:text-gray-200 ml-4 text-xl leading-none focus:outline-none"
                                aria-label="Cerrar notificación"
                            >
                                &times;
                            </button>
                        </div>
                    )
                })}
            </div>
        </>
    )
}
