import { createGenericAdapter } from './generic';
import {
  SiteAdapter,
  pickScrollContainer,
  progressFromElement,
  setProgressOnElement,
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

  return {
    id: 'ficbook',
    label: 'Фикбук',
    isReady() {
      return true;
    },
    getProgress() {
      const container = resolveContainer();
      if (
        container &&
        container !== document.scrollingElement &&
        container.scrollHeight > container.clientHeight + 4
      ) {
        return progressFromElement(container);
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
