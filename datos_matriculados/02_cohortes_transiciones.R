# Cohortes y transiciones UPR | Etapa 2 | Version 2.0 | 15 de octubre de 2026
# Guardar junto al nuevo 01_diagnostico_matricula.R en datos_matriculados.
# Abrir el archivo guardado en RStudio y pulsar Source.
# Requiere un diagnostico COMPLETO v2 y sus RDS; no relee los CSV originales.
# install.packages(c("data.table", "this.path"))  # solo si faltan
# La seleccion de periodos es exactamente la auditada en 01, verificada contra cada RDS.
# No reutiliza checkpoints ni paneles de ejecuciones anteriores.
# CSV/TXT agregados para revision; el panel RDS con identificadores queda local.
# Objetivo confirmado: matricula al inicio del ano. ID estable entre anos y recintos.

for (p in c("data.table", "this.path")) {
  if (!requireNamespace(p, quietly = TRUE)) stop("Falta instalar el paquete: ", p, call. = FALSE)
}
suppressPackageStartupMessages(library(data.table))
raiz <- normalizePath(this.path::this.dir(), winslash = "/", mustWork = TRUE)
version_etapa2 <- "2.0"
carpeta_diagnostico <- NULL  # NULL = ultimo diagnostico COMPLETO v2
ultimo_anio_calibracion <- 2025L  # curso 2025-2026
ventana_transiciones <- 5L
identificador_estable_confirmado <- TRUE  # confirmado por el usuario


limpiar <- function(x) trimws(gsub("[[:space:]]+", " ", as.character(x)))
clave <- function(x) tolower(gsub("[^[:alnum:]]", "", iconv(limpiar(x), to = "ASCII//TRANSLIT", sub = "")))
vacio <- function(x) is.na(x) | limpiar(x) == "" | clave(x) %in% c("notdefined", "sindefinir", "na", "null")
normalizar_anio <- function(x) {
  x <- limpiar(x); a <- suppressWarnings(as.integer(substr(x, 1, 4)))
  b <- suppressWarnings(as.integer(sub("^[0-9]{4}-", "", x)))
  corto <- !is.na(x) & grepl("^[0-9]{4}-[0-9]{2}$", x)
  b[corto] <- a[corto] %/% 100L * 100L + b[corto]
  cambio_siglo <- corto & !is.na(a) & !is.na(b) & b < a
  b[cambio_siglo] <- b[cambio_siglo] + 100L
  ok <- !is.na(x) & grepl("^[0-9]{4}-([0-9]{2}|[0-9]{4})$", x) & !is.na(a) & !is.na(b) & b == a + 1L
  out <- rep(NA_integer_, length(x)); out[ok] <- a[ok]; out
}
unico_texto <- function(x, ambiguo) {
  x <- unique(limpiar(x[!vacio(x)]))
  if (length(x) == 1L) x else if (!length(x)) NA_character_ else ambiguo
}
unico_numero <- function(x) { x <- unique(x[!is.na(x)]); if (length(x) == 1L) x else NA_integer_ }
pegar <- function(x) paste(sort(unique(x[!is.na(x)])), collapse = " | ")
fwrite_seguro <- function(x, nombre, destino) {
  if (ncol(x)) fwrite(x, file.path(destino, nombre), bom = TRUE, na = "")
}


# Entrada de etapa 2: leer exclusivamente un diagnostico COMPLETO v2.
# Requiere data.table. No guarda paneles ni reutiliza checkpoints.

e2_exigir <- function(ok, texto) {
  if (!isTRUE(ok)) stop(texto, call. = FALSE)
}
e2_columnas <- function(x, cols, origen) {
  faltan <- setdiff(cols, names(x))
  e2_exigir(!length(faltan), paste0(origen, ": faltan columnas ", paste(faltan, collapse = ", ")))
}
e2_booleano <- function(x, origen) {
  y <- as.character(x)
  e2_exigir(!anyNA(y) && all(y %in% c("TRUE", "FALSE")), paste0(origen, ": indicador logico invalido."))
  y == "TRUE"
}
e2_conteo <- function(x, origen) {
  y <- suppressWarnings(as.numeric(x))
  e2_exigir(!anyNA(y) && all(is.finite(y) & y >= 0 & y == floor(y)),
    paste0(origen, ": conteo invalido."))
  y
}
e2_vacio <- function(x) {
  y <- trimws(as.character(x))
  k <- tolower(gsub("[^[:alnum:]]", "", iconv(y, to = "ASCII//TRANSLIT", sub = "")))
  is.na(y) | y == "" | k %in% c("notdefined", "sindefinir", "na", "null")
}
e2_pegar <- function(x) {
  # Replica pegar(etiqueta()) del 01 para auditar, sin reclasificar periodos.
  y <- trimws(gsub("[[:space:]]+", " ", as.character(x)))
  y[e2_vacio(y)] <- "Sin definir"
  paste(sort(unique(y)), collapse = " | ")
}

elegir_diagnostico_v2 <- function(raiz, carpeta_diagnostico = NULL) {
  if (!is.null(carpeta_diagnostico)) {
    e2_exigir(length(carpeta_diagnostico) == 1L && dir.exists(carpeta_diagnostico),
      "La carpeta de diagnostico indicada no existe.")
    return(normalizePath(carpeta_diagnostico, winslash = "/", mustWork = TRUE))
  }
  ds <- list.dirs(file.path(raiz, "resultados"), recursive = FALSE, full.names = TRUE)
  ds <- sort(ds[grepl("^diagnostico_", basename(ds))], decreasing = TRUE)
  es_v2_completo <- vapply(ds, function(d) {
    if (!file.exists(file.path(d, "COMPLETO.txt")) ||
        !file.exists(file.path(d, "17_estado_ejecucion.csv"))) return(FALSE)
    z <- tryCatch(data.table::fread(file.path(d, "17_estado_ejecucion.csv")), error = function(e) NULL)
    !is.null(z) && nrow(z) == 1L && "version" %in% names(z) &&
      grepl("^2([.]|$)", as.character(z$version))
  }, logical(1))
  e2_exigir(any(es_v2_completo),
    "No encontre un diagnostico COMPLETO de version 2. Ejecuta el nuevo 01 con guardar_microdatos = TRUE.")
  k <- which(es_v2_completo)[1L]
  if (k > 1L) warning("Hay diagnosticos posteriores que no son COMPLETOS v2: ",
    paste(basename(ds[seq_len(k - 1L)]), collapse = ", "),
    ". Se utilizara el ultimo COMPLETO v2; esas ejecuciones posteriores deben revisarse.", call. = FALSE)
  normalizePath(ds[k], winslash = "/", mustWork = TRUE)
}

