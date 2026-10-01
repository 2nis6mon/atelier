# Atelier — guía breve

Atelier es una aplicación personal para Mac: guarda tu biblioteca profesional, tus CV, las ofertas y cada candidatura, todo en tu Mac. La interfaz está en inglés; esta guía cita los botones tal como aparecen.

## 1. Requisitos

- Mac con **Apple Silicon** (M1 o posterior).
- **macOS 13 Ventura o posterior** (requisito de Electron 44, en el que se basa Atelier).
- No hace falta instalar Node, Python ni nada más. No hace falta ninguna cuenta.

## 2. Instalar

1. Descarga `Atelier-1.0.0-arm64-mac.dmg` (o el `.zip`) del borrador de *release* «Atelier — latest build» del repositorio, o de los artefactos del flujo de CI *macOS build, test and package*.
2. Abre el `.dmg` y arrastra **Atelier** a **Aplicaciones**.

## 3. Primer arranque (aviso de seguridad de macOS)

La app está firmada *ad hoc*: **no** está firmada con un Developer ID de Apple **ni notarizada**, porque no había cuenta de desarrollador de Apple disponible. Por eso macOS pide confirmación la primera vez. No hace falta (ni se recomienda) desactivar Gatekeeper.

- **macOS 15 Sequoia o posterior**: abre Atelier una vez (aparecerá «Atelier no se ha abierto»; pulsa *Hecho*). Ve a **Ajustes del Sistema › Privacidad y seguridad**, baja hasta el mensaje sobre Atelier y pulsa **Abrir igualmente**; confirma con tu contraseña.
- **macOS 13–14**: en Finder, haz clic con la tecla Control sobre Atelier › **Abrir** › **Abrir**.

Procedimiento oficial de Apple: «Abrir una app de un desarrollador no identificado» (support.apple.com/guide/mac-help/mh40616). Solo hay que hacerlo una vez.

## 4. Importar tus CV

1. En la bienvenida pulsa **Import my CVs** (o **Import CVs** arriba a la derecha) y elige varios archivos `.docx`, `.pdf` o `.pages`.
2. **Files**: revisa el texto extraído de cada documento; puedes corregirlo con **Correct text**.
   - PDF escaneado (sin texto): **Recognise text on this Mac** lo lee con OCR local (francés e inglés). Revisa nombres, fechas y acentos.
   - Pages: Atelier usa la vista previa del documento o un lector experimental (márcalo y revísalo). Si no puede leerlo, **Convert with Pages** pide a Pages que lo exporte a Word (macOS te pedirá permiso), o sigue las instrucciones para exportarlo tú y adjuntar el `.docx`.
3. **Review**: cuando un mismo dato aparece con valores distintos en varios documentos (p. ej. la fecha de inicio), elige el correcto o **Keep separate**. Nunca se fusiona nada sin tu elección. Desmarca lo que no quieras guardar.
4. **Save to library**. Por defecto cada documento también se convierte en un CV editable (**Also create an editable CV from each document**). Los originales se guardan sin modificar.

En **Library › Experience** puedes añadir y editar registros a mano (experiencias, formación, competencias, idiomas, certificaciones, proyectos, perfiles, datos personales, secciones propias). Cada valor recuerda de qué documento procede. **Library actions › Check for duplicates with AI** solo se ejecuta si lo pides.

## 5. Conectar una IA (opcional)

**Settings (⌘,) › AI connections**. La IA solo actúa cuando pulsas un botón; nunca mientras escribes. Si falla, no se prueba otro proveedor ni otra modalidad de pago.

- **ChatGPT — Continue with ChatGPT**: inicia sesión en el navegador y usa tu plan de ChatGPT si tu cuenta es elegible (sin clave de API). *Esta conexión no se ha podido verificar contra el servicio real durante el desarrollo* (ver `docs/TEST-REPORT.md`).
- **Claude**: con una clave de API de Anthropic, facturada aparte en tu cuenta de Anthropic. Las suscripciones de Claude no pueden usarse desde otras apps.
- **OpenAI API**: con una clave de API, facturada aparte.
- **Local model**: un servidor compatible con OpenAI (Ollama, LM Studio) en tu Mac.

Elige cuál usar en **Use for suggestions**. Las claves y sesiones se guardan cifradas con el llavero de macOS, fuera de los datos y de las copias de seguridad.

## 6. Adaptar un CV a una oferta

1. **Applications › New application**: pega el texto de la oferta, pon un enlace (**Load**) o elige un archivo. Revisa el texto extraído; si un enlace no se puede leer, pega el texto.
2. Elige el **Base CV** y pulsa **Create draft**: se crea una copia; el CV base no cambia.
3. En el editor, **View job** muestra la oferta y tus notas. En el asistente elige **Action** (*Adapt to the job offer*, *Improve wording*, *Translate*, *Find content in my library*, *Comment only*…), el **Scope** (texto seleccionado, sección o CV completo) y mira **Will send** para saber qué se envía.
4. **Get suggestions**. Cada propuesta aparece en **Review changes** con el texto actual y el propuesto, la explicación y la fuente. Puedes **Accept change**, **Reject**, **Edit** o **Try another**; ⌘Z deshace. Si un dato no aparece en tus documentos (p. ej. una tecnología que pide la oferta) tendrás que confirmarlo expresamente: un requisito de la oferta no es una prueba.

También puedes editar todo a mano: selecciona texto para negrita/cursiva o **Rewrite**; **Layout** (plantillas *Classic*, *Sidebar*, *Compact*, mover y ocultar secciones con arrastre o ⌥+flechas), **Style** (tipografías, tamaño, colores, márgenes, espaciado) y **Versions**. Atelier nunca reduce el texto para que quepa: te avisa cuando una sección pasa a otra página.

## 7. Exportar y registrar el envío

1. **Export** (⌘E): elige PDF y/o Word, nombre y carpeta. Solo se exporta el contenido aceptado; las secciones ocultas no salen. Exportar no envía nada.
2. Cuando hayas enviado los archivos tú mismo, pulsa **Mark as sent**: Atelier guarda una copia exacta de esos archivos y bloquea esa versión («Sent v1»). Las ediciones posteriores van a tu borrador; en **Versions** puedes comparar o crear un borrador nuevo desde una versión anterior sin modificarla.
3. En **Applications** mueve la candidatura entre estados (*Preparing, Applied, Interview, Offer, Rejected, Withdrawn*) arrastrando, con el menú «…» o con ⌥+←/→.

## 8. Copia de seguridad y restauración

- **Settings › Storage › Export backup…** crea un único archivo `.atelierbackup` con la biblioteca, CV, versiones, candidaturas, originales y archivos enviados (sin credenciales). Se verifica al crearlo.
- **Restore backup…** lo inspecciona antes de tocar nada. En modo *Add what is missing* nada se sobrescribe salvo lo que elijas en cada diferencia; en *Replace everything* tus datos actuales se conservan como copia de seguridad.
- Atelier guarda automáticamente; si la app se cierra de golpe, al volver ofrece **Recover them** para los cambios no guardados.

## 9. Dónde están tus datos

`~/Library/Application Support/Atelier/` (**Settings › Storage › Show in Finder**). Sin telemetría. Para desinstalar, borra la app y, si quieres, esa carpeta.
