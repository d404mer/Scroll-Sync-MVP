import { sendRuntimeMessage, sendTabMessage } from '../shared/messaging';
import type {
  AdapterStatusMessage,
  AppState,
  ErrorMessage,
  ExtensionMessage,
  Group,
  ProgressMessage,
  Session,
  StateMessage,
} from '../shared/types';

const groupSelect = document.getElementById('group-select') as HTMLSelectElement;
const groupPanel = document.getElementById('group-panel') as HTMLElement;
const emptyEl = document.getElementById('empty') as HTMLElement;
const errorEl = document.getElementById('error') as HTMLElement;
const adapterStatusEl = document.getElementById('adapter-status') as HTMLElement;
const groupNameInput = document.getElementById('group-name') as HTMLInputElement;
const syncEnabled = document.getElementById('sync-enabled') as HTMLInputElement;
const syncMode = document.getElementById('sync-mode') as HTMLSelectElement;
const leaderMode = document.getElementById('leader-mode') as HTMLSelectElement;
const fixedLeader = document.getElementById('fixed-leader') as HTMLSelectElement;
const fixedLeaderWrap = document.getElementById('fixed-leader-wrap') as HTMLElement;
const tabList = document.getElementById('tab-list') as HTMLUListElement;
const scaleList = document.getElementById('scale-list') as HTMLUListElement;
const sessionList = document.getElementById('session-list') as HTMLUListElement;
const sessionsEmpty = document.getElementById('sessions-empty') as HTMLElement;
const sessionNameInput = document.getElementById('session-name') as HTMLInputElement;
const anchorCount = document.getElementById('anchor-count') as HTMLElement;
const anchorHint = document.getElementById('anchor-hint') as HTMLElement;
const scrollRange = document.getElementById('scroll-range') as HTMLInputElement;
const scrollPercent = document.getElementById('scroll-percent') as HTMLInputElement;
const settingsPanel = document.getElementById('settings-panel') as HTMLElement;
const settingsEmpty = document.getElementById('settings-empty') as HTMLElement;
const panelGroups = document.getElementById('panel-groups') as HTMLElement;
const panelSessions = document.getElementById('panel-sessions') as HTMLElement;
const panelSettings = document.getElementById('panel-settings') as HTMLElement;
const tabGroupsBtn = document.getElementById('tab-groups') as HTMLButtonElement;
const tabSessionsBtn = document.getElementById('tab-sessions') as HTMLButtonElement;
const tabSettingsBtn = document.getElementById('tab-settings') as HTMLButtonElement;

let state: AppState = { groups: [], sessions: [] };
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
    if (!state.sessions) state.sessions = [];
    render();
    void refreshScrollPercent();
  }
}

function activeGroup(): Group | undefined {
  return state.groups.find((g) => g.id === state.activeGroupId);
}

function activeSession(): Session | undefined {
  return state.sessions.find((s) => s.id === state.activeSessionId);
}

function tabScalePercent(group: Group, tabId: number): number {
  const scale = group.scrollScales?.[tabId];
  const value = typeof scale === 'number' && Number.isFinite(scale) ? scale : 1;
  return Math.round(value * 100);
}

function setScrollUi(percent: number): void {
  const value = String(Math.round(percent));
  scrollRange.value = String(Math.min(200, Math.max(-100, Math.round(percent))));
  scrollPercent.value = value;
}

async function refreshScrollPercent(): Promise<void> {
  const group = activeGroup();
  if (!group || group.tabIds.length === 0) {
    setScrollUi(0);
    return;
  }

  const leaderTabId =
    group.leaderMode === 'fixed'
      ? group.fixedLeaderTabId
      : group.activeLeaderTabId ?? group.tabIds[0];
  const tabId = leaderTabId ?? group.tabIds[0];
  const res = await sendTabMessage<ProgressMessage>(tabId, {
    type: 'GET_PROGRESS',
  });
  if (res?.type === 'PROGRESS') {
    setScrollUi(res.progress * 100);
  }
}

function switchTab(tab: 'groups' | 'sessions' | 'settings'): void {
  tabGroupsBtn.classList.toggle('active', tab === 'groups');
  tabSessionsBtn.classList.toggle('active', tab === 'sessions');
  tabSettingsBtn.classList.toggle('active', tab === 'settings');
  panelGroups.classList.toggle('hidden', tab !== 'groups');
  panelSessions.classList.toggle('hidden', tab !== 'sessions');
  panelSettings.classList.toggle('hidden', tab !== 'settings');
}

function formatSessionDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function renderTabList(group: Group): void {
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
    remove.textContent = 'Убрать';
    remove.addEventListener('click', () => {
      void call({
        type: 'REMOVE_TAB_FROM_GROUP',
        groupId: group.id,
        tabId,
      });
    });

    li.append(meta, remove);
    tabList.appendChild(li);
  }
}

function renderScaleList(group: Group): void {
  scaleList.innerHTML = '';
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

    const row = document.createElement('div');
    row.className = 'scale-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.value = String(tabScalePercent(group, tabId));
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = '%';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'secondary';
    save.textContent = 'OK';
    const apply = () => {
      const percent = Number(input.value);
      void call({
        type: 'SET_TAB_SCROLL_SCALE',
        groupId: group.id,
        tabId,
        scale: percent / 100,
      });
    };
    save.addEventListener('click', apply);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') apply();
    });
    row.append(input, unit, save);
    meta.append(title, url, row);
    li.append(meta);
    scaleList.appendChild(li);
  }
}

