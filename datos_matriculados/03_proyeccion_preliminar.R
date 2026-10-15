# Proyeccion preliminar UPR | Etapa 3 | Version 2.0 | 15 octubre 2026
# Guardar en datos_matriculados, junto a los scripts 01 y 02; pulsar Source.
# Lee SOLO los CSV terminados de etapa 2 y los cuatro insumos escolares.
# No repite la lectura de los 100 CSV ni de los RDS universitarios.
# install.packages(c("data.table", "this.path", "readxl"))  # si faltan
# Salida para revision: tablas, dos PNG y vista HTML. Informe y presentacion finales se preparan despues de validar esta etapa.
# Escenario central hasta 2050-2051; ventanas 3/5 como sensibilidad, no intervalos.

paquetes <- c("data.table", "this.path", "readxl")
faltan <- paquetes[!vapply(paquetes, requireNamespace, logical(1), quietly = TRUE)]
if (length(faltan)) stop("Falta instalar: ", paste(faltan, collapse = ", "), call. = FALSE)
suppressPackageStartupMessages(library(data.table))
raiz <- normalizePath(this.path::this.dir(), winslash = "/", mustWork = TRUE)
version_etapa3 <- "2.0"
carpeta_etapa2 <- NULL  # NULL = ultima etapa 2 COMPLETA v2
config <- list(base = 2025L, horizonte = 2050L, ventana = 5L,
               ventanas_sensibilidad = c(3L, 5L), umbral_aux = 100L,
               umbral_exposicion_informativa = 20L, validacion = 2023:2025)
estados <- c("1", "2", "3", "4", "5 o mas", "Sin origen")
etiqueta_anio <- function(a) paste0(a, "-", a + 1L)
exportar <- function(x, archivo, destino) fwrite(x, file.path(destino, archivo), bom = TRUE, na = "")
agregar_anio <- function(x, col = "anio") {
  x[, anio_inicio := suppressWarnings(as.integer(substr(get(col), 1L, 4L)))]
  if (anyNA(x$anio_inicio)) stop("Hay anos invalidos en ", col)
  x
}

