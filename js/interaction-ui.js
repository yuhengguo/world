/*
 * UI 与背包交互：数字输入、背包/身体按钮、物品拆分、归位与双击 pile 选择。
 * 本文件不处理世界节点采集，也不处理相机移动。
 */
(() => {
const { Interaction } = window.TreeWorld;

Interaction.prototype.hitQuantityBox = function(node, event) {
  const scale = node.scalesWithWorld ? this.camera.scale : 1;
  const localX = (event.clientX - node.x) / scale;
  const localY = (event.clientY - node.y) / scale;
  return node.isNumericPile && !node.detached && localX >= 1 && localX <= 48 && localY >= 14 && localY <= 30;
};

Interaction.prototype.splitMaximum = function(node) {
  return node.resourcePileOwner
    ? Math.max(1, Math.floor(node.quantity + Number.EPSILON))
    : Math.max(1, node.quantity - 1);
};

Interaction.prototype.previewQuantityInput = function(node) {
  const maximum = this.splitMaximum(node);
  const parsed = Number(this.quantityInput.value);
  node.splitAmount = Math.round(Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : 1);
  this.quantityInput.value = String(node.splitAmount);
};

Interaction.prototype.openQuantityInput = function(node) {
  this.quantityInputNode = node;
  this.quantityInput.min = "1";
  this.quantityInput.max = String(this.splitMaximum(node));
  this.quantityInput.step = "1";
  this.quantityInput.value = String(node.splitAmount || 1);
  const scale = node.scalesWithWorld ? this.camera.scale : 1;
  this.quantityInput.style.left = `${node.x + scale}px`;
  this.quantityInput.style.top = `${node.y + 14 * scale}px`;
  this.quantityInput.style.transformOrigin = "top left";
  this.quantityInput.style.transform = `scale(${scale})`;
  this.quantityInput.hidden = false;
  requestAnimationFrame(() => { this.quantityInput.focus(); this.quantityInput.select(); });
};

Interaction.prototype.commitQuantityInput = function(splitImmediately = false) {
  const node = this.quantityInputNode;
  if (!node) return;
  this.previewQuantityInput(node);
  this.quantityInput.hidden = true;
  this.quantityInputNode = null;
  if (!splitImmediately) return;
  const detached = node.backpackItemOwner ? this.world.detachBackpackItem(node) : this.world.detachResourceItem(node);
  if (!detached) { this.ui.setStatus("当前数量不足，无法继续分离。"); return; }
  const scale = node.scalesWithWorld ? this.camera.scale : 1;
  detached.x = node.x + 22 * scale;
  detached.y = node.y - 14 * scale;
  this.world.uiNodes.forEach(item => item.selected = false);
  detached.selected = true;
  this.audio.play(detached.type);
  this.ui.setStatus(`已从 ${node.type} 分离 ×${detached.quantity}。`);
};

Interaction.prototype.bindQuantityInput = function() {
  window.addEventListener("keydown", event => {
    if (event.code !== "Space" || document.activeElement === this.quantityInput) return;
    this.placeKeyHeld = true;
    if (this.carriedUIItem?.backpackItemOwner || this.carriedBulkPile) event.preventDefault();
  });
  window.addEventListener("keyup", event => { if (event.code === "Space") this.placeKeyHeld = false; });
  ["pointerdown", "mousedown", "click"].forEach(name => this.quantityInput.addEventListener(name, event => {
    event.stopPropagation();
    this.quantityInput.focus();
  }));
  this.quantityInput.addEventListener("input", () => {
    if (this.quantityInputNode) this.previewQuantityInput(this.quantityInputNode);
  });
  this.quantityInput.addEventListener("blur", () => this.commitQuantityInput());
  this.quantityInput.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); this.commitQuantityInput(true); }
    if (event.key === "Escape") { this.quantityInput.hidden = true; this.quantityInputNode = null; }
  });
};

Interaction.prototype.handleUIClick = function(node, event) {
  this.world.uiNodes.forEach(item => item.selected = false);
  node.selected = true;
  if (node.type === "背包") {
    this.audio.play(node.type);
    this.world.setBackpackOpen(this.ui.toggleBackpack(), this.canvas.width);
    return true;
  }
  if (node.type === "刷新") { this.audio.play(node.type); this.onReset?.(); return true; }
  if (node.type === "思考") { this.audio.play(node.type); this.ui.setStatus("思考节点：之后可以在这里接入想法或任务。"); return true; }
  if (node.type === "天空") {
    const open = this.celestial?.toggleSky();
    this.audio.play(node.type);
    this.ui.setStatus(open ? "天空已展开：太阳和月亮会按游戏时间从右向左移动。" : "天空已收起。时间仍在流逝。");
    return true;
  }
  if (node.type === "太阳") { this.ui.setStatus("太阳正在运行：它会在白天穿过屏幕，并在夜晚暂时隐去。"); return true; }
  if (node.type === "月亮") { this.ui.setStatus("月亮正在运行：它会在黑夜穿过屏幕，并在白天暂时隐去。"); return true; }
  if (node.type === "身体") {
    if (this.handActive) this.returnHand();
    const open = this.world.toggleBody();
    this.audio.play(node.type);
    this.ui.setStatus(open ? "手节点已出现，点击手即可开始采集。" : "身体已收起。");
    return true;
  }
  if (node.backpackItemOwner) { this.ui.setStatus(`背包物品：${node.type}`); return true; }
  return false;
};

