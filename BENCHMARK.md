# Benchmark: screening 1,000,000 products with Jev

**Status: measured per-call, extrapolated to 1M.** The per-product numbers below were measured on 120 real calls (20 products × 5 countries with rule notes, plus 20 without) on 2026-09-25 through the Vercel AI Gateway. The million-product figures are linear extrapolations of those measurements. Nothing here measures accuracy at scale; see "What this does not show".

## Measured (per product, per country)

| Metric | With country rule notes | Model knowledge only |
|---|---|---|
| Calls measured | 100 | 20 |
| Input tokens per product | **1,409** avg (1,309 – 1,505) | 1,135 avg |
| Output tokens per product | ~213 (billed at $0) | ~213 |
| Questions answered per call | 5 (3 boolean, 1 choice of 13, 1 score 0–3) | 5 |
| List cost per product | **$0.0000592** | $0.0000477 |
| Implied price | $0.042 per 1M input tokens, output free | same |
| Provider processing time | ~200 ms per call (gateway-reported) | same |
| Client wall time incl. network (Asia → EU gateway region) | ~1.4 s per call | same |

## Extrapolated: 1,000,000 products, one country

| | Value |
|---|---|
| Input tokens | 1.41 billion |
| Calls | 1,000,000 (all five judgments come back in one call) |
| **Cost at list price** | **$59** with rule notes, $48 without |
| Cost for 5 countries | $296 |

### Time to finish depends only on the rate limit

| Rate limit | Time for 1M calls |
|---|---|
| Free tier, 30 requests/min (measured header) | 23 days |
| 600 requests/min | 28 hours |
| 3,000 requests/min | 5.6 hours |
| 10,000 requests/min | 1.7 hours |
| Compute-bound, 200 ms/call at 50 concurrent | 67 minutes |

Paid-tier limits for Jev are not published; confirm with TypeSafe AI before quoting a wall-clock number. Packing several products into one state with per-product questions would cut the call count, but that is untested here.

## Same job with a language model (structured JSON output)

Same 1.41B input tokens, plus an estimated 100 output tokens per product for the JSON answer. Gateway list prices on 2026-09-25.

| Model | Input $/M | Output $/M | 1M products | vs Jev |
|---|---|---|---|---|
| **typesafe-ai/jev** | 0.042 | 0 | **$59** | 1× |
| google/gemini-2.5-flash-lite | 0.10 | 0.40 | $181 | 3× |
| openai/gpt-4o-mini | 0.15 | 0.60 | $271 | 4.6× |
| openai/gpt-5.4-mini | 0.75 | 4.50 | $1,507 | 25× |
| anthropic/claude-haiku-4.5 | 1.00 | 5.00 | $1,909 | 32× |
| anthropic/claude-sonnet-5 | 2.00 | 10.00 | $3,818 | 64× |
| openai/gpt-5.4 | 2.50 | 15.00 | $5,023 | 85× |

The LLM rows are price arithmetic, not measured runs. 100 output tokens is a low estimate; models that reason before answering will use more. LLM latency for a JSON answer is typically 1 to 4 s per product versus ~200 ms for Jev, but was not measured here.

## What the sample showed (not a scale claim)

20 hand-written products deliberately skewed toward problematic goods, 5 countries: 49% prohibited, 15% restricted, 17% needs review, 19% allowed. Verdicts moved with the country as the rule notes dictate (melatonin 10 mg: prohibited in DE and UK, allowed in US). Removing the rule notes changed 11 of 20 German decisions, mostly firm `prohibited` softening to `needs_review`.

## What this does not show

- **Accuracy at scale.** No labelled set of a million products exists here. Precision and recall must come from a labelled sample before any takedown automation.
- **Real catalog token counts.** Real listings vary more than the sample; a description-heavy catalog will run longer than 1,409 tokens per product.
- **Paid-tier throughput.** Only the free tier's 30 requests/min was observed.
- **Batching.** Multi-product states are untested and may change answer quality.

## Reproduce

```bash
pnpm classify --country DE,UK,US,IN,AE     # 100 calls, writes out/<CC>.json with tokens and marketCostUsd per product
pnpm classify --country DE --no-rules
```

Raw per-product verdicts from the measured runs are in `results/2026-09-25/`.
