# Compilar, probar y empaquetar Atelier

Todo es reproducible desde el código con las versiones fijadas en `package-lock.json`.

## Requisitos

- **Node.js 24** (CI usa 24; mínimo 22.12) y npm.
- Para el instalador: **macOS en Apple Silicon** (el DMG se crea con `hdiutil` y la firma ad hoc con `codesign`).
- Para las pruebas E2E en Linux sin pantalla: `xvfb-run`.

## Pasos

```bash
npm ci                 # dependencias exactas; Electron 44.5.1 se descarga en su postinstall
npm run typecheck      # TypeScript estricto (src + tests)
npm run build          # dist/: proceso principal, preload y renderer (+ OCR local)
npm start              # compila y abre la app en modo desarrollo
```

### Pruebas

```bash
npm run test:unit      # unitarias + integración + componentes (vitest, sobre el Node de Electron)
npm run test:e2e       # compila y ejecuta los 10 recorridos E2E contra la app real (Playwright)
npm run test:coverage  # todo lo anterior con cobertura y la puerta de calidad (falla si baja del umbral)
```

En Linux sin pantalla: `xvfb-run -a -s "-screen 0 1600x1000x24" npm run test:e2e` (`test:coverage` lo hace solo).

Variables útiles: `ATELIER_SCREENSHOTS=<dir>` (capturas de los recorridos), `ATELIER_COVERAGE_DIR=<dir>` (cobertura V8 bruta de E2E), `ATELIER_APP_PATH=<ejecutable>` (ejecuta las pruebas contra una app empaquetada).

Las pruebas no usan credenciales ni llamadas facturadas: la IA se prueba con transportes simulados (unitarias/integración) y con un servidor local compatible con OpenAI que solo existe en las pruebas (`tests/e2e/fakeProvider.ts`).

### Instalador (macOS, Apple Silicon)

```bash
npm run dist:mac       # release/Atelier-1.0.0-arm64-mac.dmg y .zip (firma ad hoc en build/afterPack.cjs)
ATELIER_APP_PATH="$PWD/release/mac-arm64/Atelier.app/Contents/MacOS/Atelier" \
  npx playwright test -c playwright.smoke.config.ts   # prueba de humo del binario empaquetado
```

No se firma con Developer ID ni se notariza (no hay credenciales de Apple). Con un certificado, bastaría con fijar `mac.identity`, activar `hardenedRuntime` con los *entitlements* de Electron y añadir la notarización de electron-builder.

### CI

`.github/workflows/macos.yml` hace todo lo anterior en un runner macOS 15 de Apple Silicon: type check, pruebas con la puerta de cobertura, empaquetado, instalación desde el DMG en una carpeta temporal, verificación de la firma y de la arquitectura, prueba de humo de la app instalada, y publica el instalador, los informes, la cobertura y las capturas como artefactos y en un borrador de *release* único («Atelier — latest build»).

### Datos de prueba

`tests/fixtures/` contiene documentos sintéticos de una persona ficticia (Camille Laurent): `npm run fixtures` regenera DOCX, PDF, Pages y la oferta; `npx electron scripts/make-scanned-fixture.cjs` regenera el PDF escaneado (solo imagen).

## Estructura

```
src/shared/     dominio puro: documento CV, historial, diff, propuestas, versiones, estados,
                paginación, importación (parsing, deduplicación), IA (contexto, prompt, validación)
src/main/       proceso principal: SQLite (node:sqlite) + migraciones, archivos, backup,
                importadores (DOCX/PDF/Pages/ofertas), proveedores de IA, exportación DOCX/PDF,
                ventanas, protocolo app://, IPC validado
src/preload/    puente mínimo y tipado (contextIsolation, sandbox)
src/renderer/   interfaz React: biblioteca, importación, candidaturas, editor, revisión, ajustes
tests/          unit/ integration/ components/ e2e/ smoke/ fixtures/
scripts/        build, fixtures, vitest sobre Electron, cobertura E2E y puerta de cobertura
```
