# Dashie Hub add-on — instructions for Claude

## Releasing a new version

**Always use `./scripts/release.sh <version>`. Never bump `config.yaml`/`package.json` by hand.**

The console UI (`dashie-console`) is a separate repo that must be vendored into
`frontend/dashie-console/` for HAOS to serve it (HAOS clones our add-on without
git credentials, so submodules don't work). If you bump the add-on version
without first running `scripts/sync-console.sh`, the new add-on ships with stale
console JS — already happened twice (0.1.34, 0.1.35), wasted a debugging round
on "version updated but UI looks the same."

`scripts/release.sh` enforces the correct sequence:

```bash
./scripts/release.sh 0.1.36           # sync + bump + commit
./scripts/release.sh 0.1.36 --push    # also push to origin main (deploys)
```

It refuses to run on a dirty tree, so the commit it produces contains only the
console sync + version bump.

## Where the console lives

| Path | Purpose |
|------|---------|
| `../dashie-console/` (sibling repo) | Source of truth — edit here |
| `frontend/dashie-console/` (this repo) | Vendored copy served by Express |

The add-on serves `frontend/dashie-console/` via Express at `/`. Anything edited
in `../dashie-console` and committed there is invisible to the add-on until
synced into this repo.

## When to release

- Pure server-side changes (server/, package.json deps): release directly.
- Console-side changes (../dashie-console): commit + push the console repo
  first, then `./scripts/release.sh <version>` here. The release script pulls
  the latest `main` from `../dashie-console` before syncing.
