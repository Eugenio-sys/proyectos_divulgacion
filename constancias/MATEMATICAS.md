# Matemáticas en las constancias

Escribe las fórmulas directamente en las celdas de `tallerpuno` o `tallerpdos` del Excel. Usa `$...$` para una fórmula dentro de una frase y `$$...$$` para una fórmula en una línea aparte. También se aceptan `\(...\)` y `\[...\]`. En Excel escribe una sola barra inversa: `\alpha`, no `\\alpha`.

```tex
Probabilidad: $\mathds{1}_A$, $\mathscr{F}$ y $\bm{\alpha}$.
Análisis: $\oiint_S \mathbf{F}\cdot\mathbf{n}\,dS$.
Participación completada $\ding{51}$.
```

No hace falta escribir `\usepackage`: las extensiones que se describen aquí ya están activadas. Las fórmulas se exportan mediante contornos vectoriales; conservan su nitidez al ampliar el PDF, pero sus símbolos no son texto seleccionable. Los textos normales de las constancias se guardan como texto PDF seleccionable con sus fuentes incorporadas.

## Los paquetes que pediste

| Paquete de LaTeX | Implementación en esta aplicación | Ejemplo |
|---|---|---|
| `mathtools` | Extensión oficial de MathJax: alineaciones, operadores y herramientas matemáticas compatibles con MathJax. | `a\coloneqq b`, `\mathclap{\sum_i x_i}` |
| `amssymb`, `amsmath` | Soporte AMS de MathJax y los símbolos de New Computer Modern. | `\mathbb{R}\subsetneq\mathbb{C}`, `\varnothing`, `\nexists` |
| `mathrsfs` | `\mathscr` con los contornos auténticos de las 26 mayúsculas RSFS de la fuente TeX de MathJax. | `\mathscr{F}`, `\mathscr{ABCDEFGHIJKLMNOPQRSTUVWXYZ}` |
| `esint` | Contornos de la fuente original `esint10` en dos tallas: texto y fórmula destacada. Se incluyen los 17 operadores listados abajo y el alias `\idotsint`. | `\oiint`, `\fint`, `\varointclockwise` |
| `bm` | `\bm{...}` es un alias explícito de `\boldsymbol{...}`, con la extensión oficial de MathJax. No carga el paquete LaTeX `bm` completo. | `\bm{\alpha+\beta}` |
| `textcomp` | Extensión oficial de MathJax, también habilitada dentro de `\text{...}`. | `\textcopyright`, `\texteuro`, `25\textcelsius` |
| `pifont` | `\ding{n}`: los 202 códigos definidos de ZapfDingbats, con contornos vectoriales de la fuente compatible PDFium FoxitDingbats. | `\ding{51}`, `\ding{55}`, `\ding{172}` |
| `dsfont` | Extensión oficial y fuente auténtica dsfont; la cifra indicadora `1` no se sustituye por una letra normal en negrita. | `\mathds{1}_A`, `\mathds{R}` |
| `bbm` | Extensión oficial y fuente auténtica bbm, como alternativa adicional para símbolos de doble trazo. | `\mathbbm{1}_A` |

`\mathscr` admite únicamente mayúsculas A–Z y espacios dentro de sus llaves. Las minúsculas u otros símbolos producen un error, sin sustituirlos por letras normales. Coloca los subíndices fuera: `\mathscr{F}_\sigma`. `\mathcal`, `\mathfrak`, `\mathbb`, `\mathbf`, `\mathit`, `\mathrm`, `\mathsf` y `\mathtt` continúan disponibles. La forma tipográfica de los símbolos de las fórmulas se controla con estas órdenes matemáticas; elegir una fuente para el nombre no reemplaza automáticamente la fuente matemática.

## Integrales esint disponibles

```tex
\int           \iint                \iiint              \iiiint
\dotsint       \idotsint            \oint               \oiint
\sqint         \sqiint              \ointclockwise      \ointctrclockwise
\varointclockwise  \varointctrclockwise  \fint             \varoiint
\landupint     \landdownint
```