# Componente escolar para integrar en 03_proyeccion_preliminar.R.
# No lee microdatos universitarios ni modifica los cuatro insumos originales.
#
# construir_G12(raiz, horizonte = 2050L) devuelve una lista de data.tables:
# anual: anio_escolar, anio_inicio, publica, privada, total_G12,
#        estado_publica, estado_privada, estado_total, es_anclaje.
# quinquenal: las mismas columnas para 2025, 2030, ...; ademas poblacion_17
#             y factor_poblacion_17 respecto a 2025.
# fuentes: archivo, ruta, serie, anio_inicio, anio_fin, nota.
#
# Estados: observado, estimado, escenario_quinquenal,
#          escenario_interpolado y no_disponible.
# Las cifras representan matricula de G12, no graduados efectivos.
# La extension privada reproduce el Monte Carlo del Informe_Escolaridad.Rmd.
# Despues de 2025 se usa un escenario condicionado a la mediana demografica;
# interpolar anos no crea percentiles demograficos ni intervalos predictivos.
construir_G12 <- function(raiz, horizonte = 2050L) {
  if (!requireNamespace("data.table", quietly = TRUE) ||
      !requireNamespace("readxl", quietly = TRUE)) {
    stop("El componente escolar requiere data.table y readxl.")
  }
  if (length(raiz) != 1L || is.na(raiz) || !dir.exists(raiz)) {
    stop("raiz debe ser una carpeta existente.")
  }
  if (length(horizonte) != 1L || !is.numeric(horizonte) ||
      !is.finite(horizonte) || horizonte != as.integer(horizonte) ||
      horizonte < 2025L) {
    stop("horizonte debe ser un ano entero mayor o igual a 2025.")
  }
  horizonte <- as.integer(horizonte)
  raiz <- normalizePath(raiz, winslash = "/", mustWork = TRUE)
  nombres <- c("Publicas_18_anios.csv", "privadas_t.xlsx", "P_t.csv",
               "poptotal_edades_sencillas.csv")
  # Permite llamar desde la raiz universitaria, el proyecto escolar o data/.
  carpetas <- unique(c(file.path(raiz, "Informe_Escolaridad", "data"),
                      file.path(raiz, "data"), raiz))
  completas <- vapply(carpetas, function(p) {
    all(file.exists(file.path(p, nombres)))
  }, logical(1))
  if (!any(completas)) {
    stop(paste("No se encontro una carpeta con los cuatro insumos escolares:",
               paste(nombres, collapse = ", ")))
  }
  carpeta <- carpetas[which(completas)[1L]]
  rutas <- setNames(file.path(carpeta, nombres), nombres)
  publicas <- as.data.frame(data.table::fread(rutas[[nombres[1L]]]))
  privadas <- as.data.frame(readxl::read_excel(rutas[[nombres[2L]]]))
  Pt <- as.data.frame(data.table::fread(rutas[[nombres[3L]]]))
  demografia <- as.data.frame(data.table::fread(rutas[[nombres[4L]]],
                                               check.names = FALSE))
  grados <- c("K", paste0("G", 1:12))
  extraer_inicio <- function(x, etiqueta) {
    x <- as.character(x)
    if (anyNA(x) || any(!grepl("^[0-9]{4}-([0-9]{2}|[0-9]{4})$", x))) {
      stop(paste("Anos escolares invalidos en", etiqueta))
    }
    inicio <- as.integer(substr(x, 1L, 4L))
    segunda <- sub("^[0-9]{4}-", "", x)
    esperado <- ifelse(nchar(segunda) == 2L, (inicio + 1L) %% 100L,
                       inicio + 1L)
    if (any(as.integer(segunda) != esperado) || anyDuplicated(inicio)) {
      stop(paste("Anos duplicados o no consecutivos en su etiqueta:", etiqueta))
    }
    inicio
  }
  preparar_matricula <- function(d, etiqueta) {
    if (!all(c("anio", grados) %in% names(d))) {
      stop(paste(etiqueta, "requiere anio, K y G1 a G12."))
    }
    d$anio_inicio <- extraer_inicio(d$anio, etiqueta)
    d <- d[order(d$anio_inicio), , drop = FALSE]
    if (any(diff(d$anio_inicio) != 1L) || nrow(d) < 6L) {
      stop(paste(etiqueta, "debe tener al menos seis anos consecutivos."))
    }
    for (g in grados) d[[g]] <- suppressWarnings(as.numeric(d[[g]]))
    m <- as.matrix(d[, grados, drop = FALSE])
    if (any(!is.finite(m)) || any(m <= 0)) {
      stop(paste(etiqueta, "contiene matriculas faltantes o no positivas."))
    }
    d
  }
  publicas <- preparar_matricula(publicas, "Matricula publica")
  privadas <- preparar_matricula(privadas, "Matricula privada")
  if (!2025L %in% publicas$anio_inicio || max(publicas$anio_inicio) > 2025L) {
    stop("La serie publica debe incluir 2025-2026 y finalizar en ese curso.")
  }
  if (max(privadas$anio_inicio) > 2025L) {
    stop("El componente escolar requiere una base privada hasta 2025 o antes.")
  }
  if (!all(c("anio", "P5") %in% names(Pt))) {
    stop("P_t.csv requiere anio y P5 (poblacion de cinco anos).")
  }
  Pt$anio_inicio <- extraer_inicio(Pt$anio, "P_t.csv")
  Pt$P5 <- suppressWarnings(as.numeric(Pt$P5))
  if (any(!is.finite(Pt$P5)) || any(Pt$P5 <= 0)) {
    stop("P_t.csv contiene P5 faltante o no positiva.")
  }
  requeridos_P5 <- seq.int(min(privadas$anio_inicio), 2025L)
  if (!all(requeridos_P5 %in% Pt$anio_inicio)) {
    stop("Falta P5 para la historia o extension de la matricula privada.")
  }
  if (!all(c("variant", "age", "country_name") %in% names(demografia))) {
    stop("La proyeccion demografica requiere variant, age y country_name.")
  }
  demografia$age <- suppressWarnings(as.numeric(demografia$age))
  seleccionar <- !is.na(demografia$variant) &
    demografia$variant == "median" & !is.na(demografia$age) &
    demografia$age == 17 & !is.na(demografia$country_name) &
    demografia$country_name == "Puerto Rico"
  dem17 <- demografia[seleccionar, , drop = FALSE]
  if (nrow(dem17) != 1L) {
    stop("Se requiere una sola fila mediana de Puerto Rico a edad 17.")
  }
  columnas_anio <- names(dem17)[grepl("^[0-9]{4}$", names(dem17))]
  anos_dem <- as.integer(columnas_anio)
  valores_dem <- suppressWarnings(as.numeric(unlist(
    dem17[, columnas_anio, drop = FALSE], use.names = FALSE)))
  orden_dem <- order(anos_dem)
  anos_dem <- anos_dem[orden_dem]
  valores_dem <- valores_dem[orden_dem]
  if (length(anos_dem) < 2L || anyDuplicated(anos_dem) ||
      any(!is.finite(valores_dem)) || any(valores_dem <= 0) ||
      !2025L %in% anos_dem || max(anos_dem) < horizonte) {
    stop("Anclajes demograficos incompletos, no positivos o insuficientes para el horizonte.")
  }
  anclas_necesarias <- seq.int(2025L, horizonte, by = 5L)
  ultima_ancla <- 2025L + 5L * ceiling((horizonte - 2025L) / 5L)
  anclas_para_interpolar <- seq.int(2025L, ultima_ancla, by = 5L)
  if (!all(anclas_para_interpolar %in% anos_dem)) {
    stop("Falta un anclaje quinquenal de poblacion a edad 17.")
  }
  # Orden de sorteos igual al informe: r_q y luego G1,...,G12 por cada ano.
  n_sim <- 10000L
  ventana <- 5L
  origen <- grados[1:12]
  destino <- grados[2:13]
  n_priv <- nrow(privadas)
  gpr <- as.matrix(privadas[2:n_priv, destino, drop = FALSE]) /
    as.matrix(privadas[1:(n_priv - 1L), origen, drop = FALSE])
  gpr_ventana <- tail(gpr, ventana)
  medias_gpr <- colMeans(gpr_ventana)
  sd_gpr <- apply(gpr_ventana, 2L, stats::sd)
  cobertura <- privadas$K / Pt$P5[match(privadas$anio_inicio, Pt$anio_inicio)]
  razon_cobertura <- cobertura[-1L] / cobertura[-length(cobertura)]
  r_base <- tail(razon_cobertura, ventana)
  media_r <- mean(r_base)
  sd_r <- stats::sd(r_base)
  if (any(!is.finite(c(medias_gpr, sd_gpr, media_r, sd_r)))) {
    stop("No se pudieron calcular las razones GPR privadas.")
  }
  # La semilla local no altera la simulacion universitaria del script padre.
  rng_anterior <- RNGkind()
  tenia_semilla <- exists(".Random.seed", envir = .GlobalEnv, inherits = FALSE)
  if (tenia_semilla) semilla_anterior <- get(".Random.seed", envir = .GlobalEnv)
  on.exit({
    do.call(RNGkind, as.list(rng_anterior))
    if (tenia_semilla) {
      assign(".Random.seed", semilla_anterior, envir = .GlobalEnv)
    } else if (exists(".Random.seed", envir = .GlobalEnv, inherits = FALSE)) {
      rm(list = ".Random.seed", envir = .GlobalEnv)
    }
  }, add = TRUE)
  RNGkind("Mersenne-Twister", "Inversion", "Rejection")
  set.seed(123L)
  q_sim <- rep(tail(cobertura, 1L), n_sim)
  E_sim <- matrix(as.numeric(unlist(privadas[n_priv, grados, drop = FALSE], use.names = FALSE)), nrow = n_sim,
                  ncol = length(grados), byrow = TRUE)
  colnames(E_sim) <- grados
  ult_priv <- max(privadas$anio_inicio)
  extension <- if (ult_priv < 2025L) seq.int(ult_priv + 1L, 2025L) else integer()
  G12_extension <- setNames(numeric(length(extension)), as.character(extension))
  for (a in extension) {
    r_q <- stats::rnorm(n_sim, mean = media_r, sd = sd_r)
    gprs <- sapply(seq_along(medias_gpr), function(j) {
      stats::rnorm(n_sim, mean = medias_gpr[j], sd = sd_gpr[j])
    })
    gprs <- pmax(gprs, 0)
    q_sim <- pmax(q_sim * r_q, 0)
    K_sim <- Pt$P5[match(a, Pt$anio_inicio)] * q_sim
    E_sim <- cbind(K_sim, E_sim[, 1:12, drop = FALSE] * gprs)
    colnames(E_sim) <- grados
    G12_extension[as.character(a)] <- stats::median(E_sim[, "G12"])
  }
  primer_anio <- min(c(publicas$anio_inicio, privadas$anio_inicio))
  anos <- seq.int(primer_anio, horizonte)
  anual <- data.table::data.table(
    anio_escolar = paste0(anos, "-", anos + 1L), anio_inicio = anos,
    publica = NA_real_, privada = NA_real_, total_G12 = NA_real_,
    estado_publica = "no_disponible", estado_privada = "no_disponible",
    estado_total = "no_disponible", es_anclaje = anos %in% anclas_necesarias)
  i_pub <- match(publicas$anio_inicio, anual$anio_inicio)
  conservar_pub <- !is.na(i_pub)
  anual$publica[i_pub[conservar_pub]] <- publicas$G12[conservar_pub]
  anual$estado_publica[i_pub[conservar_pub]] <- "observado"
  i_priv <- match(privadas$anio_inicio, anual$anio_inicio)
  conservar_priv <- !is.na(i_priv)
  anual$privada[i_priv[conservar_priv]] <- privadas$G12[conservar_priv]
  anual$estado_privada[i_priv[conservar_priv]] <- "observado"
  if (length(extension)) {
    i_ext <- match(extension, anual$anio_inicio)
    anual$privada[i_ext] <- as.numeric(G12_extension)
    anual$estado_privada[i_ext] <- "estimado"
  }
  i_base <- match(2025L, anual$anio_inicio)
  base_publica <- anual$publica[i_base]
  base_privada <- anual$privada[i_base]
  if (any(!is.finite(c(base_publica, base_privada))) ||
      any(c(base_publica, base_privada) <= 0)) {
    stop("No se pudo formar la base positiva de G12 para 2025-2026.")
  }
  anos_futuros <- if (horizonte > 2025L) seq.int(2026L, horizonte) else integer()
  if (length(anos_futuros)) {
    # rule=1 impide extrapolar. La interpolacion se realiza sobre poblacion,
    # no sobre razones de progresion ni sobre una supuesta serie de graduados.
    P17_fut <- stats::approx(anos_dem, valores_dem, xout = anos_futuros,
                             method = "linear", rule = 1L)$y
    P17_base <- valores_dem[match(2025L, anos_dem)]
    if (any(!is.finite(P17_fut)) || any(P17_fut <= 0)) {
      stop("La interpolacion de poblacion excede los anclajes disponibles.")
    }
    i_fut <- match(anos_futuros, anual$anio_inicio)
    anual$publica[i_fut] <- base_publica * P17_fut / P17_base
    anual$privada[i_fut] <- base_privada * P17_fut / P17_base
    estados <- ifelse(anos_futuros %in% anclas_necesarias,
                       "escenario_quinquenal", "escenario_interpolado")
    anual$estado_publica[i_fut] <- estados
    anual$estado_privada[i_fut] <- estados
  }
  completos <- is.finite(anual$publica) & is.finite(anual$privada)
  anual$total_G12[completos] <- anual$publica[completos] + anual$privada[completos]
  ambos_observados <- completos & anual$estado_publica == "observado" &
    anual$estado_privada == "observado"
  anual$estado_total[ambos_observados] <- "observado"
  con_estimacion <- completos &
    (anual$estado_publica == "estimado" | anual$estado_privada == "estimado")
  anual$estado_total[con_estimacion] <- "estimado"
  futuros <- anual$anio_inicio > 2025L
  anual$estado_total[futuros] <- anual$estado_publica[futuros]
  valores <- c(anual$publica, anual$privada, anual$total_G12)
  if (any(is.finite(valores) & valores <= 0)) {
    stop("El componente escolar genero una matricula no positiva.")
  }
  quinquenal <- data.table::copy(anual[which(anual$es_anclaje), ])
  quinquenal$poblacion_17 <- valores_dem[match(quinquenal$anio_inicio, anos_dem)]
  quinquenal$factor_poblacion_17 <- quinquenal$poblacion_17 /
    valores_dem[match(2025L, anos_dem)]
  fuentes <- data.table::data.table(
    archivo = nombres, ruta = unname(rutas),
    serie = c("Matricula publica K-G12", "Matricula privada K-G12",
               "Poblacion estimada de cinco anos", "Poblacion proyectada a edad 17"),
    anio_inicio = c(min(publicas$anio_inicio), min(privadas$anio_inicio),
                    min(Pt$anio_inicio), min(anos_dem)),
    anio_fin = c(max(publicas$anio_inicio), max(privadas$anio_inicio),
                 max(Pt$anio_inicio), max(anos_dem)),
    nota = c("G12 observado; el resto de grados permite revisar la base escolar.",
             paste0("Extension hasta 2025: Monte Carlo, n=10000, semilla=123, ",
                    "ventana=5; medianas sin redondear."),
             "P5 es poblacion de cinco anos, no percentil 5.",
             paste0("Solo mediana. G12 futuro = base 2025 x cambio de poblacion ",
                    "de edad 17; interpolacion lineal anual sin extrapolacion.")))
  list(anual = anual, quinquenal = quinquenal, fuentes = fuentes)
}
# Cargador de agregados de etapa 2 v2: no lee RDS ni CSV originales.
cargar_etapa2_v2 <- function(raiz, carpeta_etapa2 = NULL) {
  if (!requireNamespace("data.table", quietly = TRUE)) stop("Falta instalar data.table.", call. = FALSE)
  abortar <- function(...) stop(..., call. = FALSE)
  archivos <- c(C = "02_censo_corregido.csv", Q = "05_cohortes_y_fuentes.csv",
    N = "06_ingreso_y_G12.csv", F = "07_flujos_subgrado.csv",
    B = "09_balances_componentes.csv", E = "10_incorporaciones_por_estado.csv",
    revision = "14_revision_cohortes_ingreso.csv", resumen = "12_matricula_por_recinto_anio.csv",
    union = "03_union_calendarios.csv", ids = "11_revision_identificadores.csv",
    periodos = "01_periodos_y_calendarios.csv", estado = "17_estado_ejecucion.csv",
    configuracion = "18_configuracion_etapa2.csv")
  leer <- function(ruta) data.table::fread(ruta, encoding = "UTF-8", na.strings = c("", "NA"),
                                          showProgress = FALSE)
  version_dos <- function(v) {
    z <- suppressWarnings(as.numeric(as.character(v)))
    length(z) == 1L && !is.na(z) && is.finite(z) && z >= 2 && z < 3
  }
  es_completa_v2 <- function(d) {
    if (!all(file.exists(file.path(d, c(archivos, "COMPLETO.txt"))))) return(FALSE)
    tryCatch({
      e <- leer(file.path(d, archivos[["estado"]])); k <- leer(file.path(d, archivos[["configuracion"]]))
      nrow(e) == 1L && all(c("version", "procesamiento_completo") %in% names(e)) &&
        version_dos(e$version) && identical(e$procesamiento_completo, TRUE) &&
        all(c("parametro", "valor") %in% names(k)) &&
        sum(k$parametro == "version", na.rm = TRUE) == 1L &&
        version_dos(k$valor[k$parametro == "version"])
    }, error = function(e) FALSE)
  }
  posterior_omitida <- character()
  if (is.null(carpeta_etapa2)) {
    carpetas <- list.dirs(file.path(raiz, "resultados"), recursive = FALSE, full.names = TRUE)
    carpetas <- sort(carpetas[grepl("^cohortes_", basename(carpetas))], decreasing = TRUE)
    completas <- vapply(carpetas, es_completa_v2, logical(1))
    if (!any(completas)) abortar("No se encontro una etapa 2 COMPLETA de version 2 con estado y configuracion.")
    etapa <- carpetas[which(completas)[1L]]
    posterior_omitida <- carpetas[!completas & basename(carpetas) > basename(etapa)]
    if (length(posterior_omitida)) warning(
      "Hay carpetas de etapa 2 posteriores sin cierre completo v2; se utiliza ", basename(etapa),
      ". Revisar: ", paste(basename(posterior_omitida), collapse = ", "), call. = FALSE)
  } else {
    if (!is.character(carpeta_etapa2) || length(carpeta_etapa2) != 1L || is.na(carpeta_etapa2))
      abortar("carpeta_etapa2 debe ser NULL o una ruta de carpeta.")
    etapa <- carpeta_etapa2
    if (!dir.exists(etapa)) etapa <- file.path(raiz, carpeta_etapa2)
    if (!dir.exists(etapa)) etapa <- file.path(raiz, "resultados", carpeta_etapa2)
    if (!dir.exists(etapa)) abortar("No existe la carpeta de etapa 2 indicada.")
  }
  etapa <- normalizePath(etapa, winslash = "/", mustWork = TRUE)
  faltantes <- c(archivos, "COMPLETO.txt")[!file.exists(file.path(etapa, c(archivos, "COMPLETO.txt")))]
  if (length(faltantes)) abortar("La etapa 2 no esta completa; faltan: ", paste(faltantes, collapse = ", "))
  tablas <- lapply(archivos, function(n) leer(file.path(etapa, n)))
  estado <- tablas$estado; configuracion <- tablas$configuracion
  requerir <- function(z, columnas, nombre, permitir_na = character()) {
    faltan <- setdiff(columnas, names(z))
    if (length(faltan)) abortar("Columnas faltantes en ", nombre, ": ", paste(faltan, collapse = ", "))
    revisar <- setdiff(columnas, permitir_na)
    if (length(revisar) && anyNA(z[, revisar, with = FALSE])) abortar("Campos nucleares vacios en ", nombre, ".")
  }
  contar <- function(z, columnas, nombre) {
    for (col in columnas) {
      v <- z[[col]]
      if (!is.numeric(v) || any(!is.finite(v) | v < 0 | v != floor(v)))
        abortar("Conteo invalido: ", nombre, "$", col, ".")
    }
  }
  banderas <- function(z, columnas, nombre) {
    for (col in columnas) if (!is.logical(z[[col]]) || anyNA(z[[col]]))
      abortar("Bandera logica invalida: ", nombre, "$", col, ".")
  }
  canon <- function(z) gsub("[^a-z0-9]", "", tolower(iconv(as.character(z), to = "ASCII//TRANSLIT")))
  inicio_anio <- function(z, nombre) {
    s <- as.character(z); a <- suppressWarnings(as.integer(substr(s, 1L, 4L)))
    b <- suppressWarnings(as.integer(substr(s, 6L, 9L)))
    if (anyNA(s) || any(!grepl("^[0-9]{4}-[0-9]{4}$", s)) || anyNA(a) || anyNA(b) || any(b != a + 1L))
      abortar("Ano academico invalido en ", nombre, ".")
    a
  }
  controles <- list()
  registrar <- function(nombre, valor = NA_real_, unidad = "control") {
    controles[[length(controles) + 1L]] <<- data.table::data.table(
      control = nombre, correcto = TRUE, valor = as.numeric(valor), unidad = unidad)
  }
  comparar <- function(a, b, llaves, valor_a, valor_b, nombre) {
    aa <- data.table::copy(a[, c(llaves, valor_a), with = FALSE])
    bb <- data.table::copy(b[, c(llaves, valor_b), with = FALSE])
    if (anyDuplicated(aa[, llaves, with = FALSE]) || anyDuplicated(bb[, llaves, with = FALSE]))
      abortar("Llaves duplicadas en control: ", nombre, ".")
    data.table::setnames(aa, valor_a, "valor_a"); data.table::setnames(bb, valor_b, "valor_b")
    zz <- merge(aa, bb, by = llaves, all = TRUE, sort = FALSE)
    zz[is.na(valor_a), valor_a := 0]; zz[is.na(valor_b), valor_b := 0]
    if (any(abs(zz$valor_a - zz$valor_b) > 1e-8)) abortar("No concilia: ", nombre, ".")
    registrar(nombre, nrow(zz), "grupos verificados")
  }
  metadatos <- c("version", "procesamiento_completo", "revision_tecnica_pendiente", "archivos_verificados",
    "registros_todos_periodos", "registros_inicio_seleccionados", "filas_persona_recinto_anio",
    "identificadores_distintos_todos_anos_recintos", "repeticiones_calendarios", "periodos_seleccionados",
    "antiguedad_sin_informacion_futura", "balances_correctos", "identificador_estable_confirmado_usuario",
    "objetivo", "ultimo_anio_calibracion")
  requerir(estado, metadatos, "17_estado_ejecucion")
  if (nrow(estado) != 1L || !version_dos(estado$version)) abortar("Se requiere una fila de estado de etapa 2 version 2.")
  flags <- c("procesamiento_completo", "revision_tecnica_pendiente", "antiguedad_sin_informacion_futura",
    "balances_correctos", "identificador_estable_confirmado_usuario")
  banderas(estado, flags, "estado")
  for (col in setdiff(flags, "revision_tecnica_pendiente"))
    if (!isTRUE(estado[[col]][1L])) abortar("No esta confirmado el requisito de etapa 2: ", col, ".")
  numeros_estado <- c("archivos_verificados", "registros_todos_periodos", "registros_inicio_seleccionados",
    "filas_persona_recinto_anio", "identificadores_distintos_todos_anos_recintos", "repeticiones_calendarios",
    "periodos_seleccionados", "ultimo_anio_calibracion")
  contar(estado, numeros_estado, "estado")
  requerir(configuracion, c("parametro", "valor"), "18_configuracion_etapa2")
  if (anyDuplicated(configuracion$parametro)) abortar("Parametros repetidos en configuracion de etapa 2.")
  cfg <- function(n) {
    v <- configuracion$valor[configuracion$parametro == n]
    if (length(v) != 1L || is.na(v) || !nzchar(v)) abortar("Parametro faltante/invalido de etapa 2: ", n, ".")
    v
  }
  if (!version_dos(cfg("version"))) abortar("La configuracion no corresponde a etapa 2 version 2.")
  for (objetivo in c(estado$objetivo, cfg("objetivo"))) {
    s <- canon(objetivo)
    if (!grepl("inicial", s) || !grepl("calendario", s) || !grepl("anual", s))
      abortar("El objetivo de etapa 2 no es la union de periodos iniciales y anual por calendario.")
  }
  corte_config <- suppressWarnings(as.numeric(cfg("ultimo_anio_calibracion")))
  if (length(corte_config) != 1L || !is.finite(corte_config) || corte_config != estado$ultimo_anio_calibracion)
    abortar("El ultimo ano de calibracion difiere entre estado y configuracion.")
  registrar("Estado v2, cierre y condiciones confirmados")

  requeridas <- list(
    C = c("recinto", "anio", "componente", "nivel", "provisional", "personas", "con_multiples_calendarios",
          "nuevo_ingreso_secundaria", "nuevo_ingreso_consistente"),
    Q = c("recinto", "anio", "nivel", "estado_cohorte", "corte_informacion", "provisional", "personas"),
    N = c("recinto", "anio", "nivel", "provisional", "matricula", "nuevo_ingreso_candidato",
          "nuevo_ingreso_consistente", "nuevo_ingreso_pendiente", "total_G12_observado", "ambos_sectores_observados"),
    F = c("recinto", "nivel_origen", "anio_anterior", "anio_siguiente", "anio_destino", "estado_origen",
          "destino_transicion", "provisional", "personas", "exposicion_origen", "proporcion"),
    B = c("recinto", "componente", "nivel", "anio_destino", "anio_siguiente", "provisional", "matricula_origen",
          "matricula_destino", "continuantes_mismo_grupo", "incorporaciones", "incorporaciones_secundaria",
          "incorporaciones_secundaria_consistentes", "incorporaciones_otras", "diferencia_balance"),
    E = c("recinto", "anio_siguiente", "comp_destino", "nivel_destino", "estado_destino", "provisional",
          "ni_secundaria_destino", "ni_consistente_destino", "personas"),
    revision = c("recinto", "anio", "componente", "nivel", "provisional", "es_nuevo_secundaria",
                 "ni_secundaria_consistente", "personas"),
    resumen = c("recinto", "anio", "provisional", "filas_todos_componentes", "grado_identificado", "subgrado",
                "posgrado", "subgrado_generico", "escolar", "otros", "multiples_componentes"),
    union = c("recinto", "anio", "registros_censos_seleccionados", "personas_union", "registros_menos_personas"),
    ids = c("n_anos", "n_recintos", "identificadores"),
    periodos = c("archivo_id", "anio", "recinto", "codigo_sesion", "registros", "personas", "ambiguo",
                 "seleccionado", "registros_seleccionados"))
  conteos <- list(C = c("personas", "con_multiples_calendarios", "nuevo_ingreso_secundaria", "nuevo_ingreso_consistente"),
    Q = c("personas", "corte_informacion"),
    N = c("matricula", "nuevo_ingreso_candidato", "nuevo_ingreso_consistente", "nuevo_ingreso_pendiente"),
    F = c("personas", "exposicion_origen", "anio_destino"),
    B = c("anio_destino", "matricula_origen", "matricula_destino", "continuantes_mismo_grupo", "incorporaciones",
          "incorporaciones_secundaria", "incorporaciones_secundaria_consistentes", "incorporaciones_otras"),
    E = "personas", revision = "personas",
    resumen = c("filas_todos_componentes", "grado_identificado", "subgrado", "posgrado", "subgrado_generico",
                "escolar", "otros", "multiples_componentes"),
    union = c("registros_censos_seleccionados", "personas_union", "registros_menos_personas"),
    ids = c("n_anos", "n_recintos", "identificadores"),
    periodos = c("archivo_id", "registros", "personas", "registros_seleccionados"))
  for (nom in names(requeridas)) {
    z <- tablas[[nom]]
    requerir(z, requeridas[[nom]], nom, if (nom == "N") "total_G12_observado" else character())
    contar(z, conteos[[nom]], nom)
    if ("provisional" %in% names(z)) banderas(z, "provisional", nom)
    if ("anio" %in% names(z)) z[, anio_inicio := inicio_anio(anio, nom)]
    if ("anio_siguiente" %in% names(z)) z[, anio_inicio := inicio_anio(anio_siguiente, nom)]
  }
  C <- tablas$C; Q <- tablas$Q; N <- tablas$N; F <- tablas$F; B <- tablas$B; E <- tablas$E
  revision <- tablas$revision; resumen <- tablas$resumen; union <- tablas$union
  periodos <- tablas$periodos; ids <- tablas$ids
  banderas(N, "ambos_sectores_observados", "N")
  banderas(E, c("ni_secundaria_destino", "ni_consistente_destino"), "E")
  banderas(revision, c("es_nuevo_secundaria", "ni_secundaria_consistente"), "revision")
  banderas(periodos, c("ambiguo", "seleccionado"), "periodos")
  if (any(periodos$ambiguo & periodos$seleccionado)) abortar("Un periodo ambiguo fue seleccionado.")
  if (any(periodos$registros_seleccionados != ifelse(periodos$seleccionado, periodos$registros, 0)))
    abortar("La seleccion de periodos no conserva periodos completos.")
  if (anyDuplicated(periodos[, .(archivo_id, anio, recinto, codigo_sesion)])) abortar("Hay periodos duplicados.")
  if (any(C$con_multiples_calendarios > C$personas | C$nuevo_ingreso_secundaria > C$personas |
          C$nuevo_ingreso_consistente > C$nuevo_ingreso_secundaria)) abortar("Conteos internos invalidos en C.")
  if (any(N$nuevo_ingreso_candidato != N$nuevo_ingreso_consistente + N$nuevo_ingreso_pendiente) ||
      any(N$nuevo_ingreso_candidato > N$matricula)) abortar("No concilian los tres conteos de nuevo ingreso.")
  if (any(E$ni_consistente_destino & !E$ni_secundaria_destino) ||
      any(revision$ni_secundaria_consistente & !revision$es_nuevo_secundaria)) abortar("NI consistente sin candidato.")
  if (any(Q$corte_informacion != Q$anio_inicio)) abortar("Una cohorte utiliza un corte de informacion distinto de su censo.")
  if (any(F$anio_destino != F$anio_inicio) || any(B$anio_destino != B$anio_inicio))
    abortar("El ano destino no coincide con el curso siguiente.")
  if (any(inicio_anio(F$anio_anterior, "F$anio_anterior") != F$anio_inicio - 1L))
    abortar("Los flujos no unen censos de anos consecutivos.")
  if (any(C$provisional != (C$anio_inicio > estado$ultimo_anio_calibracion)) ||
      any(Q$provisional != (Q$anio_inicio > estado$ultimo_anio_calibracion)) ||
      any(N$provisional != (N$anio_inicio > estado$ultimo_anio_calibracion)))
    abortar("No concilian las banderas provisionales con el ultimo ano de calibracion.")
  registrar("Cortes temporales y banderas de censo verificados")

  k <- c("recinto", "anio")
  combinaciones <- unique(C[, k, with = FALSE])
  anos <- sort(unique(C$anio_inicio)); recintos <- unique(C$recinto)
  declarados <- estado$archivos_verificados[1L]
  if (!nrow(C) || declarados < 1L || length(anos) < 2L || any(diff(anos) != 1L) ||
      declarados != length(recintos) * length(anos) || declarados != nrow(combinaciones) ||
      declarados != nrow(union) || declarados != nrow(resumen) ||
      declarados != data.table::uniqueN(periodos$archivo_id))
    abortar("La cobertura recinto-ano no coincide con los archivos declarados y una malla anual completa.")
  if (anyDuplicated(C[, .(recinto, anio, componente, nivel)]) || anyDuplicated(union[, k, with = FALSE]) ||
      anyDuplicated(resumen[, k, with = FALSE])) abortar("Llaves duplicadas en censo, union o resumen.")
  for (par in list(c("registros_todos_periodos", sum(periodos$registros)),
    c("registros_inicio_seleccionados", sum(periodos$registros_seleccionados)),
    c("filas_persona_recinto_anio", sum(C$personas)),
    c("identificadores_distintos_todos_anos_recintos", sum(ids$identificadores)),
    c("repeticiones_calendarios", sum(union$registros_menos_personas)),
    c("periodos_seleccionados", sum(periodos$seleccionado)))) {
    col <- par[1L]; observado <- as.numeric(par[2L])
    if (estado[[col]][1L] != observado) abortar("El estado no concilia con las tablas: ", col, ".")
    registrar(paste("Estado concilia", col), observado, "conteo")
  }
  if (any(union$registros_censos_seleccionados != union$personas_union + union$registros_menos_personas))
    abortar("No concilia la resta de repeticiones en la union de calendarios.")
  if (any(ids$n_anos < 1L | ids$n_anos > length(anos) | ids$n_recintos < 1L | ids$n_recintos > length(recintos)) ||
      sum(ids$identificadores) > sum(C$personas)) abortar("Revision de identificadores incompatible con la cobertura.")
  comparar(C[, .(v = sum(personas)), by = k], union, k, "v", "personas_union", "Censo igual a union")
  comparar(periodos[, .(v = sum(registros_seleccionados)), by = k], union, k, "v",
           "registros_censos_seleccionados", "Periodos igual a registros iniciales de union")
  comparar(C[, .(v = sum(personas)), by = k], resumen, k, "v", "filas_todos_componentes", "Censo igual a resumen")
  componentes <- c(Subgrado = "subgrado", Posgrado = "posgrado", Subgrado_generico = "subgrado_generico",
    Escolar = "escolar", Otros = "otros", "Multiples componentes" = "multiples_componentes")
  if (any(!C$componente %in% names(componentes))) abortar("Componente de censo sin correspondencia en resumen.")
  for (comp in names(componentes)) comparar(C[componente == comp, .(v = sum(personas)), by = k],
    resumen, k, "v", componentes[[comp]], paste("Resumen del componente", comp))
  if (any(resumen$grado_identificado != resumen$subgrado + resumen$posgrado) ||
      any(resumen$filas_todos_componentes != resumen$grado_identificado + resumen$subgrado_generico +
          resumen$escolar + resumen$otros + resumen$multiples_componentes)) abortar("No concilian los componentes del resumen.")
  kg <- c(k, "nivel")
  sub <- C[componente == "Subgrado", .(v = sum(personas)), by = kg]
  comparar(sub, Q[, .(v = sum(personas)), by = kg], kg, "v", "v", "Subgrado igual a cohortes")
  comparar(sub, N, kg, "v", "matricula", "Subgrado igual a ingreso")
  comparar(C[, .(v = sum(personas)), by = c(k, "componente", "nivel")],
    revision[, .(v = sum(personas)), by = c(k, "componente", "nivel")], c(k, "componente", "nivel"),
    "v", "v", "Censo igual a revision de ingreso y cohortes")
  rv <- revision[componente == "Subgrado", .(candidato = sum(personas[es_nuevo_secundaria]),
    consistente = sum(personas[ni_secundaria_consistente]),
    pendiente = sum(personas[es_nuevo_secundaria & !ni_secundaria_consistente])), by = kg]
  for (par in list(c("candidato", "nuevo_ingreso_candidato"), c("consistente", "nuevo_ingreso_consistente"),
                  c("pendiente", "nuevo_ingreso_pendiente"))) comparar(rv, N, kg, par[1L], par[2L],
                    paste("Revision 14 igual a ingreso", par[1L]))
  for (par in list(c("nuevo_ingreso_secundaria", "nuevo_ingreso_candidato"),
                  c("nuevo_ingreso_consistente", "nuevo_ingreso_consistente"))) comparar(
    C[componente == "Subgrado", .(v = sum(get(par[1L]))), by = kg], N, kg,
    "v", par[2L], paste("Censo igual a ingreso", par[2L]))
  registrar("Cobertura declarada verificada", declarados, "archivos recinto-ano")
  registrar("Recintos verificados", length(recintos), "recintos")
  registrar("Anos consecutivos verificados", length(anos), "anos")
  control <- data.table::rbindlist(controles, use.names = TRUE)
  control[, etapa2 := basename(etapa)]
  message("Etapa 2 v2 verificada: ", etapa, " (", declarados, " archivos; ", length(recintos), " recintos; ",
          length(anos), " anos).")
  list(etapa = etapa, D = tablas[c("C", "Q", "N", "F", "B", "E")], estado = estado,
    revision = revision, control = control, configuracion = configuracion,
    resumen = resumen, union = union, ids = ids, periodos = periodos,
    carpetas_posteriores_omitidas = posterior_omitida)
}


