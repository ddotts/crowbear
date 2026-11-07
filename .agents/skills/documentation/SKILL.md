---

name: documentation
description: Maintain Crowbear documentation, shared agent instructions, and repository skill routing when their documented contracts change.
---

Keep user commands in README.md and technical contracts in docs/architecture.md.
Read the changed source before updating its documentation. Store each durable
fact once and link to it rather than duplicating it across instruction files.

AGENTS.md is the shared instruction source; CLAUDE.md points to it. Keep canonical
skills in .agents/skills and expose the same definitions through relative links
in .claude/skills and .codex/skills. Update the AGENTS.md routing table whenever
a skill is added, renamed, or removed. Check changed links, symlinks, and commands.
Do not create handoff journals or documentation describing an obvious diff.
