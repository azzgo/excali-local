import { openDB, type IDBPDatabase } from "idb"
import type { FontConfig, FontSource, FontConfigRecord } from "./index"

const DB_NAME = "excali-fonts"
const DB_VERSION = 1
const STORE_NAME = "fontConfig"
const FONT_CONFIG_KEY = "font-config" as const

async function initDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
    },
  })
}

export async function getFontConfig(): Promise<FontConfig | null> {
  try {
    const db = await initDB()
    const record = await db.get(STORE_NAME, FONT_CONFIG_KEY) as FontConfigRecord | undefined
    if (!record) {
      return null
    }
    return {
      handwriting: record.handwriting,
      normal: record.normal,
      code: record.code,
    }
  } catch {
    return null
  }
}

export async function saveFontConfig(config: FontConfig): Promise<void> {
  const db = await initDB()
  const record: FontConfigRecord = {
    key: FONT_CONFIG_KEY,
    handwriting: config.handwriting,
    normal: config.normal,
    code: config.code,
  }
  await db.put(STORE_NAME, record)
}

export async function clearFontSlot(slot: keyof Omit<FontConfigRecord, "key">): Promise<void> {
  const db = await initDB()
  const existing = await db.get(STORE_NAME, FONT_CONFIG_KEY) as FontConfigRecord | undefined
  if (existing) {
    const updated: FontConfigRecord = {
      ...existing,
      [slot]: null,
    }
    await db.put(STORE_NAME, updated)
  }
}

export async function updateFontSlot(
  slot: keyof Omit<FontConfigRecord, "key">,
  source: FontSource | null
): Promise<void> {
  const db = await initDB()
  const existing = await db.get(STORE_NAME, FONT_CONFIG_KEY) as FontConfigRecord | undefined
  const record: FontConfigRecord = existing
    ? { ...existing, [slot]: source }
    : {
        key: FONT_CONFIG_KEY,
        handwriting: null,
        normal: null,
        code: null,
        [slot]: source,
      }
  await db.put(STORE_NAME, record)
}
