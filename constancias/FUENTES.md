# Añadir tus propias fuentes

La lista de fuentes ahora puede ampliarse sin editar el código. Se admiten archivos **TTF y OTF**, hasta **10 MB por archivo**. Conserva los archivos individuales de cada variante: por ejemplo, regular, negrita y cursiva.

## Desde la app

Usa el control para cargar fuentes o seleccionar una carpeta. Las fuentes seleccionadas aparecen en el menú; elegir una la aplica al texto seleccionado. La selección de una carpeta permite cargar varias fuentes de una vez.

Estas fuentes pertenecen a la sesión del navegador. Al guardar un diseño, las fuentes personalizadas que utiliza quedan incluidas en el archivo de diseño, de modo que pueden recuperarse al abrirlo de nuevo.

## Copiándolas a la carpeta de la app

1. Copia las fuentes a `fonts/` o `font/`, junto a `index.html`. Puedes usar hasta dos niveles de subcarpetas dentro de ellas.
2. Actualiza el catálogo con el procedimiento siguiente o, si usas un repositorio público de GitHub Pages, usa la búsqueda automática descrita más abajo.
3. Abre la app y pulsa el botón para actualizar la lista de fuentes.

Las fuentes se cargan cuando se necesitan; encontrar una biblioteca grande no descarga todos los archivos al iniciar la app.

### Catálogo: sirve en cualquier alojamiento estático

Desde la carpeta de la app, ejecuta:

```text
python actualizar_fuentes.py
```

En Windows también puedes usar:

```text
py actualizar_fuentes.py
```

El programa no necesita paquetes adicionales. Crea o actualiza `fonts/manifest.json`. Sube ese archivo y tus fuentes al sitio. Cada vez que añadas, retires o renombres fuentes, vuelve a ejecutarlo.

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

La búsqueda automática se guarda durante 30 minutos en ese navegador. El botón de actualización vuelve a consultar el sitio inmediatamente. Se revisan hasta 200 fuentes y 32 carpetas; se informan los archivos demasiado grandes y los problemas de consulta sin impedir usar las fuentes disponibles. Si GitHub limita las consultas, el catálogo y la selección local de fuentes siguen funcionando.

## Si una fuente no aparece o no carga

- Comprueba la extensión: no se admiten archivos ZIP, TTC, WOFF ni WOFF2 como fuentes de los certificados.
- Revisa que el nombre del archivo coincida exactamente con el catálogo y que el archivo esté incluido en la publicación de GitHub Pages.
- Actualiza el listado después de publicar los cambios. La publicación puede tardar unos momentos en estar disponible.
- Si acabas de copiar fuentes en una carpeta local, selecciona esa carpeta desde la app o actualiza el catálogo. Un navegador no puede enumerar libremente los archivos de una carpeta del servidor.
- Si el archivo se encuentra pero la fuente es incompatible o está dañada, prueba otra versión TTF/OTF de esa fuente.

Los nombres del menú se obtienen del catálogo o del nombre del archivo. Puedes personalizarlos cambiando `label` en `fonts/manifest.json`.
