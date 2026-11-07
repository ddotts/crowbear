# Crowbear agent instructions

Crowbear is a monorepo of independently installable Owlbear Rodeo extensions.
Read [README.md](README.md) for commands and [docs/architecture.md](docs/architecture.md)
for the extension and deployment contract.

## Working conventions

- Read relevant source and applicable nested instructions before editing. Verify
  SDK and tooling behavior against primary documentation linked in the architecture guide.
- Define observable success criteria before implementation. Reproduce unknown
  bugs before selecting a cause, and report uncertainty honestly.
- Keep changes scoped. The shared Dice+ bridge is in `packages/dice-plus`;
  add other shared packages only for demonstrated reuse. Do not add a backend,
  secrets, or runtime configuration speculatively.
- Each extension owns its package, manifest, assets, version, and source under
  `extensions/<slug>/`. Preserve installed manifest URLs across changes.
- Use pnpm and the committed lockfile. Do not hand-edit generated output.
- Validate the affected behavior with focused tests. For UI changes, inspect the
  real rendered result. Before delivery, run `pnpm check`, `pnpm test`,
  `pnpm build`, and `pnpm verify:dist`; reuse valid evidence on unchanged code.
- Use Conventional Commits. Preserve unrelated work. Do not amend, rebase,
  force-push, change remotes, publish, or create PRs without user authorization.
- Questions request answers, not edits. Stop and report when evidence contradicts
  the assigned diagnosis or work exceeds the agreed scope.

## Repository skills

Canonical skills live in `.agents/skills`. `.claude/skills` and `.codex/skills`
contain relative symlinks to those definitions. `CLAUDE.md` links to this file.
Update this table and both sets of symlinks together when changing skills.

| Work                                       | Skill               |
| ------------------------------------------ | ------------------- |
| Add or modify an Owlbear extension         | `owlbear-extension` |
| Documentation and instruction maintenance  | `documentation`     |
| Authorized commits, pushes, or deployments | `delivery`          |
