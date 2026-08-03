import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  Platform,
  SafeAreaView,
} from "react-native";
import { StatusBar } from "expo-status-bar";

import HandwritingCanvas from "./src/components/HandwritingCanvas";
import VocabCard from "./src/components/VocabCard";
import { recognize } from "./src/recognize";
import { lookup } from "./src/lookup";
import { speak } from "./src/speech";
import { loadItems, saveItems } from "./src/storage";

export default function App() {
  const [items, setItems] = useState([]);
  const [strokes, setStrokes] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const { width } = useWindowDimensions();
  const padSize = Math.min(width - 40, 320);

  // Load saved list on first render.
  useEffect(() => {
    loadItems().then((saved) => {
      setItems(saved);
      setLoaded(true);
    });
  }, []);

  // Persist whenever the list changes (after initial load).
  useEffect(() => {
    if (loaded) saveItems(items);
  }, [items, loaded]);

  async function onRecognize() {
    if (strokes.length === 0) {
      Alert.alert("Nothing written", "Draw a character in the box first.");
      return;
    }
    setBusy(true);
    setCandidates([]);
    try {
      const result = await recognize(strokes, padSize, padSize);
      if (result.length === 0) {
        Alert.alert(
          "No match",
          "Couldn't recognize that. Try writing it a bit more clearly."
        );
      } else {
        setCandidates(result.slice(0, 8));
      }
    } catch (e) {
      Alert.alert(
        "Recognition unavailable",
        "Couldn't reach the handwriting service. Check your internet connection and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  function addCharacter(text) {
    const exists = items.some((it) => it.text === text);
    if (exists) {
      Alert.alert("Already learned", `"${text}" is already in your list.`);
      resetPad();
      speak(text);
      return;
    }
    const info = lookup(text);
    const item = {
      text,
      pinyin: info.pinyin,
      meaning: info.meaning,
      examples: info.examples,
      addedAt: Date.now(),
    };
    setItems((prev) => [item, ...prev]);
    resetPad();
    speak(text);
  }

  function resetPad() {
    setStrokes([]);
    setCandidates([]);
  }

  function undoStroke() {
    setStrokes((prev) => prev.slice(0, -1));
    setCandidates([]);
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function confirmClearAll() {
    if (items.length === 0) return;
    Alert.alert("Reset list?", "This removes every character. It can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => setItems([]) },
    ]);
  }

  const header = useMemo(
    () => (
      <View>
        <View style={styles.hero}>
          <Text style={styles.title}>
            汉字 <Text style={styles.titleSub}>Vocabulary Builder</Text>
          </Text>
          <Text style={styles.tagline}>
            Write a character by hand, hear it, and learn the words it lives in.
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.counterWrap}>
            <Text style={styles.counterNum}>{items.length}</Text>
            <Text style={styles.counterLabel}>characters{"\n"}learned</Text>
          </View>
          <Pressable onPress={confirmClearAll} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Reset list</Text>
          </Pressable>
        </View>

        <Text style={styles.padLabel}>Write a character here</Text>
        <HandwritingCanvas strokes={strokes} onChange={setStrokes} size={padSize} />

        <View style={styles.controls}>
          <Pressable
            onPress={undoStroke}
            disabled={strokes.length === 0}
            style={[styles.ctrl, strokes.length === 0 && styles.ctrlDisabled]}
          >
            <Text style={styles.ctrlText}>↶ Undo</Text>
          </Pressable>
          <Pressable
            onPress={resetPad}
            disabled={strokes.length === 0}
            style={[styles.ctrl, strokes.length === 0 && styles.ctrlDisabled]}
          >
            <Text style={styles.ctrlText}>Clear</Text>
          </Pressable>
          <Pressable
            onPress={onRecognize}
            disabled={busy || strokes.length === 0}
            style={[
              styles.ctrl,
              styles.recognize,
              (busy || strokes.length === 0) && styles.ctrlDisabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={[styles.ctrlText, styles.recognizeText]}>Recognize ✓</Text>
            )}
          </Pressable>
        </View>

        {candidates.length > 0 && (
          <View style={styles.candidates}>
            <Text style={styles.candidatesLabel}>Tap the one you wrote:</Text>
            <View style={styles.chips}>
              {candidates.map((c, i) => (
                <Pressable
                  key={i}
                  onPress={() => addCharacter(c)}
                  style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                >
                  <Text style={styles.chipText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {items.length > 0 && <Text style={styles.listHeading}>Your vocabulary</Text>}
      </View>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.length, strokes, candidates, busy, padSize]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <FlatList
        data={items}
        keyExtractor={(it, i) => it.text + "_" + i}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => (
          <VocabCard item={item} onRemove={() => removeItem(index)} />
        )}
        ListEmptyComponent={
          loaded ? (
            <Text style={styles.empty}>
              Your list is empty. Write your first character above to begin. 📖
            </Text>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0f1220",
    paddingTop: Platform.OS === "android" ? 28 : 0,
  },
  listContent: { padding: 20, paddingBottom: 60 },

  hero: { alignItems: "center", marginBottom: 18 },
  title: { fontSize: 32, color: "#f4f5fb", fontWeight: "800" },
  titleSub: { fontSize: 16, color: "#9aa0c3", fontWeight: "600" },
  tagline: {
    color: "#9aa0c3",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 10,
  },

  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  counterWrap: { flexDirection: "row", alignItems: "center" },
  counterNum: { fontSize: 46, fontWeight: "800", color: "#ffb703", marginRight: 10 },
  counterLabel: { fontSize: 12, color: "#9aa0c3", letterSpacing: 1 },
  clearBtn: {
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  clearBtnText: { color: "#9aa0c3", fontSize: 13 },

  padLabel: {
    color: "#9aa0c3",
    fontSize: 12,
    letterSpacing: 1.5,
    textAlign: "center",
    marginBottom: 10,
  },

  controls: { flexDirection: "row", justifyContent: "center", marginTop: 14, gap: 10 },
  ctrl: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlText: { color: "#f4f5fb", fontSize: 15, fontWeight: "600" },
  ctrlDisabled: { opacity: 0.4 },
  recognize: { backgroundColor: "#e8503a", borderColor: "#e8503a" },
  recognizeText: { color: "#fff" },

  candidates: { marginTop: 18 },
  candidatesLabel: { color: "#9aa0c3", fontSize: 13, marginBottom: 10, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 },
  chip: {
    backgroundColor: "#232a52",
    borderRadius: 12,
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  chipPressed: { backgroundColor: "#e8503a" },
  chipText: { fontSize: 30, color: "#f4f5fb" },

  listHeading: {
    color: "#9aa0c3",
    fontSize: 12,
    letterSpacing: 1.5,
    marginTop: 26,
    marginBottom: 12,
  },
  empty: {
    color: "#9aa0c3",
    textAlign: "center",
    marginTop: 30,
    fontSize: 15,
    lineHeight: 22,
  },
});
