import { experimental_evaluate as evaluate, type JSONValue } from 'ai'
import { countryContext } from './countries.js'
import { RISK_CATEGORIES, type Decision, type Product, type RiskCategory, type Verdict } from './types.js'

export const JEV_MODEL = 'typesafe-ai/jev'

export interface ClassifyOptions {
  /** ISO-3166 alpha-2 country the store sells into. */
  country: string
  /** Include the country rule notes from data/country-rules.json in the state. Default true. */
  withRules?: boolean
  /** P(prohibited) at or above this → "prohibited". Default 0.7 */
  prohibitedThreshold?: number
  /** P(restricted) or P(platform risk) at or above this → "restricted". Default 0.6 */
  restrictedThreshold?: number
  /** P(prohibited) at or above this but below prohibitedThreshold → "needs_review". Default 0.35 */
  reviewThreshold?: number
  /** How many times to wait out a 429 and retry before giving up on a product. Default 3. */
  maxRateLimitRetries?: number
}

function buildState(product: Product, opts: ClassifyOptions) {
  const ctx = countryContext(opts.country)
  // Jev's state must be strictly JSON-compatible: no `undefined` values anywhere.
  const state: Record<string, JSONValue> = {
    task: "Compliance screening of a product listed for sale on a merchant's online store.",
    market: { countryCode: opts.country.toUpperCase(), countryName: ctx.name },
    product: {
      title: product.title,
      description: product.description ?? '',
      category: product.category ?? '',
      tags: product.tags ?? [],
      ...(product.price !== undefined ? { price: product.price } : {}),
      ...(product.currency ? { currency: product.currency } : {}),
    },
  }
  if (opts.withRules !== false && ctx.notes.length > 0) state.regulatoryNotes = ctx.notes
  return state
}

function buildQuestions(countryName: string) {
  return {
    prohibited: {
      type: 'boolean',
      instructions: `Is it illegal or prohibited to sell this product to consumers in ${countryName}, as described in the listing?`,
      criteria: {
        true: 'Sale of the product as described is banned, requires a licence the merchant plainly lacks (e.g. "no prescription needed"), or the product itself is contraband in this country.',
        false: 'The product may be lawfully sold here, possibly with restrictions such as age checks or labelling.',
      },
    },
    restricted: {
      type: 'boolean',
      instructions: `Is this product legal to sell in ${countryName} but subject to material restrictions (age verification, licence, prescription, strength or size limits, labelling or novel-food rules) that a small online merchant may not be meeting?`,
    },
    platformRisk: {
      type: 'boolean',
      instructions: 'Would a mainstream eCommerce platform or payment processor treat this listing as high-risk or against acceptable-use policy (weapons, drugs, counterfeit, gambling, adult, unapproved medical claims, dangerous goods), regardless of local legality?',
    },
    category: {
      type: 'choice',
      instructions: 'Which risk category best describes this product? Pick "none" for ordinary goods.',
      criteria: RISK_CATEGORIES,
    },
    severity: {
      type: 'score',
      instructions: `How severe is the compliance problem with selling this product in ${countryName}?`,
      criteria: [
        'No problem: ordinary consumer product.',
        'Minor: needs age gate, labelling or a standard disclaimer.',
        'Serious: requires a licence, prescription or authorisation the listing does not show; likely removable.',
        'Illegal: the product or its sale is prohibited in this country.',
      ],
    },
  } as const
}

function decide(p: { prohibited: number; restricted: number; platformRisk: number }, opts: ClassifyOptions): Decision {
  const hi = opts.prohibitedThreshold ?? 0.7
  const mid = opts.restrictedThreshold ?? 0.6
  const review = opts.reviewThreshold ?? 0.35
  if (p.prohibited >= hi) return 'prohibited'
  if (p.prohibited >= review) return 'needs_review'
  if (p.restricted >= mid || p.platformRisk >= mid) return 'restricted'
  return 'allowed'
}git

