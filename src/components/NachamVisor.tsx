'use client'
import React from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { FixedSizeList as List } from 'react-window'
import type { LineStatus, LineMark, MarkKind } from '@/types/nacham'
import type { FieldMap } from '@/core/nacham'

const InnerElement = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ style, ...props }, ref) => (
        <div
            ref={ref}
            style={{ ...(style || {}), minWidth: '1040px', width: 'max-content' }}
            {...props}
        />
    )
)
InnerElement.displayName = 'InnerElement'
interface NachamVisorProps {
    records: string[]
    lineHeight?: number
    height?: number
    onRowClick: (index: number) => void
    selectedIndex?: number
    badFromIndex?: number | null
    badRows?: number[] // filas con primer carácter inválido
    lineStatus?: LineStatus[]
    lineMarks?: LineMark[][]
    fieldMap?: FieldMap
    isClickable?: (idx: number, rec: string) => boolean
    onScrollerReady?: (el: HTMLDivElement) => void
}

export default function NachamVisor({
    records,
    lineHeight = 28,
    height = 600,
    onRowClick,
    selectedIndex,
    badFromIndex = null,
    badRows = [],
    lineStatus,
    lineMarks,
    fieldMap,
    isClickable,
    onScrollerReady
}: NachamVisorProps) {
    const listRef = useRef<List>(null)

    // Set para lookup O(1)
    const badRowSet = useMemo(() => new Set(badRows), [badRows])
    const outerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (outerRef.current) {
            outerRef.current.classList.add("thin-scroll");
            outerRef.current.style.overflowX = "auto";
            outerRef.current.style.overflowY = "auto";
            onScrollerReady?.(outerRef.current);
        }
    }, [onScrollerReady]);

    useEffect(() => {
        listRef.current?.scrollToItem(0, 'start')
    }, [records]) // cuando cambia el dataset

    // Cuando cambia selectedIndex, hacemos scroll para que se vea
    useEffect(() => {
        if (typeof selectedIndex === 'number' && listRef.current) {
            // Estandariza navegación: deja la fila seleccionada con un pequeño margen superior.
            const anchorIndex = Math.max(0, selectedIndex - 2)
            listRef.current.scrollToItem(anchorIndex, 'start')
        }
    }, [selectedIndex])

    // Utilidad: partir una línea en segmentos coloreados a partir de las marcas
    const renderWithMarks = (
        text: string,
        marks: LineMark[],
        tips: Array<{ start: number; end: number; note: string; toneClass: string }>
    ) => {

        // Normalizar y ordenar
        const clean = marks
            .map(m => ({
                start: Math.max(0, Math.min(text.length, m.start)),
                end: Math.max(0, Math.min(text.length, m.end)),
                type: m.type,
                note: m.note,
            }))
            .filter(m => m.end > m.start)
            .sort((a, b) => a.start - b.start)

        // Puntos de corte
        const cuts = new Set<number>([0, text.length])
        clean.forEach(m => { cuts.add(m.start); cuts.add(m.end) })
        tips.forEach(t => { cuts.add(t.start); cuts.add(t.end) })
        const boundaries = Array.from(cuts).sort((a, b) => a - b)

        const priority: Record<MarkKind, number> = { error: 5, ok: 2, info: 1 }
        // Helper: tipo que cubre una posición con prioridad
        const typeAt = (pos: number): MarkKind | undefined => {
            const covering = clean.filter(m => pos >= m.start && pos < m.end)
            if (!covering.length) return undefined
            covering.sort((a, b) => priority[b.type] - priority[a.type])
            return covering[0].type
        }

        const chunks: React.ReactNode[] = []
        for (let i = 0; i < boundaries.length - 1; i++) {
            const s = boundaries[i]
            const e = boundaries[i + 1]
            const segment = text.slice(s, e)

            // Clase de fondo por prioridad (error > ok > info)
            let bg = ''
            let title: string | undefined
            // Encontrar marca que cubre el inicio del segmento s (para tooltip)
            const coveredBy = clean.filter(m => s >= m.start && e <= m.end)
            const owner = coveredBy[0]
            const tipOwner = tips.find(t => s >= t.start && e <= t.end)
            const isSearchActive = coveredBy.some(m => m.note === '__search_active__')
            const isSearch = isSearchActive || coveredBy.some(m => m.note === '__search__')
            if (owner && !isSearch) title = owner.note
            else if (tipOwner) title = tipOwner.note

            const t = typeAt(s)
            if (isSearchActive) bg = 'bg-amber-300/70 rounded-[2px] ring-1 ring-amber-500/70'
            else if (isSearch) bg = 'bg-amber-200/50 rounded-[2px]'
            else if (t === 'error') bg = 'bg-rose-200/80 underline decoration-rose-500'
            else if (t === 'ok') bg = 'bg-green-100/70 underline decoration-green-400'
            else if (t === 'info') bg = 'bg-gray-100/60'
            else if (tipOwner) bg = tipOwner.toneClass

            // — NUEVO — Borde separador a la derecha para todos los segmentos marcados
            // (incluidos errores consecutivos). No afecta a segmentos sin marca.
            let sep = ''
            if (isSearchActive || isSearch) sep = ''
            else if (t === 'error') sep = 'border-r border-rose-500/60'
            else if (t === 'ok') sep = 'border-r border-green-600/40'
            else if (t === 'info') sep = 'border-r border-sky-600/30'
            else if (tipOwner) sep = 'border-r border-slate-300/70'
            // Si no hay marca (t undefined), dejamos sin borde.

            chunks.push(
                <span key={`${s}-${e}`} className={`${bg} ${sep} ${tipOwner ? 'border-y border-slate-300/40 rounded-[2px]' : ''}`} title={title}>
                    {segment.replace(/ /g, '·')}
                </span>
            )
        }
        return chunks
    }

    const Row = ({
        index,
        style,
    }: {
        index: number
        style: React.CSSProperties
    }) => {
        const rec = records[index]
        const isSelected = index === selectedIndex
        const isBadStart = badRowSet.has(index)

        const st = lineStatus?.[index] as LineStatus | undefined
        const marks = lineMarks?.[index] ?? []
        const defs = fieldMap?.[rec?.charAt(0)] || []
        const tips = defs.map((d, idx) => ({
            start: Math.max(0, Number(d.start || 1) - 1),
            end: Math.min(rec.length, Number(d.end || 0)),
            note: `${d.name} (${d.start}-${d.end})`,
            // Fondo ultra suave por campo (alternado) para guía visual sin ruido.
            toneClass: idx % 2 === 0 ? 'bg-slate-100/20' : 'bg-sky-50/25',
        })).filter((t) => t.end > t.start)

        const baseZebra = index % 2 ? 'bg-gray-50' : 'bg-white'
        const paintFromHere = badFromIndex !== null && index >= badFromIndex

        const rowBg = isSelected
            ? 'selected-row'
            : isBadStart
                ? 'bg-rose-200'
                : paintFromHere
                    ? 'bg-rose-50'
                    : baseZebra

        // tooltip general si no hay marcas finas
        const rowTitle =
            marks.length > 0
                ? undefined
                : st === 'error'
                    ? 'Inconsistencias en el lote (ver registro 8)'
                    : isBadStart
                        ? 'Tipo de registro inválido'
                        : undefined

        const canOpen = isClickable ? isClickable(index, rec) : true
        const rowStyle: React.CSSProperties = { ...style, width: 'max-content', minWidth: '100%' }
        return (
            <div
                style={rowStyle}
                className={`flex w-max visor-mono whitespace-pre overflow-hidden
  ${canOpen ? 'cursor-pointer hover:bg-[rgb(228,242,251)]' : 'cursor-not-allowed opacity-80'}
  ${rowBg}`}

                onClick={() => canOpen && onRowClick(index)}
                onDoubleClick={() => canOpen && onRowClick(index)} // si tu modal es doble click, poné tu handler acá
                title={rowTitle}
            >
                {/* ✅ Spacer visual: NO afecta el layout de la fila para eventos */}
                <span aria-hidden="true" style={{ display: "inline-block", width: "var(--visor-gutter)" }} />
                {renderWithMarks(rec, marks, tips)}
            </div>
        )

    }

    return (
        <List
            ref={listRef}
            outerRef={outerRef}
            className="rounded shadow font-mono bg-white"
            height={height}
            itemCount={records.length}
            itemSize={lineHeight}
            width="100%"
            innerElementType={InnerElement}
            overscanCount={10}
        >
            {Row}
        </List>
    )
}
