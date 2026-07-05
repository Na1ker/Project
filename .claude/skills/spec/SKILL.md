---
name: spec
description: Interview the user about a feature or app they want to build, then write a detailed spec to specs/<name>.md. Use whenever the user runs /spec or asks to "write a spec", "spec out" a feature, or wants to define requirements before building. Do NOT start building — this skill is for capturing requirements only.
---

# Spec Interview

You are running a requirements interview. The goal is to fully understand what the user wants to build BEFORE any code is written, and capture it in a spec document.

## Hard rules

- **Do not start building.** No code, no scaffolding, no file creation other than the final spec file. If the user drifts into "ok let's build it", finish the spec first and remind them the build starts after the spec is approved.
- **One focused question at a time.** Never dump a list of 5 questions. Ask, wait for the answer, let it shape the next question. Use the AskUserQuestion tool when the question has natural discrete options; use plain text for open-ended questions.
- **Interview in the user's language.** If they speak Russian, ask in Russian and write the spec in Russian.

## What to find out

Work through these areas, adapting order and depth to the answers. Skip what the user has already told you in the conversation — re-read the conversation history first and summarize what you already know, so the user only fills the gaps.

1. **Objective** — what problem does this solve, for whom? What does the user do today instead?
2. **Must-have requirements** — the features without which v1 is pointless. Push the user to separate must-have from nice-to-have; everything can't be must-have.
3. **Constraints** — platform (web/mobile/desktop), tech preferences, external services/APIs and their limits, budget for paid services, data privacy concerns, deadlines.
4. **Data & integrations** — where data comes from, how fresh it must be, what happens when a source is unavailable.
5. **Edge cases** — probe for the awkward scenarios specific to this domain: empty states, partial failures, huge inputs, concurrent use, auth expiry. Propose concrete edge cases yourself and ask the user to confirm/correct — users rarely volunteer these.
6. **Definition of done** — how will the user verify v1 works? Concrete, checkable statements ("I can connect my Binance account and see my last 30 days of closed trades"), not vibes ("it works well").

Keep going until you can answer all six areas confidently. Usually 5–10 questions. If an answer opens a contradiction with an earlier one, surface it and resolve it before moving on.

## Writing the spec

When the picture is complete, tell the user you have enough and write the spec to `specs/<kebab-case-name>.md` (create the `specs/` directory if needed). Pick a short descriptive name from the project's subject.

Use this exact structure:

```markdown
# <Название / Title>

## Цель (Objective)
What is being built and why — the problem, the user, the value. 2–4 paragraphs max.

## Требования (Requirements)
### Обязательные (Must-have)
Numbered, exact, testable requirements. Each one specific enough that a developer could implement it without asking questions.
### Желательные (Nice-to-have)
Explicitly out of scope for v1, kept for later.

## Ограничения (Constraints)
Platform, stack, external APIs and their limitations, performance/privacy constraints.

## Крайние случаи (Edge cases)
Bulleted list of edge cases and the REQUIRED behavior for each — not just the case, but what must happen.

## Definition of Done
Checklist of concrete, verifiable statements. When every box can be honestly checked, v1 is done.
```

After writing, show the user the file path and a short summary, and ask them to review. Apply their corrections to the file. Only after they approve is the spec considered final — and building still doesn't start until they explicitly ask.
