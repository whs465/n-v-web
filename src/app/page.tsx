'use client'

import { useState, useCallback } from 'react'
import NachamVisor from '@/components/NachamVisor'
import NachamModal, { Field } from '@/components/NachamModal'
import * as XLSX from 'xlsx'

const svgExportIcono = `
  <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="#217346" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`

export default function Page() {
  // Estado para el nombre de archivo
  const [fileName, setFileName] = useState<string>('')
  // Estado para los registros
  const [records, setRecords] = useState<string[]>([])
  const [position320321, setPos320321] = useState<string>('')
  const [isOpen, setIsOpen] = useState(false)
  const [currentIndex, setCurrent] = useState(0)
  const [fields, setFields] = useState<Field[]>([])
  const [title, setTitle] = useState<string>('')
  const [showToast, setShowToast] = useState(false)
  const [toastFileName, setToastFileName] = useState('')
  const [errorToast, setErrorToast] = useState<string | null>(null)
  const [isNachamValid, setIsNachamValid] = useState<boolean | null>(null)
  const [isLenMultiple106, setIsLenMultiple106] = useState<boolean>(true)
  // primer índice donde detectamos un problema “de ahí en adelante”
  const [badFromIndex, setBadFromIndex] = useState<number | null>(null)
  // filas puntuales con error de tipo (primer carácter inválido)
  const [badRowSet, setBadRowSet] = useState<Set<number>>(new Set())

  const showError = (msg: string) => {
    setErrorToast(msg)
    setTimeout(() => setErrorToast(null), 6000)
  }

  // Encuentra el registro padre de tipo dado
  const findParentRecord = (idx: number, type: string): number | null => {
    for (let i = idx - 1; i >= 0; i--) {
      if (records[i][0] === type) return i
    }
    return null
  }

  // Parsea un registro según su tipo y devuelve array de campos
  const parseFields = (rec: string, idx: number): Field[] => {
    const type = rec.charAt(0)
    let flds: Field[] = []

    if (type === '1') {
      flds = [
        { id: 1, name: "Tipo de Registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Código de Prioridad", length: 2, position: "2-3", value: rec.slice(1, 3) },
        { id: 3, name: "Código Participante Destino Inmediato", length: 10, position: "4-13", value: rec.slice(3, 13) },
        { id: 4, name: "Código Participante Origen Inmediato", length: 10, position: "14-23", value: rec.slice(13, 23) },
        { id: 5, name: "Fecha de Creación del Archivo", length: 8, position: "24-31", value: rec.slice(23, 31) },
        { id: 6, name: "Hora de Creación del Archivo", length: 4, position: "32-35", value: rec.slice(31, 35) },
        { id: 7, name: "Identificador del Archivo", length: 1, position: "36-36", value: rec.slice(35, 36) },
        { id: 8, name: "Tamaño del Registro", length: 3, position: "37-39", value: rec.slice(36, 39) },
        { id: 9, name: "Factor de Ablocamiento", length: 2, position: "40-41", value: rec.slice(39, 41) },
        { id: 10, name: "Código de Formato", length: 1, position: "42-42", value: rec.slice(41, 42) },
        { id: 11, name: "Nombre Entidad Destino", length: 23, position: "43-65", value: rec.slice(42, 65) },
        { id: 12, name: "Nombre Entidad Origen", length: 23, position: "66-88", value: rec.slice(65, 88) },
        { id: 13, name: "Código de Referencia", length: 8, position: "89-96", value: rec.slice(88, 96) },
        { id: 14, name: "Reservado", length: 10, position: "97-106", value: rec.slice(96, 106) },
      ]
    } else if (type === '5') {
      const ts = rec.slice(50, 53).trim()
      const desc = rec.slice(53, 63).trim()
      // Título se construye en handleRowClick
      flds = [
        { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Código clase de transacción por lote", length: 3, position: "2-4", value: rec.slice(1, 4) },
        { id: 3, name: "Nombre del originador", length: 16, position: "5-20", value: rec.slice(4, 20) },
        { id: 4, name: "Datos Discrecionales del originador", length: 20, position: "21-40", value: rec.slice(20, 40) },
        { id: 5, name: "Identificador del originador", length: 10, position: "41-50", value: rec.slice(40, 50) },
        { id: 6, name: "Tipo de Servicio", length: 3, position: "51-53", value: rec.slice(50, 53) },
        { id: 7, name: "Descripción del Lote", length: 10, position: "54-63", value: rec.slice(53, 63) },
        { id: 8, name: "Fecha Descriptiva", length: 8, position: "64-71", value: rec.slice(63, 71) },
        { id: 9, name: "Fecha Efectiva de la Transacción", length: 8, position: "72-79", value: rec.slice(71, 79) },
        { id: 10, name: "Fecha de Compensación Juliana", length: 3, position: "80-82", value: rec.slice(79, 82) },
        { id: 11, name: "Código estado del Originador", length: 1, position: "83-83", value: rec.slice(82, 83) },
        { id: 12, name: "Código Participante Originador", length: 8, position: "84-91", value: rec.slice(83, 91) },
        { id: 13, name: "Número de Lote", length: 7, position: "92-98", value: rec.slice(91, 98) },
        { id: 14, name: "Reservado", length: 8, position: "99-106", value: rec.slice(98, 106) },
      ]
    } else if (type === '6') {
      // usa findParentRecord para extraer ts y desc, igual que handleRowClick
      flds = [
        { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Código clase de transacción por lote", length: 2, position: "2-3", value: rec.slice(1, 3) },
        { id: 3, name: "Código participante receptor", length: 8, position: "4-11", value: rec.slice(3, 11) },
        { id: 4, name: "Dígito de chequeo", length: 1, position: "12-12", value: rec.slice(11, 12) },
        { id: 5, name: "Número de Cuenta del Receptor", length: 17, position: "13-29", value: rec.slice(12, 29) },
        { id: 6, name: "Valor de la Transacción", length: 18, position: "30-47", value: rec.slice(29, 47) },
        { id: 7, name: "Número de Identificación del Receptor", length: 15, position: "48-62", value: rec.slice(47, 62) },
        { id: 8, name: "Nombre del Receptor", length: 22, position: "63-84", value: rec.slice(62, 84) },
        { id: 9, name: "Datos Discrecionales", length: 2, position: "85-86", value: rec.slice(84, 86) },
        { id: 10, name: "Indicador de Registro de Adenda", length: 1, position: "87-87", value: rec.slice(86, 87) },
        { id: 11, name: "Número de Secuencia", length: 15, position: "88-102", value: rec.slice(87, 102) },
        { id: 12, name: "Reservado", length: 4, position: "103-106", value: rec.slice(102, 106) },
      ]
    } else if (type === '7') {
      // Recupera el título desde el padre tipo 5 (igual que en la modal)
      const pi = findParentRecord(idx, '5')
      if (pi !== null) {
        const pr = records[pi]
        const ts = pr.slice(50, 53).trim()
        const desc = pr.slice(53, 63).trim()
        // Si necesitas devolver ttl aquí, hazlo; parseFields solo devuelve campos
        // ttl = `✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} …`
      }

      // Determina variante según los bytes 2–3 (posiciones 32–33 del registro)
      const position320321 = rec.slice(1, 3)
      if (position320321 === '99') {
        flds = [
          { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
          { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
          { id: 3, name: "Causal de Devolución", length: 3, position: "4-6", value: rec.slice(3, 6) },
          { id: 4, name: "Número de Secuencia de la Transacción Original", length: 15, position: "7-21", value: rec.slice(6, 21) },
          { id: 5, name: "Fecha de Muerte", length: 8, position: "22-29", value: rec.slice(21, 29) },
          { id: 6, name: "Código del Participante Receptor de la Transacción Original", length: 8, position: "30-37", value: rec.slice(29, 37) },
          { id: 7, name: "Información Adicional", length: 44, position: "38-81", value: rec.slice(37, 81) },
          { id: 8, name: "Número de Secuencia del Registro Adenda", length: 15, position: "82-96", value: rec.slice(81, 96) },
          { id: 9, name: "Reservado", length: 10, position: "97-106", value: rec.slice(96, 106) },
        ]
      } else {
        flds = [
          { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
          { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
          { id: 3, name: "Identificación del Originador", length: 15, position: "4-18", value: rec.slice(3, 18) },
          { id: 4, name: "Reservado", length: 1, position: "19-19", value: rec.slice(18, 19) },
          { id: 5, name: "Propósito de la Transacción", length: 10, position: "21-30", value: rec.slice(20, 30) },
          { id: 6, name: "Número de Factura/Cuenta", length: 24, position: "31-54", value: rec.slice(30, 54) },
          { id: 7, name: "Reservado", length: 2, position: "55-56", value: rec.slice(54, 56) },
          { id: 8, name: "Información Libre Originador", length: 24, position: "57-80", value: rec.slice(56, 80) },
          { id: 9, name: "Reservado", length: 2, position: "81-83", value: rec.slice(80, 83) },
          { id: 10, name: "Número de secuencia de Registro Adenda", length: 4, position: "84-87", value: rec.slice(83, 87) },
          { id: 11, name: "Número de secuencia de Transacción del Registro de Detalle", length: 7, position: "88-94", value: rec.slice(87, 94) },
          { id: 12, name: "Reservado", length: 12, position: "95-106", value: rec.slice(94, 106) },
        ]
      }
    } else if (type === '8') {
      // totales, copia de handleRowClick
    } else if (type === '9') {
      flds = [
        { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Cantidad de Lotes", length: 6, position: "2-7", value: rec.slice(1, 7) },
        { id: 3, name: "Número de Bloques", length: 6, position: "8-13", value: rec.slice(7, 13) },
        { id: 4, name: "Número de Trans./Adenda", length: 8, position: "14-21", value: rec.slice(13, 21) },
        { id: 5, name: "Totales de Control", length: 10, position: "22-31", value: rec.slice(21, 31) },
        { id: 6, name: "Valor Total de Débitos", length: 18, position: "32-49", value: rec.slice(31, 49) },
        { id: 7, name: "Valor Total de Créditos", length: 18, position: "50-67", value: rec.slice(49, 67) },
        { id: 8, name: "Reservado", length: 39, position: "68-106", value: rec.slice(67, 106) },
      ]
    }
    return flds
  }
  // Carga el archivo y guarda los records + posición 320-321
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    if (!input.files?.length) return

    const file = input.files[0]

    try {
      let text = await file.text()
      text = text.replace(/^\uFEFF/, '') // quita BOM
      const compact = text.replace(/\r?\n/g, '')
      const recs = compact.match(/.{106}/g) || []

      // ——— checks ———
      const validStart = new Set(['1', '5', '6', '7', '8', '9'])
      const badRows: number[] = []

      recs.forEach((r, i) => {
        if (!validStart.has(r[0])) badRows.push(i)
      })

      // ¿La longitud total es múltiplo de 106?
      const multiple106 = (compact.length % 106) === 0

      // ¿Desde qué fila “pintamos” el fondo como guía?
      // 1) si NO es múltiplo de 106: el primer índice incompleto sería Math.floor(compact.length/106)
      // 2) si sí es múltiplo pero hay filas con primer char inválido: desde el primer badRows[0]
      let fromIdx: number | null = null
      if (!multiple106) {
        fromIdx = Math.floor(compact.length / 106) // donde "empieza" el bloque incompleto
      } else if (badRows.length > 0) {
        fromIdx = badRows[0]
      }

      // set de filas problemáticas por primer carácter inválido
      setBadRowSet(new Set(badRows))
      setIsLenMultiple106(multiple106)
      setBadFromIndex(fromIdx)

      // ¿Hay suficiente data para validar?
      let valid = false
      if (recs.length >= 2) {
        const firma = recs[1].slice(40, 50) // pos. 41–50 (0-based 40..49)
        valid = (firma === '8999990902')
      }

      // Siempre mostramos el archivo:
      setFileName(file.name)
      input.value = '' // permitir re-seleccionar mismo archivo
      setPos320321(compact.slice(319, 321))
      setRecords(recs)
      setIsNachamValid(valid)

      if (!valid) {
        // Aviso, pero NO bloqueamos la vista
        showError('El archivo no es un NACHAM válido (vista solamente).')
      }
      if (!multiple106) {
        showError('El número de caracteres del archivo no es múltiplo de 106. Revise desde la fila resaltada.')
      } else if (badRows.length) {
        showError('Se detectaron registros con tipo inválido. Revise filas resaltadas.')
      }

    } catch (err) {
      console.error(err)
      showError('No se pudo leer el archivo')
      input.value = ''
      setIsNachamValid(null)
    }
  }

  // Abre la modal con title + fields según el tipo de record
  const handleRowClick = useCallback((idx: number) => {
    const rec = records[idx]
    const type = rec.charAt(0)
    let flds: Field[] = []
    let ttl = ''

    if (type === '1') {
      ttl = `🌟 Registro de Encabezado de Archivo`
      flds = [
        { id: 1, name: "Tipo de Registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Código de Prioridad", length: 2, position: "2-3", value: rec.slice(1, 3) },
        { id: 3, name: "Código Participante Destino Inmediato", length: 10, position: "4-13", value: rec.slice(3, 13) },
        { id: 4, name: "Código Participante Origen Inmediato", length: 10, position: "14-23", value: rec.slice(15, 23) },
        { id: 5, name: "Fecha de Creación del Archivo", length: 8, position: "24-31", value: rec.slice(23, 31) },
        { id: 6, name: "Hora de Creación del Archivo", length: 4, position: "32-35", value: rec.slice(31, 35) },
        { id: 7, name: "Identificador del Archivo", length: 1, position: "36-36", value: rec.slice(35, 36) },
        { id: 8, name: "Tamaño del Registro", length: 3, position: "37-39", value: rec.slice(36, 39) },
        { id: 9, name: "Factor de Ablocamiento", length: 2, position: "40-41", value: rec.slice(39, 41) },
        { id: 10, name: "Código de Formato", length: 1, position: "42-42", value: rec.slice(41, 42) },
        { id: 11, name: "Nombre Entidad Destino", length: 23, position: "43-65", value: rec.slice(42, 65) },
        { id: 12, name: "Nombre Entidad Origen", length: 23, position: "66-88", value: rec.slice(65, 88) },
        { id: 13, name: "Código de Referencia", length: 8, position: "89-96", value: rec.slice(88, 96) },
        { id: 14, name: "Reservado", length: 10, position: "97-106", value: rec.slice(96, 106) },
      ]
    }
    else if (type === '5') {
      const ts = rec.slice(50, 53).trim()
      const desc = rec.slice(53, 63).trim()
      ttl = `🌟 Registro de Encabezado de Lote</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
      flds = [
        { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Código clase de transacción por lote", length: 3, position: "2-4", value: rec.slice(1, 4) },
        { id: 3, name: "Nombre del originador", length: 16, position: "5-20", value: rec.slice(4, 20) },
        { id: 4, name: "Datos Discrecionales del originador", length: 20, position: "21-40", value: rec.slice(20, 40) },
        { id: 5, name: "Identificador del originador", length: 10, position: "41-50", value: rec.slice(40, 50) },
        { id: 6, name: "Tipo de Servicio", length: 3, position: "51-53", value: rec.slice(50, 53) },
        { id: 7, name: "Descripción del Lote", length: 10, position: "54-63", value: rec.slice(53, 63) },
        { id: 8, name: "Fecha Descriptiva", length: 8, position: "64-71", value: rec.slice(63, 71) },
        { id: 9, name: "Fecha Efectiva de la Transacción", length: 8, position: "72-79", value: rec.slice(71, 79) },
        { id: 10, name: "Fecha de Compensación Juliana", length: 3, position: "80-82", value: rec.slice(79, 82) },
        { id: 11, name: "Código estado del Originador", length: 1, position: "83-83", value: rec.slice(82, 83) },
        { id: 12, name: "Código Participante Originador", length: 8, position: "84-91", value: rec.slice(83, 91) },
        { id: 13, name: "Número de Lote", length: 7, position: "92-98", value: rec.slice(91, 98) },
        { id: 14, name: "Reservado", length: 8, position: "99-106", value: rec.slice(98, 106) },
      ]
    }
    else if (type === '6') {
      // título desde el padre (tipo 5)
      const pi = findParentRecord(idx, '5')
      if (pi !== null) {
        const pr = records[pi]
        const ts = pr.slice(50, 53).trim()
        const desc = pr.slice(53, 63).trim()
        ttl = `🌟 Registro de Detalle de Transacciones</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
      }
      flds = [
        { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Código clase de transacción por lote", length: 2, position: "2-3", value: rec.slice(1, 3) },
        { id: 3, name: "Código participante receptor", length: 8, position: "4-11", value: rec.slice(3, 11) },
        { id: 4, name: "Dígito de chequeo", length: 1, position: "12-12", value: rec.slice(11, 12) },
        { id: 5, name: "Número de Cuenta del Receptor", length: 17, position: "13-29", value: rec.slice(12, 29) },
        { id: 6, name: "Valor de la Transacción", length: 18, position: "30-47", value: rec.slice(29, 47) },
        { id: 7, name: "Número de Identificación del Receptor", length: 15, position: "48-62", value: rec.slice(47, 62) },
        { id: 8, name: "Nombre del Receptor", length: 22, position: "63-84", value: rec.slice(62, 84) },
        { id: 9, name: "Datos Discrecionales", length: 2, position: "85-86", value: rec.slice(84, 86) },
        { id: 10, name: "Indicador de Registro de Adenda", length: 1, position: "87-87", value: rec.slice(86, 87) },
        { id: 11, name: "Número de Secuencia", length: 15, position: "88-102", value: rec.slice(87, 102) },
        { id: 12, name: "Reservado", length: 4, position: "103-106", value: rec.slice(102, 106) },
      ]
    }
    else if (type === '7') {
      const pi = findParentRecord(idx, '5')
      if (pi !== null) {
        const pr = records[pi]
        const ts = pr.slice(50, 53).trim()
        const desc = pr.slice(53, 63).trim()
        ttl = `🌟 Registro de Adenda de Transacción</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
      }
      if (position320321 === '99') {
        flds = [
          { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
          { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
          { id: 3, name: "Causal de Devolución", length: 3, position: "4-6", value: rec.slice(3, 6) },
          { id: 4, name: "Número de Secuencia de la Transacción Original", length: 15, position: "7-21", value: rec.slice(6, 21) },
          { id: 5, name: "Fecha de Muerte", length: 8, position: "22-29", value: rec.slice(21, 29) },
          { id: 6, name: "Código del Participante Receptor de la Transacción Original", length: 8, position: "30-37", value: rec.slice(29, 37) },
          { id: 7, name: "Información Adicional", length: 44, position: "38-81", value: rec.slice(37, 81) },
          { id: 8, name: "Número de Secuencia del Registro Adenda", length: 15, position: "82-96", value: rec.slice(81, 96) },
          { id: 9, name: "Reservado", length: 10, position: "97-106", value: rec.slice(96, 106) },
        ]
      } else {
        flds = [
          { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
          { id: 2, name: "Código Tipo de Registro Adenda", length: 2, position: "2-3", value: rec.slice(1, 3) },
          { id: 3, name: "Identifición del Originador ", length: 15, position: "4-18", value: rec.slice(3, 18) },
          { id: 4, name: "Reservado", length: 1, position: "19-19", value: rec.slice(18, 19) },
          { id: 5, name: "Proposito de la Transacción", length: 10, position: "21-30", value: rec.slice(20, 30) },
          { id: 6, name: "Número de Factura/Cuenta", length: 24, position: "31-54", value: rec.slice(30, 54) },
          { id: 7, name: "Reservado", length: 2, position: "55-56", value: rec.slice(54, 56) },
          { id: 8, name: "Información Libre Originador", length: 24, position: "57-80", value: rec.slice(56, 80) },
          { id: 9, name: "Reservado", length: 2, position: "81-83", value: rec.slice(80, 83) },
          { id: 10, name: "Número de secuencia de Registro Adenda", length: 4, position: "84-87", value: rec.slice(83, 87) },
          { id: 11, name: "Número de secuencia de Transacción del Registro de Detalle", length: 7, position: "88-94", value: rec.slice(87, 94) },
          { id: 12, name: "Reservado", length: 12, position: "95-106", value: rec.slice(94, 106) },
        ]
      }
    }
    else if (type === '8') {
      const pi = findParentRecord(idx, '5')
      if (pi !== null) {
        const pr = records[pi]
        const ts = pr.slice(50, 53).trim()
        const desc = pr.slice(53, 63).trim()
        ttl = `🌟 Registro de Control de Lote</br>✨ <span style="color:#3b82f6;">Tipo de Servicio:</span> ${ts} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color:#3b82f6;">Descripción:</span> ${desc}`
      }
      flds = [
        { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Código Clase de Transacción por Lote", length: 3, position: "2-4", value: rec.slice(1, 4) },
        { id: 3, name: "Número de Trans./Adenda", length: 6, position: "5-10", value: rec.slice(4, 10) },
        { id: 4, name: "Totales de Control", length: 10, position: "11-20", value: rec.slice(10, 20) },
        { id: 5, name: "Valor Total de Débitos", length: 18, position: "21-38", value: rec.slice(20, 38) },
        { id: 6, name: "Valor Total de Créditos", length: 18, position: "39-56", value: rec.slice(38, 56) },
        { id: 7, name: "Identificador del Originador", length: 10, position: "57-66", value: rec.slice(56, 66) },
        { id: 8, name: "Código de Autenticación", length: 19, position: "67-85", value: rec.slice(66, 85) },
        { id: 9, name: "Reservado", length: 6, position: "86-91", value: rec.slice(85, 91) },
        { id: 10, name: "ID Participante Originador", length: 8, position: "92-99", value: rec.slice(91, 99) },
        { id: 11, name: "Número de Lote", length: 7, position: "100-106", value: rec.slice(99, 106) },
      ]
    }
    else if (type === '9') {
      ttl = `🌟 Registro de Control de Archivo`
      flds = [
        { id: 1, name: "Tipo de registro", length: 1, position: "1-1", value: rec.slice(0, 1) },
        { id: 2, name: "Cantidad de Lotes", length: 6, position: "2-7", value: rec.slice(1, 7) },
        { id: 3, name: "Número de Bloques", length: 6, position: "8-13", value: rec.slice(7, 13) },
        { id: 4, name: "Número de Trans./Adenda", length: 8, position: "14-21", value: rec.slice(13, 21) },
        { id: 5, name: "Totales de Control", length: 10, position: "22-31", value: rec.slice(21, 31) },
        { id: 6, name: "Valor Total de Débitos", length: 18, position: "32-49", value: rec.slice(31, 49) },
        { id: 7, name: "Valor Total de Créditos", length: 18, position: "50-67", value: rec.slice(49, 67) },
        { id: 8, name: "Reservado", length: 39, position: "68-106", value: rec.slice(67, 106) },
      ]
    }

    setTitle(ttl)
    setFields(flds)
    setCurrent(idx)
    setIsOpen(true)
  }, [records, position320321])

  const closeModal = () => setIsOpen(false)
  const showPrev = () => currentIndex > 0 && handleRowClick(currentIndex - 1)
  const showNext = () => currentIndex < records.length - 1 && handleRowClick(currentIndex + 1)

  // Exporta registros “6” con sus adendas “7” inmediatas, omitiendo la columna “Tipo de registro”
  const exportExcel = () => {
    if (!records.length) return
    if (isNachamValid !== true) {
      showError('No se puede exportar: el archivo no es un NACHAM válido.')
      return
    }

    // 1) Índices de todos los registros tipo “6”
    const type6Indices = records
      .map((rec, idx) => ({ rec, idx }))
      .filter(({ rec }) => rec.charAt(0) === '6')
      .map(({ idx }) => idx)

    if (!type6Indices.length) {
      alert('No hay registros tipo 6 para exportar')
      return
    }

    // 2) Campos base del primer “6” (sin “Tipo de registro”)
    const first6Idx = type6Indices[0]
    const fields6 = parseFields(records[first6Idx], first6Idx)
      .filter(f => f.name !== 'Tipo de registro')

    // 3) Campos de adenda “7” inmediata (sin “Tipo de registro”)
    const nextIdx = first6Idx + 1
    const fields7 = records[nextIdx]?.charAt(0) === '7'
      ? parseFields(records[nextIdx], nextIdx).filter(f => f.name !== 'Tipo de registro')
      : []

    // 4) Construye encabezados: “Registro” + nombres de los campos filtrados
    const headers = [
      'Registro',
      ...fields6.map(f => f.name),
      ...fields7.map(f => f.name)
    ]

    // 5) Genera datos fila a fila
    const data = type6Indices.map((idx6, i) => {
      const row: Record<string, string | number> = { Registro: i + 1 }

      // Valores de “6”
      parseFields(records[idx6], idx6)
        .filter(f => f.name !== 'Tipo de registro')
        .forEach(f => {
          row[f.name] = f.value.replace(/ /g, '·')
        })

      // Valores de “7” inmediato, o celdas vacías si no hay adenda
      const idx7 = idx6 + 1
      if (records[idx7]?.charAt(0) === '7') {
        parseFields(records[idx7], idx7)
          .filter(f => f.name !== 'Tipo de registro')
          .forEach(f => {
            row[f.name] = f.value.replace(/ /g, '·')
          })
      } else {
        // Vacía las columnas de adenda
        fields7.forEach(f => {
          row[f.name] = ''
        })
      }

      return row
    })

    // 6) Crea y descarga el Excel
    const ws = XLSX.utils.json_to_sheet(data, { header: headers })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Datos')
    XLSX.writeFile(wb, `${fileName || 'reporte'}.xlsx`, { bookType: 'xlsx' })

    // Disparamos el toast:
    setToastFileName(`${fileName || 'reporte'}.xlsx`)
    setShowToast(true)
    // Ocultarlo tras 4s:
    setTimeout(() => setShowToast(false), 6000)
  }

  const cerrarToast = () => setShowToast(false)


  return (
    <>
      {/* Toast de éxito */}
      <div
        id="toast-exito"
        className={`
          fixed bottom-5 right-5 z-50 max-w-sm w-full
          bg-green-600 text-white rounded-lg shadow-lg
          border-l-8 border-green-900 flex p-4
          transition-opacity duration-300
          ${showToast ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      >
        <div className="mr-3 flex items-start">
          <svg className="w-7 h-7 mt-0.5" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="12" fill="#2ecc71" />
            <path d="M9.5 16L5 11.5L6.41 10.09L9.5 13.17L17.59 5.09L19 6.5L9.5 16Z" fill="white" />
          </svg>
        </div>

        {/* Contenido */}
        <div className="flex-1 text-sm">
          <p className="font-semibold text-base leading-tight">Exito Total</p>
          <p className="mt-1 leading-snug">
            El archivo:<br />
            <span className="break-words">{toastFileName}</span><br />
            ha sido generado con éxito.
          </p>
        </div>

        {/* Botón cerrar en la esquina superior derecha */}
        <button
          onClick={cerrarToast}
          className="absolute top-2 right-2 text-white hover:text-gray-200 focus:outline-none"
          aria-label="Cerrar"
        >
          &times;
        </button>
      </div>

      {errorToast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm w-full bg-red-600 text-white rounded-lg shadow-lg border-l-8 border-red-900 flex p-4">
          <div className="flex-1 text-sm">
            <p className="font-semibold text-base leading-tight">Error</p>
            <p className="mt-1">{errorToast}</p>
          </div>
          <button
            onClick={() => setErrorToast(null)}
            className="absolute top-2 right-2 text-white hover:text-gray-200 focus:outline-none"
            aria-label="Cerrar"
          >&times;</button>
        </div>
      )}

      {/* ==== HEADER ==== */}
      <header className="w-full bg-white border-b border-[#BBC2C8] font-sans">
        <div className="max-w-[1000px] mx-auto flex items-center justify-between py-2 px-4">
          <h1 className="m-0 text-xl font-semibold text-[#2D77C2]">
            Visor de archivos NACHAM
          </h1>
          <div className="flex items-center space-x-4">
            {/* Nombre de archivo + icono de export */}
            {fileName && (
              <div className="flex items-center text-gray-700 text-sm truncate max-w-xs">
                <span className="truncate">{fileName}</span>

                {/* Badge si NO es válido */}
                {isNachamValid === false && (
                  <span className="ml-2 px-2 py-0.5 text-xs rounded bg-red-100 text-red-700 border border-red-300">
                    no NACHAM
                  </span>
                )}

                {/* Botón Exportar sólo si es válido */}
                {isNachamValid === true && (
                  <button
                    type="button"
                    onClick={exportExcel}
                    className="ml-2 p-1 hover:bg-gray-200 rounded cursor-pointer"
                    title="Exportar a Excel"
                    dangerouslySetInnerHTML={{ __html: svgExportIcono }}
                  />
                )}
              </div>
            )}

            {/* Botón de selección */}
            <label
              htmlFor="fileInput"
              className="
                inline-block
                px-4 py-2
                bg-green-600 hover:bg-green-700 active:bg-green-800
                text-white text-sm font-medium
                rounded shadow
                cursor-pointer
                transition"
            >
              Seleccionar Archivo NACHAM
            </label>
            <input
              id="fileInput"
              type="file"
              accept="*.*"
              className="hidden"
              onChange={handleFile}
            />
          </div>
        </div>
      </header>

      {/* ==== MAIN ==== */}
      <main className="p-4 space-y-6">
        {records.length > 0 ? (
          <div id="detail" className="m-2 border border-gray-300 rounded-lg shadow-md">
            <NachamVisor
              records={records}
              lineHeight={20}
              height={Math.floor(window.innerHeight * 0.8)}
              onRowClick={handleRowClick}
              selectedIndex={isOpen ? currentIndex : undefined}
              badFromIndex={badFromIndex} // null o número
              badRows={[...badRowSet]}
            /></div>
        ) : (
          <p className="text-gray-600">Asegurese de que carga un NACHAM en formato válido</p>
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
    </>
  )
}
