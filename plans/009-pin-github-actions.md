# Plan 009: Pin privileged GitHub Actions to immutable commits

> **Executor instructions**: Follow this plan in order and run every
> verification command. Stop and report instead of improvising when a STOP
> condition occurs. Update this plan's row in `plans/README.md` when done unless
> a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 5ff23b4..HEAD -- .github/workflows/tests.yml .github/workflows/release.yml .github/actions/setup/action.yml .github/dependabot.yml`
> Compare changed in-scope code with the excerpts below. Semantic drift is a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5ff23b4`, 2026-07-22

## Why this matters

Release and coverage jobs grant write or OIDC permissions while invoking
external actions through mutable major tags. Pinning reviewed commits makes
executed workflow content immutable; an updater can still propose explicit
reviewed bumps. No compromise is alleged—this is supply-chain hardening for
privileged paths.

## Current state

- Tests and release use actions/checkout@v7.
- The composite setup uses denoland/setup-deno@v2 and actions/setup-node@v6.
- The OIDC coverage step uses codecov/codecov-action@v7.
- There is no Dependabot configuration for GitHub Actions.

```yaml
# .github/workflows/release.yml:22-35
release:
  permissions:
    contents: write
    issues: write
    pull-requests: write
    id-token: write
  steps:
    - uses: actions/checkout@v7
    - uses: ./.github/actions/setup
```

```yaml
# .github/actions/setup/action.yml:6-13
- uses: denoland/setup-deno@v2
- uses: actions/setup-node@v6
  with:
    node-version: 22
```

```yaml
# .github/workflows/tests.yml:26-32
- name: Upload coverage to Codecov
  uses: codecov/codecov-action@v7
  with:
    use_oidc: true
```

Repository constraints to preserve:

- Resolve tags only from official action repositories and retain the
  human-readable major in a comment.
- Use full 40-character commit SHAs.
- Do not alter permissions, job behavior, runtime versions, or release triggers.
- Never print or persist tokens.

## Commands you will need

| Purpose            | Command                                                                                              | Expected on success                          |
| ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| GitHub auth        | `gh auth status && test "$(gh api rate_limit --jq '.rate.remaining')" -gt 0`                         | authenticated and API quota remains          |
| Immutable-ref scan | `! rg -n --pcre2 '^\s*(?:-\s*)?uses:\s+(?!\./)(?![^@\s]+@[0-9a-f]{40}\s+#\s+v[0-9]+\s*$).+' .github` | no mutable or malformed external `uses` line |
| Workflow diff      | `git diff --check`                                                                                   | no whitespace errors                         |
| Repository gate    | `deno task check`                                                                                    | exit 0                                       |

## Reference material

- [GitHub Actions hardening](https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats)

## Scope

**In scope** (the only files to modify):

- `.github/workflows/tests.yml`
- `.github/workflows/release.yml`
- `.github/actions/setup/action.yml`
- `.github/dependabot.yml`

**Out of scope**:

- Changing workflow permissions or OIDC trust.
- Node/Deno version changes (plan 010).
- Release-tool versions.
- Publishing or dispatching workflows.

**Administrative exception**:

- `plans/README.md` may be modified only to update plan 009's status cell.
- Ignore that one status-cell edit when checking scope cleanliness; any other
  `plans/README.md` change remains out of scope.

## Git workflow

- Branch: `codex/009-pin-github-actions`
- Conventional Commit subject: `chore(ci): pin external actions by commit`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Resolve and verify official reference commits

This step requires outbound access to `api.github.com` and an authenticated
GitHub CLI session. Run `gh auth status` first. If authentication or API access
is unavailable, STOP; do not copy SHAs from search results or third-party pages.

Use this exact Bash function for the three major tags. It resolves a lightweight
tag directly and follows one or more annotated tag objects until the official
GitHub API returns a commit. `denoland/setup-deno` publishes immutable `v2.0.x`
tags but exposes its mutable `v2` major as a branch, so resolve that official
branch separately and subject its target to the same commit verification:

```sh
set -euo pipefail

resolve_tag_commit() {
  local repo="$1" tag="$2" object_type object_sha
  object_type="$(gh api "repos/$repo/git/ref/tags/$tag" --jq '.object.type')"
  object_sha="$(gh api "repos/$repo/git/ref/tags/$tag" --jq '.object.sha')"
  while [ "$object_type" = "tag" ]; do
    object_type="$(gh api "repos/$repo/git/tags/$object_sha" --jq '.object.type')"
    object_sha="$(gh api "repos/$repo/git/tags/$object_sha" --jq '.object.sha')"
  done
  if [ "$object_type" != "commit" ]; then
    printf 'unexpected tag target for %s@%s: %s\n' "$repo" "$tag" "$object_type" >&2
    return 1
  fi
  printf '%s\n' "$object_sha"
}

CHECKOUT_SHA="$(resolve_tag_commit actions/checkout v7)"
NODE_SHA="$(resolve_tag_commit actions/setup-node v6)"
CODECOV_SHA="$(resolve_tag_commit codecov/codecov-action v7)"
DENO_SHA="$(
  gh api "repos/denoland/setup-deno/git/ref/heads/v2" \
    --jq 'select(.object.type == "commit") | .object.sha'
)"

printf '%s\n' "$CHECKOUT_SHA" "$NODE_SHA" "$DENO_SHA" "$CODECOV_SHA" |
  awk 'length($0) != 40 || $0 !~ /^[0-9a-f]+$/ { exit 1 } END { if (NR != 4) exit 1 }'
```