/** Walk err → lastError → cause looking for a 429, and pull `retry-after` (seconds) if present. */
function rateLimitInfo(err: unknown): { limited: boolean; retryAfterMs: number } {
  let cur: unknown = err
  for (let i = 0; i < 6 && cur && typeof cur === 'object'; i++) {
    const o = cur as { statusCode?: number; responseHeaders?: Record<string, string>; lastError?: unknown; cause?: unknown }
    if (o.statusCode === 429) {
      const ra = Number(o.responseHeaders?.['retry-after'])
      return { limited: true, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000 }
    }
    cur = o.lastError ?? o.cause
  }
  return { limited: false, retryAfterMs: 0 }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Paces call starts so no more than `rpm` begin in any rolling minute (shared across workers). */
export class RateLimiter {
  private nextSlot = 0
  constructor(private readonly rpm: number) {}
  async acquire(): Promise<void> {
    const interval = 60_000 / this.rpm
    const now = Date.now()
    const slot = Math.max(now, this.nextSlot)
    this.nextSlot = slot + interval
    if (slot > now) await sleep(slot - now)
  }
}

export async function classifyProduct(product: Product, opts: ClassifyOptions, limiter?: RateLimiter): Promise<Verdict> {
  const ctx = countryContext(opts.country)
  const base = { productId: product.id, storeHandle: product.storeHandle, title: product.title, country: opts.country.toUpperCase() }
  const maxRetries = opts.maxRateLimitRetries ?? 3

  for (let attempt = 0; ; attempt++) {
    await limiter?.acquire()
    try {
      const result = await evaluate({
        model: JEV_MODEL,
        state: buildState(product, opts),
        questions: buildQuestions(ctx.name),
        maxRetries: 1, // we handle 429 ourselves with the server's retry-after; SDK backoff is too short for a per-minute window
        providerOptions: { gateway: { tags: ['project:jev-product-compliance', `country:${opts.country.toUpperCase()}`] } },
      })

      const a = result.answers
      const probs = { prohibited: a.prohibited.probability, restricted: a.restricted.probability, platformRisk: a.platformRisk.probability }
      const gateway = (result.providerMetadata?.gateway ?? {}) as { cost?: string; marketCost?: string }

      return {
        ...base,
        decision: decide(probs, opts),
        category: a.category.choice as RiskCategory,
        categoryProbabilities: a.category.probabilities,
        pProhibited: probs.prohibited,
        pRestricted: probs.restricted,
        pPlatformRisk: probs.platformRisk,
        severity: a.severity.score,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        costUsd: gateway.cost !== undefined ? Number(gateway.cost) : undefined,
        marketCostUsd: gateway.marketCost !== undefined ? Number(gateway.marketCost) : undefined,
        warnings: (result.warnings ?? []).map((w) => ('message' in w && typeof w.message === 'string' ? w.message : JSON.stringify(w))),
      }
    } catch (err) {
      const rl = rateLimitInfo(err)
      if (rl.limited && attempt < maxRetries) {
        console.error(`[rate-limit] ${product.id}: 429 from gateway, waiting ${Math.round(rl.retryAfterMs / 1000)}s (retry ${attempt + 1}/${maxRetries})`)
        await sleep(rl.retryAfterMs)
        continue
      }
      const message = err instanceof Error ? err.message.split('\n')[0]! : String(err)
      return {
        ...base,
        decision: 'error',
        category: 'other',
        pProhibited: 0,
        pRestricted: 0,
        pPlatformRisk: 0,
        severity: 0,
        warnings: [],
        error: message,
      }
    }
  }
}

export async function classifyMany(
  products: Product[],
  opts: ClassifyOptions & { concurrency?: number; rpm?: number; onResult?: (v: Verdict) => void },
): Promise<Verdict[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  // Free-tier Jev allows 30 requests/minute per team (x-ratelimit-limit-requests: 30); stay a little under it.
  const limiter = new RateLimiter(Math.max(1, opts.rpm ?? 28))
  const out: Verdict[] = new Array(products.length)
  let next = 0
  async function worker() {
    while (next < products.length) {
      const i = next++
      const v = await classifyProduct(products[i]!, opts, limiter)
      out[i] = v
      opts.onResult?.(v)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, worker))
  return out
}
