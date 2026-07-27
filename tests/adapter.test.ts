import { describe, test, expect } from 'vitest'
import { isNestedInInstance, serializeInstance, serializeStyleable, type ParentLike } from '../src/adapter'

// Plain-object ancestry chains stand in for Figma nodes — no figma global,
// no mock library. The adapter's structural types make this legal TypeScript.

const page: ParentLike = { type: 'PAGE', parent: null }
const frame = (parent: ParentLike): ParentLike => ({ type: 'FRAME', parent })
const instance = (parent: ParentLike): ParentLike => ({ type: 'INSTANCE', parent })
const section = (parent: ParentLike): ParentLike => ({ type: 'SECTION', parent })

describe('isNestedInInstance', () => {
  test('top-level instance on the page is not nested', () => {
    expect(isNestedInInstance({ parent: page })).toBe(false)
  })

  test('instance inside a plain frame is not nested', () => {
    expect(isNestedInInstance({ parent: frame(page) })).toBe(false)
  })

  test('instance directly inside an instance is nested', () => {
    expect(isNestedInInstance({ parent: instance(page) })).toBe(true)
  })

  test('instance -> frame -> instance chain is nested (walks past frames)', () => {
    expect(isNestedInInstance({ parent: frame(instance(page)) })).toBe(true)
  })

  test('instance inside a section is not nested', () => {
    expect(isNestedInInstance({ parent: section(page) })).toBe(false)
  })

  test('orphaned node with null parent is not nested', () => {
    expect(isNestedInInstance({ parent: null })).toBe(false)
  })
})

describe('serializeInstance', () => {
  test('flattens override fields across records and dedupes', async () => {
    const snapshot = await serializeInstance({
      id: '9:1',
      name: 'Alert',
      visible: true,
      parent: page,
      overrides: [
        { id: '9:2', overriddenFields: ['characters', 'fills'] },
        { id: '9:3', overriddenFields: ['characters', 'strokes'] },
      ],
      getMainComponentAsync: async () => ({ name: 'Alert/Info', remote: true }),
    })
    expect(snapshot.overriddenFields.sort()).toEqual(['characters', 'fills', 'strokes'])
    expect(snapshot.mainComponent).toEqual({ name: 'Alert/Info', remote: true })
    expect(snapshot.nestedInInstance).toBe(false)
  })

  test('null main component serializes to null, not a throw', async () => {
    const snapshot = await serializeInstance({
      id: '9:9',
      name: 'Orphan',
      visible: true,
      parent: frame(page),
      overrides: [],
      getMainComponentAsync: async () => null,
    })
    expect(snapshot.mainComponent).toBeNull()
  })
})

describe('serializeStyleable', () => {
  test('mixed fills normalize to MIXED (symbol never crosses into core)', () => {
    const snapshot = serializeStyleable({
      id: '7:1', name: 'Vector', type: 'VECTOR', visible: true, parent: page,
      fills: Symbol('figma.mixed'), fillStyleId: '',
    })
    expect(snapshot.fill.paintTypes).toBe('MIXED')
  })

  test('invisible paints are excluded from paintTypes', () => {
    const snapshot = serializeStyleable({
      id: '7:2', name: 'Frame', type: 'FRAME', visible: true, parent: page,
      fills: [{ type: 'SOLID', visible: false }, { type: 'IMAGE' }], fillStyleId: '',
    })
    expect(snapshot.fill.paintTypes).toEqual(['IMAGE'])
  })

  test('TEXT nodes get a text field; bound style serializes to SET', () => {
    const snapshot = serializeStyleable({
      id: '7:3', name: 'Heading', type: 'TEXT', visible: true, parent: page,
      fills: [{ type: 'SOLID' }], fillStyleId: 'S:abc123', textStyleId: 'S:def456',
    })
    expect(snapshot.text).toEqual({ styleId: 'SET' })
    expect(snapshot.fill.styleBound).toBe(true)
  })

  test('non-TEXT nodes have null text', () => {
    const snapshot = serializeStyleable({
      id: '7:4', name: 'Frame', type: 'FRAME', visible: true, parent: page,
      fills: [], fillStyleId: '',
    })
    expect(snapshot.text).toBeNull()
  })
})
