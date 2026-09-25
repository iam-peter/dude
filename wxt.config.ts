import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'dude',
    description: "Per-tab navigation graphs — an own history next to the browser's",
    permissions: ['webNavigation', 'tabs', 'sessions', 'storage', 'unlimitedStorage', 'alarms', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'dude — where did I come from?' }, // popup: entrypoints/popup
    omnibox: { keyword: 'h' }, // F3: "h <words>" searches the sessions
    commands: {
      // G4: go to the page this one was reached from, whatever the native Back would do
      'semantic-back': { suggested_key: { default: 'Alt+Shift+Up' }, description: 'Go to the page you came here from (semantic back)' },
    },
    // E7: Chrome's history, read only when the user starts an import in the settings.
    ...(browser !== 'firefox' && { optional_permissions: ['history'] }),
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: '{53952834-ba6a-4072-9c32-c836b5a38a3c}',
          strict_min_version: '128.0',
          // Nothing ever leaves the browser (H2).
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
