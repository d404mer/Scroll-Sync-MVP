import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Scroll Sync',
  version: '0.2.0',
  description:
    'Синхронный скролл между вкладками и окнами для перевода (AO3, Фикбук, Google Docs и любые другие страницы).',
  permissions: ['storage', 'tabs', 'scripting'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Scroll Sync',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  commands: {
    'toggle-sync': {
      suggested_key: {
        default: 'Alt+Shift+S',
      },
      description: 'Вкл/выкл синхронизацию активной группы',
    },
    'create-group': {
      suggested_key: {
        default: 'Alt+Shift+G',
      },
      description: 'Создать группу из текущей вкладки',
    },
    'add-tab-to-group': {
      suggested_key: {
        default: 'Alt+Shift+A',
      },
      description: 'Добавить текущую вкладку в активную группу',
    },
  },
});
