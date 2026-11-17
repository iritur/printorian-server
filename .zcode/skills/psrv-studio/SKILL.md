---
name: psrv-studio
description: The router for the printorian-server harness — the map of psrv agents, skills, workflows and memories; how to choose the orchestration; workflow arguments; binding owner rules; the app-repo boundary; and the bounded-auditor token contract. Read before dispatching work here or editing a workflow.
---

# The printorian-server studio

## 1. Map

| Kind | Name | Path |
|---|---|---|
| Role agents | `psrv-planner` … `psrv-doc-writer` | `.zcode/agents/psrv-*.md` (9) |
| Knowledge | build (real packages) | `.zcode/skills/psrv-build/SKILL.md` |
| Knowledge | decided questions | `.zcode/skills/psrv-decisions/SKILL.md` |
| Knowledge | verification discipline | `.zcode/skills/psrv-testing/SKILL.md` |
| Knowledge | this router | `.zcode/skills/psrv-studio/SKILL.md` |
| Knowledge | memory format | `.zcode/skills/psrv-memory-writer/SKILL.md` |
| Workflow | single gated change | `.zcode/workflows/psrv-gated-change.dwf.ts` |
| Workflow | package pipeline (build → repo → verify) | `.zcode/workflows/psrv-package-pipeline.dwf.ts` |
| Memory | charter (verbatim) | `.zcode/memories/psrv-charter.md` |
| Memory | archive index | `.zcode/memories/MEMORY.md` |

Launch with `CreateWorkflow`, `saved` source; repair with
`AmendWorkflow`/`ResumeWorkflowRun`.

## 2. Choosing the orchestration

| Request | Orchestration |
|---|---|
| Build/package/repo-add one thing end to end | `psrv-package-pipeline` |
| One scoped change (a tool, a config, a doc set) | `psrv-gated-change` |
| A multi-task effort (probe + tools + first packages) | `psrv-gated-change` per task now; grow a studio orchestrator when the repo has ≥3 parallelizable tracks |
| A question / upstream research | `psrv-researcher` |
| Kernel/scheduler/fs/security design | `psrv-architect` (with measurement plans) |
| "Are the docs still true?" | run the probes/tools and compare — a docs-audit workflow can be ported from the app repo when there is enough doc to audit |

## 3. Workflow arguments (summary)

- **psrv-package-pipeline**: `package` (required, name), `draft` (default
  true — PKGBUILD is drafted/updated from upstream latest when missing or
  stale), `sign` (default false — signing needs the owner's key; asked via
  hole when true).
- **psrv-gated-change**: `task` (required), `branch`
  (default `zcode/psrv-change`).

Both: preflight surfaces missing tooling (devtools etc.) with the exact
`pacman -S` line for the owner — never installs.

## 4. Binding rules (owner)

1. Never push without approval — origin over SSH
   (`git@github.com:iritur/printorian-server.git`), then the gitverse
   mirror script.
2. Never install or remove system packages; never enable services on the
   host. Chroots and throwaway roots are the sanctioned surface.
3. Real packages, upstream-latest, Python tooling, SSH TUIs, the security
   constraints, measurement discipline (AGENTS.md §1).
4. READY certifies a gate — not permission to push, sign, or install on a
   real host.
5. Ask when deviating (`hole()`/escalation).

## 5. The app-repo boundary

Application work (backend, frontend, docs, deploy) happens in
`../printorian` under its own `printorian-*` harness; its decisions skill
§3 governs the deployment shape there. Server-host work happens here. When
both harnesses meet in one head, `psrv-*` and `printorian-*` names never
collide — keep it that way in future files.

## 6. Token discipline — the bounded-auditor contract

Inherited measured lesson (3.9M tokens lost to an unbounded verifier):
context travels with the ask; findings carry reading lists; one follow-up
maximum; an honest `inconclusive` beats a grind; `webSearch: 0` for
repo-only stages; cheap model (`GLM-5.3-Flash`) for confirmations and
memory writing, never for review or gates; fan out capped (≤12). Keep
these properties when editing the workflows.
