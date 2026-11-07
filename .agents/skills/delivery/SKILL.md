---

name: delivery
description: Validate and deliver an authorized Crowbear commit, push, or extension deployment while preserving the requested scope.
---

Inspect branch, worktree, staged diff, remotes, and outgoing commits. Preserve
unrelated changes and exclude secrets, dependencies, and generated dist files.
Use the documentation skill to audit durable documentation impact.

Reuse valid checks for the same code and inputs. Before initial delivery or a
deployment, require pnpm check, pnpm test, pnpm build, and pnpm verify:dist.
For smaller subsequent commits, use the checks that prove the affected contract.
Inspect rendered extension changes at the manifest's popover size.

Stage explicit paths and create one scoped Conventional Commit when authorized.
Push only to the authorized remote and verify the remote SHA. Do not amend,
rebase, force-push, or create a PR without explicit authorization.

Deployment uses the manual Deploy extensions workflow on main and requires
separate authorization from a push. Verify the workflow conclusion and hosted
manifest and its referenced assets. Report the install URL and distinguish
hosting verification from testing in an authenticated Owlbear room. Stop on a
failed check or deployment; investigate before retrying.