# C=02_censo, Q=05_cohortes, N=06_ingreso, F=07_flujos,
# B=09_balances, E=10_incorporaciones. Solo controles sobre agregados.
validar_entradas_03 <- function(C, Q, N, F, B, E) {
  stopifnot(requireNamespace("data.table", quietly = TRUE))
  tablas <- lapply(list(C = C, Q = Q, N = N, F = F, B = B, E = E),
                   function(z) data.table::copy(data.table::as.data.table(z)))
  requeridas <- list(
    C = c("recinto", "anio", "componente", "nivel", "personas"),
    Q = c("recinto", "anio", "nivel", "estado_cohorte", "personas"),
    N = c("recinto", "anio", "nivel", "matricula", "nuevo_ingreso_candidato",
          "nuevo_ingreso_consistente", "nuevo_ingreso_pendiente"),
    F = c("recinto", "nivel_origen", "anio_destino", "estado_origen",
          "destino_transicion", "personas", "exposicion_origen", "proporcion"),
    B = c("recinto", "componente", "nivel", "anio_destino", "matricula_origen",
          "matricula_destino", "continuantes_mismo_grupo", "incorporaciones",
          "incorporaciones_secundaria", "incorporaciones_secundaria_consistentes",
          "incorporaciones_otras", "diferencia_balance"),
    E = c("recinto", "anio_siguiente", "comp_destino", "nivel_destino", "estado_destino",
          "ni_secundaria_destino", "ni_consistente_destino", "personas"))
  conteos <- list(C = "personas", Q = "personas",
    N = c("matricula", "nuevo_ingreso_candidato", "nuevo_ingreso_consistente", "nuevo_ingreso_pendiente"),
    F = c("personas", "exposicion_origen"),
    B = c("matricula_origen", "matricula_destino", "continuantes_mismo_grupo", "incorporaciones",
          "incorporaciones_secundaria", "incorporaciones_secundaria_consistentes", "incorporaciones_otras"),
    E = "personas")
  for (nom in names(tablas)) {
    z <- tablas[[nom]]
    if (!all(requeridas[[nom]] %in% names(z))) stop("Columnas faltantes en ", nom)
    if (anyNA(z[, requeridas[[nom]], with = FALSE])) stop("Campos nucleares NA en ", nom)
    if (!"provisional" %in% names(z) || !is.logical(z$provisional) || anyNA(z$provisional))
      stop("Bandera provisional invalida en ", nom)
    for (col in conteos[[nom]]) {
      v <- z[[col]]
      if (!is.numeric(v) || any(!is.finite(v) | v < 0 | v != floor(v)))
        stop("Conteo invalido: ", nom, "$", col)
    }
  }
  C <- tablas$C; Q <- tablas$Q; N <- tablas$N
  F <- tablas$F; B <- tablas$B; E <- tablas$E
  for (col in c("ni_secundaria_destino", "ni_consistente_destino")) {
    if (!is.logical(E[[col]]) || anyNA(E[[col]])) stop("Bandera no logica/NA: E$", col)
  }
  if (any(E$ni_consistente_destino & E$ni_secundaria_destino == FALSE))
    stop("Hay NI consistente que no es candidato desde secundaria.")
  inicio_escolar <- function(z) {
    s <- as.character(z)
    ok <- !is.na(s) & grepl("^[0-9]{4}-[0-9]{4}$", s)
    a <- suppressWarnings(as.integer(substr(s, 1L, 4L)))
    b <- suppressWarnings(as.integer(substr(s, 6L, 9L)))
    if (any(!ok | is.na(a) | is.na(b) | b != a + 1L)) stop("Ano escolar invalido.")
    a
  }
  C[, y := inicio_escolar(anio)]; Q[, y := inicio_escolar(anio)]; N[, y := inicio_escolar(anio)]
  E[, y := inicio_escolar(anio_siguiente)]
  if (!is.numeric(F$anio_destino) || !is.numeric(B$anio_destino) ||
      any(!is.finite(F$anio_destino) | F$anio_destino != floor(F$anio_destino)) ||
      any(!is.finite(B$anio_destino) | B$anio_destino != floor(B$anio_destino))) stop("Ano destino invalido.")
  F[, y := as.integer(anio_destino)]; B[, y := as.integer(anio_destino)]
  comparar <- function(a, b, llaves, valor_a, valor_b, nombre) {
    aa <- a[, c(llaves, valor_a), with = FALSE]; bb <- b[, c(llaves, valor_b), with = FALSE]
    if (anyDuplicated(aa[, llaves, with = FALSE]) || anyDuplicated(bb[, llaves, with = FALSE]))
      stop("Llaves duplicadas en control: ", nombre)
    data.table::setnames(aa, valor_a, "valor_a"); data.table::setnames(bb, valor_b, "valor_b")
    z <- merge(aa, bb, by = llaves, all = TRUE, sort = FALSE)
    z[is.na(valor_a), valor_a := 0]; z[is.na(valor_b), valor_b := 0]
    if (any(abs(z$valor_a - z$valor_b) > 1e-8)) stop("No concilia: ", nombre)
  }
  estados <- c("1", "2", "3", "4", "5 o mas", "Sin origen")
  if (any(Q$estado_cohorte %in% estados == FALSE) || any(F$estado_origen %in% estados == FALSE))
    stop("Estado de cohorte no reconocido.")
  if (any(F$destino_transicion %in% c(estados, "No observado en recinto", "Cambio componente o grado") == FALSE))
    stop("Destino de transicion no reconocido.")
  if (any(F$exposicion_origen <= 0) || !is.numeric(F$proporcion) ||
      any(!is.finite(F$proporcion) | F$proporcion < 0 | F$proporcion > 1)) stop("Proporcion/exposicion invalida.")
  if (any(abs(F$proporcion - F$personas / F$exposicion_origen) > 1e-8)) stop("Proporcion de flujo inconsistente.")
  k <- c("recinto", "nivel", "y")
  cs <- C[componente == "Subgrado", .(stock = sum(personas)), by = k]
  qs <- Q[, .(stock_q = sum(personas)), by = k]
  comparar(cs, qs, k, "stock", "stock_q", "censo subgrado = suma de cohortes")
  comparar(cs, N, k, "stock", "matricula", "censo subgrado = matricula en ingreso")
  q1 <- Q[estado_cohorte == "1", .(estado_uno = sum(personas)), by = k]
  ni1 <- merge(q1, N[, c(k, "nuevo_ingreso_consistente"), with = FALSE], by = k, all = TRUE)
  ni1[is.na(estado_uno), estado_uno := 0]
  if (anyNA(ni1$nuevo_ingreso_consistente) || any(ni1$nuevo_ingreso_consistente > ni1$estado_uno))
    stop("El NI consistente excede la matricula de antiguedad 1.")
  if (any(N$nuevo_ingreso_candidato != N$nuevo_ingreso_consistente + N$nuevo_ingreso_pendiente))
    stop("No concilian NI candidato, consistente y pendiente.")
  pares <- unique(B[, .(recinto, y)])
  hs <- E[comp_destino == "Subgrado" & ni_consistente_destino == TRUE,
          .(hs = sum(personas)), by = .(recinto, nivel = nivel_destino, y)]
  nn <- merge(N, pares, by = c("recinto", "y"))
  comparar(hs, nn, k, "hs", "nuevo_ingreso_consistente", "incorporaciones HS = NI consistente")
  if (any(E$ni_consistente_destino & E$estado_destino != "1")) stop("NI consistente fuera del estado 1.")
  expo <- F[, .(flujo = sum(personas), emin = min(exposicion_origen), emax = max(exposicion_origen)),
            by = .(recinto, nivel = nivel_origen, y, estado_cohorte = estado_origen)]
  if (any(expo$emin != expo$emax | expo$flujo != expo$emin)) stop("Exposicion repetida no concilia con flujos.")
  prev <- Q[, .(stock_previo = sum(personas)), by = .(recinto, nivel, y = y + 1L, estado_cohorte)]
  prev <- merge(prev, pares, by = c("recinto", "y"))
  comparar(expo, prev, c(k, "estado_cohorte"), "flujo", "stock_previo", "origen de flujos = censo previo por estado")
  pr <- F[destino_transicion %in% estados, .(p_interna = sum(proporcion)),
          by = .(recinto, nivel_origen, y, estado_origen)]
  if (any(pr$p_interna > 1 + 1e-8)) stop("Fila de matriz interna suma mas de uno.")
  if (!is.numeric(B$diferencia_balance) || any(B$diferencia_balance != 0) ||
      any(B$matricula_destino != B$continuantes_mismo_grupo + B$incorporaciones) ||
      any(B$continuantes_mismo_grupo > B$matricula_origen)) stop("Balance de personas invalido.")
  ek <- c("recinto", "componente", "nivel", "y")
  c_dest <- merge(C[, .(stock_c = sum(personas)), by = ek], pares, by = c("recinto", "y"))
  c_orig <- C[, .(stock_c = sum(personas)), by = .(recinto, componente, nivel, y = y + 1L)]
  c_orig <- merge(c_orig, pares, by = c("recinto", "y"))
  comparar(c_dest, B, ek, "stock_c", "matricula_destino", "balance destino = censo actual")
  comparar(c_orig, B, ek, "stock_c", "matricula_origen", "balance origen = censo previo")
  ee <- E[, .(entradas_e = sum(personas), hs_e = sum(personas[ni_secundaria_destino == TRUE]),
    hsc_e = sum(personas[ni_consistente_destino == TRUE]),
    otras_e = sum(personas[ni_secundaria_destino == FALSE])),
    by = .(recinto, componente = comp_destino, nivel = nivel_destino, y)]
  for (par in list(c("entradas_e", "incorporaciones"), c("hs_e", "incorporaciones_secundaria"),
                  c("hsc_e", "incorporaciones_secundaria_consistentes"), c("otras_e", "incorporaciones_otras")))
    comparar(ee, B, ek, par[1L], par[2L], paste("incorporaciones", par[2L]))
  invisible(list(balances_verificados = nrow(B), grupos_flujos = nrow(expo),
    personas_censo = sum(C$personas), controles = "Todos los controles de entradas superados"))
}

