// ============================================================================
// main.ts — plugin entry point. Bootstrap + message routing only.
// Built with: npm run build (esbuild → dist/main.js; Figma's main thread
// has no module loader — see DECISIONS.md).
// ============================================================================

import { runRules, type Finding, type NodeSnapshot, type ScanSummary } from './core'
import { isNestedInInstance, serializeInstance, serializeStyleable } from './adapter'

/** Strip or set false before Community publish: dumps document data to the
 *  panel for fixture generation. A published audit tool must not carry a
 *  data-export backdoor (see DECISIONS.md, trust posture). */
const DEV = true

type UIToPluginMessage =
  | { type: 'run-check' }
  | { type: 'select-node'; id: string }
  | { type: 'export-snapshots' }

type PluginToUIMessage =
  | { type: 'scan-started' }
  | { type: 'results'; findings: Finding[]; summary: ScanSummary }
  | { type: 'scan-error'; message: string }
  | { type: 'snapshots-export'; json: string }

/** Non-instance node types whose fills/typography should be token-bound.
 *  COMPONENT/COMPONENT_SET are excluded: definitions are system-authoring
 *  surface, audited separately if ever (see DECISIONS.md). */
const STYLEABLE_TYPES = ['FRAME', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'LINE', 'TEXT'] as const

async function collectSnapshots(): Promise<NodeSnapshot[]> {
  // Top-level instances: the unit of instance-level drift.
  const instances = figma.currentPage
    .findAllWithCriteria({ types: ['INSTANCE'] })
    .filter((n) => !isNestedInInstance(n))

  // Styleable nodes outside any instance: token-drift surface. Nodes *inside*
  // instances are excluded — drift there is attributed to the instance via
  // style-override-drift, not double-reported per descendant.
  const styleables = figma.currentPage
    .findAllWithCriteria({ types: [...STYLEABLE_TYPES] })
    .filter((n) => !isNestedInInstance(n))

  const instanceSnapshots = await Promise.all(instances.map((n) => serializeInstance(n)))
  const styleableSnapshots = styleables.map((n) => serializeStyleable(n))
  return [...instanceSnapshots, ...styleableSnapshots]
}

async function runScan(): Promise<void> {
  figma.ui.postMessage({ type: 'scan-started' } satisfies PluginToUIMessage)
  const snapshots = await collectSnapshots()
  const { findings, summary } = runRules(snapshots)
  figma.ui.postMessage({ type: 'results', findings, summary } satisfies PluginToUIMessage)
}

async function exportSnapshots(): Promise<void> {
  const snapshots = await collectSnapshots()
  figma.ui.postMessage({
    type: 'snapshots-export',
    json: JSON.stringify(snapshots, null, 2),
  } satisfies PluginToUIMessage)
}

figma.skipInvisibleInstanceChildren = true

figma.showUI(__html__, { width: 400, height: 520, title: 'Component Health Checker' })

figma.ui.onmessage = async (msg: UIToPluginMessage) => {
  try {
    switch (msg.type) {
      case 'run-check':
        await runScan()
        break
      case 'export-snapshots':
        if (DEV) await exportSnapshots()
        break
      case 'select-node': {
        const node = await figma.getNodeByIdAsync(msg.id)
        if (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
          figma.currentPage.selection = [node as SceneNode]
          figma.viewport.scrollAndZoomIntoView([node as SceneNode])
        }
        break
      }
    }
  } catch (err) {
    figma.ui.postMessage({
      type: 'scan-error',
      message: err instanceof Error ? err.message : 'Scan failed unexpectedly.',
    } satisfies PluginToUIMessage)
  }
}
