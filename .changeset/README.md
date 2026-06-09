# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

The three published packages are a **fixed** group: they always version and
publish together at the same version, mirroring the previous `just release` flow.
`typsten` (the private wasm crate) and the demo are ignored.

## Workflow

1. In a PR, run `bun run changeset` (or `just changeset`) and describe the
   change. This writes a markdown file here; commit it with your PR.
2. When PRs land on `main`, the **Release** workflow opens (or updates) a
   "Version Packages" PR that bumps versions and updates changelogs.
3. Merging that PR publishes the packages to npm.

See [Adding a changeset](https://github.com/changesets/changesets/blob/main/docs/adding-a-changeset.md).
