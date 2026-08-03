import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { speak } from "../speech";
import { autoPinyin } from "../lookup";

function SpeakButton({ text, big }) {
  return (
    <Pressable
      onPress={() => speak(text)}
      style={({ pressed }) => [
        styles.speak,
        big ? styles.speakBig : styles.speakSmall,
        pressed && styles.pressed,
      ]}
      accessibilityLabel={"Play pronunciation of " + text}
    >
      <Text style={big ? styles.speakIconBig : styles.speakIconSmall}>🔊</Text>
    </Pressable>
  );
}

export default function VocabCard({ item, onRemove }) {
  const examples = item.examples || [];
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.char}>{item.text}</Text>
        <View style={styles.meta}>
          <Text style={styles.pinyin}>
            {item.pinyin || "(pronunciation unavailable)"}
          </Text>
          {item.meaning ? (
            <Text style={styles.meaning}>{item.meaning}</Text>
          ) : (
            <Text style={styles.meaningMuted}>
              Not in the built-in dictionary — you can still hear it.
            </Text>
          )}
        </View>
        <SpeakButton text={item.text} big />
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          style={styles.remove}
          accessibilityLabel={"Remove " + item.text}
        >
          <Text style={styles.removeIcon}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.examples}>
        <Text style={styles.examplesTitle}>USED ALONGSIDE IT</Text>
        {examples.length ? (
          examples.map((e, i) => (
            <View key={i} style={styles.exRow}>
              <Text style={styles.exWord}>{e.word}</Text>
              <View style={styles.exInfo}>
                <Text style={styles.exPinyin}>
                  {e.pinyin || autoPinyin(e.word)}
                </Text>
                {e.meaning ? (
                  <Text style={styles.exMeaning}>{e.meaning}</Text>
                ) : null}
              </View>
              <SpeakButton text={e.word} />
            </View>
          ))
        ) : (
          <Text style={styles.exNone}>
            No example words for this one yet — common characters like 中, 学, 好
            have more.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1d2140",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
  },
  head: { flexDirection: "row", alignItems: "center" },
  char: { fontSize: 52, color: "#f4f5fb", marginRight: 14 },
  meta: { flex: 1, minWidth: 0 },
  pinyin: { fontSize: 22, color: "#ffb703", fontWeight: "600" },
  meaning: { fontSize: 14, color: "#f4f5fb", marginTop: 2 },
  meaningMuted: {
    fontSize: 13,
    color: "#9aa0c3",
    fontStyle: "italic",
    marginTop: 2,
  },
  remove: { paddingHorizontal: 4, alignSelf: "flex-start" },
  removeIcon: { color: "#9aa0c3", fontSize: 18 },

  speak: {
    backgroundColor: "rgba(232,80,58,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  speakBig: { width: 48, height: 48, borderRadius: 24, marginRight: 6 },
  speakSmall: { width: 36, height: 36, borderRadius: 18 },
  speakIconBig: { fontSize: 20 },
  speakIconSmall: { fontSize: 15 },
  pressed: { opacity: 0.6 },

  examples: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 12,
  },
  examplesTitle: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: "#9aa0c3",
    marginBottom: 10,
  },
  exRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0e1122",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  exWord: { fontSize: 22, color: "#f4f5fb", marginRight: 12 },
  exInfo: { flex: 1, minWidth: 0 },
  exPinyin: { color: "#ffb703", fontSize: 15 },
  exMeaning: { color: "#9aa0c3", fontSize: 13 },
  exNone: { color: "#9aa0c3", fontSize: 14, fontStyle: "italic" },
});