function renderSessionList(): void {
  sessionList.innerHTML = '';
  const sessions = state.sessions ?? [];
  sessionsEmpty.classList.toggle('hidden', sessions.length > 0);

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const session of sorted) {
    const li = document.createElement('li');
    if (session.id === state.activeSessionId) {
      li.classList.add('active-session');
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = session.name;
    const line = document.createElement('div');
    line.className = 'meta-line';
    line.textContent = `${session.members.length} стр. · ${formatSessionDate(session.updatedAt)}`;
    meta.append(title, line);

    const actions = document.createElement('div');
    actions.className = 'actions-col';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Открыть';
    openBtn.addEventListener('click', () => {
      void call({ type: 'OPEN_SESSION', sessionId: session.id });
    });

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'secondary';
    selectBtn.textContent = 'Активная';
    selectBtn.addEventListener('click', () => {
      sessionNameInput.value = session.name;
      void call({ type: 'SET_ACTIVE_SESSION', sessionId: session.id });
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = 'Удал.';
    let armed = false;
    let armTimer = 0;
    delBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!armed) {
        armed = true;
        delBtn.textContent = 'Точно?';
        armTimer = window.setTimeout(() => {
          armed = false;
          delBtn.textContent = 'Удал.';
        }, 2500);
        return;
      }
      window.clearTimeout(armTimer);
      void call({ type: 'DELETE_SESSION', sessionId: session.id });
    });

    actions.append(openBtn, selectBtn, delBtn);
    li.append(meta, actions);
    sessionList.appendChild(li);
  }
}

function render(): void {
  rendering = true;
  const groups = state.groups;
  const group = activeGroup();
  const session = activeSession();

  if (session && !sessionNameInput.value) {
    sessionNameInput.value = session.name;
  } else if (session && document.activeElement !== sessionNameInput) {
    sessionNameInput.placeholder = session.name;
  }

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
    settingsPanel.classList.add('hidden');
    settingsEmpty.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
    groupPanel.classList.remove('hidden');
    settingsEmpty.classList.add('hidden');
    settingsPanel.classList.remove('hidden');

    groupNameInput.value = group.name;
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

    renderTabList(group);
    renderScaleList(group);
  }

  renderSessionList();
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
  adapterStatusEl.textContent = `Адаптер: ${status.label} (${mark})${status.detail ? ` - ${status.detail}` : ''
    }`;
}

async function applyScrollPercent(): Promise<void> {
  const group = activeGroup();
  if (!group) return;
  const percent = Number(scrollPercent.value);
  await call({
    type: 'SET_SCROLL_PERCENT',
    groupId: group.id,
    percent,
  });
}

tabGroupsBtn.addEventListener('click', () => switchTab('groups'));
tabSessionsBtn.addEventListener('click', () => switchTab('sessions'));
tabSettingsBtn.addEventListener('click', () => switchTab('settings'));

document.getElementById('btn-create')!.addEventListener('click', () => {
  void call({ type: 'CREATE_GROUP' });
});

document.getElementById('btn-add')!.addEventListener('click', () => {
  void call({ type: 'ADD_TAB_TO_GROUP' });
});

document.getElementById('btn-rename')!.addEventListener('click', () => {
  const group = activeGroup();
  if (!group) return;
  void call({
    type: 'RENAME_GROUP',
    groupId: group.id,
    name: groupNameInput.value,
  });
});

groupNameInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const group = activeGroup();
  if (!group) return;
  void call({
    type: 'RENAME_GROUP',
    groupId: group.id,
    name: groupNameInput.value,
  });
});

let deleteGroupArmed = false;
let deleteGroupTimer = 0;
document.getElementById('btn-delete-group')!.addEventListener('click', () => {
  const group = activeGroup();
  if (!group) return;
  const btn = document.getElementById('btn-delete-group') as HTMLButtonElement;
  if (!deleteGroupArmed) {
    deleteGroupArmed = true;
    btn.textContent = 'Точно удалить?';
    deleteGroupTimer = window.setTimeout(() => {
      deleteGroupArmed = false;
      btn.textContent = 'Удалить';
    }, 2500);
    return;
  }
  window.clearTimeout(deleteGroupTimer);
  deleteGroupArmed = false;
  btn.textContent = 'Удалить';
  void call({ type: 'DELETE_GROUP', groupId: group.id });
});

document.getElementById('btn-save-session')!.addEventListener('click', () => {
  void call({
    type: 'SAVE_SESSION',
    name: sessionNameInput.value || undefined,
  });
});

document.getElementById('btn-update-session')!.addEventListener('click', () => {
  const session = activeSession();
  if (!session) {
    showError('Нет активной сессии. Сохраните новую или выберите «Активная».');
    return;
  }
  void call({
    type: 'UPDATE_SESSION',
    sessionId: session.id,
    name: sessionNameInput.value || undefined,
  });
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
    syncMode: syncMode.value as 'pixel' | 'percent' | 'anchor',
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

scrollRange.addEventListener('input', () => {
  scrollPercent.value = scrollRange.value;
});

scrollPercent.addEventListener('input', () => {
  const n = Number(scrollPercent.value);
  if (Number.isFinite(n)) {
    scrollRange.value = String(Math.min(200, Math.max(-100, Math.round(n))));
  }
});

scrollRange.addEventListener('change', () => {
  void applyScrollPercent();
});

document.getElementById('btn-apply-scroll')!.addEventListener('click', () => {
  void applyScrollPercent();
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
  switchTab('groups');
  await call({ type: 'GET_STATE' });
  await loadAdapterStatus();
  await refreshScrollPercent();
}

void boot();
