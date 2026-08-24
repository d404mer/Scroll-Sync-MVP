import type { UpdateInfo } from './types';
import {
  UPDATE_CACHE_KEY,
  UPDATE_DISMISSED_KEY,
  VERSION_JSON_URL,
} from './types';

const CACHE_MS = 6 * 60 * 60 * 1000;
export const UPDATE_ALARM = 'update-check';

interface UpdateCache {
  latestVersion: string;
  downloadUrl: string;
  notes: string;
  checkedAt: number;
}

interface RemoteVersion {
  version?: string;
  downloadUrl?: string;
  notes?: string;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function localVersion(): string {
  return chrome.runtime.getManifest().version;
}

async function loadCache(): Promise<UpdateCache | undefined> {
  const raw = await chrome.storage.local.get(UPDATE_CACHE_KEY);
  return raw[UPDATE_CACHE_KEY] as UpdateCache | undefined;
}

async function loadDismissed(): Promise<string | undefined> {
  const raw = await chrome.storage.local.get(UPDATE_DISMISSED_KEY);
  const value = raw[UPDATE_DISMISSED_KEY];
  return typeof value === 'string' ? value : undefined;
}

export async function buildUpdateInfo(): Promise<UpdateInfo | undefined> {
  const cache = await loadCache();
  if (!cache?.latestVersion || !cache.downloadUrl) return undefined;
  const current = localVersion();
  const dismissed = await loadDismissed();
  const newer = compareVersions(cache.latestVersion, current) > 0;
  const hidden = dismissed === cache.latestVersion;
  return {
    current,
    latest: cache.latestVersion,
    downloadUrl: cache.downloadUrl,
    notes: cache.notes || undefined,
    available: newer && !hidden,
  };
}

export async function fetchRemoteVersion(force: boolean): Promise<void> {
  const cache = await loadCache();
  if (!force && cache && Date.now() - cache.checkedAt < CACHE_MS) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(VERSION_JSON_URL, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) return;
    const json = (await res.json()) as RemoteVersion;
    const latestVersion = json.version?.trim();
    const downloadUrl = json.downloadUrl?.trim();
    if (!latestVersion || !downloadUrl) return;
    const next: UpdateCache = {
      latestVersion,
      downloadUrl,
      notes: json.notes?.trim() ?? '',
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: next });
  } catch {
    // сеть/таймаут — оставляем старый кэш, баннер не врём
  } finally {
    clearTimeout(timer);
  }
}

export async function dismissCurrentUpdate(): Promise<void> {
  const cache = await loadCache();
  if (!cache?.latestVersion) return;
  await chrome.storage.local.set({
    [UPDATE_DISMISSED_KEY]: cache.latestVersion,
  });
}

export async function startUpdateDownload(): Promise<string | undefined> {
  const cache = await loadCache();
  if (!cache?.downloadUrl || !cache.latestVersion) {
    return 'Нет ссылки на новую версию.';
  }
  try {
    await chrome.downloads.download({
      url: cache.downloadUrl,
      filename: `scroll-sync-${cache.latestVersion}.zip`,
      saveAs: true,
    });
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(msg)) return undefined;
    return msg || 'Не удалось начать скачивание.';
  }
}

export async function ensureUpdateAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(UPDATE_ALARM);
  if (existing) return;
  await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 24 * 60 });
}
