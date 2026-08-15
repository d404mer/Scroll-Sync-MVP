import { AppState, STORAGE_KEY, emptyState } from './types';

export async function loadState(): Promise<AppState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const raw = result[STORAGE_KEY] as AppState | undefined;
  if (!raw || !Array.isArray(raw.groups)) {
    return emptyState();
  }
  return {
    groups: raw.groups,
    activeGroupId: raw.activeGroupId,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    activeSessionId: raw.activeSessionId,
  };
}

export async function saveState(state: AppState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}
