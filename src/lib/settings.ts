import fs from "node:fs";
import path from "node:path";
import { decryptWithDpapi, encryptWithDpapi } from "@/lib/dpapi";
import { ensureDir, SETTINGS_FILE } from "@/lib/paths";
import type { SettingsRecord } from "@/lib/types";

function readSettings(): SettingsRecord | null {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return null;
  }
  const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
  return JSON.parse(raw) as SettingsRecord;
}

export function saveApiKey(apiKey: string): void {
  ensureDir(path.dirname(SETTINGS_FILE));
  const payload: SettingsRecord = {
    apiKeyEncrypted: encryptWithDpapi(apiKey),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2), "utf8");
}

export function getApiKey(): string | null {
  const settings = readSettings();
  if (!settings) {
    return null;
  }
  return decryptWithDpapi(settings.apiKeyEncrypted);
}

export function getApiKeyStatus(): { configured: boolean; lastUpdatedAt: string | null } {
  const settings = readSettings();
  if (!settings) {
    return { configured: false, lastUpdatedAt: null };
  }
  return { configured: true, lastUpdatedAt: settings.updatedAt };
}
