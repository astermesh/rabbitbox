# T01: Package Structure & Build Config

**Status:** done

Set up the monorepo with two packages and configure the build toolchain.

## Scope

- Create `packages/rabbit-sbi/` — SBI type definitions package (pure types, zero runtime)
- Create `packages/rabbit-box/` — eng + SBI hooks package
- TypeScript project references between packages
- tsup build config for each package (ESM + CJS dual output)
- Vitest workspace config covering both packages
- ESLint + Prettier config extending root
- Package entry points with proper exports map

## Inputs

- Existing root `package.json` with build toolchain (tsup, vitest, eslint, prettier, typescript)

## Outputs

- `packages/rabbit-sbi/package.json`, `tsconfig.json`, `src/index.ts`
- `packages/rabbit-box/package.json`, `tsconfig.json`, `src/index.ts`
- Root tsconfig project references
- Working `npm run build`, `npm run test`, `npm run lint` from root

## Key Constraints

- Both packages must be pure TypeScript with zero native dependencies (cross-platform requirement)
- rabbit-box depends on rabbit-sbi; rabbit-sbi has no internal dependencies

---

[← Back](../README.md)
