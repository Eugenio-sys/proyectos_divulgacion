# Registro de asistencia con QR — GitHub Pages y Google Sheets

La interfaz se aloja en GitHub Pages. La conexión con Google Sheets funciona mediante un proyecto de Google Apps Script de tu cuenta. El enlace de la base y los nombres de sus tres pestañas se cambian desde **Configuración**, dentro de la aplicación; el cambio se comparte con todos los operadores.

Este paquete contiene la migración de la app R Shiny. La preparación y las pruebas locales no publican el sitio ni modifican tu Google Sheets. La conexión final necesita que crees y autorices el despliegue de Apps Script en tu cuenta.

## Qué contiene el ZIP

| Carpeta o archivo | Destino |
| --- | --- |
| `registro-qr/` | Se sube a tu repositorio de GitHub. Incluye interfaz, lector QR y demostración. |
| `google-apps-script/Code.gs` | Código del servicio: se pega en Google Apps Script. |
| `google-apps-script/Bridge.html` | Puente de conexión: se agrega como archivo HTML de Apps Script. |
| `google-apps-script/appsscript.json` | Configuración del proyecto de Apps Script. |
| `PRUEBAS.md` | Alcance de las comprobaciones y prueba de puesta en marcha. |

## 1. Crear la conexión de Google Apps Script

1. Entra en https://script.google.com/ con la cuenta de Google que tendrá permiso de **Editor** sobre tus bases.
2. Crea un **Nuevo proyecto** y nómbralo, por ejemplo, `Registro QR`.
3. Sustituye el contenido de `Code.gs` por el archivo del paquete.
4. Agrega un archivo **HTML** llamado **Bridge** y pega el contenido de `Bridge.html`.
5. En **Configuración del proyecto**, activa la opción para mostrar el archivo de manifiesto `appsscript.json` en el editor. Abre ese archivo y sustituye su contenido por el del paquete.
6. En **Configuración del proyecto → Propiedades de la secuencia de comandos**, agrega estas tres propiedades:

| Propiedad | Valor |
| --- | --- |
| `ACCESS_CODE` | Un código privado de al menos 16 caracteres para los operadores. |
| `ADMIN_CODE` | Otro código privado distinto, de al menos 16 caracteres, reservado para administrar la base. |
| `ALLOWED_ORIGINS` | `https://eugenio-sys.github.io` |

El origen es el dominio, sin ruta y sin barra final. Si más adelante utilizas un dominio propio, agrega su origen HTTPS separado por coma. Ambos códigos se guardan en las propiedades de Apps Script; no se escriben en archivos de GitHub. Elige códigos difíciles de adivinar y compártelos solamente con las personas que corresponda.

7. Guarda el proyecto. En el editor, selecciona y ejecuta **verificarConfiguracion_**. Autoriza el acceso a Google Sheets cuando Google lo solicite. Como aún no has elegido la base, puede aparecer `CONFIG_REQUIRED`; en este punto es esperado.
8. Selecciona **Implementar → Nueva implementación → Aplicación web**.
9. Configura **Ejecutar como: Yo** y **Quién tiene acceso: Cualquier persona**. La aplicación pide su propio código antes de devolver información o aceptar registros. No debes hacer público el Google Sheets.
10. Implementa y copia la **URL de la aplicación web que termina en `/exec`**.

Si la cuenta institucional no permite la opción «Cualquier persona», esa política impide esta modalidad del puente. La cuenta que despliega debe poder editar el archivo y la pestaña de asistencia; una pestaña protegida también puede impedir el registro aunque la lectura funcione.

## 2. Subir la interfaz a GitHub

1. Abre `registro-qr/config.js` del paquete.
2. Pega la URL del paso anterior entre las comillas de `endpoint`:

```js
export const config = {
  endpoint: 'https://script.google.com/macros/s/TU_DESPLIEGUE/exec',
  title: 'Registro de asistencia',
};
```

La URL de Apps Script se configura una vez. **El enlace del Google Sheets se introduce luego desde la app.**

3. Abre la raíz de tu repositorio `Eugenio-sys/proyectos_divulgacion` en GitHub.
4. Usa **Add file → Upload files** y arrastra la carpeta descomprimida **registro-qr**. Confirma con **Commit changes**.
5. Espera a que termine la publicación de GitHub Pages. La nueva dirección será:

   https://eugenio-sys.github.io/proyectos_divulgacion/registro-qr/

6. Abre la dirección en una pestaña propia del navegador. Si subes una corrección, espera la nueva publicación y recarga con `Ctrl + Shift + R` o `Cmd + Shift + R`.

