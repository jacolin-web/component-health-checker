// ============================================================================
// core.ts — runtime-agnostic domain logic.
// No `figma` global, no plugin typings. Imported by the plugin adapter,
// the test suite, and (later) the headless CLI.
// ============================================================================

export type Severity = 'error' | 'warn' | 'info'

// ----------------------------------------------------------------------------
// Snapshots. Generalized from instance-only to a discriminated union so token
// rules can target non-instance nodes. `kind` is our discriminant — decoupled
// from Figma's node-type strings on purpose (see DECISIONS.md).
// ----------------------------------------------------------------------------

interface BaseSnapshot {
  id: string
  name: string
  visible: boolean
  nestedInInstance: boolean
}

export interface InstanceSnapshot extends BaseSnapshot {
  kind: 'instance'
  mainComponent: { name: string; remote: boolean } | null
  /** Flattened union of overriddenFields across the instance's override records. */
  overriddenFields: string[]
}

export interface StyleableSnapshot extends BaseSnapshot {
  kind: 'styleable'
  nodeType: string
  fill: {
    /** Visible paint types, or 'MIXED' when Figma reports mixed fills (skip: can't cheaply attribute). */
    paintTypes: string[] | 'MIXED'
    styleBound: boolean
    variableBound: boolean
  }
  /** Present only for TEXT nodes. styleId: 'SET' bound · '' unbound · 'MIXED' per-segment (skip). */
  text: { styleId: 'SET' | '' | 'MIXED' } | null
}

export type NodeSnapshot = InstanceSnapshot | StyleableSnapshot

export const isInstance = (s: NodeSnapshot): s is InstanceSnapshot => s.kind === 'instance'
export const isStyleable = (s: NodeSnapshot): s is StyleableSnapshot => s.kind === 'styleable'

export interface Finding {
  ruleId: string
  severity: Severity
  nodeId: string
  nodeName: string
  detail: string
}

export interface ScanSummary {
  scanned: number
  findingCount: number
  byRule: Record<string, number>
}

export interface Rule {
  id: string
  severity: Severity
  appliesTo: (s: NodeSnapshot) => boolean
  evaluate: (s: NodeSnapshot) => Finding | null
}

// ----------------------------------------------------------------------------
// Override taxonomy (see DECISIONS.md). Only style-level fields that pull an
// instance off-system count as drift. Unknown fields are ignored, not flagged.
// ----------------------------------------------------------------------------

export const DRIFT_FIELDS = new Set<string>([
  'fills',
  'strokes',
  'effects',
  'fillStyleId',
  'strokeStyleId',
  'textStyleId',
  'effectStyleId',
  'gridStyleId',
  'fontName',
  'fontSize',
  'cornerRadius',
  'strokeWeight',
])

/** Paint types that should be token-bound. IMAGE/VIDEO fills are content, not
 *  styling — a photo has no corresponding color token. */
const TOKENABLE_PAINTS = new Set(['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND'])

// ----------------------------------------------------------------------------
// Rule registry
// ----------------------------------------------------------------------------

export const rules: Rule[] = [
  {
    id: 'dangling-main-component',
    severity: 'error',
    appliesTo: isInstance,
    evaluate: (s) =>
      isInstance(s) && s.mainComponent === null
        ? {
            ruleId: 'dangling-main-component',
            severity: 'error',
            nodeId: s.id,
            nodeName: s.name,
            detail: 'Source component no longer exists; updates can never reach this instance.',
          }
        : null,
  },
  {
    id: 'local-component',
    severity: 'warn',
    appliesTo: (s) => isInstance(s) && s.mainComponent !== null,
    evaluate: (s) =>
      isInstance(s) && s.mainComponent && !s.mainComponent.remote
        ? {
            ruleId: 'local-component',
            severity: 'warn',
            nodeId: s.id,
            nodeName: s.name,
            detail: `Instance of local component "${s.mainComponent.name}" — lives outside library versioning and review.`,
          }
        : null,
  },
  {
    id: 'style-override-drift',
    severity: 'info',
    appliesTo: (s) => isInstance(s) && s.mainComponent !== null,
    evaluate: (s) => {
      if (!isInstance(s)) return null
      const drift = s.overriddenFields.filter((f) => DRIFT_FIELDS.has(f))
      return drift.length > 0
        ? {
            ruleId: 'style-override-drift',
            severity: 'info',
            nodeId: s.id,
            nodeName: s.name,
            detail: `Off-system overrides: ${drift.join(', ')}. Text and property overrides are ignored by design.`,
          }
        : null
    },
  },
  {
    // Severity 'info', deliberately: every wireframe rectangle in an
    // exploratory file has a raw fill. Flagging loudly repeats the
    // overrides.length > 0 mistake. Configurable severities are the
    // roadmap answer; the default must not cry wolf.
    id: 'unbound-fill',
    severity: 'info',
    appliesTo: isStyleable,
    evaluate: (s) => {
      if (!isStyleable(s)) return null
      const { paintTypes, styleBound, variableBound } = s.fill
      if (paintTypes === 'MIXED') return null
      const tokenable = paintTypes.filter((p) => TOKENABLE_PAINTS.has(p))
      return tokenable.length > 0 && !styleBound && !variableBound
        ? {
            ruleId: 'unbound-fill',
            severity: 'info',
            nodeId: s.id,
            nodeName: s.name,
            detail: `Raw ${tokenable.join('/').toLowerCase()} fill with no style or variable binding — hardcoded color outside the token system.`,
          }
        : null
    },
  },
  {
    id: 'unbound-text-style',
    severity: 'info',
    appliesTo: (s) => isStyleable(s) && s.text !== null,
    evaluate: (s) => {
      if (!isStyleable(s) || s.text === null) return null
      // 'MIXED' is skipped: segments may each be legitimately bound to
      // different styles, and verifying per-segment costs a document walk
      // we don't spend by default. False negatives beat false positives.
      return s.text.styleId === ''
        ? {
            ruleId: 'unbound-text-style',
            severity: 'info',
            nodeId: s.id,
            nodeName: s.name,
            detail: 'Text node with no text style or typography variable — ad-hoc typography outside the system.',
          }
        : null
    },
  },
]

/** Pure. The function the fixture tests call, and the function the CLI will call. */
export function runRules(snapshots: NodeSnapshot[]): {
  findings: Finding[]
  summary: ScanSummary
} {
  const findings: Finding[] = []
  for (const snapshot of snapshots) {
    for (const rule of rules) {
      if (!rule.appliesTo(snapshot)) continue
      const finding = rule.evaluate(snapshot)
      if (finding) findings.push(finding)
    }
  }
  const byRule: Record<string, number> = {}
  for (const f of findings) byRule[f.ruleId] = (byRule[f.ruleId] ?? 0) + 1
  return {
    findings,
    summary: { scanned: snapshots.length, findingCount: findings.length, byRule },
  }
}
