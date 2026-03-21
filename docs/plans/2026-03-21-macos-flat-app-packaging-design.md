# macOS Flat App Packaging Design

**Problem**

The current stable macOS release path depends on Electrobun's self-extractor wrapper. In practice this makes first launch slow and opaque, and it has already been mistaken for launch failure. The application bundle itself can run, but the release artifact is fronted by an extra decompression step that is not acceptable as the default install path.

**Decision**

Ship a flat macOS `.app` bundle and a conventional `.dmg`, and stop treating the Electrobun self-extractor as the macOS release artifact.

The app bundle itself remains built by Electrobun. We only replace the final packaging and distribution layer.

**Recommended Approach**

Keep the existing app build and sidecar build, then add a custom macOS packaging script that:

1. takes the flat built `.app`
2. copies it into a clean staging directory
3. creates a standard `.zip`
4. creates a standard `.dmg`
5. writes those outputs to `artifacts/`

This avoids depending on the self-extracting stable wrapper while preserving the current runtime and asset layout.

**Why This Approach**

- avoids the self-extractor startup tax completely
- produces conventional macOS artifacts users already understand
- keeps build risk low because runtime packaging is already working
- limits the change to the publish layer, not app internals

**Architecture**

Build pipeline becomes:

1. prepare native deps
2. build Python sidecar
3. build renderer assets
4. build flat macOS app bundle
5. package flat `.app` into:
   - `.app.zip`
   - `.dmg`

The package step should not depend on update tarballs, self-extraction metadata, or the stable wrapper executable.

**Artifact Contract**

Final distributable artifacts:

- `artifacts/stable-macos-arm64-KnowDisk.app.zip`
- `artifacts/stable-macos-arm64-KnowDisk.dmg`

Optional non-distribution intermediate:

- `build/stable-macos-arm64/Know Disk.app`

Not a release artifact anymore:

- `*.app.tar.zst`
- self-extractor `.app`
- updater-oriented self-extraction cache behavior

**Implementation Shape**

Add a dedicated script, likely `scripts/package-macos-flat-app.ts`, that:

- receives app path, output directory, artifact stem, and volume name
- recreates `artifacts/`
- creates a `.zip` from the flat `.app`
- creates a `.dmg` from the flat `.app`
- returns output paths for logging

The packaging command should be explicit and deterministic. No hidden dependence on prior extractor state.

**Runtime Expectation**

Double-clicking the produced `.app` or the `.app` copied from the `.dmg` should:

- immediately launch the real bundle
- show the app window without a self-extraction prelude
- start the Python sidecar through the bundled standalone executable

**Testing Strategy**

Automated checks:

- packaging script creates expected `.zip` and `.dmg`
- packaging script fails clearly if flat `.app` is missing
- `package.json` build command points to the flat packaging flow

Manual checks:

- run `build:prod`
- open `build/stable-macos-arm64/Know Disk.app`
- mount generated `.dmg`
- open app copied from mounted image
- verify renderer and Python worker both start

**Constraints**

- first version only targets macOS
- no signing or notarization in this change
- no updater integration in this change
- no new release channel semantics

**Out of Scope**

- auto-update support from flat artifacts
- Windows and Linux packaging changes
- signing and notarization workflows
- Electrobun upstream fixes to the self-extractor
