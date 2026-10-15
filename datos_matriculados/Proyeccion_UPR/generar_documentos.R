# Abrir este archivo guardado en RStudio y pulsar Source.
# Regenera el informe Word, las diapositivas HTML y sus figuras desde los CSV.
# No vuelve a leer los microdatos ni ajusta la proyección de la etapa 3.
paquetes <- c("rmarkdown", "knitr", "flextable", "officer")
faltan <- paquetes[!vapply(paquetes, requireNamespace, logical(1), quietly = TRUE)]
if (length(faltan)) {
  stop("Instala antes los paquetes faltantes con install.packages(c(",
       paste(sprintf('"%s"', faltan), collapse = ", "), "))", call. = FALSE)
}
raiz <- if (requireNamespace("this.path", quietly = TRUE)) {
  this.path::this.dir()
} else {
  # Respaldo para Rscript y source() cuando this.path no esté instalado.
  fuentes <- Filter(Negate(is.null), lapply(sys.frames(), function(e) e$ofile))
  entrada <- if (length(fuentes)) tail(fuentes, 1L)[[1L]] else {
    arg <- grep("^--file=", commandArgs(), value = TRUE)
    if (length(arg)) sub("^--file=", "", arg[1L]) else NA_character_
  }
  if (is.na(entrada)) stop("Abre el archivo guardado y pulsa Source, o instala this.path.", call. = FALSE)
  dirname(normalizePath(entrada, winslash = "/", mustWork = TRUE))
}
raiz <- normalizePath(raiz, winslash = "/", mustWork = TRUE)
if (!rmarkdown::pandoc_available()) stop("No se encontró Pandoc. Ejecuta desde RStudio.", call. = FALSE)
source(file.path(raiz, "preparar_resultados.R"), local = TRUE, encoding = "UTF-8")
res <- cargar_resultados(raiz)
generar_figuras(res, raiz)
for (archivo in c("Informe_UPR.Rmd", "Presentacion_UPR.Rmd")) {
  message("Generando ", archivo)
  rmarkdown::render(file.path(raiz, archivo), envir = new.env(parent = globalenv()),
                    encoding = "UTF-8", quiet = TRUE, clean = TRUE)
}
message("Terminado. Abrir Informe_UPR.docx y Presentacion_UPR.html en: ", raiz)