cargar_entrada_etapa2 <- function(raiz, carpeta_diagnostico = NULL) {
  if (!requireNamespace("data.table", quietly = TRUE)) stop("Falta instalar data.table.", call. = FALSE)
  # := y las consultas de data.table tambien se usan en el resto del 02.
  suppressPackageStartupMessages(library(data.table))
  diagnostico <- elegir_diagnostico_v2(raiz, carpeta_diagnostico)
  requeridos <- c("COMPLETO.txt", "01_inventario_archivos.csv", "02_cobertura_recinto_anio.csv",
    "03_variables_por_archivo.csv", "08_calidad_por_archivo.csv", "13_seleccion_periodos.csv", "14_cobertura_calendarios.csv",
    "15_personas_por_recinto_anio.csv", "17_estado_ejecucion.csv", "18_configuracion_diagnostico.csv")
  e2_exigir(all(file.exists(file.path(diagnostico, requeridos))),
    "El diagnostico no contiene todos los controles de la version 2.")
  leer <- function(f) {
    ruta <- file.path(diagnostico, f)
    ns <- names(fread(ruta, nrows = 0L, showProgress = FALSE, check.names = FALSE))
    texto <- intersect(ns, c("version", "archivo", "codigo_sesion", "anio", "anio_carpeta",
      "anio_efectivo", "anios_contenido", "recinto", "recinto_efectivo", "recintos_contenido",
      "numeros_periodo", "sesiones"))
    fread(ruta, na.strings = c(""), colClasses = if (length(texto)) list(character = texto) else NULL,
      showProgress = FALSE, check.names = FALSE)
  }
  estado <- leer("17_estado_ejecucion.csv")
  e2_columnas(estado, c("version", "procesamiento_completo", "archivos_encontrados", "archivos_reconstruidos",
    "archivos_con_error", "archivos_con_problema_estructural", "combinaciones_faltantes",
    "combinaciones_duplicadas", "combinaciones_fuera_de_cobertura", "rds_guardados",
    "registros_todos_periodos", "registros_inicio_candidato", "filas_persona_recinto_anio_inicio",
    "periodos_bloqueados"), "17_estado_ejecucion")
  e2_exigir(nrow(estado) == 1L && grepl("^2([.]|$)", as.character(estado$version)),
    "El diagnostico no tiene un estado unico de version 2.")
  e2_exigir(e2_booleano(estado$procesamiento_completo, "17/procesamiento_completo"),
    "El diagnostico esta marcado como incompleto, aunque exista COMPLETO.txt.")
  ceros <- c("archivos_con_error", "archivos_con_problema_estructural", "combinaciones_faltantes",
    "combinaciones_duplicadas", "combinaciones_fuera_de_cobertura", "periodos_bloqueados")
  for (col in ceros) e2_exigir(all(e2_conteo(estado[[col]], paste0("17/", col)) == 0),
    paste0("El diagnostico tiene incidencias pendientes en ", col, "."))

  inv <- leer("01_inventario_archivos.csv")
  cobertura <- leer("02_cobertura_recinto_anio.csv")
  variables <- leer("03_variables_por_archivo.csv")
  calidad <- leer("08_calidad_por_archivo.csv")
  seleccion <- leer("13_seleccion_periodos.csv")
  personasEsperadas <- leer("15_personas_por_recinto_anio.csv")
  configuracion <- leer("18_configuracion_diagnostico.csv")
  e2_columnas(inv, c("archivo_id", "archivo", "anio_carpeta", "estado", "recinto_efectivo",
    "anio_efectivo", "rds_guardado", "ruta_rds_relativa"), "01_inventario")
  e2_columnas(calidad, c("archivo_id", "registros", "campos_exportados", "anios_contenido", "recintos_contenido",
    "registros_anio_discordante", "registros_recinto_sin_homologar", "registros_campos_nucleares_vacios",
    "duplicados_persona_periodo", "problema_estructural", "periodos_ambiguos", "periodos_sin_identificar"), "08_calidad")
  e2_exigir(nrow(inv) > 0L && !anyNA(inv$archivo_id) && !anyDuplicated(inv$archivo_id) &&
    nrow(calidad) == nrow(inv) && !anyDuplicated(calidad$archivo_id) &&
    setequal(inv$archivo_id, calidad$archivo_id), "Inventario y calidad no identifican los mismos archivos una sola vez.")
  n <- nrow(inv)
  e2_exigir(all(inv$estado == "Estructura reconstruida") && all(e2_booleano(inv$rds_guardado, "01/rds_guardado")),
    "Hay archivos no reconstruidos o sin RDS guardado.")
  for (col in c("archivos_encontrados", "archivos_reconstruidos", "rds_guardados"))
    e2_exigir(e2_conteo(estado[[col]], paste0("17/", col)) == n, "17 no concilia el numero de archivos.")
  for (col in c("registros_anio_discordante", "registros_recinto_sin_homologar", "registros_campos_nucleares_vacios",
    "duplicados_persona_periodo", "periodos_ambiguos", "periodos_sin_identificar"))
    e2_exigir(all(e2_conteo(calidad[[col]], paste0("08/", col)) == 0), paste0("08 tiene incidencias en ", col, "."))
  e2_exigir(!any(e2_booleano(calidad$problema_estructural, "08/problema_estructural")), "08 tiene problemas estructurales.")
  e2_exigir(!any(e2_vacio(inv$recinto_efectivo)) && !any(e2_vacio(inv$anio_efectivo)) &&
    !any(grepl("[|]", inv$recinto_efectivo)) && all(inv$anio_efectivo == inv$anio_carpeta) &&
    !anyDuplicated(inv[, .(recinto_efectivo, anio_efectivo)]), "La cobertura del contenido es ambigua o duplicada.")
  q <- calidad[match(inv$archivo_id, calidad$archivo_id)]
  e2_exigir(identical(as.character(inv$anio_efectivo), as.character(q$anios_contenido)) &&
    identical(as.character(inv$recinto_efectivo), as.character(q$recintos_contenido)), "01 y 08 discrepan en recinto o ano del contenido.")
  e2_columnas(cobertura, c("anio_carpeta", "recinto_archivo", "n_archivos", "archivos_con_error_estructural", "esperado"), "02_cobertura")
  e2_exigir(nrow(cobertura) == n && !anyDuplicated(cobertura[, .(anio_carpeta, recinto_archivo)]) &&
    all(e2_booleano(cobertura$esperado, "02/esperado")) &&
    all(e2_conteo(cobertura$n_archivos, "02/n_archivos") == 1) &&
    all(e2_conteo(cobertura$archivos_con_error_estructural, "02/errores") == 0), "02 no certifica cobertura unica completa.")
  ck <- function(a, r) paste(a, r, sep = "\r")
  e2_exigir(setequal(ck(inv$anio_efectivo, inv$recinto_efectivo), ck(cobertura$anio_carpeta, cobertura$recinto_archivo)),
    "La cobertura 02 no coincide con el inventario por contenido.")
  e2_columnas(configuracion, c("parametro", "valor"), "18_configuracion")
  e2_exigir(!anyDuplicated(configuracion$parametro), "18 tiene parametros repetidos.")
  cfg <- function(p) {
    z <- configuracion[parametro == p, valor]
    e2_exigir(length(z) == 1L && !e2_vacio(z), paste0("18 no define ", p, ".")); as.character(z)
  }
  anos <- strsplit(cfg("anios_inicio"), ",", fixed = TRUE)[[1L]]
  recintos <- strsplit(cfg("recintos_esperados"), ",", fixed = TRUE)[[1L]]
  anos <- suppressWarnings(as.integer(anos))
  e2_exigir(!anyNA(anos) && !anyDuplicated(anos) && !anyDuplicated(recintos), "18 contiene cobertura invalida.")
  previstas <- CJ(anio = paste0(anos, "-", anos + 1L), recinto = recintos)
  e2_exigir(nrow(previstas) == n && setequal(ck(previstas$anio, previstas$recinto),
    ck(inv$anio_efectivo, inv$recinto_efectivo)), "La cobertura no concilia con la configuracion del 01.")
  e2_exigir(cfg("guardar_microdatos") == "TRUE", "El 01 no fue configurado para guardar los microdatos completos.")

  e2_columnas(variables, c("archivo_id", "ColumnName", "N", "presente_en_todos"), "03_variables")
  e2_exigir(setequal(variables$archivo_id, inv$archivo_id) &&
    !anyDuplicated(variables[, .(archivo_id, ColumnName)]) &&
    all(e2_booleano(variables$presente_en_todos, "03/presente_en_todos")), "03 tiene variables ausentes o duplicadas.")
  obligatorias <- c("Location", "Academic Year", "Academic Session", "Academic Session Code",
    "Degree Level", "Classification", "Registration Type", "Identifier")
  for (i in seq_len(n)) {
    z <- variables[archivo_id == inv$archivo_id[i]]
    e2_exigir(nrow(z) == q$campos_exportados[i] && all(obligatorias %in% z$ColumnName) &&
      all(e2_conteo(z$N, "03/N") == q$registros[i]), paste0("03 no concilia estructura y registros del archivo ", inv$archivo[i]))
  }
  e2_columnas(seleccion, c("archivo_id", "anio", "recinto", "codigo_sesion", "sesiones", "numeros_periodo",
    "calendario", "registros", "personas", "ambiguo", "seleccionado", "registros_seleccionados"), "13_seleccion")
  e2_exigir(setequal(seleccion$archivo_id, inv$archivo_id) &&
    !anyDuplicated(seleccion[, .(archivo_id, codigo_sesion)]) && !any(e2_vacio(seleccion$codigo_sesion)), "13 tiene codigos repetidos o archivos faltantes.")
  seleccion[, `:=`(seleccionado = e2_booleano(seleccionado, "13/seleccionado"), ambiguo = e2_booleano(ambiguo, "13/ambiguo"))]
  e2_exigir(!any(seleccion$ambiguo) && !any(e2_vacio(seleccion$calendario)) &&
    !any(seleccion$calendario == "Sin identificar"), "13 contiene periodos ambiguos o sin identificar.")
  e2_exigir(all(e2_conteo(seleccion$registros_seleccionados, "13/seleccionados") ==
    ifelse(seleccion$seleccionado, e2_conteo(seleccion$registros, "13/registros"), 0)), "13 no concilia seleccion con registros.")
  e2_exigir(!anyDuplicated(seleccion[seleccionado == TRUE, .(archivo_id, calendario)]), "13 contiene dos inicios del mismo calendario.")
  e2_columnas(personasEsperadas, c("archivo_id", "anio", "recinto", "registros_todos_periodos", "personas_todos_periodos",
    "sin_id_todos_periodos", "periodos_todos", "registros_inicio_candidato", "personas_inicio_candidato",
    "sin_id_inicio_candidato", "registros_repetidos_inicio_candidato", "periodos_inicio_candidato"), "15_personas")
  e2_exigir(nrow(personasEsperadas) == n && !anyDuplicated(personasEsperadas$archivo_id) &&
    setequal(personasEsperadas$archivo_id, inv$archivo_id), "15 no contiene un resumen por archivo.")
  e2_exigir(all(e2_conteo(personasEsperadas$sin_id_todos_periodos, "15/sin_id") == 0) &&
    all(e2_conteo(personasEsperadas$sin_id_inicio_candidato, "15/sin_id_inicio") == 0), "15 contiene identificadores vacios.")

  relativas <- as.character(inv$ruta_rds_relativa)
  e2_exigir(!any(e2_vacio(relativas)) && !any(grepl("(^[/\\\\]|^[A-Za-z]:|(^|[/\\\\])[.][.]([/\\\\]|$))", relativas)),
    "El inventario contiene una ruta RDS que no es relativa al diagnostico.")
  rutas <- file.path(diagnostico, gsub("\\\\", "/", relativas))
  e2_exigir(all(file.exists(rutas)), "Faltan RDS declarados en el inventario; no se buscara un sustituto.")
  rutas <- normalizePath(rutas, winslash = "/", mustWork = TRUE)
  e2_exigir(!anyDuplicated(rutas) && all(startsWith(rutas, paste0(diagnostico, "/bases_limpias/"))),
    "Las rutas RDS se repiten o apuntan fuera de bases_limpias.")
  necesarios <- c("id", "archivo_id", "archivo", "anio", "recinto", "sesion", "codigo_sesion", "numero_periodo",
    "nivel", "clasificacion", "tipo_ingreso", "cohorte", "cohorte_nivel", "sexo", "calendario",
    "periodo_inicio_candidato", "periodo_ambiguo", "cohorte_inicio", "anio_inicio", "clasificacion_escolar",
    "clasificacion_no_grado", "primer_anio", "admision_anio", "primero_inicio", "admision_inicio")
  seleccionados <- vector("list", n)
  for (i in seq_len(n)) {
    aid <- inv$archivo_id[i]
    message(sprintf("[%d/%d] Verificando RDS: %s", i, n, inv$archivo[i]))
    x <- as.data.table(readRDS(rutas[i]))
    e2_columnas(x, necesarios, inv$archivo[i])
    e2_exigir(nrow(x) == q$registros[i] && all(x$archivo_id == aid) && all(x$archivo == inv$archivo[i]) &&
      !any(e2_vacio(x$id)) && !any(e2_vacio(x$codigo_sesion)) &&
      !anyDuplicated(x[, .(id, codigo_sesion)]), "El RDS no concilia archivos, registros o identificadores.")
    e2_exigir(!anyNA(x$anio) && !anyNA(x$recinto) && all(x$anio == inv$anio_efectivo[i]) &&
      all(x$recinto == inv$recinto_efectivo[i]) &&
      !anyNA(x$anio_inicio) && all(x$anio_inicio == as.integer(substr(inv$anio_efectivo[i], 1L, 4L))),
      "El RDS discrepa en recinto o ano del contenido.")
    au <- seleccion[archivo_id == aid]
    cr <- x[, .(registros = .N, personas = uniqueN(id), sesiones = e2_pegar(sesion), numeros_periodo = e2_pegar(numero_periodo)), by = codigo_sesion]
    e2_exigir(setequal(cr$codigo_sesion, au$codigo_sesion), "Los codigos del RDS discrepan de 13.")
    cr <- cr[match(au$codigo_sesion, cr$codigo_sesion)]
    e2_exigir(all(cr$registros == au$registros) && all(cr$personas == au$personas) &&
      all(cr$sesiones == au$sesiones) && all(cr$numeros_periodo == ifelse(is.na(au$numeros_periodo), "", au$numeros_periodo)) &&
      all(au$anio == inv$anio_efectivo[i]) && all(au$recinto == inv$recinto_efectivo[i]), "El RDS no reproduce la auditoria completa de periodos del 13.")
    j <- match(x$codigo_sesion, au$codigo_sesion)
    e2_exigir(all(e2_booleano(x$periodo_inicio_candidato, "RDS/inicio") == au$seleccionado[j]) &&
      all(e2_booleano(x$periodo_ambiguo, "RDS/ambiguo") == au$ambiguo[j]) &&
      !anyNA(x$calendario) && all(x$calendario == au$calendario[j]), "Las decisiones guardadas en el RDS discrepan del selector aprobado en 13.")
    p <- personasEsperadas[archivo_id == aid]
    si <- au$seleccionado[j]
    valores <- c(registros_todos_periodos = nrow(x), personas_todos_periodos = uniqueN(x$id),
      periodos_todos = uniqueN(x$codigo_sesion), registros_inicio_candidato = sum(si),
      personas_inicio_candidato = uniqueN(x$id[si]), registros_repetidos_inicio_candidato = sum(si) - uniqueN(x$id[si]),
      periodos_inicio_candidato = uniqueN(x$codigo_sesion[si]))
    e2_exigir(all(p$anio == inv$anio_efectivo[i]) && all(p$recinto == inv$recinto_efectivo[i]), "15 discrepa en recinto o ano.")
    for (col in names(valores)) e2_exigir(e2_conteo(p[[col]], paste0("15/", col)) == valores[[col]],
      paste0("El RDS no concilia ", col, " con 15."))
    e2_exigir(sum(si) > 0L, paste0("No existe un periodo inicial/anual seleccionado para ", inv$archivo[i], "."))
    x <- x[si, ..necesarios]
    x[, seleccionado := TRUE]
    seleccionados[[i]] <- x
  }
  datos <- rbindlist(seleccionados, use.names = TRUE)
  e2_exigir(sum(q$registros) == estado$registros_todos_periodos &&
    nrow(datos) == estado$registros_inicio_candidato &&
    nrow(unique(datos[, .(id, recinto, anio)])) == estado$filas_persona_recinto_anio_inicio &&
    sum(personasEsperadas$personas_inicio_candidato) == estado$filas_persona_recinto_anio_inicio,
    "Los RDS y la union inicial no concilian los totales certificados en 17.")
  message("RDS y seleccion de la etapa 1 verificados: ", nrow(datos), " registros de inicio/anuales.")
  list(diagnostico = diagnostico, inv = inv, calidad = calidad, seleccion = seleccion,
    auditoria = copy(seleccion), personasEsperadas = personasEsperadas, estado = estado,
    configuracion = configuracion, cobertura = cobertura, rutas = rutas, datos = datos)
}