El lector QR viene incluido en el paquete y no necesita descargarse de un CDN. La cámara exige HTTPS y el permiso del navegador; GitHub Pages proporciona HTTPS. El flash depende de las capacidades de cada cámara.

## 3. Elegir o cambiar la base desde la app

1. Accede como **Administración**, usando `ADMIN_CODE`.
2. Abre **Configuración**.
3. Pega el enlace completo del Google Sheets, por ejemplo `https://docs.google.com/spreadsheets/d/…/edit`.
4. Escribe el nombre del evento y los nombres exactos de las tres pestañas:

   | Función | Nombre en la versión anterior |
   | --- | --- |
   | Preinscritos | `Hoja 2` |
   | Inscritos in situ | `Hoja 0` |
   | Asistencia confirmada | `Hoja 1` |

5. Pulsa **Comprobar conexión**. Se revisan el acceso de lectura, las pestañas y las cabeceras. Esta comprobación no escribe ninguna fila.
6. Pulsa **Guardar configuración**. La app vuelve a validar y guarda la selección para todos los dispositivos.

Cambiar la base no crea pestañas ni copia, traslada o borra asistentes. Los registros siguientes se guardan en el nuevo destino. El cambio no exige volver a publicar GitHub ni Apps Script. Todas las filas de datos no vacías se muestran y cuentan, incluida la primera; no hay excepciones por su posición.

Si un operador tenía una persona abierta mientras cambiaste la base, debe volver a consultar su QR: el servicio rechaza registros asociados a una configuración anterior. Las tablas de otros dispositivos se actualizan al consultar o pulsar **Actualizar datos**; no existe una notificación instantánea a todas las pantallas.

La administración configura enlaces y pestañas existentes. Los formularios de inscripción, la asignación de IDs, la generación de QR y la impresión de gafetes siguen siendo procesos externos.

## 4. Preparar las columnas de Google Sheets

La primera fila de cada pestaña debe contener las cabeceras. Los identificadores deben conservarse como texto, especialmente si tienen ceros iniciales. El ID completo del QR debe coincidir con el ID de la referencia: una columna llamada «id (3 last digits)» no completa por sí sola el prefijo del evento.

| Campo | Encabezados admitidos, entre otros |
| --- | --- |
| ID en referencias | `id`, `id_asignado`, `codigo_qr_asignado`, `id_3_last_digits`, `id (3 last digits)` |
| Nombre | `nombre`, `name`, `full_name` |
| Institución | `institucion`, `institución`, `institution`, `affiliation`, `org` |
| Tipo de participación usado para calcular rol | `attend`, `asiste`, `attendance`, `tipo_asistencia` |
| Participación | `participate`, `participacion`, `participación`, `modalidad`, `actividad`, `activities`, `activity` |
| Correo | `email`, `e-mail`, `correo`, `correo electrónico`, `dirección de correo electrónico` y variantes sin tilde |
| Rol en asistencia | `rol`, `role` |
| Fecha y hora en asistencia | `timestamp`, `fecha_hora`, `datetime`, `fecha`, `hora`, `marca temporal` |
| Procedencia técnica | `source`, `fuente`, `via`, `canal` |

Ambas referencias necesitan una columna de ID. La pestaña de asistencia exige **una única columna `id` y una columna de fecha/hora reconocida**. Los campos adicionales solo se escriben si su encabezado existe. La app no agrega columnas. Una referencia todavía sin personas es válida si ya tiene sus cabeceras.

Una estructura completa y sencilla para la pestaña de asistencia es:

```text
timestamp | id | nombre | institucion | email | rol | attend | participate | source
```

Cada nombre representa una columna distinta; las barras solo separan los nombres en este ejemplo.

## 5. Operación durante el evento

1. Cada operador abre la app y accede con `ACCESS_CODE`.
2. Abre la cámara o escribe el ID/contenido del QR en el campo manual.
3. La app consulta las referencias actuales y muestra la persona encontrada.
4. El operador pulsa **Registrar**. Solo se anuncia éxito cuando el servidor confirma el registro.
5. Pulsa **Siguiente persona** para preparar la siguiente consulta. Si estabas usando la cámara, el botón vuelve a abrirla; si usabas el campo manual o una lista, deja listo el campo de búsqueda.

La cámara se detiene tras detectar un QR. Las imágenes se procesan en el navegador; el servidor recibe el texto del QR. Buscar o escanear no registra asistencia por sí solo.

