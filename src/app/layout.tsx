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
      <body className="bg-gray-100 text-gray-800 overflow-y-scroll bg-triple-calido">
        <div className="w-full max-w-[1070px] mx-auto min-h-screen flex flex-col">
          {/* Contenido principal */}
          <main className="flex-grow pt-6 px-6 pb-16">
            {children}
          </main>
          {/* Footer con latido */}
          <footer className="
              sticky bottom-0 left-0
              w-full
              py-2 text-center text-gray-500 text-sm font-sans">
            © {new Date().getFullYear()} IOB Suite <span className="inline-block animate-heart text-red-500">❤️</span> MHCP
          </footer>
        </div>
      </body>
    </html>
  )
}