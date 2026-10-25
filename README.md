# 汉字 · Chinese Vocab Builder

A mobile app (iPhone + Android) that grows your Chinese vocabulary by
**handwriting** characters. Draw a character stroke by stroke, the app
recognizes it, adds it to your counter, speaks the **pronunciation** aloud, and
shows you the common words it's **used alongside**.

Built with **React Native (Expo)**.

## What it does

1. **Write a character by hand** in the writing box (draw the strokes with your
   finger). Undo the last stroke or clear the pad any time.
2. Tap **Recognize** — your strokes are sent to Google's handwriting service and
   you get back the most likely characters.
3. **Tap the character you wrote.** It's added to your list and the **counter**
   goes up by one.
4. You instantly hear the **audio pronunciation** (your phone's built-in Chinese
   voice) and see the **pinyin**.
5. Each entry shows the **words it's used alongside** — the vocabulary the
   character lives inside — each with its own pinyin, meaning, and 🔊 button.

Your list is saved on the device, so it's still there next time you open the app.

## Running it on your phone (easiest — Expo Go)

You'll run it as a real native app on your phone via **Expo Go**. No App Store
submission needed.

1. **Install Node.js** (LTS) on your computer if you don't have it:
   <https://nodejs.org>
2. **Install the "Expo Go" app** on your phone (from the App Store / Google Play).
3. In a terminal, from this project folder:
   ```bash
   npm install
   npx expo start
   ```
4. A **QR code** appears in the terminal.
   - **iPhone:** open the **Camera** app and point it at the QR code.
   - **Android:** open **Expo Go** and use "Scan QR code".
5. The app opens on your phone. Your computer and phone must be on the **same
   Wi‑Fi network**. (If it won't connect, run `npx expo start --tunnel`.)

> The **Recognize** step needs an internet connection (it calls Google's
> handwriting service). Audio and everything else work offline.

## Building a standalone install (optional)

To get a real installable file (an Android **.apk** / **.aab**, or an iOS build)
you can use Expo's cloud build service (EAS) — no Mac required for Android:

```bash
npm install -g eas-cli
eas build -p android --profile preview   # produces an installable Android app
```

See <https://docs.expo.dev/build/introduction/> for details. iOS builds require
an Apple Developer account.

## Project structure

| Path | Purpose |
|------|---------|
| `App.js` | Main screen: writing pad, counter, candidates, saved list |
| `src/components/HandwritingCanvas.js` | The stroke-drawing pad (SVG + touch) |
| `src/components/VocabCard.js` | A learned-character card with audio + examples |
| `src/recognize.js` | Sends strokes to Google handwriting recognition |
| `src/speech.js` | Text-to-speech (Chinese voice) |
| `src/lookup.js` | Pinyin + meaning + example words for a character |
| `src/data.js` | Curated dictionary of common characters and their words |
| `src/storage.js` | Saves your list on the device |

## How it works under the hood

- **Handwriting recognition:** drawn strokes (ink coordinates) are sent to
  Google Input Tools, the same service used by handwriting keyboards, which
  returns ranked candidate characters.
- **Audio:** [`expo-speech`](https://docs.expo.dev/versions/latest/sdk/speech/)
  uses the device's built-in `zh-CN` text-to-speech voice.
- **Pinyin:** from the curated dictionary for common characters, falling back to
  [pinyin-pro](https://github.com/zh-lx/pinyin-pro) for any other character.
- **Example words** ("used alongside it") come from the curated dictionary in
  `src/data.js` — easy to extend with more entries.

## Extending the dictionary

Add an entry to `src/data.js`:

```js
"学": { pinyin: "xué", meaning: "to study; to learn", examples: [
  { word: "学生", pinyin: "xué shēng", meaning: "student" },
  { word: "学校", pinyin: "xué xiào", meaning: "school" }
] },
```

---

## Also in this repo: PDF → audiobook in your own voice

The [`voice-audiobook/`](voice-audiobook/) folder is a separate tool (not part of the app):
a free page that runs in your browser ([`voice-audiobook/web/`](voice-audiobook/web/)), and a
setup for the open-source ebook2audiobook on a Mac, both with fixes for messy PDFs and smoother
audio. See [`voice-audiobook/README.md`](voice-audiobook/README.md).
