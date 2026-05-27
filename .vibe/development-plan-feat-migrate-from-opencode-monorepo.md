# Development Plan: opencode-router (feat/migrate-from-opencode-monorepo branch)

*Generated on 2026-05-27 by Vibe Feature MCP*
*Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)*

## Goal

Move three packages from the opencode monorepo fork (`~/projects/open-source/opencode`) into this standalone repository (`opencode-router`):

1. **`opencode-router`** — the Node.js HTTP/WebSocket reverse proxy (Kubernetes pod manager)
2. **`opencode-router-app`** — the SolidJS SPA frontend (session management UI)
3. **`opencode-router-plugin`** — the opencode plugin that pushes events from pod → router

Additionally, move the **homelab Pulumi deployment** (currently in `packages/opencode-router/scripts/`) into the `../homelab-apps` repository as a new app stack.

## Key Decisions

### CRITICAL: `@opencode-ai/ui` dependency

`opencode-router-app` uses `@opencode-ai/ui` extensively — it is a **workspace-only** package from the opencode monorepo and is **NOT published to npm** (404 on the registry).

Components used:
- `Button`, `Dialog`, `TextField`, `Icon`, `Spinner` — UI primitives
- `ThemeProvider`, `DialogProvider`, `I18nProvider`, `useDialog`, `useI18n` — context/providers
- CSS styles: `@opencode-ai/ui/styles` and `@opencode-ai/ui/styles/tailwind`
- Only **1 icon** used (`trash`) via `<Icon name="trash" />`

**Decision**: Create **custom, self-contained UI components** that replicate the opencode visual style using the same CSS custom properties (`--button-primary-base`, `--text-strong`, etc.). This is cleaner than copying the entire 8.5 MB UI package — we only need a handful of components.

The custom `packages/ui/` package will contain:
- `button.tsx` + `button.css` — wraps `@kobalte/core/button`, same data-attribute API
- `dialog.tsx` + `dialog.css` — wraps `@kobalte/core/dialog`, same slot structure
- `text-field.tsx` + `text-field.css` — wraps `@kobalte/core/text-field`
- `spinner.tsx` — SVG spinner with exact same pulse animation
- `icon.tsx` — minimal icon map containing only the icons actually used (`trash`)
- `icon-button.tsx` — used internally by dialog close button
- `context/i18n.tsx` — `I18nProvider` + `useI18n` (pure SolidJS context, no external deps)
- `context/dialog.tsx` — `DialogProvider` + `useDialog` (depends on `@kobalte/core/dialog`)
- `theme/context.tsx` — `ThemeProvider` (simplified: supports oc-2 default theme CSS variables only; no multi-theme switching needed for the router app)
- `styles/index.css` — imports `base.css`, `theme.css`, `animations.css`, `button.css`, `dialog.css`, `text-field.css`, `spinner.css`, `icon.css`
- `styles/tailwind` — re-exports tailwind CSS layer config
- `styles/base.css` — box-model reset + base typography
- `styles/theme.css` — CSS custom property definitions (fonts, radii, shadows, spacing)
- `styles/animations.css` — `pulse-opacity`, `pulse-opacity-dim`, `fadeUp` keyframes
- `styles/colors.css` — the OC-2 default theme color tokens

### `@opencode-ai/plugin` dependency

`opencode-router-plugin` uses `import type { Plugin } from "@opencode-ai/plugin"` — type-only import.
✅ **`@opencode-ai/plugin` IS published to npm** (latest: v1.15.11). Use it as a regular devDependency.

### `@opencode-ai/sdk` dependency

✅ **`@opencode-ai/sdk` IS published to npm** (latest: v1.15.11). Use it as a regular devDependency (it is a peer/dev dep of the plugin package).

### Dockerfile

The current Dockerfile references the full opencode monorepo workspace structure (30+ `COPY` lines for unrelated packages). It must be rewritten for the standalone repo layout.

### Build system

**Decision**: Use `pnpm` workspaces (not bun). The monorepo used bun, but pnpm is more standard and avoids needing bun in CI/Docker.
- Root: `pnpm-workspace.yaml` with `packages/*`
- Router build: `esbuild` (bundles to single file for Docker)
- Router dev: `tsx --watch` (no bun needed)
- Tests: `vitest` (replaces `bun:test` completely)
- All `bun-types` and `bun:test` references removed from all packages
- Test conversion: `bun:test` → `vitest`, `mock()` → `vi.fn()`, `mock.module()` → `vi.doMock()`, `Bun.file()` → `fs.readFileSync()`, `import.meta.dir` → `import.meta.dirname`

### CI: Build and publish image

