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

A GitHub Actions workflow builds and pushes the Docker image to GHCR on every push to `main`:
- Triggers on push to `main` (paths: `packages/**`, `Dockerfile`, `.github/workflows/build-image.yml`)
- Tags image as `ghcr.io/<owner>/opencode-router:<version>-main.<sha7>` and `:latest`
- After building, the `trigger-deploy` job dispatches `deploy-opencode-router.yml` in `homelab-apps` via `gh workflow run --field routerImage=<image>` using a `HOMELAB_APPS_PAT` secret
- **CRITICAL: Cross-repo git push cannot work** — `GITHUB_TOKEN` is scoped to the current repo only. Cross-repo writes require either: (a) a fine-grained PAT with "Actions: write" on the target repo, or (b) manual deploy. The old approach (`actions/checkout` + `git push` to homelab-apps) would silently fail.
- **Chosen pattern**: `gh workflow run` dispatch (Option A) or manual `gh workflow run` (Option B) or Renovate PR (Option C). The dispatch requires `HOMELAB_APPS_PAT` secret; if absent, the step prints a manual instruction and exits 0.
- The homelab-apps `deploy-opencode-router.yml` workflow accepts a `routerImage` input, runs `pulumi config set code:routerImage <image>`, then calls the reusable `deploy-to-cluster.yml` workflow.
- **Deployment order**: image must be published first; only then can the homelab Pulumi stack be deployed with a pinned SHA tag

### opencode image: fork required, upstream not usable directly

The router requires a **non-root opencode image** with dev tools and the router plugin baked in. Three options were evaluated:

| Option | User | Size | Usable? |
|---|---|---|---|
| `ghcr.io/anomalyco/opencode:latest` | `root` (UID 0) | ~90MB | ❌ k8s `restricted` PSS rejects root |
| `docker/sandbox-templates:opencode` | `agent` (UID 1000) | ~700MB | ❌ wrong HOME (`/home/agent`), sandbox-only runtime, no plugin |
| `ghcr.io/mrsimpson/opencode` (fork) | `opencode` (UID 1000) | ~232MB | ✅ recommended |

The `mrsimpson/opencode` fork image adds on top of upstream Alpine binary: non-root user, `git bash nodejs npm pnpm python3 jq ripgrep gh bun bd`, router plugin at `/etc/opencode-plugin/`, default config at `/etc/opencode-defaults/`, MCP servers (`@codemcp/knowledge-server`, `@codemcp/skills-server`, `@playwright/cli`), `bind-all-interfaces.cjs` Node.js patch (dev servers bind `0.0.0.0` not `localhost` in k8s), and musl-compiled `librust_pty.so` for bun PTY on Alpine.

**Upgrade strategy**: `upstream-merge.yml` (manual trigger) merges upstream opencode commits, auto-updates `.base-version`, and opens a PR. On merge, `build-opencode-image.yml` rebuilds the fork image, pushes to GHCR, and calls `/api/admin/pull-image` to pre-warm the node cache. `Pulumi.dev.yaml`'s `code:opencodeImage` is updated either via the admin endpoint (`updateConfig: true`) or manually via `gh workflow run deploy-opencode-router.yml --field routerImage=...`.

**`:latest` is intentional**: production uses pinned SHA tags (`1.14.20-main.1d9cc13`) for reproducibility; local dev uses `:latest` for convenience. Both are valid — the image is the fork's own, not a third-party floating tag.

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
<!-- beads-synced: 2026-05-28 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Plan
<!-- beads-phase-id: opencode-router-1.2 -->
### Tasks
<!-- beads-synced: 2026-05-28 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*


