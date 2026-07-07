'use client'

import { useCallback, useEffect, useState } from 'react'

const SPLASH_STORAGE_KEY = 'nacham.web.usageFeedbackSplash.v1'
const TEAMS_FEEDBACK_URL = 'https://teams.microsoft.com/l/chat/0/0?users=whernans@minhacienda.gov.co'

export default function UsageFeedbackSplash() {
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        try {
            setIsVisible(window.localStorage.getItem(SPLASH_STORAGE_KEY) !== 'dismissed')
        } catch {
            setIsVisible(true)
        }
    }, [])

    const dismiss = useCallback(() => {
        try {
            window.localStorage.setItem(SPLASH_STORAGE_KEY, 'dismissed')
        } catch { }
        setIsVisible(false)
    }, [])

    if (!isVisible) return null

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="usage-feedback-title"
        >
            <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
                <div className="h-1.5 bg-gradient-to-r from-[#2D77C2] via-[#3BA36B] to-[#BBC2C8]" />

                <div className="p-6 sm:p-7">
                    <div className="mb-5 flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2D77C2]">
                                Aviso de continuidad
                            </p>
                            <h2 id="usage-feedback-title" className="mt-2 text-2xl font-semibold leading-tight text-slate-950">
                                ¿Estás usando el Visor NACHAM?
                            </h2>
                        </div>

                        <button
                            type="button"
                            onClick={dismiss}
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-xl leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2D77C2]/35"
                            aria-label="Cerrar aviso"
                        >
                            &times;
                        </button>
                    </div>

                    <div className="space-y-4 text-[15px] leading-6 text-slate-700">
                        <p>
                            Estoy revisando si esta aplicación sigue teniendo usuarios activos. Si la estás utilizando,
                            agradecería que me compartas tus comentarios, sugerencias o necesidades de mejora.
                        </p>
                        <p>
                            Si no recibo señales de uso, liberaré el espacio del servidor y retiraré la aplicación.
                        </p>
                    </div>

                    <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        Tu mensaje ayuda a decidir si se mantiene, se mejora o se elimina esta herramienta.
                    </div>

                    <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={dismiss}
                            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#2D77C2]/25"
                        >
                            Entendido, no volver a mostrar
                        </button>
                        <a
                            href={TEAMS_FEEDBACK_URL}
                            target="_blank"
                            rel="noreferrer"
                            onClick={dismiss}
                            className="rounded-lg bg-[#2D77C2] px-5 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-[#2363a4] focus:outline-none focus:ring-2 focus:ring-[#2D77C2]/35 focus:ring-offset-2"
                        >
                            Enviar comentario por Teams
                        </a>
                    </div>
                </div>
            </div>
        </div>
    )
}