ajustar_subgrado <- function(F, E, N, Q, r, g, fin, ventana) {
  anos <- seq.int(max(2018L, fin - ventana + 1L), fin)
  z <- F[recinto == r & nivel_origen == g & anio_destino %in% anos]
  pool <- F[nivel_origen == g & anio_destino %in% anos]
  P <- matrix(0, length(estados), length(estados), dimnames = list(estados, estados))
  expos <- numeric(length(estados)); fuente <- character(length(estados))
  for (i in seq_along(estados)) {
    s <- estados[i]
    a <- z[estado_origen == s]
    den <- sum(a$personas)  # incluye salidas y cambios de grado
    expos[i] <- den; fuente[i] <- "Recinto y grado"
    if (den == 0) {
      a <- pool[estado_origen == s]; den <- sum(a$personas)
      fuente[i] <- if (den > 0) "Conjunto del mismo grado: sin exposicion local" else "Sin exposicion: fila cero"
    }
    if (den > 0) {
      for (j in seq_along(estados)) P[i, j] <- sum(a$personas[a$destino_transicion == estados[j]]) / den
    }
  }
  if (any(!is.finite(P)) || any(P < 0) || any(rowSums(P) > 1 + 1e-10)) stop("Matriz de transicion invalida: ", r, "/", g)
  espectral <- max(Mod(eigen(P, only.values = TRUE)$values))
  if (espectral >= 1 - 1e-12) stop("Matriz no contractiva: revisar persistencia de ", r, "/", g)
  ns <- N[recinto == r & nivel == g & anio_inicio <= fin &
            ambos_sectores_observados == TRUE & !is.na(total_G12_observado) & total_G12_observado > 0]
  setorder(ns, anio_inicio); ns <- tail(ns, ventana)
  if (!nrow(ns)) stop("Sin cohortes con denominador G12 observado para captacion: ", r, "/", g)
  alpha <- mean(ns$nuevo_ingreso_consistente / ns$total_G12_observado)
  if (!is.finite(alpha) || alpha < 0) stop("Coeficiente de captacion invalido: ", r, "/", g)
  entradas <- E[recinto == r & comp_destino == "Subgrado" & nivel_destino == g &
                  anio_inicio %in% anos & ni_consistente_destino == FALSE]
  b <- vapply(estados, function(s) sum(entradas$personas[entradas$estado_destino == s]) / length(anos), numeric(1))
  base <- Q[recinto == r & nivel == g & anio_inicio == fin]
  x <- vapply(estados, function(s) sum(base$personas[base$estado_cohorte == s]), numeric(1))
  parametros_P <- CJ(estado_origen = estados, estado_destino = estados, sorted = FALSE)
  parametros_P[, `:=`(recinto = r, nivel = g, ventana = ventana, corte = fin)]
  parametros_P[, probabilidad := mapply(function(a, d) P[a, d], estado_origen, estado_destino)]
  parametros_P[, exposicion_local := expos[match(estado_origen, estados)]]
  parametros_P[, fuente := fuente[match(estado_origen, estados)]]
  parametros_P[, exposicion_escasa := exposicion_local < config$umbral_exposicion_informativa]
  captacion <- data.table(recinto = r, nivel = g, ventana = ventana, corte = fin,
    coeficiente = alpha, n_anos = nrow(ns),
    anos_utilizados = paste(ns$anio, collapse = " | "),
    anos_transiciones = paste(etiqueta_anio(anos), collapse = " | "),
    fin_ultima_cohorte_captacion = max(ns$anio_inicio),
    calibracion_termina_antes_del_corte = max(ns$anio_inicio) < fin,
    denominador = "Matricula publica y privada G12 del curso previo, observada",
    radio_espectral = espectral)
  otras <- data.table(recinto = r, nivel = g, estado = estados,
                     incorporaciones_anuales = as.numeric(b), n_anos = length(anos), ventana = ventana)
  list(recinto = r, nivel = g, P = P, alpha = alpha, b = b, x = x,
       parametros_P = parametros_P, captacion = captacion, otras = otras)
}

