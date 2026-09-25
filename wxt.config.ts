import fs from 'node:fs';
import { defineConfig } from 'wxt';

// Test hooks (S1/S2 spike tooling, the automation relay, test-only commands) are compiled
// in only with DUDE_TEST_HOOKS=1, into a separate output directory so a test build can
// never be shipped by mistake. Normal builds, dev mode and release zips don't contain them.
const testHooks = process.env.DUDE_TEST_HOOKS === '1';
const TEST_ONLY_ENTRYPOINTS = ['s1'];
const entrypoints = fs.readdirSync('src/entrypoints').map((f) => f.replace(/(\.content)?\.ts$/, ''));

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  outDir: testHooks ? '.output-test' : '.output',
  filterEntrypoints: testHooks ? undefined : entrypoints.filter((e) => !TEST_ONLY_ENTRYPOINTS.includes(e)),
  vite: () => ({ define: { __DUDE_TEST_HOOKS__: JSON.stringify(testHooks) } }),
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
