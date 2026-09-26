export interface Product {
  id: string
  title: string
  description?: string
  category?: string
  tags?: string[]
  price?: number
  currency?: string
  storeHandle?: string
}

export type Decision = 'allowed' | 'restricted' | 'needs_review' | 'prohibited' | 'error'

export const RISK_CATEGORIES = {
  none: 'Ordinary consumer good with no legal or policy concern.',
  weapons: 'Weapons or weapon accessories: knives beyond ordinary kitchen/utility use, knuckle dusters, firearms parts, tasers, pepper spray.',
  controlled_substances: 'Narcotics, psychoactive botanicals, cannabis/THC above legal limits, kratom, research chemicals, SARMs.',
  prescription_medication: 'Medicines that require a prescription or pharmacy dispensing, or are sold "no Rx needed".',
  tobacco_nicotine: 'Cigarettes, vapes, e-liquids, nicotine pouches and other nicotine products.',
  alcohol: 'Alcoholic beverages.',
  counterfeit_ip: 'Replicas, knock-offs, or goods that infringe trademarks/copyright.',
  wildlife_endangered: 'Ivory, furs, coral, or other products from protected species (CITES).',
  gambling: 'Real-money gambling, casino credit, lottery, betting products.',
  hazardous_goods: 'Dangerous items: high-power lasers, fireworks, chemicals, unsafe electrical goods.',
  unapproved_health_cosmetic: 'Supplements or cosmetics with banned ingredients, unauthorised novel foods, or illegal medical claims.',
  adult: 'Sexually explicit products or services.',
  other: 'Some other legal or policy problem not listed above.',
} as const

export type RiskCategory = keyof typeof RISK_CATEGORIES

export interface Verdict {
  productId: string
  storeHandle?: string
  title: string
  country: string
  decision: Decision
  category: RiskCategory
  categoryProbabilities?: Record<string, number>
  pProhibited: number
  pRestricted: number
  pPlatformRisk: number
  severity: number
  inputTokens?: number
  outputTokens?: number
  /** What the gateway billed (0 on the free tier). */
  costUsd?: number
  /** Provider list price for this call, i.e. what a paid-tier account would pay. */
  marketCostUsd?: number
  warnings: string[]
  /** Set when the evaluation failed after retries; all probabilities are 0 in that case. */
  error?: string
}