Interaction.prototype.handleUINodeDown = function(event) {
  const node = !this.handActive && !this.mouthActive && [...this.world.uiNodes].reverse().find(item => item.visible && this.hit(item, event));
  if (!node) return false;
  if (["手", "嘴"].includes(node.type)) return false; // 工具模块负责这两个节点。
  if (["身体", "背包", "思考", "刷新", "天空", "太阳", "月亮"].includes(node.type)) {
    this.handleUIClick(node, event);
    this.skipClickAfterDrag = true;
    return true;
  }
  if (node.fixedUI && !node.resourcePileOwner) return true;
  if (this.hitQuantityBox(node, event)) {
    event.preventDefault();
    this.openQuantityInput(node);
    this.skipClickAfterDrag = true;
    return true;
  }
  if (node.backpackItemOwner || node.resourcePileOwner) {
    this.audio.play(node.type);
    if (node.pileGroupSelected) {
      this.selectedUI = node;
    } else {
      const detached = node.detached ? node : (node.backpackItemOwner ? this.world.detachBackpackItem(node) : this.world.detachResourceItem(node));
      if (node.resourcePileOwner && !node.detached && !detached) { this.ui.setStatus("资源节点数量不足，无法继续拆出。"); return true; }
      this.carriedUIItem = detached || node;
      this.carriedUIOrigin = { x: this.carriedUIItem.x, y: this.carriedUIItem.y, detached: this.carriedUIItem.detached };
      this.skipClickAfterDrag = true;
      return true;
    }
  } else {
    if (!node.selected) { this.world.uiNodes.forEach(item => item.selected = false); node.selected = true; }
    this.selectedUI = node;
  }
  this.down = { x: event.clientX, y: event.clientY };
  this.lastScreen = { x: event.clientX, y: event.clientY };
  this.dragging = false;
  return true;
};

Interaction.prototype.handleCarriedUIDown = function(event) {
  if (!this.carriedUIItem) return false;
  const item = this.carriedUIItem;
  if (this.placeKeyHeld && item.backpackItemOwner && (item.detached || item.quantity === 1)) {
    const point = this.worldPosition(event);
    const ground = [...this.world.nodes].reverse().find(node => node.visible && !node.locked && this.hit(node, point));
    const result = this.world.placeBackpackItem(item, ground);
    if (!result.placed) this.ui.setStatus(`无法放置：${result.reason}`);
    else {
      this.audio.play(result.node?.type || item.type);
      this.ui.setStatus(result.message || `已将 ${result.node.type} 放置在 ${ground.type} 上。`);
      if (!result.itemRemaining) { this.carriedUIItem = null; this.carriedUIOrigin = null; }
    }
    this.skipClickAfterDrag = true;
    return true;
  }
  if (event.detail >= 2 && item.backpackItemOwner && item.detached) {
    this.world.mergeBackpackItem(item);
    this.carriedUIItem = null;
    this.carriedUIOrigin = null;
    this.ui.setStatus("物品已收回原背包节点。");
    this.skipClickAfterDrag = true;
    return true;
  }
  item.x = event.clientX;
  item.y = event.clientY;
  this.world.returnBackpackItemIfDropped(item) || this.world.returnResourceItemIfDropped(item);
  this.carriedUIItem = null;
  this.carriedUIOrigin = null;
  this.skipClickAfterDrag = true;
  return true;
};

/** 整叠 pile 已黏附光标时，仅空格加左键才会执行放置，普通左键不会误消耗整叠库存。 */
Interaction.prototype.handleCarriedBulkPileDown = function(event) {
  if (!this.carriedBulkPile) return false;
  if (!this.placeKeyHeld) return true;
  const pile = this.carriedBulkPile;
  const point = this.worldPosition(event);
  const target = [...this.world.nodes].reverse().find(node => node.visible && !node.locked && this.hit(node, point));
  const result = this.world.placeBackpackPile(pile, target);
  if (!result.placed) {
    this.ui.setStatus(`无法放置整叠：${result.reason}`);
  } else {
    this.audio.play(result.node?.type || pile.type);
    this.ui.setStatus(result.message);
    this.world.uiNodes.forEach(node => { node.selected = false; node.pileGroupSelected = false; });
    this.carriedBulkPile = null;
    this.carriedBulkPileOrigin = null;
  }
  this.skipClickAfterDrag = true;
  return true;
};

