# Verificación y puesta en marcha

## Qué se verificó antes de la entrega

- Código del servidor ejecutado en un entorno de prueba con servicios de Google simulados: autenticación, permisos de operador y administrador, vencimiento de sesiones, cambio de códigos, reconocimiento de QR y alias, asignación de roles, selección de base, lectura de cabeceras y registro.
- Duplicados: el servicio relee los registros bajo un bloqueo; las pruebas cubren una fila añadida por otro operador, reintentos y la liberación del bloqueo si ocurre un error.
- Cambio de evento: una consulta efectuada antes de cambiar la base no puede registrarse en el destino nuevo con su versión anterior. Validar una configuración no guarda ni elimina filas.
- Puente de comunicación probado en Chromium con un iframe anidado que simula el entorno de Google: verificación de origen, ventana, identificador aleatorio y respuestas. Se comprobaron rechazos de mensajes ajenos y errores de conexión.
- Cámara probada con dispositivos simulados: permisos, selección, cambio de cámara, cancelación, flash, recorte de imagen y lectura única tras el resaltado del QR.
- Interfaz probada en Chromium, en escritorio y a 390 píxeles de ancho: acceso de operador y administración, búsqueda manual, confirmación de asistencia, ID desconocido, duplicados, limpieza de pantalla, filtros, paginación, edición de enlace y pestañas, persistencia y cambio de base compartido entre pestañas.
- Respuestas tardías: una búsqueda antigua no reemplaza la ficha después de limpiar o editar el ID. La interfaz no anuncia éxito antes de recibir confirmación, bloquea pulsaciones repetidas y exige volver a consultar tras un resultado de escritura incierto.
- Capturas revisadas visualmente: configuración, ficha del asistente y tablas, sin desbordamiento horizontal de la página en móvil.
- Integración completa: interfaz, transporte, puente HTML y `Code.gs` reales conectados a servicios de Google simulados. Se verificaron acceso, búsqueda, filtros, registro, validación administrativa sin escritura y cambio a una segunda base con nombres de pestañas distintos.
- Primera fila de datos in situ visible, incluida en el contador y disponible para registrar. La antigua propiedad de ocultación se ignora y ya no aparece en la configuración.
- Flujo de recepción: búsqueda por nombre y apertura de ficha con Consultar sin escribir asistencia; estados Por confirmar, Registrado, Ya registrado, No encontrado y Sin confirmar; botón Siguiente persona y hora del registro existente.
- Pérdida de conexión: consultas y registros bloqueados mientras el navegador está sin red, sin confirmar resultados por adelantado ni enviar operaciones pendientes al reconectar. Se conserva el aviso de escritura incierta.

Estas pruebas no usaron tu cuenta de servicio, no consultaron tu Google Sheets y no agregaron asistencias reales. La demostración utiliza datos ficticios.

## Prueba inicial después de publicar

1. Crea un Google Sheets de prueba o una copia de la base, con las tres pestañas y sus cabeceras. Utiliza un par de personas ficticias con IDs distintos, una preinscrita y otra in situ.
2. Después de implementar Apps Script y subir la interfaz, accede como administrador. Pega el enlace de la base de prueba y sus nombres de pestañas. Comprueba que también aparece la primera persona de cada lista.
3. Comprueba y guarda la configuración. Verifica los contadores y las tres tablas.
4. Busca un ID manualmente y pulsa Registrar. Confirma en el Google Sheets de prueba que apareció una sola fila con la fecha y hora de Puerto Rico.
5. Repite la consulta del mismo ID. Debe aparecer como Ya registrado, con su hora, y no agregarse otra fila. Pulsa Siguiente persona y confirma que queda lista otra consulta.
6. Abre la aplicación en dos dispositivos. Consulta el otro ID en ambos y registra desde los dos: el primero debe registrar y el segundo informar que ya estaba registrado. Comprueba que hay una única fila.
7. En un teléfono, permite la cámara y escanea un QR impreso. Comprueba la cámara trasera, la detención automática y el flash si ese dispositivo lo permite. Repite con los navegadores que se usarán durante el evento.
8. Prueba un ID que no exista: no debe permitir registrarlo. Limpia la pantalla y confirma que no se eliminaron datos de la hoja.
9. Con una persona todavía abierta en otro dispositivo, guarda otra base de prueba desde Administración. El dispositivo anterior debe pedir una nueva consulta antes de registrar; no debe insertar a la persona en la base nueva utilizando la consulta anterior.
10. Busca una persona por nombre o correo en Pre-registrados o In situ y pulsa Consultar. Debe abrir su ficha sin registrar todavía la asistencia.
11. Desconecta temporalmente la red en un dispositivo. Debe mostrarse Sin conexión y deshabilitarse la consulta y el registro. Recuperar la red no debe escribir asistencia automáticamente.
12. Finalizada la prueba, configura el enlace del evento real y verifica sus contadores. La prueba no borra datos: las filas ficticias permanecen en las bases de prueba que creaste.

## Alcance pendiente de validación real

El despliegue de Apps Script requiere autorización de tu cuenta y puede estar sujeto a políticas institucionales. El permiso de escritura y las protecciones de la pestaña de asistencia solo se comprueban de forma definitiva al registrar en la base de prueba. El comportamiento de la cámara, el flash y la conexión con Google depende del teléfono y del navegador; las pruebas locales con simulaciones no sustituyen esa comprobación.

La página de GitHub debe abrirse en una pestaña propia. El puente usa Google Apps Script y puede verse afectado por bloqueos del navegador a contenido de Google. Si no conecta, revisa la URL `/exec`, el acceso del despliegue, `ALLOWED_ORIGINS` y que la cuenta propietaria haya autorizado los permisos.

LockService coordina los registros hechos por este mismo proyecto de Apps Script. No bloquea ediciones manuales ni escrituras de otros programas. La aplicación conserva una asistencia por ID para todo el evento, sin distinguir días.
