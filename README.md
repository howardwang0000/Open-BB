# 汉字 · Chinese Vocabulary Builder

A simple, no-install web app to grow your Chinese vocabulary. Write a character,
hear how it's pronounced, and learn the words it's used alongside.

## What it does

1. **Write a character** (or word) in the input at the top and click **Add**
   (or press **Enter**).
2. It's **added to your list** and the **counter** goes up by one.
3. You instantly get the **pinyin pronunciation** and can tap **🔊** to hear the
   **audio**, spoken with your browser's built-in Chinese voice.
4. You see the common **words it's used alongside** — the vocabulary the
   character lives inside — each with its own pinyin, meaning, and audio button.

Your list is saved in your browser (localStorage), so it's still there when you
come back.

## How to run it

No build step, no server needed:

- **Just open `index.html`** in a web browser (double-click it, or drag it into a
  browser window).

For the best experience use Chrome, Edge, or Safari, which have good built-in
Chinese text-to-speech voices.

> Tip: if you don't hear audio, your system may not have a Chinese voice
> installed. On Windows/macOS you can add one in the system speech settings.

## Under the hood

| File | Purpose |
|------|---------|
| `index.html` | Page structure |
| `styles.css` | Styling |
| `app.js` | App logic: adding words, the counter, audio, storage |
| `data.js` | Curated dictionary of common characters (pinyin, meaning, example words) |

- **Audio** uses the browser's built-in `SpeechSynthesis` (Web Speech API) with a
  Chinese (`zh-CN`) voice — nothing to install.
- **Pinyin** comes from the curated dictionary for common characters, and falls
  back to [pinyin-pro](https://github.com/zh-lx/pinyin-pro) (loaded from a CDN)
  for any other character you type.
- **Example words** ("used alongside it") come from the curated dictionary. Try
  common characters like 中, 学, 好, 水, 电 for the richest examples.

## Extending the dictionary

Want more example words for a character? Add an entry to `data.js`:

```js
"学": { pinyin: "xué", meaning: "to study; to learn", examples: [
  { word: "学生", pinyin: "xué shēng", meaning: "student" },
  { word: "学校", pinyin: "xué xiào", meaning: "school" }
] },
```
