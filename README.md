# NACHAM WebViewer v2

Nuevo proyecto web en Next.js + TypeScript para portar la funcionalidad de `NACHAMEXT` sin tocar la extension.

## Estado actual

- Base visual clonada desde `webviewer` para conservar tema/UI.
- Se creo un core en `src/core/nacham` con:
  - `fieldMaps.ts`: FIELD_MAP dinamico por perfil.
  - `profile.ts`: deteccion de perfil (`PPD PRENOTIFIC`, `PPD PAGOS`, `PPD DEVOLUCION`, `PPD TRASLADOS`, `CTX PAGOS`).
  - `parser.ts`: parse de registros y extraccion de campos.
  - `tree.ts`: estructura de lotes/totales base.
- `src/app/page.tsx` ya consume ese core para abrir modal con campos dinamicos por perfil.

## Ejecutar local

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

## Siguiente fase

- Portar validaciones avanzadas de `extension.js` al worker web.
- Portar exportadores `CSV`, `JSON` y `SQL` con la misma salida de la extension.
- Portar flujo completo de busqueda/edicion (estado, highlights, guardado de copia).