# Componentes conservadores: no se infiere un grado desde la clasificacion.
preparar_componentes <- function(datos) {
  x <- copy(as.data.table(datos))
  for (v in c("anio_inicio", "cohorte_inicio", "primero_inicio", "admision_inicio"))
    set(x, j = v, value = suppressWarnings(as.integer(x[[v]])))
  if (anyNA(x$anio_inicio)) stop("Hay anos de observacion invalidos.")
  ck <- clave(x$clasificacion)
  x[, escolar := grepl("escuelasuperior|highschool", ck)]
  x[, nivel_SS_revisar := clave(nivel) == "ss"]
  x[, clasificacion_no_grado := escolar | grepl(
    "certificadopost|educacioncontinuada|estudiantesnogrado|estudiantestransitorios|permisoespecial|mejoramiento|especialgraduado|transitoriosgraduado", ck)]
  x[, componente := fcase(
    escolar, "Escolar",
    nivel %in% c("Bach", "Asoc") & !clasificacion_no_grado, "Subgrado",
    nivel == "Undergraduate Semester Calendar" & !clasificacion_no_grado, "Subgrado_generico",
    nivel %in% c("Master", "Doctor", "Juris", "Odonto", "Master Semester Calendar") & !clasificacion_no_grado, "Posgrado",
    default = "Otros")]
  x[, es_nuevo_secundaria := componente == "Subgrado" & clave(tipo_ingreso) == "deescuelasecundaria"]
  x[, `:=`(cohorte_futura = !is.na(cohorte_inicio) & cohorte_inicio > anio_inicio,
    admision_futura = !is.na(admision_inicio) & admision_inicio > anio_inicio,
    primera_matricula_futura = !is.na(primero_inicio) & primero_inicio > anio_inicio)]
  x[]
}

