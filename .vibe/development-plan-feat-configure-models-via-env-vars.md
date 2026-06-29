# opencode-router: Capability-aware model selection via env vars

## Goal

Use the codemcp workflows **capability routing** feature to control which model the LLM uses for each phase of any codemcp workflows workflow (e.g. `explore` / `plan` / `code` / `commit` in the `epcc` workflow) by setting three environment variables on the opencode-router pod:

- `OPENCODE_MODEL_THINKING` — model ID for the `thinking` capability
- `OPENCODE_MODEL_CODING` — model ID for the `coding` capability
- `OPENCODE_MODEL_RESEARCH` — model ID for the `research` capability

The vars can be set in two places (per-user Secret takes precedence over the router Deployment when both are set).

The pod's init script runs `npx @codemcp/workflows setup capabilities opencode` to render the per-capability agent files (`.opencode/agents/<capability>.md`) and the `capability_models` map in `.vibe/config.yaml`. The codemcp workflows feature then injects a "Capability hint" into the LLM prompt. The wizard is a no-op when none of the three env vars are set, and a wizard failure is non-fatal — opencode still starts, but the LLM won't receive a capability hint.

## Result

### Files changed

| File | Change |
| --- | --- |
| `packages/router/src/config.ts` | 3 new optional env-var fields (`modelThinking`, `modelCoding`, `modelResearch`) |
| `packages/router/src/config.test.ts` | 7 new tests for the 3 config fields |
| `packages/router/src/pod-manager.ts` | Inject the 3 env vars into the main container's `env` and the init container's `env`; mirror the main container's `envFrom` (cluster API-key Secret + per-session github Secret + per-user Secret) onto the init container; load the capability-routing sub-script from `scripts/opencode-init.sh` and inline it into the pod's init script |
| `packages/router/src/pod-manager.test.ts` | New `describe.sequential` block: 15 tests covering env injection in main+init, envFrom mirroring, the rendered init script containing the .sh-file content, `dash -n` POSIX-sh compatibility, the 3 stderr log lines, the absence of the `-p js-yaml` workaround, and a behavioral test that runs the .sh file with mock env vars and asserts the wizard argv (including a value with spaces) |
| `packages/router/src/scripts/opencode-init.sh` | **New file** — the capability-routing sub-script. Standalone POSIX sh file; inlined into the pod's init script by `pod-manager.ts` |
| `packages/router/package.json` | Build script now copies `src/scripts/opencode-init.sh` to `dist/scripts/opencode-init.sh` so the bundled code can find it via `import.meta.url` |
| `README.md` | Feature bullet + 3 env-var table rows |
| `packages/router/docs/deployment.md` | 3 env-var table rows + new "Capability-aware model selection" subsection (Deployment vs per-user Secret, phase→capability mapping example, Pulumi config example) |

### Final rendered init-script block

The init script inlines `packages/router/src/scripts/opencode-init.sh`. The full file (including `#` header documentation) is at that path; the body is:

```sh
if [ -n "$OPENCODE_MODEL_THINKING$OPENCODE_MODEL_CODING$OPENCODE_MODEL_RESEARCH" ]; then
  cd /workspace
  set --
  [ -n "$OPENCODE_MODEL_THINKING" ] && set -- "$@" --model-thinking "$OPENCODE_MODEL_THINKING"
  [ -n "$OPENCODE_MODEL_CODING" ]  && set -- "$@" --model-coding "$OPENCODE_MODEL_CODING"
  [ -n "$OPENCODE_MODEL_RESEARCH" ] && set -- "$@" --model-research "$OPENCODE_MODEL_RESEARCH"
  echo "opencode-init: configuring capabilities (thinking=${OPENCODE_MODEL_THINKING}, coding=${OPENCODE_MODEL_CODING}, research=${OPENCODE_MODEL_RESEARCH})" >&2
  if npx -y @codemcp/workflows setup capabilities opencode "$@" --force; then
    echo "opencode-init: capability setup complete" >&2
  else
    rc=$?
    echo "opencode-init: capability setup FAILED (exit=$rc); opencode will still start, but the LLM will not receive a capability hint" >&2
  fi
  cd /
fi
```

### Validation

