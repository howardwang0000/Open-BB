import { pinyin } from "pinyin-pro";
import { VOCAB_DATA } from "./data";

// Pinyin (with tone marks) for any text, via pinyin-pro.
export function autoPinyin(text) {
  try {
    return pinyin(text, { toneType: "symbol" });
  } catch (e) {
    return "";
  }
}

// Look up a recognized character/word.
// Returns { pinyin, meaning, examples }.
export function lookup(text) {
  const entry = VOCAB_DATA[text];
  if (entry) {
    return {
      pinyin: entry.pinyin,
      meaning: entry.meaning,
      examples: entry.examples || [],
    };
  }
  return {
    pinyin: autoPinyin(text),
    meaning: "",
    examples: [],
  };
}
