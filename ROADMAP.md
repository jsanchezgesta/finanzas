# Roadmap

## Phase 1 — Tracker and planner (done)

Import, auto-categorization with learned rules, review queue, dashboard (fixed / variable / one-off / investment), recurring-payment detection, zero-based monthly plan, backup/restore, installable PWA.

## Phase 2 — Where can I save?

A new **Ahorro** view that turns the data already collected into concrete, quantified suggestions. Each suggestion shows the yearly saving, the evidence, and a one-tap way to dismiss it or add it to the plan.

Data the analysis already provides: recurring merchants with cadence and amount, monthly spend per category and merchant, 3-month averages, one-off list.

### Detectors

1. **Subscriptions audit.** List every active recurring charge with yearly cost. Flag:
   - overlapping services (two+ streaming, two+ cloud storage, two+ music),
   - price increases (latest charge above the previous ones),
   - charges that stopped being "used" (no related activity), for the user to confirm.
2. **Bills benchmark.** Telecom, electricity, insurance: compare the monthly amount with a reference range the user can edit (e.g. fibra+móvil, luz per kWh). Suggest reviewing when above range, with the yearly difference.
3. **Category creep.** Categories where the last 3 months are clearly above the previous 6 (e.g. delivery +40 %). Show the extra euros per year.
4. **Small frequent spends.** Merchants with many small charges (coffee, delivery, Bizum) whose yearly total is surprisingly large.
5. **Bank fees.** Any comisiones: total per year, and that most of them are avoidable.
6. **Idle cash.** Balance left in current accounts month after month vs. what is planned for savings; suggest moving it to the savings/investment bucket.
7. **Plan adherence.** Categories that go over plan most months: either cut or re-plan honestly.

### Output

- Ranked list by yearly impact; "Aplicar al plan" lowers next month's budget for that category.
- A "potential savings per year" headline, and progress tracked month over month (suggestion accepted → was spend actually lower?).

### Possible later

- Optional LLM pass (user-provided API key, opt-in, sends only merchant names and totals) to explain merchants and suggest cheaper alternatives.
- Shared household view.
