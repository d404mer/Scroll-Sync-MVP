export type SyncMode = 'pixel' | 'percent' | 'anchor';
export type LeaderMode = 'active' | 'fixed';

export interface TabRef {
  tabId: number;
  windowId: number;
  url: string;
  title?: string;
}

export interface Anchor {
  id: string;
  /** 0..1 на момент постановки якоря, ключ - tabId; после рестарта перекладываем через url */
  points: Record<number, number>;
}

export interface Group {
  id: string;
  name: string;
  tabIds: number[];
  /** url вкладок, чтобы после рестарта браузера снова найти их */
  tabUrls: Record<number, string>;
  /** заголовки для списка в popup */
  tabTitles: Record<number, string>;
  /**
   * масштаб скорости по вкладке: 1 = как лидер, 0.5 медленнее, -1 наоборот
   */
  scrollScales: Record<number, number>;
  syncEnabled: boolean;
  syncMode: SyncMode;
  leaderMode: LeaderMode;
  fixedLeaderTabId?: number;
  /** кто последний крутил, если режим «активная вкладка» */
  activeLeaderTabId?: number;
  anchors: Anchor[];
}

export interface SessionMember {
  url: string;
  title: string;
  scrollProgress: number;
  scrollScale: number;
}

export interface SessionAnchor {
  id: string;
  pointsByUrl: Record<string, number>;
}

export interface Session {
  id: string;
  name: string;
  updatedAt: number;
  members: SessionMember[];
  syncMode: SyncMode;
  leaderMode: LeaderMode;
  syncEnabled: boolean;
  anchors: SessionAnchor[];
}

export interface AppState {
  groups: Group[];
  activeGroupId?: string;
  sessions: Session[];
  /** куда пишет автосохранение; без явного «сохранить» сессию сами не плодим */
  activeSessionId?: string;
}

