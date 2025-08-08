export default function Head() {
    return (
        <>
            <link rel="icon" type="image/png" href="/favicon.png" />
            <title>Visor NACHAM</title>
            
            <script
                id="taggogle"
                strategy="afterInteractive"
                dangerouslySetInnerHTML={{
                    __html: `
            // Aquí va tu código de inicialización de Taggogle
            (function(w,d,s,l,i){ /* … */ })(window,document,'script','dataLayer','G-DJC85LJVNM');
          `,
                }}
            />
        </>
    )
}