import * as Speech from "expo-speech";

// Speak Chinese text using the device's built-in text-to-speech.
// A touch slower than normal, which is easier to learn from.
export function speak(text) {
  try {
    Speech.stop();
    Speech.speak(text, { language: "zh-CN", rate: 0.85, pitch: 1.0 });
  } catch (e) {
    // TTS may be unavailable on some devices; fail quietly.
  }
}
