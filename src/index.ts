import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { classifyMany } from './jev.js'
import type { Product, Verdict } from './types.js'

const { values } = parseArgs({
  options: {
    country: { type: 'string', short: 'c' },
    input: { type: 'string', short: 'i', default: 'data/sample-products.json' },
    out: { type: 'string', short: 'o', default: 'out' },
    concurrency: { type: 'string', default: '4' },
    rpm: { type: 'string', default: '28' },
    'no-rules': { type: 'boolean', default: false },
    only: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.help || !values.country) {
  console.log(`Usage: pnpm classify --country DE[,UK,US] [--input products.json] [--out out] [--concurrency 4] [--rpm 28] [--no-rules] [--only p03,p07]

Classifies each product in the input file for each country using typesafe-ai/jev via Vercel AI Gateway.
Input: JSON array of { id, title, description?, category?, tags?, price?, currency?, storeHandle? }.
Writes out/<COUNTRY>.json and prints a summary table. --rpm paces calls under the gateway's per-minute limit (free tier: 30).`)
  process.exit(values.help ? 0 : 1)
}

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('AI_GATEWAY_API_KEY is not set (put it in .env — see .env.example)')
  process.exit(1)
}

const countries = values.country.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
let products = JSON.parse(readFileSync(values.input!, 'utf8')) as Product[]
if (values.only) {
  const keep = new Set(values.only.split(',').map((s) => s.trim()))
  products = products.filter((p) => keep.has(p.id))
}
mkdirSync(values.out!, { recursive: true })

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4)

for (const country of countries) {
  const started = Date.now()
  console.log(`\n=== ${country} — ${products.length} products (${values['no-rules'] ? 'model knowledge only' : 'with country rule notes'}) ===`)
  console.log(`${pad('id', 5)} ${pad('decision', 13)} ${pad('category', 27)} ${'illegal'.padStart(7)} ${'restr'.padStart(6)} ${'risk'.padStart(5)} ${'sev'.padStart(5)}  title`)
  const verdicts = await classifyMany(products, {
    country,
    withRules: !values['no-rules'],
    concurrency: Number(values.concurrency),
    rpm: Number(values.rpm),
    onResult: (v: Verdict) => {
      console.log(
        `${pad(v.productId, 5)} ${pad(v.decision, 13)} ${pad(v.category, 27)} ${pct(v.pProhibited).padStart(7)} ${pct(v.pRestricted).padStart(6)} ${pct(v.pPlatformRisk).padStart(5)} ${v.severity.toFixed(2).padStart(5)}  ${v.title}`,
      )
    },
  })
  const tally = verdicts.reduce<Record<string, number>>((acc, v) => ((acc[v.decision] = (acc[v.decision] ?? 0) + 1), acc), {})
  const tokens = verdicts.reduce((n, v) => n + (v.inputTokens ?? 0), 0)
  const cost = verdicts.reduce((n, v) => n + (v.costUsd ?? 0), 0)
  const market = verdicts.reduce((n, v) => n + (v.marketCostUsd ?? 0), 0)
  const file = path.join(values.out!, `${country}${values['no-rules'] ? '.no-rules' : ''}.json`)
  writeFileSync(file, JSON.stringify(verdicts, null, 2))
  console.log(`--- ${JSON.stringify(tally)} | ${tokens} input tokens | billed $${cost.toFixed(6)} (list $${market.toFixed(6)}) | ${((Date.now() - started) / 1000).toFixed(1)}s | wrote ${file}`)
}
