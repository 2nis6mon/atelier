# Informe de pruebas

Resultados **reales** de la última versión (`claude/tender-cray-1tbmr6`). Se distinguen tres niveles: pruebas de código, E2E de interfaz y prueba de humo del binario empaquetado. Ninguna prueba se ha omitido (`skip`): 0 omitidas, 0 fallidas.

## Resumen

| Nivel | macOS 15.7.9 · Apple Silicon (CI) | Linux · Xvfb (desarrollo) |
|---|---|---|
| Código: unitarias + integración + componentes (vitest) | 186 / 186 en 25 archivos | 186 / 186 en 25 archivos |
| E2E de interfaz (Playwright + app Electron compilada) | 10 / 10 recorridos | 10 / 10 recorridos |
| Prueba de humo de la app **instalada desde el DMG** | 1 / 1 | 1 / 1 (directorio empaquetado Linux, solo para validar el empaquetado) |
| Puerta de cobertura | superada | superada |

Ejecución de CI: [run #3](https://github.com/2nis6mon/atelier/actions/runs/36798862804) sobre el commit `0e01f1e` (imagen `macos-15-arm64` 20260907.0337, macOS 15.7.9 build 24G830, Apple Silicon, Node 24.20).
Entorno local: Ubuntu 24.04 (kernel 6.18), Electron 44.5.1 (Chromium 152.0.7977.130, Node 24.21), Xvfb.

## Cobertura

Medida con V8 en ambas suites y combinada por archivo y métrica tomando el mayor valor (cota inferior de la cobertura real combinada; ver `docs/TESTING.md`). Umbrales: 80 % líneas/sentencias/funciones, 75 % ramas, sin archivos sin medir.

| Métrica | CI macOS | Local | Umbral |
|---|---:|---:|---:|
| Líneas | 91,4 % (5162/5650) | 91,4 % (5165/5650) | 80 % |
| Sentencias | 89,0 % (6016/6762) | 89,0 % (6020/6762) | 80 % |
| Funciones | 83,9 % (1668/1987) | 84,0 % (1669/1987) | 80 % |
| Ramas | 77,5 % (4345/5604) | 77,8 % (4359/5604) | 75 % |

Por suite (local): solo unitarias/integración/componentes — líneas 58,0 %, funciones 41,1 %, ramas 47,9 % (todo `src/`, incluida la interfaz); solo E2E — líneas 80,0 %, funciones 77,0 %, ramas 62,6 %.

Lógica crítica (umbral ≥ 90 % líneas, ≥ 85 % funciones, ≥ 75 % ramas, **solo con unitarias/integración**):

| Archivo | Líneas | Funciones | Ramas |
|---|---:|---:|---:|
| src/shared/proposals.ts | 98,1 % | 100 % | 91,6 % |
| src/shared/versions.ts | 100 % | 100 % | 89,1 % |
| src/shared/history.ts | 100 % | 100 % | 88,0 % |
| src/main/db/store.ts | 98,1 % | 100 % | 85,9 % |
| src/main/db/migrations.ts · connection.ts | 100 % | 100 % | 100 % · 90 % |
| src/main/storage/backup.ts | 98,9 % | 100 % | 93,1 % |
| src/main/storage/files.ts | 100 % | 100 % | 90,9 % |
| src/main/storage/recovery.ts | 100 % | 100 % | 87,5 % |

El detalle por archivo se genera en `coverage/SUMMARY.md` y se publica en el artefacto *test-reports* de cada ejecución de CI.

## Paquete (CI, macOS)

- `Atelier-1.0.0-arm64-mac.dmg` (≈ 144 MB) y `Atelier-1.0.0-arm64-mac.zip`; app instalada ≈ 320 MB.
- Instalada desde el DMG en una carpeta temporal fuera del árbol de desarrollo y ejecutada desde ahí: arranca, crea su espacio de datos (`atelier.db`), importa DOCX y PDF, exporta PDF y Word (PDF con el texto esperado) y muestra la versión en *About*.
- `codesign --verify --deep --strict`: *valid on disk, satisfies its Designated Requirement*; `Signature=adhoc`, `TeamIdentifier=not set`; binario `arm64`; `CFBundleIdentifier app.atelier.personal`, `LSMinimumSystemVersion 13.0`.
- `spctl --assess`: **rejected** — esperado: la app no está firmada con Developer ID ni notarizada.
- SHA-256: 
  - `85e1172f7d12069d623ff8c314b896b78dd4efbb0a69b8700c7ad0f11c58c771`  Atelier-1.0.0-arm64-mac.dmg
  - `e96cd1e7a7031a099dd93d6b42ab3b137128d5ebab1b3a1040689f7c69b590e1`  Atelier-1.0.0-arm64-mac.zip

## Validación visual

- Capturas de todas las pantallas revisadas durante el desarrollo (`docs/screenshots/`, generadas por los recorridos E2E en Linux/Xvfb con las mismas fuentes incluidas en la app; la CI genera el mismo conjunto en macOS, en el artefacto *test-reports*).
- Documentos exportados inspeccionados: PDF A4 etiquetado, 1 y 2 páginas sin páginas en blanco, texto seleccionable con acentos, enlaces `mailto:`/`https:` activos (`docs/screenshots/export-pdf-1.png`); DOCX con estilos Title/Heading1/Heading2, listas con numeración de Word, hipervínculos, idioma `fr-FR`, sin tablas ni imágenes.

## Errores encontrados por las pruebas y corregidos

- Lo tecleado justo después de Intro caía en parte en la viñeta anterior.
- Bucle de renderizado por un selector de estado inestable (pantalla del editor en blanco).
- Escape no cerraba un diálogo si el foco se había perdido.
- Fusionar dos puestos «actuales» guardaba una fecha de fin inválida.
- El botón «…» de las tarjetas de CV quedaba debajo de la miniatura.
- Comentarios y preguntas pendientes dejaban de ser accesibles tras responder una.
- Las vistas no se refrescaban tras restaurar una copia de seguridad.
- El OCR convertía viñetas y separadores en «+».
- «Connected» se mostraba para claves de API sin verificar.
- Con *Reducir movimiento* aún se ejecutaba una animación de 1 ms.

## Qué NO se ha probado (límites reales)

- **Conexión real con ChatGPT (plan), OpenAI API y Anthropic API**: sin credenciales; probadas con transportes simulados, y el flujo completo de IA probado con un proveedor local de pruebas.
- **macOS 13, 14 y 26** y Macs Intel (no soportados: el paquete es solo arm64): solo se ha probado macOS 15.7.9 en un runner de Apple Silicon; no en el Mac mini del usuario.
- **Primer arranque con Gatekeeper** de un archivo descargado (con atributo de cuarentena): el binario de CI no tiene cuarentena; el procedimiento está documentado en la guía.
- **Conversión con Pages** vía AppleScript: Pages no está instalado en los runners; las demás vías de Pages (vista previa, lector experimental) sí están probadas.
- **Material Liquid Glass real** de macOS 26: la app usa una aproximación (ver `docs/DECISIONS.md`).
