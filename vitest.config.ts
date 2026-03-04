import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ============================================================================
// Timeouts
// ============================================================================

type TimeoutConfig = {
  testTimeout: number;
  hookTimeout: number;
};

const timeoutConfig = {
  unit: (): TimeoutConfig => ({
    testTimeout: 30_000,
    hookTimeout: 30_000,
  }),
  integration: (): TimeoutConfig => ({
    testTimeout: 60_000,
    hookTimeout: 60_000,
  }),
  e2e: (): TimeoutConfig => ({
    testTimeout: 120_000,
    hookTimeout: 120_000,
  }),
};

// ============================================================================
// Test patterns
// ============================================================================

// Naming conventions:
//   *.test.ts        — unit test (default)
//   *.db.test.ts     — database integration test
//   *.io.test.ts     — I/O integration test (network, file system)
//   *.api.test.ts    — API integration test
//   *.e2e.test.ts    — end-to-end test

type SearchConfig = {
  include?: string[];
  exclude?: string[];
};

const patterns = {
  all: ['src/**/*.test.ts'],
  integration: [
    'src/**/*.db.test.ts',
    'src/**/*.io.test.ts',
    'src/**/*.api.test.ts',
  ],
  e2e: ['src/**/*.e2e.test.ts'],
  serverOnly: ['src/**/*.io.test.ts'],
};

const include = (p: string[]): SearchConfig => ({ include: p });

const minus = (
  config: SearchConfig,
  excludePatterns: string[]
): Required<SearchConfig> => ({
  include: config.include ?? [],
  exclude: [...(config.exclude ?? []), ...excludePatterns],
});

const searchConfig = {
  all: (): SearchConfig => include(patterns.all),
  integration: (): SearchConfig =>
    minus(include(patterns.integration), patterns.e2e),
  e2e: (): SearchConfig => include(patterns.e2e),
  unit: (): SearchConfig =>
    minus(searchConfig.all(), [...patterns.integration, ...patterns.e2e]),
  browser: (config: SearchConfig): SearchConfig =>
    minus(config, patterns.serverOnly),
};

// ============================================================================
// Run configs
// ============================================================================

type RunConfig = {
  browser?: {
    enabled: boolean;
    provider: ReturnType<typeof playwright>;
    headless: boolean;
    instances: { browser: 'chromium' }[];
  };
  pool?: 'forks';
};

const runConfig = {
  browser: (name: string): RunConfig => ({
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' as const }],
    },
  }),
  server: (): RunConfig => ({
    pool: 'forks',
  }),
};

// Suppress unused parameter warning — name reserved for future use
void runConfig.browser.length;

// ============================================================================
// Project config
// ============================================================================

type ProjectConfig = {
  resolve: { alias: Record<string, string> };
};

const baseResolve = {
  alias: { '@': resolve(__dirname, 'src') },
};

const projectConfig = {
  server: (): ProjectConfig => ({
    resolve: baseResolve,
  }),
  browser: (): ProjectConfig => ({
    resolve: baseResolve,
  }),
};

// ============================================================================
// Project factory
// ============================================================================

function project(
  name: string,
  projectCfg: ProjectConfig,
  searchCfg: SearchConfig,
  timeoutCfg: TimeoutConfig,
  runCfg: RunConfig
) {
  return {
    ...projectCfg,
    test: {
      name,
      ...searchCfg,
      ...timeoutCfg,
      ...runCfg,
    },
  };
}

// ============================================================================
// Projects
// ============================================================================

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
    projects: [
      // Unit tests
      project(
        'node:unit',
        projectConfig.server(),
        searchConfig.unit(),
        timeoutConfig.unit(),
        runConfig.server()
      ),
      project(
        'bun:unit',
        projectConfig.server(),
        searchConfig.unit(),
        timeoutConfig.unit(),
        runConfig.server()
      ),
      project(
        'deno:unit',
        projectConfig.server(),
        searchConfig.unit(),
        timeoutConfig.unit(),
        runConfig.server()
      ),
      project(
        'browser:unit',
        projectConfig.browser(),
        searchConfig.browser(searchConfig.unit()),
        timeoutConfig.unit(),
        runConfig.browser('unit')
      ),

      // Integration tests
      project(
        'node:integration',
        projectConfig.server(),
        searchConfig.integration(),
        timeoutConfig.integration(),
        runConfig.server()
      ),
      project(
        'bun:integration',
        projectConfig.server(),
        searchConfig.integration(),
        timeoutConfig.integration(),
        runConfig.server()
      ),
      project(
        'deno:integration',
        projectConfig.server(),
        searchConfig.integration(),
        timeoutConfig.integration(),
        runConfig.server()
      ),
      project(
        'browser:integration',
        projectConfig.browser(),
        searchConfig.browser(searchConfig.integration()),
        timeoutConfig.integration(),
        runConfig.browser('integration')
      ),

      // E2E tests
      project(
        'node:e2e',
        projectConfig.server(),
        searchConfig.e2e(),
        timeoutConfig.e2e(),
        runConfig.server()
      ),
      project(
        'bun:e2e',
        projectConfig.server(),
        searchConfig.e2e(),
        timeoutConfig.e2e(),
        runConfig.server()
      ),
      project(
        'deno:e2e',
        projectConfig.server(),
        searchConfig.e2e(),
        timeoutConfig.e2e(),
        runConfig.server()
      ),
      project(
        'browser:e2e',
        projectConfig.browser(),
        searchConfig.browser(searchConfig.e2e()),
        timeoutConfig.e2e(),
        runConfig.browser('e2e')
      ),
    ],
  },
});
