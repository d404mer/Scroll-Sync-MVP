import { resolveAdapter } from './adapters';
import type { ExtensionMessage } from '../shared/types';
import type { SiteAdapter } from './adapters/types';

const adapter: SiteAdapter = resolveAdapter();
let applying = false;
let applyIgnoreUntil = 0;
let rafScheduled = false;
let lastSent = -1;
const listenedElements = new WeakSet<EventTarget>();

function getProgress(): number {
  try {
    return adapter.getProgress();
  } catch {
    return 0;
  }
}

function setProgress(progress: number): void {
  applying = true;
  applyIgnoreUntil = performance.now() + 180;
  try {
    adapter.setProgress(progress);
  } finally {
    requestAnimationFrame(() => {
      applying = false;
    });
  }
}

function emitProgress(): void {
  if (applying || performance.now() < applyIgnoreUntil) return;
  const progress = getProgress();
  if (Math.abs(progress - lastSent) < 0.0005) return;
  lastSent = progress;
  void chrome.runtime
    .sendMessage({
      type: 'SCROLL_PROGRESS',
      progress,
    } satisfies ExtensionMessage)
    .catch(() => {
      // Extension context invalidated or SW asleep
    });
}

function onScroll(): void {
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    emitProgress();
  });
}

function attachScrollTarget(target: EventTarget | null | undefined): void {
  if (!target || listenedElements.has(target)) return;
  listenedElements.add(target);
  target.addEventListener('scroll', onScroll, { passive: true, capture: true });
}

attachScrollTarget(window);
attachScrollTarget(document);
attachScrollTarget(document.scrollingElement);
attachScrollTarget(document.documentElement);
attachScrollTarget(document.body);

function discoverScrollContainers(): void {
  const selectors = [
    '.kix-appview-editor',
    '#docs-editor',
    '#docs-editor-container',
    '#main',
    '#workskin',
    '#content',
    '.fanfic-body',
    'main',
    '[role="main"]',
  ];
  for (const sel of selectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 4) {
        attachScrollTarget(el);
      }
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 4) {
        if (parent.scrollHeight > parent.clientHeight + 4) {
          attachScrollTarget(parent);
        }
        parent = parent.parentElement;
        depth += 1;
      }
    });
  }
}

discoverScrollContainers();

let discoverTimer = 0;
function scheduleDiscover(): void {
  if (discoverTimer) return;
  discoverTimer = window.setTimeout(() => {
    discoverTimer = 0;
    discoverScrollContainers();
  }, 400);
}

const observer = new MutationObserver(() => {
  scheduleDiscover();
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case 'APPLY_SCROLL':
        setProgress(message.progress);
        lastSent = message.progress;
        sendResponse({ type: 'PROGRESS', progress: message.progress });
        break;

      case 'GET_PROGRESS':
        sendResponse({ type: 'PROGRESS', progress: getProgress() });
        break;

      case 'GET_ADAPTER_STATUS':
        sendResponse({
          type: 'ADAPTER_STATUS',
          status: {
            id: adapter.id,
            label: adapter.label,
            ok: adapter.isReady(),
            detail: adapter.detail,
          },
        });
        break;

      default:
        break;
    }
    return false;
  },
);
