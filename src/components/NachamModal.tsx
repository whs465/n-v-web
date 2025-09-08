// components/NachamModal.tsx
'use client'

import { useEffect, useRef } from 'react'

/**
 * Estructura de campo para mostrar en modal
 */
export interface Field {
    id: number
    name: string
    length: number
    position: string
    value: string
}

interface NachamModalProps {
    isOpen: boolean
    title: string
    fields: Field[]
    onClose: () => void
    onPrev: () => void
    onNext: () => void
    canPrev: boolean
    canNext: boolean
}

export default function NachamModal({
    isOpen,
    title,
    fields,
    onClose,
    onPrev,
    onNext,
    canPrev,
    canNext,
}: NachamModalProps) {

    const tableContainerRef = useRef<HTMLDivElement>(null)
    // Cerrar con ESC
    useEffect(() => {
        const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [onClose])

    // Cuando cambian los campos (campo seleccionado), volvemos el scroll al inicio
    useEffect(() => {
        if (tableContainerRef.current) {
            tableContainerRef.current.scrollTop = 0
        }
    }, [fields])

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 flex items-center justify-center bg-[rgba(128,128,128,0.3)]"
        >
            <div
                className="m-2 border border-gray-300 rounded-lg shadow-md bg-white p-6 w-full max-w-4xl text-sm"
                onClick={e => e.stopPropagation()}
            >
                <h2
                    className="text-xl font-bold mb-4 font-sans text-[#2D77C2]"
                    dangerouslySetInnerHTML={{ __html: title }}
                />

                <div ref={tableContainerRef} className="overflow-y-auto max-h-[60vh]">
                    <table className="table-fixed w-full border-collapse font-sans whitespace-nowrap">
                        <colgroup>
                            <col style={{ width: '5%' }} />
                            <col style={{ width: '35%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '15%' }} />
                            <col style={{ width: '30%' }} />
                        </colgroup>
                        <thead className="bg-[rgb(239,241,251)] text-[#2D77C2]">
                            <tr>
                                <th className="py-2 px-3 border-b border-[#2D77C2] font-medium">#</th>
                                <th className="py-2 px-3 border-b border-[#2D77C2] font-medium">Nombre de Campo</th>
                                <th className="py-2 px-3 border-b border-[#2D77C2] font-medium text-center">Long.</th>
                                <th className="py-2 px-3 border-b border-[#2D77C2] font-medium text-center">Pos.</th>
                                <th className="py-2 px-3 border-b border-[#2D77C2] font-medium">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {fields.map((f) => (
                                <tr key={f.id} className="hover:bg-[rgb(228,242,251)] cursor-pointer">
                                    <td className="py-1 px-3 border-b border-[#2D77C2] text-center">{f.id}</td>
                                    <td className="py-1 px-3 border-b border-[#2D77C2] text-left">{f.name}</td>
                                    <td className="py-1 px-3 border-b border-[#2D77C2] text-center">{f.length}</td>
                                    <td className="py-1 px-3 border-b border-[#2D77C2] text-center">{f.position}</td>
                                    <td className="py-2 px-3 border-b border-[#2D77C2] font-mono whitespace-pre">{f.value.replace(/ /g, '·')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="flex items-center py-2 justify-between">
                    <button
                        onClick={onPrev}
                        disabled={!canPrev}
                        className={`inline-block px-4 py-2 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm font-medium rounded shadow cursor-pointer transition ${!canPrev ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        &#10094;
                    </button>

                    <button
                        onClick={onClose}
                        className="inline-block px-4 py-2 bg-[#C22D2D] hover:bg-[#B32828] active:bg-[#8F2222] text-white text-sm font-medium rounded shadow cursor-pointer transition"
                    >
                        Cerrar
                    </button>

                    <button
                        onClick={onNext}
                        disabled={!canNext}
                        className={`inline-block px-4 py-2 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm font-medium rounded shadow cursor-pointer transition ${!canNext ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        &#10095;
                    </button>
                </div>
            </div>
        </div>
    )
}
