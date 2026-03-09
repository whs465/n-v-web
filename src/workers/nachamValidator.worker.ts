// @ts-nocheck
import type { LineStatus, MarkKind, ValidationOptions } from '@/types/nacham'

type LineMark = { start: number; end: number; type: MarkKind; note?: string }

type WorkerInMsg =
  | { type: 'validate-file'; buffer: ArrayBuffer; options?: ValidationOptions }
  | { type: 'validate-text'; text: string; options?: ValidationOptions }

type WorkerOutMsg =
  | { type: 'progress'; pct: number }
  | {
      type: 'done'
      lineStatus: LineStatus[]
      lineReason: (string | undefined)[]
      globalErrors: string[]
      lineMarks?: LineMark[][]
      isDevolucion?: boolean
    }

declare const self: DedicatedWorkerGlobalScope

const RECORD_LEN = 106
const VALID_TYPES = new Set(['1', '5', '6', '7', '8', '9'])
const IDENT_SEQUENCE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const defaultOptions: Required<ValidationOptions> = {
  checkTransCount: true,
  checkDebitos: true,
  checkCreditos: true,
  checkTotalesControl: true,
  includeAdendasInTrans: true,
  serialFromName: '',
}

function post(msg: WorkerOutMsg) {
  self.postMessage(msg)
}

function buildExpectedActualNote(expected: string, actual: string) {
  return 'Esperado "' + String(expected || '') + '" · Actual "' + String(actual || '') + '"'
}

function parseRecords(compact: string) {
  const out = []
  for (let i = 0; i + RECORD_LEN <= compact.length; i += RECORD_LEN) {
    const raw = compact.slice(i, i + RECORD_LEN)
    out.push({ index: out.length, line: out.length + 1, type: String(raw[0] || ''), raw })
  }
  return out
}

function parseBatchSeq(raw: string) {
  const text = String(raw || '').replace(/\D/g, '')
  if (!text) return null
  return Number.parseInt(text, 10)
}

function parseIntDigits(raw: string) {
  const text = String(raw || '').replace(/\D/g, '')
  if (!text) return null
  return Number.parseInt(text, 10)
}

function parseBigIntTrimmed(raw: string) {
  const text = String(raw || '')
  const digits = text.replace(/\D/g, '')
  if (!digits) return null
  try {
    return BigInt(digits)
  } catch {
    return null
  }
}

function calcIdentFromSerial(serialStr: string | null | undefined) {
  if (!serialStr) return null
  const n = Number.parseInt(String(serialStr), 10)
  if (!Number.isFinite(n)) return null
  const idx = (n - 1) % IDENT_SEQUENCE.length
  return IDENT_SEQUENCE[idx]
}