ajustar_auxiliar <- function(C, B, r, tipo, fin, ventana) {
  anos <- seq.int(max(2018L, fin - ventana + 1L), fin)
  a <- B[recinto == r & auxiliar == tipo & anio_destino %in% anos]
  expos <- sum(a$matricula_origen)
  p <- if (expos > 0) sum(a$continuantes_mismo_grupo) / expos else NA_real_
  entradas <- sum(a$incorporaciones) / length(anos)  # anos ausentes = cero, censo verificado
  x <- sum(C[recinto == r & auxiliar == tipo & anio_inicio == fin, personas])
  constante <- expos < config$umbral_aux || !is.finite(p) || p >= 1 - 1e-12
  if (is.finite(p) && (p < 0 || p > 1 + 1e-10)) stop("Persistencia auxiliar invalida: ", r, "/", tipo)
  regla <- if (constante) "Stock del ano base constante: historia escasa o sin salidas observadas" else
    "Persistencia dentro del grado y promedio anual de incorporaciones constantes"
  parametros <- data.table(recinto = r, auxiliar = tipo, ventana = ventana, corte = fin,
    exposicion = expos, persistencia_empirica = p, incorporaciones_empiricas = entradas,
    persistencia_aplicada = if (constante) 1 else p,
    incorporaciones_aplicadas = if (constante) 0 else entradas,
    stock_base = x, regla = regla)
  list(recinto = r, tipo = tipo, p = if (constante) 1 else p,
       A = if (constante) 0 else entradas, x = x, parametros = parametros)
}

ajustar_modelo <- function(D, fin, ventana) {
  grupos <- unique(D$Q[anio_inicio <= fin, .(recinto, nivel)])
  sub <- lapply(seq_len(nrow(grupos)), function(i) ajustar_subgrado(
    D$F, D$E, D$N, D$Q, grupos$recinto[i], grupos$nivel[i], fin, ventana))
  aux <- list()
  for (r in sort(unique(D$C[anio_inicio <= fin, recinto]))) for (tipo in c("Posgrado", "Otros")) {
    aux[[length(aux) + 1L]] <- ajustar_auxiliar(D$C, D$B, r, tipo, fin, ventana)
  }
  list(sub = sub, aux = aux, fin = fin, ventana = ventana)
}

avanzar_subgrado <- function(P, x, alpha, g12, b) {
  if (any(!is.finite(c(P, x, alpha, g12, b))) || any(c(P, x, alpha, g12, b) < 0)) stop("Valores invalidos al proyectar subgrado.")
  y <- as.numeric(t(P) %*% x) + b
  y[1L] <- y[1L] + alpha * g12
  esperado <- sum(x * rowSums(P)) + sum(b) + alpha * g12
  if (abs(sum(y) - esperado) > 1e-8 * max(1, esperado)) stop("No concilia el balance proyectado.")
  y
}

resumir_proyeccion <- function(S, A) {
  sub <- S[, .(subgrado = sum(personas)), by = .(recinto, anio_inicio)]
  aux <- dcast(A, recinto + anio_inicio ~ auxiliar, value.var = "personas", fun.aggregate = sum)
  for (v in c("Posgrado", "Otros")) if (!v %in% names(aux)) aux[, (v) := 0]
  setnames(aux, c("Posgrado", "Otros"), c("posgrado", "otros"))
  z <- merge(sub, aux, by = c("recinto", "anio_inicio"), all = TRUE)
  for (v in c("subgrado", "posgrado", "otros")) set(z, which(is.na(z[[v]])), v, 0)
  z[, `:=`(anio = etiqueta_anio(anio_inicio), total_grado = subgrado + posgrado,
           total_no_escolar = subgrado + posgrado + otros)]
  setorder(z, recinto, anio_inicio)
  z
}

proyectar_modelo <- function(modelo, G12, horizonte) {
  if (horizonte < modelo$fin) stop("Horizonte anterior al ano base.")
  sub <- modelo$sub; aux <- modelo$aux
  S <- list(); A <- list(); NI <- list()
  for (a in seq.int(modelo$fin, horizonte)) {
    for (k in seq_along(sub)) {
      m <- sub[[k]]
      S[[length(S) + 1L]] <- data.table(recinto = m$recinto, nivel = m$nivel,
        anio_inicio = a, anio = etiqueta_anio(a), estado = estados, personas = as.numeric(m$x),
        tipo = if (a == modelo$fin) "Base observada" else "Proyectado", ventana = modelo$ventana)
    }
    for (k in seq_along(aux)) {
      m <- aux[[k]]
      A[[length(A) + 1L]] <- data.table(recinto = m$recinto, auxiliar = m$tipo,
        anio_inicio = a, anio = etiqueta_anio(a), personas = m$x, ventana = modelo$ventana)
    }
    if (a == horizonte) next
    g <- G12[anio_inicio == a, total_G12]
    if (length(g) != 1L || !is.finite(g) || g <= 0) stop("Falta G12 para el curso previo: ", etiqueta_anio(a))
    for (k in seq_along(sub)) {
      m <- sub[[k]]
      NI[[length(NI) + 1L]] <- data.table(recinto = m$recinto, nivel = m$nivel,
        anio_inicio = a + 1L, anio = etiqueta_anio(a + 1L), G12_curso_previo = g,
        nuevo_ingreso_secundaria = m$alpha * g, otras_incorporaciones = sum(m$b), ventana = modelo$ventana)
      sub[[k]]$x <- avanzar_subgrado(m$P, m$x, m$alpha, g, m$b)
    }
    for (k in seq_along(aux)) aux[[k]]$x <- aux[[k]]$p * aux[[k]]$x + aux[[k]]$A
  }
  S <- rbindlist(S); A <- rbindlist(A); NI <- rbindlist(NI)
  resumen <- resumir_proyeccion(S, A)
  if (any(!is.finite(resumen$total_no_escolar)) || any(resumen$total_no_escolar < 0)) stop("La proyeccion produjo valores invalidos.")
  list(estados = S, auxiliares = A, ingresos = NI, resumen = resumen)
}

historico_componentes <- function(C) {
  d <- C[, .(personas = sum(personas)), by = .(recinto, anio_inicio, auxiliar)]
  h <- dcast(d, recinto + anio_inicio ~ auxiliar, value.var = "personas", fill = 0)
  for (v in c("Subgrado", "Posgrado", "Otros", "Escolar")) if (!v %in% names(h)) h[, (v) := 0]
  setnames(h, c("Subgrado", "Posgrado", "Otros", "Escolar"), c("subgrado", "posgrado", "otros", "escolar"))
  h[, `:=`(anio = etiqueta_anio(anio_inicio), total_grado = subgrado + posgrado,
    total_no_escolar = subgrado + posgrado + otros,
    total_registrado = subgrado + posgrado + otros + escolar)]
  setorder(h, recinto, anio_inicio)
  h
}

