# jev-product-compliance

> Five calibrated compliance judgments per product, one million products for about $59. Measured numbers and the extrapolation are in [BENCHMARK.md](BENCHMARK.md); raw verdicts from the runs are in [`results/`](results/).

Test harness that screens a store's product catalog for goods that are **illegal or problematic to sell in a given country**, using TypeSafe AI's **Jev** evaluation model (`typesafe-ai/jev`) through the Vercel AI Gateway.

Jev is not a chat model. It takes one shared *state* (the product + market context) and a set of *typed questions*, and returns calibrated probabilities, a choice, and a score in a single ~200 ms call at $0.042 per million input tokens. That makes it a good fit for bulk screening: 20 products cost about $0.0012 at list price.

## Setup

```bash
pnpm install
cp .env.example .env      # paste a Vercel AI Gateway key (starts with vck_)
```

Create a key at **Vercel dashboard → AI Gateway → API Keys**. `.env` is gitignored; never commit it.

## Usage

```bash
pnpm classify --country DE                 # one country, sample catalog
pnpm classify --country DE,UK,US,IN,AE     # several countries, one file per country in out/
pnpm classify --country UK --input my-products.json
pnpm classify --country DE --only p03,p07  # subset by product id
pnpm classify --country DE --no-rules      # drop the country rule notes, model knowledge only
pnpm classify --country DE --rpm 28 --concurrency 4
```

Input is a JSON array of products:

```json
{ "id": "p03", "storeHandle": "demo-botanicals", "title": "Premium Kratom Powder – Maeng Da 250g",
  "description": "...", "category": "Health > Botanicals", "tags": ["kratom"], "price": 34, "currency": "EUR" }
```

Only `id` and `title` are required. A Medusa admin products export maps onto this directly (title, description, categories, tags).

Output: a table on stdout and `out/<COUNTRY>.json` with the full verdict per product (probabilities, category distribution, severity, tokens, billed and list cost).

## How it works

`src/jev.ts` builds one state object per product:

- `market`: country code and name
- `regulatoryNotes`: the country's bullet list from `data/country-rules.json` (omitted with `--no-rules`)
- `product`: title, description, category, tags, price

and asks Jev five questions in one call:

| Question | Type | Meaning |
|---|---|---|
| `prohibited` | boolean | Is sale to consumers in this country illegal or banned as described? |
| `restricted` | boolean | Legal, but subject to age gate / licence / prescription / strength limits the merchant may not meet? |
| `platformRisk` | boolean | Would a mainstream platform or PSP treat this as high-risk regardless of legality? |
| `category` | choice | One of 13 buckets: weapons, controlled_substances, prescription_medication, tobacco_nicotine, alcohol, counterfeit_ip, wildlife_endangered, gambling, hazardous_goods, unapproved_health_cosmetic, adult, other, none |
| `severity` | score 0–3 | 0 fine · 1 minor (age/labelling) · 2 serious (licence/Rx missing) · 3 illegal |

The decision is a threshold rule you can tune in `ClassifyOptions`:

- `P(prohibited) ≥ 0.70` → **prohibited**
- `0.35 ≤ P(prohibited) < 0.70` → **needs_review**
- else `P(restricted) ≥ 0.60` or `P(platformRisk) ≥ 0.60` → **restricted**
- else → **allowed**

## Sample results (20 products, rule notes on)

| Product | DE | UK | US | IN | AE |
|---|---|---|---|---|---|
| Wireless headphones | allowed | allowed | allowed | allowed | allowed |
| CBD oil 2000 mg, ≤0.3% THC | restricted | prohibited | restricted | needs_review | prohibited |
| Kratom powder | prohibited | prohibited | restricted | needs_review | prohibited |
| Brass knuckles "paperweight" | prohibited | prohibited | needs_review | prohibited | prohibited |
| Pepper spray keychain | prohibited | prohibited | restricted | needs_review | prohibited |
| "LV inspired" replica tote | needs_review | needs_review | needs_review | needs_review | prohibited |
| Disposable vape 50 mg/ml | prohibited | prohibited | prohibited | prohibited | restricted |
| Nicotine pouches 20 mg | prohibited | restricted | restricted | needs_review | restricted |
| Absinthe 68% | restricted | restricted | restricted | prohibited | prohibited |
| 500 mW laser pointer | prohibited | needs_review | prohibited | needs_review | needs_review |
| Antique ivory netsuke, no CITES | prohibited | prohibited | needs_review | prohibited | prohibited |
| Melatonin 10 mg | prohibited | prohibited | allowed | allowed | restricted |
| Tramadol, "no Rx needed" | prohibited | prohibited | prohibited | prohibited | prohibited |
| Baby onesie | allowed | allowed | allowed | allowed | allowed |
| Online casino voucher | prohibited | prohibited | prohibited | prohibited | prohibited |
| Fixed-blade hunting knife | allowed | restricted | allowed | restricted | restricted |
| Spring-assisted flipper knife | prohibited | prohibited | needs_review | needs_review | needs_review |
| 4% hydroquinone cream | prohibited | prohibited | prohibited | prohibited | prohibited |
| SARMs capsules | prohibited | prohibited | prohibited | needs_review | prohibited |
| Ceramic coffee dripper | allowed | allowed | allowed | allowed | allowed |

Each country pass took about 42 s at 28 requests/minute and cost ~$0.0012 at list price (billed $0 on the free tier).

**Rule notes matter.** Running Germany with `--no-rules` moved 11 of 20 decisions, almost all from a firm `prohibited` to `needs_review` (kratom, brass knuckles, pepper spray, disposable vape, nicotine pouches, laser, melatonin, casino voucher). Bare model knowledge gets the risk category right but is far less decisive about local legality. Keep `data/country-rules.json` current and reviewed.

## Limits and caveats

- **Free tier:** Jev is limited to 30 requests/minute and 250k tokens/minute per team. The runner paces at 28 rpm (`--rpm`) and, on a 429, waits out the server's `retry-after` (60 s) up to three times before recording an `error` verdict. Buying AI Gateway credits raises the limits.
- **`data/country-rules.json` is illustrative.** The notes were written for this harness from general knowledge and are not legal advice or exhaustive. Verify them before any production use; a wrong note becomes a wrong verdict.
- **Probabilities are Jev's estimates**, not ground truth. Use `needs_review` as a human queue, and tune thresholds against a labelled set before trusting `prohibited` for automatic takedowns.
- Jev's state must be strictly JSON (no `undefined`), or the AI SDK throws `AI_InvalidArgumentError` before the request is sent.

## Layout

```
src/index.ts        CLI (parseArgs, table output, JSON writer)
src/jev.ts          state + questions, decision rule, rate limiter, 429 handling
src/countries.ts    loads data/country-rules.json
src/types.ts        Product, Verdict, RISK_CATEGORIES
data/sample-products.json   20 test products across benign and problematic classes
data/country-rules.json     per-country grounding notes (DE, UK, US, IN, AE)
out/                one JSON per country per run (gitignored)
results/2026-09-25/ verdicts from the measured runs behind BENCHMARK.md
BENCHMARK.md        measured per-call numbers + 1M-product extrapolation
```

## License

MIT. The country rule notes are illustrative and not legal advice.
