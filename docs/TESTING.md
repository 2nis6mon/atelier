# Estrategia de pruebas

Tres niveles distintos, que el informe (`TEST-REPORT.md`) reporta por separado:

1. **Pruebas de código** (vitest, ejecutado con el Node de Electron):
   - `tests/unit/` — dominio puro: documento CV, marcado, fechas, historial (deshacer/rehacer), diff, propuestas (aplicar, desactualización), versiones, estados de candidatura, paginación y átomos, parsing de CV, deduplicación, ofertas, contexto/prompt/validación/guardia de IA, etiquetas de registros.
   - `tests/integration/` — con SQLite y archivos reales en carpetas temporales: almacén y migraciones (inmutabilidad incluso con SQL directo), copia de seguridad y restauración, importación DOCX/PDF/Pages/escaneado, adaptadores de IA con transporte simulado (OpenAI, ChatGPT, Anthropic con el SDK oficial, compatible), inicio de sesión ChatGPT con servidor *loopback* real, servicio de IA, exportación DOCX y servicio de exportación, diario de recuperación.
   - `tests/components/` — jsdom: edición de texto enriquecido, pestañas con lente, diálogos (Escape, foco atrapado), menús por teclado.
2. **E2E de interfaz** (`tests/e2e/`, Playwright controlando la app Electron compilada, datos aislados en carpetas temporales):
   1. Primer arranque → importar Word/PDF/Pages → resolver conflicto de fecha → guardar → reabrir.
   2. Candidatura desde un enlace (y estado de error del enlace) → CV duplicado → sugerencias del proveedor de prueba → aceptar una, rechazar otra → deshacer/rehacer → el CV base intacto.
   3. Edición manual → negrita → deshacer/rehacer → 2 páginas → plantilla Sidebar → mover secciones con teclado → ocultar → exportar PDF y DOCX → inspección de los archivos (páginas, texto, enlaces, listas, sin tablas ni imágenes).
   4. Marcar como enviado → copias exactas en solo lectura → editar borrador → la versión enviada intacta → comparar → borrador nuevo desde la versión enviada.
   5. Cierre brusco (SIGKILL) → recuperar → copia de seguridad → restaurar sobre datos existentes (colisiones) y en una instalación vacía.
   6. Cuota agotada, cancelación, respuesta inválida, texto cambiado durante la petición, dato no verificado → el borrador nunca cambia y no hay *fallback*.
   7. Teclado, foco visible, menús, diálogos, reducir movimiento y transparencia, ventana compacta.
   8. Biblioteca: comprobación de duplicados con IA bajo petición, fusión con elección explícita, edición de registros de todos los tipos, crear/renombrar/duplicar/borrar CV.
   9. Flujo completo de candidatura: contexto de la oferta, revisión de los 7 tipos de sugerencia, añadir desde la biblioteca, estilo y secciones, copia traducida, tablero y expediente.
   10. PDF escaneado con OCR local y documento Pages experimental.
3. **Prueba de humo del binario** (`tests/smoke/`): la app **instalada desde el DMG** (fuera del árbol de desarrollo) arranca, crea su espacio de datos, importa y exporta PDF/Word.

La IA nunca usa credenciales ni llamadas facturadas: transportes simulados en código y un servidor local compatible con OpenAI que solo existe en las pruebas.

## Cobertura

`npm run test:coverage` mide las mismas fuentes con dos suites — vitest (V8) y E2E (V8 de Chromium para renderer/preload y `NODE_V8_COVERAGE` para el proceso principal, mapeadas a `src/` con los *source maps*) — y `scripts/coverage-gate.mjs` las combina **por archivo y por métrica tomando el valor mayor**, que es una cota inferior de la cobertura real combinada. Umbrales: ≥ 80 % líneas, funciones y sentencias, ≥ 75 % ramas en todo `src/`, ningún archivo sin medir, y ≥ 90 % de líneas (85 % funciones, 75 % ramas) en la lógica crítica — propuestas, versiones, historial, base de datos, almacenamiento y copia de seguridad — **solo con pruebas unitarias/integración**. Si no se cumple, el comando falla.
