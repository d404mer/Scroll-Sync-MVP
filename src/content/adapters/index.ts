import { createAo3Adapter } from './ao3';
import { createFicbookAdapter } from './ficbook';
import { createGenericAdapter } from './generic';
import { createGoogleDocsAdapter } from './googleDocs';
import type { SiteAdapter } from './types';

export function resolveAdapter(hostname = location.hostname): SiteAdapter {
  const host = hostname.toLowerCase();

  if (host === 'archiveofourown.org' || host.endsWith('.archiveofourown.org')) {
    return createAo3Adapter();
  }

  if (host === 'ficbook.net' || host.endsWith('.ficbook.net')) {
    return createFicbookAdapter();
  }

  if (
    host === 'docs.google.com' ||
    host.endsWith('.docs.google.com')
  ) {
    return createGoogleDocsAdapter();
  }

  return createGenericAdapter();
}

export type { SiteAdapter };
