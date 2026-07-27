"use strict";
(() => {
  // src/core.ts
  var isInstance = (s) => s.kind === "instance";
  var isStyleable = (s) => s.kind === "styleable";
  var DRIFT_FIELDS = /* @__PURE__ */ new Set([
    "fills",
    "strokes",
    "effects",
    "fillStyleId",
    "strokeStyleId",
    "textStyleId",
    "effectStyleId",
    "gridStyleId",
    "fontName",
    "fontSize",
    "cornerRadius",
    "strokeWeight"
  ]);
  var TOKENABLE_PAINTS = /* @__PURE__ */ new Set(["SOLID", "GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"]);
  var rules = [
    {
      id: "dangling-main-component",
      severity: "error",
      appliesTo: isInstance,
      evaluate: (s) => isInstance(s) && s.mainComponent === null ? {
        ruleId: "dangling-main-component",
        severity: "error",
        nodeId: s.id,
        nodeName: s.name,
        detail: "Source component no longer exists; updates can never reach this instance."
      } : null
    },
    {
      id: "local-component",
      severity: "warn",
      appliesTo: (s) => isInstance(s) && s.mainComponent !== null,
      evaluate: (s) => isInstance(s) && s.mainComponent && !s.mainComponent.remote ? {
        ruleId: "local-component",
        severity: "warn",
        nodeId: s.id,
        nodeName: s.name,
        detail: `Instance of local component "${s.mainComponent.name}" \u2014 lives outside library versioning and review.`
      } : null
    },
    {
      id: "style-override-drift",
      severity: "info",
      appliesTo: (s) => isInstance(s) && s.mainComponent !== null,
      evaluate: (s) => {
        if (!isInstance(s)) return null;
        const drift = s.overriddenFields.filter((f) => DRIFT_FIELDS.has(f));
        return drift.length > 0 ? {
          ruleId: "style-override-drift",
          severity: "info",
          nodeId: s.id,
          nodeName: s.name,
          detail: `Off-system overrides: ${drift.join(", ")}. Text and property overrides are ignored by design.`
        } : null;
      }
    },
    {
      // Severity 'info', deliberately: every wireframe rectangle in an
      // exploratory file has a raw fill. Flagging loudly repeats the
      // overrides.length > 0 mistake. Configurable severities are the
      // roadmap answer; the default must not cry wolf.
      id: "unbound-fill",
      severity: "info",
      appliesTo: isStyleable,
      evaluate: (s) => {
        if (!isStyleable(s)) return null;
        const { paintTypes, styleBound, variableBound } = s.fill;
        if (paintTypes === "MIXED") return null;
        const tokenable = paintTypes.filter((p) => TOKENABLE_PAINTS.has(p));
        return tokenable.length > 0 && !styleBound && !variableBound ? {
          ruleId: "unbound-fill",
          severity: "info",
          nodeId: s.id,
          nodeName: s.name,
          detail: `Raw ${tokenable.join("/").toLowerCase()} fill with no style or variable binding \u2014 hardcoded color outside the token system.`
        } : null;
      }
    },
    {
      id: "unbound-text-style",
      severity: "info",
      appliesTo: (s) => isStyleable(s) && s.text !== null,
      evaluate: (s) => {
        if (!isStyleable(s) || s.text === null) return null;
        return s.text.styleId === "" ? {
          ruleId: "unbound-text-style",
          severity: "info",
          nodeId: s.id,
          nodeName: s.name,
          detail: "Text node with no text style or typography variable \u2014 ad-hoc typography outside the system."
        } : null;
      }
    }
  ];
  function runRules(snapshots) {
    var _a;
    const findings = [];
    for (const snapshot of snapshots) {
      for (const rule of rules) {
        if (!rule.appliesTo(snapshot)) continue;
        const finding = rule.evaluate(snapshot);
        if (finding) findings.push(finding);
      }
    }
    const byRule = {};
    for (const f of findings) byRule[f.ruleId] = ((_a = byRule[f.ruleId]) != null ? _a : 0) + 1;
    return {
      findings,
      summary: { scanned: snapshots.length, findingCount: findings.length, byRule }
    };
  }

  // src/adapter.ts
  function isNestedInInstance(node) {
    let parent = node.parent;
    while (parent && parent.type !== "PAGE") {
      if (parent.type === "INSTANCE") return true;
      parent = parent.parent;
    }
    return false;
  }
  async function serializeInstance(node) {
    const main = await node.getMainComponentAsync();
    const fieldSet = /* @__PURE__ */ new Set();
    for (const record of node.overrides) {
      for (const field of record.overriddenFields) fieldSet.add(field);
    }
    return {
      kind: "instance",
      id: node.id,
      name: node.name,
      visible: node.visible,
      nestedInInstance: isNestedInInstance(node),
      mainComponent: main ? { name: main.name, remote: main.remote } : null,
      overriddenFields: Array.from(fieldSet)
    };
  }
  var isMixed = (v) => typeof v === "symbol";
  function serializeStyleable(node) {
    var _a;
    let paintTypes;
    if (isMixed(node.fills)) {
      paintTypes = "MIXED";
    } else if (Array.isArray(node.fills)) {
      paintTypes = node.fills.filter((p) => p.visible !== false).map((p) => p.type);
    } else {
      paintTypes = [];
    }
    const styleBound = !isMixed(node.fillStyleId) && typeof node.fillStyleId === "string" && node.fillStyleId !== "";
    const boundFills = (_a = node.boundVariables) == null ? void 0 : _a.fills;
    const variableBound = Array.isArray(boundFills) && boundFills.length > 0;
    let text = null;
    if (node.type === "TEXT") {
      if (isMixed(node.textStyleId)) text = { styleId: "MIXED" };
      else if (typeof node.textStyleId === "string" && node.textStyleId !== "") text = { styleId: "SET" };
      else text = { styleId: "" };
    }
    return {
      kind: "styleable",
      id: node.id,
      name: node.name,
      nodeType: node.type,
      visible: node.visible,
      nestedInInstance: isNestedInInstance(node),
      fill: { paintTypes, styleBound, variableBound },
      text
    };
  }

  // src/main.ts
  var DEV = true;
  var STYLEABLE_TYPES = ["FRAME", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR", "VECTOR", "LINE", "TEXT"];
  async function collectSnapshots() {
    const instances = figma.currentPage.findAllWithCriteria({ types: ["INSTANCE"] }).filter((n) => !isNestedInInstance(n));
    const styleables = figma.currentPage.findAllWithCriteria({ types: [...STYLEABLE_TYPES] }).filter((n) => !isNestedInInstance(n));
    const instanceSnapshots = await Promise.all(instances.map((n) => serializeInstance(n)));
    const styleableSnapshots = styleables.map((n) => serializeStyleable(n));
    return [...instanceSnapshots, ...styleableSnapshots];
  }
  async function runScan() {
    figma.ui.postMessage({ type: "scan-started" });
    const snapshots = await collectSnapshots();
    const { findings, summary } = runRules(snapshots);
    figma.ui.postMessage({ type: "results", findings, summary });
  }
  async function exportSnapshots() {
    const snapshots = await collectSnapshots();
    figma.ui.postMessage({
      type: "snapshots-export",
      json: JSON.stringify(snapshots, null, 2)
    });
  }
  figma.skipInvisibleInstanceChildren = true;
  figma.showUI(__html__, { width: 400, height: 520, title: "Component Health Checker" });
  figma.ui.onmessage = async (msg) => {
    try {
      switch (msg.type) {
        case "run-check":
          await runScan();
          break;
        case "export-snapshots":
          if (DEV) await exportSnapshots();
          break;
        case "select-node": {
          const node = await figma.getNodeByIdAsync(msg.id);
          if (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
          }
          break;
        }
      }
    } catch (err) {
      figma.ui.postMessage({
        type: "scan-error",
        message: err instanceof Error ? err.message : "Scan failed unexpectedly."
      });
    }
  };
})();
