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
let ready: Promise<void> = init();

async function init(): Promise<void> {
  state = await loadState();
  await restoreTabIdsByUrl();
  await persist();
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

async function restoreTabIdsByUrl(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const byUrl = new Map<string, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    const list = byUrl.get(tab.url) ?? [];
    list.push(tab);
    byUrl.set(tab.url, list);
  }

  for (const group of state.groups) {
    const oldIds = [...group.tabIds];
    const newTabIds: number[] = [];
    const newUrls: Record<number, string> = {};
    const newTitles: Record<number, string> = {};
    const idMap = new Map<number, number>();

    for (const oldId of oldIds) {
      const url = group.tabUrls[oldId];
      if (!url) continue;
      const candidates = byUrl.get(url);
      const match = candidates?.find((t) => t.id && !newTabIds.includes(t.id));
      if (!match?.id) continue;
      idMap.set(oldId, match.id);
      newTabIds.push(match.id);
      newUrls[match.id] = url;
      newTitles[match.id] = match.title ?? group.tabTitles[oldId] ?? url;
    }

    // Remap anchors
    group.anchors = group.anchors.map((anchor) => {
      const points: Record<number, number> = {};
      for (const [oldIdStr, progress] of Object.entries(anchor.points)) {
        const oldId = Number(oldIdStr);
        const mapped = idMap.get(oldId);
        if (mapped !== undefined) {
          points[mapped] = progress;
        }
      }
      return { ...anchor, points };
    });

    if (group.fixedLeaderTabId !== undefined) {
      group.fixedLeaderTabId = idMap.get(group.fixedLeaderTabId);
    }
    if (group.activeLeaderTabId !== undefined) {
      group.activeLeaderTabId = idMap.get(group.activeLeaderTabId);
    }

    group.tabIds = newTabIds;
    group.tabUrls = newUrls;
    group.tabTitles = newTitles;
  }

  state.groups = state.groups.filter((g) => g.tabIds.length > 0);
  if (
    state.activeGroupId &&
    !state.groups.some((g) => g.id === state.activeGroupId)
  ) {
    state.activeGroupId = state.groups[0]?.id;
  }
}

async function createGroupFromActiveTab(): Promise<StateMessage | { type: 'ERROR'; error: string }> {
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
    syncEnabled: true,
    syncMode: 'percent',
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
  // removeTabFromAllGroups may have deleted empty groups — re-find
  const target = state.groups.find((g) => g.id === group.id);
  if (!target) {
    return { type: 'ERROR', error: 'Группа больше не существует.' };
  }

  if (!target.tabIds.includes(tab.id)) {
    target.tabIds.push(tab.id);
  }
  target.tabUrls[tab.id] = tab.url!;
  target.tabTitles[tab.id] = tab.title ?? tab.url!;
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
  // active mode: any member scrolling becomes leader
  return group.tabIds.includes(tabId);
}

/**
 * Map leader progress to follower progress using anchors.
 * Anchors are ordered by the leader's progress values.
 */
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

async function broadcastScroll(fromTabId: number, progress: number): Promise<void> {
  const group = findGroupByTabId(fromTabId);
  if (!group || !group.syncEnabled) return;
  if (!isLeader(group, fromTabId)) return;

  if (group.leaderMode === 'active') {
    group.activeLeaderTabId = fromTabId;
  }

  const useAnchors =
    group.syncMode === 'anchor' && group.anchors.length >= 2;

  await Promise.all(
    group.tabIds
      .filter((id) => id !== fromTabId)
      .map(async (tabId) => {
        const mapped = useAnchors
          ? mapProgressViaAnchors(group, fromTabId, tabId, progress)
          : progress;
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
  ready = init();
});

chrome.runtime.onStartup.addListener(() => {
  ready = init();
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
            // If tab was only removed from that group path via helper — done
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

          case 'SCROLL_PROGRESS': {
            const tabId = sender.tab?.id;
            if (typeof tabId === 'number') {
              await broadcastScroll(tabId, message.progress);
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