A GitHub Actions workflow must be created to build and push the Docker image to GHCR on every push to `main`. The existing workflow in the opencode monorepo (`build-opencode-router.yml`) is the reference:
- Triggers on push to `main` (paths: `packages/**`, `Dockerfile`, `.github/workflows/build-image.yml`)
- Tags image as `ghcr.io/<owner>/opencode-router:<version>-main.<sha7>` and `:latest`
- After building, automatically updates `Pulumi.dev.yaml` in `homelab-apps/apps/opencode-router/` with the new image tag (via a commit back to the repo — or via a cross-repo dispatch to homelab-apps)
- **Deployment order**: image must be published first; only then can the homelab Pulumi stack be deployed with a pinned SHA tag

### Renovate

Add `renovate.json` to the repo root using the **common config** pattern from other personal repos:
- `"extends": ["config:recommended"]`
- automerge for minor/patch
- schedule: before 10am on Friday (matching `pianobuddy` pattern)
- `rangeStrategy: "pin"`, `dependencyDashboard: true`
- semantic commits enabled

## Notes

### Source locations
- Router: `~/projects/open-source/opencode/packages/opencode-router/`
- App: `~/projects/open-source/opencode/packages/opencode-router-app/`
- Plugin: `~/projects/open-source/opencode/packages/opencode-router-plugin/`
- UI (dependency): `~/projects/open-source/opencode/packages/ui/`
- Plugin type (dependency): `~/projects/open-source/opencode/packages/plugin/`

### Target repo structure (opencode-router)
```
packages/
  router/         ← opencode-router source (renamed from opencode-router)
  app/            ← opencode-router-app source (renamed from opencode-router-app)
  plugin/         ← opencode-router-plugin source (renamed from opencode-router-plugin)
  ui/             ← new custom UI package (opencode-style components, no monorepo dep)
    src/
      button.tsx + button.css
      dialog.tsx + dialog.css
      text-field.tsx + text-field.css
      spinner.tsx + spinner.css
      icon.tsx + icon.css
      icon-button.tsx + icon-button.css
      context/
        i18n.tsx
        dialog.tsx
        index.ts
      theme/
        context.tsx
      styles/
        index.css
        base.css
        theme.css
        animations.css
        colors.css
        tailwind/  (tailwind layer config)
    package.json  (name: "@opencode-ai/ui", exports map matching original)
Dockerfile        ← rewritten for standalone layout
package.json      ← bun workspace root
scripts/
  build-image.sh
  create-local-kubeconfig.sh (if applicable)
  port-forward-pod.sh (if applicable)
```

### homelab-apps migration — Pulumi Stack

**Source**: `~/projects/open-source/opencode/deployment/homelab/` — a fully production-ready Pulumi stack already exists! It is **NOT a scratch implementation** — we move it wholesale.

**Target**: `~/projects/privat/homelab-apps/apps/opencode-router/`

**Decision**: Move the entire `deployment/homelab/` stack into `homelab-apps/apps/opencode-router/` with minimal changes:
- Rename `package.json` name from `@opencode-ai/homelab` → `@homelab-apps/opencode-router`
- Keep `APP_NAME = "code"` (domain resolves to `code.<domain>` = `code.no-panic.org` via homelabStack)
- Stack uses `createExposedWebApp` with `auth: AuthType.OAUTH2_PROXY, oauth2Proxy: { group: "developers" }` — reuses the existing shared oauth2-proxy GitHub app already configured in the homelab
- Full RBAC (ServiceAccount + Role + RoleBinding) already in the stack
- Cloudflare operator sidecar already included (manages session subdomain DNS + IngressRoutes)
- `Pulumi.dev.yaml` has encrypted secrets — keep as-is (already encrypted with Pulumi state)
- `models.ts` and `tests/` copy over unchanged
- Update `@mrsimpson/homelab-core-components` version from `0.1.2` → `^0.2.2` (matching other apps in homelab-apps)

**Deployment order** (important — do NOT deploy before image exists):
1. Merge `opencode-router` repo to `main` → CI builds + publishes image to GHCR
2. CI auto-updates `code:routerImage` in `homelab-apps/apps/opencode-router/Pulumi.dev.yaml` with pinned SHA tag
3. Run `pulumi up` in `homelab-apps/apps/opencode-router/` to deploy



## Explore
<!-- beads-phase-id: opencode-router-1.1 -->
### Tasks

*Tasks managed via `bd` CLI*

## Plan
<!-- beads-phase-id: opencode-router-1.2 -->
### Tasks

*Tasks managed via `bd` CLI*

## Code
<!-- beads-phase-id: opencode-router-1.3 -->
### Tasks

*Tasks managed via `bd` CLI*

### Review Findings & Fixes (2026-05-27)

A thorough review of the migration was performed. Overall the migration is solid — the logic is preserved 1:1, all 270 tests pass, and the Dockerfile is a major improvement over the 30+ COPY-line monorepo version. The de-bunization was done correctly for the production-path code.

**Issues found and fixed:**

