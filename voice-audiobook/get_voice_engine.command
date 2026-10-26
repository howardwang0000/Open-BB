#!/usr/bin/env bash
# Downloads the Chatterbox voice engine (about 1.5 GB) into a folder on this computer,
# for the browser version's "Use engine files from my computer" button.
#
#   bash get_voice_engine.command
#   curl -fsSL https://<where the app is hosted>/voice-audiobook/get_voice_engine.command | bash
#
# Safe to run again: finished files are skipped and an interrupted file carries on.
# If huggingface.co is blocked where you are, use another network (home Wi-Fi, a phone
# hotspot), or a mirror:  HF_ENDPOINT=https://hf-mirror.com bash get_voice_engine.command
set -euo pipefail

MODEL="onnx-community/chatterbox-ONNX"
ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"
DEST="${VOICE_ENGINE_DIR:-$HOME/Documents/Voice Audiobook engine}/chatterbox-ONNX"
# Only what the app loads: the small settings files, and the four parts of the model with
# the language model in its two compact forms. Other variants in the repository are skipped.
WANTED='^[^/]+\.(json|txt|model)$|^onnx/((embed_tokens|speech_encoder|conditional_decoder)|language_model_(q4|q4f16))\.onnx(_data(_[0-9]+)?)?$'

echo "Voice engine: $MODEL"
echo "Saving to:    $DEST"
echo
listing="$(curl -fsSL --retry 3 "$ENDPOINT/api/models/$MODEL")" || {
	echo "Could not reach $ENDPOINT. If your network blocks it, try home Wi-Fi or a phone hotspot."
	exit 1
}
files="$(printf '%s' "$listing" | grep -oE '"rfilename" *: *"[^"]+"' | sed -E 's/.*"([^"]+)"$/\1/' | grep -E "$WANTED" || true)"
if [ -z "$files" ]; then
	echo "The file list from $ENDPOINT was empty or not what was expected."
	exit 1
fi

mkdir -p "$DEST"
count="$(printf '%s\n' "$files" | wc -l | tr -d ' ')"
n=0
while IFS= read -r f; do
	n=$((n + 1))
	target="$DEST/$f"
	if [ -s "$target" ]; then
		echo "[$n/$count] $f: already here"
		continue
	fi
	mkdir -p "$(dirname "$target")"
	echo "[$n/$count] $f"
	# Download to .part and rename when complete, so a stopped download is never mistaken
	# for a finished file; -C - resumes a .part left from last time.
	curl -fL --retry 5 --retry-delay 3 -C - --progress-bar -o "$target.part" "$ENDPOINT/$MODEL/resolve/main/$f" < /dev/null
	mv "$target.part" "$target"
done <<< "$files"

for required in config.json onnx/embed_tokens.onnx onnx/speech_encoder.onnx onnx/conditional_decoder.onnx; do
	if [ ! -s "$DEST/$required" ]; then
		echo "Missing $required. Run this again to finish the download."
		exit 1
	fi
done

echo
echo "Done ($(du -sh "$DEST" | cut -f1)). In the app, press \"Use engine files from my computer\" and choose:"
echo "  $DEST"
if [ "$(uname)" = "Darwin" ]; then open "$DEST"; fi
