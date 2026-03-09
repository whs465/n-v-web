'use client'

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import NachamVisor from '@/components/NachamVisor'
import NachamModal, { Field } from '@/components/NachamModal'
import * as XLSX from 'xlsx'
import { useNachamValidator } from '@/hooks/useNachamValidator'
import {
    buildTree,
    detectFileProfile,
    extractFields,
    parseRowsToRecords,
    type FieldMap,
    type FileProfile,
} from '@/core/nacham'

const svgExportIcono = `
  <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="#217346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`

function formatMoneyFromRaw(raw: string) {
    const value = String(raw || '').trim()
    if (!value) return '0,00'
    const digits = value.replace(/\D/g, '')
    if (!digits) return '0,00'
    const normalized = (digits.replace(/^0+/, '') || '0').padStart(3, '0')
    const cents = normalized.slice(-2)
    const integer = normalized.slice(0, -2).replace(/^0+/, '') || '0'
    const integerFormatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return `${integerFormatted},${cents}`
}

function hasNonZeroAmount(raw: string) {
    return /[1-9]/.test(String(raw || '').replace(/\D/g, ''))
}

type SearchHit = { line: number; start: number; end: number }

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
    const parsedRecords = useMemo(() => parseRowsToRecords(records), [records])
    const detectedProfile = useMemo(() => detectFileProfile(parsedRecords), [parsedRecords])
    const activeProfile: FileProfile = detectedProfile.profile
    const activeFieldMap: FieldMap = detectedProfile.fieldMap
    const treeSummary = useMemo(() => buildTree(parsedRecords), [parsedRecords])
    const [isOpen, setIsOpen] = useState(false)
    const [currentIndex, setCurrent] = useState(0)
    const [focusedIndex, setFocusedIndex] = useState<number | undefined>(undefined)
    const [fields, setFields] = useState<Field[]>([])
    const [title, setTitle] = useState<string>('')
    const [nachamScrollerEl, setNachamScrollerEl] = useState<HTMLDivElement | null>(null)
    const [hoverCol, setHoverCol] = useState<number | null>(null)
    const [rulerLeft, setRulerLeft] = useState<number>(0)
    const [rulerVisible, setRulerVisible] = useState(false)
    const [rulerEnabled, setRulerEnabled] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')
    const [searchHits, setSearchHits] = useState<SearchHit[]>([])
    const [searchActive, setSearchActive] = useState(-1)
    const searchInputRef = useRef<HTMLInputElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    // Valid/invalid quick state (preflight)
    const [isNachamValid, setIsNachamValid] = useState<boolean | null>(null)
    const [hasUserValidated, setHasUserValidated] = useState(false)

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

    useEffect(() => {
        if (typeof window === 'undefined') return
        try {
            setRulerEnabled(window.localStorage.getItem('nacham.web.ruler.enabled') === '1')
        } catch {
            setRulerEnabled(false)
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return
        try {
            window.localStorage.setItem('nacham.web.ruler.enabled', rulerEnabled ? '1' : '0')
        } catch { }
        if (!rulerEnabled) {
            setRulerVisible(false)
            setHoverCol(null)
        }
    }, [rulerEnabled])

    const getMonoCharWidth = useCallback(() => {
        const scroller = nachamScrollerEl
        if (!scroller) return 9
        const row = scroller.querySelector('.visor-mono') as HTMLDivElement | null
        if (!row) return 9
        const style = window.getComputedStyle(row)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return 9
        const fontStyle = style.fontStyle || 'normal'
        const fontVariant = style.fontVariant || 'normal'
        const fontWeight = style.fontWeight || '400'
        const fontSize = style.fontSize || '15px'
        const fontFamily = style.fontFamily || 'monospace'
        ctx.font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`
        const probe = '0'.repeat(106)
        const measured = ctx.measureText(probe).width
        const cw = measured / 106
        return Number.isFinite(cw) && cw > 0 ? cw : 9
    }, [nachamScrollerEl])

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
    const searchEndIdx = useMemo(
        () => (firstNineIdx >= 0 ? firstNineIdx : Math.max(0, records.length - 1)),
        [firstNineIdx, records.length]
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
        setFocusedIndex(undefined)
        setBadFromIndex(null)
        setBadRowSet(new Set())
        setRecords([])
        setIsNachamValid(null)
        setHasUserValidated(false)
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

    const runManualValidation = useCallback(() => {
        if (!records.length || isNachamValid !== true || isDevolucion) return
        const compact = records.join('')
        setHasUserValidated(true)
        resetValidator?.()
        validateText(compact, {
            checkTransCount: true,
            checkCreditos: true,
            checkDebitos: true,
            checkTotalesControl: true,
            includeAdendasInTrans: true,
            serialFromName: extractSerialFromName(fileName),
        })
    }, [records, isNachamValid, isDevolucion, resetValidator, validateText, fileName])

    // === Cargar archivo + preflight ===
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
            setFocusedIndex(0)
            setHasUserValidated(false)

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

    // 4) Parsear campos para la modal usando field map dinámico por perfil
    const parseFields = useCallback((rec: string) => {
        const type = rec.charAt(0)
        const defs = activeFieldMap[type] || []
        if (!defs.length) return []
        return extractFields(rec, defs) as Field[]
    }, [activeFieldMap])



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
            flds = parseFields(rec)
        } else if (type === '5') {
            const ts = rec.slice(50, 53).trim()
            const desc = rec.slice(53, 63).trim()
            ttl = `🌟 Registro de Encabezado de Lote</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            flds = parseFields(rec)
        } else if (type === '6') {
            const pi = findParentRecord(idx, '5')
            if (pi !== null) {
                const pr = records[pi]
                const ts = pr.slice(50, 53).trim()
                const desc = pr.slice(53, 63).trim()
                ttl = `🌟 Registro de Detalle de Transacciones</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            }
            flds = parseFields(rec)
        } else if (type === '7') {
            const pi = findParentRecord(idx, '5')
            if (pi !== null) {
                const pr = records[pi]
                const ts = pr.slice(50, 53).trim()
                const desc = pr.slice(53, 63).trim()
                ttl = `🌟 Registro de Adenda de Transacción</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            }
            flds = parseFields(rec)
        } else if (type === '8') {
            const pi = findParentRecord(idx, '5')
            if (pi !== null) {
                const pr = records[pi]
                const ts = pr.slice(50, 53).trim()
                const desc = pr.slice(53, 63).trim()
                ttl = `🌟 Registro de Control de Lote</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
            }
            flds = parseFields(rec)
        } else if (type === '9') {
            ttl = `🌟 Registro de Control de Archivo`
            flds = parseFields(rec)
        }

        setTitle(ttl)
        setFields(flds)
        setCurrent(idx)
        setFocusedIndex(idx)
        setIsOpen(true)
    }, [records, isRecordTypeClickable, parseFields, findParentRecord])

    const closeModal = () => setIsOpen(false)
    const showPrev = () => currentIndex > 0 && handleRowClick(currentIndex - 1)
    const showNext = () => currentIndex < records.length - 1 && handleRowClick(currentIndex + 1)

    // === Export Excel (6 + adenda 7 al lado) ===
    const formatTransactionValue = (value: string) => {
        if (value == null) return '0,00'

        let digits = String(value).replace(/\D/g, '') // solo dígitos
        digits = digits.replace(/^0+/, '')            // quita ceros a la izquierda

        if (!digits) return '0,00'

        if (digits.length === 1) digits = '0' + digits

        const integerPart = digits.length > 2 ? digits.slice(0, -2) : '0'
        const decimalPart = digits.slice(-2)

        return `${integerPart},${decimalPart}`
    }

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
        const fields6 = parseFields(records[first6Idx]).filter(f => f.name !== 'Tipo de registro')

        const nextIdx = first6Idx + 1
        const fields7 = records[nextIdx]?.charAt(0) === '7'
            ? parseFields(records[nextIdx]).filter(f => f.name !== 'Tipo de registro')
            : []

        const headers = ['Registro', ...fields6.map(f => f.name), ...fields7.map(f => f.name)]

        const data = type6Indices.map((idx6, i) => {
            const row: Record<string, string | number> = { Registro: i + 1 }

            parseFields(records[idx6])
                .filter(f => f.name !== 'Tipo de registro')
                .forEach(f => {
                    const raw = String(f.value ?? '') // sin meter ·
                    row[f.name] =
                        (f.name === 'Valor de la Transacción' || f.name === 'Valor de la Transaccion')
                            ? formatTransactionValue(raw)
                            : raw
                })

            const idx7 = idx6 + 1
            if (records[idx7]?.charAt(0) === '7') {
                parseFields(records[idx7])
                    .filter(f => f.name !== 'Tipo de registro')
                    .forEach(f => {
                        const raw = String(f.value ?? '') // sin meter ·
                        row[f.name] =
                            (f.name === 'Valor de la Transacción' || f.name === 'Valor de la Transaccion')
                                ? formatTransactionValue(raw)
                                : raw
                    })
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

    const selectedLineIndex = isOpen ? currentIndex : focusedIndex
    const mergedLineMarks = useMemo(() => {
        if (!records.length) return lineMarks
        const base: { start: number; end: number; type: 'error' | 'ok' | 'info'; note?: string }[][] =
            Array.from({ length: records.length }, (_, i) => (lineMarks?.[i] ? [...lineMarks[i]] : []))
        for (let i = 0; i < searchHits.length; i++) {
            const hit = searchHits[i]
            base[hit.line].push({
                start: hit.start,
                end: hit.end,
                type: 'info',
                note: i === searchActive ? '__search_active__' : '__search__',
            })
        }
        return base
    }, [records.length, lineMarks, searchHits, searchActive])
    const totalPre = useMemo(
        () => Object.values(treeSummary.prenotificTotals || {}).reduce((acc, n) => acc + Number(n || 0), 0),
        [treeSummary.prenotificTotals]
    )

    const jumpToBatch = (start: number) => {
        setFocusedIndex(start)
        if (isOpen) {
            setCurrent(start)
            setIsOpen(false)
        }
    }

    const getBatchErrorCount = (start: number, end: number) => {
        let count = 0
        for (let i = start; i <= end; i++) {
            const marks = lineMarks?.[i] || []
            for (const m of marks) {
                if (m.type === 'error') count += 1
            }
        }
        return count
    }

    useEffect(() => {
        setSearchTerm('')
        setSearchHits([])
        setSearchActive(-1)
        setSearchOpen(false)
    }, [fileName, records.length])

    useEffect(() => {
        if (!searchOpen) return
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
    }, [searchOpen])

    useEffect(() => {
        const term = searchTerm
        if (!term || !records.length) {
            setSearchHits([])
            setSearchActive(-1)
            return
        }
        const needle = term.toLowerCase()
        const hits: SearchHit[] = []
        for (let line = 0; line <= searchEndIdx; line++) {
            const row = String(records[line] || '')
            const hay = row.toLowerCase()
            let from = 0
            while (from <= hay.length - needle.length) {
                const pos = hay.indexOf(needle, from)
                if (pos === -1) break
                hits.push({ line, start: pos, end: pos + needle.length })
                from = pos + 1
            }
        }
        setSearchHits(hits)
        setSearchActive(hits.length ? 0 : -1)
    }, [searchTerm, records, searchEndIdx])

    useEffect(() => {
        if (searchActive < 0 || searchActive >= searchHits.length) return
        const active = searchHits[searchActive]
        setFocusedIndex(active.line)
        if (isOpen) setIsOpen(false)
    }, [searchActive, searchHits, isOpen])

    const jumpSearch = useCallback((direction: 1 | -1) => {
        if (!searchHits.length) return
        setSearchActive((prev) => {
            const curr = prev < 0 ? 0 : prev
            return (curr + direction + searchHits.length) % searchHits.length
        })
    }, [searchHits.length])

    const closeSearch = useCallback(() => {
        setSearchOpen(false)
        setSearchTerm('')
        setSearchHits([])
        setSearchActive(-1)
    }, [])

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const isFind = (e.key === 'f' || e.key === 'F') && (e.metaKey || e.ctrlKey)
            if (isFind) {
                e.preventDefault()
                setSearchOpen(true)
                return
            }
            if (e.key === 'F3') {
                e.preventDefault()
                jumpSearch(e.shiftKey ? -1 : 1)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [jumpSearch])

    const updateFloatingRuler = useCallback((clientX: number) => {
        if (!rulerEnabled) return
        const scroller = nachamScrollerEl
        if (!scroller) return
        const rect = scroller.getBoundingClientRect()
        const gutter = 56
        const charW = getMonoCharWidth()
        const x = clientX - rect.left + scroller.scrollLeft - gutter
        const col = Math.max(1, Math.min(106, Math.floor(x / charW) + 1))
        setHoverCol(col)
        setRulerLeft(Math.round(gutter + ((col - 1) * charW)))
        setRulerVisible(true)
    }, [nachamScrollerEl, getMonoCharWidth, rulerEnabled])

    const handleVisorMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!rulerEnabled) return
        updateFloatingRuler(e.clientX)
    }, [updateFloatingRuler, rulerEnabled])

    const handleVisorMouseLeave = useCallback(() => {
        setRulerVisible(false)
        setHoverCol(null)
    }, [])

    return (
        <>
            {/* Header */}
            <header className="w-full bg-white border-b border-[#BBC2C8] font-sans">
                <div className="mx-auto w-full max-w-[1396px] px-2 py-2 grid grid-cols-[290px_minmax(0,1fr)] gap-3 items-center">
                    <h1 className="m-0 text-xl font-semibold text-[#2D77C2]">Visor de archivos NACHAM</h1>

                    <div className="flex items-center justify-end space-x-4 min-w-0">
                        {fileName && (
                            <div className="flex items-center text-gray-700 text-sm min-w-0">
                                <span className="max-w-[42vw] break-all">{fileName}</span>

                                {/* Archivo no NACHAM (errores duros de formato/firma) */}
                                {isNachamValid === false && (
                                    <span className="ml-2 px-2 py-0.5 text-xs rounded bg-red-100 text-red-700 border border-red-300">
                                        no NACHAM
                                    </span>
                                )}

                                {/* Progreso SOLO cuando realmente valida (no en devoluciones) */}
                                {!isDevolucion && hasUserValidated && isValidating && progress > 0 && progress < 100 && (
                                    <div className="ml-3 flex items-center gap-2 text-sm text-[#2D77C2]">
                                        <span>Validando archivo… {progress}%</span>
                                        <div className="w-28 h-1.5 bg-gray-200 rounded">
                                            <div className="h-1.5 bg-[#2D77C2] rounded" style={{ width: `${progress}%` }} />
                                        </div>
                                    </div>
                                )}

                                {/* 🔵 Devolución */}
                                {isDevolucion && (
                                    <span
                                        className="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-sky-100 text-sky-700 border border-sky-300"
                                        title="Archivo de devolución (se omiten validaciones de consistencia)"
                                    >
                                        Devolución
                                    </span>
                                )}
                                {canExport && (
                                    <button
                                        type="button"
                                        onClick={exportExcel}
                                        className="ml-2 p-1 rounded hover:bg-gray-200 cursor-pointer transition"
                                        title="Exportar a Excel"
                                        dangerouslySetInnerHTML={{ __html: svgExportIcono }}
                                    />
                                )}
                                {!isDevolucion && isNachamValid === true && (
                                    <button
                                        type="button"
                                        onClick={runManualValidation}
                                        disabled={isValidating}
                                        className={`relative ml-2 p-1 rounded cursor-pointer transition ${isValidating
                                            ? 'opacity-70 text-blue-700 bg-blue-50'
                                            : hasUserValidated && errCount === 0
                                                ? 'text-green-700 bg-green-50 hover:bg-green-100'
                                                : hasUserValidated && errCount > 0
                                                    ? 'text-rose-700 bg-rose-50 hover:bg-rose-100'
                                                    : 'text-slate-700 hover:bg-gray-200'
                                            }`}
                                        title="Validar archivo"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
                                            <path d="M9 12l2 2 4-4" />
                                        </svg>
                                        {hasUserValidated && errCount > 0 && (
                                            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[11px] leading-5 text-center font-semibold">
                                                {errCount}
                                            </span>
                                        )}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setRulerEnabled((v) => !v)}
                                    className={`ml-2 p-1 rounded cursor-pointer transition ${rulerEnabled ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'hover:bg-gray-200 text-gray-700'}`}
                                    title={rulerEnabled ? 'Desactivar regla' : 'Activar regla'}
                                    aria-pressed={rulerEnabled}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M4 18h16" />
                                        <path d="M6 18v-3M9 18v-2M12 18v-3M15 18v-2M18 18v-3" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSearchOpen((v) => !v)}
                                    className={`ml-1 p-1 rounded cursor-pointer transition ${searchOpen ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'hover:bg-gray-200 text-gray-700'}`}
                                    title={searchOpen ? 'Ocultar búsqueda' : 'Buscar'}
                                    aria-pressed={searchOpen}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="11" cy="11" r="7" />
                                        <path d="M16.5 16.5L21 21" />
                                    </svg>
                                </button>
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="ml-1 p-1 rounded cursor-pointer transition hover:bg-gray-200 text-gray-700"
                            title="Seleccionar NACHAM"
                            aria-label="Seleccionar NACHAM"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5V10" />
                                <path d="M3 11h18l-2 7.5A2 2 0 0 1 17.1 20H6.9A2 2 0 0 1 5 18.5L3 11z" />
                            </svg>
                        </button>
                        <input ref={fileInputRef} id="fileInput" type="file" accept="*.*" className="hidden" onChange={handleFile} />
                    </div>
                </div>
            </header>


            {/* Main */}
            <main className="p-2 space-y-6 overflow-x-auto">
                {records.length > 0 ? (
                    <div className="w-full overflow-x-auto">
                    <div className="m-2 mx-auto w-max min-w-[1100px] grid grid-cols-[290px_1080px] gap-3">
                        <aside className="rounded-xl border border-slate-200 bg-white p-3 h-[80vh] flex flex-col">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="rounded-lg border border-slate-200 p-2">
                                    <div className="text-xs text-slate-500">Total Caracteres</div>
                                    <div className="text-2xl font-semibold text-slate-900">{Number(records.length * 106).toLocaleString('es-CO')}</div>
                                </div>
                                <div className="rounded-lg border border-slate-200 p-2">
                                    <div className="text-xs text-slate-500">Total Registros</div>
                                    <div className="text-2xl font-semibold text-slate-900">{Number(records.length).toLocaleString('es-CO')}</div>
                                </div>
                                <div className="rounded-lg border border-slate-200 p-2">
                                    <div className="text-xs text-slate-500">Lotes</div>
                                    <div className="text-2xl font-semibold text-slate-900">{Number(treeSummary.batches.length).toLocaleString('es-CO')}</div>
                                </div>
                                {Number(treeSummary.totalOrders || 0) > 0 && (
                                    <div className="rounded-lg border border-slate-200 p-2">
                                        <div className="text-xs text-slate-500">Ordenes de Pago</div>
                                        <div className="text-2xl font-semibold text-slate-900">{Number(treeSummary.totalOrders).toLocaleString('es-CO')}</div>
                                    </div>
                                )}
                                {totalPre > 0 && (
                                    <div className="rounded-lg border border-slate-200 p-2">
                                        <div className="text-xs text-slate-500">Total Prenotificaciones</div>
                                        <div className="text-2xl font-semibold text-slate-900">{Number(totalPre).toLocaleString('es-CO')}</div>
                                    </div>
                                )}
                                {Number(treeSummary.totalTransfers || 0) > 0 && (
                                    <div className="rounded-lg border border-slate-200 p-2">
                                        <div className="text-xs text-slate-500">Registros de Traslado</div>
                                        <div className="text-2xl font-semibold text-slate-900">{Number(treeSummary.totalTransfers).toLocaleString('es-CO')}</div>
                                    </div>
                                )}
                                {Number(treeSummary.totalTregcontrol || 0) > 0 && (
                                    <div className="rounded-lg border border-slate-200 p-2">
                                        <div className="text-xs text-slate-500">Total RC Traslado</div>
                                        <div className="text-2xl font-semibold text-slate-900">{Number(treeSummary.totalTregcontrol).toLocaleString('es-CO')}</div>
                                    </div>
                                )}
                                {hasNonZeroAmount(treeSummary.fileDebitTotal9) && (
                                    <div className="rounded-lg border border-slate-200 p-2 col-span-2">
                                        <div className="text-xs text-slate-500">Total Débitos</div>
                                        <div className="text-xl font-semibold text-slate-900 break-all">{formatMoneyFromRaw(treeSummary.fileDebitTotal9)}</div>
                                    </div>
                                )}
                                {hasNonZeroAmount(treeSummary.fileCreditTotal9) && (
                                    <div className="rounded-lg border border-slate-200 p-2 col-span-2">
                                        <div className="text-xs text-slate-500">Total Créditos</div>
                                        <div className="text-xl font-semibold text-slate-900 break-all">{formatMoneyFromRaw(treeSummary.fileCreditTotal9)}</div>
                                    </div>
                                )}
                            </div>
                            <div className="mt-3 flex-1 min-h-0 overflow-auto space-y-2 pr-1 pb-2">
                                {treeSummary.batches.map((batch) => {
                                    const errorCount = getBatchErrorCount(batch.start, batch.end)
                                    const preCount = Object.values(batch.prenotificCounts || {}).reduce((acc, val) => acc + Number(val || 0), 0)
                                    const amountParts: string[] = []
                                    if (hasNonZeroAmount(batch.debitTotal8)) amountParts.push(`Déb: ${formatMoneyFromRaw(batch.debitTotal8)}`)
                                    if (hasNonZeroAmount(batch.creditTotal8)) amountParts.push(`Créd: ${formatMoneyFromRaw(batch.creditTotal8)}`)
                                    return (
                                        <button
                                            key={`${batch.batchNo}-${batch.start}`}
                                            type="button"
                                            onClick={() => jumpToBatch(batch.start)}
                                            className={`w-full text-left rounded-lg border p-2 transition ${selectedLineIndex === batch.start ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="font-semibold text-slate-900">{batch.id || `Lote ${batch.batchNo}`}</div>
                                                <div className="flex items-center gap-2">
                                                    {errorCount > 0 && (
                                                        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[11px] font-semibold">
                                                            {errorCount}
                                                        </span>
                                                    )}
                                                    <div className="text-xs text-slate-600">{batch.start + 1}-{batch.end + 1}</div>
                                                </div>
                                            </div>
                                            <div className="text-xs text-slate-600 mt-1">
                                                Registros:{batch.entryCount} Adendas:{batch.addendaCount}
                                                {batch.orderCount > 0 ? ` OP:${batch.orderCount}` : ''}
                                                {batch.transferCount > 0 ? ` Trasl:${batch.transferCount}` : ''}
                                                {preCount > 0 ? ` Prenot:${preCount}` : ''}
                                            </div>
                                            {amountParts.length > 0 && (
                                                <div className="text-xs text-slate-700 mt-1">{amountParts.join('  ')}</div>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </aside>

                        <div className="h-[80vh] flex flex-col gap-2">
                            {searchOpen && (
                                <div className="rounded-lg border border-slate-200 bg-white px-2 py-2 flex items-center gap-2">
                                    <input
                                        ref={searchInputRef}
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                jumpSearch(e.shiftKey ? -1 : 1)
                                            } else if (e.key === 'Escape') {
                                                e.preventDefault()
                                                closeSearch()
                                            }
                                        }}
                                        placeholder="Buscar en archivo..."
                                        className="w-[300px] max-w-[40vw] border border-slate-300 rounded px-3 py-1.5 text-sm outline-none focus:border-blue-400"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => jumpSearch(-1)}
                                        className="w-8 h-8 rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
                                        title="Anterior"
                                    >
                                        ↑
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => jumpSearch(1)}
                                        className="w-8 h-8 rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
                                        title="Siguiente"
                                    >
                                        ↓
                                    </button>
                                    <span className="text-sm text-slate-600 min-w-[220px]">
                                        {searchHits.length && searchActive >= 0
                                            ? `${searchActive + 1} de ${searchHits.length} · Línea ${searchHits[searchActive].line + 1} · Pos ${searchHits[searchActive].start + 1}-${searchHits[searchActive].end}`
                                            : 'Sin búsqueda'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={closeSearch}
                                        className="ml-auto w-8 h-8 rounded border border-slate-300 text-slate-700 hover:bg-slate-100"
                                        title="Cerrar búsqueda"
                                    >
                                        ✕
                                    </button>
                                </div>
                            )}
                        <div className="flex-1 rounded-xl p-[2px] bg-[linear-gradient(45deg,#C9F5FF_0%,#FFC7D1_48%,#8AB087_100%)] shadow-md">
                            <div
                                className="relative h-full rounded-[inherit] bg-white border border-gray-200 overflow-hidden"
                                style={{ ["--visor-gutter" as any]: "56px" }}
                                onMouseMove={handleVisorMouseMove}
                                onMouseLeave={handleVisorMouseLeave}
                            >
                                {rulerEnabled && rulerVisible && hoverCol !== null && (
                                    <>
                                        <div
                                            className="pointer-events-none absolute top-0 bottom-0 z-20"
                                            style={{
                                                left: `${rulerLeft}px`,
                                                width: '1px',
                                                background: 'rgba(59,130,246,0.55)',
                                            }}
                                        />
                                        <div
                                            className="pointer-events-none absolute z-30 text-[11px] leading-none px-2 py-1 rounded bg-blue-600 text-white shadow"
                                            style={{
                                                left: `${Math.max(4, rulerLeft - 22)}px`,
                                                top: `8px`,
                                            }}
                                        >
                                            Pos {hoverCol}
                                        </div>
                                    </>
                                )}
                                <NachamVisor
                                    records={records}
                                    lineHeight={20}
                                    height={listHeight}
                                    onRowClick={handleRowClick}
                                    selectedIndex={selectedLineIndex}
                                    badFromIndex={badFromIndex}
                                    badRows={[...badRowSet]}
                                    lineStatus={lineStatus}
                                    lineMarks={mergedLineMarks}
                                    fieldMap={activeFieldMap}
                                    isClickable={isClickable}
                                    onScrollerReady={(el) => setNachamScrollerEl(el)}
                                />
                            </div>
                        </div>
                        </div>
                    </div>
                    </div>
                ) : (
                    <></>
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