export interface AdapterStatus {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export type MessageType =
  | 'GET_STATE'
  | 'STATE'
  | 'CREATE_GROUP'
  | 'ADD_TAB_TO_GROUP'
  | 'REMOVE_TAB_FROM_GROUP'
  | 'RENAME_GROUP'
  | 'DELETE_GROUP'
  | 'SET_ACTIVE_GROUP'
  | 'TOGGLE_SYNC'
  | 'SET_SYNC_MODE'
  | 'SET_LEADER_MODE'
  | 'SET_FIXED_LEADER'
  | 'ADD_ANCHOR'
  | 'CLEAR_ANCHORS'
  | 'SET_SCROLL_PERCENT'
  | 'SET_TAB_SCROLL_SCALE'
  | 'SAVE_SESSION'
  | 'UPDATE_SESSION'
  | 'OPEN_SESSION'
  | 'DELETE_SESSION'
  | 'SET_ACTIVE_SESSION'
  | 'SCROLL_UPDATE'
  | 'SCROLL_PROGRESS'
  | 'APPLY_SCROLL'
  | 'APPLY_SCROLL_DELTA'
  | 'GET_PROGRESS'
  | 'PROGRESS'
  | 'GET_ADAPTER_STATUS'
  | 'ADAPTER_STATUS'
  | 'ERROR';

export interface BaseMessage {
  type: MessageType;
}

export interface GetStateMessage extends BaseMessage {
  type: 'GET_STATE';
}

export interface StateMessage extends BaseMessage {
  type: 'STATE';
  state: AppState;
}

export interface CreateGroupMessage extends BaseMessage {
  type: 'CREATE_GROUP';
}

export interface AddTabToGroupMessage extends BaseMessage {
  type: 'ADD_TAB_TO_GROUP';
  groupId?: string;
}

export interface RemoveTabFromGroupMessage extends BaseMessage {
  type: 'REMOVE_TAB_FROM_GROUP';
  groupId: string;
  tabId: number;
}

export interface RenameGroupMessage extends BaseMessage {
  type: 'RENAME_GROUP';
  groupId: string;
  name: string;
}

export interface DeleteGroupMessage extends BaseMessage {
  type: 'DELETE_GROUP';
  groupId: string;
}

export interface SetActiveGroupMessage extends BaseMessage {
  type: 'SET_ACTIVE_GROUP';
  groupId: string;
}

export interface SetScrollPercentMessage extends BaseMessage {
  type: 'SET_SCROLL_PERCENT';
  groupId: string;
  /** можно уходить за 0..100 - дальше режет clamp и масштаб вкладок */
  percent: number;
}

export interface SetTabScrollScaleMessage extends BaseMessage {
  type: 'SET_TAB_SCROLL_SCALE';
  groupId: string;
  tabId: number;
  /** 1 = 100%, 0.5 медленнее, отрицательное - зеркалим направление */
  scale: number;
}

export interface ToggleSyncMessage extends BaseMessage {
  type: 'TOGGLE_SYNC';
  groupId?: string;
  enabled?: boolean;
}

export interface SetSyncModeMessage extends BaseMessage {
  type: 'SET_SYNC_MODE';
  groupId: string;
  syncMode: SyncMode;
}

export interface SetLeaderModeMessage extends BaseMessage {
  type: 'SET_LEADER_MODE';
  groupId: string;
  leaderMode: LeaderMode;
}

export interface SetFixedLeaderMessage extends BaseMessage {
  type: 'SET_FIXED_LEADER';
  groupId: string;
  tabId: number;
}

export interface AddAnchorMessage extends BaseMessage {
  type: 'ADD_ANCHOR';
  groupId: string;
}

export interface ClearAnchorsMessage extends BaseMessage {
  type: 'CLEAR_ANCHORS';
  groupId: string;
}

export interface SaveSessionMessage extends BaseMessage {
  type: 'SAVE_SESSION';
  name?: string;
}

export interface UpdateSessionMessage extends BaseMessage {
  type: 'UPDATE_SESSION';
  sessionId: string;
  name?: string;
}

export interface OpenSessionMessage extends BaseMessage {
  type: 'OPEN_SESSION';
  sessionId: string;
}

export interface DeleteSessionMessage extends BaseMessage {
  type: 'DELETE_SESSION';
  sessionId: string;
}

export interface SetActiveSessionMessage extends BaseMessage {
  type: 'SET_ACTIVE_SESSION';
  sessionId: string;
}

export interface ScrollUpdateMessage extends BaseMessage {
  type: 'SCROLL_UPDATE';
  deltaPx: number;
  progress: number;
}

export interface ScrollProgressMessage extends BaseMessage {
  type: 'SCROLL_PROGRESS';
  progress: number;
}

export interface ApplyScrollMessage extends BaseMessage {
  type: 'APPLY_SCROLL';
  progress: number;
}

export interface ApplyScrollDeltaMessage extends BaseMessage {
  type: 'APPLY_SCROLL_DELTA';
  deltaPx: number;
}

export interface GetProgressMessage extends BaseMessage {
  type: 'GET_PROGRESS';
}

export interface ProgressMessage extends BaseMessage {
  type: 'PROGRESS';
  progress: number;
}

export interface GetAdapterStatusMessage extends BaseMessage {
  type: 'GET_ADAPTER_STATUS';
}

export interface AdapterStatusMessage extends BaseMessage {
  type: 'ADAPTER_STATUS';
  status: AdapterStatus;
}

export interface ErrorMessage extends BaseMessage {
  type: 'ERROR';
  error: string;
}

export type ExtensionMessage =
  | GetStateMessage
  | StateMessage
  | CreateGroupMessage
  | AddTabToGroupMessage
  | RemoveTabFromGroupMessage
  | RenameGroupMessage
  | DeleteGroupMessage
  | SetActiveGroupMessage
  | ToggleSyncMessage
  | SetSyncModeMessage
  | SetLeaderModeMessage
  | SetFixedLeaderMessage
  | AddAnchorMessage
  | ClearAnchorsMessage
  | SetScrollPercentMessage
  | SetTabScrollScaleMessage
  | SaveSessionMessage
  | UpdateSessionMessage
  | OpenSessionMessage
  | DeleteSessionMessage
  | SetActiveSessionMessage
  | ScrollUpdateMessage
  | ScrollProgressMessage
  | ApplyScrollMessage
  | ApplyScrollDeltaMessage
  | GetProgressMessage
  | ProgressMessage
  | GetAdapterStatusMessage
  | AdapterStatusMessage
  | ErrorMessage;

export const STORAGE_KEY = 'scrollSyncState';

export function emptyState(): AppState {
  return { groups: [], sessions: [] };
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
