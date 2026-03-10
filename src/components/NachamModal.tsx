// components/NachamModal.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

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
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [copiedId, setCopiedId] = useState<number | null>(null)
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

    useEffect(() => {
        return () => {
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
        }
    }, [])

    const copyTrimmedValue = async (field: Field) => {
        const trimmed = (field.value || '').trim()
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(trimmed)
            } else {
                const ta = document.createElement('textarea')
                ta.value = trimmed
                ta.style.position = 'fixed'
                ta.style.opacity = '0'
                document.body.appendChild(ta)
                ta.focus()
                ta.select()
                document.execCommand('copy')
                document.body.removeChild(ta)
            }
            setCopiedId(field.id)
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
            copyTimerRef.current = setTimeout(() => setCopiedId(null), 1200)
        } catch {
            // noop: si falla clipboard no rompemos la UI
        }
    }

    const modalHeading = useMemo(() => {
        const raw = String(title || '')
        const [mainRaw = '', subRaw = ''] = raw.split(/<\/?br\s*\/?>/i)
        const clean = (txt: string) =>
            txt
                .replace(/<[^>]*>/g, ' ')
                .replace(/&nbsp;/gi, ' ')
                .replace(/[🌟✨⭐]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
        return {
            main: clean(mainRaw),
            sub: clean(subRaw),
        }
    }, [title])

    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 flex items-center justify-center bg-[rgba(128,128,128,0.3)]"
        >
            <div
                className="m-2 border border-gray-300 rounded-lg shadow-md bg-white p-6 w-full max-w-4xl text-sm"
                onClick={e => e.stopPropagation()}
            >
                <h2 className="text-[28px] leading-tight font-semibold font-sans text-[#2D77C2]">
                    {modalHeading.main}
                </h2>
                {modalHeading.sub && (
                    <p className="mt-1 mb-4 text-[16px] leading-snug font-medium text-slate-700">
                        {modalHeading.sub}
                    </p>
                )}

                <div ref={tableContainerRef} className="overflow-y-auto max-h-[60vh]">
                    <table className="table-fixed w-full border-collapse font-sans">
                        <colgroup>
                            <col style={{ width: '5%' }} />
                            <col style={{ width: '34%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '41%' }} />
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
                                    <td className="py-1 px-3 border-b border-[#2D77C2] text-center align-top">{f.id}</td>
                                    <td className="py-1 px-3 border-b border-[#2D77C2] text-left align-top break-words whitespace-normal leading-snug">{f.name}</td>
                                    <td className="py-1 px-2 border-b border-[#2D77C2] text-center align-top whitespace-nowrap">{f.length}</td>
                                    <td className="py-1 px-2 border-b border-[#2D77C2] text-center align-top whitespace-nowrap">{f.position}</td>
                                    <td className="py-1 px-3 border-b border-[#2D77C2] align-top">
                                        <div className="flex items-start justify-between gap-2">
                                            <span className="font-mono whitespace-pre-wrap break-all leading-snug">{f.value.replace(/ /g, '·')}</span>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    copyTrimmedValue(f)
                                                }}
                                                className={`shrink-0 rounded border p-1 transition ${copiedId === f.id
                                                    ? 'border-green-300 bg-green-50 text-green-700'
                                                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                                    }`}
                                                title="Copiar"
                                                aria-label="Copiar"
                                            >
                                                {copiedId === f.id ? (
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M20 6 9 17l-5-5" />
                                                    </svg>
                                                ) : (
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                    </svg>
                                                )}
                                            </button>
                                        </div>
                                    </td>
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