## Code
<!-- beads-phase-id: opencode-router-1.3 -->
### Tasks
<!-- beads-synced: 2026-05-28 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-router-1.3.1` Set up bun workspace root (package.json with workspaces: packages/*)
- [x] `opencode-router-1.3.10` Verify: bun run build in packages/app produces dist/ (SPA)
- [x] `opencode-router-1.3.11` Verify: docker build . succeeds and produces a runnable image
- [x] `opencode-router-1.3.12` Add RBAC resources to Pulumi stack (ServiceAccount + Role + RoleBinding for pod management)
- [x] `opencode-router-1.3.13` Add renovate.json to repo root (common config: config:recommended, automerge minor/patch, Friday schedule)
- [x] `opencode-router-1.3.14` Create .github/workflows/build-image.yml — build + push to GHCR on main, auto-update homelab-apps Pulumi.dev.yaml with pinned SHA
- [x] `opencode-router-1.3.15` Review findings: document all issues found during code review
- [x] `opencode-router-1.3.16` Fix: Bun.file() in port-watcher.ts still uses Bun API instead of Node.js fs
- [x] `opencode-router-1.3.17` Fix: plugin/tsconfig.json still references bun-types (breaks DTS build)
- [x] `opencode-router-1.3.18` Fix: Icon component missing style prop in custom UI package
- [x] `opencode-router-1.3.19` Fix: app/bunfig.toml leftover from bun era (unused, misleading)
- [x] `opencode-router-1.3.2` Copy packages/opencode-router → packages/router (update package.json name/deps)
- [x] `opencode-router-1.3.20` Fix: router/Dockerfile is a bun monorepo leftover (old, should be deleted)
- [x] `opencode-router-1.3.21` Fix: comment in pod-manager.ts still mentions bun
- [x] `opencode-router-1.3.22` Fix: mock-k8s.ts activity fetch returns wrong JSON shape (object vs array)
- [x] `opencode-router-1.3.23` Add: dev:mock script to root package.json for zero-config local UI dev
- [x] `opencode-router-1.3.24` Fix: .env.local comment still mentions Bun TLS stack
- [x] `opencode-router-1.3.25` Fix: pod-manager.ts and api.ts load kubeconfig at module init, crashing in MOCK_K8S mode
- [x] `opencode-router-1.3.26` Fix UI theme: replace generic CSS vars with real opencode OC-2 design tokens (colors.css + theme.css)
- [x] `opencode-router-1.3.27` Fix CI: remove broken cross-repo update-homelab job from build-image.yml
- [x] `opencode-router-1.3.3` Copy packages/opencode-router-app → packages/app (update package.json workspace refs)
- [x] `opencode-router-1.3.4` Copy packages/opencode-router-plugin → packages/plugin (use npm @opencode-ai/plugin)
- [x] `opencode-router-1.3.5` Create packages/ui — custom opencode-style UI components (Button, Dialog, TextField, Spinner, Icon, context providers, theme, styles)
- [x] `opencode-router-1.3.6` Rewrite Dockerfile for standalone repo layout (no monorepo workspace COPY)
- [x] `opencode-router-1.3.7` Write scripts/build-image.sh (updated paths, standalone context)
- [x] `opencode-router-1.3.8` Create homelab-apps Pulumi stack at apps/opencode-router/ following aftertouch pattern
- [x] `opencode-router-1.3.9` Verify: bun install at repo root succeeds (all workspace deps resolved)

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

**UI theme / visual parity fixes (verified via Playwright DOM comparison):**

13. **`packages/ui` CSS design system was wrong** — The custom `@opencode-ai/ui` package was created with a generic design system (`--color-bg`, `--color-text`, `--color-primary`, etc.) instead of the real opencode OC-2 tokens (`--background-base`, `--text-base`, `--text-strong`, `--button-primary-base`, etc.). The app's component CSS and inline styles all use OC-2 tokens, so nothing was styled. Fixed by copying `colors.css` (palette) and `theme.css` (semantic tokens with light/dark variants) from the original opencode `packages/ui/src/styles/`.

14. **Component CSS files used wrong variable names** — All 5 component CSS files (`button.css`, `dialog.css`, `text-field.css`, `spinner.css`, `icon.css`) used `--color-primary`, `--color-border`, etc. Rewrote all 5 to use the real OC-2 tokens matching the original opencode component CSS exactly.

15. **`styles/index.css` missing `colors.css` import** — Added `@import "./colors.css" layer(theme)` before `theme.css` (matching original import order). Also added `@import "./utilities.css"` for typography classes.

16. **`styles/tailwind/index.css` missing `@theme` block** — The Tailwind config lacked the `@theme { --*: initial; ... }` block that maps opencode design tokens to Tailwind theme variables (`--font-sans`, `--text-sm`, `--text-base`, shadow variables, etc.). Without this, Tailwind uses its own defaults (16px base font-size) instead of the OC-2 values.

17. **Typography utility classes missing** — The `text-12-regular`, `text-12-medium`, `text-14-medium`, `text-14-regular`, `text-16-medium` classes are defined in the original opencode `styles/utilities.css` but were absent from our package. Added `styles/utilities.css` with these classes. Classes NOT defined in the original (`text-18-medium`, `text-13-*`, `text-11-*`, `text-10-*`) are intentionally left undefined so they inherit from body (13px via `text-12-regular` on `<body>`), exactly matching old app behavior.

18. **`styles/base.css` replaced with full opencode version** — Our original stub had only box-model reset + body rule. Replaced with the full opencode `base.css` which includes the complete Tailwind-style reset (iOS zoom prevention, form element normalization, etc.).

**End-to-end test with real k8s cluster (2026-05-28):**

All flows tested manually with the real homelab k3s cluster (`flinker` node):

19. **Session list loads from k8s** — Router starts, restores pod secrets for running pods, correctly reads PVC annotations to reconstruct session metadata (repoUrl, branch, email, createdAt, description, attachUrl).

20. **Session proxy works** — Subdomain proxy `<hash>.localhost:3002` correctly proxies to the pod's port 4096 via `kubectl port-forward` (dev mode). HTTP 200 returned from pod, full opencode HTML served.

21. **Session detail view** — Clicking a session navigates to `/session/<hash>`, which shows the full conversation thread (messages, shell commands, file diffs) from the running pod via the progress stream API.

22. **Session details dropdown** — "…" button opens/closes inline action panel with "Attach ⌘" (copies `opencode attach` CLI command) and "Beenden" (terminate) buttons.

23. **New session creation** — Filling repo URL + source branch + description and pressing Enter: (a) `POST /api/sessions` creates PVC + pod in k8s, (b) router navigates to `/session/<hash>` showing startup progress steps (Initialisierung, Umgebung konfigurieren, etc.), (c) once pod is ready shows iframe loading `<hash>.localhost:3002/…/session/<sessionId>`.

24. **Idle timeout cleanup** — Router correctly detected the browsed session as idle (last activity > 15min) and deleted its pod with log line `Deleting idle pod opencode-session-02242f165e60 (last activity: ...)`.

25. **Session delete** — `DELETE /api/sessions/<hash>` returns 204, pod enters Terminating state immediately in k8s.

26. **`DEV_VITE_URL`** — Note: when other Vite dev servers are running on ports 5173/5174, the new app dev server allocates 5175+. Update `.env.local` `DEV_VITE_URL` to match if restarting. The value `http://localhost:5173` is the default for a clean environment.

