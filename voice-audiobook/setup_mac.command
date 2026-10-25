#!/usr/bin/env bash
# Sets up ebook2audiobook with the PDF-cleaning and smooth-join fixes, then starts it.
#
#   bash setup_mac.command            (from Terminal, in this folder)
#
# Run it again any time to start the app; finished steps are skipped.
# Extra arguments are passed to ebook2audiobook, e.g.
#   bash setup_mac.command --headless --ebook ~/Desktop/notes.pdf --voice ~/Desktop/me.wav --language eng
set -euo pipefail

E2A_REPO="https://github.com/DrewThomasson/ebook2audiobook.git"
E2A_COMMIT="0a98ac313ec43a470ee1e5feb13dd881ffb3e969"   # v26.10.1, the version the fixes were written for
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/ebook2audiobook"

if [[ "$(uname)" == "Darwin" ]] && ! xcode-select -p >/dev/null 2>&1; then
	echo "Installing Apple's Command Line Tools (this gives you git and python3)."
	echo "A window will pop up: click Install, wait until it finishes, then run this script again."
	xcode-select --install || true
	exit 0
fi

if [[ ! -d "$APP/.git" ]]; then
	echo "Downloading ebook2audiobook..."
	git clone --depth 1 "$E2A_REPO" "$APP"
fi
if [[ "$(git -C "$APP" rev-parse HEAD)" != "$E2A_COMMIT" ]]; then
	git -C "$APP" fetch --depth 1 origin "$E2A_COMMIT"
	git -C "$APP" checkout --quiet "$E2A_COMMIT"
fi

python3 "$HERE/patch_ebook2audiobook.py" "$APP"

echo
echo "Starting ebook2audiobook. The first start installs everything it needs and can take"
echo "20-40 minutes. When it prints a local URL, open http://localhost:7860 in your browser."
echo
cd "$APP"
exec ./ebook2audiobook.command "$@"
