/*
 * 世界交互：框选、世界节点拖动、终端节点拾取放置，以及普通展开/收起。
 * 不包含背包数量、工具采集或相机缩放。
 */
(() => {
const { Interaction } = window.TreeWorld;

Interaction.prototype.selectInBox = function() {
  const start = this.worldPosition(this.selectionBox.start);
  const end = this.worldPosition(this.selectionBox.end);
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  const selected = this.world.nodes.filter(node => node.visible && node.x >= left && node.x <= right && node.y >= top && node.y <= bottom);
  this.world.nodes.forEach(node => node.selected = selected.includes(node));
};

Interaction.prototype.moveSelectedNodes = function(dx, dy) {
  const selected = this.world.nodes.filter(node => node.selected);
  const roots = selected.filter(node => !selected.some(parent => parent.children.includes(node)));
  roots.forEach(node => this.world.moveTree(node, dx, dy));
};

Interaction.prototype.handleCarriedTerminalDown = function(event) {
  if (!this.carriedTerminal) return false;
  const inPanel = this.workspacePanel?.open && this.workspacePanel.contains(event);
  // 世界终端可进入工作区进行跨层预览，但不能被放置为工作区内容；左键自动弹回原世界位置。
  if (inPanel) {
    this.carriedTerminal.x = this.carriedTerminalOrigin.x;
    this.carriedTerminal.y = this.carriedTerminalOrigin.y;
    this.carriedTerminal.workspaceInPanel = false;
    this.carriedTerminal = null;
    this.carriedTerminalOrigin = null;
    this.skipClickAfterDrag = true;
    return true;
  }
  const point = this.worldPosition(event);
  this.carriedTerminal.x = point.x;
  this.carriedTerminal.y = point.y;
  this.carriedTerminal.workspaceInPanel = false;
  this.carriedTerminal = null;
  this.carriedTerminalOrigin = null;
  this.skipClickAfterDrag = true;
  return true;
};

Interaction.prototype.moveCarriedTerminal = function(event) {
  if (!this.carriedTerminal) return;
  const inPanel = this.workspacePanel?.open && this.workspacePanel.contains(event);
  const point = inPanel ? this.workspacePanel.toContent(event) : this.worldPosition(event);
  this.carriedTerminal.x = point.x;
  this.carriedTerminal.y = point.y;
  this.carriedTerminal.workspaceInPanel = Boolean(inPanel);
};

Interaction.prototype.cancelCarriedTerminal = function(event) {
  if (!this.carriedTerminal) return false;
  event.preventDefault();
  this.carriedTerminal.x = this.carriedTerminalOrigin.x;
  this.carriedTerminal.y = this.carriedTerminalOrigin.y;
  this.carriedTerminal.workspaceInPanel = false;
  this.carriedTerminal = null;
  this.carriedTerminalOrigin = null;
  return true;
};

Interaction.prototype.handleWorldPointerDown = function(event) {
  const point = this.worldPosition(event);
  const node = [...this.world.nodes].reverse().find(item => item.visible && !item.locked && this.hit(item, point));
  if (!node) {
    this.world.nodes.forEach(item => item.selected = false);
    this.world.uiNodes.forEach(item => item.selected = false);
    this.selectionBox = { start: { x: event.clientX, y: event.clientY }, end: { x: event.clientX, y: event.clientY } };
    return;
  }
  if (event.ctrlKey && this.renameNode(node)) {
    this.skipClickAfterDrag = true;
    return;
  }
  if (node.replacementLayer) {
    this.wasSelectedOnDown = node.selected;
    this.selected = node;
  } else if (node.dynamic) {
    this.world.nodes.forEach(item => item.selected = false);
    this.world.uiNodes.forEach(item => item.selected = false);
    node.selected = true;
    this.skipClickAfterDrag = true;
    return;
  } else if (this.world.isHarvestable(node)) {
    this.world.nodes.forEach(item => item.selected = false);
    this.world.uiNodes.forEach(item => item.selected = false);
    node.selected = true;
    this.carriedTerminal = node;
    this.carriedTerminalOrigin = { x: node.x, y: node.y };
    this.skipClickAfterDrag = true;
    return;
  } else {
    this.wasSelectedOnDown = node.selected;
    this.selected = node;
  }
  this.down = { x: event.clientX, y: event.clientY };
  this.lastWorld = point;
  this.dragging = false;
};

/** 搜索命中世界节点时，展开正常父链并将相机移动到节点居中位置。 */
Interaction.prototype.focusNamedNode = function(name) {
  if (!name) { this.ui.setStatus("请输入一个已命名节点的名称。"); return false; }
  const node = this.namedNodes().find(item => item.customName === name);
  if (!node) { this.ui.setStatus(`未找到已命名节点“${name}”。`); return false; }
  if (node.hiddenUnderlay || node.locked) {
    this.ui.setStatus(`“${name}”仍在隐藏替补层中，需按地层规则逐层揭示。`);
    return false;
  }
  if (!node.ui) {
    let parent = this.world.parentOf(node);
    while (parent) {
      if (!parent.open) this.world.expand(parent);
      parent = this.world.parentOf(parent);
    }
    node.visible = true;
    // 搜索定位恢复节点在初始世界比例下的观看尺寸，再把它放到视野中央。
    this.camera.scale = 1;
    this.camera.x = this.canvas.width / 2 - node.x;
    this.camera.y = this.canvas.height / 2 - node.y;
  } else if (node.customNode) {
    let parent = node.backpackParent || this.world.backpack;
    while (parent && parent !== this.world.backpack) {
      parent.open = true;
      parent = parent.backpackParent;
    }
    if (!this.world.backpack.open) this.world.setBackpackOpen(true, this.canvas.width);
    this.world.layoutBackpackTree(this.canvas.width);
    node.visible = true;
    // 分类搜索使用与世界搜索同样的“初始比例 + 中央聚焦”表现；背包和思考入口仍保持固定位置。
    const panel = this.workspacePanel;
    if (panel) {
      // 工作区已经展开时保持玩家正在使用的宽度；收起时仅恢复上次宽度，不强制铺满屏幕。
      if (!panel.open) {
        panel.open = true;
        panel.width = panel.lastExpandedWidth;
      }
      panel.clampWidth();
      panel.contentScale = 1;
      // 以当前工作区的中心为锚点聚焦，而非以整个屏幕为锚点。
      const anchor = panel.contentAnchor();
      panel.contentOffset.x = anchor.x - node.x;
      panel.contentOffset.y = anchor.y - node.y;
    }
  }
  // 搜索只负责定位，不改变当前选择或蓝色焦点；黏附节点仍按原有优先级显示。
  this.world.nodes.forEach(item => item.selected = false);
  this.world.uiNodes.forEach(item => item.selected = false);
  this.ui.setStatus(`已定位“${name}”。`);
  return true;
};

Interaction.prototype.moveWorldInteraction = function(event) {
  if (this.selectionBox) {
    this.selectionBox.end = { x: event.clientX, y: event.clientY };
    if (Math.hypot(event.clientX - this.selectionBox.start.x, event.clientY - this.selectionBox.start.y) > 5) this.dragging = true;
  }
  if (!this.selected) return;
  const point = this.worldPosition(event);
  if (Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5) this.dragging = true;
  if (this.selected.selected) this.moveSelectedNodes(point.x - this.lastWorld.x, point.y - this.lastWorld.y);
  else this.world.moveTree(this.selected, point.x - this.lastWorld.x, point.y - this.lastWorld.y);
  this.lastWorld = point;
};

Interaction.prototype.endWorldInteraction = function() {
  if (this.selectionBox) {
    this.selectInBox();
    this.selectionBox = null;
  }
  this.selected = null;
};

Interaction.prototype.handleWorldClick = function(event) {
  const point = this.worldPosition(event);
  const node = [...this.world.nodes].reverse().find(item => item.visible && !item.locked && this.hit(item, point));
  if (!node) return;
  // 世界中的整叠容器以单击直接展开，便于立即看到其中必须逐个采集的同类资源。
  if (node.worldPile) {
    if (node.open) this.world.collapse(node);
    else this.world.expand(node);
    this.audio.play(node.type);
    return;
  }
  if (this.world.touchIndestructible(node, performance.now())) { this.ui.setStatus(`触碰到${node.type}：它无法被采集。`); return; }
  if (!this.wasSelectedOnDown) {
    this.world.nodes.forEach(item => item.selected = false);
    node.selected = true;
    return;
  }
  if (node.open) { this.world.collapse(node); this.audio.play(node.type); }
  else { this.world.expand(node); this.audio.play(node.type); }
};
})();