# Retrospectiva de un paso con corte universitario explicito y referencia constante.
# Requiere ajustar_modelo(), proyectar_modelo() y config del script 03.
# G12 corresponde al curso previo tal como consta en los insumos actuales;
# no se dispone de archivos escolares historicos con fecha de publicacion.
validar_retrospectiva <- function(D, G12, historico) {
  variables <- c("subgrado", "posgrado", "otros", "total_grado", "total_no_escolar")
  llaves <- c("recinto", "anio_inicio")
  h <- data.table::copy(data.table::as.data.table(historico))
  g <- data.table::copy(data.table::as.data.table(G12))
  if (!all(c(llaves, variables) %in% names(h)) ||
      !all(c("anio_inicio", "total_G12") %in% names(g))) {
    stop("Faltan columnas historicas o escolares para la retrospectiva.")
  }
  if (anyDuplicated(h[, llaves, with = FALSE]) ||
      anyDuplicated(g$anio_inicio)) {
    stop("Llaves duplicadas en historia o G12 de la retrospectiva.")
  }
  if (anyNA(h[, c(llaves, variables), with = FALSE])) {
    stop("Hay campos historicos ausentes en la retrospectiva.")
  }
  for (v in variables) {
    if (!is.numeric(h[[v]]) || any(!is.finite(h[[v]]) | h[[v]] < 0)) {
      stop("Historico invalido en retrospectiva: ", v)
    }
  }
  ventanas <- unique(as.integer(config$ventanas_sensibilidad))
  objetivos <- unique(as.integer(config$validacion))
  if (!length(ventanas) || !length(objetivos) || anyNA(ventanas) ||
      anyNA(objetivos) || any(ventanas < 1L)) {
    stop("Ventanas u objetivos invalidos para la retrospectiva.")
  }
  salidas <- list()
  for (w in ventanas) for (objetivo in objetivos) {
    corte <- objetivo - 1L
    message("Retrospectiva de un paso: ", etiqueta_anio(objetivo),
            "; corte universitario ", etiqueta_anio(corte),
            "; ventana ", w)
    # Cada tabla universitaria queda truncada antes de ajustar. La etapa 02
    # reconstruye las etiquetas con informacion hasta su propio corte anual.
    Dc <- D
    columnas_corte <- c(C = "anio_inicio", Q = "anio_inicio", N = "anio_inicio",
                       E = "anio_inicio", F = "anio_destino", B = "anio_destino")
    for (nom in names(columnas_corte)) {
      col <- columnas_corte[[nom]]
      if (is.null(D[[nom]]) || !col %in% names(D[[nom]])) {
        stop("Falta el ano de corte universitario: ", nom, "$", col)
      }
      tabla <- data.table::copy(data.table::as.data.table(D[[nom]]))
      if (anyNA(tabla[[col]]) || any(!is.finite(tabla[[col]]))) {
        stop("Ano de corte universitario invalido: ", nom)
      }
      Dc[[nom]] <- tabla[get(col) <= corte]
    }
    # Solo se permite G12 del curso previo al objetivo o de cursos anteriores.
    # Sus valores historicos proceden del archivo disponible actualmente.
    Gc <- g[anio_inicio <= corte]
    Gprev <- Gc[anio_inicio == corte]
    if (nrow(Gprev) != 1L || !is.finite(Gprev$total_G12) || Gprev$total_G12 <= 0) {
      stop("Falta G12 del curso previo en retrospectiva: ", etiqueta_anio(corte))
    }
    m <- ajustar_modelo(Dc, corte, w)
    z <- data.table::copy(proyectar_modelo(m, Gc, objetivo)$resumen[
      anio_inicio == objetivo])
    if (!all(c(llaves, variables) %in% names(z)) ||
        anyDuplicated(z[, llaves, with = FALSE])) {
      stop("Proyeccion retrospectiva incompleta o duplicada.")
    }
    observado <- h[anio_inicio == objetivo, c("recinto", variables), with = FALSE]
    referencia <- h[anio_inicio == corte, c("recinto", variables), with = FALSE]
    data.table::setnames(observado, variables, paste0("observado_", variables))
    data.table::setnames(referencia, variables, paste0("base_", variables))
    z <- merge(z, observado, by = "recinto", all = TRUE, sort = FALSE)
    z <- merge(z, referencia, by = "recinto", all = TRUE, sort = FALSE)
    comparar <- c(variables, paste0("observado_", variables), paste0("base_", variables))
    if (!nrow(z) || anyNA(z[, c(llaves, comparar), with = FALSE])) {
      stop("Retrospectiva incompleta por recinto: ", etiqueta_anio(objetivo))
    }
    for (v in comparar) {
      if (!is.numeric(z[[v]]) || any(!is.finite(z[[v]]) | z[[v]] < 0)) {
        stop("Valor invalido en detalle retrospectivo: ", v)
      }
    }
    z[, `:=`(ventana = w, corte = corte, anio_G12 = corte,
              G12_curso_previo = Gprev$total_G12,
              estado_G12 = if ("estado_total" %in% names(Gprev))
                as.character(Gprev$estado_total) else "No documentado",
              condicion_escolar = paste(
                "G12 del curso previo en los archivos actuales;",
                "sin archivo historico de disponibilidad"))]
    for (v in variables) {
      obs <- z[[paste0("observado_", v)]]
      error_modelo <- z[[v]] - obs
      error_base <- z[[paste0("base_", v)]] - obs
      # Con observado cero, el error relativo no se define; el error absoluto
      # se conserva y participa en MAE y en el numerador de WMAPE.
      rel_modelo <- rep(NA_real_, length(obs))
      rel_base <- rep(NA_real_, length(obs))
      positivos <- obs > 0
      rel_modelo[positivos] <- error_modelo[positivos] / obs[positivos]
      rel_base[positivos] <- error_base[positivos] / obs[positivos]
      data.table::set(z, j = paste0("error_", v), value = error_modelo)
      data.table::set(z, j = paste0("error_absoluto_", v), value = abs(error_modelo))
      data.table::set(z, j = paste0("error_porcentual_", v), value = rel_modelo)
      data.table::set(z, j = paste0("error_base_", v), value = error_base)
      data.table::set(z, j = paste0("error_absoluto_base_", v), value = abs(error_base))
      data.table::set(z, j = paste0("error_porcentual_base_", v), value = rel_base)
    }
    # Alias conservados para consumidores previos: siempre se refieren al
    # total que excluye Escolar, salvo los dos observados explicitamente nombrados.
    z[, `:=`(observado = observado_total_no_escolar,
              observado_grado = observado_total_grado,
              error = error_total_no_escolar,
              error_absoluto = error_absoluto_total_no_escolar,
              error_porcentual = error_porcentual_total_no_escolar)]
    data.table::setorder(z, recinto)
    salidas[[length(salidas) + 1L]] <- z
  }
  detalle <- data.table::rbindlist(salidas, use.names = TRUE)
  metricas <- data.table::rbindlist(lapply(variables, function(v) {
    detalle[, {
      observado_variable <- get(paste0("observado_", v))
      denominador <- sum(observado_variable)
      absoluto_modelo <- get(paste0("error_absoluto_", v))
      absoluto_base <- get(paste0("error_absoluto_base_", v))
      list(variable = v, MAE = mean(absoluto_modelo),
           WMAPE = if (denominador > 0) sum(absoluto_modelo) / denominador else NA_real_,
           MAE_base = mean(absoluto_base),
           WMAPE_base = if (denominador > 0) sum(absoluto_base) / denominador else NA_real_,
           n_observaciones = .N)
    }, by = ventana]
  }), use.names = TRUE)
  data.table::setorderv(metricas, c("ventana", "variable"))
  data.table::setorder(detalle, ventana, anio_inicio, recinto)
  list(detalle = detalle, metricas = metricas)
}

comprobar_motor <- function() {
  # Numeradores separados de 4->5+ y 5+->5+, mas ingresos y otras entradas.
  P <- matrix(0, 6L, 6L); P[1L, 2L] <- 0.8; P[4L, 5L] <- 0.7; P[5L, 5L] <- 0.3
  x <- c(100, 0, 0, 50, 40, 0)
  y <- avanzar_subgrado(P, x, 0.1, 1000, c(0, 0, 0, 0, 5, 2))
  stopifnot(isTRUE(all.equal(y, c(100, 80, 0, 0, 52, 2))), abs(sum(y) - 234) < 1e-9)
  F <- data.table(recinto = "Prueba", nivel_origen = "Bach", anio_destino = 2025L,
    estado_origen = c("4", "4", "5 o mas", "5 o mas"),
    destino_transicion = c("5 o mas", "No observado en recinto", "5 o mas", "No observado en recinto"),
    personas = c(7L, 3L, 3L, 7L))
  E <- data.table(recinto = "Prueba", comp_destino = "Subgrado", nivel_destino = "Bach",
    anio_inicio = 2025L, ni_consistente_destino = FALSE, estado_destino = "Sin origen", personas = 2L)
  N <- data.table(recinto = "Prueba", nivel = "Bach", anio_inicio = 2024L,
    ambos_sectores_observados = TRUE, total_G12_observado = 1000, nuevo_ingreso_consistente = 100,
    anio = "2024-2025")
  Q <- data.table(recinto = "Prueba", nivel = "Bach", anio_inicio = 2025L,
    estado_cohorte = c("4", "5 o mas"), personas = c(50L, 40L))
  a <- ajustar_subgrado(F, E, N, Q, "Prueba", "Bach", 2025L, 5L)
  stopifnot(abs(a$P["4", "5 o mas"] - 0.7) < 1e-12,
            abs(a$P["5 o mas", "5 o mas"] - 0.3) < 1e-12,
            abs(a$alpha - 0.1) < 1e-12,
            abs(a$b["Sin origen"] - 0.4) < 1e-12)  # cuatro anos con cero incluidos
  E1 <- rbindlist(list(E, copy(E)[, `:=`(estado_destino = "1", personas = 3L)]))
  a1 <- ajustar_subgrado(F, E1, N, Q, "Prueba", "Bach", 2025L, 5L)
  stopifnot(abs(a1$b["1"] - 0.6) < 1e-12)
  message("COMPROBACION RAPIDA CORRECTA: transiciones, captacion, entradas pendientes y balance.")
  invisible(TRUE)
}

