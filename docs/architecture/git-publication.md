# Git publication and releases

## Decision

Public source changes are ordinary human-reviewed Git commits on `main`. GitHub receives those
commits directly, preserving their parentage and normal contributor history. AI rollback history
lives in a separate local checkpoint store, excluded from the public repository.

The SVN export and synthetic `commit-tree` publication workflow has been removed. SVN can still
record the local project and its private maintainer tools, but GitHub releases do not read SVN or
depend on an SVN revision. Existing public commits and version tags remain intact.

## Behavior

1. Run the project checks, then review and commit the public changes through the normal Git dialog.
2. Push `main` through the installed pre-push check.
3. For a release, the version in the committed `package.json` must match a new `vX.Y.Z` tag.
4. The maintainer release command requires clean Git state on `main`, the expected GitHub remote
   and a commit that includes the current remote tip. It checks the outgoing history and runs the
   project checks before pushing that exact existing commit and tagging it.
5. GitHub Actions builds Windows, macOS and Linux artifacts, checks the Windows and Linux update
   feeds, and assembles a draft with checksums. The command publishes it only after the build succeeds.

The release command creates no source commit, rewrites no history and never force-pushes. If the
source changes during local validation, it stops before publishing. An existing tag is refused.

## Public content boundary

`.gitignore` excludes local checkpoints, AI worktrees, private maintainer tools, AI documents,
credentials, generated builds and workout logs. The pre-push check reads Git objects directly and
checks every outgoing commit, including files removed again before the final commit. It rejects
private paths, internal identifiers, links and submodules, and runs gitleaks over the same history.
It does not materialize a checkout or change the Git index.

For a new remote ref the check scans all reachable history. For an existing ref it scans the range
from the advertised remote commit to the pushed commit and requires a forward update. The remote
base must be available locally; fetch and integrate remote changes before retrying a refusal.

## Entry points and constraints

- `.gitignore`: public file exclusions.
- `.github/workflows/ci.yml`: source checks and the server-side secret scan.
- `.github/workflows/release.yml`: native packaging, feed checks and draft assets.
- `scripts/set-version.mjs` and `scripts/check-release-version.mjs`: version identity.
- The internal publication runbook owns maintainer commands and hook installation.

The pre-push hook is installed locally and requires gitleaks. GitHub's scan runs after a push and
cannot replace it. Ordinary Git clones retain the public CI and tag-triggered builds; internal
maintainer tools and checkpoint history are not distributed with them.

## Verification

The migration passed `pnpm run check` with all 101 application tests. The public checker passed
18 path/content/secret fixtures and scanned the existing public history. An isolated Git fixture
verified that private files and secrets are rejected even when deleted in a later outgoing commit,
that backward updates are rejected, and that new refs scan their full history.

Ten release scenarios using simulated CLI responses covered the normal sequence, wrong branch,
dirty source, failed Git status, an existing tag, diverged history, source changes during validation,
failed source checks, a rejected public check and a failed native build. All rejected preparations
stopped before push/tag creation, and a failed build did not publish the release.
