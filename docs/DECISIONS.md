# Decisiones de diseño (ADR) y límites conocidos

## ADR-1 · Electron + React en lugar de SwiftUI

**Contexto.** La app debía construirse y probarse de punta a punta, incluido el binario empaquetado, pero el entorno de desarrollo era Linux; solo la CI tiene macOS.
**Decisión.** Electron 44 (Chromium 152, Node 24) + React 19 + TypeScript estricto. El mismo código se prueba en Linux (Xvfb) y en macOS (CI, Apple Silicon), y el instalador se genera y se prueba en macOS.
**Consecuencias.** No es una app nativa AppKit/SwiftUI: tamaño mayor (~200 MB instalada) y materiales aproximados (ADR-2). A cambio: un único código probado de verdad, PDF con el motor de impresión de Chromium e interfaz accesible por teclado.

## ADR-2 · Liquid Glass aproximado en la capa web

La ventana usa el material nativo de macOS (`vibrancy: under-window`, barra de título integrada). Barras, menús, dock, selectores y paletas usan un material web (fondo translúcido + `backdrop-filter` + bordes y sombras especulares). La selección activa es **una sola lente** que se desliza, se estira y se asienta (Web Animations, 320 ms, interrumpible); los pulsados duran 150 ms y los menús 190 ms. Con *Reducir movimiento* la lente salta sin animación; con *Reducir transparencia* los materiales pasan a ser opacos. El CV y los diffs siempre van sobre superficies opacas. **No es el material Liquid Glass real de macOS 26**; es una aproximación declarada.

Contraste comprobado (WCAG AA): texto #202B3B sobre crema 12,7:1; secundario ajustado de #667080 a **#5E6776** (5,08:1); blanco sobre terracota #A84F36 5,47:1.

## ADR-3 · Almacenamiento local

SQLite (`node:sqlite`, WAL, `synchronous=FULL`, claves foráneas, migraciones versionadas, transacciones `BEGIN IMMEDIATE`) en `~/Library/Application Support/Atelier/data/`, más una carpeta de archivos (originales, envíos) con escrituras atómicas y protección contra rutas fuera de la carpeta. Las versiones enviadas y sus archivos son **inmutables a nivel de base de datos** (triggers que rechazan UPDATE/DELETE) y los archivos se guardan en solo lectura con su SHA-256. Un diario de recuperación (fuera de los datos) guarda los cambios no guardados para ofrecerlos tras un cierre brusco. La copia de seguridad es un único archivo ZIP con manifiesto, sumas de comprobación y validación, que se inspecciona antes de restaurar (detección de colisiones; nada se sobrescribe sin elección; en modo «reemplazar» se conserva una copia previa).

## ADR-4 · La IA siempre bajo control

- Solo acciones explícitas; nada se ejecuta al escribir o seleccionar. El panel muestra el alcance y lo que se enviará (*Will send*).
- El modelo debe devolver una única herramienta (`submit_suggestions`) con un esquema JSON plano; la respuesta se valida (zod) y se mapea a **propuestas** separadas del documento. Nada cambia hasta aceptar; cada propuesta muestra diff, explicación y fuentes, y se puede aceptar, rechazar, editar, pedir otra o deshacer (⌘Z).
- **Guardia de hechos**: números, tecnologías y nombres propios nuevos que no figuran en el CV ni en la biblioteca seleccionada se marcan como «no encontrados en tus documentos» y exigen confirmación expresa; un requisito de la oferta no cuenta como prueba.
- Documentos y ofertas se tratan como datos no fiables: van delimitados (`<<<UNTRUSTED …>>>`), sus marcadores se neutralizan y sus instrucciones nunca se obedecen. Nunca se ejecutan macros ni contenido activo de los documentos.
- Si el texto cambió durante la petición, la propuesta queda «desactualizada» y no se puede aplicar a ciegas. Cancelación, error, cuota o respuesta inválida nunca alteran el borrador.
- **Nunca** hay cambio automático de proveedor ni a una modalidad de pago.

## ADR-5 · Proveedores de IA (investigación y decisión)

| Proveedor | Modalidad | Estado |
|---|---|---|
| ChatGPT | *Sign in with ChatGPT*: uso del plan de ChatGPT, sin clave | Implementado según la documentación publicada; **conexión real no verificada** |
| OpenAI API | Clave de API (facturación aparte) | Implementado; probado con transporte simulado |
| Claude | Clave de API de Anthropic (facturación aparte) | Implementado con el SDK oficial `@anthropic-ai/sdk`; probado con transporte simulado |
| Modelo local | Servidor compatible con OpenAI (Ollama, LM Studio) | Implementado; probado de punta a punta con un servidor local de pruebas |

