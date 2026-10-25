# Voice Audiobook — turn a PDF into audio in your own voice

There are two ways to use this folder. Both are free, need no account and no credits, and keep
your voice and documents on your own computer.

| | **Browser version** (`web/`) | **Mac app** (ebook2audiobook) |
|---|---|---|
| Install | Nothing: open a web page | One setup script, 20–40 minutes |
| Voice model | Chatterbox (Resemble AI), from a 5–10 s sample | XTTS‑v2, from a 1–3 min sample |
| Languages | English | English and many others |
| Output | One MP3 | M4B with chapters, MP3 and more |
| Best for | Trying it today, articles, notes, short books | Long books, other languages |

Both clean messy PDFs and smooth the joins between sentences in the same way (the browser
version is a JavaScript port of the same code, tested against it).

---

## Browser version

**Open it:** https://howardwang0000.github.io/Open-BB/voice-audiobook/web/

The page lives in this repository. If the link shows "404", GitHub Pages needs switching on once:
on GitHub open the repository → **Settings** → **Pages** → under *Build and deployment* set
**Source** to *Deploy from a branch*, pick the branch with the `voice-audiobook` folder
(`claude/jolly-turing-0cxnhj` until it is merged) and **/ (root)**, then **Save**. The page is
live about a minute later.

Then, in **Chrome or Safari 26+ on a Mac with Apple silicon**:

1. **Your voice:** press *Record* and read the passage on screen (about 10 seconds), or choose a recording.
2. **Your document:** drop in a PDF. Check the text in the box (you can edit it) and the list of what was removed.
3. **Voice engine:** press *Download the voice engine*. About 1.5 GB the first time; your browser keeps it.
4. **Make the audiobook:** press *Hear a sample* first, then *Make the audiobook*, then *Download MP3*.

Progress is saved as it goes: if the tab closes, open the page again and press the button to carry on.
How fast it is depends on your Mac's graphics chip; the page shows its speed and the time left.

For developers: `cd web && npm install && npm test` (unit tests, including a check that the
JavaScript audio smoothing matches `smooth_joins.py`), and `node tests/e2e.cjs` (the whole page in
Chromium with a stand-in voice model). Both need a Python with reportlab and numpy (`PYTHON=...`).

---

## Mac app

