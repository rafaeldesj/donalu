import { defineConfig } from 'vitest/config';

// Os testes usam emuladores compartilhados: rodam um arquivo por vez.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 40000,
    hookTimeout: 40000
  }
});
