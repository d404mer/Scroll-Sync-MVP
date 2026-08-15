import {
  SiteAdapter,
  clamp01,
  pickScrollContainer,
  progressFromElement,
  setProgressOnElement,
  scrollTopFromElement,
  setScrollTopOnElement,
} from './types';

const DOCS_SELECTORS = [
  '.kix-appview-editor',
  '#docs-editor',
  '#docs-editor-container',
  '.docs-editor-container',
  '.kix-rotate-center',
  '.docs-texteventtarget-iframe',
];

// todo: docs часто меняет вёрстку - селекторы периодически отваливаются
function findDocsScrollContainer(): HTMLElement | null {
  const direct = pickScrollContainer(
    DOCS_SELECTORS.map((sel) => document.querySelector(sel)),
  );
  if (direct) return direct;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.kix-appview-editor, #docs-editor, #docs-editor-container, [role="main"]',
    ),
  );
  for (const el of candidates) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      el.scrollHeight > el.clientHeight + 4
    ) {
      return el;
    }
  }

  const editor = document.querySelector('.kix-appview-editor');
  if (editor) {
    let node: HTMLElement | null = editor.parentElement;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 4) {
        return node;
      }
      node = node.parentElement;
    }
  }

  return null;
}

export function createGoogleDocsAdapter(): SiteAdapter {
  let cached: HTMLElement | null | undefined;
  let cachedAt = 0;

  function container(): HTMLElement | null {
    const stale = performance.now() - cachedAt > 2000;
    if (
      stale ||
      cached === undefined ||
      (cached !== null && !document.contains(cached))
    ) {
      cached = findDocsScrollContainer();
      cachedAt = performance.now();
    }
    return cached ?? null;
  }

  return {
    id: 'googleDocs',
    label: 'Google Docs',
    get detail() {
      return container()
        ? 'Контейнер скролла найден'
        : 'Docs: контейнер скролла не найден';
    },
    isReady() {
      return container() !== null;
    },
    getProgress() {
      const el = container();
      if (!el) return 0;
      return progressFromElement(el);
    },
    setProgress(progress: number) {
      const el = container();
      if (!el) return;
      setProgressOnElement(el, clamp01(progress));
    },
    getScrollTop() {
      const el = container();
      if (!el) return 0;
      return scrollTopFromElement(el);
    },
    setScrollTop(y: number) {
      const el = container();
      if (!el) return;
      setScrollTopOnElement(el, y);
    },
  };
}
