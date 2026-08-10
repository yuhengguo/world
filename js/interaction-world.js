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
  const point = this.worldPosition(event);
  this.carriedTerminal.x = point.x;
  this.carriedTerminal.y = point.y;
  this.carriedTerminal = null;
  this.carriedTerminalOrigin = null;
  this.skipClickAfterDrag = true;
  return true;
};

Interaction.prototype.moveCarriedTerminal = function(event) {
  if (!this.carriedTerminal) return;
  const point = this.worldPosition(event);
  this.carriedTerminal.x = point.x;
  this.carriedTerminal.y = point.y;
};

Interaction.prototype.cancelCarriedTerminal = function(event) {
  if (!this.carriedTerminal) return false;
  event.preventDefault();
  this.carriedTerminal.x = this.carriedTerminalOrigin.x;
  this.carriedTerminal.y = this.carriedTerminalOrigin.y;
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
