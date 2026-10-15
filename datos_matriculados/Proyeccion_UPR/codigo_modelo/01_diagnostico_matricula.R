# Diagnostico inicial de matricula UPR | Etapa 1 | Version 2.0
# 15 de octubre de 2026
# Guardar en datos_matriculados, junto a las carpetas 2017-2018, ..., 2026-2027.
# Instalar una vez: install.packages(c("data.table", "this.path", "readxl"))
# Abrir el archivo guardado en RStudio y pulsar Source.
# Lee TODOS los CSV originales y conserva TODOS sus periodos en bases_limpias.
# No usa resultados ni puntos de recuperacion de ejecuciones anteriores.
# Los CSV son agregados; los RDS contienen identificadores y se conservan localmente.
# Este diagnostico no reconstruye origenes, calcula transiciones ni proyecta matricula.

paquetes <- c("data.table", "this.path", "readxl")
faltantes <- paquetes[!vapply(paquetes, requireNamespace, logical(1), quietly = TRUE)]
if (length(faltantes)) stop("Instala primero: install.packages(c(",
  paste(sprintf('"%s"', faltantes), collapse = ", "), "))", call. = FALSE)
suppressPackageStartupMessages(library(data.table))
raiz <- normalizePath(this.path::this.dir(), winslash = "/", mustWork = TRUE)
version_diagnostico <- "2.0"
anios_inicio <- 2017:2026
guardar_microdatos <- TRUE
recintos_esperados <- c("Aguadilla", "Arecibo", "Bayamon", "Carolina", "Cayey",
  "Ciencias_Medicas", "Humacao", "Ponce", "Rio_Piedras", "Utuado")

campos <- c("Location", "Academic Year", "Academic Session", "Academic Session Code",
  "Academic Month", "Academic Period Number", "Degree Level", "Classification",
  "Registration Type", "Identifier", "Sex", "School Type", "Program Code",
  "First Academic Year", "First Term", "Admitted Academic Year", "Admitted Location",
  "CohortAcademicYear", "CohortAcademicSessionCode", "CohortDegreeLevel", "CohortAdmittedProgramCode")
obligatorios <- c("Location", "Academic Year", "Academic Session", "Academic Session Code",
  "Degree Level", "Classification", "Registration Type", "Identifier")
renombres <- c("Location" = "recinto_original", "Academic Year" = "anio_original",
  "Academic Session" = "sesion", "Academic Session Code" = "codigo_sesion",
  "Academic Month" = "mes", "Academic Period Number" = "numero_periodo",
  "Degree Level" = "nivel_original", "Classification" = "clasificacion_original",
  "Registration Type" = "tipo_ingreso_original", "Identifier" = "id", "Sex" = "sexo_original",
  "School Type" = "escuela_original", "Program Code" = "programa",
  "First Academic Year" = "primer_anio_original", "First Term" = "primer_periodo",
  "Admitted Academic Year" = "admision_anio_original", "Admitted Location" = "admision_recinto",
  "CohortAcademicYear" = "cohorte_original", "CohortAcademicSessionCode" = "cohorte_periodo",
  "CohortDegreeLevel" = "cohorte_nivel", "CohortAdmittedProgramCode" = "cohorte_programa")
limpiar <- function(x) trimws(gsub("[[:space:]]+", " ", as.character(x)))
clave <- function(x) tolower(gsub("[^[:alnum:]]", "",
  iconv(limpiar(x), from = "", to = "ASCII//TRANSLIT", sub = "")))
vacio <- function(x) is.na(x) | limpiar(x) == "" |
  clave(x) %in% c("notdefined", "sindefinir", "na", "null")
etiqueta <- function(x) { x <- limpiar(x); x[vacio(x)] <- "Sin definir"; x }
normalizar_anio <- function(x) {
  x <- limpiar(x)
  a <- suppressWarnings(as.integer(substr(x, 1L, 4L)))
  b <- suppressWarnings(as.integer(sub("^[0-9]{4}-", "", x)))
  corto <- !is.na(x) & grepl("^[12][0-9]{3}-[0-9]{2}$", x)
  b[corto] <- a[corto] %/% 100L * 100L + b[corto]
  cambio_siglo <- corto & !is.na(a) & !is.na(b) & b < a
  b[cambio_siglo] <- b[cambio_siglo] + 100L
  ok <- !is.na(x) & grepl("^[12][0-9]{3}-([0-9]{2}|[12][0-9]{3})$", x) &
    !is.na(a) & !is.na(b) & b == a + 1L
  out <- rep(NA_character_, length(x)); out[ok] <- sprintf("%d-%d", a[ok], b[ok]); out
}
nombre_anio <- function(a) sprintf("%d-%d", a, a + 1L)
normalizar_recinto <- function(x) {
  k <- clave(x); posibles <- c(recintos_esperados, "Mayaguez")
  coincidencias <- vapply(posibles, function(r) !is.na(k) & grepl(clave(r), k, fixed = TRUE), logical(length(k)))
  if (!length(k)) return(character())
  if (is.null(dim(coincidencias))) coincidencias <- matrix(coincidencias, nrow = length(k))
  out <- rep(NA_character_, length(k)); n <- rowSums(coincidencias)
  for (j in seq_along(posibles)) out[n == 1L & coincidencias[, j]] <- posibles[j]
  out
}
personas <- function(x) uniqueN(x[!vacio(x)])
pegar <- function(x) paste(sort(unique(x[!is.na(x)])), collapse = " | ")
bind <- function(x) if (!length(x)) data.table() else rbindlist(x, use.names = TRUE, fill = TRUE)
exportar <- function(x, nombre, destino) {
  if (ncol(x)) fwrite(x, file.path(destino, nombre), bom = TRUE, na = "")
}

