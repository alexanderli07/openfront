// chrome.storage.local backed by localStorage.
//
// Mirrors the subset of chrome.storage.local the engine uses (get / set / remove
// + onChanged). onChanged is delivered two ways so the popup and content stay in
// sync: same-tab writes fire listeners directly (the DOM `storage` event does
// NOT fire in the tab that made the change); other-tab writes arrive via it.

const PREFIX = "ofh:";

type StorageChange = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, StorageChange>, areaName: string) => void;

const listeners = new Set<ChangeListener>();

const rawKey = (key: string) => PREFIX + key;

function readKey(key: string): unknown {
  const raw = localStorage.getItem(rawKey(key));
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeKey(key: string, value: unknown): void {
  localStorage.setItem(rawKey(key), JSON.stringify(value));
}

function emit(changes: Record<string, StorageChange>): void {
  for (const listener of listeners) {
    try {
      listener(changes, "local");
    } catch (error) {
      console.error("[ofh] storage listener threw:", error);
    }
  }
}

function normalizeGetKeys(keys: string | string[] | Record<string, unknown> | null | undefined): {
  names: string[];
  defaults: Record<string, unknown>;
} {
  if (keys == null) {
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) names.push(k.slice(PREFIX.length));
    }
    return { names, defaults: {} };
  }
  if (typeof keys === "string") return { names: [keys], defaults: {} };
  if (Array.isArray(keys)) return { names: keys, defaults: {} };
  return { names: Object.keys(keys), defaults: keys };
}

export const storageLocal = {
  async get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const { names, defaults } = normalizeGetKeys(keys);
    const out: Record<string, unknown> = {};
    for (const name of names) {
      const value = readKey(name);
      if (value !== undefined) out[name] = value;
      else if (name in defaults) out[name] = defaults[name];
    }
    return out;
  },

  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, StorageChange> = {};
    for (const [key, newValue] of Object.entries(items)) {
      const oldValue = readKey(key);
      writeKey(key, newValue);
      changes[key] = { oldValue, newValue };
    }
    emit(changes);
  },

  async remove(keys: string | string[]): Promise<void> {
    const names = Array.isArray(keys) ? keys : [keys];
    const changes: Record<string, StorageChange> = {};
    for (const key of names) {
      const oldValue = readKey(key);
      localStorage.removeItem(rawKey(key));
      changes[key] = { oldValue, newValue: undefined };
    }
    emit(changes);
  },
};

export const storageOnChanged = {
  addListener: (cb: ChangeListener) => void listeners.add(cb),
  removeListener: (cb: ChangeListener) => void listeners.delete(cb),
  hasListener: (cb: ChangeListener) => listeners.has(cb),
};

export function installCrossTabSync(): void {
  window.addEventListener("storage", (event) => {
    if (!event.key || !event.key.startsWith(PREFIX) || event.storageArea !== localStorage) {
      return;
    }
    const parse = (raw: string | null): unknown => {
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    };
    emit({
      [event.key.slice(PREFIX.length)]: {
        oldValue: parse(event.oldValue),
        newValue: parse(event.newValue),
      },
    });
  });
}
