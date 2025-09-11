// src/app/layout.tsx
import './globals.css'
import { ReactNode } from 'react'
import Script from 'next/script'

export const metadata = {
  title: 'Visor NACHAM',
  description: 'Web app para ver el contenido de archivos NACHAM',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
    shortcut: '/favicon.png'
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <Script
        id="gtm-head"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function(w,d,s,l,i){
              w[l]=w[l]||[];
              w[l].push({'gtm.start': new Date().getTime(), event:'gtm.js'});
              var f=d.getElementsByTagName(s)[0],
                  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
              j.async=true;
              j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
              f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','G-DJC85LJVNM');
          `,
        }}
      />
      <body className="bg-gray-100 text-gray-800 overflow-y-scroll relative">
        {/* Fondo */}
        <div className="absolute inset-0 bg-white dark:bg-gray-950 -z-10">
          <div className="absolute inset-0 opacity-[0.15] dark:opacity-[0.1]">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <pattern id="binary-pattern" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
                <text x="0" y="10" className="text-xs fill-blue-500 dark:fill-blue-400">011111111</text>
                <text x="20" y="20" className="text-xs fill-blue-500 dark:fill-blue-400">PPD  </text>
                <text x="0" y="30" className="text-xs fill-blue-500 dark:fill-blue-400">ESORO NACIONAL</text>
                <text x="20" y="40" className="text-xs fill-blue-500 dark:fill-blue-400">000016832</text>
                <text x="0" y="50" className="text-xs fill-purple-500 dark:fill-purple-400">PRENOTIFICAC</text>
                <text x="20" y="60" className="text-xs fill-purple-500 dark:fill-purple-400">ISTERIO DE HAC</text>
                <text x="0" y="70" className="text-xs fill-blue-500 dark:fill-blue-400">000016830000009</text>
                <text x="20" y="80" className="text-xs fill-blue-500 dark:fill-blue-400">NCO REPUBLICA</text>
                <text x="0" y="90" className="text-xs fill-blue-500 dark:fill-blue-400">8999990902</text>
                <text x="20" y="100" className="text-xs fill-blue-500 dark:fill-blue-400">000016832</text>
              </pattern>
              <rect width="100%" height="100%" fill="url(#binary-pattern)" />
            </svg>
          </div>
          <div className="absolute inset-0 bg-gradient-to-br from-white via-white/0 to-white dark:from-gray-950 dark:via-gray-950/0 dark:to-gray-950" />
        </div>

        <div className="w-full max-w-[1070px] mx-auto min-h-screen flex flex-col relative z-0">
          {/* Contenido principal */}
          <main className="flex-grow pt-2 px-6 pb-8">
            {children}
          </main>
          {/* Footer con latido */}
          <footer className="
              sticky bottom-0 left-0
              w-full
              py-2 text-center text-gray-500 text-xs font-sans">
            © {new Date().getFullYear()} IOB Suite <span className="inline-block animate-heart text-red-500">❤️</span> MHCP
          </footer>
        </div>
      </body>
    </html>
  )
}