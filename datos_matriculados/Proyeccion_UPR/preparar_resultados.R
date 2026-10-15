# Recursos compartidos para Informe_UPR.Rmd y Presentacion_UPR.Rmd.
# El archivo se puede cargar mediante source(..., local = TRUE).
# No ajusta el modelo ni modifica los CSV de la etapa 3.
# Interfaz:
#   d <- cargar_resultados(raiz_del_paquete)
#   generar_figuras(d, raiz_del_paquete)
# Solo requiere R base y los dispositivos grDevices.

etiqueta_curso <- function(anio) paste0(anio, "–", anio + 1L)
formato_entero <- function(x) formatC(x, format = "f", digits = 0L, big.mark = ",")
formato_decimal <- function(x, digitos = 2L) formatC(x, format = "f", digits = digitos, big.mark = ",")
formato_porcentaje <- function(x, digitos = 2L) paste0(formato_decimal(100 * x, digitos), "%")
nombre_recinto <- function(x) {
  m <- c(Bayamon = "Bayamón", Ciencias_Medicas = "Ciencias Médicas", Rio_Piedras = "Río Piedras")
  i <- match(x, names(m)); z <- as.character(x); z[!is.na(i)] <- unname(m[i[!is.na(i)]]); z
}

cargar_resultados <- function(raiz = ".") {
  archivos <- c(G12 = "01_G12_anual.csv", G12_quinquenal = "01b_G12_quinquenal.csv",
    captacion = "02_coeficientes_captacion.csv", transiciones = "03_matrices_transicion.csv",
    otras_incorporaciones = "04_otras_incorporaciones.csv", parametros_auxiliares = "04b_parametros_auxiliares.csv",
    estados = "05_proyeccion_subgrado_estados.csv", nuevos_ingresos = "05b_nuevos_ingresos_proyectados.csv",
    proyeccion_recintos = "06_proyeccion_por_recinto.csv", agregado = "07_agregado_recintos_disponibles.csv",
    validacion = "08_validacion_retrospectiva_condicional.csv", metricas_exportadas = "08b_metricas_validacion.csv",
    contraste = "09_contraste_provisional_2026.csv", sensibilidad = "10_sensibilidad_ventanas.csv",
    controles = "11_controles_entradas.csv", fuentes = "12_fuentes_escolares.csv",
    historico = "13_historico_componentes.csv", configuracion = "14_configuracion.csv",
    universo = "15_universo_componentes.csv", calidad_base = "16_calidad_base_subgrado.csv")
  d <- lapply(archivos, function(a) {
    ruta <- file.path(raiz, "data", a)
    if (!file.exists(ruta)) stop("Falta el insumo ", ruta, call. = FALSE)
    read.csv(ruta, fileEncoding = "UTF-8-BOM", stringsAsFactors = FALSE, check.names = FALSE)
  })
  names(d) <- names(archivos)
  # Las sumas de recinto son matriculas: no deduplican personas entre recintos.
  cols <- c("subgrado", "posgrado", "otros", "total_grado", "total_no_escolar")
  if (!all(cols %in% names(d$historico)) || !all(cols %in% names(d$agregado)))
    stop("Los CSV no corresponden a la version 2: falta total_no_escolar.", call. = FALSE)
  comprobar_totales <- function(x, etiqueta) {
    if (any(!is.finite(as.matrix(x[cols])))) stop("Valores no finitos en ", etiqueta)
    if (any(abs(x$total_grado - x$subgrado - x$posgrado) > 1e-7) ||
        any(abs(x$total_no_escolar - x$total_grado - x$otros) > 1e-7))
      stop("Los componentes no concilian en ", etiqueta, call. = FALSE)
  }
  comprobar_totales(d$historico, "historico")
  comprobar_totales(d$agregado, "agregado")
  comprobar_totales(d$proyeccion_recintos, "proyeccion por recinto")
  comprobar_totales(d$sensibilidad, "sensibilidad")
  d$historico_agregado <- aggregate(d$historico[cols], d$historico["anio_inicio"], sum)
  d$sensibilidad_agregada <- aggregate(d$sensibilidad[cols], d$sensibilidad[c("anio_inicio", "ventana")], sum)
  d$historico_agregado$anio <- etiqueta_curso(d$historico_agregado$anio_inicio)
  d$sensibilidad_agregada$anio <- etiqueta_curso(d$sensibilidad_agregada$anio_inicio)
  v <- d$validacion
  # La base de persistencia viene del corte de cada retrospectiva. Se concilia
  # contra el censo del curso previo sin reestimar ni consultar microdatos.
  hprev <- d$historico[c("recinto", "anio_inicio", cols)]
  hprev$anio_inicio <- hprev$anio_inicio + 1L
  names(hprev)[match(cols, names(hprev))] <- paste0("previo_", cols)
  v <- merge(v, hprev, by = c("recinto", "anio_inicio"), all.x = TRUE, sort = FALSE)
  for (cc in cols) {
    if (anyNA(v[[paste0("previo_", cc)]]) ||
        any(abs(v[[paste0("previo_", cc)]] - v[[paste0("base_", cc)]]) > 1e-7))
      stop("No concilia la base retrospectiva para ", cc, call. = FALSE)
  }
  v$error_grado <- v$total_grado - v$observado_total_grado
  v$error_persistencia_grado <- v$base_total_grado - v$observado_total_grado
  v$error_persistencia_subgrado <- v$base_subgrado - v$observado_subgrado
  # Aliases historicos de la interfaz; todos se refieren al universo no escolar.
  v$observado_grado <- v$observado_total_grado
  v$observado <- v$observado_total_no_escolar
  d$validacion_grado <- v
  medidas <- function(pred, obs) {
    if (length(pred) != length(obs) || !length(obs) || any(!is.finite(c(pred, obs))))
      stop("Serie de validacion incompleta.", call. = FALSE)
    c(MAE = mean(abs(pred - obs)),
      WMAPE = if (sum(obs) > 0) sum(abs(pred - obs))/sum(obs) else NA_real_,
      n = length(obs))
  }
  componentes <- c(Subgrado = "subgrado", Posgrado = "posgrado", Grado = "total_grado",
                    Otros = "otros", Todos = "total_no_escolar")
  resumen <- list(); k <- 0L
  for (w in sort(unique(v$ventana))) for (g in names(componentes)) {
    a <- v[v$ventana == w, ]; cc <- componentes[[g]]
    for (metodo in c("Modelo", "Persistencia")) {
      pred <- a[[if (metodo == "Modelo") cc else paste0("base_", cc)]]
      mm <- medidas(pred, a[[paste0("observado_", cc)]]); k <- k + 1L
      resumen[[k]] <- data.frame(ventana = w, componente = g, metodo = metodo,
        MAE = mm[1], WMAPE = mm[2], n = as.integer(mm[3]), row.names = NULL)
    }
  }
  d$metricas_componentes <- do.call(rbind, resumen)
  # Evita que el informe y las diapositivas usen otra definicion de error.
  for (i in seq_len(nrow(d$metricas_componentes))) {
    z <- d$metricas_componentes[i, ]; variable <- componentes[[z$componente]]
    ref <- d$metricas_exportadas[d$metricas_exportadas$ventana == z$ventana &
                               d$metricas_exportadas$variable == variable, ]
    if (nrow(ref) != 1L) stop("Metrica exportada ausente o repetida: ", variable)
    sufijo <- if (z$metodo == "Modelo") "" else "_base"
    if (!isTRUE(all.equal(z$MAE, ref[[paste0("MAE", sufijo)]], tolerance = 1e-9)) ||
        !isTRUE(all.equal(z$WMAPE, ref[[paste0("WMAPE", sufijo)]], tolerance = 1e-9)) ||
        z$n != ref$n_observaciones)
      stop("La metrica no coincide con 08b: ", variable, ", ventana ", z$ventana, call. = FALSE)
  }
  resumen <- list(); k <- 0L
  for (w in sort(unique(v$ventana))) for (r in sort(unique(v$recinto))) {
    a <- v[v$ventana == w & v$recinto == r, ]
    for (metodo in c("Modelo", "Persistencia")) {
      mm <- medidas(if (metodo == "Modelo") a$total_grado else a$base_total_grado, a$observado_total_grado)
      k <- k + 1L
      resumen[[k]] <- data.frame(recinto = r, ventana = w, metodo = metodo,
        MAE = mm[1], WMAPE = mm[2], n = as.integer(mm[3]), row.names = NULL)
    }
  }
  d$metricas_recintos <- do.call(rbind, resumen)
  obs26 <- d$historico[d$historico$anio_inicio == 2026L,
    c("recinto", "total_grado", "subgrado", "posgrado", "otros", "total_no_escolar")]
  names(obs26)[-1L] <- paste0("observado_", names(obs26)[-1L])
  d$contraste_grado <- merge(d$proyeccion_recintos[d$proyeccion_recintos$anio_inicio == 2026L, ], obs26, by = "recinto")
  d$contraste_grado$diferencia_grado <- d$contraste_grado$total_grado - d$contraste_grado$observado_total_grado
  d$contraste_grado$diferencia_relativa_grado <- d$contraste_grado$diferencia_grado / d$contraste_grado$observado_total_grado
  d
}