# Salidas del modelo preliminar. R base y data.table; sin conexiones externas.
crear_salidas_visuales <- function(destino, historico, proyeccion,
                                  validacion_metricas, sensibilidad, anclas, config) {
  if (!requireNamespace("data.table", quietly = TRUE)) stop("Falta data.table.")
  h <- data.table::as.data.table(historico)
  p <- data.table::as.data.table(proyeccion)
  s <- data.table::as.data.table(sensibilidad)
  m <- data.table::as.data.table(validacion_metricas)
  a <- data.table::as.data.table(anclas)
  base <- as.integer(config$base); fin <- as.integer(config$horizonte)
  ventana <- as.integer(config$ventana); umbral <- as.numeric(config$umbral_aux)
  vars <- c("subgrado", "posgrado", "otros", "total_grado", "total_no_escolar")
  requeridas <- c("recinto", "anio_inicio", "anio", vars)
  if (!all(requeridas %in% names(h)) || !all(requeridas %in% names(p))) stop("Faltan columnas de las series.")
  if (length(base) != 1L || length(fin) != 1L || is.na(base) || is.na(fin) || fin < base) stop("Horizonte invalido.")
  if (anyDuplicated(p[, c("recinto", "anio_inicio"), with = FALSE])) stop("Proyeccion duplicada por recinto y ano.")
  dir.create(destino, recursive = TRUE, showWarnings = FALSE)
  esc <- function(x) {
    x <- as.character(x); x[is.na(x)] <- ""
    for (z in list(c("&", "&amp;"), c("<", "&lt;"), c(">", "&gt;"), c('"', "&quot;"), c("'", "&#39;"))) x <- gsub(z[1L], z[2L], x, fixed = TRUE)
    x
  }
  fmt <- function(x) ifelse(is.finite(x), format(round(x), big.mark = ",", trim = TRUE, scientific = FALSE), "—")
  num <- function(x, dig = 1L) ifelse(is.finite(x), format(round(x, dig), big.mark = ",", trim = TRUE, nsmall = dig, scientific = FALSE), "—")
  curso <- function(y) paste0(y, "–", y + 1L)
  etiqueta <- function(x) {
    nombres <- c(Bayamon = "Bayamón", Ciencias_Medicas = "Ciencias Médicas", Rio_Piedras = "Río Piedras")
    out <- gsub("_", " ", x, fixed = TRUE)
    usar <- x %in% names(nombres); out[usar] <- unname(nombres[x[usar]])
    out
  }
  agregado <- function(x) x[, lapply(.SD, sum), by = anio_inicio, .SDcols = vars]
  ha <- agregado(h); pa <- agregado(p)
  data.table::setorder(ha, anio_inicio); data.table::setorder(pa, anio_inicio)
  colores <- c(total_grado = "#174B73", total_no_escolar = "#A35B25")
  dibujar <- function(obs, fut, titulo, compacto = FALSE) {
    ob <- obs[anio_inicio <= base]; pr <- fut[anio_inicio >= base & anio_inicio <= fin]
    yy <- c(ob$total_grado, ob$total_no_escolar, pr$total_grado, pr$total_no_escolar)
    ymax <- max(yy[is.finite(yy)], 1) * 1.12
    xmin <- min(c(ob$anio_inicio, base), na.rm = TRUE)
    plot(NA, xlim = c(xmin, fin), ylim = c(0, ymax), xlab = if (compacto) "" else "Año inicial del curso académico",
         ylab = "", main = titulo, axes = FALSE,
         cex.main = if (compacto) 1.02 else 1.1)
    if (!compacto) mtext("Matrículas", side = 2, line = 5.3, cex = 1)
    axis(1, at = pretty(c(xmin, fin), n = if (compacto) 5 else 8), cex.axis = if (compacto) .85 else 1)
    ticks <- pretty(c(0, ymax), n = 4)
    axis(2, at = ticks, labels = format(ticks, big.mark = ",", trim = TRUE, scientific = FALSE), las = 1,
         cex.axis = if (compacto) .8 else 1)
    abline(h = ticks, col = "#E5EAF0", lwd = .7); abline(v = base, col = "#9CA9B4", lty = 3)
    for (v in names(colores)) {
      lines(ob$anio_inicio, ob[[v]], col = colores[v], lwd = if (compacto) 1.5 else 2.5)
      lines(pr$anio_inicio, pr[[v]], col = colores[v], lwd = if (compacto) 1.5 else 2.5, lty = 2)
      pv <- obs[anio_inicio == base + 1L]
      if (nrow(pv)) points(pv$anio_inicio, pv[[v]], pch = 1, col = colores[v], cex = if (compacto) .9 else 1.2)
    }
    box(col = "#AEBBC6")
  }
  ruta_ag <- file.path(destino, "proyeccion_agregada.png")
  grDevices::png(ruta_ag, width = 1400, height = 850, res = 130)
  tryCatch({
    par(mar = c(5.5, 7.5, 4, 2), family = "sans", bg = "white")
    dibujar(ha, pa, "Diez recintos UPR: matrícula observada y proyección preliminar")
    legend("topright", legend = c("Grado: subgrado + posgrado", "Total sin escolares: grado + otros", "Observado", "Proyección central", "2026–2027 provisional"),
           col = c(colores, "#555555", "#555555", "#555555"), lty = c(1, 1, 1, 2, NA),
           pch = c(NA, NA, NA, NA, 1), lwd = c(2, 2, 2, 2, NA), bty = "n", cex = .82)
    mtext("La línea discontinua es la proyección; las ventanas de sensibilidad no son intervalos de confianza.", side = 1, line = 3.8, cex = .8)
  }, finally = grDevices::dev.off())
  ruta_re <- file.path(destino, "proyeccion_por_recinto.png")
  recintos <- sort(unique(p$recinto))
  grDevices::png(ruta_re, width = 1600, height = 2100, res = 135)
  tryCatch({
    par(mfrow = c(5, 2), mar = c(3, 5, 2.6, 1), oma = c(3, 1, 4, 1), family = "sans", bg = "white")
    for (r in recintos) {
      ob <- h[recinto == r]; pr <- p[recinto == r]
      data.table::setorder(ob, anio_inicio); data.table::setorder(pr, anio_inicio)
      dibujar(ob, pr, etiqueta(r), compacto = TRUE)
    }
    mtext("Proyecciones por recinto", outer = TRUE, side = 3, line = 1.6, cex = 1.2, font = 2)
    mtext("Azul: grado. Ocre: total sin escolares. Continua: observado. Discontinua: proyección. Círculo: 2026–2027 provisional.",
          outer = TRUE, side = 1, line = 1, cex = .78)
  }, finally = grDevices::dev.off())
  tabla <- function(x, titulos = names(x)) {
    if (!nrow(x)) return("<p>No disponible.</p>")
    filas <- apply(as.matrix(x), 1L, function(z) paste0("<tr><td>", paste(esc(z), collapse = "</td><td>"), "</td></tr>"))
    paste0("<div class='scroll'><table><thead><tr><th>", paste(esc(titulos), collapse = "</th><th>"),
           "</th></tr></thead><tbody>", paste(filas, collapse = ""), "</tbody></table></div>")
  }
  anios <- c(base, 2030L, 2040L, 2050L); anios <- unique(anios[anios <= fin])
  tabla_recintos <- function(variable) {
    z <- data.table::data.table(Recinto = etiqueta(recintos))
    for (y in anios) z[, (curso(y)) := vapply(recintos, function(r) {
      v <- p[recinto == r & anio_inicio == y][[variable]]
      if (length(v) == 1L) fmt(v) else "—"
    }, character(1))]
    total <- c("Diez recintos", vapply(anios, function(y) {
      v <- pa[anio_inicio == y][[variable]]; if (length(v) == 1L) fmt(v) else "—"
    }, character(1)))
    z <- data.table::rbindlist(list(z, data.table::as.data.table(as.list(stats::setNames(total, names(z))))))
    tabla(z)
  }
  vm <- if (nrow(m)) data.table::data.table(Variable = unname(c(subgrado = "Subgrado", posgrado = "Posgrado",
    otros = "Otros y pendientes", total_grado = "Grado identificado", total_no_escolar = "Total sin escolares")[m$variable]), Ventana = paste(m$ventana, "años"), MAE = num(m$MAE),
    WMAPE = paste0(num(100 * m$WMAPE), "%"), WMAPE_referencia = paste0(num(100 * m$WMAPE_base), "%"),
    Observaciones = fmt(m$n_observaciones)) else data.table::data.table()
  sens <- data.table::data.table()
  if (nrow(s)) {
    st <- s[anio_inicio %in% anios, lapply(.SD, sum), by = c("ventana", "anio_inicio"), .SDcols = vars]
    data.table::setorder(st, ventana, anio_inicio)
    sens <- data.table::data.table(Ventana = paste(st$ventana, "años"), Curso = curso(st$anio_inicio),
      Grado = fmt(st$total_grado), Sin_escolares = fmt(st$total_no_escolar))
  }
  if (nrow(a)) {
    aa <- data.table::copy(a); data.table::setorder(aa, anio_inicio)
    at <- data.table::data.table(Curso = curso(aa$anio_inicio), Pública = fmt(aa$publica),
      Privada = fmt(aa$privada), Total = fmt(aa$total_G12))
  } else at <- data.table::data.table()
  # Las dos figuras se guardan junto al HTML; basta compartir la carpeta completa.
  imagen <- function(ruta, alt) paste0("<img alt='", esc(alt), "' src='", esc(basename(ruta)), "'>")
  html <- c("<!doctype html><html lang='es'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
    "<title>Proyección preliminar de matrícula UPR</title><style>body{font:16px/1.55 Arial,sans-serif;color:#253445;background:#f5f7fa;margin:0}main{max-width:1180px;margin:auto;padding:32px;background:white}h1,h2{line-height:1.2;color:#174b73}h1{font-size:30px}h2{font-size:23px;margin-top:32px}.nota{padding:14px 18px;background:#eef4f8;border-left:4px solid #174b73}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:14px 0}th,td{padding:8px 11px;border-bottom:1px solid #dce3e9;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#eef4f8}img{width:100%;height:auto}li{margin:7px 0}small{color:#556575}@media print{body,main{background:white}main{padding:0}h2,table,img{break-inside:avoid}}</style><main>",
    "<h1>Proyección preliminar de matrícula</h1>",
    paste0("<p>Base: ", curso(base), ". Horizonte: ", curso(fin), ". Ventana central: ", ventana, " años.</p>"),
    "<p class='nota'>El agregado comprende diez recintos. Falta Mayagüez y, por ello, no representa la matrícula completa del sistema UPR. Las cifras futuras son resultados de un modelo preliminar.</p>",
    "<p><strong>Grado identificado</strong> suma subgrado y posgrado. <strong>Total sin escolares</strong> añade otros registros no homologados del censo; no equivale a grado certificado. Las personas se deduplican dentro de cada recinto; sumar recintos no identifica personas únicas de todo el sistema.</p>",
    imagen(ruta_ag, "Matrícula agregada observada y proyectada de diez recintos"),
    "<h2>Matrícula de grado por recinto</h2>", tabla_recintos("total_grado"),
    "<h2>Total sin escolares por recinto</h2>", tabla_recintos("total_no_escolar"),
    "<h2>Validación retrospectiva condicionada al insumo escolar</h2>",
    "<p>Cada corte utiliza únicamente información universitaria hasta ese año. La prueba está condicionada a G12 del curso previo y a las versiones actuales de los archivos históricos; no reproduce fechas de publicación ni archivos históricos congelados. La referencia conserva la matrícula del último censo. MAE es el error absoluto medio y WMAPE divide la suma de errores absolutos entre la matrícula observada total.</p>", tabla(vm),
    "<h2>Sensibilidad a la ventana histórica</h2><p>Las ventanas de tres y cinco años muestran sensibilidad a la calibración. No constituyen intervalos de confianza ni de predicción.</p>", tabla(sens),
    "<h2>Supuestos del modelo</h2><ul>",
    "<li>El subgrado distingue seis estados: años 1, 2, 3, 4, 5 o más y Sin origen. La clasificación académica no se interpreta como antigüedad. El estado 5 o más admite un origen asignado por evidencia o una cota temporal mínima; no expresa cursos efectivamente matriculados.</li>",
    "<li>La matrícula siguiente combina continuidad entre estados, ingreso desde secundaria y promedio histórico de otras incorporaciones. Las matrices conservan diferencias por recinto y grado.</li>",
    "<li>La captación usa cocientes entre nuevo ingreso consistente y matrícula G12 observada; la serie observada permite cocientes hasta el ingreso de 2024. G12 es matrícula de duodécimo, no graduados efectivos.</li>",
    "<li>G12 futura sigue un escenario proporcional a la población de edad 17, según la mediana demográfica aportada e interpolada anualmente. Conserva la proporción pública/privada de 2025; no recalcula GPR escolares futuros ni produce intervalos predictivos.</li>",
    paste0("<li>Posgrado y otros componentes usan persistencia multiplicada por matrícula previa más incorporaciones promedio. Con exposición inferior a ", fmt(umbral), " o sin salidas observadas, el stock se mantiene constante.</li>"),
    "<li>2026–2027 queda como contraste porque no se ha certificado la consolidación de su censo inicial. La falta del segundo semestre no invalida por sí sola un censo de inicio. Se conserva la información recibida sin completar períodos.</li></ul>",
    "<h2>Anclas escolares quinquenales</h2>", tabla(at),
    "<h2>Trayectorias de los diez recintos</h2>", imagen(ruta_re, "Trayectorias observadas y proyectadas por recinto"),
    "<p><small>Los conteos mostrados se redondean al entero; los cálculos conservan su precisión. Una salida del censo no distingue graduación, abandono, pausa ni traslado.</small></p></main></html>")
  ruta_html <- file.path(destino, "informe_preliminar.html")
  writeLines(enc2utf8(html), ruta_html, useBytes = TRUE)
  invisible(c(html = ruta_html, agregado = ruta_ag, recintos = ruta_re))
}

