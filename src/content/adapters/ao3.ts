import { createGenericAdapter } from './generic';
import {
  SiteAdapter,
  pickScrollContainer,
  progressFromElement,
  setProgressOnElement,
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

  return {
    id: 'ao3',
    label: 'Archive of Our Own',
    isReady() {
      return true;
    },
    getProgress() {
      const container = resolveContainer();
      if (container && container !== document.scrollingElement) {
        const p = progressFromElement(container);
        // If main is not the scroll root, use window/document
        if (container.scrollHeight > container.clientHeight + 4) return p;
      }
      return fallback.getProgress();
    },
    setProgress(progress: number) {
      const container = resolveContainer();
      if (
        container &&
        container !== document.scrollingElement &&
        container.scrollHeight > container.clientHeight + 4
      ) {
        setProgressOnElement(container, progress);
        return;
      }
      fallback.setProgress(progress);
    },
  };
}
