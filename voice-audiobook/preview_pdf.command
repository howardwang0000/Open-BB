#!/usr/bin/env bash
# Shows exactly what will be read aloud from a PDF, without making any audio.
#
#   bash preview_pdf.command ~/Desktop/notes.pdf                 -> notes_clean.txt next to the PDF
#   bash preview_pdf.command ~/Desktop/notes.pdf --show-removed  -> also lists what was cut
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$HERE/ebook2audiobook/python_env/bin/python3"   # created by the first run of setup_mac.command
if [[ ! -x "$PY" ]]; then
	PY="python3"
	"$PY" -c "import pymupdf" 2>/dev/null || { echo "Run setup_mac.command once first (or: pip3 install pymupdf)."; exit 1; }
fi
exec "$PY" "$HERE/pdf_cleaner.py" "$@"
