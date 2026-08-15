import { loadState, saveState } from '../shared/storage';
import type {
  AdapterStatusMessage,
  AppState,
  ExtensionMessage,
  Group,
  ProgressMessage,
  StateMessage,
} from '../shared/types';
import { createId, emptyState } from '../shared/types';
import { sendTabMessage } from '../shared/messaging';

let state: AppState = emptyState();
let ready: Promise<void> = Promise.resolve();

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ensureGroupShape(group: Group): Group {
  if (!group.scrollScales) group.scrollScales = {};
  if (!group.tabUrls) group.tabUrls = {};
  if (!group.tabTitles) group.tabTitles = {};
  if (!group.anchors) group.anchors = [];
  for (const tabId of group.tabIds) {
    if (typeof group.scrollScales[tabId] !== 'number') {
      group.scrollScales[tabId] = 1;
    }
  }
  return group;
}

function getScale(group: Group, tabId: number): number {
  const scale = group.scrollScales?.[tabId];
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale === 0) {
    return 1;
  }
  return scale;
}

/** Apply signed scale to logical 0..1 progress. Negative = reverse. */
function applyScale(logical: number, scale: number): number {
  if (scale >= 0) return clamp01(logical * scale);
  return clamp01(1 + logical * scale);
}

function mapWithScales(
  progress: number,
  fromTabId: number,
  toTabId: number,
  group: Group,
): number {
  const fromScale = getScale(group, fromTabId);
  const toScale = getScale(group, toTabId);
  const ratio = toScale / fromScale;
  return applyScale(progress, ratio);
}

function urlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

async function boot(injectScripts: boolean): Promise<void> {
  state = await loadState();
  state.groups = state.groups.map(ensureGroupShape);
  await restoreTabBindings();
  state.groups = state.groups.map(ensureGroupShape);
  await persist();
  if (injectScripts) {
    await injectContentScriptsIntoOpenTabs();
  }
}

/** Serialize boots so a later init cannot overwrite fresher in-memory state mid-flight. */
function scheduleBoot(injectScripts: boolean): Promise<void> {
  ready = ready.catch(() => undefined).then(() => boot(injectScripts));
  return ready;
}

async function persist(): Promise<void> {
  await saveState(state);
}

function findGroupByTabId(tabId: number): Group | undefined {
  return state.groups.find((g) => g.tabIds.includes(tabId));
}

function getActiveGroup(): Group | undefined {
  if (!state.activeGroupId) return undefined;
  return state.groups.find((g) => g.id === state.activeGroupId);
}

function removeTabFromAllGroups(tabId: number): boolean {
  let changed = false;
  for (const group of state.groups) {
    if (!group.tabIds.includes(tabId)) continue;
    changed = true;
    group.tabIds = group.tabIds.filter((id) => id !== tabId);
    delete group.tabUrls[tabId];
    delete group.tabTitles[tabId];
    delete group.scrollScales[tabId];
    if (group.fixedLeaderTabId === tabId) {
      group.fixedLeaderTabId = group.tabIds[0];
    }
    if (group.activeLeaderTabId === tabId) {
      group.activeLeaderTabId = group.tabIds[0];
    }
    for (const anchor of group.anchors) {
      delete anchor.points[tabId];
    }
  }
  // Only drop groups that lost all members after a real tab close
  state.groups = state.groups.filter((g) => g.tabIds.length > 0);
  if (
    state.activeGroupId &&
    !state.groups.some((g) => g.id === state.activeGroupId)
  ) {
    state.activeGroupId = state.groups[0]?.id;
  }
  return changed;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('file://')
  );
}

