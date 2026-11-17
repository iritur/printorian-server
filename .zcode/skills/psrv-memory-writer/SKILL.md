---
name: psrv-memory-writer
description: The format and rules for printorian-server's .zcode/memories archive — when to write, the exact template, indexing, commit discipline, and the HANDOFF.md protocol once that file exists. Use when a session learned something the next session should not re-learn the hard way.
---

# Writing memory records

The archive at `.zcode/memories/` is this repo's measured history:
environment facts, upstream findings, incidents, disproven theories,
owner decisions that are not yet charter amendments. It is **historical** —
it explains rules, never proves current behavior.

## 1. When to write

Write when: an environment fact was measured (network reachability, tool
behavior, kernel quirks); an upstream fact was established (release,
deprecation, hash discipline); a build or packaging trap was hit and fixed
(these are the most valuable records); an owner decision was made that the
charter does not yet carry; a hardware measurement landed with its numbers.

Do not write when: routine work; the fact is already in the charter or a
skill (link it only when the archive needs it for context); a record
already covers it — **extend with a dated section, never fork**.

## 2. Template (exact)

```markdown
---
name: psrv-<topic>
description: "One dense sentence with the numbers/dates/hosts a search would key on."
metadata:
  node_type: memory
  type: project
---

**Why:** <the general lesson>

**How to apply:** <imperative guidance>

<dated evidence sections; disproven theories listed explicitly>
Cross-reference with [[psrv-other-memory]].
```

Rules: the `description` is a search snippet (dates, numbers, versions,
host names in it); every fact carries its source (command, URL, commit);
10–40 lines is the archive's voice; disproven theories are mandatory —
they are most of the archive's value.

## 3. Indexing

One dense row in `.zcode/memories/MEMORY.md`, newest last:

```markdown
- [Title](psrv-<topic>.md) — one line with the dates/numbers/verdicts.
```

## 4. HANDOFF.md protocol (once it exists)

Until a HANDOFF.md is created, the charter memory is the state of record.
When created (first studio run is a good moment): dated
`## YYYY-MM-DD — title` sections near the top, an **As of:** line (branch,
base commit), what was done and verified how, what is deliberately
unfinished, what needs a person. A stale handoff is worse than none — it
is read as current.

## 5. Committing

Memory changes commit in the main checkout, subject `memory: <topic>`;
never pushed (they ride with the owner's next approved push, after which
the mirror script replicates them to gitverse).
