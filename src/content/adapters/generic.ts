import {
  SiteAdapter,
  clamp01,
  progressFromElement,
  setProgressOnElement,
  scrollTopFromElement,
  setScrollTopOnElement,
} from './types';

function scrollingElement(): HTMLElement {
  return (document.scrollingElement || document.documentElement) as HTMLElement;
}

function usesElementScroll(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight + 4;
}

export function createGenericAdapter(
  id = 'generic',
  label = 'Обычная страница',
): SiteAdapter {
  return {
    id,
    label,
    isReady() {
      return true;
    },
    getProgress() {
      const el = scrollingElement();
      const fromEl = progressFromElement(el);
      if (fromEl > 0 || usesElementScroll(el)) {
        return fromEl;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return 0;
      return clamp01(window.scrollY / max);
    },
    setProgress(progress: number) {
      const el = scrollingElement();
      if (usesElementScroll(el)) {
        setProgressOnElement(el, progress);
        return;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      window.scrollTo({ top: clamp01(progress) * max, behavior: 'auto' });
    },
    getScrollTop() {
      const el = scrollingElement();
      if (usesElementScroll(el)) {
        return scrollTopFromElement(el);
      }
      return window.scrollY;
    },
    setScrollTop(y: number) {
      const el = scrollingElement();
      if (usesElementScroll(el)) {
        setScrollTopOnElement(el, y);
        return;
      }
      const max = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      window.scrollTo({ top: Math.min(max, Math.max(0, y)), behavior: 'auto' });
    },
  };
}