async function tabStillExists(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

/**
 * Prefer live tabIds (SW sleep does not change them). Remap only dead ids by URL.
 * Never delete groups here — failed rematch keeps orphaned entries until URL reappears
 * or the user removes them.
 */
async function restoreTabBindings(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const byUrl = new Map<string, chrome.tabs.Tab[]>();
  const byKey = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    const list = byUrl.get(tab.url) ?? [];
    list.push(tab);
    byUrl.set(tab.url, list);
    const key = urlKey(tab.url);
    const loose = byKey.get(key) ?? [];
    loose.push(tab);
    byKey.set(key, loose);
  }

  const claimed = new Set<number>();

  for (const group of state.groups) {
    ensureGroupShape(group);
    const oldIds = [...group.tabIds];
    const newTabIds: number[] = [];
    const newUrls: Record<number, string> = {};
    const newTitles: Record<number, string> = {};
    const newScales: Record<number, number> = {};
    const idMap = new Map<number, number>();

    for (const oldId of oldIds) {
      const savedUrl = group.tabUrls[oldId];
      const savedTitle = group.tabTitles[oldId];
      const savedScale = getScale(group, oldId);

      const live = await tabStillExists(oldId);
      if (live?.id && !claimed.has(live.id)) {
        claimed.add(live.id);
        idMap.set(oldId, live.id);
        newTabIds.push(live.id);
        newUrls[live.id] = live.url ?? savedUrl ?? '';
        newTitles[live.id] = live.title ?? savedTitle ?? savedUrl ?? '';
        newScales[live.id] = savedScale;
        continue;
      }

      if (!savedUrl) continue;

      const exact = byUrl
        .get(savedUrl)
        ?.find((t) => t.id && !claimed.has(t.id) && !newTabIds.includes(t.id));
      const loose = byKey
        .get(urlKey(savedUrl))
        ?.find((t) => t.id && !claimed.has(t.id) && !newTabIds.includes(t.id));
      const match = exact ?? loose;
      if (!match?.id) {
        // Keep orphan slot so the group (and URL) survive until rematch
        if (!newTabIds.includes(oldId)) {
          idMap.set(oldId, oldId);
          newTabIds.push(oldId);
          newUrls[oldId] = savedUrl;
          newTitles[oldId] = savedTitle ?? savedUrl;
          newScales[oldId] = savedScale;
        }
        continue;
      }

      claimed.add(match.id);
      idMap.set(oldId, match.id);
      newTabIds.push(match.id);
      newUrls[match.id] = match.url ?? savedUrl;
      newTitles[match.id] = match.title ?? savedTitle ?? savedUrl;
      newScales[match.id] = savedScale;
    }

    group.anchors = group.anchors.map((anchor) => {
      const points: Record<number, number> = {};
      for (const [oldIdStr, progress] of Object.entries(anchor.points)) {
        const oldId = Number(oldIdStr);
        const mapped = idMap.get(oldId);
        if (mapped !== undefined) {
          points[mapped] = progress;
        } else if (newTabIds.includes(oldId)) {
          points[oldId] = progress;
        }
      }
      return { ...anchor, points };
    });

    if (group.fixedLeaderTabId !== undefined) {
      group.fixedLeaderTabId =
        idMap.get(group.fixedLeaderTabId) ?? group.fixedLeaderTabId;
      if (!newTabIds.includes(group.fixedLeaderTabId)) {
        group.fixedLeaderTabId = newTabIds[0];
      }
    }
    if (group.activeLeaderTabId !== undefined) {
      group.activeLeaderTabId =
        idMap.get(group.activeLeaderTabId) ?? group.activeLeaderTabId;
      if (!newTabIds.includes(group.activeLeaderTabId)) {
        group.activeLeaderTabId = newTabIds[0];
      }
    }

    group.tabIds = newTabIds;
    group.tabUrls = newUrls;
    group.tabTitles = newTitles;
    group.scrollScales = newScales;
  }

  // Do NOT delete groups with zero live matches — keep orphans with saved URLs
  if (
    state.activeGroupId &&
    !state.groups.some((g) => g.id === state.activeGroupId)
  ) {
    state.activeGroupId = state.groups[0]?.id;
  }
}

