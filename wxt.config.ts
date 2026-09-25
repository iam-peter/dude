import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'dude',
    description: "Per-tab navigation graphs — an own history next to the browser's",
    permissions: ['webNavigation', 'tabs', 'sessions', 'storage', 'unlimitedStorage'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'dude — where did I come from?' },
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