function dayOfYear(yyyy: number, mm: number, dd: number) {
  if (yyyy < 1900 || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const d = new Date(yyyy, mm - 1, dd)
  if (d.getFullYear() !== yyyy || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null
  const start = new Date(yyyy, 0, 1)
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1
}

function pad3(n: number) {
  return String(n).padStart(3, '0')
}

function normText(v: string) {
  return String(v || '').trim().toUpperCase()
}

function getAllowedClassesForLot(ts: string, lotClass: string, desc: string) {
  const t = normText(ts)
  const c = normText(lotClass)
  const d = normText(desc)

  if ((t === 'PPD' || t === 'CTX') && c === '220' && d.startsWith('PRENOTIFIC')) {
    return { allowed: new Set(['33', '23', '53']), label: 'PPD/CTX 220 PRENOTIFIC → {33,23,53}' }
  }
  if ((t === 'PPD' || t === 'CTX') && c === '220' && d.startsWith('PAGOS')) {
    return { allowed: new Set(['32', '22', '52']), label: 'PPD/CTX 220 PAGOS → {32,22,52}' }
  }
  if (t === 'PPD' && c === '225' && d.startsWith('TRASLADOS')) {
    return { allowed: new Set(['27', '37', '55']), label: 'PPD 225 TRASLADOS → {27,37,55}' }
  }
  return { allowed: null, label: '' }
}

async function validateCompact(rawCompact: string, optionsIn: ValidationOptions) {
  const opts = { ...defaultOptions, ...(optionsIn || {}) }
  const compact = String(rawCompact || '').replace(/^\uFEFF/, '').replace(/\r?\n/g, '')
  const recordsData = parseRecords(compact)
  const totalLines = recordsData.length

  const lineMarks: LineMark[][] = Array.from({ length: totalLines }, () => [])
  const lineStatus: LineStatus[] = new Array(totalLines)
  const lineReason: (string | undefined)[] = new Array(totalLines)
  const globalErrors: string[] = []

  if (compact.length >= RECORD_LEN) {
    const r0 = compact.slice(0, RECORD_LEN)
    const marca = r0.slice(13, 23).trim()
    if (marca === '011111111') {
      post({ type: 'progress', pct: 100 })
      post({ type: 'done', lineStatus, lineReason, globalErrors: [], lineMarks, isDevolucion: true })
      return
    }
  }

  if (compact.length % RECORD_LEN !== 0) {
    globalErrors.push('Número de caracteres del archivo NO es múltiplo de 106.')
  }

  for (let i = 0; i < totalLines; i++) {
    const t = recordsData[i].type
    if (!VALID_TYPES.has(t)) {
      globalErrors.push('Se detectaron registros con tipo inválido (columna 1).')
      break
    }
  }

  const firstNineIndex = recordsData.findIndex((r) => r.type === '9')

  const validationMarksByLine = new Map<number, Map<string, 'ok' | 'error'>>()
  const validationErrorCountByLine = new Map<number, number>()
  const validationNotes = new Map<string, string>()

  function markKey(lineIndex: number, start: number, end: number) {
    return String(lineIndex) + ':' + String(start) + ':' + String(end)
  }
  function rangeKey(start: number, end: number) {
    return String(start) + ':' + String(end)
  }

  function setValidationMark(lineIndex: number, start: number, end: number, status: 'ok' | 'error', note = '') {
    const key = markKey(lineIndex, start, end)
    const prev = validationMarks.get(key)
    validationMarks.set(key, status)
    if (note) validationNotes.set(key, note)

    let lineMap = validationMarksByLine.get(lineIndex)
    if (!lineMap) {
      lineMap = new Map()
      validationMarksByLine.set(lineIndex, lineMap)
    }
    lineMap.set(rangeKey(start, end), status)

    if (prev === 'error') {
      const prevCount = validationErrorCountByLine.get(lineIndex) || 0
      if (prevCount <= 1) validationErrorCountByLine.delete(lineIndex)
      else validationErrorCountByLine.set(lineIndex, prevCount - 1)
    }
    if (status === 'error') {
      const nextCount = (validationErrorCountByLine.get(lineIndex) || 0) + 1
      validationErrorCountByLine.set(lineIndex, nextCount)
    }
  }

  function finalizeToLineMarks() {
    for (let i = 0; i < totalLines; i++) {
      const lineMap = validationMarksByLine.get(i)
      if (!lineMap || lineMap.size === 0) continue
      for (const [key, status] of lineMap.entries()) {
        const [a, b] = String(key).split(':')
        const start1 = Number.parseInt(a, 10)
        const end1 = Number.parseInt(b, 10)
        if (!Number.isFinite(start1) || !Number.isFinite(end1)) continue
        const note = validationNotes.get(markKey(i, start1, end1)) || undefined
        lineMarks[i].push({
          start: Math.max(0, start1 - 1),
          end: Math.max(0, end1),
          type: status,
          note,
        })
      }
      lineMarks[i].sort((x, y) => x.start - y.start)
      lineStatus[i] = (validationErrorCountByLine.get(i) || 0) > 0 ? 'error' : 'ok'
    }
  }

  const validationMarks = new Map<string, 'ok' | 'error'>()
  let validationErrorCount = 0

  const limit = firstNineIndex >= 0 ? (firstNineIndex + 1) : recordsData.length
  let prevSeq5 = null
  let prevSeq6 = null
  let seenAny5 = false
  let seenAny6 = false
  let expectedSeq7By6 = null
  let currentSeq6ForAdendas = null
  let expectedCtx7CodeBy6 = null
  let lotRule = { allowed: null, label: '' }
  let lotIsPpdPrenotific = false
  let lotIsPpdPagos = false
  let lotIsCtxPagos = false
  let lotIsPpdTraslados = false
  let lotExpectedClassPpd = null
  let lotExpected6Code = null
  let lotExpected6Digit = null
  let lotSawFirst6 = false
  let lotCount6 = 0
  let lotCount7 = 0
  let lotSumControl6 = 0n
  let lotSumAmount6 = 0n
  let lotOpen = false
  let lotSeq5Raw = ''
  let lotRef5_84_91 = ''
  let prevPrenotificFirst6Seq = null
  let currentPpdPagos6Index = null
  let currentPpdPagos7Count = 0
  let fileCount5 = 0
  let fileCount6 = 0
  let fileCount7 = 0
  let fileSumCtrl8 = 0n
  let fileSumDeb8 = 0n
  let fileSumCred8 = 0n

  function finalizePpdPagos6PairValidation() {
    if (currentPpdPagos6Index === null) return
    const pairOk = currentPpdPagos7Count === 1
    const pairNote = buildExpectedActualNote('1 reg 7 asociado', String(currentPpdPagos7Count))
    setValidationMark(currentPpdPagos6Index, 13, 29, pairOk ? 'ok' : 'error', pairOk ? '' : pairNote)
    if (!pairOk) validationErrorCount += 1
    currentPpdPagos6Index = null
    currentPpdPagos7Count = 0
  }

  const headerIndex = recordsData.findIndex((r) => r && r.type === '1')
  const expectedId = calcIdentFromSerial(opts.serialFromName || null)

  if (headerIndex >= 0) {
    const blockingFactor = String(recordsData[headerIndex].raw.slice(39, 41) || '').padEnd(2, ' ').slice(0, 2)
    if (blockingFactor === '10') {
      const totalRecords = recordsData.length
      const multipleOf10 = totalRecords % 10 === 0
      setValidationMark(headerIndex, 40, 41, multipleOf10 ? 'ok' : 'error', buildExpectedActualNote('múltiplo de 10', String(totalRecords)))
      if (!multipleOf10) validationErrorCount += 1

      const recLenHeader = parseIntDigits(recordsData[headerIndex].raw.slice(36, 39))
      const blocksFrom9 = firstNineIndex >= 0 ? parseIntDigits(recordsData[firstNineIndex].raw.slice(7, 13)) : null
      const totalChars = recordsData.reduce((acc, rec) => acc + String(rec.raw || '').length, 0)
      let charLenOk = false
      let expectedCharsDisplay = ''
      if (recLenHeader !== null && !Number.isNaN(recLenHeader) && blocksFrom9 !== null && !Number.isNaN(blocksFrom9)) {
        const expectedChars = recLenHeader * 10 * blocksFrom9
        charLenOk = expectedChars === totalChars
        expectedCharsDisplay = String(expectedChars)
      }
      const mulNote = buildExpectedActualNote(expectedCharsDisplay || '1[37-39] * 10 * 9[8-13]', String(totalChars)) + ' · Número de caracteres totales inconsistente'
      setValidationMark(headerIndex, 37, 39, charLenOk ? 'ok' : 'error', mulNote)
      if (!charLenOk) validationErrorCount += 1
    }

    if (limit > 0 && expectedId) {
      const actualId = String(recordsData[headerIndex].raw.slice(35, 36) || '').trim().toUpperCase()
      const idOk = actualId === expectedId
      setValidationMark(headerIndex, 36, 36, idOk ? 'ok' : 'error')
      if (!idOk) validationErrorCount += 1
    }
  }

  for (let i = 0; i < limit; i++) {
    const rec = recordsData[i]
    if (rec.type === '5') {
      finalizePpdPagos6PairValidation()
      fileCount5 += 1
      lotOpen = true
      const rawRef5 = String(rec.raw.slice(83, 91) || '').padEnd(8, ' ').slice(0, 8)
      lotRef5_84_91 = rawRef5
      const ref5Ok = rawRef5 === '00001683'
      setValidationMark(i, 84, 91, ref5Ok ? 'ok' : 'error', buildExpectedActualNote('00001683', rawRef5))
      if (!ref5Ok) validationErrorCount += 1
      const rawSeq = rec.raw.slice(91, 98)
      lotSeq5Raw = String(rawSeq || '').padEnd(7, ' ').slice(0, 7)
      const currentSeq = parseBatchSeq(rawSeq)
      let isOk = true
      if (currentSeq === null || Number.isNaN(currentSeq)) {
        isOk = false
      } else if (!seenAny5) {
        seenAny5 = true
      } else if (prevSeq5 !== null && currentSeq !== (prevSeq5 + 1)) {
        isOk = false
      }

      setValidationMark(i, 92, 98, isOk ? 'ok' : 'error')
      if (!isOk) validationErrorCount += 1
      if (currentSeq !== null && !Number.isNaN(currentSeq)) prevSeq5 = currentSeq

      const fechaStr = rec.raw.slice(71, 79)
      const julianStr = rec.raw.slice(79, 82)
      const yyyy = Number.parseInt(fechaStr.slice(0, 4), 10)
      const mm = Number.parseInt(fechaStr.slice(4, 6), 10)
      const dd = Number.parseInt(fechaStr.slice(6, 8), 10)
      const doy = dayOfYear(yyyy, mm, dd)
      if (doy === null) {
        setValidationMark(i, 72, 79, 'error')
        validationErrorCount += 1
        setValidationMark(i, 80, 82, 'error')
        validationErrorCount += 1
      } else {
        setValidationMark(i, 72, 79, 'ok')
        const expectedJulian = pad3(doy)
        if (julianStr === expectedJulian) {
          setValidationMark(i, 80, 82, 'ok')
        } else {
          setValidationMark(i, 80, 82, 'error')
          validationErrorCount += 1
        }
      }

      const ts = rec.raw.slice(50, 53)
      const lotClass = rec.raw.slice(1, 4)
      const lotClassDisplay = String(lotClass || '').padEnd(3, ' ').slice(0, 3)
      const desc = rec.raw.slice(53, 63)
      lotRule = getAllowedClassesForLot(ts, lotClass, desc)
      lotIsPpdPrenotific = normText(ts) === 'PPD' && normText(desc).startsWith('PRENOTIFIC')
      lotIsPpdPagos = normText(ts) === 'PPD' && normText(desc).startsWith('PAGOS')
      lotIsCtxPagos = normText(ts) === 'CTX' && normText(desc).startsWith('PAGOS')
      lotIsPpdTraslados = normText(ts) === 'PPD' && normText(desc).startsWith('TRASLADOS')
      if (lotIsPpdTraslados) {
        const expected5_41_50 = '8999990902'
        const actual5_41_50 = String(rec.raw.slice(40, 50) || '').padEnd(10, ' ').slice(0, 10)
        const ok5_41_50 = actual5_41_50 === expected5_41_50
        setValidationMark(i, 41, 50, ok5_41_50 ? 'ok' : 'error', buildExpectedActualNote(expected5_41_50, actual5_41_50))
        if (!ok5_41_50) validationErrorCount += 1
      }
      lotExpectedClassPpd = null
      if (normText(ts) === 'PPD' || lotIsCtxPagos) {
        lotExpectedClassPpd = (normText(ts) === 'PPD' && lotIsPpdTraslados) ? '225' : '220'
        const classOk5 = lotClassDisplay === lotExpectedClassPpd
        setValidationMark(i, 2, 4, classOk5 ? 'ok' : 'error', buildExpectedActualNote(lotExpectedClassPpd, lotClassDisplay))
        if (!classOk5) validationErrorCount += 1
      }
      lotExpected6Code = null
      lotExpected6Digit = null
      lotSawFirst6 = false
      lotCount6 = 0
      lotCount7 = 0
      lotSumControl6 = 0n
      lotSumAmount6 = 0n
    }

    if (rec.type === '6') {
      finalizePpdPagos6PairValidation()
      fileCount6 += 1
      if (!lotOpen) continue
      lotCount6 += 1
      const rawSeq6 = rec.raw.slice(95, 102)
      const currentSeq6 = parseBatchSeq(rawSeq6)
      let isOk6 = true
      if (currentSeq6 === null || Number.isNaN(currentSeq6)) {
        isOk6 = false
      } else if (!seenAny6) {
        seenAny6 = true
      } else if (prevSeq6 !== null && currentSeq6 !== (prevSeq6 + 1)) {
        isOk6 = false
      }

      setValidationMark(i, 96, 102, isOk6 ? 'ok' : 'error')
      if (!isOk6) validationErrorCount += 1
      if (currentSeq6 !== null && !Number.isNaN(currentSeq6)) prevSeq6 = currentSeq6
      currentSeq6ForAdendas = currentSeq6

      if (lotRule.allowed) {
        const cls = rec.raw.slice(1, 3)
        const isAllowed = lotRule.allowed.has(cls)
        setValidationMark(i, 2, 3, isAllowed ? 'ok' : 'error')
        if (!isAllowed) validationErrorCount += 1
      }

      const rawControl6 = rec.raw.slice(3, 11)
      const controlCode6 = parseBigIntTrimmed(rawControl6)
      if (controlCode6 === null) {
        setValidationMark(i, 4, 11, 'error', buildExpectedActualNote('8 dígitos numéricos', String(rawControl6 || '').padEnd(8, ' ').slice(0, 8)))
        validationErrorCount += 1
      } else {
        lotSumControl6 += controlCode6
      }

      const rawAmount6 = rec.raw.slice(29, 47)
      const amount6 = parseBigIntTrimmed(rawAmount6)
      if (amount6 !== null) {
        lotSumAmount6 += amount6
      }

      if (lotIsPpdPrenotific || lotIsPpdPagos || lotIsCtxPagos || lotIsPpdTraslados) {
        const raw30to47 = rec.raw.slice(29, 47)
        const actual30to47 = String(raw30to47 || '').padEnd(18, ' ').slice(0, 18)
        const zeros30to47 = actual30to47 === '000000000000000000'
        const zerosNote = buildExpectedActualNote('000000000000000000', actual30to47)
        if (lotIsPpdPrenotific) {
          setValidationMark(i, 30, 47, zeros30to47 ? 'ok' : 'error', zerosNote)
          if (!zeros30to47) validationErrorCount += 1
        }

        if ((lotIsPpdPrenotific || lotIsPpdTraslados) && !lotSawFirst6) {
          if (lotIsPpdPrenotific) {
            const seqRaw13to29 = rec.raw.slice(12, 29)
            const seqTrimmed = parseBigIntTrimmed(seqRaw13to29)
            let seqOk = true
            if (seqTrimmed === null) {
              seqOk = false
            } else if (prevPrenotificFirst6Seq !== null && seqTrimmed !== (prevPrenotificFirst6Seq + 1n)) {
              seqOk = false
            }
            const expectedSeq = prevPrenotificFirst6Seq === null ? null : (prevPrenotificFirst6Seq + 1n)
            const seqDisplay = seqTrimmed === null ? '(vacío/no numérico)' : seqTrimmed.toString()
            const expectedDisplay = expectedSeq === null ? 'consecutivo inicial numérico' : expectedSeq.toString()
            const note = buildExpectedActualNote(expectedDisplay, seqDisplay)
            setValidationMark(i, 13, 29, seqOk ? 'ok' : 'error', note)
            if (!seqOk) validationErrorCount += 1
            if (seqTrimmed !== null) prevPrenotificFirst6Seq = seqTrimmed
          }

          const raw48to62 = rec.raw.slice(47, 62)
          const actual48to62 = String(raw48to62 || '').padEnd(15, ' ').slice(0, 15)
          const zero48to62 = actual48to62.trim() === '0'
          const zeroNote = buildExpectedActualNote('0              ', actual48to62)
          setValidationMark(i, 48, 62, zero48to62 ? 'ok' : 'error', zeroNote)
          if (!zero48to62) validationErrorCount += 1

          lotSawFirst6 = true
        }

        const code4to11 = rec.raw.slice(3, 11)
        const digit12 = rec.raw.slice(11, 12)
        if (lotExpected6Code === null) lotExpected6Code = code4to11
        if (lotExpected6Digit === null) lotExpected6Digit = digit12

        const codeOk = code4to11 === lotExpected6Code
        setValidationMark(i, 4, 11, codeOk ? 'ok' : 'error')
        if (!codeOk) validationErrorCount += 1

        if (lotIsPpdPrenotific) {
          const digitOk = digit12 === lotExpected6Digit
          setValidationMark(i, 12, 12, digitOk ? 'ok' : 'error')
          if (!digitOk) validationErrorCount += 1
        }
      }

      expectedSeq7By6 = 1
      expectedCtx7CodeBy6 = null
      if (lotIsPpdPagos) {
        currentPpdPagos6Index = i
        currentPpdPagos7Count = 0
      } else {
        currentPpdPagos6Index = null
        currentPpdPagos7Count = 0
      }
    }

    if (rec.type === '7') {
      fileCount7 += 1
      if (lotOpen) lotCount7 += 1
      if (lotIsPpdPagos && currentPpdPagos6Index !== null) currentPpdPagos7Count += 1

      const rawType7Code = rec.raw.slice(1, 3)
      const actualType7Code = String(rawType7Code || '').padEnd(2, ' ').slice(0, 2)
      const type7CodeOk = actualType7Code === '05'
      setValidationMark(i, 2, 3, type7CodeOk ? 'ok' : 'error', buildExpectedActualNote('05', actualType7Code))
      if (!type7CodeOk) validationErrorCount += 1

      const rawSeq7By6 = rec.raw.slice(83, 87)
      const currentSeq7By6 = parseBatchSeq(rawSeq7By6)
      let isOk7By6 = true
      if (expectedSeq7By6 === null) {
        isOk7By6 = false
      } else if (currentSeq7By6 === null || Number.isNaN(currentSeq7By6)) {
        isOk7By6 = false
      } else if (currentSeq7By6 !== expectedSeq7By6) {
        isOk7By6 = false
      }
      setValidationMark(i, 84, 87, isOk7By6 ? 'ok' : 'error')
      if (!isOk7By6) validationErrorCount += 1
      if (currentSeq7By6 !== null && !Number.isNaN(currentSeq7By6)) {
        expectedSeq7By6 = currentSeq7By6 + 1
      } else if (expectedSeq7By6 !== null) {
        expectedSeq7By6 += 1
      }

      const rawSeq7 = rec.raw.slice(87, 94)
      const currentSeq7 = parseBatchSeq(rawSeq7)
      let isOk7 = true
      if (currentSeq6ForAdendas === null || Number.isNaN(currentSeq6ForAdendas)) {
        isOk7 = false
      } else if (currentSeq7 === null || Number.isNaN(currentSeq7)) {
        isOk7 = false
      } else if (currentSeq7 !== currentSeq6ForAdendas) {
        isOk7 = false
      }

      setValidationMark(i, 88, 94, isOk7 ? 'ok' : 'error')
      if (!isOk7) validationErrorCount += 1

      if (lotIsCtxPagos) {
        const code4to16 = String(rec.raw.slice(3, 16) || '').padEnd(13, ' ').slice(0, 13)
        if (expectedCtx7CodeBy6 === null) expectedCtx7CodeBy6 = code4to16
        const codeOk = code4to16 === expectedCtx7CodeBy6
        setValidationMark(i, 4, 16, codeOk ? 'ok' : 'error', buildExpectedActualNote(expectedCtx7CodeBy6, code4to16))
        if (!codeOk) validationErrorCount += 1
      }
      if (lotIsPpdTraslados) {
        const expected7_4_16 = '8999990902'.padStart(13, '0')
        const actual7_4_16 = String(rec.raw.slice(3, 16) || '').padEnd(13, ' ').slice(0, 13)
        const ok7_4_16 = actual7_4_16 === expected7_4_16
        setValidationMark(i, 4, 16, ok7_4_16 ? 'ok' : 'error', buildExpectedActualNote(expected7_4_16, actual7_4_16))
        if (!ok7_4_16) validationErrorCount += 1

        const expected7_17_46 = '8999990902'.padEnd(30, ' ')
        const actual7_17_46 = String(rec.raw.slice(16, 46) || '').padEnd(30, ' ').slice(0, 30)
        const ok7_17_46 = actual7_17_46 === expected7_17_46
        setValidationMark(i, 17, 46, ok7_17_46 ? 'ok' : 'error', buildExpectedActualNote(expected7_17_46, actual7_17_46))
        if (!ok7_17_46) validationErrorCount += 1
      }
    } else if (rec.type !== '6') {
      if (rec.type !== '7') finalizePpdPagos6PairValidation()
      expectedSeq7By6 = null
      expectedCtx7CodeBy6 = null
      if (rec.type !== '7') currentSeq6ForAdendas = null
    }

    if (rec.type === '8') {
      const fileCtrl8 = parseBigIntTrimmed(rec.raw.slice(10, 20))
      const fileDeb8 = parseBigIntTrimmed(rec.raw.slice(20, 38))
      const fileCred8 = parseBigIntTrimmed(rec.raw.slice(38, 56))
      if (fileCtrl8 !== null) fileSumCtrl8 += fileCtrl8
      if (fileDeb8 !== null) fileSumDeb8 += fileDeb8
      if (fileCred8 !== null) fileSumCred8 += fileCred8

      if (!lotOpen) continue
      const rawCount8 = rec.raw.slice(4, 10)
      const actualCount8 = String(rawCount8 || '').padEnd(6, ' ').slice(0, 6)
      const expectedTxnCount = (lotIsPpdPagos || lotIsCtxPagos || lotIsPpdTraslados) ? (lotCount6 + lotCount7) : lotCount6
      const expectedCount8 = String(expectedTxnCount).padStart(6, '0')
      const countOk8 = actualCount8 === expectedCount8
      setValidationMark(i, 5, 10, countOk8 ? 'ok' : 'error', buildExpectedActualNote(expectedCount8, actualCount8))
      if (!countOk8) validationErrorCount += 1

      const rawCtrl8 = rec.raw.slice(10, 20)
      const actualCtrl8 = String(rawCtrl8 || '').padEnd(10, ' ').slice(0, 10)
      const parsedCtrl8 = parseBigIntTrimmed(rawCtrl8)
      const expectedCtrl8 = String(lotSumControl6).padStart(10, '0')
      const actualCtrl8Display = parsedCtrl8 === null ? actualCtrl8 : String(parsedCtrl8).padStart(10, '0')
      const ctrlOk8 = parsedCtrl8 !== null && parsedCtrl8 === lotSumControl6
      const ctrlNote = buildExpectedActualNote(expectedCtrl8, actualCtrl8Display) +
        ' · Suma lote 6[4-11]: ' + lotSumControl6.toString() +
        ' · Registros 6: ' + String(lotCount6)
      setValidationMark(i, 11, 20, ctrlOk8 ? 'ok' : 'error', ctrlNote)
      if (!ctrlOk8) validationErrorCount += 1

      const rawLot8 = rec.raw.slice(99, 106)
      const actualLot8 = String(rawLot8 || '').padEnd(7, ' ').slice(0, 7)
      const lotRefOk8 = actualLot8 === lotSeq5Raw
      setValidationMark(i, 100, 106, lotRefOk8 ? 'ok' : 'error', buildExpectedActualNote(lotSeq5Raw, actualLot8))
      if (!lotRefOk8) validationErrorCount += 1

      const rawRef8 = String(rec.raw.slice(91, 99) || '').padEnd(8, ' ').slice(0, 8)
      const ref8Matches5 = rawRef8 === lotRef5_84_91
      const ref8IsConst = rawRef8 === '00001683'
      const ref8Ok = ref8Matches5 && ref8IsConst
      setValidationMark(i, 92, 99, ref8Ok ? 'ok' : 'error', buildExpectedActualNote('00001683', rawRef8))
      if (!ref8Ok) validationErrorCount += 1

      if (lotIsPpdTraslados) {
        const expected8_57_66 = '8999990902'
        const actual8_57_66 = String(rec.raw.slice(56, 66) || '').padEnd(10, ' ').slice(0, 10)
        const ok8_57_66 = actual8_57_66 === expected8_57_66
        setValidationMark(i, 57, 66, ok8_57_66 ? 'ok' : 'error', buildExpectedActualNote(expected8_57_66, actual8_57_66))
        if (!ok8_57_66) validationErrorCount += 1
      }

      if (lotExpectedClassPpd) {
        const class8 = String(rec.raw.slice(1, 4) || '').padEnd(3, ' ').slice(0, 3)
        const classOk8 = class8 === lotExpectedClassPpd
        setValidationMark(i, 2, 4, classOk8 ? 'ok' : 'error', buildExpectedActualNote(lotExpectedClassPpd, class8))
        if (!classOk8) validationErrorCount += 1
      }

      lotOpen = false
    }

    if (rec.type === '8' && (lotIsPpdPrenotific || lotIsPpdPagos || lotIsPpdTraslados)) {
      const rawDeb8 = rec.raw.slice(20, 38)
      const rawCred8 = rec.raw.slice(38, 56)
      const actualDeb8 = String(rawDeb8 || '').padEnd(18, ' ').slice(0, 18)
      const actualCred8 = String(rawCred8 || '').padEnd(18, ' ').slice(0, 18)
      const expectedZero18 = '000000000000000000'

      if (lotIsPpdTraslados) {
        const expectedDeb8 = String(lotSumAmount6).padStart(18, '0')
        const actualDeb8Parsed = parseBigIntTrimmed(rawDeb8)
        const actualDeb8Display = actualDeb8Parsed === null ? actualDeb8 : String(actualDeb8Parsed).padStart(18, '0')
        const debOk8 = actualDeb8Parsed !== null && actualDeb8Parsed === lotSumAmount6
        setValidationMark(i, 21, 38, debOk8 ? 'ok' : 'error', buildExpectedActualNote(expectedDeb8, actualDeb8Display))
        if (!debOk8) validationErrorCount += 1
      } else {
        const debOk8 = actualDeb8 === expectedZero18
        setValidationMark(i, 21, 38, debOk8 ? 'ok' : 'error', buildExpectedActualNote(expectedZero18, actualDeb8))
        if (!debOk8) validationErrorCount += 1
      }

      if (lotIsPpdPrenotific) {
        const credOk8 = actualCred8 === expectedZero18
        setValidationMark(i, 39, 56, credOk8 ? 'ok' : 'error', buildExpectedActualNote(expectedZero18, actualCred8))
        if (!credOk8) validationErrorCount += 1
      } else if (lotIsPpdTraslados) {
        const credOk8 = actualCred8 === expectedZero18
        setValidationMark(i, 39, 56, credOk8 ? 'ok' : 'error', buildExpectedActualNote(expectedZero18, actualCred8))
        if (!credOk8) validationErrorCount += 1
      } else if (lotIsPpdPagos) {
        const expectedCred8 = String(lotSumAmount6).padStart(18, '0')
        const actualCred8Parsed = parseBigIntTrimmed(rawCred8)
        const actualCred8Display = actualCred8Parsed === null ? actualCred8 : String(actualCred8Parsed).padStart(18, '0')
        const credOk8 = actualCred8Parsed !== null && actualCred8Parsed === lotSumAmount6
        setValidationMark(i, 39, 56, credOk8 ? 'ok' : 'error', buildExpectedActualNote(expectedCred8, actualCred8Display))
        if (!credOk8) validationErrorCount += 1
      }
    }

    if (i % 400 === 0 || i === limit - 1) {
      const pct = Math.floor(((i + 1) / Math.max(1, limit)) * 100)
      post({ type: 'progress', pct })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  finalizePpdPagos6PairValidation()

  if (firstNineIndex >= 0) {
    const r9 = recordsData[firstNineIndex] ? recordsData[firstNineIndex].raw : ''
    const decLots = parseIntDigits(r9.slice(1, 7))
    const decBlocks = parseIntDigits(r9.slice(7, 13))
    const decTranAd = parseIntDigits(r9.slice(13, 21))
    const decCtrl = parseBigIntTrimmed(r9.slice(21, 31))
    const decDeb = parseBigIntTrimmed(r9.slice(31, 49))
    const decCred = parseBigIntTrimmed(r9.slice(49, 67))

    const expLots = fileCount5
    const expBlocks = Math.ceil(recordsData.length / 10)
    const expTranAd = fileCount6 + fileCount7

    const lotsOk = decLots !== null && decLots === expLots
    const blocksOk = decBlocks !== null && decBlocks === expBlocks
    const tranOk = decTranAd !== null && decTranAd === expTranAd
    const ctrlOk = decCtrl !== null && decCtrl === fileSumCtrl8
    const debOk = decDeb !== null && decDeb === fileSumDeb8
    const credOk = decCred !== null && decCred === fileSumCred8

    const decLotsDisplay = decLots === null ? String(r9.slice(1, 7) || '').padEnd(6, ' ').slice(0, 6) : String(decLots).padStart(6, '0')
    const decBlocksDisplay = decBlocks === null ? String(r9.slice(7, 13) || '').padEnd(6, ' ').slice(0, 6) : String(decBlocks).padStart(6, '0')
    const decTranDisplay = decTranAd === null ? String(r9.slice(13, 21) || '').padEnd(8, ' ').slice(0, 8) : String(decTranAd).padStart(8, '0')
    const decCtrlDisplay = decCtrl === null ? String(r9.slice(21, 31) || '').padEnd(10, ' ').slice(0, 10) : String(decCtrl).padStart(10, '0')
    const decDebDisplay = decDeb === null ? String(r9.slice(31, 49) || '').padEnd(18, ' ').slice(0, 18) : String(decDeb).padStart(18, '0')
    const decCredDisplay = decCred === null ? String(r9.slice(49, 67) || '').padEnd(18, ' ').slice(0, 18) : String(decCred).padStart(18, '0')

    setValidationMark(firstNineIndex, 2, 7, lotsOk ? 'ok' : 'error', buildExpectedActualNote(String(expLots).padStart(6, '0'), decLotsDisplay))
    setValidationMark(firstNineIndex, 8, 13, blocksOk ? 'ok' : 'error', buildExpectedActualNote(String(expBlocks).padStart(6, '0'), decBlocksDisplay))
    setValidationMark(firstNineIndex, 14, 21, tranOk ? 'ok' : 'error', buildExpectedActualNote(String(expTranAd).padStart(8, '0'), decTranDisplay))
    setValidationMark(firstNineIndex, 22, 31, ctrlOk ? 'ok' : 'error', buildExpectedActualNote(String(fileSumCtrl8).padStart(10, '0'), decCtrlDisplay))
    setValidationMark(firstNineIndex, 32, 49, debOk ? 'ok' : 'error', buildExpectedActualNote(String(fileSumDeb8).padStart(18, '0'), decDebDisplay))
    setValidationMark(firstNineIndex, 50, 67, credOk ? 'ok' : 'error', buildExpectedActualNote(String(fileSumCred8).padStart(18, '0'), decCredDisplay))

    if (!lotsOk) validationErrorCount += 1
    if (!blocksOk) validationErrorCount += 1
    if (!tranOk) validationErrorCount += 1
    if (!ctrlOk) validationErrorCount += 1
    if (!debOk) validationErrorCount += 1
    if (!credOk) validationErrorCount += 1
  } else {
    validationErrorCount += 1
    globalErrors.push('No se encontró el primer registro 9 (trailer).')
  }

  if (globalErrors.length > 0) {
    for (let i = 0; i < totalLines; i++) {
      if (!lineStatus[i]) lineStatus[i] = undefined
    }
  }

  finalizeToLineMarks()
  post({ type: 'progress', pct: 100 })
  post({ type: 'done', lineStatus, lineReason, globalErrors, lineMarks })
}

self.onmessage = (e: MessageEvent<WorkerInMsg>) => {
  const msg = e.data
  if (msg.type === 'validate-file') {
    const text = new TextDecoder('utf-8').decode(msg.buffer)
    validateCompact(text, msg.options ?? {})
  } else if (msg.type === 'validate-text') {
    validateCompact(msg.text, msg.options ?? {})
  }
}
