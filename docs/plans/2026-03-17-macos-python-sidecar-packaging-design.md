# macOS Python Sidecar Packaging Design

## Goal

Make the packaged macOS app start the Python sidecar without relying on the developer workspace, `process.cwd()`, or a user-installed `uv`/Python toolchain.

## Scope

- Target the macOS packaged app first
- Keep development mode unchanged for now
- Do not solve App Store signing or Windows packaging in this iteration
- Do not auto-download or auto-build the bundled Python runtime in this iteration

## Constraints

- `bun run dev` currently starts the worker with `uv run --project python python -m worker`
- packaged builds currently do not copy `python/` or any Python runtime into the bundle
- the Bun main process currently resolves `pythonProjectDir` with `process.cwd()`, which is only valid in the repo
- packaged builds need a stable app-bundle-relative worker command

## Chosen Approach

Use a dual-mode worker command resolver:

- Development mode:
  - keep using `uv run --project <repo>/python python -m worker`
- Packaged macOS mode:
  - resolve a bundled Python executable plus bundled worker entrypoint from app resources

This requires a build-time staging step that prepares:

- `vendor/python-runtime/...`
- `vendor/python-worker/...`

Then `electrobun.config.ts` copies those staged directories into the packaged app resources.

## Runtime Layout

Packaged app resources should contain:

- `python-runtime/...`
- `python-worker/worker/...`

The Bun runtime will resolve something equivalent to:

- `<resources>/python-runtime/bin/python`
- `<resources>/python-worker/worker/__main__.py`

and spawn:

```bash
<resources>/python-runtime/bin/python <resources>/python-worker/worker/__main__.py
```

It must no longer depend on `uv`, `process.cwd()`, or the source-tree `python/` directory in packaged mode.

## Build Flow

Add a preparation step before `electrobun build`:

1. Copy runtime worker code into `vendor/python-worker`
2. Copy a prebuilt distributable Python runtime into `vendor/python-runtime`
3. Validate expected entrypoints exist before the app build continues

`electrobun.config.ts` should then copy those staged directories into app resources.

## Error Handling

The packaged app should fail explicitly when bundled Python resources are missing:

- missing bundled interpreter: clear startup error
- missing bundled worker entrypoint: clear startup error
- interpreter launch failure: include resolved paths in logs

Development-mode errors should stay explicit as well:

- missing `uv`
- missing repo-local `python/`

## Verification

This iteration should verify:

- the resolver returns the current `uv` command in development mode
- the resolver returns bundled resource paths in packaged mode
- the build preparation step creates the staged runtime directories
- `electrobun` copies those staged directories into the packaged app

Full notarization / App Store validation is out of scope for this step.
