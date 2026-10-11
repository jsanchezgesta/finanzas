# Finanzas

Personal finance tracker and planner. You import your bank exports; the app categorizes, learns, and shows where the money goes.

- **Local-first.** Data lives in your browser (IndexedDB). No server, no account, no bank connection.
- **Installs on your phone** as an app (PWA) and works offline.
- **No build step, no dependencies.** Plain HTML, CSS and JavaScript modules. Hosted on GitHub Pages.

## What it does

**Import.** Drop one or more CSV / XLS / XLSX exports. Column detection handles Spanish banks (preamble rows, `1.234,56` amounts, `dd/mm/yyyy` dates, separate cargo/abono columns, Windows-1252 encoding). The column mapping is saved per file format, so the second import from the same bank is one click. Overlapping exports are fine: duplicates are detected and skipped.

**Trade Republic.** TR's transaction export (web app → Perfil → Transacciones → Exportar) is recognized automatically and deduplicated by transaction id. Interest, savings plans, buys/sells, Saveback, round-ups, dividends and fees are categorized without review; card payments get a category suggestion from their merchant code (MCC). FX fees and dividend withholding are netted into the cash amount.

**Categorize.** Every merchant is normalized ("COMPRA TARJ. 5402XXXX MERCADONA BARCELONA 12/10" → `mercadona`).
- Known merchant (you confirmed it before) → categorized automatically.
- New merchant → goes to **Revisar**, one card per merchant with a suggested category. One tap (or Enter) confirms every transaction of that merchant and saves a rule. Keyboard: `Enter` accept, `1–9` pick, `S` skip, `Z` undo.
- Money moving between your own accounts (same amount out of one, into another within 4 days) is suggested as a transfer and excluded from spending.

**Analyze.** Each expense is classified as:
- **Fijo recurrente** — same merchant on a regular cadence (weekly → yearly) with a stable amount, or a fixed-type category (rent, utilities).
- **Variable habitual** — day-to-day spending (groceries, transport, eating out).
- **Puntual** — occasional or large (above a threshold you set, default 150 €).
- **Inversión y ahorro** — anything in a saving/investment category.

The dashboard shows income, spending, invested amount and savings rate; a 12-month trend; spend by category vs. your 3-month average; detected recurring payments with next expected date and yearly cost; one-off purchases; top merchants; and a 50/30/20 read-out.

**Inversión.** Contributions per month (own money, round-ups, Saveback), interest and dividends earned, and positions per asset (shares, invested, approximate value at the last price seen in your exports). A Saveback tracker shows this month's TR card spend against the 1,500 € cap, the Saveback you're generating, whether your savings plans meet the 50 €/month condition, and how much Saveback you left on the table by paying with other banks' cards. Saveback terms are editable in Ajustes.

**Viajes.** A trip has dates, a total budget and optional budgets per category. Expenses inside the dates are assigned automatically, except fixed bills, income, investments and merchants you use regularly at home (those are suggested instead, unless paid in a foreign currency). Flights and hotels booked up to 4 months earlier, and foreign-currency payments near the dates, appear as one-tap suggestions. The trip view shows budget vs spent, daily spend vs the daily budget, a projection while the trip is ongoing, and spend per category against its budget. Any movement can be moved in or out of a trip from its detail sheet.

**Plan.** Zero-based monthly budget: expected income, then every euro assigned, savings first. Prefills from your 3-month average, shows plan vs. actual per category.

## Run locally

```bash
npm start            # serves on http://localhost:5173 (or any static server)
npm test             # unit tests (Node 20+, no install needed)
```

`samples/` has two example exports (CaixaBank-style and Trade Republic-style) to try the import. Or press "Probar con datos de ejemplo".

## Deploy

Push to `main`. The GitHub Actions workflow runs the tests and publishes the site to GitHub Pages. First time: repo **Settings → Pages → Source: GitHub Actions**.

On your phone, open the Pages URL and use "Add to Home Screen".

## Your data

Everything stays in the browser where you use the app. Phone and laptop each have their own copy; use **Ajustes → Descargar copia / Restaurar copia** to move data between them, and download a backup now and then (clearing browser data deletes it).

## Code map

| File | What it does |
|---|---|
| `js/parse.js` | CSV parsing, number/date parsing, header and column detection |
| `js/importer.js` | File reading (Excel via SheetJS, loaded on demand), dedupe, import/undo |
| `js/merchant.js` | Description → merchant key |
| `js/categorize.js` | Rules, keyword suggestions, transfer pairing, review queue |
| `js/analysis.js` | Recurring detection, spend nature, monthly aggregates |
| `js/tr.js`, `js/mcc.js` | Trade Republic export reader, MCC → category |
| `js/invest.js` | Investment summary, positions, Saveback status |
| `js/trips.js` | Trip assignment, summaries and suggestions |
| `js/defaults.js` | Default categories and keyword hints |
| `js/store.js` | State and persistence (IndexedDB) |
| `js/views/*` | Resumen, Movimientos, Revisar, Plan, Viajes, Inversión, Importar, Ajustes |

See [ROADMAP.md](ROADMAP.md) for phase 2 (finding savings).
