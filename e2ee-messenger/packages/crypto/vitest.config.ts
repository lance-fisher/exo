import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Force CJS version of libsodium-wrappers-sumo (ESM build has missing files)
      'libsodium-wrappers-sumo': path.resolve(
        __dirname,
        '../../node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'
      ),
    },
  },
});