El puesto de registro muestra estados con texto, icono y color: **Por confirmar**, **Registrado**, **Ya registrado**, **No encontrado** o **Sin confirmar**. La confirmación verde solo aparece tras recibir la respuesta de registro del servidor; un duplicado se distingue y conserva la hora de asistencia existente.

Si la persona no tiene su QR a mano, abre **Pre-registrados** o **In situ**, busca por nombre o correo y pulsa **Consultar** en su fila. La app recupera su ficha por ID y vuelve a comprobarla en el servidor; todavía debes pulsar **Registrar** para confirmar.

El indicador de conexión comunica si el navegador está desconectado y cuándo hubo una respuesta del servicio. Al estar sin conexión, las consultas y registros se deshabilitan. Recuperar la red no envía registros pendientes ni confirma una escritura por su cuenta.

Si se pierde la conexión después de pulsar Registrar, vuelve a buscar el mismo QR. El registro puede haberse completado aunque no llegara su confirmación. El servicio vuelve a comprobar los IDs dentro de un bloqueo antes de insertar, para que los operadores de este mismo servicio no creen dos filas del mismo ID. El bloqueo no coordina escrituras manuales ni otros scripts que añadan filas por su cuenta.

La sesión dura hasta seis horas. Cerrar sesión borra la sesión de esa pestaña. Cambiar `ACCESS_CODE` en Apps Script invalida las sesiones de operadores anteriores; cambiar `ADMIN_CODE` invalida las de administración. No hace falta volver a implementar para cambiar propiedades.

## Reglas que se conservan

- Una asistencia por ID para todo el evento; no distingue jornadas.
- Busca primero en preinscritos y después en inscritos in situ.
- Extrae el ID base de los QR existentes y no verifica la antigua clave adicional.
- Considera equivalentes `-` y `_` en IDs, también al evitar duplicados. Distingue mayúsculas y minúsculas.
- Calcula el rol desde `attend` y, si está vacío, desde `participate`: organizador local, ponente, póster o asistente, con las expresiones en inglés de la versión anterior.
- Guarda fecha y hora de Puerto Rico. En tu procedimiento, esa hora corresponde a la confirmación al recoger el gafete.
- Borrar campos limpia la pantalla; no elimina filas de Google Sheets.

## Demostración independiente

Abre la app con `?demo=1` al final de la dirección y usa el código **demo**, como operador o administrador. Se utilizan personas ficticias y una base simulada del navegador; no se consulta ni modifica Google Sheets. También funciona antes de configurar el endpoint.

Ejemplos para el campo manual:

| Texto | Resultado inicial esperado |
| --- | --- |
| `SIDIM_2026-001_clave` | Preinscrito disponible para registrar. |
| `SIDIM_2026-004_clave` | Persona que ya tiene asistencia. |
| `SIDIM_2026-901_clave` | Inscrito in situ. |
| `SIDIM_2026-999_clave` | ID no encontrado. |

Los cambios de demostración se conservan en ese navegador, separados de los datos reales. Cambiar el enlace ficticio desde Configuración permite probar el cambio de evento. La prueba simulada de conexión no verifica el acceso a un Google Sheets real.

## Actualizaciones del servicio

Si modificas `Code.gs` o `Bridge.html` después de desplegar: **Implementar → Gestionar implementaciones → Editar → Nueva versión → Implementar**. Actualiza la implementación existente para conservar su URL. Cambiar únicamente la base desde Configuración no requiere este proceso.

Si ya instalaste la primera entrega, sustituye `Code.gs` y publica una nueva versión de la implementación existente. Actualiza también los archivos de `registro-qr/` en GitHub, conservando la URL que ya pegaste en `config.js`. Las antiguas propiedades relacionadas con ocultar una fila se ignoran: no es necesario conservarlas. Esta actualización no borra registros del Google Sheets.

## Referencias técnicas

- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Aplicaciones web de Apps Script: https://developers.google.com/apps-script/guides/web
- Comunicación con el servidor: https://developers.google.com/apps-script/guides/html/communication
- Bloqueos entre ejecuciones: https://developers.google.com/apps-script/reference/lock/lock-service
- Cuotas de Apps Script: https://developers.google.com/apps-script/guides/services/quotas
- Referencias de operación para el puesto de registro: https://help.tickettailor.com/en/articles/5151698-how-to-check-in-your-attendees-with-the-check-in-app-at-your-event y https://help.ticketbud.com/hc/en-us/articles/115009771988-App-check-in

La disponibilidad y las cuotas dependen de Google y de la configuración de la cuenta. Esta entrega incluye el código y la guía; la validación del despliegue real y de la cámara física se realiza durante la puesta en marcha descrita en `PRUEBAS.md`.