async function injectContentScriptsIntoOpenTabs(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files?.length) return;

  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !isInjectableUrl(tab.url)) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [...files],
        });
      } catch {
        // Restricted pages / already injected / no host access
      }
    }),
  );
}

ready = scheduleBoot(true);

async function createGroupFromActiveTab(): Promise<
  StateMessage | { type: 'ERROR'; error: string }
> {
  const tab = await getActiveTab();
  if (!tab?.id || !isInjectableUrl(tab.url)) {
    return { type: 'ERROR', error: 'На этой странице нельзя создать группу.' };
  }

  removeTabFromAllGroups(tab.id);

  const group: Group = {
    id: createId('group'),
    name: `Группа №${state.groups.length + 1}`,
    tabIds: [tab.id],
    tabUrls: { [tab.id]: tab.url! },
    tabTitles: { [tab.id]: tab.title ?? tab.url! },
    scrollScales: { [tab.id]: 1 },
    syncEnabled: true,
    syncMode: 'pixel',
    leaderMode: 'active',
    activeLeaderTabId: tab.id,
    fixedLeaderTabId: tab.id,
    anchors: [],
  };

  state.groups.push(group);
  state.activeGroupId = group.id;
  await persist();
  return { type: 'STATE', state };
}

async function addActiveTabToGroup(
  groupId?: string,
): Promise<StateMessage | { type: 'ERROR'; error: string }> {
  const tab = await getActiveTab();
  if (!tab?.id || !isInjectableUrl(tab.url)) {
    return { type: 'ERROR', error: 'Эту страницу нельзя добавить в группу.' };
  }

  const group =
    (groupId ? state.groups.find((g) => g.id === groupId) : undefined) ??
    getActiveGroup();

  if (!group) {
    return { type: 'ERROR', error: 'Нет активной группы. Сначала создайте её.' };
  }

  removeTabFromAllGroups(tab.id);
  const target = state.groups.find((g) => g.id === group.id);
  if (!target) {
    return { type: 'ERROR', error: 'Группа больше не существует.' };
  }

  ensureGroupShape(target);
  if (!target.tabIds.includes(tab.id)) {
    target.tabIds.push(tab.id);
  }
  target.tabUrls[tab.id] = tab.url!;
  target.tabTitles[tab.id] = tab.title ?? tab.url!;
  if (typeof target.scrollScales[tab.id] !== 'number') {
    target.scrollScales[tab.id] = 1;
  }
  if (target.fixedLeaderTabId === undefined) {
    target.fixedLeaderTabId = tab.id;
  }
  state.activeGroupId = target.id;
  await persist();
  return { type: 'STATE', state };
}

async function toggleSync(
  groupId?: string,
  enabled?: boolean,
): Promise<StateMessage | { type: 'ERROR'; error: string }> {
  const group =
    (groupId ? state.groups.find((g) => g.id === groupId) : undefined) ??
    getActiveGroup();
  if (!group) {
    return { type: 'ERROR', error: 'Нет активной группы.' };
  }
  group.syncEnabled = enabled ?? !group.syncEnabled;
  await persist();
  return { type: 'STATE', state };
}

function isLeader(group: Group, tabId: number): boolean {
  if (group.leaderMode === 'fixed') {
    return group.fixedLeaderTabId === tabId;
  }
  return group.tabIds.includes(tabId);
}

