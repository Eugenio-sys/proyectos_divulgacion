# Bibliotecas y fuentes incluidas

Los recursos se sirven desde este mismo sitio. La aplicación no carga bibliotecas de un CDN ni envía Excel, PDF o fuentes a un servicio externo.

| Recurso | Versión | Fuente | Licencia incluida |
|---|---|---|---|
| PDF-LIB | 1.17.1 | https://pdf-lib.js.org/ | vendor/licenses/pdf-lib.txt |
| @pdf-lib/fontkit | 1.1.1 | https://github.com/Hopding/fontkit | vendor/licenses/fontkit.txt |
| JSZip | 3.10.1 | https://stuk.github.io/jszip/ | vendor/licenses/jszip.txt |
| PDF.js | 5.6.205 | https://mozilla.github.io/pdf.js/ | vendor/licenses/pdfjs.txt |
| MathJax | 4.1.3 | https://docs.mathjax.org/en/v4.1/ | vendor/licenses/mathjax.txt |
| Fuentes MathJax NewCM, dsfont, bbm y contornos RSFS de MathJax TeX | 4.1.3 | https://www.npmjs.com/org/mathjax | vendor/licenses/mathjax-fonts.txt; licencia original NewCM en vendor/licenses/newcomputermodern-upstream.txt |
| Contornos de integrales esint10 Type1 | Distribución TeX Live del sistema | https://ctan.org/pkg/esint-type1 | vendor/licenses/esint-type1.txt |
| Contornos Dingbats de PDFium | Incluidos en PDF.js 5.6.205 | https://pdfium.googlesource.com/pdfium/ | vendor/licenses/dingbats.txt |
| DejaVu | Archivos de la distribución del sistema | https://dejavu-fonts.github.io/ | fonts/LICENSE.txt |

PDF.js incluye recursos adicionales en `vendor/standard_fonts` y `vendor/wasm`, con sus archivos de licencia. Los archivos de ejemplo contienen nombres ficticios.

La carga de una fuente personal no la publica en GitHub: se conserva en la memoria de esa pestaña. Al guardar un diseño, sus fuentes personalizadas utilizadas se incluyen en el JSON descargado. Para publicar otros archivos de fuentes dentro de un repositorio, comprueba que su licencia permita redistribuirlos.

Los contornos matemáticos de `vendor/mathjax/constancias-font-data.js` derivan de los recursos acreditados arriba. El bloque RSFS contiene las 26 mayúsculas Script de MathJax TeX; el bloque esint conserva las dos tallas originales de cada operador; Dingbats conserva los 202 códigos definidos de la codificación original. El archivo no contiene imágenes rasterizadas.
