import { sendRuntimeMessage, sendTabMessage } from '../shared/messaging';
import type {
  AdapterStatusMessage,
  AppState,
  ErrorMessage,
  ExtensionMessage,
  Group,
  StateMessage,
} from '../shared/types';

const groupSelect = document.getElementById('group-select') as HTMLSelectElement;
const groupPanel = document.getElementById('group-panel') as HTMLElement;
const emptyEl = document.getElementById('empty') as HTMLElement;
const errorEl = document.getElementById('error') as HTMLElement;
const adapterStatusEl = document.getElementById('adapter-status') as HTMLElement;
const syncEnabled = document.getElementById('sync-enabled') as HTMLInputElement;
const syncMode = document.getElementById('sync-mode') as HTMLSelectElement;
const leaderMode = document.getElementById('leader-mode') as HTMLSelectElement;
const fixedLeader = document.getElementById('fixed-leader') as HTMLSelectElement;
const fixedLeaderWrap = document.getElementById('fixed-leader-wrap') as HTMLElement;
const tabList = document.getElementById('tab-list') as HTMLUListElement;
const anchorCount = document.getElementById('anchor-count') as HTMLElement;
const anchorHint = document.getElementById('anchor-hint') as HTMLElement;

let state: AppState = { groups: [] };
let rendering = false;

function showError(message: string | null): void {
  if (!message) {
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    return;
  }
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function isState(msg: ExtensionMessage): msg is StateMessage {
  return msg.type === 'STATE';
}

function isError(msg: ExtensionMessage): msg is ErrorMessage {
  return msg.type === 'ERROR';
}

async function call(message: ExtensionMessage): Promise<void> {
  const res = await sendRuntimeMessage(message);
  if (isError(res)) {
    showError(res.error);
    return;
  }
  if (isState(res)) {
    showError(null);
    state = res.state;
    render();
  }
}

function activeGroup(): Group | undefined {
  return state.groups.find((g) => g.id === state.activeGroupId);
}

function render(): void {
  rendering = true;
  const groups = state.groups;
  const group = activeGroup();

  groupSelect.innerHTML = '';
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = `${g.name} (${g.tabIds.length})`;
    groupSelect.appendChild(opt);
  }
  if (group) {
    groupSelect.value = group.id;
  }

  if (!group) {
    groupPanel.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    rendering = false;
    return;
  }

  emptyEl.classList.add('hidden');
  groupPanel.classList.remove('hidden');

  syncEnabled.checked = group.syncEnabled;
  syncMode.value = group.syncMode;
  leaderMode.value = group.leaderMode;

  const showFixed = group.leaderMode === 'fixed';
  fixedLeaderWrap.classList.toggle('hidden', !showFixed);

  fixedLeader.innerHTML = '';
  for (const tabId of group.tabIds) {
    const opt = document.createElement('option');
    opt.value = String(tabId);
    opt.textContent = group.tabTitles[tabId] ?? `Вкладка ${tabId}`;
    fixedLeader.appendChild(opt);
  }
  if (group.fixedLeaderTabId !== undefined) {
    fixedLeader.value = String(group.fixedLeaderTabId);
  }

  anchorCount.textContent = `Якоря: ${group.anchors.length}`;
  const needHint = group.syncMode === 'anchor' && group.anchors.length < 2;
  anchorHint.classList.toggle('hidden', !needHint);

  tabList.innerHTML = '';
  for (const tabId of group.tabIds) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = group.tabTitles[tabId] ?? `Вкладка ${tabId}`;
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = group.tabUrls[tabId] ?? '';
    meta.append(title, url);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Убрать';    remove.addEventListener('click', () => {
      void call({
        type: 'REMOVE_TAB_FROM_GROUP',
        groupId: group.id,
        tabId,
      });
    });

    li.append(meta, remove);
    tabList.appendChild(li);
  }

  rendering = false;
}

async function loadAdapterStatus(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    adapterStatusEl.textContent = 'Адаптер: н/д';
    return;
  }
  const res = await sendTabMessage<AdapterStatusMessage>(tab.id, {
    type: 'GET_ADAPTER_STATUS',
  });
  if (!res || res.type !== 'ADAPTER_STATUS') {
    adapterStatusEl.textContent = 'Адаптер: недоступен на этой странице';
    return;
  }
  const { status } = res;
  const mark = status.ok ? 'ок' : 'ограничен';
  adapterStatusEl.textContent = `Адаптер: ${status.label} (${mark})${
    status.detail ? ` — ${status.detail}` : ''
  }`;
}

document.getElementById('btn-create')!.addEventListener('click', () => {
  void call({ type: 'CREATE_GROUP' });
});

document.getElementById('btn-add')!.addEventListener('click', () => {
  void call({ type: 'ADD_TAB_TO_GROUP' });
});

groupSelect.addEventListener('change', () => {
  if (rendering) return;
  void call({ type: 'SET_ACTIVE_GROUP', groupId: groupSelect.value });
});

syncEnabled.addEventListener('change', () => {
  if (rendering) return;
  const group = activeGroup();
  if (!group) return;
  void call({
    type: 'TOGGLE_SYNC',
    groupId: group.id,
    enabled: syncEnabled.checked,
  });
});

syncMode.addEventListener('change', () => {
  if (rendering) return;
  const group = activeGroup();
  if (!group) return;
  void call({
    type: 'SET_SYNC_MODE',
    groupId: group.id,
    syncMode: syncMode.value as 'percent' | 'anchor',
  });
});

leaderMode.addEventListener('change', () => {
  if (rendering) return;
  const group = activeGroup();
  if (!group) return;
  void call({
    type: 'SET_LEADER_MODE',
    groupId: group.id,
    leaderMode: leaderMode.value as 'active' | 'fixed',
  });
});

fixedLeader.addEventListener('change', () => {
  if (rendering) return;
  const group = activeGroup();
  if (!group) return;
  void call({
    type: 'SET_FIXED_LEADER',
    groupId: group.id,
    tabId: Number(fixedLeader.value),
  });
});

document.getElementById('btn-add-anchor')!.addEventListener('click', () => {
  const group = activeGroup();
  if (!group) return;
  void call({ type: 'ADD_ANCHOR', groupId: group.id });
});

document.getElementById('btn-clear-anchors')!.addEventListener('click', () => {
  const group = activeGroup();
  if (!group) return;
  void call({ type: 'CLEAR_ANCHORS', groupId: group.id });
});

async function boot(): Promise<void> {
  await call({ type: 'GET_STATE' });
  await loadAdapterStatus();
}

void boot();
