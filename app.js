/*
 * Chinese Vocabulary Builder — app logic
 *
 * Flow:
 *   1. User writes a Chinese character/word and adds it.
 *   2. It is looked up (curated dictionary first, then pinyin-pro fallback).
 *   3. A card is created showing pinyin + audio + example words used alongside it.
 *   4. The counter increments and everything is saved to localStorage.
 */

(function () {
  "use strict";

  var STORAGE_KEY = "chinese-vocab-list-v1";

  var input = document.getElementById("charInput");
  var addBtn = document.getElementById("addBtn");
  var clearBtn = document.getElementById("clearBtn");
  var counterEl = document.getElementById("counter");
  var listEl = document.getElementById("vocabList");
  var emptyEl = document.getElementById("empty");
  var hintEl = document.getElementById("hint");

  // In-memory list of learned entries.
  var items = loadItems();

  /* ---------------- Pinyin + lookup ---------------- */

  // Does the browser have pinyin-pro loaded?
  function hasPinyinPro() {
    return typeof window.pinyinPro !== "undefined" &&
      typeof window.pinyinPro.pinyin === "function";
  }

  // Get pinyin (with tone marks) for a word using pinyin-pro if available.
  function autoPinyin(text) {
    if (hasPinyinPro()) {
      try {
        return window.pinyinPro.pinyin(text, { toneType: "symbol" });
      } catch (e) {
        return "";
      }
    }
    return "";
  }

  // Look up a character/word. Returns { pinyin, meaning, examples }.
  function lookup(text) {
    var entry = window.VOCAB_DATA && window.VOCAB_DATA[text];
    if (entry) {
      return {
        pinyin: entry.pinyin,
        meaning: entry.meaning,
        examples: entry.examples || []
      };
    }
    // Not in curated dictionary — fall back to auto pinyin.
    return {
      pinyin: autoPinyin(text),
      meaning: "",
      examples: []
    };
  }

  /* ---------------- Audio ---------------- */

  var zhVoice = null;

  function pickChineseVoice() {
    if (!("speechSynthesis" in window)) return;
    var voices = window.speechSynthesis.getVoices();
    // Prefer a mainland-Chinese (zh-CN) voice, then any zh voice.
    zhVoice =
      voices.find(function (v) { return /zh[-_]CN/i.test(v.lang); }) ||
      voices.find(function (v) { return /^zh/i.test(v.lang); }) ||
      null;
  }

  if ("speechSynthesis" in window) {
    pickChineseVoice();
    window.speechSynthesis.onvoiceschanged = pickChineseVoice;
  }

  // Speak the given Chinese text. `btn` is the button to animate while playing.
  function speak(text, btn) {
    if (!("speechSynthesis" in window)) {
      flashHint("Your browser can't play audio (no speech support).", true);
      return;
    }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.85; // a touch slower, good for learning
    if (zhVoice) u.voice = zhVoice;
    if (btn) {
      btn.classList.add("playing");
      u.onend = u.onerror = function () { btn.classList.remove("playing"); };
    }
    window.speechSynthesis.speak(u);
  }

  /* ---------------- Rendering ---------------- */

  function render() {
    listEl.innerHTML = "";
    counterEl.textContent = String(items.length);
    emptyEl.style.display = items.length ? "none" : "block";

    items.forEach(function (item, index) {
      listEl.appendChild(buildCard(item, index));
    });
  }

  function buildCard(item, index) {
    var li = document.createElement("li");
    li.className = "vocab-card";

    // --- head: character, pinyin, meaning, speaker, remove ---
    var head = document.createElement("div");
    head.className = "card-head";

    var charEl = document.createElement("div");
    charEl.className = "card-char";
    charEl.textContent = item.text;

    var meta = document.createElement("div");
    meta.className = "card-meta";

    var pinyinEl = document.createElement("div");
    pinyinEl.className = "card-pinyin";
    pinyinEl.textContent = item.pinyin || "(pronunciation unavailable)";

    var meaningEl = document.createElement("div");
    meaningEl.className = "card-meaning";
    if (item.meaning) {
      meaningEl.textContent = item.meaning;
    } else {
      meaningEl.innerHTML = '<span class="muted">Meaning not in the built-in dictionary — you can still hear it.</span>';
    }

    meta.appendChild(pinyinEl);
    meta.appendChild(meaningEl);

    var speakBtn = makeSpeakButton(item.text);

    var removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.type = "button";
    removeBtn.title = "Remove";
    removeBtn.setAttribute("aria-label", "Remove " + item.text);
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", function () { removeItem(index); });

    head.appendChild(charEl);
    head.appendChild(meta);
    head.appendChild(speakBtn);
    head.appendChild(removeBtn);
    li.appendChild(head);

    // --- examples: words used alongside the character ---
    var ex = document.createElement("div");
    ex.className = "examples";

    var exTitle = document.createElement("div");
    exTitle.className = "examples-title";
    exTitle.textContent = "Used alongside it";
    ex.appendChild(exTitle);

    if (item.examples && item.examples.length) {
      var grid = document.createElement("div");
      grid.className = "example-grid";
      item.examples.forEach(function (e) {
        grid.appendChild(buildExample(e));
      });
      ex.appendChild(grid);
    } else {
      var none = document.createElement("div");
      none.className = "examples-none";
      none.textContent =
        "No example words for this one yet — try adding a common character like 中, 学, or 好.";
      ex.appendChild(none);
    }

    li.appendChild(ex);
    return li;
  }

  function buildExample(e) {
    var row = document.createElement("div");
    row.className = "example";

    var word = document.createElement("div");
    word.className = "ex-word";
    word.textContent = e.word;

    var info = document.createElement("div");
    info.className = "ex-info";

    var py = document.createElement("div");
    py.className = "ex-pinyin";
    py.textContent = e.pinyin || autoPinyin(e.word);

    var mean = document.createElement("div");
    mean.className = "ex-meaning";
    mean.textContent = e.meaning || "";

    info.appendChild(py);
    if (e.meaning) info.appendChild(mean);

    var speakBtn = makeSpeakButton(e.word);

    row.appendChild(word);
    row.appendChild(info);
    row.appendChild(speakBtn);
    return row;
  }

  function makeSpeakButton(text) {
    var btn = document.createElement("button");
    btn.className = "speak-btn";
    btn.type = "button";
    btn.title = "Play pronunciation";
    btn.setAttribute("aria-label", "Play pronunciation of " + text);
    btn.textContent = "🔊";
    btn.addEventListener("click", function () { speak(text, btn); });
    return btn;
  }

  /* ---------------- Actions ---------------- */

  function containsChinese(text) {
    return /[一-鿿]/.test(text);
  }

  function addCurrent() {
    var raw = (input.value || "").trim();
    if (!raw) {
      flashHint("Write a character first.", true);
      input.focus();
      return;
    }
    if (!containsChinese(raw)) {
      flashHint("That doesn't look like a Chinese character. Try 你, 好, 学…", true);
      return;
    }

    // Prevent duplicates.
    var exists = items.some(function (it) { return it.text === raw; });
    if (exists) {
      flashHint('"' + raw + '" is already in your list.', true);
      input.value = "";
      return;
    }

    var info = lookup(raw);
    var item = {
      text: raw,
      pinyin: info.pinyin,
      meaning: info.meaning,
      examples: info.examples,
      addedAt: Date.now()
    };
    items.push(item);
    saveItems();
    render();

    input.value = "";
    input.focus();
    flashHint("Added! Tap 🔊 to hear it.", false);

    // Auto-play the new character once so the user hears it immediately.
    var newCard = listEl.lastElementChild;
    if (newCard) {
      var b = newCard.querySelector(".speak-btn");
      speak(raw, b);
      newCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function removeItem(index) {
    items.splice(index, 1);
    saveItems();
    render();
  }

  function clearAll() {
    if (!items.length) return;
    if (!window.confirm("Clear your whole vocabulary list? This can't be undone.")) {
      return;
    }
    items = [];
    saveItems();
    render();
  }

  /* ---------------- Storage ---------------- */

  function loadItems() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveItems() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      /* storage may be unavailable (private mode) — ignore */
    }
  }

  /* ---------------- Hint helper ---------------- */

  var hintTimer = null;
  var defaultHint = hintEl.innerHTML;

  function flashHint(msg, isWarn) {
    hintEl.textContent = msg;
    hintEl.classList.toggle("warn", !!isWarn);
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hintEl.innerHTML = defaultHint;
      hintEl.classList.remove("warn");
    }, 3200);
  }

  /* ---------------- Wire up ---------------- */

  addBtn.addEventListener("click", addCurrent);
  clearBtn.addEventListener("click", clearAll);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addCurrent();
    }
  });

  render();
  input.focus();
})();
