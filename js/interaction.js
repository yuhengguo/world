/*
 * 鼠标交互控制器。
 * 这里将鼠标坐标转换为世界坐标，并把点击、拖拽、缩放、采集模式分发给 World。
 */

(() => {
const { NODE_SIZE, ZOOM } = window.TreeWorld;

class Interaction {
  constructor(canvas, world, ui, audio) {
    this.canvas = canvas;
    this.world = world;
    this.ui = ui;
    this.audio = audio;
    this.camera = { x: 0, y: 0, scale: 1 };
    this.hovered = null;
    this.selected = null;
    this.selectedUI = null;
    this.selectionBox = null;
    this.wasSelectedOnDown = false;
    this.skipClickAfterDrag = false;
    this.handActive = false;
    this.mouthActive = false;
    this.harvestTarget = null;
    this.carriedTerminal = null;
    this.carriedTerminalOrigin = null;
    this.carriedUIItem = null;
    this.carriedUIOrigin = null;
    this.splitControl = null;
    this.quantityInput = document.getElementById("splitInput");
    this.quantityInputNode = null;
    this.dragging = false;
    this.middle = false;
    this.down = null;
    this.lastWorld = null;
    this.lastScreen = null;
    this.bind();
  }

  /** 将屏幕坐标换算为缩放和平移后的世界坐标。 */
  worldPosition(event) {
    const screenX = event.clientX ?? event.x;
    const screenY = event.clientY ?? event.y;
    return { x: (screenX - this.camera.x) / this.camera.scale, y: (screenY - this.camera.y) / this.camera.scale };
  }

  /** 判断一点是否落在节点矩形范围内。 */
  hit(node, point) {
    return Math.abs(point.x - node.x) < NODE_SIZE.width / 2 && Math.abs(point.y - node.y) < NODE_SIZE.height / 2;
  }

  /** 判断是否点中背包数值节点右下角的数量分离条。 */
  hitSplitBar(node, event) {
    return node.isNumericPile && !node.detached
      && event.clientX >= node.x + 10 && event.clientX <= node.x + 43
      && event.clientY >= node.y + 15 && event.clientY <= node.y + 27;
  }

  /** 判断是否点中数值节点左下的直接输入框区域。 */
  hitQuantityBox(node, event) {
    return node.isNumericPile && !node.detached
      && event.clientX >= node.x - 46 && event.clientX <= node.x + 2
      && event.clientY >= node.y + 14 && event.clientY <= node.y + 30;
  }

  /** 按鼠标在分离条中的水平位置换算本次需要拆出的数量。 */
  updateSplitAmount(node, clientX) {
    const minimum = 1;
    const maximum = Math.max(minimum, node.quantity - minimum);
    const ratio = Math.max(0, Math.min(1, (clientX - (node.x + 10)) / 33));
    const value = minimum + ratio * (maximum - minimum);
    node.splitAmount = Math.round(value);
  }

  /** 打开覆盖在节点上的原生输入框，让玩家直接键入要拆出的数值。 */
  openQuantityInput(node) {
    const minimum = 1;
    const maximum = Math.max(minimum, node.quantity - minimum);
    this.quantityInputNode = node;
    this.quantityInput.min = String(minimum);
    this.quantityInput.max = String(maximum);
    this.quantityInput.step = String(minimum);
    this.quantityInput.value = String(node.splitAmount || minimum);
    this.quantityInput.style.left = `${node.x - 46}px`;
    this.quantityInput.style.top = `${node.y + 14}px`;
    this.quantityInput.hidden = false;
    this.quantityInput.focus();
    this.quantityInput.select();
  }

  /** 将输入框的值裁剪到可拆范围，并同步给滑条。 */
  commitQuantityInput() {
    const node = this.quantityInputNode;
    if (!node) return;
    const minimum = 1;
    const maximum = Math.max(minimum, node.quantity - minimum);
    const parsed = Number(this.quantityInput.value);
    const value = Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : minimum;
    node.splitAmount = Math.round(value);
    this.quantityInput.hidden = true;
    this.quantityInputNode = null;
  }

  /** 判断节点中心是否位于当前框选区域内。 */
  selectInBox() {
    const start = this.worldPosition(this.selectionBox.start);
    const end = this.worldPosition(this.selectionBox.end);
    const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
    const worldSelection = this.world.nodes.filter(node => node.visible && node.x >= left && node.x <= right && node.y >= top && node.y <= bottom);
    // 框选只服务于世界节点；UI 只能通过双击 pile 或直接拖动物品操作。
    this.world.nodes.forEach(node => node.selected = worldSelection.includes(node));
  }

  /** 移动当前选中的最外层节点，避免父子同时选中时重复移动。 */
  moveSelectedNodes(dx, dy) {
    const selected = this.world.nodes.filter(node => node.selected);
    const roots = selected.filter(node => !selected.some(parent => parent.children.includes(node)));
    roots.forEach(node => this.world.moveTree(node, dx, dy));
  }

  /** 移动框选的 UI 根节点；父节点被选中时不再重复移动其 UI 子节点。 */
  moveSelectedUI(dx, dy) {
    const selected = this.world.uiNodes.filter(node => node.selected && !node.fixedUI);
    const roots = selected.filter(node => !selected.some(parent => parent.children.includes(node)));
    roots.forEach(node => this.world.moveUI(node, dx, dy));
  }

  /** 让已黏附的手回到身体右侧，并恢复常规鼠标。 */
  returnHand() {
    const hand = this.world.uiNodes.find(node => node.type === "手");
    if (!hand) return;
    this.handActive = false;
    this.harvestTarget = null;
    const home = this.world.toolHomePosition("手");
    hand.x = home.x;
    hand.y = home.y;
    this.canvas.style.cursor = "default";
    this.ui.setStatus("手已回到身体旁。");
  }

  /** 更新悬停目标；隐藏问号不是 world.nodes，因此天然不可命中。 */
  updateHover(event) {
    this.hovered = null;
    if (!this.handActive) {
      this.hovered = [...this.world.uiNodes].reverse().find(node => node.visible && this.hit(node, event)) || null;
    }
    if (!this.hovered) {
      const point = this.worldPosition(event);
      this.hovered = this.world.nodes.find(node => node.visible && !node.locked && this.hit(node, point)) || null;
    }
    if (!this.handActive) this.canvas.style.cursor = this.hovered ? "pointer" : "default";
  }

  /** 处理固定 UI 节点点击。返回 true 表示事件已被消耗。 */
  handleUIClick(node, event) {
    this.world.uiNodes.forEach(item => item.selected = false);
    node.selected = true;
    if (node.type === "背包") {
      this.audio.play(node.type);
      const open = this.ui.toggleBackpack();
      this.world.setBackpackOpen(open, this.canvas.width);
      return true;
    }
    if (node.type === "刷新") {
      this.onReset?.();
      return true;
    }
    if (node.type === "思考") {
      this.ui.setStatus("思考节点：之后可以在这里接入想法或任务。");
      return true;
    }
    if (node.type === "手") {
      if (node.lost) { this.ui.setStatus("手已经磨损殆尽，无法再使用。"); return true; }
      this.handActive = true;
      node.x = event.clientX;
      node.y = event.clientY;
      this.canvas.style.cursor = "none";
      this.ui.setStatus("手已跟随光标：连续点击终端节点 4 次即可摘除。");
      return true;
    }
    if (node.type === "嘴") {
      if (node.lost) { this.ui.setStatus("嘴已经磨损殆尽，无法再使用。"); return true; }
      this.mouthActive = true;
      node.x = event.clientX;
      node.y = event.clientY;
      this.canvas.style.cursor = "none";
      this.ui.setStatus("嘴已跟随光标：点击背包中的花或种子即可进食。");
      return true;
    }
    if (node.type === "身体") {
      if (this.handActive) this.returnHand();
      const open = this.world.toggleBody();
      this.audio.play(node.type);
      this.ui.setStatus(open ? "手节点已出现，点击手即可开始采集。" : "身体已收起。");
      return true;
    }
    if (node.backpackItemOwner) {
      this.ui.setStatus(`背包物品：${node.type}`);
      return true;
    }
    return false;
  }

  /** 注册所有 Canvas 事件。 */
  bind() {
    this.quantityInput.addEventListener("change", () => this.commitQuantityInput());
    this.quantityInput.addEventListener("blur", () => this.commitQuantityInput());
    this.quantityInput.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); this.commitQuantityInput(); }
      if (event.key === "Escape") { this.quantityInput.hidden = true; this.quantityInputNode = null; }
    });
    this.canvas.addEventListener("mousedown", event => {
      if (event.button === 1) {
        this.middle = true; this.lastScreen = { x: event.clientX, y: event.clientY }; return;
      }
      if (event.button !== 0) return;
      // 第二次左键将已拾取的终端节点放在当前光标位置。
      if (this.carriedTerminal) {
        const point = this.worldPosition(event);
        this.carriedTerminal.x = point.x;
        this.carriedTerminal.y = point.y;
        this.carriedTerminal = null;
        this.carriedTerminalOrigin = null;
        this.skipClickAfterDrag = true;
        return;
      }
      // pile 单层第二次左键放置；若放回原 pile 区域，自动重新归类。
      if (this.carriedUIItem) {
        // 双击已拆出的背包物品时，无论它当前在哪里都强制归回来源节点。
        if (event.detail >= 2 && this.carriedUIItem.backpackItemOwner && this.carriedUIItem.detached) {
          this.world.mergeBackpackItem(this.carriedUIItem);
          this.carriedUIItem = null;
          this.carriedUIOrigin = null;
          this.skipClickAfterDrag = true;
          this.ui.setStatus("物品已收回原背包节点。");
          return;
        }
        this.carriedUIItem.x = event.clientX;
        this.carriedUIItem.y = event.clientY;
        this.world.returnBackpackItemIfDropped(this.carriedUIItem) || this.world.returnResourceItemIfDropped(this.carriedUIItem);
        this.carriedUIItem = null;
        this.carriedUIOrigin = null;
        this.skipClickAfterDrag = true;
        return;
      }
      const uiNode = !this.handActive && !this.mouthActive && [...this.world.uiNodes].reverse().find(node => node.visible && this.hit(node, event));
      if (uiNode) {
        if (["手", "嘴", "身体", "背包", "思考", "刷新"].includes(uiNode.type)) {
          this.handleUIClick(uiNode, event);
          // 固定 UI 已在按下时处理，阻止紧随其后的 click 再执行一次切换。
          this.skipClickAfterDrag = true;
          return;
        }
        if (uiNode.fixedUI && !uiNode.resourcePileOwner) return;
        if (this.hitQuantityBox(uiNode, event)) { this.openQuantityInput(uiNode); return; }
        // 背包数值节点右下角的分离条只调整数量，不会触发拖动。
        if (this.hitSplitBar(uiNode, event)) {
          this.splitControl = uiNode;
          this.updateSplitAmount(uiNode, event.clientX);
          return;
        }
        // 点击背包节点会按分离条数量拆出；仅剩一件时则移动整个节点。
        if (uiNode.backpackItemOwner || uiNode.resourcePileOwner) {
          // 双击选中的背包节点下一次拖动保持整体，不再触发拆分。
          if (uiNode.pileGroupSelected) {
            this.selectedUI = uiNode;
            this.down = { x: event.clientX, y: event.clientY };
            this.lastScreen = { x: event.clientX, y: event.clientY };
            this.dragging = false;
            return;
          }
          const detached = uiNode.backpackItemOwner
            ? this.world.detachBackpackItem(uiNode)
            : this.world.detachResourceItem(uiNode);
          if (uiNode.resourcePileOwner && !detached) {
            this.ui.setStatus("资源节点需至少保留 1，无法继续拆出。");
            return;
          }
          const carried = detached || uiNode;
          this.carriedUIItem = carried;
          this.carriedUIOrigin = { x: carried.x, y: carried.y, detached: carried.detached };
          this.skipClickAfterDrag = true;
          return;
        }
        if (!uiNode.selected) {
          this.world.uiNodes.forEach(node => node.selected = false);
          uiNode.selected = true;
        }
        this.selectedUI = uiNode;
        this.down = { x: event.clientX, y: event.clientY };
        this.lastScreen = { x: event.clientX, y: event.clientY };
        this.dragging = false;
        return;
      }

      // 嘴只会处理背包物品；点到世界节点时完全不触发拖动、采集或节点黏附。
      if (this.mouthActive) return;

      // 采集模式下禁止选中或拖动树，避免微小鼠标位移带动整个结构。
      if (this.handActive) return;
      const point = this.worldPosition(event);
      const node = this.world.nodes.find(item => item.visible && !item.locked && this.hit(item, point));
      if (!node) {
        // 空白处按住左键进入框选模式，选框使用屏幕坐标以便直接绘制。
        this.selectionBox = { start: { x: event.clientX, y: event.clientY }, end: { x: event.clientX, y: event.clientY } };
        return;
      }
      // 终端节点使用拾取式拖动：第一次左键黏附到光标，不进入选中状态。
      if (this.world.isHarvestable(node)) {
        this.carriedTerminal = node;
        this.carriedTerminalOrigin = { x: node.x, y: node.y };
        this.skipClickAfterDrag = true;
        return;
      }
      this.wasSelectedOnDown = node.selected;
      this.selected = node;
      this.down = { x: event.clientX, y: event.clientY };
      this.lastWorld = point;
      this.dragging = false;
    });

    this.canvas.addEventListener("mousemove", event => {
      if (this.splitControl) this.updateSplitAmount(this.splitControl, event.clientX);
      if (this.handActive) {
        const hand = this.world.uiNodes.find(node => node.type === "手");
        if (hand) { hand.x = event.clientX; hand.y = event.clientY; }
      }
      if (this.mouthActive) {
        const mouth = this.world.uiNodes.find(node => node.type === "嘴");
        if (mouth) { mouth.x = event.clientX; mouth.y = event.clientY; }
      }
      if (this.carriedTerminal) {
        const point = this.worldPosition(event);
        this.carriedTerminal.x = point.x;
        this.carriedTerminal.y = point.y;
      }
      if (this.carriedUIItem) {
        this.carriedUIItem.x = event.clientX;
        this.carriedUIItem.y = event.clientY;
      }
      if (this.middle) {
        this.camera.x += event.clientX - this.lastScreen.x;
        this.camera.y += event.clientY - this.lastScreen.y;
        this.lastScreen = { x: event.clientX, y: event.clientY };
      }
      if (this.selectedUI) {
        const moved = Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5;
        if (moved) this.dragging = true;
        // 只有“单独选中的一层”拖动时才拆出；双击选中的整个 pile 保持整体移动。
        if (moved && this.selectedUI.backpackItemOwner && !this.selectedUI.pileGroupSelected) {
          const selectedLayers = this.world.uiNodes.filter(node => node.backpackItemOwner === this.world.backpack && node.type === this.selectedUI.type && node.selected && !node.detached);
          if (selectedLayers.length === 1) this.world.detachBackpackItem(this.selectedUI);
        }
        this.moveSelectedUI(event.clientX - this.lastScreen.x, event.clientY - this.lastScreen.y);
        this.lastScreen = { x: event.clientX, y: event.clientY };
      }
      if (this.selectionBox) {
        // 只更新右下角，不移动任何世界节点。
        this.selectionBox.end = { x: event.clientX, y: event.clientY };
        // 框选结束后的 click 不应再触发节点展开。
        if (Math.hypot(event.clientX - this.selectionBox.start.x, event.clientY - this.selectionBox.start.y) > 5) this.dragging = true;
      }
      if (this.selected) {
        const point = this.worldPosition(event);
        if (Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > 5) this.dragging = true;
        if (this.selected.selected) this.moveSelectedNodes(point.x - this.lastWorld.x, point.y - this.lastWorld.y);
        else this.world.moveTree(this.selected, point.x - this.lastWorld.x, point.y - this.lastWorld.y);
        this.lastWorld = point;
      }
      this.updateHover(event);
    });

    this.canvas.addEventListener("mouseup", event => {
      if (event.button === 1) this.middle = false;
      if (this.splitControl) {
        this.splitControl = null;
        this.skipClickAfterDrag = true;
      }
      if (this.selectionBox) {
        this.selectInBox();
        this.selectionBox = null;
      }
      this.selected = null;
      // 松开拆出物品时，若落在原 pile 范围内便自动回收并重新叠放。
      if (this.world.returnBackpackItemIfDropped(this.selectedUI)) {
        this.audio.play("归类");
        this.ui.setStatus("物品已归类回原 pile。 ");
      }
      if (this.world.returnResourceItemIfDropped(this.selectedUI)) {
        this.audio.play("归类");
        this.ui.setStatus("资源已归类回原节点。");
      }
      // 拖拽结束后必须吞掉紧随其后的 click，避免被误判为一次交互点击。
      if (this.dragging) this.skipClickAfterDrag = true;
      if (this.selectedUI?.pileGroupSelected) this.selectedUI.pileGroupSelected = false;
      this.selectedUI = null;
    });

    this.canvas.addEventListener("click", event => {
      if (this.skipClickAfterDrag) {
        this.skipClickAfterDrag = false;
        this.dragging = false;
        return;
      }
      if (this.dragging) { this.dragging = false; return; }
      if (this.mouthActive) {
        const food = [...this.world.uiNodes].reverse().find(node => node.backpackItemOwner && node.edible && node.visible && this.hit(node, event));
        if (!food) return;
        const result = this.world.eatBackpackItem(food);
        if (!result.eaten) return;
        const wear = this.world.wearTool("嘴", this.world.toolWearFor("嘴", food));
        if (wear.broken) this.mouthActive = false;
        this.ui.setStatus(result.poisoned ? "吃下了中毒食物，生命受损。" : "吃下食物，饥饿值得到补充。 ");
        return;
      }
      const uiNode = !this.handActive && [...this.world.uiNodes].reverse().find(node => node.visible && this.hit(node, event));
      if (uiNode && this.handleUIClick(uiNode, event)) return;
      const point = this.worldPosition(event);
      if (this.handActive) {
        if (this.world.gameOver) { this.ui.setStatus("游戏结束：请点击“重新开始”。"); return; }
        const target = this.world.nodes.find(node => node.visible && (this.world.isHarvestable(node) || this.world.isIndestructible(node)) && this.hit(node, point));
        if (!target) return;
        if (this.world.touchIndestructible(target, performance.now())) {
          this.ui.setStatus(`触碰到${target.type}：它无法被采集。`);
          return;
        }
        // 切换目标会放弃前一个未完成节点的进度。
        if (this.harvestTarget && this.harvestTarget !== target) this.harvestTarget.harvestProgress = 0;
        this.harvestTarget = target;
        this.audio.play(target.type);
        const resourceResult = this.world.consumeHarvestResources(target);
        if (resourceResult.gameOver) { this.ui.setStatus("生命归零，游戏结束。请点击“重新开始”。"); return; }
        const result = this.world.harvest(target, performance.now());
        const wear = this.world.wearTool("手", this.world.toolWearFor("手", target));
        if (wear.broken) {
          this.handActive = false;
          this.canvas.style.cursor = "default";
        }
        if (result.completed && this.ui.backpackOpen) this.world.setBackpackOpen(true, this.canvas.width);
        if (!result.completed) this.ui.setStatus(`采集 ${target.type}：${target.harvestProgress}/${result.required}`);
        else {
          this.harvestTarget = null;
          this.ui.setStatus(`已摘除 ${target.type}，已放入背包。`);
        }
        return;
      }
      const node = this.world.nodes.find(item => item.visible && !item.locked && this.hit(item, point));
      if (!node) return;
      if (this.world.touchIndestructible(node, performance.now())) {
        this.ui.setStatus(`触碰到${node.type}：它无法被采集。`);
        return;
      }
      if (!this.wasSelectedOnDown) {
        this.world.nodes.forEach(item => item.selected = false);
        node.selected = true;
        return;
      }
      if (node.open) this.world.collapse(node);
      else { this.world.expand(node); this.audio.play(node.type); }
    });

    this.canvas.addEventListener("contextmenu", event => {
      if (this.carriedTerminal) {
        event.preventDefault();
        this.carriedTerminal.x = this.carriedTerminalOrigin.x;
        this.carriedTerminal.y = this.carriedTerminalOrigin.y;
        this.carriedTerminal = null;
        this.carriedTerminalOrigin = null;
        return;
      }
      if (this.carriedUIItem) {
        event.preventDefault();
        const item = this.carriedUIItem;
        if (item.backpackItemOwner && item.detached) this.world.mergeBackpackItem(item);
        else if (item.resourcePileOwner && item.detached) this.world.mergeResourceItem(item);
        else {
          item.x = this.carriedUIOrigin.x;
          item.y = this.carriedUIOrigin.y;
        }
        this.carriedUIItem = null;
        this.carriedUIOrigin = null;
        return;
      }
      if (this.mouthActive) {
        event.preventDefault();
        const mouth = this.world.uiNodes.find(node => node.type === "嘴");
        if (mouth) {
          const home = this.world.toolHomePosition("嘴");
          mouth.x = home.x;
          mouth.y = home.y;
        }
        this.mouthActive = false;
        this.canvas.style.cursor = "default";
        return;
      }
      if (!this.handActive) return;
      event.preventDefault();
      this.returnHand();
    });

    this.canvas.addEventListener("wheel", event => {
      event.preventDefault();
      const old = this.camera.scale;
      this.camera.scale = Math.max(ZOOM.min, Math.min(ZOOM.max, old * Math.exp(-event.deltaY * ZOOM.sensitivity)));
      this.camera.x = event.clientX - (event.clientX - this.camera.x) * this.camera.scale / old;
      this.camera.y = event.clientY - (event.clientY - this.camera.y) * this.camera.scale / old;
    }, { passive: false });

    // 双击任意背包物品：已拆出物品先归位，再选择同类 pile 的全部层。
    this.canvas.addEventListener("dblclick", event => {
      const item = [...this.world.uiNodes].reverse().find(node => node.backpackItemOwner && node.visible && this.hit(node, event));
      if (item) {
        if (item.detached) {
          this.world.mergeBackpackItem(item);
        }
        this.world.uiNodes.forEach(node => node.selected = node.backpackItemOwner === this.world.backpack && !node.detached && node.type === item.type);
        this.world.uiNodes.filter(node => node.backpackItemOwner === this.world.backpack && !node.detached && node.type === item.type).forEach(node => node.pileGroupSelected = true);
        this.ui.setStatus(`已选中 ${item.type} pile。`);
        return;
      }
      const resource = [...this.world.uiNodes].reverse().find(node => node.resourcePileOwner && node.visible && this.hit(node, event));
      if (!resource) return;
      const source = resource.sourcePile || resource;
      [...source.children].filter(node => node.detached).forEach(node => this.world.mergeResourceItem(node));
      this.world.uiNodes.forEach(node => node.selected = node === source);
      this.ui.setStatus(`${source.type} 已收起。`);
    });
  }
}

window.TreeWorld.Interaction = Interaction;
})();
