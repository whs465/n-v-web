
export type MarkKind = 'error' | 'ok' | 'info'
export type LineStatus = 'ok' | 'error' | undefined

export type MarkType = 'error' | 'ok' | 'info'
export type LineMark = { start: number; end: number; type: MarkType; note?: string }

export interface ValidationOptions {
    checkTransCount?: boolean
    checkDebitos?: boolean
    checkCreditos?: boolean
    checkTotalesControl?: boolean
    includeAdendasInTrans?: boolean
    serialFromName?: string
}