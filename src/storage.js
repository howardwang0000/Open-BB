import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "chinese-vocab-list-v1";

export async function loadItems() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export async function saveItems(items) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch (e) {
    // ignore write failures
  }
}
