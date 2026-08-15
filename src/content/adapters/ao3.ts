import { createGenericAdapter } from './generic';
import {
  SiteAdapter,
  pickScrollContainer,
  progressFromElement,
  setProgressOnElement,
  scrollTopFromElement,
  setScrollTopOnElement,
} from './types';

export function createAo3Adapter(): SiteAdapter {
  const fallback = createGenericAdapter('ao3', 'Archive of Our Own');

  function resolveContainer(): HTMLElement | null {
    return pickScrollContainer([
      document.querySelector('#main'),
      document.querySelector('#workskin'),
      document.querySelector('#outer'),
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
    id: 'ao3',
    label: 'Archive of Our Own',
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