# Clasificacion comun a los diagnosticos de esta etapa. Quarter se conserva
# como etiqueta; no se deduce su duracion ni se equipara con un trimestre.
# El numero del codigo de sesion no se interpreta: los codigos son categorias.
clasificar_periodos <- function(sesion, numero_periodo) {
  s <- tolower(limpiar(sesion)); s[is.na(s)] <- ""
  n <- limpiar(numero_periodo)
  valido_numero <- !vacio(n) & grepl("^[0-9]+$", n)
  numero <- suppressWarnings(as.integer(n))
  invalido <- !vacio(n) & (!valido_numero | is.na(numero) | numero < 1L)
  numero[!valido_numero | invalido] <- NA_integer_
  calendario <- fcase(
    grepl("summer|verano", s), "Verano",
    grepl("annual|anual", s), "Anual",
    grepl("trimester|trimestr", s), "Trimestre",
    grepl("quarter", s), "Quarter",
    grepl("semester|semestr", s), "Semestre", default = "Sin identificar")
  ordinal <- rep(NA_integer_, length(s))
  rx_delante <- "^([0-9]+)[[:space:]]*(st|nd|rd|th|er|ro|do|to|o)?[[:space:]]+(semester|semestre|trimester|trimestre|quarter)([^[:alpha:]]|$).*"
  m <- grepl(rx_delante, s)
  ordinal[m] <- suppressWarnings(as.integer(sub(rx_delante, "\\1", s[m])))
  rx_detras <- "^(semester|semestre|trimester|trimestre|quarter)[[:space:]]*([0-9]+)([^0-9]|$).*"
  m <- grepl(rx_detras, s)
  ordinal[m] <- suppressWarnings(as.integer(sub(rx_detras, "\\2", s[m])))
  palabras <- list(c("first", "primer", "primera"), c("second", "segundo", "segunda"),
    c("third", "tercer", "tercero", "tercera"), c("fourth", "cuarto", "cuarta"))
  for (j in seq_along(palabras)) {
    m <- grepl(paste0("^(", paste(palabras[[j]], collapse = "|"), ")[[:space:]]+"), s)
    ordinal[m] <- j
  }
  periodico <- calendario %in% c("Semestre", "Trimestre", "Quarter")
  contradiccion <- periodico & !is.na(ordinal) & !is.na(numero) & ordinal != numero
  preliminar <- calendario == "Anual" | (periodico &
    ((!is.na(ordinal) & ordinal == 1L) | (is.na(ordinal) & !is.na(numero) & numero == 1L)))
  preliminar[is.na(preliminar)] <- FALSE
  data.table(calendario = calendario, ordinal_texto = ordinal, numero_periodo_entero = numero,
    numero_periodo_invalido = invalido, contradiccion_texto_numero = contradiccion,
    seleccion_preliminar = preliminar & !contradiccion & !invalido)
}

# La decision se toma para un CODIGO COMPLETO, no para unas filas del periodo.
# Una discordancia bloquea ese periodo y se informa; no se corrige por conjetura.
auditar_periodos <- function(x) {
  z <- clasificar_periodos(x$sesion, x$numero_periodo)
  for (col in names(z)) set(x, j = col, value = z[[col]])
  au <- x[, .(
    sesiones = pegar(etiqueta(sesion)), n_etiquetas_sesion = uniqueN(etiqueta(sesion)),
    calendarios = pegar(calendario), n_calendarios = uniqueN(calendario),
    numeros_periodo = pegar(etiqueta(numero_periodo)),
    n_numeros_periodo_definidos = uniqueN(numero_periodo_entero[!is.na(numero_periodo_entero)]),
    ordinales_texto = pegar(ordinal_texto),
    n_ordinales_texto = uniqueN(ordinal_texto[!is.na(ordinal_texto)]),
    registros = .N, personas = personas(id), filas_sesion_vacia = sum(vacio(sesion)),
    filas_numero_vacio = sum(vacio(numero_periodo)),
    filas_numero_invalido = sum(numero_periodo_invalido),
    contradicciones_texto_numero = sum(contradiccion_texto_numero),
    filas_seleccion_preliminar = sum(seleccion_preliminar),
    usa_solo_numero = any(is.na(ordinal_texto) & !is.na(numero_periodo_entero) &
      calendario %in% c("Semestre", "Trimestre", "Quarter")),
    calendario = calendario[1L]), by = .(archivo_id, archivo, anio, recinto, codigo_sesion)]
  au[, seleccion_parcial := filas_seleccion_preliminar > 0L & filas_seleccion_preliminar < registros]
  au[, ambiguo := n_etiquetas_sesion != 1L | n_calendarios != 1L |
    n_numeros_periodo_definidos > 1L | n_ordinales_texto > 1L | filas_sesion_vacia > 0L |
    filas_numero_invalido > 0L | contradicciones_texto_numero > 0L | seleccion_parcial]
  au[, seleccionado := !ambiguo & filas_seleccion_preliminar == registros & registros > 0L]
  au[, varios_iniciales_mismo_calendario := FALSE]
  grupos <- au[seleccionado == TRUE, .N, by = .(archivo_id, anio, recinto, calendario)][N > 1L]
  if (nrow(grupos)) au[grupos, on = .(archivo_id, anio, recinto, calendario),
    varios_iniciales_mismo_calendario := TRUE]
  au[varios_iniciales_mismo_calendario == TRUE, `:=`(ambiguo = TRUE, seleccionado = FALSE)]
  au[, razon := fcase(
    varios_iniciales_mismo_calendario, "Bloqueado: varios codigos iniciales del mismo calendario",
    ambiguo, "Bloqueado: etiquetas, numeros o filas de seleccion contradictorios",
    calendario == "Sin identificar", "Excluido: calendario sin identificar; revisar",
    calendario == "Verano", "Excluido: verano",
    seleccionado & calendario == "Anual", "Incluido: periodo anual",
    seleccionado & usa_solo_numero, "Incluido por numero 1; ordinal de la etiqueta sin identificar; revisar",
    seleccionado, "Incluido: periodo inicial con informacion compatible",
    default = "Excluido: no es periodo inicial")]
  au[, registros_seleccionados := fifelse(seleccionado, registros, 0L)]
  x[au, on = .(archivo_id, archivo, anio, recinto, codigo_sesion),
    `:=`(periodo_inicio_candidato = i.seleccionado, periodo_ambiguo = i.ambiguo,
      razon_seleccion_periodo = i.razon)]
  x[, regimen := calendario]
  au[]
}

comprobar_diagnostico <- function() {
  mini <- clasificar_periodos(
    c("First Semester 2020-2021", "2nd Semester 2020-2021", "Quarter 1, 2020-2021",
      "Quarter 2, 2020-2021", "Annual MEDICINA 2020-2021", "Summer 2021",
      "Trimester 1 Dentistry 2020-2021", "1st Semester 2020-2021", "First Semester 2020-2021", ""),
    c("1", "2", "1", "2", "1", "1", "1", "2", NA_character_, "1"))
  stopifnot(identical(mini$seleccion_preliminar, c(TRUE, FALSE, TRUE, FALSE, TRUE,
    FALSE, TRUE, FALSE, TRUE, FALSE)), mini$contradiccion_texto_numero[8L],
    normalizar_anio("1999-00") == "1999-2000", is.na(normalizar_anio("2026-207")),
    all(vacio(c(NA_character_, "", "Sin definir", "Not Defined"))))
  p <- data.table(archivo_id = 1L, archivo = "Prueba.csv", anio = "2020-2021", recinto = "Prueba",
    codigo_sesion = c("A", "A", "B"), id = c("u1", "u2", "u3"),
    sesion = c("First Semester 2020-2021", "First Semester 2020-2021", "Quarter 1, 2020-2021"),
    numero_periodo = c("1", "2", "1"))
  a <- auditar_periodos(p)
  stopifnot(a[codigo_sesion == "A", ambiguo], !a[codigo_sesion == "A", seleccionado],
    a[codigo_sesion == "B", seleccionado], nrow(p[periodo_inicio_candidato == TRUE]) == 1L)
  p2 <- data.table(archivo_id = 1L, archivo = "Prueba.csv", anio = "2020-2021", recinto = "Prueba",
    codigo_sesion = c("A", "B"), id = c("u1", "u2"),
    sesion = "First Semester 2020-2021", numero_periodo = "1")
  a2 <- auditar_periodos(p2)
  stopifnot(all(a2$ambiguo), !any(a2$seleccionado))
  message("COMPROBACION RAPIDA CORRECTA: calendarios, contradicciones y seleccion por periodo completo.")
  invisible(TRUE)
}

