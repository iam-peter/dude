import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  define: { __DUDE_TEST_HOOKS__: 'false' },
  test: { include: ['tests/**/*.test.ts'] },
});
