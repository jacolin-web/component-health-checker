// ============================================================================
// adapter.ts — the Figma-facing layer. Uses structural types, never the
// `figma` global at module scope, so tests pass plain objects. Only main.ts
// touches `figma` directly.
// ============================================================================

import type { InstanceSnapshot, StyleableSnapshot } from './core'

export interface ParentLike {
  type: string
  parent: ParentLike | null
}

export function isNestedInInstance(node: { parent: ParentLike | null }): boolean {
  let parent = node.parent
  while (parent && parent.type !== 'PAGE') {
    if (parent.type === 'INSTANCE') return true
    parent = parent.parent
  }
  return false
}

// ----------------------------------------------------------------------------
// Instance serialization
// ----------------------------------------------------------------------------

export interface SerializableInstance {
  id: string
  name: string
  visible: boolean
  parent: ParentLike | null
  overrides: ReadonlyArray<{ id: string; overriddenFields: string[] }>
  getMainComponentAsync(): Promise<{ name: string; remote: boolean } | null>
}

export async function serializeInstance(node: SerializableInstance): Promise<InstanceSnapshot> {
  const main = await node.getMainComponentAsync()
  const fieldSet = new Set<string>()
  for (const record of node.overrides) {
    for (const field of record.overriddenFields) fieldSet.add(field)
  }
  return {
    kind: 'instance',
    id: node.id,
    name: node.name,
    visible: node.visible,
    nestedInInstance: isNestedInInstance(node),
    mainComponent: main ? { name: main.name, remote: main.remote } : null,
    overriddenFields: Array.from(fieldSet),
  }
}

// ----------------------------------------------------------------------------
// Styleable serialization. `unknown`-typed Figma properties (figma.mixed is a
// unique symbol) are normalized here so core stays symbol-free and JSON-safe.
// ----------------------------------------------------------------------------

export interface SerializableStyleable {
  id: string
  name: string
  type: string
  visible: boolean
  parent: ParentLike | null
  /** figma.mixed-bearing properties arrive as unknown; we normalize. */
  fills: unknown
  fillStyleId: unknown
  boundVariables?: { fills?: unknown } | null
  textStyleId?: unknown
}

const isMixed = (v: unknown): boolean => typeof v === 'symbol'

export function serializeStyleable(node: SerializableStyleable): StyleableSnapshot {
  let paintTypes: string[] | 'MIXED'
  if (isMixed(node.fills)) {
    paintTypes = 'MIXED'
  } else if (Array.isArray(node.fills)) {
    paintTypes = (node.fills as Array<{ type: string; visible?: boolean }>)
      .filter((p) => p.visible !== false)
      .map((p) => p.type)
  } else {
    paintTypes = []
  }

  const styleBound = !isMixed(node.fillStyleId) && typeof node.fillStyleId === 'string' && node.fillStyleId !== ''
  const boundFills = node.boundVariables?.fills
  const variableBound = Array.isArray(boundFills) && boundFills.length > 0

  let text: StyleableSnapshot['text'] = null
  if (node.type === 'TEXT') {
    if (isMixed(node.textStyleId)) text = { styleId: 'MIXED' }
    else if (typeof node.textStyleId === 'string' && node.textStyleId !== '') text = { styleId: 'SET' }
    else text = { styleId: '' }
  }

  return {
    kind: 'styleable',
    id: node.id,
    name: node.name,
    nodeType: node.type,
    visible: node.visible,
    nestedInInstance: isNestedInInstance(node),
    fill: { paintTypes, styleBound, variableBound },
    text,
  }
}