function mapProgressViaAnchors(
  group: Group,
  leaderTabId: number,
  followerTabId: number,
  leaderProgress: number,
): number {
  const usable = group.anchors
    .map((a) => ({
      leader: a.points[leaderTabId],
      follower: a.points[followerTabId],
    }))
    .filter(
      (p) =>
        typeof p.leader === 'number' &&
        typeof p.follower === 'number' &&
        Number.isFinite(p.leader) &&
        Number.isFinite(p.follower),
    )
    .sort((a, b) => a.leader - b.leader);

  if (usable.length < 2) {
    return leaderProgress;
  }

  if (leaderProgress <= usable[0].leader) {
    return usable[0].follower;
  }
  const last = usable[usable.length - 1];
  if (leaderProgress >= last.leader) {
    return last.follower;
  }

  for (let i = 0; i < usable.length - 1; i++) {
    const a = usable[i];
    const b = usable[i + 1];
    if (leaderProgress >= a.leader && leaderProgress <= b.leader) {
      const span = b.leader - a.leader;
      if (span <= 0) return a.follower;
      const t = (leaderProgress - a.leader) / span;
      return a.follower + t * (b.follower - a.follower);
    }
  }

  return leaderProgress;
}

async function broadcastScroll(
  fromTabId: number,
  progress: number,
  deltaPx = 0,
): Promise<void> {
  const group = findGroupByTabId(fromTabId);
  if (!group || !group.syncEnabled) return;
  if (!isLeader(group, fromTabId)) return;

  ensureGroupShape(group);
  if (group.leaderMode === 'active') {
    group.activeLeaderTabId = fromTabId;
  }

  const useAnchors =
    group.syncMode === 'anchor' && group.anchors.length >= 2;

  if (group.syncMode === 'pixel') {
    if (Math.abs(deltaPx) < 0.5) return;
    await Promise.all(
      group.tabIds
        .filter((id) => id !== fromTabId)
        .map(async (tabId) => {
          const ratio = getScale(group, tabId) / getScale(group, fromTabId);
          await sendTabMessage(tabId, {
            type: 'APPLY_SCROLL_DELTA',
            deltaPx: deltaPx * ratio,
          });
        }),
    );
    return;
  }

  await Promise.all(
    group.tabIds
      .filter((id) => id !== fromTabId)
      .map(async (tabId) => {
        const mapped = useAnchors
          ? mapProgressViaAnchors(group, fromTabId, tabId, progress)
          : mapWithScales(progress, fromTabId, tabId, group);
        await sendTabMessage(tabId, {
          type: 'APPLY_SCROLL',
          progress: mapped,
        });
      }),
  );
}

async function collectProgressFromTabs(
  tabIds: number[],
): Promise<Record<number, number>> {
  const points: Record<number, number> = {};
  await Promise.all(
    tabIds.map(async (tabId) => {
      const res = await sendTabMessage<ProgressMessage>(tabId, {
        type: 'GET_PROGRESS',
      });
      if (res?.type === 'PROGRESS') {
        points[tabId] = res.progress;
      }
    }),
  );
  return points;
}

async function addAnchor(
  groupId: string,
): Promise<StateMessage | { type: 'ERROR'; error: string }> {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) {
    return { type: 'ERROR', error: 'Группа не найдена.' };
  }
  const points = await collectProgressFromTabs(group.tabIds);
  if (Object.keys(points).length < 1) {
    return { type: 'ERROR', error: 'Не удалось прочитать позиции скролла.' };
  }
  group.anchors.push({
    id: createId('anchor'),
    points,
  });
  await persist();
  return { type: 'STATE', state };
}

function renameGroup(
  groupId: string,
  name: string,
): StateMessage | { type: 'ERROR'; error: string } {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) {
    return { type: 'ERROR', error: 'Группа не найдена.' };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { type: 'ERROR', error: 'Название группы не может быть пустым.' };
  }
  group.name = trimmed.slice(0, 80);
  return { type: 'STATE', state };
}

function deleteGroup(
  groupId: string,
): StateMessage | { type: 'ERROR'; error: string } {
  const exists = state.groups.some((g) => g.id === groupId);
  if (!exists) {
    return { type: 'ERROR', error: 'Группа не найдена.' };
  }
  state.groups = state.groups.filter((g) => g.id !== groupId);
  if (state.activeGroupId === groupId) {
    state.activeGroupId = state.groups[0]?.id;
  }
  return { type: 'STATE', state };
}

