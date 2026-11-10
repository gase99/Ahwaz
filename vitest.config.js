import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^sdk\/db$/,
        replacement: path.resolve(__dirname, 'tests/helpers/mock-sdk-db.js'),
      },
      {
        find: /^sdk$/,
        replacement: path.resolve(__dirname, 'tests/helpers/mock-sdk.js'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