/** 兼容旧的选中状态：只有已黏附的整叠由 handleCarriedBulkPileDown 放置。 */
Interaction.prototype.handleBulkPilePlacementDown = function(event) {
  return false;
};

Interaction.prototype.moveCarriedUI = function(event) {
  if (this.carriedUIItem) { this.carriedUIItem.x = event.clientX; this.carriedUIItem.y = event.clientY; }
};

/** 让整叠背包节点按 UI 屏幕坐标跟随光标，不改变它在背包内的来源锚点。 */
Interaction.prototype.moveCarriedBulkPile = function(event) {
  if (!this.carriedBulkPile) return;
  this.carriedBulkPile.x = event.clientX;
  this.carriedBulkPile.y = event.clientY;
};

Interaction.prototype.moveSelectedUIInteraction = function(event) {
  if (!this.selectedUI) return;
  const moved = Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5;
  if (moved) this.dragging = true;
  if (moved && this.selectedUI.backpackItemOwner && !this.selectedUI.pileGroupSelected) {
    const selectedLayers = this.world.uiNodes.filter(node => node.backpackItemOwner === this.world.backpack && node.type === this.selectedUI.type && node.selected && !node.detached);
    if (selectedLayers.length === 1) this.world.detachBackpackItem(this.selectedUI);
  }
  this.moveSelectedUI(event.clientX - this.lastScreen.x, event.clientY - this.lastScreen.y);
  this.lastScreen = { x: event.clientX, y: event.clientY };
};

Interaction.prototype.moveSelectedUI = function(dx, dy) {
  const selected = this.world.uiNodes.filter(node => node.selected && !node.fixedUI);
  const roots = selected.filter(node => !selected.some(parent => parent.children.includes(node)));
  roots.forEach(node => this.world.moveUI(node, dx, dy));
};

Interaction.prototype.endSelectedUIInteraction = function() {
  if (this.world.returnBackpackItemIfDropped(this.selectedUI)) { this.audio.play("归类"); this.ui.setStatus("物品已归类回原 pile。"); }
  if (this.world.returnResourceItemIfDropped(this.selectedUI)) { this.audio.play("归类"); this.ui.setStatus("资源已归类回原节点。"); }
  if (this.dragging) this.skipClickAfterDrag = true;
  if (this.selectedUI?.pileGroupSelected) this.selectedUI.pileGroupSelected = false;
  this.selectedUI = null;
};

Interaction.prototype.cancelCarriedUI = function(event) {
  if (!this.carriedUIItem) return false;
  event.preventDefault();
  const item = this.carriedUIItem;
  if (item.backpackItemOwner && item.detached) this.world.mergeBackpackItem(item);
  else if (item.resourcePileOwner && item.detached) this.world.mergeResourceItem(item);
  else { item.x = this.carriedUIOrigin.x; item.y = this.carriedUIOrigin.y; }
  this.carriedUIItem = null;
  this.carriedUIOrigin = null;
  return true;
};

/** 右键取消整叠携带，只恢复视觉位置与选择状态，不改变库存。 */
Interaction.prototype.cancelCarriedBulkPile = function(event) {
  if (!this.carriedBulkPile) return false;
  event.preventDefault();
  this.carriedBulkPile.x = this.carriedBulkPileOrigin.x;
  this.carriedBulkPile.y = this.carriedBulkPileOrigin.y;
  this.carriedBulkPile.selected = false;
  this.carriedBulkPile.pileGroupSelected = false;
  this.carriedBulkPile = null;
  this.carriedBulkPileOrigin = null;
  return true;
};

Interaction.prototype.handleDoubleClick = function(event) {
  const item = [...this.world.uiNodes].reverse().find(node => node.backpackItemOwner && node.visible && this.hit(node, event));
  if (item) {
    const pile = item.detached ? item.sourcePile : item;
    if (item.detached) this.world.mergeBackpackItem(item);
    this.world.uiNodes.forEach(node => {
      node.selected = node === pile;
      node.pileGroupSelected = node === pile;
    });
    this.carriedBulkPile = pile;
    this.carriedBulkPileOrigin = { x: pile.x, y: pile.y };
    this.ui.setStatus(`已拿起 ${pile.type} ×${pile.quantity}：按住空格并左键点击目标可放置整叠，右键取消。`);
    return;
  }
  const resource = [...this.world.uiNodes].reverse().find(node => node.resourcePileOwner && node.visible && this.hit(node, event));
  if (!resource) return;
  const source = resource.sourcePile || resource;
  [...source.children].filter(node => node.detached).forEach(node => this.world.mergeResourceItem(node));
  this.world.uiNodes.forEach(node => node.selected = node === source);
  this.ui.setStatus(`${source.type} 已收起。`);
};
})();
