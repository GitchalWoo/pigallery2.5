# Build identity

The admin panel identifies this fork as `pigallery2.5@<short-commit>` and links to [the fork repository](https://github.com/GitchalWoo/pigallery2.5/). A `-dirty` suffix means the build included uncommitted changes or untracked source files. Hover over the version to see the full commit and build date.

`npm run build`, `npm run build-en`, and `npm run build-backend` generate an ignored `build-info.json` in the repository root. Restart the backend after rebuilding to load the new identity. The identity describes the source at build time; changing branches or editing files without rebuilding does not update it.

`npm run create-release` embeds the same metadata in the release's `package.json`, so ZIP and Docker builds retain their identity without needing Git at runtime. Source archives without Git metadata display `pigallery2.5@source`.

The inherited npm package version remains separate from the displayed build identity; `3.6.0-edge` does not identify a release of this fork.