27. **`util._extend` deprecation warning** — Emitted at startup by a third-party dependency (not our code, likely `http-proxy`). Pre-existing, not actionable.

**Known issues (not blocking):**

- `GET /api/user/repos` always returns 401 in local dev — expected, GitHub token not configured in `.env.local` by default.
- `favicon.ico` 404 — router doesn't serve a favicon for the setup UI.
- CSP violation in iframe — the opencode pod sends a strict `Content-Security-Policy` header that blocks some inline scripts. This is a pod-side policy, not a router issue.

**Confirmed clean (no changes needed):**
- All `bun:test` → `vitest`, `mock()` → `vi.fn()`, `mock.module()` → `vi.doMock()` conversions: ✅ correct
- `import.meta.dir` → `import.meta.dirname` in config.test.ts: ✅ correct  
- `Bun.file()` in app test (`app.test.ts`): already converted to `readFileSync` ✅
- Router build: `bun build` → `esbuild` produces correct ESM bundle ✅
- Router dev: `bun --watch` → `tsx --watch` is equivalent ✅
- All 270 tests pass after fixes ✅
- All typechecks pass after fixes ✅
- CI workflow (`.github/workflows/build-image.yml`): builds + pushes to GHCR, then dispatches `deploy-opencode-router.yml` in homelab-apps via `gh workflow run` (requires `HOMELAB_APPS_PAT` secret; gracefully skips if absent) ✅
- Renovate (`renovate.json`): automerge minor/patch, Friday schedule, `rangeStrategy: "pin"` ✅
- homelab-apps Pulumi stack (`homelab-apps/apps/opencode-router/`): 18 tests pass, typechecks clean ✅
- `.gitignore` updated to exclude `.playwright-cli/` ✅

### README

`README.md` added at repo root. Focused on:
- **Intent**: what the router enables (disposable sessions, isolation, pre-configured environments, subdomain routing)
- **Architecture**: browser → router → pods diagram; package breakdown
- **Getting started**: prerequisites table (k8s, storage, wildcard DNS/TLS, opencode image, auth proxy), full env var reference, local dev (mock + real cluster), production deployment
- **CI/CD**: what the `build-image.yml` workflow does and how auto-deploy works
- **Reference to homelab-apps**: links to `homelab-apps/apps/opencode-router` as the canonical production Pulumi stack
- **Choosing an opencode image** section: explains why upstream `anomalyco/opencode` (runs as root, no tools) and Docker sandbox template (`/home/agent` layout, 700MB, sandbox-only) are not suitable; documents the `mrsimpson/opencode` fork image as the recommended choice with its exact value-adds (non-root UID 1000, dev tools, router plugin, MCP servers, bind-all-interfaces patch, musl PTY lib, baked config); documents the upgrade strategy (upstream-merge workflow → PR → CI rebuild → Renovate or workflow dispatch to update Pulumi stack config).

## Commit
<!-- beads-phase-id: opencode-router-1.4 -->
### Tasks
<!-- beads-synced: 2026-05-28 -->
*Auto-synced — do not edit here, use `bd` CLI instead.*

- [x] `opencode-router-1.4.1` Code cleanup: remove debug output, TODOs, commented code
- [x] `opencode-router-1.4.2` Write README.md focused on intent and k8s getting started
- [x] `opencode-router-1.4.3` Final validation: run tests and typecheck
- [x] `opencode-router-1.4.4` Commit all changes in opencode-router and homelab-apps
- [x] `opencode-router-1.4.5` Code cleanup: scan for debug output, TODOs, commented-out code
- [x] `opencode-router-1.4.6` Write README.md focused on intent, getting started, k8s requirements, homelab-apps reference
- [x] `opencode-router-1.4.7` Final validation: run tests and typecheck
- [x] `opencode-router-1.4.8` Commit all changes in opencode-router
- [x] `opencode-router-1.4.9` Commit all changes in homelab-apps