construir_panel_rapido <- function(datos) {
  datos <- copy(as.data.table(datos))
  textos <- c("nivel", "componente", "clasificacion", "tipo_ingreso", "sexo", "cohorte_nivel")
  for (col in textos) {
    v <- limpiar(datos[[col]]); v[vacio(v)] <- NA_character_
    set(datos, j = col, value = v)
  }
  datos[, .duplicado_union := duplicated(.SD) | duplicated(.SD, fromLast = TRUE),
    .SDcols = c("id", "recinto", "anio_inicio")]
  unicos <- datos[.duplicado_union == FALSE, .(
    id, recinto, anio_inicio, anio, calendarios = calendario,
    n_calendarios = 1L, n_registros_censo = 1L, nivel, componente,
    clasificacion, tipo_ingreso, sexo,
    n_cohortes_censo = as.integer(!is.na(cohorte_inicio)),
    cohorte_conflictiva_censo = FALSE, cohorte_inicio, cohorte_nivel,
    es_nuevo_secundaria, escolar, nivel_SS_revisar,
    cohorte_futura, admision_futura, primera_matricula_futura)]
  multiples <- NULL
  if (any(datos$.duplicado_union)) {
    multiples <- datos[.duplicado_union == TRUE, .(
      anio = anio[1L], calendarios = pegar(calendario), n_calendarios = uniqueN(calendario),
      n_registros_censo = .N, nivel = unico_texto(nivel, "Multiples niveles"),
      componente = unico_texto(componente, "Multiples componentes"),
      clasificacion = unico_texto(clasificacion, "Multiples clasificaciones"),
      tipo_ingreso = unico_texto(tipo_ingreso, "Multiples tipos"),
      sexo = unico_texto(sexo, "Sexo discordante"),
      n_cohortes_censo = uniqueN(cohorte_inicio[!is.na(cohorte_inicio)]),
      cohorte_conflictiva_censo = uniqueN(cohorte_inicio[!is.na(cohorte_inicio)]) > 1L |
        uniqueN(cohorte_nivel[!vacio(cohorte_nivel)]) > 1L,
      cohorte_inicio = unico_numero(cohorte_inicio),
      cohorte_nivel = unico_texto(cohorte_nivel, "Multiples niveles de cohorte"),
      es_nuevo_secundaria = any(es_nuevo_secundaria), escolar = any(escolar),
      nivel_SS_revisar = any(nivel_SS_revisar), cohorte_futura = any(cohorte_futura),
      admision_futura = any(admision_futura), primera_matricula_futura = any(primera_matricula_futura)
    ), by = .(id, recinto, anio_inicio)]
  }
  panel <- rbindlist(list(unicos, multiples), use.names = TRUE, fill = TRUE)
  panel[is.na(nivel), nivel := "Sin definir"]
  panel[componente == "Multiples componentes" | nivel == "Multiples niveles", es_nuevo_secundaria := FALSE]
  if (anyDuplicated(panel[, .(id, recinto, anio_inicio)]) || sum(panel$n_registros_censo) != nrow(datos))
    stop("No concilia la union de calendarios.")
  panel[]
}

clasificar_ingreso_consistente <- function(panel) {
  x <- copy(panel)
  x[, ni_secundaria_consistente := es_nuevo_secundaria & fuente_origen == "NI observado" &
    estado_cohorte == "1" & !origen_ambiguo & !cohorte_contradice_ni &
    !cohorte_futura & !admision_futura & !primera_matricula_futura &
    !cohorte_conflictiva_censo & tipo_ingreso != "Multiples tipos"]
  x[, motivo_ingreso := fcase(
    !es_nuevo_secundaria, "No es candidato universitario desde secundaria",
    ni_secundaria_consistente, "Candidato consistente con la evidencia disponible",
    cohorte_futura | admision_futura | primera_matricula_futura, "Pendiente: fecha posterior al censo",
    cohorte_conflictiva_censo | cohorte_contradice_ni, "Pendiente: cohorte discordante",
    tipo_ingreso == "Multiples tipos", "Pendiente: tipos discordantes entre calendarios",
    origen_ambiguo, "Pendiente: origen ambiguo o NI repetido",
    default = "Pendiente: no se identifica un origen de primer ano")]
  x[]
}

