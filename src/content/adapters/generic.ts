import {
  SiteAdapter,
  clamp01,
  progressFromElement,
  setProgressOnElement,
} from './types';

function scrollingElement(): HTMLElement {
  return (document.scrollingElement || document.documentElement) as HTMLElement;
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
      // Prefer element scroll metrics; fall back to window for some layouts
      const fromEl = progressFromElement(el);
      if (fromEl > 0 || el.scrollHeight > el.clientHeight + 4) {
        return fromEl;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return 0;
      return clamp01(window.scrollY / max);
    },
    setProgress(progress: number) {
      const el = scrollingElement();
      if (el.scrollHeight > el.clientHeight + 4) {
        setProgressOnElement(el, progress);
        return;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      window.scrollTo({ top: clamp01(progress) * max, behavior: 'auto' });
    },
  };
}
