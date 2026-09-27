# Constancias · Editor visual

Aplicación estática para preparar constancias individuales desde un Excel y una plantilla PDF. Funciona en el navegador: no necesita R, Shiny, MiKTeX ni un servidor que genere los documentos. Los archivos que selecciones se procesan en tu equipo. Las bibliotecas y las fuentes incluidas se sirven con la propia aplicación, sin depender de CDN.

## Probarla

1. Descomprime el paquete completo; conserva su estructura de carpetas.
2. Abre una terminal dentro de la carpeta que contiene `index.html` y ejecuta:

   ```bash
   python -m http.server 8000
   ```

   En Windows también puedes usar `py -m http.server 8000` si ese es el comando de tu instalación de Python.
3. Visita <http://localhost:8000/> en un navegador moderno de escritorio.
4. Carga `examples/plantilla_ejemplo.pdf` y `examples/nombres.xlsx`, o usa tus propios archivos. `examples/nombres_300.xlsx` sirve para probar un lote de 300 registros.

Abrir `index.html` con doble clic no es compatible: los módulos JavaScript y el lector PDF requieren una dirección HTTP o HTTPS. Python solo sirve los archivos para esta prueba local; no es necesario cuando publiques en GitHub Pages.

## Preparar el Excel

La primera fila de la primera hoja debe contener exactamente estos encabezados, en minúsculas y sin espacios:

| Encabezado | Contenido |
|---|---|
| `id` | Identificador de cada constancia. Usa un valor distinto por persona. |
| `name` | Nombre que aparecerá en la constancia. |
| `tallerpuno` | Texto del primer taller. |
| `tallerpdos` | Texto del segundo taller. |

Conserva las cuatro columnas. Si no utilizas un taller, deja sus celdas vacías. Usa formato de texto para identificadores con ceros iniciales. No incluyas filas de títulos antes de los encabezados ni combines celdas de datos.

## Diseñar y revisar

- Selecciona un bloque y arrástralo sobre el PDF. Las guías señalan el centro y el bloque se atrae suavemente hacia él; continúa arrastrando para separarlo.
- Ajusta la fuente, el tamaño, el color, la alineación y el ancho del bloque. Los talleres se distribuyen en líneas dentro de ese ancho.
- Usa las flechas del teclado para afinar la posición del bloque seleccionado. Puedes deshacer y rehacer cambios.
- La revisión de textos largos toma **el texto con más caracteres de cada columna por separado**, igual que la app original. Estos tres textos pueden proceder de personas distintas. Añade **Áj** como prueba de altura para comprobar tildes y descendentes. Esta comprobación no modifica el Excel ni añade esos caracteres a las constancias finales del ZIP. El PDF de prueba descargado en este modo sí conserva **Áj**; para descargar una constancia individual con los datos originales, selecciona la vista **Por persona**.
- Cambia a la vista por registro para comprobar una persona concreta. El texto con más caracteres no siempre es el de mayor ancho tipográfico; revisa también nombres y talleres que puedan ocupar mucho espacio.
- Guarda el diseño en JSON para reutilizar posiciones, tamaños, colores y las fuentes personalizadas utilizadas. El JSON no contiene el Excel ni la plantilla PDF; consérvalos por separado. Si cambias el tamaño de página, las posiciones se adaptan proporcionalmente.
- Descarga primero una constancia de prueba; luego genera el ZIP. La aplicación muestra el avance y permite cancelar la generación.

La plantilla de ejemplo es un fondo neutro de prueba. Sustitúyela por tu diseño definitivo, con sus textos fijos, firmas y logotipos.

## Fuentes, fórmulas y PDF

Se incluyen variantes de DejaVu. Las fuentes Adelle de la aplicación original no venían adjuntas al archivo R: puedes cargar tus archivos `.ttf` o `.otf` para usarlas en este editor.

Para la mayor fidelidad, revisa el diseño después de cargar tus fuentes originales. La composición del navegador puede diferir ligeramente de XeLaTeX. Nombre y talleres conservan controles independientes; el nombre comienza sin división automática de líneas y los talleres con división activada.

Se admiten expresiones matemáticas delimitadas por `$...$` o `$$...$$`, mediante MathJax. Por ejemplo, `Introducción a $x^2+y^2=1$`. Este soporte no equivale a un compilador XeLaTeX: paquetes, comandos de diseño de página y macros personalizadas de LaTeX requieren adaptación.

La exportación conserva como fondo la **primera página del PDF** original. Los textos variables se incorporan como imágenes transparentes de alta resolución, a 288 ppp, para mantener su aspecto entre la vista previa y la descarga. Por ello, esos textos no son seleccionables ni buscables en el PDF. No se modifica el archivo original.

El tiempo y la memoria necesarios para generar un lote dependen del equipo y de la complejidad del fondo. Mantén la pestaña abierta mientras se prepara el ZIP.

El ZIP utiliza los nombres `id_nombre.pdf`, eliminando tildes y caracteres no admitidos del nombre de la persona. El identificador se conserva; si está vacío, se usa solo el nombre. Se detectan identificadores con caracteres inválidos y nombres de archivo repetidos antes de exportar. Los campos `name`, `tallerpuno` y `tallerpdos` se tratan como texto.

El editor acepta archivos XLSX de hasta 30 MB, plantillas PDF de hasta 50 MB, fuentes de hasta 10 MB y listas de hasta 10 000 personas. Esos límites no garantizan que cualquier dispositivo pueda procesar el lote completo: para lotes grandes conviene utilizar un equipo de escritorio.

## Publicar en GitHub Pages

1. Crea un repositorio público, por ejemplo `constancias`.
2. En **Add file → Upload files**, sube el **contenido** de la carpeta de la aplicación, ya descomprimido. Deben quedar `index.html`, `styles.css` y las carpetas `src`, `vendor`, `fonts` y `examples` en la raíz del repositorio. Conserva los archivos JavaScript dentro de `src`. No subas únicamente el ZIP.
3. Confirma la subida con **Commit changes**. Incluye también `.nojekyll`; si no se ha subido, créalo desde **Add file → Create new file**, con ese nombre y una línea vacía.
4. Abre **Settings → Pages**. En **Build and deployment**, selecciona **Deploy from a branch**; elige la rama **main**, carpeta **/(root)**, y pulsa **Save**.
5. Cuando GitHub indique que el sitio está publicado, abre la dirección mostrada; normalmente será `https://TU-USUARIO.github.io/constancias/`.

No necesitas escribir un flujo de GitHub Actions ni ejecutar una compilación. Si ya tienes un sitio, también puedes copiar la aplicación completa a una subcarpeta: las rutas de sus recursos son relativas. Mantén juntas las carpetas y los archivos del paquete.

Para actualizarla, sustituye los archivos modificados en el repositorio y confirma los cambios. El paquete entregado no publica nada automáticamente en tu cuenta.

Referencia: [Configurar la fuente de publicación de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).