# Extrae solo el ano expresado en el nombre; no adivina una errata.
anio_del_nombre <- function(f) {
  b <- sub("\\.csv$", "", basename(f), ignore.case = TRUE)
  token <- ifelse(grepl("[12][0-9]{3}-[0-9]+$", b),
    sub("^.*?([12][0-9]{3}-[0-9]+)$", "\\1", b, perl = TRUE), NA_character_)
  normalizar_anio(token)
}

leer_insumos_escolares <- function(raiz, destino) {
  carpeta <- file.path(raiz, "Informe_Escolaridad")
  rutas <- c("Informe_Escolaridad.Rmd", "Informe_Escolaridad.docx", "data/Publicas_18_anios.csv",
    "data/privadas_t.xlsx", "data/P_t.csv", "data/poptotal_edades_sencillas.csv")
  escolar <- data.table(archivo = rutas, ruta = file.path(carpeta, rutas))
  escolar[, `:=`(existe = file.exists(ruta), estado_lectura = "No aplica", detalle = NA_character_)]
  leer_g12 <- function(ruta, privado = FALSE) {
    x <- if (privado) as.data.table(readxl::read_excel(ruta)) else fread(file = ruta)
    if (privado) setnames(x, names(x)[1L], "anio")
    if (!all(c("anio", "G12") %in% names(x))) stop("Faltan anio/G12 en el insumo escolar.")
    y <- data.table(anio_escolar = normalizar_anio(x$anio),
      matricula_G12 = suppressWarnings(as.numeric(x$G12)),
      sector = if (privado) "Privada" else "Publica", estado_dato = "Observado")
    if (anyNA(y$anio_escolar) || anyNA(y$matricula_G12) || any(!is.finite(y$matricula_G12)) ||
      any(y$matricula_G12 < 0) || anyDuplicated(y$anio_escolar)) stop("Serie escolar invalida o duplicada.")
    y
  }
  series <- list()
  for (j in which(grepl("Publicas_18_anios\\.csv$|privadas_t\\.xlsx$", escolar$archivo))) {
    if (!escolar$existe[j]) next
    z <- tryCatch(leer_g12(escolar$ruta[j], grepl("\\.xlsx$", escolar$archivo[j])), error = function(e) e)
    if (inherits(z, "error")) escolar[j, `:=`(estado_lectura = "Error", detalle = conditionMessage(z))] else {
      escolar[j, `:=`(estado_lectura = "Leido", detalle = paste(min(z$anio_escolar), max(z$anio_escolar), sep = " a "))]
      series[[length(series) + 1L]] <- z
    }
  }
  serie <- bind(series)
  if (nrow(serie)) {
    exportar(serie, "11_matricula_G12_historica.csv", destino)
    g <- dcast(serie, anio_escolar ~ sector, value.var = "matricula_G12")
    for (col in c("Publica", "Privada")) if (!col %in% names(g)) g[, (col) := NA_real_]
    g[, anio_universitario := nombre_anio(as.integer(substr(anio_escolar, 1L, 4L)) + 1L)]
    g[, `:=`(total_G12_observado = Publica + Privada,
      ambos_sectores_observados = !is.na(Publica) & !is.na(Privada))]
    exportar(g, "12_alineacion_G12_ingreso_universitario.csv", destino)
  }
  j <- which(escolar$archivo == "data/poptotal_edades_sencillas.csv")
  if (escolar$existe[j]) {
    z <- tryCatch({
      p <- fread(file = escolar$ruta[j], check.names = FALSE)
      if (!all(c("variant", "age") %in% names(p))) stop("Faltan variant/age en la proyeccion demografica.")
      anos <- names(p)[grepl("^[0-9]{4}$", names(p))]
      if (!length(anos)) stop("No se encontraron columnas de anos.")
      paste0("Variantes: ", pegar(p$variant), "; anos: ", pegar(anos),
        ". Se inventario la estructura; no se calcularon graduados ni proyecciones.")
    }, error = function(e) e)
    if (inherits(z, "error")) escolar[j, `:=`(estado_lectura = "Error", detalle = conditionMessage(z))] else
      escolar[j, `:=`(estado_lectura = "Leido", detalle = z)]
  }
  exportar(escolar, "10_inventario_insumos_escolares.csv", destino)
  escolar
}

