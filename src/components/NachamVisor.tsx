'use client'

import { useEffect, useRef } from 'react'
import { FixedSizeList as List } from 'react-window'

interface NachamVisorProps {
    records: string[]
    lineHeight?: number
    height?: number
    onRowClick: (index: number) => void
    selectedIndex?: number
}

export default function NachamVisor({
    records,
    lineHeight = 28,
    height = 600,
    onRowClick,
    selectedIndex,
}: NachamVisorProps) {
    const listRef = useRef<List>(null)

    // Cuando cambia selectedIndex, hacemos scroll para que se vea
    useEffect(() => {
        if (
            typeof selectedIndex === 'number' &&
            listRef.current !== null
        ) {
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

        return (
            <div
                style={style}
                className={`
          flex font-mono whitespace-pre overflow-hidden
          ${isSelected
                        ? 'selected-row'
                        : index % 2
                            ? 'bg-gray-50'
                            : 'bg-white'
                    }
        `}
                onClick={() => onRowClick(index)}
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
