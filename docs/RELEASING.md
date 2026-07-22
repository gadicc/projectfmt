# Releasing

Releases are automated by semantic-release from Conventional Commits. A release
publishes the Deno source package to `@gadicc/projectfmt` on JSR, the generated
Deno-to-npm artifact as `projectfmt`, and a GitHub release.

## One-time registry and repository setup

1. Create `gadicc/projectfmt` on GitHub and keep the default release branch as
   `main`.
2. Create `@gadicc/projectfmt` on JSR and link it to the GitHub repository.
   Linked GitHub Actions publishing uses OIDC and creates provenance.
3. Create or claim `projectfmt` on npm. Configure its GitHub Actions trusted
   publisher with user `gadicc`, repository `projectfmt`, workflow filename
   `release.yml`, and the `npm publish` allowed action. Keep the repository and
   package public so npm can attach provenance.
4. Install the Codecov GitHub App for `gadicc/projectfmt` and enable the
   repository in Codecov. Coverage uploads authenticate with GitHub OIDC, so do
   not create a `CODECOV_TOKEN` secret.
5. Protect `main` and require the Tests workflow.

No long-lived npm or JSR token is expected. GitHub's generated `GITHUB_TOKEN` is
used for release notes, comments, and the GitHub release.

## Release flow

The release workflow runs all checks, coverage, Deno/Node package smoke tests,
and the npm build before semantic-release. semantic-release determines the next
version, updates the JSR and npm artifact versions, publishes both registries,
and creates the GitHub release.

Test the artifacts locally without publishing:

```sh
deno task test:jsr
deno task build:npm
deno task test:npm
```

Never hand-edit generated files under `npm/` or commit that directory.
