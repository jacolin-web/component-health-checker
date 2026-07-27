import { describe, test, expect } from 'vitest'
import { runRules, type NodeSnapshot } from '../src/core'
import corpusJson from '../fixtures/seeded-corpus.json'

const corpus = corpusJson as NodeSnapshot[]
const byPrefix = (p: string) => corpus.filter((s) => s.name.startsWith(p))

describe('healthy instances', () => {
  test('remote instances with no overrides produce zero findings', () => {
    const { findings, summary } = runRules(byPrefix('corpus/healthy/'))
    expect(findings).toHaveLength(0)
    expect(summary).toEqual({ scanned: 2, findingCount: 0, byRule: {} })
  })
})

describe('override taxonomy', () => {
  test('text/content/property overrides are legitimate — no findings', () => {
    const { findings } = runRules(byPrefix('corpus/text-override/'))
    expect(findings).toHaveLength(0)
  })

  test('style overrides flag as drift and name the offending fields', () => {
    const { findings } = runRules(byPrefix('corpus/style-override/'))
    expect(findings).toHaveLength(2)
    expect(findings.every((f) => f.ruleId === 'style-override-drift')).toBe(true)

    const cardFinding = findings.find((f) => f.nodeName.includes('Card'))
    expect(cardFinding?.detail).toContain('textStyleId')
    expect(cardFinding?.detail).toContain('fontSize')
    // 'characters' was also overridden on that node but must NOT be reported
    expect(cardFinding?.detail).not.toContain('characters')
  })
})

describe('local components', () => {
  test('instance of a file-local component warns', () => {
    const { findings } = runRules([corpus.find((s) => s.id === '1:130')!])
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'local-component',
        severity: 'warn',
        nodeId: '1:130',
      }),
    ])
  })

  test('local component with drift overrides yields both findings', () => {
    const { findings } = runRules([corpus.find((s) => s.id === '1:131')!])
    expect(findings.map((f) => f.ruleId).sort()).toEqual([
      'local-component',
      'style-override-drift',
    ])
  })
})

describe('dangling main component', () => {
  test('null mainComponent produces exactly one error finding — severity ordering suppresses downstream rules', () => {
    const { findings } = runRules(byPrefix('corpus/dangling/'))
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      ruleId: 'dangling-main-component',
      severity: 'error',
      nodeId: '1:140',
    })
  })
})

describe('visibility policy', () => {
  test('hidden instances are still scanned — drift is drift whether or not the eye icon is on', () => {
    const { findings } = runRules(byPrefix('corpus/hidden/'))
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: 'style-override-drift', nodeId: '1:150' }),
    ])
  })
})


describe('token drift', () => {
  test('raw solid fill with no binding flags unbound-fill', () => {
    const { findings } = runRules([corpus.find((s) => s.id === '2:200')!])
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: 'unbound-fill', nodeId: '2:200' }),
    ])
  })

  test('style-bound and variable-bound fills pass', () => {
    const { findings } = runRules(byPrefix('corpus/bound/'))
    expect(findings).toHaveLength(0)
  })

  test('image fills are content, not styling — no finding', () => {
    const { findings } = runRules(byPrefix('corpus/content/'))
    expect(findings).toHaveLength(0)
  })

  test('text with no text style flags unbound-text-style (fill isolated as bound)', () => {
    const { findings } = runRules([corpus.find((s) => s.id === '2:210')!])
    expect(findings).toEqual([
      expect.objectContaining({ ruleId: 'unbound-text-style', nodeId: '2:210' }),
    ])
  })

  test('mixed per-segment text styles are skipped — false negatives beat false positives', () => {
    const { findings } = runRules(byPrefix('corpus/mixed/'))
    expect(findings).toHaveLength(0)
  })
})

describe('full-corpus known answers', () => {
  test('exact expected totals for the entire seeded corpus', () => {
    const { summary } = runRules(corpus)
    expect(summary.scanned).toBe(17)
    expect(summary.findingCount).toBe(9)
    expect(summary.byRule).toEqual({
      'dangling-main-component': 1,
      'local-component': 2,
      'style-override-drift': 4,
      'unbound-fill': 1,
      'unbound-text-style': 1,
    })
  })
})