asignar_origen <- function(panel) {
  stopifnot(requireNamespace("data.table", quietly = TRUE))
  requeridos <- c("id", "anio_inicio", "recinto", "componente", "nivel",
    "tipo_ingreso", "clasificacion", "cohorte_inicio", "cohorte_nivel", "es_nuevo_secundaria")
  faltan <- setdiff(requeridos, names(panel))
  if (length(faltan)) stop("Faltan columnas: ", paste(faltan, collapse = ", "))
  x <- data.table::copy(data.table::as.data.table(panel))
  if (!"cohorte_conflictiva_censo" %in% names(x)) x[, cohorte_conflictiva_censo := FALSE]
  if (any(startsWith(names(x), ".or_"))) stop("Hay columnas internas .or_ preexistentes.")
  canon <- function(v) {
    k <- tolower(gsub("[^[:alnum:]]", "", iconv(trimws(as.character(v)),
      from = "", to = "ASCII//TRANSLIT", sub = "")))
    z <- rep(NA_character_, length(k))
    z[k %in% c("bach", "bachelor", "bachelors", "bachillerato")] <- "Bach"
    z[k %in% c("asoc", "associate", "associates", "asociado", "gradoasociado")] <- "Asoc"
    z
  }
  entero_anio <- function(v) {
    z <- suppressWarnings(as.numeric(as.character(v)))
    ok <- is.finite(z) & z == floor(z) & z >= 1000 & z <= 9999
    z[!ok] <- NA_real_
    as.integer(z)
  }
  x[, `:=`(.or_fila = .I, .or_id = trimws(as.character(id)),
    .or_anio = entero_anio(anio_inicio), .or_nivel = canon(nivel),
    .or_coh_nivel = canon(cohorte_nivel), .or_coh = entero_anio(cohorte_inicio),
    .or_ni = !is.na(es_nuevo_secundaria) & as.logical(es_nuevo_secundaria),
    .or_subgrado = !is.na(componente) & tolower(trimws(componente)) == "subgrado")]
  x[is.na(.or_ni), .or_ni := FALSE]
  x[, .or_valido := .or_subgrado & !is.na(.or_nivel) & !is.na(.or_anio) &
    !is.na(.or_id) & nzchar(.or_id) &
    !tolower(.or_id) %in% c("not defined", "sin definir", "na", "null")]
  x[, `:=`(origen_anio = NA_integer_, origen_fuente = "Sin origen",
    origen_ambiguo = FALSE, motivo_origen = "Sin evidencia suficiente",
    n_anios_ni_observado = NA_integer_, n_cohortes_compatibles = NA_integer_,
    cohorte_contradice_ni = FALSE, cohorte_compatible_futura = FALSE,
    primera_observacion_grado = NA_integer_, entrada_no_observada = NA,
    censura_izquierda = FALSE, antiguedad_exacta = NA_integer_,
    antiguedad_minima = NA_integer_, grupo_antiguedad = "Sin origen",
    base_grupo_antiguedad = "No identificado")]
  x[.or_subgrado == FALSE, `:=`(origen_fuente = "No aplica",
    motivo_origen = "Fuera de subgrado", grupo_antiguedad = "No aplica",
    base_grupo_antiguedad = "No aplica")]
  if (any(x$.or_valido)) {
    llaves <- c(".or_id", ".or_nivel")
    v <- x[.or_valido == TRUE, .(.or_id, .or_nivel, .or_anio, .or_ni,
      .or_coh, .or_coh_nivel, cohorte_conflictiva_censo)]
    v[, .or_compatible := !is.na(.or_coh_nivel) & .or_coh_nivel == .or_nivel]
    v[, `:=`(.or_futura = .or_compatible & !is.na(.or_coh) & .or_coh > .or_anio,
      .or_conflicto = !is.na(cohorte_conflictiva_censo) & as.logical(cohorte_conflictiva_censo))]
    v[is.na(.or_conflicto), .or_conflicto := FALSE]
    inicio_panel <- min(v$.or_anio)

    # Agregaciones simples; sin ejecutar una funcion R compleja por cada ID.
    mapa <- v[, .(primera_observacion_grado = min(.or_anio),
      .or_n_futuras = sum(.or_futura), .or_n_conflictos = sum(.or_conflicto)), by = llaves]
    ni <- unique(v[.or_ni == TRUE, .(.or_id, .or_nivel, .or_anio)])
    if (nrow(ni)) ni <- ni[, .(n_anios_ni_observado = .N, .or_ni_anio = min(.or_anio)), by = llaves]
    co <- unique(v[.or_compatible == TRUE & !is.na(.or_coh), .(.or_id, .or_nivel, .or_coh)])
    if (nrow(co)) co <- co[, .(n_cohortes_compatibles = .N,
      .or_coh_min = min(.or_coh), .or_coh_max = max(.or_coh)), by = llaves]
    mapa[, `:=`(n_anios_ni_observado = 0L, .or_ni_anio = NA_integer_,
      n_cohortes_compatibles = 0L, .or_coh_min = NA_integer_, .or_coh_max = NA_integer_)]
    if (nrow(ni)) mapa[ni, on = llaves, `:=`(
      n_anios_ni_observado = i.n_anios_ni_observado, .or_ni_anio = i..or_ni_anio)]
    if (nrow(co)) mapa[co, on = llaves, `:=`(
      n_cohortes_compatibles = i.n_cohortes_compatibles,
      .or_coh_min = i..or_coh_min, .or_coh_max = i..or_coh_max)]

    mapa[, `:=`(origen_anio = NA_integer_, origen_fuente = "Sin origen",
      motivo_origen = "Sin NI observado ni cohorte compatible estable",
      cohorte_compatible_futura = .or_n_futuras > 0L,
      origen_ambiguo = n_anios_ni_observado > 1L |
        (n_anios_ni_observado == 1L & .or_ni_anio > primera_observacion_grado),
      cohorte_contradice_ni = n_anios_ni_observado == 1L &
        ((n_cohortes_compatibles > 0L &
          (.or_coh_min != .or_ni_anio | .or_coh_max != .or_ni_anio)) | .or_n_conflictos > 0L),
      entrada_no_observada = n_anios_ni_observado == 0L,
      censura_izquierda = primera_observacion_grado == inicio_panel & n_anios_ni_observado == 0L)]
    mapa[n_anios_ni_observado == 1L & origen_ambiguo == FALSE, `:=`(
      origen_anio = .or_ni_anio, origen_fuente = "NI observado",
      motivo_origen = "NI universitario observado unico")]
    mapa[origen_fuente == "NI observado" & cohorte_contradice_ni == TRUE,
      motivo_origen := "NI observado prevalece; campo cohorte discordante"]
    mapa[n_anios_ni_observado > 1L, motivo_origen := "NI observado en varios anos: origen ambiguo"]
    mapa[n_anios_ni_observado == 1L & origen_ambiguo == TRUE,
      motivo_origen := "NI posterior a una observacion del mismo grado: revisar"]
    mapa[n_anios_ni_observado == 0L & n_cohortes_compatibles == 1L &
      cohorte_compatible_futura == FALSE & .or_n_conflictos == 0L &
      .or_coh_min <= primera_observacion_grado, `:=`(
      origen_anio = .or_coh_min, origen_fuente = "Cohorte compatible estable",
      motivo_origen = "Un solo ano de cohorte compatible, sin contradiccion temporal")]
    mapa[n_anios_ni_observado == 0L & (n_cohortes_compatibles > 1L |
      cohorte_compatible_futura == TRUE | .or_n_conflictos > 0L |
      (n_cohortes_compatibles == 1L & .or_coh_min > primera_observacion_grado)), `:=`(
      origen_ambiguo = TRUE, motivo_origen = "Campo cohorte incompatible con un origen estable no futuro")]

    mapa[, .or_valido := TRUE]
    cols_mapa <- c("origen_anio", "origen_fuente", "origen_ambiguo", "motivo_origen",
      "n_anios_ni_observado", "n_cohortes_compatibles", "cohorte_contradice_ni",
      "cohorte_compatible_futura", "primera_observacion_grado", "entrada_no_observada", "censura_izquierda")
    # Una sola asignacion por union al panel integral; no cruza a posgrado.
    x[mapa, on = c(llaves, ".or_valido"), (cols_mapa) := mget(paste0("i.", cols_mapa))]
    x[.or_valido == TRUE, antiguedad_minima := .or_anio - primera_observacion_grado + 1L]
    x[.or_valido == TRUE & !is.na(origen_anio), antiguedad_exacta := .or_anio - origen_anio + 1L]
    x[.or_valido == TRUE & !is.na(antiguedad_exacta), `:=`(
      grupo_antiguedad = as.character(pmin(antiguedad_exacta, 5L)),
      base_grupo_antiguedad = "Origen asignado por evidencia documentada")]
    x[grupo_antiguedad == "5", grupo_antiguedad := "5 o mas"]
    x[.or_valido == TRUE & is.na(origen_anio) & antiguedad_minima >= 5L, `:=`(
      grupo_antiguedad = "5 o mas", base_grupo_antiguedad = "Cota minima por observacion")]
  }
  data.table::setorder(x, .or_fila)
  x[, (names(x)[startsWith(names(x), ".or_")]) := NULL]
  x[]
}



