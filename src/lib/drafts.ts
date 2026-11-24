// Work in progress kept on this device so an interrupted arrival or order can be resumed.
// Versioned: a draft saved by an older shape of the app is ignored rather than misread.

const PREFIX = 'sparkle:';

interface Stored<T> {
  v: number;
  savedAt: string;
  data: T;
}

export function loadDraft<T>(key: string, version: number): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    return parsed?.v === version ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, version: number, value: T): void {
  try {
    const stored: Stored<T> = { v: version, savedAt: new Date().toISOString(), data: value };
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(stored));
  } catch {
    // Private browsing or full storage: the draft simply is not kept.
  }
}

export function clearDraft(key: string): void {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}
