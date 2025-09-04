'use client'

import { useEffect, useMemo, useRef } from 'react'
import { FixedSizeList as List } from 'react-window'

interface NachamVisorProps {
    records: string[]
    lineHeight?: number
    height?: number
    onRowClick: (index: number) => void
    selectedIndex?: number
    badFromIndex?: number | null
    badRows?: number[] // filas con primer carácter inválido
}

export default function NachamVisor({
    records,
    lineHeight = 28,
    height = 600,
    onRowClick,
    selectedIndex,
    badFromIndex = null,
    badRows = [],
}: NachamVisorProps) {
    const listRef = useRef<List>(null)

    // Set para lookup O(1)
    const badRowSet = useMemo(() => new Set(badRows), [badRows])

    // Cuando cambia selectedIndex, hacemos scroll para que se vea
    useEffect(() => {
        if (typeof selectedIndex === 'number' && listRef.current) {
            listRef.current.scrollToItem(selectedIndex, 'auto')
        }
    }, [selectedIndex])

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
        const paintFromHere = badFromIndex !== null && index >= badFromIndex
        const baseZebra = index % 2 ? 'bg-gray-50' : 'bg-white'
        // prioridad: seleccionado > error puntual > guía desde índice > zebra
        const rowBg = isSelected
            ? 'selected-row'
            : isBadStart
                ? 'bg-red-200'
                : paintFromHere
                    ? 'bg-red-50'
                    : baseZebra

        return (
            <div
                style={style}
                className={`flex font-mono whitespace-pre overflow-hidden hover:bg-[rgb(228,242,251)] cursor-pointer ${rowBg}`}
                onClick={() => onRowClick(index)}
                title={isBadStart ? 'Tipo de registro inválido' : undefined}
            >
                {rec.split('').map((ch, i) => (
                    <span key={i}>{ch}</span>
                ))}
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