# Origen por informacion disponible hasta cada censo observado.
# Requiere asignar_origen(panel), definida en el script 02.
# Las filas historicas no incorporan evidencia de cursos posteriores.
asignar_origen_temporal <- function(panel) {
  if (!requireNamespace("data.table", quietly = TRUE)) stop("Falta instalar data.table.", call. = FALSE)
  if (!exists("asignar_origen", mode = "function", inherits = TRUE)) {
    stop("Debe definirse asignar_origen antes de asignar_origen_temporal.", call. = FALSE)
  }
  x <- data.table::copy(data.table::as.data.table(panel))
  if (!all(c("id", "recinto", "anio_inicio") %in% names(x))) {
    stop("El panel requiere id, recinto y anio_inicio.", call. = FALSE)
  }
  if (!nrow(x)) stop("El panel para asignar origen esta vacio.", call. = FALSE)
  if (".temporal_fila" %in% names(x)) stop("La columna interna .temporal_fila ya existe.", call. = FALSE)
  anos <- suppressWarnings(as.numeric(as.character(x$anio_inicio)))
  if (any(!is.finite(anos) | anos != floor(anos) | anos < 1000L | anos > 9999L)) {
    stop("Hay anos de observacion invalidos.", call. = FALSE)
  }
  x[, anio_inicio := as.integer(anos)]
  if (anyDuplicated(x[, .(id, recinto, anio_inicio)])) {
    stop("Se requiere una sola fila por persona, recinto y ano.", call. = FALSE)
  }
  x[, .temporal_fila := .I]
  cortes <- sort(unique(x$anio_inicio))
  por_corte <- lapply(cortes, function(corte) {
    z <- asignar_origen(x[anio_inicio <= corte])
    z <- z[anio_inicio == corte]
    z[, corte_informacion := as.integer(corte)]
    z
  })
  out <- data.table::rbindlist(por_corte, use.names = TRUE, fill = FALSE)
  data.table::setorder(out, .temporal_fila)
  out[, .temporal_fila := NULL]
  if (nrow(out) != nrow(panel)) stop("La asignacion temporal altero el numero de filas.", call. = FALSE)
  out[]
}

comprobar_funciones_v2 <- function() {
  z <- data.table(id = c("u", "u", "s", "ss", "f"), recinto = "Prueba", anio_inicio = 2020L,
    anio = "2020-2021", calendario = c("Semestre", "Anual", "Semestre", "Semestre", "Semestre"),
    nivel = c("Bach", "Bach", "Bach", "SS", "Bach"),
    clasificacion = c("Primer Nivel Bach:", "Primer Nivel Bach:", "Escuela Superior", "Segundo Nivel Bach:", "Primer Nivel Bach:"),
    tipo_ingreso = "De Escuela Secundaria", sexo = "Female", cohorte_inicio = 2020L,
    cohorte_nivel = "Bach", primero_inicio = 2020L, admision_inicio = c(2020L, 2020L, 2020L, 2020L, 2021L))
  a <- preparar_componentes(z)
  stopifnot(a[id == "s", componente] == "Escolar", a[id == "ss", componente] == "Otros",
    a[id == "ss", nivel_SS_revisar], !a[id == "ss", escolar])
  u <- construir_panel_rapido(a)
  stopifnot(nrow(u) == 4L, sum(u$n_registros_censo) == 5L, u[id == "u", n_calendarios] == 2L)
  t <- asignar_origen_temporal(u)
  setnames(t, c("origen_fuente", "grupo_antiguedad"), c("fuente_origen", "estado_cohorte"))
  t <- clasificar_ingreso_consistente(t)
  stopifnot(t[id == "u", ni_secundaria_consistente], !t[id == "f", ni_secundaria_consistente],
    t[id == "f", es_nuevo_secundaria], all(t$corte_informacion == t$anio_inicio))
  posterior <- copy(u[id == "u"]); posterior[, `:=`(anio_inicio = 2022L, anio = "2022-2023")]
  todo <- asignar_origen_temporal(rbindlist(list(u, posterior)))
  previo <- asignar_origen_temporal(u)
  stopifnot(identical(todo[anio_inicio == 2020L], previo), normalizar_anio("1999-00") == 1999L)
  message("COMPROBACION RAPIDA CORRECTA: union, componentes, fechas y ausencia de informacion futura.")
  invisible(TRUE)
}


generar_flujos <- function(panel, destino) {
  # Enlace de personas dentro del mismo recinto entre censos consecutivos.
  origen <- panel[, .(id, recinto, anio_destino = anio_inicio + 1L,
                     comp_origen = componente, nivel_origen = nivel, estado_origen = estado_cohorte)]
  llegada <- panel[, .(id, recinto, anio_destino = anio_inicio,
                      comp_destino = componente, nivel_destino = nivel, estado_destino = estado_cohorte,
                      ni_secundaria_destino = es_nuevo_secundaria,
                      ni_consistente_destino = ni_secundaria_consistente, tipo_ingreso_destino = tipo_ingreso)]
  presencia <- unique(panel[, .(recinto, anio_inicio)])
  pares <- merge(presencia[, .(recinto, anio_destino = anio_inicio + 1L)],
                 presencia[, .(recinto, anio_destino = anio_inicio)], by = c("recinto", "anio_destino"))
  enlace <- merge(origen, llegada, by = c("id", "recinto", "anio_destino"), all = TRUE)
  enlace <- merge(enlace, pares, by = c("recinto", "anio_destino"))
  enlace[, mismo_grupo := !is.na(comp_origen) & !is.na(comp_destino) &
            comp_origen == comp_destino & !is.na(nivel_origen) & !is.na(nivel_destino) & nivel_origen == nivel_destino]
  enlace[, provisional := anio_destino > ultimo_anio_calibracion]
  enlace[, anio_anterior := sprintf("%d-%d", anio_destino - 1L, anio_destino)]
  enlace[, anio_siguiente := sprintf("%d-%d", anio_destino, anio_destino + 1L)]

  tr <- enlace[comp_origen == "Subgrado"]
  tr[, destino_transicion := fcase(
    is.na(comp_destino), "No observado en recinto",
    !mismo_grupo, "Cambio componente o grado",
    rep(TRUE, .N), estado_destino, default = NA_character_)]
  flujos <- tr[, .(personas = .N), by = .(recinto, nivel_origen, anio_anterior, anio_siguiente,
                  anio_destino, estado_origen, destino_transicion, provisional)]
  flujos[, exposicion_origen := sum(personas), by = .(recinto, nivel_origen, anio_destino, estado_origen)]
  flujos[, proporcion := personas / exposicion_origen]
  fwrite_seguro(flujos, "07_flujos_subgrado.csv", destino)

  # Tasas ponderadas por exposicion para las transiciones de los ultimos cinco
  # pares completos. Incluye permanencia y estado desconocido por separado.
  ventana <- flujos[!provisional & anio_destino > ultimo_anio_calibracion - ventana_transiciones]
  if (nrow(ventana)) {
    tasas <- ventana[, .(personas = sum(personas)),
                     by = .(recinto, nivel_origen, estado_origen, destino_transicion)]
    tasas[, exposicion_origen := sum(personas), by = .(recinto, nivel_origen, estado_origen)]
    tasas[, proporcion := personas / exposicion_origen]
    fwrite_seguro(tasas, "08_tasas_subgrado_ventana.csv", destino)
  }
  # Balance por componente y grado: stock siguiente = continuantes + entradas.
  llegadas <- enlace[!is.na(comp_destino), .(
    matricula_destino = .N, continuantes_mismo_grupo = sum(mismo_grupo),
    incorporaciones = sum(!mismo_grupo),
    incorporaciones_secundaria = sum(!mismo_grupo & ni_secundaria_destino),
    incorporaciones_secundaria_consistentes = sum(!mismo_grupo & ni_consistente_destino),
    incorporaciones_otras = sum(!mismo_grupo & !ni_secundaria_destino)),
    by = .(recinto, componente = comp_destino, nivel = nivel_destino, anio_destino, anio_siguiente, provisional)]
  stocks <- enlace[!is.na(comp_origen), .(matricula_origen = .N),
                    by = .(recinto, componente = comp_origen, nivel = nivel_origen, anio_destino)]
  balance <- merge(stocks, llegadas, by = c("recinto", "componente", "nivel", "anio_destino"), all = TRUE)
  for (col in c("matricula_origen", "matricula_destino", "continuantes_mismo_grupo", "incorporaciones",
                "incorporaciones_secundaria", "incorporaciones_secundaria_consistentes", "incorporaciones_otras")) {
    set(balance, which(is.na(balance[[col]])), col, 0L)
  }
  balance[, provisional := anio_destino > ultimo_anio_calibracion]
  balance[, anio_siguiente := sprintf("%d-%d", anio_destino, anio_destino + 1L)]
  balance[, diferencia_balance := matricula_destino - continuantes_mismo_grupo - incorporaciones]
  balance[, persistencia_observada := fifelse(matricula_origen > 0L,
                                             continuantes_mismo_grupo / matricula_origen, NA_real_)]
  if (any(balance$diferencia_balance != 0L) || any(balance$persistencia_observada > 1, na.rm = TRUE)) {
    stop("No se cumple el balance de personas entre censos.")
  }
  fwrite_seguro(balance, "09_balances_componentes.csv", destino)
  entradas <- enlace[!is.na(comp_destino) & !mismo_grupo, .(personas = .N),
                     by = .(recinto, anio_siguiente, comp_destino, nivel_destino,
                            estado_destino, ni_secundaria_destino, ni_consistente_destino,
                            tipo_ingreso_destino, provisional)]
  fwrite_seguro(entradas, "10_incorporaciones_por_estado.csv", destino)

  list(flujos = flujos, balance = balance, incorporaciones = entradas)
}

