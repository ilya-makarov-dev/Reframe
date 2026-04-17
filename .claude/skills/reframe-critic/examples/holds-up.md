# Example: scene holds up

Clean scene, all scores acceptable. 1-line response, no pool to critique.

## Trigger

User types:
```
review the pricing page
```

## Step 1 — inspect

```ts
reframe_inspect({ sceneId: "s13", includeSemantic: true })
```

Result:

```
audit: all ok (0 fails, 1 warn-level non-blocking)
aesthetic: {
  alignment: 0.91, whitespace: 0.87, balance: 0.82,
  harmony: 0.93, hierarchy: 0.84, rhythm: 0.88,
  readability: 0.89, proportion: 0.79,
  overall: 0.88
}
brandFidelity: 0.94
```

## Step 2 — rank pool

- Audit fails: 0 ✅
- brandFidelity < 0.8: no (0.94) ✅
- Aesthetic scores < 0.7: none (lowest is proportion 0.79, above threshold) ✅
- Slop signatures: none detected ✅

**Pool is empty** → Mode 1 "holds up".

## Step 3 — output

```
Holds up. Harmony 0.93, brandFidelity 0.94, rhythm 0.88. Proportion at 0.79
is slightly below ideal (hero slightly taller than usual relative to scene)
but within tolerance — taste call, not a must-fix. Ship.
```

## Commentary

- **Cites 3 metrics** (harmony, brandFidelity, rhythm) to show the critic actually read the numbers
- **Acknowledges the one low-ish score** (proportion 0.79) so the user knows it wasn't ignored
- **Classifies it as a taste call** rather than a must-fix — that's the critic being honest instead of inventing urgency
- **Ships with "Ship."** — terminates the response cleanly; user doesn't expect a follow-up

## What the critic did NOT do

- Invent an issue to seem useful
- Restate the audit (no fails, so nothing to restate)
- Suggest a redesign
- Close with "want me to apply?" — nothing to apply

This is the cheapest critic response. User spends 10 seconds reading, feels confident, ships.