generar_figuras <- function(d, raiz = ".") {
  destino <- file.path(raiz, "figuras"); dir.create(destino, recursive = TRUE, showWarnings = FALSE)
  azul <- "#174A6E"; azul2 <- "#2F6690"; naranja <- "#D97706"; tinta <- "#303C44"
  grafico <- function(nombre, ancho, alto, fun, puntos = 15) {
    grDevices::png(file.path(destino, nombre), width = ancho, height = alto, units = "in", res = 200,
                   pointsize = puntos, type = if (capabilities("cairo")) "cairo" else getOption("bitmapType"))
    on.exit(grDevices::dev.off(), add = TRUE)
    graphics::par(family = "serif", las = 1, bty = "l", fg = tinta, col.axis = tinta,
      col.lab = tinta, col.main = tinta, font.main = 1, mar = c(4.8, 6.2, 2.8, 1),
      mgp = c(3, .7, 0), tcl = -.25)
    fun()
  }
  ejes <- function(x, y, xticks, ylim = NULL, ylab = "Matrículas", titulo = "",
                   xlab = "Curso académico (año inicial)") {
    plot(x, y, type = "n", xaxt = "n", yaxt = "n", xlab = xlab, ylab = "",
         ylim = ylim, main = titulo)
    abline(h = axTicks(2), col = "#E3E8EC", lwd = .7)
    axis(1, at = xticks)
    axis(2, at = axTicks(2), labels = formato_entero(axTicks(2)))
    if (nzchar(ylab)) mtext(ylab, side = 2, line = 4.5, las = 0)
  }
  h <- d$historico_agregado; a <- d$agregado
  grafico("historico_grado.png", 9, 4.8, function() {
    z <- h[h$anio_inicio <= 2025, ]; u <- h[h$anio_inicio == 2026, ]
    ejes(h$anio_inicio, h$total_grado, seq(2017, 2026),
         ylim = range(h$total_grado)*c(.96, 1.06), titulo = "Subgrado y posgrado: suma de diez recintos")
    lines(z$anio_inicio, z$total_grado, col = azul, lwd = 2.5)
    points(z$anio_inicio, z$total_grado, col = azul, pch = 16, cex = .6)
    points(u$anio_inicio, u$total_grado, col = naranja, pch = 1, lwd = 2, cex = 1)
    legend("topright", c("Censos 2017–2025", "Censo 2026: contraste provisional"),
           col = c(azul, naranja), pch = c(16, 1), lty = c(1, NA), bty = "n", cex = .86)
  })
  grafico("proyeccion_grado.png", 9, 5.0, function() {
    z <- h[h$anio_inicio <= 2025, ]
    s3 <- d$sensibilidad_agregada[d$sensibilidad_agregada$ventana == 3, ]
    ejes(c(2017, 2050), range(c(h$total_grado, a$total_grado, s3$total_grado)),
      c(2017, 2025, 2030, 2040, 2050), ylim = c(0, max(h$total_grado)*1.12),
      titulo = "Subgrado y posgrado: proyección condicional")
    abline(v = 2025, col = "#B6BEC4", lty = 3)
    lines(z$anio_inicio, z$total_grado, col = azul, lwd = 2.5)
    lines(a$anio_inicio, a$total_grado, col = azul2, lwd = 2.5, lty = 2)
    lines(s3$anio_inicio, s3$total_grado, col = naranja, lwd = 1.8, lty = 3)
    points(2026, h$total_grado[h$anio_inicio == 2026], pch = 1, col = tinta, cex = .95, lwd = 1.5)
    legend("topright", c("Observado hasta 2025", "Proyección: ventana de 5 años",
      "Sensibilidad: ventana de 3 años", "Censo 2026: contraste provisional"),
      col = c(azul, azul2, naranja, tinta), lty = c(1, 2, 3, NA),
      pch = c(NA, NA, NA, 1), lwd = c(2, 2, 1.8, NA), bty = "n", cex = .80)
  })
  panel_recinto <- function(r) {
    hh <- d$historico[d$historico$recinto == r, ]
    aa <- d$proyeccion_recintos[d$proyeccion_recintos$recinto == r, ]
    zz <- hh[hh$anio_inicio <= 2025, ]
    ss <- d$sensibilidad[d$sensibilidad$recinto == r & d$sensibilidad$ventana == 3, ]
    ejes(c(2017, 2050), range(c(hh$total_grado, aa$total_grado)),
      c(2017, 2025, 2035, 2050), ylim = c(0, max(c(hh$total_grado, aa$total_grado, ss$total_grado))*1.1),
      ylab = "", titulo = nombre_recinto(r), xlab = "")
    abline(v = 2025, col = "#B6BEC4", lty = 3)
    lines(zz$anio_inicio, zz$total_grado, col = azul, lwd = 2.4)
    lines(aa$anio_inicio, aa$total_grado, col = azul2, lty = 2, lwd = 2.4)
    lines(ss$anio_inicio, ss$total_grado, col = naranja, lty = 3, lwd = 1.7)
    points(2026, hh$total_grado[hh$anio_inicio == 2026], pch = 1, cex = .9, lwd = 1.5, col = tinta)
  }
  grafico("proyeccion_recintos.png", 11, 12, function() {
    par(mfrow = c(5, 2), mar = c(2.8, 4.6, 2.1, .8), oma = c(4.1, .6, 2.5, 0),
        mgp = c(2.5, .55, 0), cex = .9)
    for (r in sort(unique(d$historico$recinto))) panel_recinto(r)
    mtext("Subgrado y posgrado por recinto", outer = TRUE, side = 3, line = .8, cex = 1.2)
    mtext("Matrículas; cada panel tiene su propia escala vertical. Año inicial del curso académico.",
      outer = TRUE, side = 1, line = .9, cex = .85)
    mtext("Continua: observado · Azul discontinua: ventana 5 · Naranja: ventana 3 · Círculo: 2026 provisional",
      outer = TRUE, side = 1, line = 2.0, cex = .78)
  })
  # Cinco recintos y una leyenda por diapositiva, con letras de igual tamano.
  for (pagina in 1:2) grafico(paste0("recintos_", pagina, ".png"), 13, 6.8, function() {
    par(mfrow = c(2, 3), mar = c(2.6, 4.4, 2.0, .6),
        oma = c(2.1, 0, 0, 0), mgp = c(2.4, .55, 0), cex = .95)
    rr <- sort(unique(d$historico$recinto))[seq.int((pagina - 1L)*5L + 1L, pagina*5L)]
    for (r in rr) panel_recinto(r)
    plot.new()
    legend("center", c("Observado hasta 2025", "Proyección: ventana 5",
      "Sensibilidad: ventana 3", "2026: contraste provisional"),
      col = c(azul, azul2, naranja, tinta), lty = c(1, 2, 3, NA),
      pch = c(NA, NA, NA, 1), lwd = c(2.4, 2.4, 1.7, NA), bty = "n", cex = 1)
    mtext("Matrículas de subgrado y posgrado · Escalas verticales propias · Año inicial del curso",
      outer = TRUE, side = 1, line = .65, cex = .95)
  }, puntos = 16)
  grafico("G12.png", 9, 5.0, function() {
    g <- d$G12[is.finite(d$G12$total_G12), ]
    o <- g[g$anio_inicio <= 2023, ]; es <- g[g$anio_inicio %in% 2023:2025, ]
    pr <- g[g$anio_inicio >= 2025, ]
    ejes(g$anio_inicio, g$total_G12, c(2008, 2017, 2025, 2030, 2040, 2050),
      ylim = c(0, max(g$total_G12)*1.14), titulo = "Duodécimo grado: matrícula pública y privada")
    lines(o$anio_inicio, o$total_G12, col = azul, lwd = 2.5)
    lines(es$anio_inicio, es$total_G12, col = naranja, lwd = 2.4, lty = 3)
    points(es$anio_inicio[-1], es$total_G12[-1], pch = 16, cex = .65, col = naranja)
    lines(pr$anio_inicio, pr$total_G12, col = azul2, lwd = 2.5, lty = 2)
    an <- g[g$anio_inicio > 2025 & g$es_anclaje %in% c(TRUE, "True"), ]
    points(an$anio_inicio, an$total_G12, pch = 16, col = azul2, cex = .55)
    legend("topright", c("Ambos sectores observados", "Privada estimada en 2024 y 2025",
      "Escenario futuro; anclajes quinquenales"), col = c(azul, naranja, azul2),
      lty = c(1, 3, 2), lwd = 2, bty = "n", cex = .80)
  })
  grafico("validacion_grado.png", 9, 5.6, function() {
    m <- d$metricas_recintos[d$metricas_recintos$ventana == 5, ]
    rr <- sort(unique(m$recinto)); yy <- rev(seq_along(rr))
    par(mar = c(4.6, 8.6, 2.8, 1))
    plot(c(0, max(m$WMAPE)*115), range(yy)+c(-.5,.5), type = "n", yaxt = "n",
      xlab = "Error absoluto porcentual ponderado (%)", ylab = "",
      main = "Subgrado y posgrado: retrospectiva condicional 2023–2025")
    abline(v = axTicks(1), col = "#E3E8EC", lwd = .7)
    axis(2, at = yy, labels = nombre_recinto(rr), las = 1, tick = FALSE)
    for (i in seq_along(rr)) {
      z <- m[m$recinto == rr[i], ]
      p <- z$WMAPE[z$metodo == "Modelo"]*100
      b <- z$WMAPE[z$metodo == "Persistencia"]*100
      segments(p, yy[i], b, yy[i], col = "#B6BEC4", lwd = 1.4)
      points(p, yy[i]+.08, pch = 16, col = azul, cex = 1)
      points(b, yy[i]-.08, pch = 17, col = naranja, cex = 1)
    }
    legend("topright", c("Modelo: ventana de 5 años", "Censo del curso anterior"),
      col = c(azul, naranja), pch = c(16,17), bty = "n", cex = .83)
  })
  invisible(file.path(destino, c("historico_grado.png", "proyeccion_grado.png",
    "proyeccion_recintos.png", "G12.png", "validacion_grado.png", "recintos_1.png", "recintos_2.png")))
}