async function setScrollPercent(
  groupId: string,
  percent: number,
): Promise<StateMessage | { type: 'ERROR'; error: string }> {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) {
    return { type: 'ERROR', error: 'Группа не найдена.' };
  }
  if (!Number.isFinite(percent)) {
    return { type: 'ERROR', error: 'Некорректный процент.' };
  }
  ensureGroupShape(group);
  const logical = percent / 100;
  const useAnchors =
    group.syncMode === 'anchor' && group.anchors.length >= 2;
  const leaderTabId =
    group.leaderMode === 'fixed'
      ? group.fixedLeaderTabId
      : group.activeLeaderTabId ?? group.tabIds[0];

  await Promise.all(
    group.tabIds.map(async (tabId) => {
      let mapped: number;
      if (
        useAnchors &&
        typeof leaderTabId === 'number' &&
        tabId !== leaderTabId
      ) {
        mapped = mapProgressViaAnchors(group, leaderTabId, tabId, logical);
      } else if (typeof leaderTabId === 'number') {
        mapped = mapWithScales(logical, leaderTabId, tabId, group);
      } else {
        mapped = applyScale(logical, getScale(group, tabId));
      }
      await sendTabMessage(tabId, {
        type: 'APPLY_SCROLL',
        progress: mapped,
      });
    }),
  );

  return { type: 'STATE', state };
}

function setTabScrollScale(
  groupId: string,
  tabId: number,
  scale: number,
): StateMessage | { type: 'ERROR'; error: string } {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) {
    return { type: 'ERROR', error: 'Группа не найдена.' };
  }
  if (!group.tabIds.includes(tabId)) {
    return { type: 'ERROR', error: 'Вкладка не входит в группу.' };
  }
  if (!Number.isFinite(scale) || scale === 0) {
    return {
      type: 'ERROR',
      error: 'Масштаб должен быть числом ≠ 0 (можно отрицательным).',
    };
  }
  ensureGroupShape(group);
  group.scrollScales[tabId] = Math.max(-10, Math.min(10, scale));
  return { type: 'STATE', state };
}

async function refreshTabMeta(tabId: number): Promise<void> {
  const group = findGroupByTabId(tabId);
  if (!group) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) group.tabUrls[tabId] = tab.url;
    if (tab.title) group.tabTitles[tabId] = tab.title;
    await persist();
  } catch {
    // tab may be gone
  }
}

function stateResponse(): StateMessage {
  return { type: 'STATE', state };
}