ejecutar_etapa3 <- function(raiz, carpeta_etapa2 = NULL) {
  comprobar_motor()
  entrada <- cargar_etapa2_v2(raiz, carpeta_etapa2)
  etapa <- entrada$etapa
  D <- entrada$D
  message("Etapa 2 COMPLETA v2 utilizada: ", etapa)
  controles <- as.data.table(validar_entradas_03(D$C, D$Q, D$N, D$F, D$B, D$E))
  D$C[, auxiliar := fcase(componente == "Subgrado", "Subgrado", componente == "Posgrado", "Posgrado", componente == "Escolar", "Escolar", default = "Otros")]
  D$B[, auxiliar := fcase(componente == "Subgrado", "Subgrado", componente == "Posgrado", "Posgrado", componente == "Escolar", "Escolar", default = "Otros")]
  message("Insumos universitarios y balances verificados.")
  message("Preparando G12: extension privada y escenario demografico anual.")
  escolar <- construir_G12(raiz, config$horizonte)
  G12 <- escolar$anual
  # Verifica que las dos etapas usan el mismo G12 y el mismo desfase temporal.
  denominadores <- unique(D$N[ambos_sectores_observados == TRUE,
                              .(anio_inicio, total_G12_observado)])
  denominadores[, G12_recalculado := G12$total_G12[match(anio_inicio - 1L, G12$anio_inicio)]]
  if (anyNA(denominadores$G12_recalculado) ||
      any(abs(denominadores$total_G12_observado - denominadores$G12_recalculado) > 1e-8))
    stop("El G12 escolar no coincide con los denominadores observados de etapa 2.")
  historico <- historico_componentes(D$C)
  base_observada <- historico[anio_inicio == config$base]
  if (!nrow(base_observada) || uniqueN(base_observada$recinto) != uniqueN(historico$recinto))
    stop("Falta el censo base de algun recinto.")
  if (any(D$C[anio_inicio == config$base, provisional]))
    stop("El censo base esta marcado como provisional; se requiere revisar su consolidacion antes de usarlo como base.")
  message("Base ", etiqueta_anio(config$base), ": ", sum(base_observada$total_grado),
    " matriculas de grado identificado; ", sum(base_observada$otros), " otros no homologados; ",
    sum(base_observada$escolar), " escolares separados del universo proyectado.")
  modelos <- list(); pronosticos <- list()
  for (w in config$ventanas_sensibilidad) {
    message("Ajustando y proyectando con ventana de ", w, " anos.")
    m <- ajustar_modelo(D, config$base, w)
    z <- proyectar_modelo(m, G12, config$horizonte)
    modelos[[as.character(w)]] <- m; pronosticos[[as.character(w)]] <- z
  }
  principal <- pronosticos[[as.character(config$ventana)]]
  modelo <- modelos[[as.character(config$ventana)]]
  if (is.null(principal)) stop("La ventana principal debe estar entre las ventanas de sensibilidad.")
  variables_base <- c("subgrado", "posgrado", "otros", "total_grado", "total_no_escolar")
  prueba <- merge(base_observada[, c("recinto", variables_base), with = FALSE],
    principal$resumen[anio_inicio == config$base, c("recinto", variables_base), with = FALSE],
    by = "recinto", all = TRUE, suffixes = c("_real", "_modelo"))
  if (anyNA(prueba)) stop("La base proyectada no concilia todos los recintos.")
  for (v in variables_base) if (any(abs(prueba[[paste0(v, "_real")]] - prueba[[paste0(v, "_modelo")]]) > 1e-8))
    stop("La base proyectada no concilia el componente ", v, ".")
  validacion <- validar_retrospectiva(D, G12, historico)
  sensibilidad <- rbindlist(lapply(names(pronosticos), function(w) {
    z <- copy(pronosticos[[w]]$resumen); z[, ventana := as.integer(w)]; z
  }))
  marca <- paste0(format(Sys.time(), "%Y%m%d_%H%M%S"), "_", Sys.getpid())
  destino <- file.path(raiz, "resultados", paste0("proyeccion_", marca))
  if (!dir.create(destino, recursive = TRUE, showWarnings = FALSE)) stop("No se pudo crear la carpeta de resultados.")
  message("Guardando tablas e informe en: ", destino)
  exportar(G12, "01_G12_anual.csv", destino)
  exportar(escolar$quinquenal, "01b_G12_quinquenal.csv", destino)
  exportar(rbindlist(lapply(modelo$sub, function(m) m$captacion)), "02_coeficientes_captacion.csv", destino)
  exportar(rbindlist(lapply(modelo$sub, function(m) m$parametros_P)), "03_matrices_transicion.csv", destino)
  exportar(rbindlist(lapply(modelo$sub, function(m) m$otras)), "04_otras_incorporaciones.csv", destino)
  exportar(rbindlist(lapply(modelo$aux, function(m) m$parametros)), "04b_parametros_auxiliares.csv", destino)
  exportar(principal$estados, "05_proyeccion_subgrado_estados.csv", destino)
  exportar(principal$ingresos, "05b_nuevos_ingresos_proyectados.csv", destino)
  exportar(principal$resumen, "06_proyeccion_por_recinto.csv", destino)
  agregado <- principal$resumen[, lapply(.SD, sum), by = .(anio_inicio, anio),
                               .SDcols = c("subgrado", "posgrado", "otros", "total_grado", "total_no_escolar")]
  exportar(agregado, "07_agregado_recintos_disponibles.csv", destino)
  exportar(validacion$detalle, "08_validacion_retrospectiva_condicional.csv", destino)
  exportar(validacion$metricas, "08b_metricas_validacion.csv", destino)
  posterior <- config$base + 1L
  comparacion <- merge(principal$resumen[anio_inicio == posterior],
    historico[anio_inicio == posterior, .(recinto, observado_provisional = total_no_escolar,
      observado_grado = total_grado, observado_escolar_separado = escolar)], by = "recinto", all.x = TRUE)
  comparacion[, `:=`(diferencia = total_no_escolar - observado_provisional,
    diferencia_relativa = fifelse(observado_provisional > 0,
                                  (total_no_escolar - observado_provisional) / observado_provisional, NA_real_))]
  exportar(comparacion, "09_contraste_provisional_2026.csv", destino)
  exportar(sensibilidad, "10_sensibilidad_ventanas.csv", destino)
  exportar(controles, "11_controles_entradas.csv", destino)
  exportar(entrada$control, "11b_trazabilidad_etapa2.csv", destino)
  exportar(escolar$fuentes, "12_fuentes_escolares.csv", destino)
  exportar(historico, "13_historico_componentes.csv", destino)
  configuracion <- data.table(parametro = c("base", "horizonte", "ventana_principal", "ventanas_sensibilidad", "umbral_auxiliar"),
    valor = c(config$base, config$horizonte, config$ventana,
              paste(config$ventanas_sensibilidad, collapse = ", "), config$umbral_aux))
  configuracion <- rbindlist(list(configuracion, data.table(parametro = c("version", "etapa2", "objetivo", "universo", "G12", "2026", "validacion"),
    valor = c(version_etapa3, etapa, "Matricula al inicio del ano: periodos iniciales y anual por calendario",
      "Grado identificado y Otros no homologados por separado; Escolar excluido",
      "Matricula G12 como insumo condicionado; no graduados; futura proporcional a poblacion17 mediana",
      "Censo inicial no certificado como consolidado; contraste provisional, no entrenamiento",
      "Cortes universitarios sin informacion posterior; condicionada a G12 y archivos actuales"))), use.names = TRUE)
  exportar(configuracion, "14_configuracion.csv", destino)
  universo <- D$C[, .(personas = sum(personas)), by = .(recinto, anio, componente, nivel, auxiliar)]
  universo[, tratamiento := fcase(auxiliar == "Escolar", "Excluido: clasificacion escolar explicita",
    auxiliar == "Otros", "Auxiliar separado: no homologado a grado", default = "Grado identificado")]
  exportar(universo, "15_universo_componentes.csv", destino)
  calidad_base <- D$Q[anio_inicio == config$base, .(subgrado = sum(personas),
    sin_origen = sum(personas[estado_cohorte == "Sin origen"]),
    cinco_mas_por_cota = sum(personas[base_grupo_antiguedad == "Cota minima por observacion"])), by = recinto]
  calidad_base[, proporcion_sin_origen := sin_origen / subgrado]
  exportar(calidad_base, "16_calidad_base_subgrado.csv", destino)
  exportar(prueba, "16b_conciliacion_base.csv", destino)
  config$n_recintos <- uniqueN(historico$recinto)
  crear_salidas_visuales(destino, historico, principal$resumen, validacion$metricas,
                         sensibilidad, escolar$quinquenal, config)
  saveRDS(list(config = config, modelos = modelos, escolar = escolar, etapa2 = etapa),
          file.path(destino, "modelo_preliminar.rds"), compress = "gzip")
  capture.output(sessionInfo(), file = file.path(destino, "sesion_R.txt"))
  writeLines(c(
    "PROYECCION PRELIMINAR UPR - ETAPA 3 v2.0", "",
    "Abrir informe_preliminar.html en el navegador. Mantener los PNG junto al HTML.",
    "06 contiene la proyeccion central por recinto; 07 el agregado de los recintos disponibles.",
    "total_grado = subgrado + posgrado. total_no_escolar suma Otros no homologados; Escolar esta excluido.",
    "El agregado no representa personas unicas del sistema ni incluye Mayaguez.",
    "El ano base es 2025-2026. 2026-2027 se conserva como contraste porque no se ha certificado la consolidacion de su censo inicial.",
    "La falta del segundo semestre no invalida por si sola un censo de inicio; no se afirma que todos los periodos posteriores esten ausentes.",
    "La historia conserva total_registrado y Escolar para conciliar el archivo original; no se proyecta Escolar.",
    "Las proyecciones son valores esperados sin redondear. Redondear solo al presentarlas.",
    "La captacion usa matricula G12, no graduados efectivos, con desfase de un curso.",
    "Captacion central: ultimas cinco cohortes con denominador observado (ingreso2020-2024); las transiciones centrales usan2021-2025.",
    "Privada2024-2025 y2025-2026 se estima como en el informe escolar, pero no se trata como denominador observado para captacion.",
    "El G12 futuro es un escenario proporcional a poblacion de17 anos mediana, con proporcion publica/privada fija. No es una proyeccion nueva de GPR escolares.",
    "Se conservan cohortes desconocidas; no se repartieron entre los anos conocidos.",
    "Las otras incorporaciones, y las de componentes auxiliares, permanecen constantes en el escenario.",
    "Los auxiliares con poca historia conservan su stock de base; ver 04b.",
    "La ventana principal es cinco anos; tres anos es sensibilidad, no intervalo probabilistico.",
    "Cada retrospectiva ajusta con datos universitarios hasta su corte; no utiliza filas posteriores.",
    "Es condicionada a G12 del curso previo y a las versiones actuales de los archivos; no reproduce un archivo historico congelado.",
    "08b compara subgrado, posgrado, Otros, grado y total sin escolares contra conservar el stock del ultimo ano.",
    "Los resultados de sensibilidad3/5 no son percentiles ni escenarios probabilisticos.",
    "No se ha propagado toda la incertidumbre escolar, demografica o universitaria.", "",
    "Para revision: compartir TODOS los CSV, TXT, HTML y PNG. El RDS puede permanecer local. El informe y la presentacion finales se preparan despues de validar estas salidas."
  ), file.path(destino, "LEER_ETAPA_3.txt"))
  estado <- data.table(version = version_etapa3, etapa2 = basename(etapa), procesamiento_completo = TRUE,
    revision_tecnica_pendiente = TRUE, base = config$base, horizonte = config$horizonte,
    recintos = uniqueN(historico$recinto), matriculas_grado_base = sum(base_observada$total_grado),
    otros_no_homologados_base = sum(base_observada$otros), escolares_excluidos_base = sum(base_observada$escolar),
    total_no_escolar_base = sum(base_observada$total_no_escolar),
    filas_proyeccion = nrow(principal$resumen), balances_verificados = nrow(D$B),
    fecha_utc = format(Sys.time(), "%Y-%m-%d %H:%M:%S", tz = "UTC"))
  exportar(estado, "17_estado_ejecucion.csv", destino)
  writeLines("ETAPA 3 v2.0: PROCESAMIENTO COMPLETO; pendiente revision antes del informe y presentacion finales.", file.path(destino, "COMPLETO.txt"))
  message("TERMINADO. Vista para revision: ", file.path(destino, "informe_preliminar.html"))
  invisible(destino)
}


ruta_etapa_3 <- ejecutar_etapa3(raiz, carpeta_etapa2)
