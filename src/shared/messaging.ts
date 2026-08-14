import type { ExtensionMessage } from './types';

export function sendRuntimeMessage<T extends ExtensionMessage = ExtensionMessage>(
  message: ExtensionMessage,
): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export async function sendTabMessage<T extends ExtensionMessage = ExtensionMessage>(
  tabId: number,
  message: ExtensionMessage,
): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return undefined;
  }
}