ejecutar_etapa2 <- function(raiz, carpeta_diagnostico = NULL) {
  if (!isTRUE(identificador_estable_confirmado)) stop("El enlace requiere confirmar la estabilidad del identificador.")
  comprobar_funciones_v2()
  entrada <- cargar_entrada_etapa2(raiz, carpeta_diagnostico)
  diagnostico <- entrada$diagnostico
  message("Diagnostico COMPLETO utilizado: ", diagnostico)
  datos <- preparar_componentes(entrada$datos)
  marca <- paste0(format(Sys.time(), "%Y%m%d_%H%M%S"), "_", Sys.getpid())
  destino <- file.path(raiz, "resultados", paste0("cohortes_", marca))
  if (!dir.create(destino, recursive = TRUE, showWarnings = FALSE)) stop("No se pudo crear la carpeta de etapa 2.")
  fwrite_seguro(entrada$auditoria, "01_periodos_y_calendarios.csv", destino)
  revision_componentes <- datos[, .(registros = .N, personas_periodo = uniqueN(id)),
    by = .(recinto, anio, calendario, codigo_sesion, componente, nivel, clasificacion,
      tipo_ingreso, escolar, nivel_SS_revisar, clasificacion_no_grado)]
  fwrite_seguro(revision_componentes, "15_revision_componentes.csv", destino)
  message("Uniendo calendarios: ", nrow(datos), " registros de periodos iniciales/anuales.")
  panel <- construir_panel_rapido(datos)
  panel[, provisional := anio_inicio > ultimo_anio_calibracion]
  conciliacion <- datos[, .(registros_censos_seleccionados = .N), by = .(recinto, anio)]
  conciliacion <- merge(conciliacion,
    panel[, .(personas_union = .N, registros_menos_personas = sum(n_registros_censo - 1L)), by = .(recinto, anio)],
    by = c("recinto", "anio"))
  esperado <- entrada$personasEsperadas[, .(recinto, anio,
    registros_esperados = registros_inicio_candidato, personas_esperadas = personas_inicio_candidato)]
  cc <- merge(conciliacion, esperado, by = c("recinto", "anio"), all = TRUE)
  if (anyNA(cc) || nrow(cc) != nrow(esperado) ||
      any(cc$registros_censos_seleccionados != cc$registros_esperados) ||
      any(cc$personas_union != cc$personas_esperadas) ||
      any(cc$registros_censos_seleccionados - cc$personas_union != cc$registros_menos_personas))
    stop("La union no reproduce los conteos por recinto y ano del 01 validado.")
  fwrite_seguro(conciliacion, "03_union_calendarios.csv", destino)
  escolares <- datos[escolar == TRUE, .(registros = .N, personas = uniqueN(id),
    personas_etiqueta_secundaria = uniqueN(id[clave(tipo_ingreso) == "deescuelasecundaria"])),
    by = .(recinto, anio, nivel, clasificacion)]
  fwrite_seguro(escolares, "04_registros_escolares_separados.csv", destino)
  n_registros <- nrow(datos)
  rm(datos); entrada$datos <- NULL
  message("Panel construido: ", nrow(panel), " filas persona-recinto-ano; ",
    uniqueN(panel$id), " identificadores distintos en el conjunto de anos y recintos.")
  message("Asignando antiguedad con informacion disponible hasta cada ano; sin reescribir censos anteriores.")
  panel <- asignar_origen_temporal(panel)
  setnames(panel, c("origen_fuente", "grupo_antiguedad"), c("fuente_origen", "estado_cohorte"))
  panel <- clasificar_ingreso_consistente(panel)
  if (any(panel$corte_informacion != panel$anio_inicio)) stop("Hay evidencia temporal posterior al censo.")
  censo <- panel[, .(personas = .N, con_multiples_calendarios = sum(n_calendarios > 1L),
    nuevo_ingreso_secundaria = sum(es_nuevo_secundaria),
    nuevo_ingreso_consistente = sum(ni_secundaria_consistente)),
    by = .(recinto, anio, componente, nivel, provisional)]
  fwrite_seguro(censo, "02_censo_corregido.csv", destino)
  origenes <- panel[componente == "Subgrado", .(personas = .N),
    by = .(recinto, anio, nivel, fuente_origen, estado_cohorte, base_grupo_antiguedad, origen_ambiguo,
      cohorte_contradice_ni, cohorte_conflictiva_censo, provisional, corte_informacion)]
  fwrite_seguro(origenes, "05_cohortes_y_fuentes.csv", destino)
  ingreso <- panel[componente == "Subgrado", .(matricula = .N,
    nuevo_ingreso_candidato = sum(es_nuevo_secundaria),
    nuevo_ingreso_consistente = sum(ni_secundaria_consistente),
    nuevo_ingreso_pendiente = sum(es_nuevo_secundaria & !ni_secundaria_consistente)),
    by = .(recinto, anio, nivel, provisional)]
  insumo <- file.path(diagnostico, "12_alineacion_G12_ingreso_universitario.csv")
  if (file.exists(insumo)) {
    g12 <- fread(insumo)
    if (anyDuplicated(g12$anio_universitario)) stop("La alineacion G12 tiene anos duplicados.")
    ingreso <- merge(ingreso, g12[, .(anio = anio_universitario, total_G12_observado, ambos_sectores_observados)],
      by = "anio", all.x = TRUE)
    ingreso[, coeficiente_G12_candidato := fifelse(!is.na(total_G12_observado) & total_G12_observado > 0,
      nuevo_ingreso_candidato / total_G12_observado, NA_real_)]
    ingreso[, coeficiente_G12_consistente := fifelse(!is.na(total_G12_observado) & total_G12_observado > 0,
      nuevo_ingreso_consistente / total_G12_observado, NA_real_)]
  }
  fwrite_seguro(ingreso, "06_ingreso_y_G12.csv", destino)
  message("Calculando flujos y conciliando stocks entre censos iniciales consecutivos.")
  resultado_flujos <- generar_flujos(panel, destino)
  id_revision <- panel[, .(n_anos = uniqueN(anio_inicio), n_recintos = uniqueN(recinto)), by = id]
  estabilidad <- id_revision[, .(identificadores = .N), by = .(n_anos, n_recintos)]
  fwrite_seguro(estabilidad, "11_revision_identificadores.csv", destino)
  resumen <- panel[, .(filas_todos_componentes = .N,
    grado_identificado = sum(componente %in% c("Subgrado", "Posgrado")),
    subgrado = sum(componente == "Subgrado"), posgrado = sum(componente == "Posgrado"),
    subgrado_generico = sum(componente == "Subgrado_generico"),
    escolar = sum(componente == "Escolar"), otros = sum(componente == "Otros"),
    multiples_componentes = sum(componente == "Multiples componentes")),
    by = .(recinto, anio, provisional)]
  if (any(resumen$filas_todos_componentes != resumen$subgrado + resumen$posgrado +
      resumen$subgrado_generico + resumen$escolar + resumen$otros + resumen$multiples_componentes))
    stop("Los componentes no concilian el panel completo.")
  fwrite_seguro(resumen, "12_matricula_por_recinto_anio.csv", destino)
  conjunto <- panel[, .(filas_persona_recinto_anio = .N, identificadores_distintos = uniqueN(id),
    filas_grado_identificado = sum(componente %in% c("Subgrado", "Posgrado")),
    identificadores_grado_identificado = uniqueN(id[componente %in% c("Subgrado", "Posgrado")])),
    by = .(anio, provisional)]
  conjunto[, repeticiones_entre_recintos := filas_persona_recinto_anio - identificadores_distintos]
  fwrite_seguro(conjunto, "13_matricula_conjunto_recintos.csv", destino)
  revision <- panel[, .(personas = .N), by = .(recinto, anio, componente, nivel,
    es_nuevo_secundaria, ni_secundaria_consistente, motivo_ingreso, fuente_origen, estado_cohorte,
    origen_ambiguo, cohorte_contradice_ni, cohorte_conflictiva_censo, cohorte_futura,
    admision_futura, primera_matricula_futura, nivel_SS_revisar, provisional)]
  fwrite_seguro(revision, "14_revision_cohortes_ingreso.csv", destino)
  cobertura_cal <- fread(file.path(diagnostico, "14_cobertura_calendarios.csv"))
  fwrite_seguro(cobertura_cal[calendario != "Verano" & periodos_iniciales_candidatos == 0L],
    "16_calendarios_sin_inicio.csv", destino)
  estado <- data.table(version = version_etapa2, fecha_utc = format(Sys.time(), "%Y-%m-%d %H:%M:%S", tz = "UTC"),
    diagnostico = basename(diagnostico), procesamiento_completo = TRUE, revision_tecnica_pendiente = TRUE,
    archivos_verificados = nrow(entrada$inv), registros_todos_periodos = entrada$estado$registros_todos_periodos,
    registros_inicio_seleccionados = n_registros, filas_persona_recinto_anio = nrow(panel),
    identificadores_distintos_todos_anos_recintos = uniqueN(panel$id),
    repeticiones_calendarios = n_registros - nrow(panel),
    periodos_seleccionados = sum(entrada$seleccion$seleccionado),
    antiguedad_sin_informacion_futura = all(panel$corte_informacion == panel$anio_inicio),
    balances_correctos = all(resultado_flujos$balance$diferencia_balance == 0L),
    identificador_estable_confirmado_usuario = identificador_estable_confirmado,
    objetivo = "Matricula de periodos iniciales y anual por calendario",
    ultimo_anio_calibracion = ultimo_anio_calibracion)
  fwrite_seguro(estado, "17_estado_ejecucion.csv", destino)
  cfg <- data.table(parametro = c("version", "diagnostico", "objetivo", "identificador_estable",
      "ultimo_anio_calibracion", "ventana_transiciones", "informacion_origen", "reutilizacion",
      "escolar", "nivel_SS", "G12"),
    valor = c(version_etapa2, diagnostico, "Inicio del ano: union de periodos iniciales y anual por calendario",
      "Confirmado por el usuario: estable entre anos y recintos", as.character(ultimo_anio_calibracion),
      as.character(ventana_transiciones), "Cada censo usa solo informacion hasta su propio ano",
      "No se reutilizan paneles ni checkpoints anteriores", "Separado por clasificacion explicita Escuela Superior/High School",
      "Se conserva sin homologar en Otros; requiere diccionario",
      "Matricula observada de grado12 del curso previo; no graduados efectivos"))
  fwrite_seguro(cfg, "18_configuracion_etapa2.csv", destino)
  temporal <- tempfile(pattern = "panel_", tmpdir = destino)
  on.exit(if (file.exists(temporal)) unlink(temporal), add = TRUE)
  saveRDS(panel, temporal, compress = "gzip")
  if (!file.rename(temporal, file.path(destino, "panel_censos_cohortes.rds"))) stop("No se pudo guardar el panel.")
  writeLines(c(
    "COHORTES Y TRANSICIONES UPR - ETAPA 2 v2.0", "",
    paste("Diagnostico utilizado:", diagnostico),
    "Condiciones confirmadas por el usuario el 15 de octubre de 2026:",
    "- El identificador no cambia entre anos ni entre recintos.",
    "- El objetivo es la matricula al inicio del ano academico.", "",
    paste("Registros de periodos iniciales/anuales:", n_registros),
    paste("Filas persona-recinto-ano:", nrow(panel)),
    paste("Identificadores distintos en todos los anos y recintos:", uniqueN(panel$id)),
    "Son unidades diferentes. La suma de recintos no equivale a personas unicas del conjunto.", "",
    "01 reproduce la seleccion auditada del nuevo 01; se verificaron todos los RDS y sus conteos.",
    "02 y 03 presentan componentes y union por persona-recinto-ano, sin duplicar calendarios.",
    "04 incluye toda clasificacion escolar explicita, no solo la etiqueta De Escuela Secundaria.",
    "05 asigna antiguedad cronologica del grado usando solo informacion hasta cada censo.",
    "Un cambio de recinto no reinicia el origen del grado; Asoc y Bach tienen origen separado.",
    "La llave id+nivel no separa programas ni segundas titulaciones del mismo nivel; los NI repetidos quedan ambiguos.",
    "5 o mas puede provenir de una cota temporal; no significa cinco cursos efectivamente matriculados.",
    "06 separa candidatos, consistentes y pendientes. Una etiqueta aislada no certifica nuevo ingreso.",
    "Si NI candidato y cohorte discrepan, el origen prioriza el NI observado y conserva la contradiccion; ese NI queda pendiente, no consistente.",
    "First Academic Year y niveles Primero/Segundo/etc no se usan para inventar origenes.",
    "07 muestra flujos entre censos; no observado en recinto no identifica graduacion ni abandono.",
    "08 contiene tasas ponderadas por exposicion de los ultimos pares de calibracion.",
    "09 verifica stock siguiente = continuantes del mismo grupo + incorporaciones.",
    "10 conserva entradas secundarias pendientes dentro de las incorporaciones, sin perderlas.",
    "11 cuenta identificadores por numero de anos y recintos: no es una prueba de identidad.",
    "12 separa grado identificado, subgrado generico, escolar, otros y componentes multiples.",
    "13 deduplica identificadores entre recintos dentro de cada ano; no sumar anos como personas distintas.",
    "14 y 15 documentan fechas futuras, ambiguedades de ingreso y niveles pendientes de homologar.",
    "16 conserva calendarios sin inicio: no se reemplazo por un periodo posterior.",
    "17 y 18 documentan estado y configuracion. COMPLETO no significa metodologia aprobada.", "",
    "2026-2027 se conserva como provisional: la cobertura del curso esta incompleta y la consolidacion de su inicio no se ha certificado.",
    "La ausencia del segundo semestre no invalida por si sola un censo inicial.",
    "Las tasas de 08 usan informacion hasta 2025-2026. La revision retrospectiva no recibe evidencia posterior a cada censo.",
    "Otros y Subgrado_generico conservan registros; no son grados homologados automaticamente.",
    "Escolar se mantiene visible y separado; no debe sumarse a la matricula universitaria proyectada.",
    "G12 es matricula escolar, no graduacion efectiva; privada2024-2025 y2025-2026 siguen sin observacion en estos insumos.",
    "El alcance sigue siendo diez recintos; Mayaguez no esta incluido.", "",
    "PARA LA REVISION: compartir TODOS los CSV y TXT de esta carpeta.",
    "No compartir el RDS: contiene identificadores. No ejecutar todavia el 03."
  ), file.path(destino, "LEER_ETAPA_2.txt"))
  capture.output(sessionInfo(), file = file.path(destino, "sesion_R.txt"))
  writeLines("ETAPA 2 v2.0: PROCESAMIENTO COMPLETO. Pendiente revision de resultados antes del 03.",
    file.path(destino, "COMPLETO.txt"))
  message("TERMINADO. Resultados para revision: ", destino)
  invisible(destino)
}


ruta_etapa_2 <- ejecutar_etapa2(raiz, carpeta_diagnostico)
