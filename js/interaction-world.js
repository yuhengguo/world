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
  // 单纯点击空白仅用于取消当前操作，不应抹掉玩家已经选中的位置与移动起点。
  if (Math.abs(end.x - start.x) < 5 && Math.abs(end.y - start.y) < 5) return;
  this.world.nodes.forEach(node => node.selected = selected.includes(node));
  // 框选只是移动树结构，不改变角色的采集位置。
};

/** 选中世界节点，并按调用方决定是否结算一次静态节点间的移动。 */
Interaction.prototype.selectWorldMovementNode = function(node) {
  this.world.nodes.forEach(item => item.selected = false);
  this.world.uiNodes.forEach(item => item.selected = false);
  node.selected = true;
};

/** 静态节点之间的普通选择是世界移动；终端黏附和动态节点选择不会调用此方法。 */
Interaction.prototype.moveToStaticWorldNode = function(node) {
  const previous = this.world.nodes.includes(this.worldMovementOrigin) ? this.worldMovementOrigin : null;
  this.selectWorldMovementNode(node);
  if (!previous || previous === node) {
    this.worldMovementOrigin = node;
    this.world.playerLocation = node;
    return;
  }
  const result = this.world.moveBetweenNodes(previous, node, performance.now());
  const route = [previous, ...(result.displayPath || []).map(step => step.arriveAt)].map(item => item.customName || item.type).join(" → ");
  const costText = `饥饿 -${result.fromHunger.toFixed(3)}`;
  const lifeText = result.fromLife ? `，生命 -${result.fromLife.toFixed(3)}` : "";
  this.ui.setStatus(`移动路径：${route}｜${costText}${lifeText}（总消耗 ${result.cost.toFixed(3)}）`);
  this.worldMovementOrigin = node;
  this.world.playerLocation = node;
};

/** 仅当手开始采集新终端时，才从最近实际停留的父节点/静态节点结算移动。 */
Interaction.prototype.beginHarvestMovement = function(target) {
  // playerLocation 是金色边框所表示的唯一真实位置；它比旧采集记录更可靠，也不会被手或终端拖动改变。
  const playerPosition = this.world.nodes.includes(this.world.playerLocation) ? this.world.playerLocation : null;
  const previousHarvestParent = this.world.nodes.includes(this.harvestMovementOrigin) ? this.harvestMovementOrigin : null;
  const previousStaticPosition = this.world.nodes.includes(this.worldMovementOrigin) ? this.worldMovementOrigin : null;
  const selectedStatic = this.world.nodes.find(node => node.selected && !this.world.isHarvestable(node)) || null;
  // 手会抢走蓝色焦点，因此不能只依赖 selected；优先使用金框所在的最后真实位置，例如树干。
  const origin = playerPosition || previousHarvestParent || previousStaticPosition || selectedStatic || this.world.root;
  this.selectWorldMovementNode(target);
  if (origin === target) {
    this.harvestMovementOrigin = this.world.parentOf(target) || null;
    this.worldMovementOrigin = this.harvestMovementOrigin;
    this.world.playerLocation = this.harvestMovementOrigin || this.world.root;
    this.harvestMovementDebug = "采集移动：已在当前目标位置，本次不扣移动体力。";
    return;
  }
  // 采集移动显示本次完整路线，并覆盖此前路线；采集完成后仍保留到下一次有效移动。
  const result = this.world.moveBetweenNodes(origin, target, performance.now());
  const route = [origin, ...(result.displayPath || []).map(step => step.arriveAt)].map(item => item.customName || item.type).join(" → ");
  const costText = `饥饿 -${result.fromHunger.toFixed(3)}`;
  const lifeText = result.fromLife ? `，生命 -${result.fromLife.toFixed(3)}` : "";
  this.harvestMovementDebug = `移动路径：${route}｜${costText}${lifeText}（总消耗 ${result.cost.toFixed(3)}）`;
  if (result.gameOver) this.harvestMovementDebug = `移动路径：${route}｜生命归零，游戏结束。请点击“重新开始”。`;
  this.ui.setStatus(this.harvestMovementDebug);
  // 一开始采集就已经到达目标父节点；不必等资源采完才更新位置。
  this.harvestMovementOrigin = this.world.parentOf(target) || null;
  this.worldMovementOrigin = this.harvestMovementOrigin;
  this.world.playerLocation = this.harvestMovementOrigin || this.world.root;
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
    // 空白点击不再取消选中：保留蓝色节点与移动起点，避免玩家忘记自己上一次所在的位置。
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
    // 动态终端的普通选择仅用于标蓝，不能把它当作一次角色移动。
    this.selectWorldMovementNode(node);
    this.skipClickAfterDrag = true;
    return;
  } else if (this.world.isHarvestable(node)) {
    // 普通终端拖动不代表角色移动，不改变路径高亮或饥饿。
    this.selectWorldMovementNode(node);
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
    // 只有静态世界节点的普通选择才结算移动，例如山 → 森林。
    if (!this.world.isHarvestable(node) && !node.dynamic) this.moveToStaticWorldNode(node);
    else this.selectWorldMovementNode(node);
    return;
  }
  if (node.open) { this.world.collapse(node); this.audio.play(node.type); }
  else { this.world.expand(node); this.audio.play(node.type); }
};
})();