**ChatGPT.** OpenAI documenta un flujo para que apps de terceros (incluidas apps personales/open source) usen el plan del usuario: autorización OAuth con PKCE S256, redirección *loopback* `http://127.0.0.1:<puerto>/auth/callback`, registro dinámico de cliente (`dynamic_agent_client`), alcance `chatgpt.tokens.use.direct`, *access token* de 1 h en memoria y *refresh token* rotatorio de 30 días, revocación al desconectar, y errores específicos (`subscription_sharing_usage_limit_exceeded`, `…_user_not_eligible`, `…_unsupported_capability`). Fuentes consultadas: OpenAI Cookbook «Sign in with ChatGPT» (developers.openai.com/cookbook/articles/sign-in-with-chatgpt), guías SIWC (developers.openai.com/siwc/quickstart, /siwc/token-sharing-open-source y su página de errores) y el artículo de ayuda «Using your ChatGPT plan in other apps and sites» (help.openai.com/en/articles/20001542). El host de documentación de OpenAI no era accesible desde el entorno de desarrollo, así que parte de estos detalles se tomaron de los extractos de búsqueda y de fuentes secundarias. Se probó con un transporte simulado y un servidor *loopback* real, pero **no contra el servicio de OpenAI** (no se usaron credenciales del usuario). La elegibilidad depende de la cuenta; la app lo indica y enlaza a la gestión de uso de ChatGPT.

**Claude.** Anthropic no permite usar las suscripciones de Claude (OAuth de consumidor) desde aplicaciones de terceros (aclaración de febrero de 2026). Por eso **no** hay modo «suscripción»: solo clave de API como modalidad **separada y facturada**, con precios visibles en Ajustes (p. ej. Claude Opus 5.5, modelo por defecto: 4 $/20 $ por millón de tokens de entrada/salida). No hay *fallback* automático a otro modelo.

**Secretos.** Claves y *refresh tokens* se cifran con `safeStorage` de Electron, cuya clave vive en el **llavero de macOS**; en disco solo hay texto cifrado (permisos 0600) fuera de la carpeta de datos, por lo que nunca entran en copias de seguridad ni en registros. No se leen cookies ni tokens de otras apps. Sin credenciales de prueba, la conexión real a ChatGPT/OpenAI/Anthropic queda **sin verificar**; en producción no existen respuestas simuladas.

## ADR-6 · Exportación

- **PDF**: el documento aceptado se renderiza en una ventana oculta con la misma composición que la vista previa (paginación por átomos con «mantener con el siguiente», sin reducir nunca el texto) y `printToPDF` A4 con PDF etiquetado: texto seleccionable, enlaces activos, acentos correctos, sin páginas en blanco (comprobado en E2E).
- **Word**: DOCX simple con estilos de título reales, párrafos y listas con numeración de Word, hipervínculos e idioma del documento; sin imágenes, tablas ni cuadros de texto.
- Exportar nunca traduce: para otro idioma se crea una versión traducida aparte. «Mark as sent» guarda los bytes exactos exportados.

## ADR-7 · Importación

DOCX con mammoth (sin ejecutar macros), PDF con pdf.js (reconstrucción de líneas y columnas), PDF escaneado con OCR local (Tesseract WASM, francés e inglés incluidos, hasta 8 páginas), Pages en este orden: vista previa PDF incluida en el archivo → lector experimental del formato IWA (avisado como experimental) → conversión con Pages vía AppleScript (con permiso de macOS) → instrucciones para exportar a Word y adjuntar el `.docx`. Ofertas por texto, archivo o enlace (http/https, 15 s, 5 MB, JSON-LD JobPosting, detección de páginas bloqueadas, alternativa de pegar el texto).

## ADR-8 · Seguridad de la app

Renderer con `contextIsolation`, `sandbox`, sin Node, protocolo propio `app://` con CSP estricta, navegación y ventanas nuevas bloqueadas, enlaces externos solo http(s)/mailto en el navegador. El puente `window.atelier` es mínimo y tipado; el proceso principal valida identificadores, longitudes y tipos de cada llamada. Sin telemetría y sin contenido del CV en registros.

## ADR-9 · Empaquetado y firma

DMG + ZIP para arm64, macOS 13+. Sin Developer ID ni notarización disponibles: firma **ad hoc** (necesaria para ejecutar en Apple Silicon), verificada con `codesign --verify --deep --strict` en CI. Gatekeeper rechaza la evaluación (`spctl`), como corresponde; la guía explica la apertura oficial. Nunca se propone desactivar Gatekeeper globalmente.

## Límites conocidos

- Conexión real a ChatGPT (plan), OpenAI API y Anthropic API **no verificada** (sin credenciales). Sí está verificado de punta a punta el flujo completo con un proveedor local compatible.
- Liquid Glass aproximado (ADR-2).
- Lector Pages IWA experimental: puede omitir formato o partes; se marca para revisión.
- OCR: calidad dependiente del escaneo; se avisa de revisar nombres, fechas y acentos.
- La conversión con Pages requiere Pages instalado y el permiso de automatización de macOS; no se pudo probar en CI (Pages no está instalado en los runners).
- App no notarizada: primera apertura con confirmación manual.