1. **`Bun.file()` in `port-watcher.ts`** — The plugin's port-watcher still used `Bun.file(path).text()` instead of Node.js `fs.promises.readFile()`. This is a runtime bug: the pod image runs Node.js, not Bun. Fixed by importing `node:fs` and replacing both calls.

2. **`bun-types` in `plugin/tsconfig.json`** — The plugin's tsconfig still referenced `"types": ["bun-types"]`, which caused the `tsup` DTS build to fail with `Cannot find type definition file for 'bun-types'`. Additionally, removing `bun-types` uncovered that `@types/node` was missing — which provides `console`, `setTimeout`, and other Node.js globals for TypeScript. Fixed by: removing `bun-types`, adding `"types": ["node"]` to tsconfig, and adding `"@types/node": "^22.0.0"` to `devDependencies`. Updated `pnpm-lock.yaml` accordingly.

3. **`Icon` component missing `style` prop** — The custom `@opencode-ai/ui` `Icon` component had a narrow `IconProps` type that didn't extend `ComponentProps<"svg">`. The app's `app.tsx` passes a `style` prop to `<Icon name="trash" style={...} />`, which caused `tsc --noEmit` to fail on the app package. Fixed by extending `Omit<ComponentProps<"svg">, "innerHTML">` in `IconProps` and using `splitProps` to correctly spread remaining props onto the SVG element.

4. **`packages/app/bunfig.toml` leftover** — A bun-era config file for test conditions was still present. It has no effect under vitest/pnpm and is misleading. Deleted.

5. **`packages/router/Dockerfile` leftover** — The router package contained the old bun monorepo Dockerfile (30+ COPY lines for unrelated packages, using `oven/bun:1` base image). It was completely superseded by the root-level `Dockerfile`. Deleted.

6. **Comment in `pod-manager.ts` still mentioned bun** — A code comment referred to "opencode loads it directly via bun". Updated to remove the bun reference.

7. **`plugin/tsconfig.json` included test files** — The plugin's tsconfig included all `src/**/*` files, which included test files with pre-existing TypeScript issues (the `Plugin` type returns optional hooks). This was masked in the original monorepo by bun-types' loose typing. Fixed by adding `"src/**/*.test.ts"` to the exclude list, consistent with how the router package handles it.

**Mock mode fixes (MOCK_K8S=true):**

8. **`mock-k8s.ts` activity fetch wrong JSON shape** — The `_setActivityFetch` mock returned `{ms, sessionId}` (an object) but `podActivityMs()` expects `{id, time:{updated}}[]` (an array). Fixed to return `[]` (empty array), which correctly triggers the `bootstrapPodSession` path for the pre-seeded running session.

9. **Kubeconfig loaded eagerly at module init** — `pod-manager.ts` called `kc.loadFromDefault()` at module evaluation time, before `mock-k8s.ts` could replace the client via `_setApiClient()`. This caused `ENOENT: no such file or directory, open '/tmp/opencode-router-local.kubeconfig'` on every `MOCK_K8S=true` start. **Root cause**: ESM module evaluation order — `mock-k8s.ts` imports `pod-manager.ts` to get `_setApiClient`, which triggers pod-manager's top-level code. **Fix**: Made the k8s client lazy via a `Proxy` — `getK8sApi()` only loads the kubeconfig on first actual k8s call. `_setApiClient()` now sets `_k8sApi` directly, bypassing the loader entirely.

10. **`api.ts` had a dead kubeconfig init** — `api.ts` had its own `kc.loadFromDefault()` + `k8sApi` at the top level that was never used (all k8s calls go through pod-manager functions). Removed this dead code entirely. This also fixes the mock crash for the API path.

11. **`dev:mock` script added to root `package.json`** — `pnpm dev:mock` starts the router with `MOCK_K8S=true`, all required env vars pre-set, and no kubeconfig needed. Start `pnpm dev:app` alongside for full local UI iteration without any cluster.

12. **`.env.local` and `.env.local.example` bun TLS comment removed** — Updated to remove "Bun's TLS stack" reference. Also updated the example's header to document the mock quickstart workflow.

**Confirmed clean (no changes needed):**
- All `bun:test` → `vitest`, `mock()` → `vi.fn()`, `mock.module()` → `vi.doMock()` conversions: ✅ correct
- `import.meta.dir` → `import.meta.dirname` in config.test.ts: ✅ correct  
- `Bun.file()` in app test (`app.test.ts`): already converted to `readFileSync` ✅
- Router build: `bun build` → `esbuild` produces correct ESM bundle ✅
- Router dev: `bun --watch` → `tsx --watch` is equivalent ✅
- All 270 tests pass after fixes ✅
- All typechecks pass after fixes ✅

## Commit
<!-- beads-phase-id: opencode-router-1.4 -->
### Tasks

*Tasks managed via `bd` CLI*



---
*This plan is maintained by the LLM and uses beads CLI for task management. Tool responses provide guidance on which bd commands to use for task management.*
