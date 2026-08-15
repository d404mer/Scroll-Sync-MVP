import { createGenericAdapter } from './generic';
import {
  SiteAdapter,
  pickScrollContainer,
  progressFromElement,
  setProgressOnElement,
  scrollTopFromElement,
  setScrollTopOnElement,
} from './types';

export function createFicbookAdapter(): SiteAdapter {
  const fallback = createGenericAdapter('ficbook', 'Фикбук');

  function resolveContainer(): HTMLElement | null {
    return pickScrollContainer([
      document.querySelector('#content'),
      document.querySelector('.fanfic-body'),
      document.querySelector('main'),
      document.querySelector('#main'),
      document.scrollingElement,
    ]);
  }

  function useContainer(): HTMLElement | null {
    const container = resolveContainer();
    if (
      container &&
      container !== document.scrollingElement &&
      container.scrollHeight > container.clientHeight + 4
    ) {
      return container;
    }
    return null;
  }

  return {
    id: 'ficbook',
    label: 'Фикбук',
    isReady() {
      return true;
    },
    getProgress() {
      const container = useContainer();
      if (container) return progressFromElement(container);
      return fallback.getProgress();
    },
    setProgress(progress: number) {
      const container = useContainer();
      if (container) {
        setProgressOnElement(container, progress);
        return;
      }
      fallback.setProgress(progress);
    },
    getScrollTop() {
      const container = useContainer();
      if (container) return scrollTopFromElement(container);
      return fallback.getScrollTop();
    },
    setScrollTop(y: number) {
      const container = useContainer();
      if (container) {
        setScrollTopOnElement(container, y);
        return;
      }
      fallback.setScrollTop(y);
    },
  };
}
