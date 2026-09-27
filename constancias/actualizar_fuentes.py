#!/usr/bin/env python3
"""Build the browser font catalog. Requires only Python 3, no packages."""
import argparse
import json
from pathlib import Path

MAX_BYTES = 25 * 1024 * 1024
MAX_FONTS = 500
MAX_DEPTH = 2


def main():
    parser = argparse.ArgumentParser(description="Actualiza fonts/manifest.json con las fuentes TTF y OTF de font/ y fonts/.")
    parser.add_argument("--raiz", type=Path, default=Path(__file__).resolve().parent,
                        help="Carpeta de la app; por defecto, la carpeta de este script.")
    args = parser.parse_args()
    base = args.raiz.resolve()
    fonts = []
    skipped = []
    for directory_name in ("font", "fonts"):
        directory = base / directory_name
        if not directory.is_dir() or directory.is_symlink():
            continue
        # Do not follow directory or file symlinks outside the exported application.
        queue = [(directory, 0)]
        while queue:
            current, depth = queue.pop(0)
            for path in sorted(current.iterdir(), key=lambda item: item.name.casefold()):
                if path.is_symlink():
                    continue
                if path.is_dir():
                    if depth < MAX_DEPTH:
                        queue.append((path, depth + 1))
                    continue
                if not path.is_file() or path.suffix.lower() not in (".ttf", ".otf"):
                    continue
                relative = path.relative_to(base).as_posix()
                if not 0 < path.stat().st_size <= MAX_BYTES:
                    skipped.append(relative)
                    continue
                label = path.stem.replace("_", " ").replace("-", " ")
                fonts.append({"file": relative, "label": label})
    fonts.sort(key=lambda entry: (entry["label"].casefold(), entry["file"]))
    if len(fonts) > MAX_FONTS:
        print(f"Aviso: se incluirán las primeras {MAX_FONTS} de {len(fonts)} fuentes.")
        fonts = fonts[:MAX_FONTS]
    catalog = base / "fonts" / "manifest.json"
    catalog.parent.mkdir(parents=True, exist_ok=True)
    catalog.write_text(json.dumps({"version": 1, "fonts": fonts}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Catálogo actualizado: {catalog}")
    print(f"Fuentes encontradas: {len(fonts)}. Sube este archivo junto con las fuentes.")
    for relative in skipped:
        print(f"Omitida (vacía o mayor de 25 MiB): {relative}")


if __name__ == "__main__":
    main()
