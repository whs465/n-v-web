'use client'
// src/hooks/useNachamValidator.ts
import { useEffect, useRef, useState } from 'react'
import type { LineStatus, LineMark, ValidationOptions } from '@/types/nacham'

type DonePayload = {
    lineStatus: ('ok' | 'error' | undefined)[]
    lineReason: (string | undefined)[]
    globalErrors: string[]
    lineMarks?: LineMark[][]
}

export function useNachamValidator() {
    const workerRef = useRef<Worker | null>(null)
    const [progress, setProgress] = useState(0)
    const [isValidating, setIsValidating] = useState(false)
    const [lineStatus, setLineStatus] = useState<LineStatus[]>([])
    const [lineReason, setLineReason] = useState<(string | undefined)[]>([])
    const [globalErrors, setGlobalErrors] = useState<string[]>([])
    const [lineMarks, setLineMarks] = useState<LineMark[][]>([])

    const minShowMsRef = useRef<number>(300)
    const startTsRef = useRef<number>(0)

    const reset = () => {
        setIsValidating(false)
        setProgress(0)
        setLineStatus([])
        setLineMarks([])
        setGlobalErrors([])
    }

    useEffect(() => {
        // Import dinámico compatible con Next
        const w = new Worker(new URL('../workers/nachamValidator.worker.ts', import.meta.url))
        workerRef.current = w
        w.onmessage = (e: MessageEvent) => {
            const { type } = e.data || {}
            if (type === 'progress') {
                console.log('[worker] progreso', e.data.pct)
                setProgress(e.data.pct ?? 0)
            }
            if (type === 'done') {
                console.log('[worker] Termino!', e.data)
                const p = e.data as DonePayload & { type: 'done' }
                setLineStatus(p.lineStatus)
                setLineReason(p.lineReason)
                setGlobalErrors(p.globalErrors)
                setLineMarks(p.lineMarks || [])
                setProgress(100)

                const elapsed = Date.now() - startTsRef.current
                const rest = Math.max(0, minShowMsRef.current - elapsed)
                setTimeout(() => setIsValidating(false), rest)
            }
        }
        return () => { w.terminate() }
    }, [])

    const validateFile = async (file: File, options?: object) => {
        const buffer = await file.arrayBuffer()
        startTsRef.current = Date.now()
        setIsValidating(true)
        setProgress(1)
        workerRef.current?.postMessage({ type: 'validate-file', buffer, options }, [buffer])
    }

    const validateText = (text: string, options?: object) => {
        startTsRef.current = Date.now()
        setIsValidating(true)
        setProgress(1)
        workerRef.current?.postMessage({ type: 'validate-text', text, options })
    }

    return { isValidating, progress, lineStatus, lineReason, globalErrors, lineMarks, validateFile, validateText, reset }
}
