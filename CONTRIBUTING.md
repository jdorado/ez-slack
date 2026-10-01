# Contributing

Read AGENTS.md and [the core plugin author guide](https://github.com/jdorado/ez-agents/blob/main/docs/plugin-guide.md). The native engine owns reasoning and history; Slack owns provider events and receipts; this plugin owns credentials and deterministic channel transport. Core owns authorization, private scopes, cancellation and native session binding. Keep one standard application-channel path.

1. Inspect status, ignored files, worktrees and open PRs. Preserve unrelated work. Create one focused branch/worktree from fetched main for active edits.
2. State the user outcome, at most five binding constraints, owning component, smallest path, real proof and stop condition. Prefer an existing contract or subtraction.
3. Use Node 22+ and pnpm 10.30.3. Run `pnpm install --frozen-lockfile`, `pnpm verify`, `npm run release:check` and `git diff --check`. Keep `pnpm-lock.yaml` and `docker/pnpm-lock.yaml` identical.
4. Commit, push and open a PR before installing a QA candidate. Run `pnpm smoke:docker` through the real manager from the exact clean PR commit. Source candidates use an increasing `X.Y.Z-beta.N.rc.M` version; never overwrite a version or artifact.
5. Obtain one independent human or agent final-head review and green CI. Inspect correctness, ownership, credentials, negative authority cases and uncertain writes. Fix material findings in the same PR and refresh affected evidence.
6. Verify one authorized installed-plugin/native-agent exchange and its matching provider receipt. Routine tests use synthetic channels and accounts. Health alone is not delivery proof. Never put credentials or conversation dumps in public evidence.
7. Merge under the owner's authorized task, verify merged source identity, preserve evidence in its owning development record and remove the clean task worktree. The remote PR and branch are the handoff while editing is inactive.

A product-change request authorizes the normal fix, PR and merge loop. Public repository visibility, npm publication and live external messages need their corresponding owner authority. Installation permission alone does not authorize contacting another person.

## Public source and package publication

Public GitHub source remains distinct from npm publication and catalog listing. Before making source public, audit the complete Git history, PR evidence and packed file list for private state or credentials; verify license notices, production dependency advisories, required CI and the source-installation instructions. Enable private vulnerability reporting after visibility changes and read back public access.

The package currently remains local/source-installed. Do not claim an npm release, Marketplace distribution or a public catalog capability. Initial registry publication follows [core release checks](https://github.com/jdorado/ez-agents/blob/main/docs/releasing.md): reviewed version and manifest, changelog, exact tarball/checksum, clean-host installation, independently reviewed source, green CI, authenticated publisher/2FA, registry download and GitHub release readback. Publication is separate from changing GitHub visibility. Trusted publishing can be enrolled only after the real initial package exists; see [the trusted publisher contract](https://github.com/jdorado/ez-agents/blob/main/docs/trusted-publishing.md).

Report bugs with the installed version, sanitized reproduction and expected/actual behavior. Security reports follow SECURITY.md. Never replay an uncertain admission or provider send to obtain a passing smoke. Preserve private volumes on uninstall; revoke the core binding and Slack app separately when access must end.

Managed usage snippet: unnecessary. Installed help and the Slack skill own the bounded command contract. Revisit this decision when command usage changes.
