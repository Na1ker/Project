---
name: build
description: Read a spec from specs/<name>.md and build exactly what it describes — nothing more. Use whenever the user runs /build or asks to implement/build a previously written spec. Not for freeform feature requests that have no spec; point the user to /spec first in that case.
---

# Build From Spec

You are implementing a spec, not improvising a product. The spec is the single source of truth for this task.

## Selecting the spec

- If the user passed a name (e.g. `/build trade-tracker`), read `specs/<name>.md`.
- If not, list `specs/`. Exactly one spec → use it. Several → ask which one. None → stop and tell the user to run `/spec` first; do not build from conversation memory.

## Hard rules

- **Build exactly what the spec says.** Every must-have requirement gets implemented; nothing that isn't in the spec gets added. No bonus features, no "while I'm here" improvements, no invented requirements — even obvious-seeming ones. If something feels missing, that's a spec gap, not an invitation to improvise.
- **Don't refactor unrelated code.** Touch only what the spec's requirements demand. Existing code that works stays as it is, even if you'd write it differently.
- **Nice-to-have sections are out of scope.** They exist in the spec precisely to mark what NOT to build in v1.
- **Spec gaps and contradictions**: if a requirement is ambiguous or two requirements conflict, ask the user (AskUserQuestion) rather than guessing — a wrong guess here silently violates the spec. For trivially small gaps with one sensible answer, pick it and note the decision in your final report.

## Workflow

1. Read the spec fully. Extract the numbered must-have requirements, constraints, edge cases, and Definition of Done into a task list (TaskCreate) so nothing gets lost during a long build.
2. Implement requirement by requirement, respecting the constraints section (stack, platform, APIs). Handle every edge case listed in the spec with the behavior the spec requires.
3. Verify against the Definition of Done: run the code/tests and check each DoD item honestly. An item you couldn't verify stays unchecked — say so rather than claiming it.

## Coverage report (required)

Finish with a coverage report so the review step can check the work against the spec. Use this exact structure:

```markdown
## Отчёт о покрытии спеки: specs/<name>.md

### Требования
- [x] 1. <requirement> — <where implemented: files/entry points>
- [ ] 4. <requirement> — NOT covered: <reason>

### Крайние случаи
- [x] <edge case> — <how handled>

### Definition of Done
- [x] <DoD item> — <how verified>
- [ ] <DoD item> — not verified: <reason>

### Решения при пробелах в спеке
- <gap> → <decision taken>
```

Every requirement from the spec must appear in the report, checked or not. An honest unchecked box is fine; a silently missing requirement is not.
