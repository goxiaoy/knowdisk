# Remove Hugging Face VFS Provider Design

## Scope

Remove the built-in Hugging Face provider from `packages/vfs` only. This includes the provider implementation, built-in registration, direct exports, package-scoped tests, and example app usage.

## Out Of Scope

Do not change Python runtime support, core config types, or any `huggingfaceEndpoint` settings outside `packages/vfs`.

## Approach

Keep `local` as the only built-in VFS provider. Update registry and example expectations accordingly, then delete the Hugging Face provider directory and its package-scoped tests.

## Verification

Run targeted `bun test` commands for the changed `packages/vfs` files after removal.
