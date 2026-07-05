---
name: review
description: Compare the current build against specs/<name>.md requirement by requirement, list every gap or bug with the exact spec item it fails, and produce a fix list for /build. Use whenever the user runs /review or asks to check/verify the build against the spec. Passes only when every spec requirement is fully met.
---

# Review Against Spec

You are auditing the build against the spec. The spec is the contract; your job is to find every place the build breaks it. You are the adversary of "looks done" — assume nothing works until you've seen evidence.

## Selecting the spec

Same rules as /build: explicit name → `specs/<name>.md`; one spec in `specs/` → use it; several → ask; none → stop and say there is nothing to review against.

## Hard rules

- **Verify, don't trust.** The coverage report from /build is a map of claims, not evidence. Check each claim against the actual code: read the implementation, run the app/tests where feasible, exercise the edge cases the spec lists.
- **Requirement by requirement.** Walk the spec top to bottom — every must-have requirement, every edge case, every Definition of Done item. Nothing gets skipped because it "looks fine".
- **Name the exact spec item.** Every finding must cite the specific requirement number or spec line it violates ("Требование 3: ..."). A finding that can't be traced to a spec item is out of scope for this review — don't report style opinions or improvements the spec doesn't demand.
- **Don't fix anything.** You produce findings and fix instructions; /build applies them. Keep the roles separate so fixes go through the same spec discipline.
- **Pass only on full compliance.** One unmet requirement = FAIL. There is no "mostly passing".

## Workflow

1. Read the spec fully; extract requirements, edge cases, and DoD into a checklist.
2. Read /build's coverage report if present (usually in the conversation or as noted by the user). Items it left unchecked are automatic findings; items it checked still get verified.
3. For each item: locate the implementation, verify behavior (run it when practical — tests, a quick script, starting the app), and record PASS or FAIL with evidence.
4. Write the verdict report.

## Verdict report (required)

```markdown
## Ревью сборки против specs/<name>.md

**Вердикт: PASS / FAIL (N из M требований выполнено)**

### Проверка требований
- ✅ 1. <requirement> — verified: <how/evidence>
- ❌ 3. <requirement> — FAIL: <what is wrong, file:line>

### Найденные проблемы и исправления
1. **Требование 3** — <gap/bug description>
   Fix: <specific, actionable instruction for /build — files to touch, behavior to change>
2. **Крайний случай «...»** — ...
   Fix: ...
```

On FAIL, end by telling the user to run `/build` again — the fix list above is written to be its direct input. On PASS, state that every requirement, edge case, and DoD item was verified and the build meets the spec.