ejecutar_diagnostico <- function(raiz, anios_inicio, guardar_microdatos) {
  comprobar_diagnostico()
  carpetas <- list.dirs(raiz, recursive = FALSE, full.names = TRUE)
  carpetas <- carpetas[!is.na(normalizar_anio(basename(carpetas)))]
  if (!length(carpetas)) stop("No se encontraron carpetas de anos junto al script.", call. = FALSE)
  marca <- paste0(format(Sys.time(), "%Y%m%d_%H%M%S"), "_", Sys.getpid())
  destino <- file.path(raiz, "resultados", paste0("diagnostico_", marca))
  if (!dir.create(destino, recursive = TRUE, showWarnings = FALSE)) stop("No se pudo crear la carpeta de resultados.")
  if (guardar_microdatos && !dir.create(file.path(destino, "bases_limpias"))) stop("No se pudo crear bases_limpias.")
  message("Etapa 1 v", version_diagnostico, ". Resultados: ", destino)
  inventario <- rbindlist(lapply(carpetas, function(d) {
    f <- list.files(d, pattern = "\\.csv$", full.names = TRUE, ignore.case = TRUE)
    if (!length(f)) return(NULL)
    info <- file.info(f)
    data.table(archivo = basename(f), ruta = f, anio_carpeta = normalizar_anio(basename(d)),
      anio_archivo = anio_del_nombre(f), recinto_archivo = normalizar_recinto(basename(f)),
      tamano_mb = round(info$size / 1024^2, 2), tamano_bytes = info$size,
      modificacion_inicial = as.numeric(info$mtime),
      modificacion_utc = format(info$mtime, "%Y-%m-%d %H:%M:%S", tz = "UTC"))
  }), use.names = TRUE, fill = TRUE)
  if (!nrow(inventario)) stop("Las carpetas no contienen archivos CSV.", call. = FALSE)
  setorder(inventario, anio_carpeta, archivo)
  inventario[, archivo_id := seq_len(.N)]
  inventario[, archivos_mismo_recinto_anio := .N, by = .(anio_carpeta, recinto_archivo)]
  inventario[, `:=`(estado = "Pendiente", error = NA_character_, advertencias = NA_character_,
    recinto_efectivo = NA_character_, anio_efectivo = NA_character_, rds_guardado = FALSE,
    ruta_rds_relativa = NA_character_)]
  partes <- setNames(vector("list", 10L), c("variables", "periodos", "categorias", "ingreso", "cruce_ingreso",
    "cohortes", "calidad", "enlace", "seleccion", "resumen"))
  partes <- lapply(partes, function(z) list())
  avisos_total <- list()
  agregar_aviso <- function(meta, tipo, detalle) {
    avisos_total[[length(avisos_total) + 1L]] <<- data.table(archivo_id = meta$archivo_id,
      archivo = meta$archivo, anio_carpeta = meta$anio_carpeta, tipo = tipo, detalle = detalle)
  }

  for (i in seq_len(nrow(inventario))) {
    meta <- inventario[i]; avisos <- character()
    message(sprintf("[%d/%d] %s / %s", i, nrow(inventario), meta$anio_carpeta, meta$archivo))
    resultado <- tryCatch(withCallingHandlers({
      largo <- withCallingHandlers(fread(file = meta$ruta, colClasses = "character", encoding = "UTF-8",
        na.strings = NULL, blank.lines.skip = TRUE, strip.white = FALSE, showProgress = FALSE),
        warning = function(w) stop("Lectura CSV con advertencia: ", conditionMessage(w)))
      if (!identical(names(largo), c("ColumnName", "Value"))) stop("Cabecera distinta de ColumnName,Value.")
      largo[, ColumnName := limpiar(ColumnName)]
      if (any(vacio(largo$ColumnName))) stop("Hay filas sin nombre de variable; no se descartaron automaticamente.")
      if (!nrow(largo) || largo$ColumnName[1L] != "Location") stop("El primer bloque no empieza en Location.")
      largo[, bloque := cumsum(ColumnName == "Location")]
      rep <- largo[, .N, by = .(bloque, ColumnName)][N > 1L]
      if (nrow(rep)) stop("Hay claves repetidas dentro de bloques; no se agregaron ni descartaron.")
      n_bloques <- max(largo$bloque)
      frecuencia <- largo[, .N, by = ColumnName]
      frecuencia[, `:=`(archivo_id = meta$archivo_id, archivo = meta$archivo, anio_carpeta = meta$anio_carpeta,
        presente_en_todos = N == n_bloques)]
      partes$variables[[length(partes$variables) + 1L]] <- copy(frecuencia)
      ausentes <- setdiff(obligatorios, frecuencia$ColumnName)
      if (length(ausentes)) stop("Faltan campos obligatorios: ", paste(ausentes, collapse = ", "))
      if (any(frecuencia$N != n_bloques)) stop("Bloques incompletos o con conjuntos de claves diferentes; consultar 03.")
      ancho <- dcast(largo[ColumnName %in% campos], bloque ~ ColumnName, value.var = "Value", fill = NA_character_)
      if (nrow(ancho) != n_bloques) stop("No se reconstruyeron exactamente todos los bloques.")
      rm(largo)
      for (f in setdiff(campos, names(ancho))) ancho[, (f) := NA_character_]
      setnames(ancho, names(renombres), unname(renombres))
      texto <- setdiff(names(ancho), "bloque")
      ancho[, (texto) := lapply(.SD, limpiar), .SDcols = texto]
      ancho[, `:=`(archivo_id = meta$archivo_id, archivo = meta$archivo, anio_carpeta = meta$anio_carpeta,
        anio = normalizar_anio(anio_original), recinto = normalizar_recinto(recinto_original),
        nivel = etiqueta(nivel_original), clasificacion = etiqueta(clasificacion_original),
        tipo_ingreso = etiqueta(tipo_ingreso_original), sexo = etiqueta(sexo_original))]
      recinto_valido <- unique(ancho$recinto[!is.na(ancho$recinto)])
      recinto_efectivo <- if (length(recinto_valido) == 1L && !anyNA(ancho$recinto)) recinto_valido else NA_character_
      anios_validos <- unique(ancho$anio[!is.na(ancho$anio)])
      anio_efectivo <- if (length(anios_validos) == 1L && !anyNA(ancho$anio)) anios_validos else NA_character_
      ancho[is.na(recinto), recinto := paste0("Sin homologar: ", etiqueta(recinto_original))]
      ancho[, escuela := fcase(clave(escuela_original) == "public", "Publica",
        clave(escuela_original) == "private", "Privada",
        rep(TRUE, .N), etiqueta(escuela_original), default = NA_character_)]
      auditoria <- auditar_periodos(ancho)
      ancho[, `:=`(cohorte = normalizar_anio(cohorte_original), primer_anio = normalizar_anio(primer_anio_original),
        admision_anio = normalizar_anio(admision_anio_original))]
      ancho[, `:=`(anio_inicio = suppressWarnings(as.integer(substr(anio, 1L, 4L))),
        cohorte_inicio = suppressWarnings(as.integer(substr(cohorte, 1L, 4L))),
        primero_inicio = suppressWarnings(as.integer(substr(primer_anio, 1L, 4L))),
        admision_inicio = suppressWarnings(as.integer(substr(admision_anio, 1L, 4L))))]
      ancho[, `:=`(cohorte_futura = !is.na(cohorte_inicio) & !is.na(anio_inicio) & cohorte_inicio > anio_inicio,
        admision_futura = !is.na(admision_inicio) & !is.na(anio_inicio) & admision_inicio > anio_inicio,
        primero_futuro = !is.na(primero_inicio) & !is.na(anio_inicio) & primero_inicio > anio_inicio,
        candidato_desde_secundaria = clave(tipo_ingreso) == "deescuelasecundaria")]
      ancho[, `:=`(cohorte_mismo_anio = !is.na(cohorte) & !is.na(anio) & cohorte == anio,
        primer_anio_mismo_anio = !is.na(primer_anio) & !is.na(anio) & primer_anio == anio,
        admision_mismo_anio = !is.na(admision_anio) & !is.na(anio) & admision_anio == anio)]
      ancho[, clasificacion_escolar := grepl("escuelasuperior|highschool", clave(clasificacion)) |
        clave(nivel) %in% c("ss", "highschool", "escuelasuperior")]
      ancho[, clasificacion_no_grado := clasificacion_escolar | grepl(
        "certificadopost|educacioncontinuada|estudiantesnogrado|estudiantestransitorios|permisoespecial|mejoramiento|especialgraduado|transitoriosgraduado",
        clave(clasificacion))]
      ancho[, candidato_ingreso_universitario := candidato_desde_secundaria & !clasificacion_no_grado &
        clave(nivel) %in% c("bach", "asoc")]
      # Estos son campos originales normalizados, no un origen reconstruido.
      ancho[, antiguedad_cohorte := anio_inicio - cohorte_inicio + 1L]
      ancho[, grupo_antiguedad_candidato := fcase(is.na(antiguedad_cohorte), "Sin cohorte valida",
        antiguedad_cohorte < 1L, "Cohorte futura: revisar", antiguedad_cohorte >= 5L, "5 o mas",
        rep(TRUE, .N), as.character(antiguedad_cohorte), default = NA_character_)]

      grupo <- c("archivo_id", "archivo", "anio", "recinto", "codigo_sesion", "sesion", "regimen")
      ancho[, duplicado_persona_periodo := duplicated(.SD) & !vacio(id),
        .SDcols = c("id", "recinto", "anio", "codigo_sesion")]
      per <- ancho[, .(registros = .N, personas = personas(id), sin_id = sum(vacio(id)),
        duplicados_persona_periodo = sum(duplicado_persona_periodo),
        periodo_inicio_candidato = all(periodo_inicio_candidato),
        registros_seleccionados = sum(periodo_inicio_candidato),
        periodo_ambiguo = any(periodo_ambiguo)), by = grupo]
      cat <- ancho[, .(registros = .N, personas = personas(id)),
        by = c(grupo, "nivel", "clasificacion", "tipo_ingreso", "sexo", "escuela")]
      ing <- ancho[periodo_inicio_candidato == TRUE, .(registros = .N, personas = personas(id),
        desde_secundaria = personas(id[candidato_desde_secundaria]),
        desde_secundaria_escolar = personas(id[candidato_desde_secundaria & clasificacion_escolar]),
        desde_secundaria_universitario_candidato = personas(id[candidato_ingreso_universitario]),
        cohorte_mismo_anio = personas(id[cohorte_mismo_anio]),
        primer_anio_mismo_anio = personas(id[primer_anio_mismo_anio]),
        admision_mismo_anio = personas(id[admision_mismo_anio]),
        personas_cohorte_futura = personas(id[cohorte_futura]),
        personas_admision_futura = personas(id[admision_futura])), by = c(grupo, "nivel", "clasificacion")]
      cruce <- ancho[periodo_inicio_candidato == TRUE, .(registros = .N, personas = personas(id)),
        by = c(grupo, "nivel", "clasificacion", "tipo_ingreso", "candidato_desde_secundaria", "clasificacion_escolar",
          "clasificacion_no_grado", "candidato_ingreso_universitario", "cohorte_mismo_anio", "primer_anio_mismo_anio",
          "admision_mismo_anio", "cohorte_futura", "admision_futura")]
      coh <- ancho[periodo_inicio_candidato == TRUE, .(registros = .N, personas = personas(id)),
        by = c(grupo, "nivel", "cohorte_nivel", "cohorte", "grupo_antiguedad_candidato")]
      faltan_nucleares <- ancho[, Reduce(`|`, lapply(.SD, vacio)),
        .SDcols = c("id", "recinto_original", "anio_original", "codigo_sesion", "sesion")]
      n_mal_anio <- sum(is.na(ancho$anio) | ancho$anio != meta$anio_carpeta, na.rm = TRUE)
      n_recinto_sin_homologar <- sum(grepl("^Sin homologar:", ancho$recinto))
      n_mal_recinto <- if (is.na(meta$recinto_archivo)) NA_integer_ else
        sum(ancho$recinto != meta$recinto_archivo, na.rm = TRUE)
      n_dup <- sum(ancho$duplicado_persona_periodo)
      estructural <- n_mal_anio > 0L || is.na(recinto_efectivo) || n_recinto_sin_homologar > 0L ||
        sum(faltan_nucleares) > 0L || n_dup > 0L
      calidad <- data.table(archivo_id = meta$archivo_id, anio_carpeta = meta$anio_carpeta, archivo = meta$archivo,
        registros = nrow(ancho), campos_exportados = nrow(frecuencia), personas_todos_periodos = personas(ancho$id),
        anios_contenido = pegar(ancho$anio), recintos_contenido = pegar(ancho$recinto),
        registros_anio_discordante = n_mal_anio, registros_recinto_discordante = n_mal_recinto,
        registros_recinto_sin_homologar = n_recinto_sin_homologar,
        registros_campos_nucleares_vacios = sum(faltan_nucleares), duplicados_persona_periodo = n_dup,
        archivos_mismo_recinto_anio = meta$archivos_mismo_recinto_anio,
        registros_sin_cohorte_valida = sum(is.na(ancho$cohorte)), registros_cohorte_futura = sum(ancho$cohorte_futura),
        registros_admision_futura = sum(ancho$admision_futura), registros_primera_matricula_futura = sum(ancho$primero_futuro),
        periodos_ambiguos = sum(auditoria$ambiguo), periodos_sin_identificar = sum(auditoria$calendario == "Sin identificar"),
        problema_estructural = estructural,
        estado = if (estructural) "Revisar antes de usar" else "Estructura reconstruida")
      for (nombre in c("per", "cat", "ing", "cruce", "coh")) {
        obj <- get(nombre); obj[, estado_calidad := calidad$estado]; assign(nombre, obj)
      }
      ancho[, estado_calidad_archivo := calidad$estado]
      resumen_anual <- ancho[, .(registros_todos_periodos = .N, personas_todos_periodos = personas(id),
        sin_id_todos_periodos = sum(vacio(id)),
        registros_repetidos_todos_periodos = sum(!vacio(id)) - personas(id),
        periodos_todos = uniqueN(codigo_sesion),
        registros_inicio_candidato = sum(periodo_inicio_candidato),
        personas_inicio_candidato = personas(id[periodo_inicio_candidato]),
        sin_id_inicio_candidato = sum(periodo_inicio_candidato & vacio(id)),
        registros_repetidos_inicio_candidato = sum(periodo_inicio_candidato & !vacio(id)) -
          personas(id[periodo_inicio_candidato]),
        periodos_inicio_candidato = uniqueN(codigo_sesion[periodo_inicio_candidato])),
        by = .(archivo_id, archivo, anio, recinto)]
      resumen_anual[, interpretacion := "Personas dentro de recinto y ano; no son personas unicas de todo el sistema"]
      if (is.na(meta$recinto_archivo) || is.na(recinto_efectivo) || meta$recinto_archivo != recinto_efectivo) {
        aviso <- paste0("Recinto del nombre: ", ifelse(is.na(meta$recinto_archivo), "sin homologar", meta$recinto_archivo),
          "; contenido: ", ifelse(is.na(recinto_efectivo), "ambiguo/sin homologar", recinto_efectivo),
          ". No se modifico el archivo; la cobertura usa el contenido inequivoco.")
        avisos <- c(avisos, aviso); agregar_aviso(meta, "Nombre de recinto", aviso)
      }
      if (is.na(meta$anio_archivo) || meta$anio_archivo != meta$anio_carpeta) {
        aviso <- "El ano del nombre es invalido, esta ausente o difiere de la carpeta; no se corrigio el nombre."
        avisos <- c(avisos, aviso); agregar_aviso(meta, "Nombre de ano", aviso)
      }
      if (estructural) agregar_aviso(meta, "Estructura", "Revisar los controles de 08; el archivo no habilita la etapa siguiente.")
      if (any(auditoria$ambiguo)) agregar_aviso(meta, "Periodo bloqueado", "Hay periodos ambiguos excluidos; ver codigos y razones en 13.")
      if (any(auditoria$calendario == "Sin identificar")) agregar_aviso(meta, "Calendario desconocido", "Hay periodos sin clasificar; no se incluyeron en candidatos de inicio; ver 13.")
      if (any(auditoria$usa_solo_numero & auditoria$seleccionado)) agregar_aviso(meta, "Seleccion por numero",
        "Se uso numero 1 sin ordinal identificable en la etiqueta; revisar 13 antes de aprobar el censo.")
      info_final <- file.info(meta$ruta)
      if (is.na(info_final$size) || is.na(info_final$mtime) || info_final$size != meta$tamano_bytes ||
        as.numeric(info_final$mtime) != meta$modificacion_inicial) stop("El archivo original cambio durante la lectura; repetir el diagnostico.")
      nombre_rds <- NA_character_
      if (guardar_microdatos) {
        nombre_rds <- sprintf("%03d_%s_%s.rds", meta$archivo_id, meta$anio_carpeta,
          ifelse(is.na(recinto_efectivo), "Sin_homologar", recinto_efectivo))
        temporal <- tempfile(pattern = "base_", tmpdir = file.path(destino, "bases_limpias"))
        tryCatch({
          saveRDS(ancho, temporal, compress = "gzip")
          if (!file.rename(temporal, file.path(destino, "bases_limpias", nombre_rds))) stop("No se pudo guardar el RDS.")
        }, finally = { if (file.exists(temporal)) unlink(temporal) })
      }
      partes$periodos[[length(partes$periodos) + 1L]] <- per
      partes$categorias[[length(partes$categorias) + 1L]] <- cat
      partes$ingreso[[length(partes$ingreso) + 1L]] <- ing
      partes$cruce_ingreso[[length(partes$cruce_ingreso) + 1L]] <- cruce
      partes$cohortes[[length(partes$cohortes) + 1L]] <- coh
      partes$calidad[[length(partes$calidad) + 1L]] <- calidad
      partes$seleccion[[length(partes$seleccion) + 1L]] <- auditoria
      partes$resumen[[length(partes$resumen) + 1L]] <- resumen_anual
      if (!estructural) partes$enlace[[length(partes$enlace) + 1L]] <- unique(ancho[
        periodo_inicio_candidato == TRUE, .(archivo_id, anio_inicio, recinto, regimen, codigo_sesion, id)])
      list(calidad = calidad, recinto_efectivo = recinto_efectivo, anio_efectivo = anio_efectivo,
        rds = nombre_rds)
    }, warning = function(w) {
      avisos <<- c(avisos, conditionMessage(w)); invokeRestart("muffleWarning")
    }), error = function(e) list(error = conditionMessage(e)))
    if (!is.null(resultado$error)) {
      set(inventario, i, "estado", "Error: revisar"); set(inventario, i, "error", resultado$error)
      agregar_aviso(meta, "Error de procesamiento", resultado$error)
      message("  REVISION NECESARIA: ", resultado$error)
    } else {
      set(inventario, i, "estado", resultado$calidad$estado)
      set(inventario, i, "recinto_efectivo", resultado$recinto_efectivo)
      set(inventario, i, "anio_efectivo", resultado$anio_efectivo)
      if (!is.na(resultado$rds)) {
        set(inventario, i, "rds_guardado", TRUE)
        set(inventario, i, "ruta_rds_relativa", file.path("bases_limpias", resultado$rds))
      }
    }
    if (length(avisos)) set(inventario, i, "advertencias", paste(unique(avisos), collapse = " | "))
    exportar(inventario, "01_inventario_archivos.csv", destino)
    if (exists("ancho", inherits = FALSE)) rm(ancho)
    if (exists("largo", inherits = FALSE)) rm(largo)
    invisible(gc(verbose = FALSE))
  }

  # Cobertura final por el CONTENIDO: una errata de nombre no crea un faltante.
  cobertura <- CJ(anio_carpeta = nombre_anio(anios_inicio), recinto_archivo = recintos_esperados)
  conteo <- inventario[!is.na(recinto_efectivo) & !is.na(anio_efectivo) & anio_efectivo == anio_carpeta,
    .(n_archivos = .N, archivos = pegar(archivo),
      archivos_con_error_estructural = sum(estado != "Estructura reconstruida")),
    by = .(anio_carpeta, recinto_archivo = recinto_efectivo)]
  cobertura <- merge(cobertura, conteo, by = c("anio_carpeta", "recinto_archivo"), all = TRUE)
  cobertura[is.na(n_archivos), `:=`(n_archivos = 0L, archivos_con_error_estructural = 0L)]
  cobertura[, esperado := anio_carpeta %in% nombre_anio(anios_inicio) & recinto_archivo %in% recintos_esperados]
  cobertura[, estado := fcase(!esperado, "Fuera de cobertura prevista: revisar",
    n_archivos == 0L, "Falta archivo", n_archivos > 1L, "Mas de un archivo: revisar",
    archivos_con_error_estructural > 0L, "Archivo con problema estructural", default = "Encontrado por contenido")]
  duplicados <- conteo[n_archivos > 1L]
  calidad_total <- bind(partes$calidad)
  if (nrow(calidad_total)) {
    calidad_total[inventario, on = "archivo_id", `:=`(recinto_efectivo = i.recinto_efectivo,
      anio_efectivo = i.anio_efectivo, rds_guardado = i.rds_guardado)]
    efectivas <- inventario[!is.na(recinto_efectivo) & !is.na(anio_efectivo), .N,
      by = .(anio_efectivo, recinto_efectivo)]
    calidad_total[efectivas, on = .(anio_efectivo, recinto_efectivo), archivos_mismo_recinto_anio := i.N]
  }
  for (j in seq_len(nrow(duplicados))) {
    filas <- inventario[anio_efectivo == duplicados$anio_carpeta[j] & recinto_efectivo == duplicados$recinto_archivo[j]]
    for (k in seq_len(nrow(filas))) agregar_aviso(filas[k], "Contenido duplicado",
      "Hay mas de un archivo para el mismo recinto y ano; no sumar ni escoger automaticamente.")
  }
  exportar(cobertura, "02_cobertura_recinto_anio.csv", destino)
  exportar(bind(partes$variables), "03_variables_por_archivo.csv", destino)
  exportar(bind(partes$periodos), "04_matricula_por_periodo.csv", destino)
  exportar(bind(partes$categorias), "05_nivel_clasificacion_ingreso.csv", destino)
  exportar(bind(partes$ingreso), "06_indicadores_ingreso_candidatos.csv", destino)
  exportar(bind(partes$cruce_ingreso), "06b_concordancia_definiciones_ingreso.csv", destino)
  exportar(bind(partes$cohortes), "07_cohortes_candidatas.csv", destino)
  exportar(calidad_total, "08_calidad_por_archivo.csv", destino)
  seleccion <- bind(partes$seleccion)
  exportar(seleccion, "13_seleccion_periodos.csv", destino)
  cobertura_cal <- data.table()
  if (nrow(seleccion)) {
    cobertura_cal <- seleccion[, .(periodos = .N, registros = sum(registros),
      periodos_iniciales_candidatos = sum(seleccionado), registros_inicio_candidato = sum(registros_seleccionados),
      periodos_bloqueados = sum(ambiguo)), by = .(archivo_id, archivo, anio, recinto, calendario)]
    cobertura_cal[, estado := fcase(calendario == "Verano", "Verano: no se propone como censo inicial",
      calendario == "Sin identificar", "Calendario desconocido: revisar",
      periodos_bloqueados > 0L, "Hay periodos bloqueados: revisar 13",
      periodos_iniciales_candidatos == 0L, "Sin periodo inicial; solo se observaron otros periodos: revisar",
      default = "Periodo inicial/anual candidato identificado")]
    for (j in which(cobertura_cal$periodos_iniciales_candidatos == 0L &
      !cobertura_cal$calendario %in% c("Verano", "Sin identificar"))) {
      metaj <- inventario[archivo_id == cobertura_cal$archivo_id[j]]
      agregar_aviso(metaj, "Falta periodo inicial",
        paste0("Calendario ", cobertura_cal$calendario[j], ": existen registros, pero ningun periodo inicial candidato; ver 14."))
    }
  }
  exportar(cobertura_cal, "14_cobertura_calendarios.csv", destino)
  resumen_personas <- bind(partes$resumen)
  exportar(resumen_personas, "15_personas_por_recinto_anio.csv", destino)

  # Solapamiento bruto separado por calendario; no es retencion validada.
  enlaces <- bind(partes$enlace); solapamientos <- list()
  if (nrow(enlaces)) {
    combinaciones <- unique(enlaces[, .(anio_inicio, recinto, regimen)])
    for (j in seq_len(nrow(combinaciones))) {
      a <- combinaciones$anio_inicio[j]; r <- combinaciones$recinto[j]; g <- combinaciones$regimen[j]
      antes <- enlaces[anio_inicio == a & recinto == r & regimen == g]
      despues <- enlaces[anio_inicio == a + 1L & recinto == r & regimen == g]
      if (!nrow(despues) || uniqueN(antes$archivo_id) != 1L || uniqueN(despues$archivo_id) != 1L ||
        uniqueN(antes$codigo_sesion) != 1L || uniqueN(despues$codigo_sesion) != 1L) next
      ids_a <- unique(antes$id); ids_b <- unique(despues$id); comun <- length(intersect(ids_a, ids_b))
      solapamientos[[length(solapamientos) + 1L]] <- data.table(recinto = r, regimen = g,
        anio_anterior = nombre_anio(a), anio_siguiente = nombre_anio(a + 1L),
        personas_anterior = length(ids_a), personas_siguiente = length(ids_b), identificadores_comunes = comun,
        presentes_siguiente_sobre_anterior = comun / length(ids_a),
        sin_antecedente_en_recinto = length(setdiff(ids_b, ids_a)),
        ausentes_siguiente_en_recinto = length(setdiff(ids_a, ids_b)),
        interpretacion = "Solapamiento bruto; no prueba estabilidad del identificador ni retencion")
    }
  }
  exportar(bind(solapamientos), "09_solapamiento_identificadores.csv", destino)
  rm(enlaces)
  escolar <- leer_insumos_escolares(raiz, destino)
  avisos <- bind(avisos_total)
  if (!ncol(avisos)) avisos <- data.table(archivo_id = integer(), archivo = character(), anio_carpeta = character(), tipo = character(), detalle = character())
  exportar(avisos, "16_avisos_diagnostico.csv", destino)
  n_error <- sum(inventario$estado == "Error: revisar")
  n_estructural <- if (nrow(calidad_total)) sum(calidad_total$problema_estructural) else 0L
  n_falta <- cobertura[esperado == TRUE, sum(n_archivos == 0L)]
  n_duplicados <- cobertura[esperado == TRUE, sum(n_archivos > 1L)]
  n_fuera <- sum(!cobertura$esperado)
  n_ambiguos <- if (nrow(seleccion)) sum(seleccion$ambiguo) else 0L
  rds_existen <- if (guardar_microdatos) sum(file.exists(file.path(destino,
    inventario$ruta_rds_relativa[inventario$rds_guardado]))) else 0L
  completo <- n_error == 0L && n_estructural == 0L && n_falta == 0L && n_duplicados == 0L &&
    n_fuera == 0L && nrow(inventario) == length(anios_inicio) * length(recintos_esperados) &&
    nrow(calidad_total) == nrow(inventario) && guardar_microdatos && rds_existen == nrow(inventario)
  estado_ejecucion <- data.table(version = version_diagnostico,
    fecha_utc = format(Sys.time(), "%Y-%m-%d %H:%M:%S", tz = "UTC"),
    procesamiento_completo = completo, revision_tecnica_pendiente = TRUE, metodologia_aprobada = FALSE,
    archivos_encontrados = nrow(inventario), archivos_reconstruidos = nrow(calidad_total),
    archivos_con_error = n_error, archivos_con_problema_estructural = n_estructural,
    combinaciones_faltantes = n_falta, combinaciones_duplicadas = n_duplicados,
    combinaciones_fuera_de_cobertura = n_fuera, rds_guardados = rds_existen,
    registros_todos_periodos = if (nrow(calidad_total)) sum(calidad_total$registros) else 0L,
    registros_inicio_candidato = if (nrow(seleccion)) sum(seleccion$registros_seleccionados) else 0L,
    filas_persona_recinto_anio_inicio = if (nrow(resumen_personas)) sum(resumen_personas$personas_inicio_candidato) else 0L,
    periodos_bloqueados = n_ambiguos, avisos = nrow(avisos))
  exportar(estado_ejecucion, "17_estado_ejecucion.csv", destino)
  conf <- data.table(parametro = c("version", "anios_inicio", "recintos_esperados", "guardar_microdatos",
    "seleccion", "cohortes", "cache", "version_R", paste0("paquete_", paquetes)),
    valor = c(version_diagnostico, paste(anios_inicio, collapse = ","), paste(recintos_esperados, collapse = ","),
      as.character(guardar_microdatos), "Inicio por calendario y periodo anual; revisar 13 y 14",
      "Solo campos originales; no se reconstruyen origenes", "No se reutilizaron resultados anteriores",
      R.version.string, vapply(paquetes, function(p) as.character(utils::packageVersion(p)), character(1))))
  exportar(conf, "18_configuracion_diagnostico.csv", destino)
  resumen <- c("DIAGNOSTICO INICIAL DE MATRICULA UPR - ETAPA 1 v2.0", "",
    paste("Raiz:", raiz), paste("CSV encontrados:", nrow(inventario)),
    paste("Archivos reconstruidos:", nrow(calidad_total)), paste("Errores de procesamiento:", n_error),
    paste("Archivos con problemas estructurales:", n_estructural), paste("RDS completos guardados:", rds_existen),
    paste("Combinaciones de recinto y ano faltantes:", n_falta), paste("Combinaciones duplicadas:", n_duplicados),
    paste("Procesamiento completo:", completo), paste("Periodos ambiguos bloqueados:", n_ambiguos),
    paste("Avisos para revision:", nrow(avisos)), "",
    "ALCANCE", "Se leyeron de nuevo los CSV originales. No se reutilizaron resultados anteriores.",
    "Los RDS conservan todos los registros y periodos reconstruidos; no se filtraron al censo inicial.",
    "La cobertura por recinto y ano se establece por contenido inequivoco, manteniendo avisos del nombre.",
    "Quarter conserva su etiqueta: el codigo no infiere su duracion institucional.",
    "Verano, periodo anual e inicio de cada calendario tienen reglas y razones explicitas en 13.",
    "Un periodo contradictorio se bloquea completo; no se escogen unas filas y se ocultan otras.",
    "La falta de inicio cuando hay periodos posteriores se advierte en 14; no se inventa un censo.",
    "Los registros de escuela superior se etiquetan, pero no se eliminan de los RDS ni de los totales.", "",
    "ORDEN DE REVISION", "1. 17: estado del procesamiento. Completo no significa metodologia aprobada.",
    "2. 01, 02 y 08: cobertura, errores, nombres discrepantes, duplicados y campos nucleares.",
    "3. 13, 14 y 16: periodos incluidos/excluidos, ambiguedades y calendarios sin inicio.",
    "4. 04 y 15: contrastar todos los periodos con la union candidata de periodos iniciales.",
    "5. 05, 06 y 06b: nivel, clasificacion escolar y candidatos de ingreso universitario.",
    "6. 07 y 09: campos de cohorte originales y solapamiento bruto de identificadores.",
    "7. 10, 11 y 12: inventario escolar, G12 observada y alineacion con el siguiente curso universitario.", "",
    "INTERPRETACION", "No sumar periodos para obtener personas distintas del ano.",
    "La tabla 15 cuenta personas dentro de cada recinto y ano; su suma no deduplica todo el sistema.",
    "Las personas de categorias de 05 y las columnas superpuestas de 06 no deben sumarse automaticamente.",
    "Desde_secundaria conserva el candidato original; desde_secundaria_universitario_candidato excluye",
    "clasificaciones escolares/no grado y exige nivel Bach o Asoc. Sigue siendo una definicion por validar.",
    "No se reconstruyeron cohortes ni se calcularon tasas de continuidad o proyecciones.",
    "Una cohorte futura o desconocida queda documentada; no se imputa ni corrige automaticamente.",
    "La coincidencia de identificadores no certifica por si sola su estabilidad institucional.",
    "Se propone un censo inicial/anual por calendario, no matricula anual de ambos semestres.",
    "2026-2027 carece del segundo semestre completo; su censo inicial requiere comprobar consolidacion.",
    "G12 representa matricula de duodecimo, no graduados efectivos. Mayaguez sigue fuera del alcance.", "",
    "PARA COMPARTIR", "Enviar TODOS los CSV y LEER_PRIMERO.txt, sesion_R.txt y COMPLETO.txt si existe.",
    "No compartir bases_limpias ni archivos RDS: contienen identificadores.",
    "No ejecutar todavia la etapa 2: revisar primero los resultados de esta etapa.",
    "Si faltan 09, 11 o 12, los datos correspondientes no permitieron generarlos; revisar 01, 08 y 10.")
  writeLines(enc2utf8(resumen), file.path(destino, "LEER_PRIMERO.txt"), useBytes = TRUE)
  capture.output(sessionInfo(), file = file.path(destino, "sesion_R.txt"))
  if (completo) writeLines(c("ETAPA 1 v2.0: PROCESAMIENTO COMPLETO", "",
    "Todos los archivos previstos se reconstruyeron y guardaron en RDS completos.",
    "Este sello no aprueba la seleccion de censos ni la metodologia.",
    "Revisar las advertencias, los periodos bloqueados y las tablas 13 a 17 antes de la etapa 2."),
    file.path(destino, "COMPLETO.txt"))
  message(if (completo) "DIAGNOSTICO COMPLETO PARA REVISION TECNICA." else "DIAGNOSTICO CON INCIDENCIAS: REVISAR ANTES DE CONTINUAR.")
  message("Resultados: ", destino)
  message("Comparte los CSV y TXT. No ejecutes aun la etapa 2.")
  invisible(destino)
}

ruta_resultados <- ejecutar_diagnostico(raiz, anios_inicio, guardar_microdatos)