- `pnpm run -r typecheck` — clean
- `pnpm run -r test` — **324/324 tests pass** (268 router + 13 plugin + 43 app)
- `pnpm --filter @opencode-ai/router build` — succeeds; `dist/scripts/opencode-init.sh` exists alongside the bundled router
- `dash -n packages/router/src/scripts/opencode-init.sh` — passes (POSIX sh syntax)
- Behavioral test: runs the .sh file in `dash` with a stub `npx` and `OPENCODE_MODEL_CODING=claude-sonnet with space`; asserts the wizard receives 13 argv elements with the value preserved as a single element (no word-splitting on IFS)
- End-to-end with real `dash` and real `npx`: model ID `anthropic/Claude Sonnet 4.6` (contains spaces) preserved as a single argv element; wizard writes `.opencode/agents/{thinking,coding,research}.md` and `.vibe/config.yaml` with the `capability_models` map; pre-invocation, success, and failure log lines emitted to stderr
- Confirmed working in the user's cluster

## Design decisions

### D1. Use the existing codemcp workflows wizard at pod startup

The wizard `npx @codemcp/workflows setup capabilities opencode` already does exactly what's needed: it takes `--model-thinking X --model-coding Y --model-research Z` and renders the per-capability agent files plus the `.vibe/config.yaml` `capability_models` map. Re-implementing this logic in the router would duplicate work and create a maintenance burden. Running the wizard from the pod's init script makes the router the configuration surface, not the implementation.

### D2. Env vars can be set on the router Deployment or in a per-user Secret

Operators want cluster-wide defaults; users want personal overrides. The router mirrors the main container's `envFrom` onto the init container, so the wizard sees `OPENCODE_MODEL_*` from any of the three env-var sources (deployment env, cluster API-key Secret, per-user Secret). Kubernetes's "last-wins" semantics give per-user Secrets precedence over the Deployment when both are set.

### D3. Output is `.opencode/agents/*.md` + `.vibe/config.yaml`; the wizard runs from `/workspace`

The wizard writes files relative to the current working directory, so the init script `cd /workspace` before invoking it. The wizard also supports `--force` to overwrite existing agent files — necessary because the init script runs on every pod start.

### D4. Skip the wizard when no env vars are set; failure is non-fatal

When all three env vars are unset, the wizard is a no-op (the `if [ -n ... ]; then ... fi` guard is false). When the wizard fails (e.g. no network for `npx`), the failure log line is emitted but opencode still starts — the pod's main container is unaffected.

### D5. Capability hint is delegated to the codemcp workflows feature

The mapping from workflow phase to capability (e.g. `explore` → `research`, `plan` → `thinking`, `code` → `coding`, `commit` → unset in the `epcc` workflow) is defined in each workflow's YAML, not in the router. The router only provides the per-capability model IDs; each workflow decides which model to use for which phase.

### D6. POSIX-sh compatible init script (dash, not bash)

The init container's `command` is `sh -c <initScript>`, and `sh` is `dash` on Debian-based images. Bash-only constructs (`WIZARD_ARGS=()` arrays, `${ARR[@]}` expansion, `[[ ]]`) would fail with `syntax error: unexpected "("`. Instead the script builds a positional-parameter list with `set -- "$@" --flag "$VAR"` and passes it to the wizard via `"$@"` — this preserves model IDs that contain spaces (or other shell metacharacters) as a single argv element when expanded by the wizard's `parseFlag()`.

### D7. Mirror the main container's `envFrom` onto the init container

The init script is a separate container with its own `env`/`envFrom` blocks; Kubernetes does not propagate these from the main container. The init container must explicitly list every `envFrom` source so the wizard sees the same env vars the main container sees — otherwise the `if [ -n ... ]` guard is always false (the env vars are only injected into the main container) and the wizard is never invoked.

### D8. Stderr log lines for pre-invocation, success, and failure (skip is silent)

Operators need to confirm the wizard ran (or debug why it didn't) via `kubectl logs <pod> -c init`. The pre-invocation log lists the env vars seen; the success log confirms the wizard wrote its files; the failure log captures `rc=$?` so the operator sees the wizard's exit code. The "skipped" case (no env vars set) is silent by design — it's the common path for deployments that don't use capability routing, and a log line on every pod start would be noise.

## Commit

- Branch: `feat/configure-models-via-env-vars` — 1 squashed commit (`801f0d0`)
- 327 tests pass across all packages (271 router + 13 plugin + 43 app)
- Build succeeds; `dist/scripts/opencode-init.sh` ships alongside the bundled router
- Per-user Secret values injected via `env:` after Deployment defaults — last-wins gives per-user precedence
- Wizard block runs after git clone/init so `/workspace` is a valid repo
- Shebang stripped from the .sh file at load time (inlined into `sh -c`)
- PR creation blocked by invalid `gh` token — open manually at:
  https://github.com/mrsimpson/opencode-router/compare/main...feat/configure-models-via-env-vars?expand=1