For each resolved SHA, verify that the commit exists in the same official
repository and inspect GitHub's verification object:

```sh
set -euo pipefail

verify_action_commit() {
  local repo="$1" expected_sha="$2" actual_sha verified
  actual_sha="$(gh api "repos/$repo/commits/$expected_sha" --jq '.sha')"
  verified="$(gh api "repos/$repo/commits/$expected_sha" --jq '.commit.verification.verified')"
  if [ "$actual_sha" != "$expected_sha" ]; then
    printf 'commit mismatch for %s: expected %s, got %s\n' "$repo" "$expected_sha" "$actual_sha" >&2
    return 1
  fi
  if [ "$verified" != "true" ]; then
    gh api "repos/$repo/commits/$expected_sha" \
      --jq '{sha,html_url,verification:.commit.verification}' >&2
    printf 'unverified commit for %s@%s\n' "$repo" "$expected_sha" >&2
    return 1
  fi
  gh api "repos/$repo/commits/$expected_sha" \
    --jq '{sha,html_url,verification:.commit.verification}'
}

verify_action_commit actions/checkout "$CHECKOUT_SHA"
verify_action_commit actions/setup-node "$NODE_SHA"
verify_action_commit denoland/setup-deno "$DENO_SHA"
verify_action_commit codecov/codecov-action "$CODECOV_SHA"
```

**Verify**: the resolver/validation block and all four official-repository
verifications exit 0; resolution prints exactly four lowercase 40-character
SHAs, every lookup returns the same SHA from the named official repository, and
every `.commit.verification.verified` value is `true`. A false or missing
verification result is a STOP condition requiring maintainer review, not
permission to choose another unreviewed commit.

### Step 2: Replace every mutable external use

Replace every occurrence, including platform jobs. Retain comments such as # v7
after each SHA. Local ./.github/actions/setup references remain local.

**Verify**:
`! rg -n --pcre2 '^\s*(?:-\s*)?uses:\s+(?!\./)(?![^@\s]+@[0-9a-f]{40}\s+#\s+v[0-9]+\s*$).+' .github`
→ exit 0 with no output. This inverse scan checks every non-local `uses:` line,
not only known `vN`, `main`, or `master` spellings.

### Step 3: Configure reviewed update proposals

Create .github/dependabot.yml version 2 with a weekly github-actions entry
rooted at /. Do not enable automerge.

**Verify**:
`rg -n 'package-ecosystem: "github-actions"|directory: "/"|interval: "weekly"' .github/dependabot.yml`
→ all settings are present

### Step 4: Validate workflow-only changes

Run the scans, diff check, and repository gate without dispatching a workflow.

**Verify**:
`! rg -n --pcre2 '^\s*(?:-\s*)?uses:\s+(?!\./)(?![^@\s]+@[0-9a-f]{40}\s+#\s+v[0-9]+\s*$).+' .github && git diff --check && deno task check`
→ all commands exit 0 and the inverse scan prints nothing.

## Test plan

- Every non-local uses reference is a full SHA.
- Major tags remain visible in comments.
- Dependabot is weekly and github-actions-only.
- Permissions are unchanged.

## Done criteria

- [ ] The exhaustive inverse scan finds no non-local `uses:` reference outside
      the immutable-SHA-plus-major-comment form.
- [ ] All four action families are pinned everywhere.
- [ ] No credential or secret is added.
- [ ] `deno task check` exits 0.
- [ ] Only in-scope files and the optional plan-009 status cell changed; verify
      with `git status --short` and `git diff -- plans/README.md`.
- [ ] `plans/README.md` marks this plan DONE unless the reviewer owns the index.

## STOP conditions

Stop and report if:

- Live behavior or code no longer matches the baseline excerpts.
- A verification fails twice after one focused correction.
- The implementation requires an out-of-scope file.
- A tag cannot be verified as the intended publisher.
- Organization policy requires another updater format.
- A pin requires wider permissions.

## Maintenance notes

- Review automated action bumps like dependency changes.
- Plan 010 must preserve these pins while adding Node inputs.
