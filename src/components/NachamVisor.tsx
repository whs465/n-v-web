'use client'
import type React from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { FixedSizeList as List } from 'react-window'
import type { LineStatus, LineMark, MarkKind } from '@/types/nacham'
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
    isClickable?: (idx: number, rec: string) => boolean
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
    isClickable,
}: NachamVisorProps) {
    const listRef = useRef<List>(null)

    // Set para lookup O(1)
    const badRowSet = useMemo(() => new Set(badRows), [badRows])

    useEffect(() => {
        listRef.current?.scrollToItem(0, 'start')
    }, [records]) // cuando cambia el dataset

    // Cuando cambia selectedIndex, hacemos scroll para que se vea
    useEffect(() => {
        if (typeof selectedIndex === 'number' && listRef.current) {
            listRef.current.scrollToItem(selectedIndex, 'auto')
        }
    }, [selectedIndex])

    // Utilidad: partir una línea en segmentos coloreados a partir de las marcas
    const renderWithMarks = (text: string, marks: LineMark[]) => {
        // Si no hay marcas, devolvemos char a char (solo puntitos para espacios)
        if (!marks?.length) {
            return text.split('').map((ch, i) => (
                <span key={i}>{ch === ' ' ? '·' : ch}</span>
            ))
        }

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
        const boundaries = Array.from(cuts).sort((a, b) => a - b)

        // Helper: tipo que cubre una posición
        const typeAt = (pos: number): MarkKind | undefined =>
            clean.find(m => pos >= m.start && pos < m.end)?.type

        const chunks: React.ReactNode[] = []
        for (let i = 0; i < boundaries.length - 1; i++) {
            const s = boundaries[i]
            const e = boundaries[i + 1]
            const segment = text.slice(s, e)

            // Clase de fondo por prioridad (error > ok > info)
            let bg = ''
            let title: string | undefined
            // Encontrar marca que cubre el inicio del segmento s (para tooltip)
            const owner = clean.find(m => s >= m.start && e <= m.end)
            if (owner) title = owner.note

            const t = typeAt(s)
            if (t === 'error') bg = 'bg-rose-200/80 underline decoration-rose-500'
            else if (t === 'ok') bg = 'bg-green-100/50'
            else if (t === 'info') bg = 'bg-sky-100/60'

            // — NUEVO — Borde separador a la derecha para todos los segmentos marcados
            // (incluidos errores consecutivos). No afecta a segmentos sin marca.
            let sep = ''
            if (t === 'error') sep = 'border-r border-rose-500/60'
            else if (t === 'ok') sep = 'border-r border-green-600/30'
            else if (t === 'info') sep = 'border-r border-sky-600/30'
            // Si no hay marca (t undefined), dejamos sin borde.

            chunks.push(
                <span key={`${s}-${e}`} className={`${bg} ${sep}`} title={title}>
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
        return (
            <div
                style={style}
                className={`flex font-mono whitespace-pre overflow-hidden
      ${canOpen ? 'cursor-pointer hover:bg-[rgb(228,242,251)]' : 'cursor-not-allowed opacity-80'}
      ${rowBg}`}
                onClick={() => canOpen && onRowClick(index)}
                title={rowTitle}
            >
                {renderWithMarks(rec, marks)}
            </div>
        )
    }

    return (
        <List
            ref={listRef}
            className="border border-gray-300 rounded shadow font-mono bg-white"
            height={height}
            itemCount={records.length}
            itemSize={lineHeight}
            width="100%"
            overscanCount={10}
        >
            {Row}
        </List>
    )
}