chrome.runtime.onInstalled.addListener(() => {
  void scheduleBoot(true);
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleBoot(true);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (removeTabFromAllGroups(tabId)) {
    await persist();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  await ready;
  if (changeInfo.url || changeInfo.title) {
    await refreshTabMeta(tabId);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await ready;
  const group = findGroupByTabId(activeInfo.tabId);
  if (!group) return;
  if (group.leaderMode === 'active') {
    group.activeLeaderTabId = activeInfo.tabId;
    await persist();
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  await ready;
  if (command === 'toggle-sync') {
    await toggleSync();
  } else if (command === 'create-group') {
    await createGroupFromActiveTab();
  } else if (command === 'add-tab-to-group') {
    await addActiveTabToGroup();
  }
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    void (async () => {
      await ready;

      try {
        switch (message.type) {
          case 'GET_STATE':
            await restoreTabBindings();
            sendResponse(stateResponse());
            break;

          case 'CREATE_GROUP':
            sendResponse(await createGroupFromActiveTab());
            break;

          case 'ADD_TAB_TO_GROUP':
            sendResponse(await addActiveTabToGroup(message.groupId));
            break;

          case 'REMOVE_TAB_FROM_GROUP': {
            const group = state.groups.find((g) => g.id === message.groupId);
            if (!group) {
              sendResponse({ type: 'ERROR', error: 'Группа не найдена.' });
              break;
            }
            removeTabFromAllGroups(message.tabId);
            await persist();
            sendResponse(stateResponse());
            break;
          }

          case 'SET_ACTIVE_GROUP': {
            if (!state.groups.some((g) => g.id === message.groupId)) {
              sendResponse({ type: 'ERROR', error: 'Группа не найдена.' });
              break;
            }
            state.activeGroupId = message.groupId;
            await persist();
            sendResponse(stateResponse());
            break;
          }

          case 'RENAME_GROUP': {
            const result = renameGroup(message.groupId, message.name);
            if (result.type === 'STATE') await persist();
            sendResponse(result);
            break;
          }

          case 'DELETE_GROUP': {
            const result = deleteGroup(message.groupId);
            if (result.type === 'STATE') await persist();
            sendResponse(result);
            break;
          }

          case 'SET_SCROLL_PERCENT':
            sendResponse(
              await setScrollPercent(message.groupId, message.percent),
            );
            break;

          case 'SET_TAB_SCROLL_SCALE': {
            const result = setTabScrollScale(
              message.groupId,
              message.tabId,
              message.scale,
            );
            if (result.type === 'STATE') await persist();
            sendResponse(result);
            break;
          }

          case 'TOGGLE_SYNC':
            sendResponse(await toggleSync(message.groupId, message.enabled));
            break;

          case 'SET_SYNC_MODE': {
            const group = state.groups.find((g) => g.id === message.groupId);
            if (!group) {
              sendResponse({ type: 'ERROR', error: 'Группа не найдена.' });
              break;
            }
            group.syncMode = message.syncMode;
            await persist();
            sendResponse(stateResponse());
            break;
          }

          case 'SET_LEADER_MODE': {
            const group = state.groups.find((g) => g.id === message.groupId);
            if (!group) {
              sendResponse({ type: 'ERROR', error: 'Группа не найдена.' });
              break;
            }
            group.leaderMode = message.leaderMode;
            await persist();
            sendResponse(stateResponse());
            break;
          }

          case 'SET_FIXED_LEADER': {
            const group = state.groups.find((g) => g.id === message.groupId);
            if (!group) {
              sendResponse({ type: 'ERROR', error: 'Группа не найдена.' });
              break;
            }
            if (!group.tabIds.includes(message.tabId)) {
              sendResponse({
                type: 'ERROR',
                error: 'Вкладка не входит в группу.',
              });
              break;
            }
            group.fixedLeaderTabId = message.tabId;
            group.leaderMode = 'fixed';
            await persist();
            sendResponse(stateResponse());
            break;
          }

          case 'ADD_ANCHOR':
            sendResponse(await addAnchor(message.groupId));
            break;

          case 'CLEAR_ANCHORS': {
            const group = state.groups.find((g) => g.id === message.groupId);
            if (!group) {
              sendResponse({ type: 'ERROR', error: 'Группа не найдена.' });
              break;
            }
            group.anchors = [];
            await persist();
            sendResponse(stateResponse());
            break;
          }

          case 'SCROLL_UPDATE': {
            const tabId = sender.tab?.id;
            if (typeof tabId === 'number') {
              await broadcastScroll(
                tabId,
                message.progress,
                message.deltaPx,
              );
            }
            sendResponse({ type: 'STATE', state });
            break;
          }

          case 'SCROLL_PROGRESS': {
            const tabId = sender.tab?.id;
            if (typeof tabId === 'number') {
              await broadcastScroll(tabId, message.progress, 0);
            }
            sendResponse({ type: 'STATE', state });
            break;
          }

          default:
            sendResponse({
              type: 'ERROR',
              error: `Неизвестное сообщение: ${message.type}`,
            });
        }
      } catch (err) {
        sendResponse({
          type: 'ERROR',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return true;
  },
);

export type { AdapterStatusMessage };