This sets up **[ebook2audiobook](https://github.com/DrewThomasson/ebook2audiobook)**
(free, open source, runs on your own Mac) with two fixes added on top:

| Problem in the original | What this version does |
|---|---|
| **Messy PDFs:** page numbers, running headers ("THE QUIET RIVER" on every page), footnotes, the little footnote numbers in sentences, words split across lines ("algo- rithm"), and two-column pages read straight across both columns | Removes page numbers, headers/footers, footnotes, footnote markers, sideways margin text and diagram labels. Joins split words back together ("algorithm") while keeping real hyphens ("well-known"). Reads columns in the right order. Keeps a paragraph whole across a page break, even when a figure caption interrupts it. |
| **Choppy joins:** the voice model speaks one sentence at a time, and the clips were glued together raw: random silences, clicks, volume jumps, the odd trailing mumble | Every clip is trimmed the same way, faded in/out (no clicks), levelled to the same loudness, and followed by a pause that matches the punctuation: short for a comma, longer for a full stop, longer again for a new paragraph. Pauses no longer stack up. |

---

## How close will it sound to you? (honest answer)

Both versions copy a voice from a short recording ("zero-shot cloning"). The notes below are
about XTTS‑v2 in the Mac app; Chatterbox in the browser works the same way: it copies the sound of
your voice from a sample, not your personal way of reading.

* **What it copies well:** the pitch and tone of your voice, roughly your accent. People who know you
  will usually recognise it as *your voice*.
* **What it doesn't copy:** your personal rhythm, emphasis and habits. It sounds like you reading
  calmly and evenly, a little smoother than you really are. A less common accent can drift
  toward a more generic one, often American-sounding.
* **What matters most is your recording** (see Step 1). A clean recording makes a bigger
  difference than anything else.
* **Want it closer?** You can *fine-tune* the model on 10–30 minutes of your speech with
  [Universal_TTS_Finetune](https://github.com/DrewThomasson/Universal_TTS_Finetune), then load the
  result in the app (Models → Upload a ZIP File). This needs a strong computer or a free Google Colab GPU.

The fastest way to judge it: **do Steps 1–4 with a 1–2 page PDF first.** It takes a few minutes, and
you'll hear exactly how close it gets before you spend hours on a whole book.

---

## What you need

* A Mac. Apple Silicon (M1/M2/M3/M4) is much faster than an older Intel Mac.
* About **15 GB of free disk space** (the voice model and its tools are large).
* An internet connection for the first setup (about 20–40 minutes, once only).
* A recording of your voice (Step 1).

---

## Step 1: Record your voice

1. Open **QuickTime Player** → *File* → *New Audio Recording*, or use the **Voice Memos** app.
2. Sit somewhere quiet with soft furnishings (a bedroom is better than a kitchen). Turn off fans and music.
   Keep the microphone a hand's width from your mouth.
3. Read a page of anything **for 1–3 minutes**, in the voice you want the audiobook to have:
   calm and clear, like reading aloud to someone.
4. Save it to your Desktop as, for example, `my-voice.m4a`. (`.wav`, `.mp3` and `.m4a` all work.)

Tips: no coughs, laughs or long pauses; don't whisper and don't shout. If the result sounds
muffled or robotic, re-record with a better microphone (even wired phone earbuds help).

---

## Step 2: Get these files from GitHub

**Easiest (no tools needed):**

1. Open this repository on github.com.
2. Use the branch menu (top-left, says `main`) to pick the branch that has the `voice-audiobook` folder
   (until it's merged: `claude/jolly-turing-0cxnhj`).
3. Click the green **Code** button → **Download ZIP**.
4. Double-click the ZIP in Downloads to unzip it. Inside is the `voice-audiobook` folder.

**Or with git**, in Terminal (`git clone` of a private repository asks you to sign in to GitHub):

```bash
git clone -b claude/jolly-turing-0cxnhj https://github.com/howardwang0000/Open-BB.git
```

---

## Step 3: Set it up and start it

1. Open **Terminal** (press ⌘‑Space, type *Terminal*, press Enter).
2. Type `cd ` (with a space after it), drag the `voice-audiobook` folder from Finder into the
   Terminal window, and press Enter.
3. Run:

   ```bash
   bash setup_mac.command
   ```

   * The first time, a window may ask to install Apple's *Command Line Tools*. Click **Install**,
     wait for it to finish, then run the command again.
   * It downloads ebook2audiobook, adds the two fixes, and installs everything else it needs
     (Homebrew, Python, ffmpeg, calibre...). It may ask for your Mac password. **The first run takes a while.**
4. When the Terminal shows that the app is running, open **http://localhost:7860** in your web browser.

**Next time:** open Terminal, `cd` into the folder again, and run `bash setup_mac.command` again.
It skips everything that's already done and starts in under a minute.
To stop the app, click the Terminal window and press **Control‑C**.

---

## Step 4: Make the audiobook

In the browser page (the *Dashboard* tab):

1. **Import → File:** drop in your PDF (EPUB, DOCX and TXT work too).
2. **Language:** English (or the language of your document).
3. **Voices → Upload Voice:** drop in `my-voice.m4a` from Step 1.
4. **TTS Engine:** keep **xtts** (the default). It is the one that copies your voice (XTTS‑v2), and the one the smooth-join fix is built for.
5. **Processor:** keep the default the app picks for your Mac.
6. **Output → Format:** `m4b` gives a proper audiobook with chapters (Apple Books, most audiobook apps);
   `mp3` plays anywhere.
7. Click **Convert**. Progress shows on the page. The finished file appears under *Audiobook*,
   and is also saved in `voice-audiobook/ebook2audiobook/audiobooks/`.

**How long does it take?** It depends on your Mac. Time a 2-page test first. A long book can take
many hours: start it in the evening and leave the Mac plugged in and awake. If a run stops,
convert the same file again and the app offers to resume from the last finished sentence.

---

## Check what will be read before converting

To see exactly what text the voice will read, without making any audio:

```bash
bash preview_pdf.command ~/Desktop/my-notes.pdf --show-removed
```

This writes `my-notes_clean.txt` next to the PDF and lists everything that was cut (page numbers,
headers, footnotes...). If something important was cut, or junk got through, you can:

* turn the clean `.txt` into the audiobook instead: edit it, then upload the `.txt` in Step 4, or
* keep footnotes or headers: `python3 pdf_cleaner.py my.pdf --keep-footnotes --keep-headers`
  (using `ebook2audiobook/python_env/bin/python3`).

---

## What's in this folder

| File | What it is |
|---|---|
| `setup_mac.command` | Downloads ebook2audiobook (pinned to v26.10.1), applies the fixes, starts the app |
| `patch_ebook2audiobook.py` | Adds the fixes to an ebook2audiobook folder. Safe to run twice; refuses to touch a version it wasn't written for |
| `pdf_cleaner.py` | The PDF cleaner. Used inside the app, or on its own via `preview_pdf.command` |
| `smooth_joins.py` | The audio smoothing used for every sentence the voice speaks |
| `preview_pdf.command` | Shows the cleaned text of a PDF |
| `tests/` | Automated tests. They build messy test PDFs (book with headers, footnotes and hyphenation; two-column paper with a figure) and check the output word-for-word, then check the audio joins |

### Limits worth knowing

* **Scanned PDFs** (photos of pages) are read with OCR as in the original app. Their headers and page
  numbers are not removed, because there is no layout information to work from.
* Tables and maths are read as plain text, which rarely sounds good. Consider deleting them from the
  clean `.txt` first.
* The smooth-join fix applies to the **xtts** engine (the voice-cloning one). Other engines work as before.

### For developers

```bash
pip3 install pymupdf numpy reportlab   # (+ torch for the adapter test)
python3 -m unittest discover -s tests -v
```

The patch is applied by exact text match against ebook2audiobook commit `0a98ac3` (v26.10.1).
To move to a newer upstream version, update `E2A_COMMIT` in `setup_mac.command` and the
`EDITS` in `patch_ebook2audiobook.py` together.

Only clone voices you have the right to use: your own, or with the speaker's permission.
