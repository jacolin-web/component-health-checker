figma.showUI(__html__, { width: 400, height: 500, title: 'Component Health Checker' })

figma.ui.onmessage = function(msg: any) {
  if (msg.type === 'run-check') {
    const instances: InstanceNode[] = []
    
    figma.currentPage.findAll(function(n) {
      if (n.type === 'INSTANCE') instances.push(n as InstanceNode)
      return false
    })

    const results = instances.map(function(node) {
      return {
        id: node.id,
        name: node.name,
        detached: node.mainComponent === null,
        isLocal: node.mainComponent ? !node.mainComponent.remote : false,
        hasOverrides: node.overrides ? node.overrides.length > 0 : false,
      }
    })

    figma.ui.postMessage({ type: 'results', data: results })
  }

  if (msg.type === 'select-node') {
    const node = figma.getNodeById(msg.id)
    if (node) {
      figma.currentPage.selection = [node as SceneNode]
      figma.viewport.scrollAndZoomIntoView([node as SceneNode])
    }
  }
}