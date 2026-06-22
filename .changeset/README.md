# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets).

To record a change before merging, run:

```bash
npm run changeset
```

Select `patch`, `minor`, or `major`, describe the change, then commit the generated `.md` file alongside your PR.

On merge to `main`, the release GitHub Action opens (or updates) a "Version Skills" PR. Merging that PR bumps `package.json` version, updates `CHANGELOG.md`, and creates a git tag.
