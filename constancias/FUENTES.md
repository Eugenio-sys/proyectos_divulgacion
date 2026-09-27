# Añadir tus propias fuentes

La lista de fuentes puede ampliarse sin editar el código. Se admiten hasta **500 archivos TTF u OTF** en el catálogo y en cada selección de carpeta, con un máximo de **25 MiB por archivo**. Cada variante cuenta como un archivo: regular, negrita y cursiva cuentan como tres.

El selector muestra el nombre de cada fuente y una muestra escrita con ella. Las muestras se preparan automáticamente conforme aparecen al abrir o recorrer el selector; puedes buscar por nombre. No hace falta proporcionar los nombres por separado ni crear imágenes de muestra. Los archivos se descargan conforme se necesitan para mostrar una muestra o aplicar una fuente: no se descargan las 500 al abrir la aplicación.

## Desde la app

Usa el control para cargar fuentes o seleccionar una carpeta. Las fuentes seleccionadas aparecen en el menú; elegir una la aplica al texto seleccionado. La selección de una carpeta permite agregar hasta 500 archivos de una vez.

Estas fuentes pertenecen a la sesión del navegador. Al guardar un diseño, las fuentes personalizadas que utiliza quedan incluidas en el archivo de diseño, de modo que pueden recuperarse al abrirlo de nuevo.

## Copiándolas a la carpeta de la app

1. Copia las fuentes a `fonts/` o `font/`, junto a `index.html`. En tu repositorio, la carpeta es `constancias/fonts/`. Puedes usar hasta dos niveles de subcarpetas dentro de esas carpetas.
2. Guarda los cambios en GitHub y espera a que termine la publicación de Pages.
3. Abre o recarga la app desde cualquier dispositivo. Las fuentes nuevas aparecerán automáticamente en el selector, sin anuncios de «fuente nueva». Si la app ya estaba abierta, también puedes pulsar **Actualizar fuentes de la carpeta**.

El catálogo incluido en esta actualización enumera los 411 archivos TTF/OTF que estaban en tu carpeta de GitHub. Los archivos de fuentes personales permanecen en tu repositorio. El catálogo sirve como respaldo; en tu dirección pública de GitHub Pages, los archivos que añadas después se detectan sin tener que editarlo.

### Catálogo: sirve en cualquier alojamiento estático

Desde la carpeta de la app, ejecuta:

```text
python actualizar_fuentes.py
```

En Windows también puedes usar:

```text
py actualizar_fuentes.py
```

El programa no necesita paquetes adicionales. Crea o actualiza `fonts/manifest.json` con hasta 500 archivos. Sube ese archivo y tus fuentes al sitio. En alojamientos sin detección automática, vuelve a ejecutarlo cada vez que añadas, retires o renombres fuentes. En GitHub Pages público es opcional y permite mantener al día el catálogo de respaldo.

También puedes editar el catálogo manualmente:

```json
{
  "version": 1,
  "fonts": [
    {"file": "fonts/Adelle-Regular.ttf", "label": "Adelle Regular"},
    {"file": "font/Adelle-Bold.otf", "label": "Adelle Negrita"}
  ]
}
```

Las rutas se escriben respecto de `index.html`, con los nombres exactos de los archivos, incluyendo mayúsculas y minúsculas. Usa nombres literales: si un archivo tiene espacios, escribe esos espacios, sin convertirlos a `%20`. Las fuentes deben estar dentro de `font/` o `fonts/`.

### Detección adicional en GitHub Pages

En direcciones `usuario.github.io`, la app consulta además el listado público del repositorio para encontrar fuentes añadidas, aunque el catálogo todavía no las incluya. Admite sitios de usuario u organización, sitios de proyecto y una app situada en una subcarpeta del proyecto.

La consulta usa la **rama predeterminada** del repositorio. Si Pages se publica desde otra rama, desde `docs/` o con un proceso que transforma las rutas, usa el catálogo. También es el método indicado para dominios personalizados, repositorios privados y otros alojamientos. La app no solicita acceso a tu cuenta ni credenciales de GitHub.

El listado y el catálogo se vuelven a consultar en cada apertura; la app ya no espera 30 minutos para buscar cambios. Al regresar a la pestaña o abrir el selector también se busca de nuevo si pasó al menos un minuto desde la revisión anterior. El botón de actualización fuerza otra consulta. Se conserva el último listado únicamente como respaldo cuando falla la conexión o GitHub limita temporalmente las consultas. En ese caso, la app informa del problema real y mantiene las fuentes disponibles.

Se revisan hasta 500 fuentes y 32 carpetas. No se muestran avisos por encontrar fuentes nuevas ni por terminar una búsqueda normal; sí se indican los archivos demasiado grandes, las fuentes incompatibles y los errores de consulta. La publicación de GitHub Pages debe terminar antes de que los nuevos archivos puedan descargarse.

## Si una fuente no aparece o no carga

- Comprueba la extensión: no se admiten archivos ZIP, TTC, WOFF ni WOFF2 como fuentes de los certificados.
- Revisa que el nombre del archivo coincida exactamente con el catálogo y que el archivo esté incluido en la publicación de GitHub Pages.
- Actualiza el listado después de publicar los cambios. La publicación puede tardar unos momentos en estar disponible.
- Si acabas de copiar fuentes en una carpeta local, selecciona esa carpeta desde la app o actualiza el catálogo. Un navegador no puede enumerar libremente los archivos de una carpeta del servidor.
- Si el archivo se encuentra pero la fuente es incompatible o está dañada, prueba otra versión TTF/OTF de esa fuente.
- Las fuentes compuestas exclusivamente de símbolos pueden mostrar esos símbolos en su muestra; no todas contienen letras latinas, tildes o los mismos caracteres.

Los nombres del menú se obtienen del catálogo o del nombre del archivo. Puedes personalizarlos cambiando `label` en `fonts/manifest.json`.

## Dónde se configura el límite

En `src/font-library.js`, la constante compartida `MAX_FONTS` vale `500`. La aplicación la utiliza tanto para el catálogo como para cargar una carpeta. El script opcional `actualizar_fuentes.py` tiene la misma constante `MAX_FONTS = 500`. El límite individual es `MAX_FONT_BYTES = 25 * 1024 * 1024` en JavaScript y `MAX_BYTES = 25 * 1024 * 1024` en Python.