`\idotsint` es un alias de `\dotsint`. Los operadores aceptan subíndices, superíndices y `\limits`, por ejemplo:

```tex
$$\oiint\limits_{S} \mathbf{F}\cdot\mathbf{n}\,dS$$
```

La distinción entre `\ointclockwise` y `\varointclockwise`, y entre las dos variantes antihorarias, se conserva en los contornos originales. Esta implementación no interpreta opciones de preámbulo como `\usepackage[intlimits]{esint}`; indica `\limits` en la fórmula cuando lo necesites.

## Símbolos pifont

`\ding{n}` conserva los números originales. Los códigos admitidos son **32–126, 128–141, 161–239 y 241–254**. El código 32 es el espacio. Un código sin símbolo, como 127, produce un error que identifica el problema.

| Orden | Símbolo |
|---|---|
| `\ding{51}` | Marca de verificación |
| `\ding{52}` | Marca de verificación gruesa |
| `\ding{55}` | Cruz |
| `\ding{43}` | Mano apuntando a la derecha |
| `\ding{172}` | Número 1 dentro de un círculo |

No se incluyen los entornos de listas ni las órdenes de composición de líneas de `pifont`, como `dinglist`, `\dingline` o `\dingfill`.

## Más extensiones activadas

Además del núcleo matemático y de las extensiones anteriores, se cargan `amscd`, `bbox`, `braket`, `cancel`, `cases`, `centernot`, `color`, `colortbl`, `empheq`, `enclose`, `extpfeil`, `gensymb`, `newcommand`, `textmacros`, `upgreek` y `verb`. `configmacros` registra las equivalencias propias de la aplicación.

Ejemplos:

```tex
$$\begin{pmatrix}1&2\\3&4\end{pmatrix}$$
$$\begin{cases}x^2 & x\ge 0\\-x & x<0\end{cases}$$
$\cancel{x}+\color{red}{y}$
$\braket{\psi|\phi}$
$\upalpha+\upbeta$
```

Los símbolos y las extensiones se sirven desde los archivos incluidos en el sitio. No requieren acceso a un CDN ni enviar los datos del Excel a un servidor.

## Alcance y errores

Esta aplicación utiliza MathJax 4.1.3, que interpreta notación matemática de TeX en el navegador. No ejecuta una distribución completa de LaTeX: no admite documentos con `\documentclass`, preámbulos arbitrarios, paquetes `.sty` externos, TikZ ni todas las opciones de todos los paquetes de LaTeX. La tabla anterior describe lo realmente incorporado.

Las órdenes no reconocidas producen un error; no se imprimen como texto rojo simulando una fórmula válida. Si se solicita un glifo que no existe en la fuente matemática, el motor intenta obtener un contorno de la fuente de texto seleccionada. Si tampoco existe allí, la exportación se detiene indicando el carácter faltante. Las fórmulas se mantienen completas como una unidad al ajustar el ancho del texto; usa `aligned`, `gathered` o `cases` para indicar una estructura con varias líneas.

Antes de generar todas las constancias, revisa el PDF de prueba. La vista «Comprobación» mantiene el texto más largo por columna más `Áj`; el ZIP utiliza las celdas originales, sin ese sufijo.

## Referencias técnicas

- [Extensiones oficiales de MathJax](https://docs.mathjax.org/en/v4.1/input/tex/extensions/index.html).
- [Fuentes y extensiones de fuentes](https://docs.mathjax.org/en/v4.1/output/fonts.html).
- [dsfont](https://docs.mathjax.org/en/v4.1/input/tex/extensions/dsfont.html), [mathtools](https://docs.mathjax.org/en/v4.1/input/tex/extensions/mathtools.html) y [textcomp](https://docs.mathjax.org/en/v4.1/input/tex/extensions/textcomp.html).
- [RSFS](https://ctan.org/pkg/rsfs) y [esint Type1](https://ctan.org/pkg/esint-type1).
- [pifont y su codificación](https://ctan.org/pkg/pifont).

Las licencias y procedencias de los recursos están en `TERCEROS.md` y `vendor/licenses`.
