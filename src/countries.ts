import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

interface CountryRules {
  name: string
  notes: string[]
}

const here = path.dirname(fileURLToPath(import.meta.url))
const rulesPath = path.resolve(here, '../data/country-rules.json')

let cache: Record<string, CountryRules> | null = null

export function loadCountryRules(): Record<string, CountryRules> {
  if (!cache) cache = JSON.parse(readFileSync(rulesPath, 'utf8')) as Record<string, CountryRules>
  return cache
}

export function countryContext(code: string): { name: string; notes: string[] } {
  const rules = loadCountryRules()
  const upper = code.toUpperCase()
  const entry = rules[upper]
  if (!entry) return { name: upper, notes: [] }
  return entry
}
