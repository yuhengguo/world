/*
 * Canvas 渲染器。
 * 不修改游戏数据，只按当前 world、ui 与交互状态绘制每一帧。
 */

(() => {
const { emoji, HARVEST_CLICKS_BY_TYPE, NODE_SIZE } = window.TreeWorld;

class Renderer {
  constructor(canvas, world, ui, workspacePanel = null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.world = world;
    this.ui = ui;
    this.workspacePanel = workspacePanel;
  }

  /** 绘制普通节点；采集颤动仅作用于这个节点自身的视觉内容。 */
  drawNode(node, hovered, handActive, now, scale = 1, activeBlue = null, allowMultipleBlue = false) {
    const { ctx } = this;
    ctx.save();
    // 手、嘴等指定 UI 工具围绕自身中心缩放，位置仍保持在屏幕坐标系中。
    if (scale !== 1) {
      ctx.translate(node.x, node.y);
      ctx.scale(scale, scale);
      ctx.translate(-node.x, -node.y);
    }
    if (node.shakeUntil > now) ctx.translate(Math.sin(now * .045) * 4, Math.cos(now * .0765) * 3);
    ctx.globalAlpha = node.type === "手" && handActive ? .45 : .78;
    // 常规状态只让一个焦点节点变蓝；框选作为特殊状态，允许多节点同时显示蓝色。
    const blue = activeBlue ? node === activeBlue : (allowMultipleBlue ? node.selected : node.selected);
    ctx.fillStyle = blue ? "#1976d2" : "#222";
    ctx.fillRect(node.x - 50, node.y - 30, NODE_SIZE.width, NODE_SIZE.height);
    ctx.strokeStyle = "#aaa";
    ctx.strokeRect(node.x - 50, node.y - 30, NODE_SIZE.width, NODE_SIZE.height);
    ctx.fillStyle = "white";
    ctx.font = "32px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji[node.type] || "?", node.x, node.y - 4);
    // 自定义分类显示玩家填写的名称；类型本身仍保留为“自定义”，便于规则与详情页识别。
    if (node.customNode) {
      ctx.fillStyle = "#dff4ff";
      ctx.font = "11px Microsoft YaHei";
      ctx.fillText(node.customLabel || "未命名分类", node.x, node.y + 19);
    }

    if (node.harvestProgress) {
      ctx.fillStyle = "#555";
      ctx.fillRect(node.x - 35, node.y + 17, 70, 7);
      ctx.fillStyle = "#65c466";
      const required = HARVEST_CLICKS_BY_TYPE[node.type] || 4;
      ctx.fillRect(node.x - 35, node.y + 17, 70 * node.harvestProgress / required, 7);
    }
    // 背包物品使用“一个节点 + 左下数量”表达重复物品；不再绘制多层卡片。
    if (node.isNumericPile) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px Microsoft YaHei";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      const quantity = Number.isInteger(node.quantity) ? node.quantity : node.quantity.toFixed(1);
      ctx.fillText(`×${quantity}`, node.x - 44, node.y + 24);
      // 原节点右下角只保留直接输入数量的框；滑条已取消。
      const minimum = 1;
      if (!node.detached && !node.worldPile && node.quantity > minimum) {
        ctx.strokeStyle = "#8bd3ff";
        ctx.strokeRect(node.x + 1, node.y + 14, 47, 16);
        // 输入框关闭后仍显示最近确认的分离数量，让玩家知道下一次会拆出多少。
        ctx.fillStyle = "#dff4ff";
        ctx.font = "11px Microsoft YaHei";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const splitAmount = Number(node.splitAmount || minimum);
        const splitLabel = Number.isInteger(splitAmount) ? String(splitAmount) : splitAmount.toFixed(1);
        ctx.fillText(splitLabel, node.x + 24, node.y + 22);
      }
    }
    // 手、嘴的底部耐久条独立于采集进度条；归零后该节点会被隐藏。
    if (node.durability !== null && node.durability !== undefined) {
      ctx.fillStyle = "#4a1e1e";
      ctx.fillRect(node.x - 35, node.y + 25, 70, 4);
      ctx.fillStyle = "#ff8a65";
      ctx.fillRect(node.x - 35, node.y + 25, 70 * node.durability / 100, 4);
    }
    // 背包与每个自定义分类都拥有“添加直接子分类 / 删除最近子分类”两个局部控制按钮。
    if (node === this.world.backpack || node.customNode) {
      ctx.fillStyle = "#8bd3ff";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+", node.x - 34, node.y + 20);
      ctx.fillText("−", node.x + 34, node.y + 20);
    }
    if (hovered === node) {
      ctx.fillStyle = "#ddd";
      ctx.font = "14px Microsoft YaHei";
      ctx.fillText(node.customNode ? node.customLabel : node.type, node.x, node.y + 48);
    }
    ctx.restore();
  }

  /**
   * 绘制未出现的土层。递归绘制整条链，所以树下有几张问号卡，
   * 就表示后面确实还保留几层土；这些卡片从不参与鼠标命中。
   */
  drawHiddenChain(node) {
    const next = node.underlays[0];
    if (!next || next.visible) return;
    const { ctx } = this;

    // 先画更远的一层，再画更近的一层；树节点最终在最下端、最上层显示。
    this.drawHiddenChain(next);

    ctx.save();
    ctx.translate(next.x, next.y);
    ctx.globalAlpha = .72;
    ctx.fillStyle = "#2d2921";
    ctx.fillRect(-50, -30, NODE_SIZE.width, NODE_SIZE.height);
    ctx.strokeStyle = "#c9b486";
    ctx.strokeRect(-50, -30, NODE_SIZE.width, NODE_SIZE.height);
    ctx.fillStyle = "#f4df9f";
    ctx.font = "32px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 0, 0);
    ctx.restore();
  }

  /** 绘制背包内容面板。 */
  drawInventory() {
    if (!this.ui.backpackOpen) return;
    const { ctx, canvas, world } = this;
    const items = Object.entries(world.inventory);
    const x = 145, y = canvas.height - 165, height = Math.max(95, items.length * 30 + 55);
    ctx.fillStyle = "rgba(20,20,20,.92)";
    ctx.fillRect(x, y, 185, height);
    ctx.strokeStyle = "#aaa";
    ctx.strokeRect(x, y, 185, height);
    ctx.fillStyle = "white";
    ctx.font = "16px Microsoft YaHei";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("背包", x + 16, y + 24);
    if (!items.length) {
      ctx.fillStyle = "#bbb";
      ctx.fillText("还没有采集物品", x + 16, y + 55);
      return;
    }
    items.forEach(([type, count], index) => ctx.fillText(`${emoji[type]}  ${type} × ${count}`, x + 16, y + 56 + index * 28));
  }

  /**
   * 绘制背包到库存节点的连接线。
   * 同类物品的重叠节点视为一个 pile，连线只指向这一叠的中心点。
   */
  drawBackpackLinks(pointForNode = node => node, floatingOnly = false) {
    const { ctx, world, ui } = this;
    if (!ui.backpackOpen) return;
    ctx.strokeStyle = "#777";
    // 分类树中的每条父子关系都以一根线表示；普通 pile 与自定义分类使用同一套树结构。
    const drawTreeLinks = parent => parent.children.forEach(child => {
      // 根背包下仍有来源 pile 的拆分物只画来源线；已脱离来源的独立份额则应画回背包连线。
      if (child.detached && !parent.customNode && child.sourcePile) return;
      if (!parent.visible || !child.visible) return;
      const crossesWorkspaceBoundary = Boolean(parent.workspaceFloating || child.workspaceFloating);
      // 普通连线由工作区裁切；只有拖到世界中的物品连线可以越过工作区边框。
      if (crossesWorkspaceBoundary !== floatingOnly) {
        if (child.customNode) drawTreeLinks(child);
        return;
      }
      const from = pointForNode(parent);
      const to = pointForNode(child);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      if (child.customNode) drawTreeLinks(child);
    });
    drawTreeLinks(world.backpack);

    // 已拆出的物品从原 pile 左侧中心引出一条独立连线。
    world.allBackpackItems().filter(item => item.detached).forEach(item => {
      if (Boolean(item.workspaceFloating || item.sourcePile?.workspaceFloating) !== floatingOnly) return;
      const source = item.sourcePile;
      const sourcePoint = source ? pointForNode(source) : pointForNode(item);
      const itemPoint = pointForNode(item);
      ctx.beginPath();
      ctx.moveTo(sourcePoint.x, sourcePoint.y);
      ctx.lineTo(itemPoint.x, itemPoint.y);
      ctx.stroke();
    });
  }

  /** 绘制独立的背包工作区；其中内容使用工作区自己的坐标缩放。 */
  drawWorkspacePanel(hovered, handActive, now, activeBlue, allowMultipleBlue) {
    const panel = this.workspacePanel;
    if (!panel) return;
    const { ctx, canvas, world } = this;
    const controls = panel.controls();
    if (panel.open) {
      ctx.save();
      // 使用与世界画布一致的底色遮住下方节点，使工作区清晰独立但不显得突兀。
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, panel.width, canvas.height);
      ctx.strokeStyle = "rgba(139, 211, 255, .45)";
      ctx.beginPath(); ctx.moveTo(panel.width, 0); ctx.lineTo(panel.width, canvas.height); ctx.stroke();
      // 限制内容不画出面板边界；世界层依旧在面板下方正常显示。
      ctx.beginPath(); ctx.rect(0, 0, panel.width, canvas.height); ctx.clip();
      // 普通背包连线也放在裁切区域内，避免缩窄面板后泄漏到世界层。
      this.drawBackpackLinks(node => panel.displayPoint(node));
      world.uiNodes
        .filter(node => panel.isContentNode(node) && !panel.scalesContentNode(node) && !node.workspaceFloating && node.visible)
        // 入口位置不变，但卡片大小与工作区内容比例统一。
        .forEach(node => this.drawNode(node, hovered, handActive, now, panel.contentScale, activeBlue, allowMultipleBlue));
      const anchor = panel.contentAnchor();
      ctx.translate(anchor.x, anchor.y);
      ctx.scale(panel.contentScale, panel.contentScale);
      ctx.translate(-anchor.x, -anchor.y);
      world.uiNodes
        .filter(node => panel.scalesContentNode(node) && node.visible)
        .forEach(node => this.drawNode(node, hovered, handActive, now, 1, activeBlue, allowMultipleBlue));
      ctx.restore();
    }
    // 只有实际拖到世界中的物品，才允许来源线越过工作区边界。
    this.drawBackpackLinks(node => panel.displayPoint(node), true);
    // 被玩家拖出工作区的背包物品改在世界屏幕层绘制，仍通过上方计算过的线连回来源 pile。
    world.uiNodes
      .filter(node => panel.isContentNode(node) && node.workspaceFloating && node.visible)
      .forEach(node => this.drawNode(node, hovered, handActive, now, 1, activeBlue, allowMultipleBlue));
    // 开启时 < 与 > 分开绘制；> 同时是可拖动的宽度把手。
    Object.entries(controls).forEach(([kind, box]) => {
      ctx.save();
      ctx.fillStyle = "rgba(37, 69, 88, .9)";
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = "#8bd3ff";
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = "white";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(kind === "collapse" ? "<" : ">", box.x + box.width / 2, box.y + box.height / 2);
      ctx.restore();
    });
  }

  /** 绘制底部资源原节点与各个拆出节点之间的连接线。 */
  drawResourceLinks() {
    const { ctx, world } = this;
    ctx.strokeStyle = "#777";
    Object.values(world.resourcePiles || {}).forEach(source => {
      source.children.filter(item => item.detached).forEach(item => {
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(item.x, item.y);
        ctx.stroke();
      });
    });
  }

  /**
   * 绘制独立的背景天文层。
   * 天空与昼夜天体使用屏幕坐标、不受相机缩放影响，但必须先于世界节点绘制，
   * 这样无论它们移动到哪里，山、森林与资源节点都会自然遮挡在它们前方。
   */
  drawCelestialLayer(hovered, handActive, now, activeBlue, allowMultipleBlue) {
    const { ctx, world } = this;
    const celestialNodes = world.uiNodes.filter(node => node.celestialUI && node.visible);
    if (!celestialNodes.length) return;

    // 先画天空到当前可见天体的连线，再画节点本身，使线端落在节点卡片下方。
    celestialNodes.filter(node => node !== world.sky).forEach(node => {
      ctx.strokeStyle = "#777";
      ctx.beginPath(); ctx.moveTo(world.sky.x, world.sky.y); ctx.lineTo(node.x, node.y); ctx.stroke();
    });
    celestialNodes.forEach(node => this.drawNode(node, hovered, handActive, now, 1, activeBlue, allowMultipleBlue));
  }

  /** 按当前相机位置完整绘制一帧。 */
  /** 绘制鼠标框选区域；它位于屏幕层，不受世界相机坐标转换影响。 */
  drawSelectionBox(box) {
    if (!box) return;
    const { ctx } = this;
    const left = Math.min(box.start.x, box.end.x), top = Math.min(box.start.y, box.end.y);
    const width = Math.abs(box.end.x - box.start.x), height = Math.abs(box.end.y - box.start.y);
    ctx.fillStyle = "rgba(25,118,210,.18)";
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = "#64b5f6";
    ctx.strokeRect(left, top, width, height);
  }

  /** 生命归零时覆盖画布，明确告知用户采集已经被冻结。 */
  drawGameOver() {
    if (!this.world.gameOver) return;
    const { ctx, canvas } = this;
    ctx.fillStyle = "rgba(0,0,0,.62)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ff8a80";
    ctx.font = "bold 42px Microsoft YaHei";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("生命归零 · 游戏结束", canvas.width / 2, canvas.height / 2 - 22);
    ctx.fillStyle = "white";
    ctx.font = "20px Microsoft YaHei";
    ctx.fillText("点击“重新开始”创建一局新的游戏", canvas.width / 2, canvas.height / 2 + 28);
  }

  draw(camera, hovered, handActive, now, selectionBox, activeBlue = null) {
    const { ctx, canvas, world } = this;
    const selectedWorldCount = world.nodes.filter(node => node.selected).length;
    const selectedUICount = world.uiNodes.filter(node => node.selected).length;
    // 框选结束后保留的多选也视为框选特殊状态，直到玩家进行新的单节点操作。
    const allowMultipleBlue = !activeBlue && (Boolean(selectionBox) || selectedWorldCount + selectedUICount > 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 背景天文层必须在相机世界层之前落笔，不能与普通 UI 一起绘制到最前方。
    this.drawCelestialLayer(hovered, handActive, now, activeBlue, allowMultipleBlue);
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.scale, camera.scale);
    // 仅为当前可见的节点绘制问号地下层；收起森林后，被隐藏的树不应继续露出其地下卡片。
    world.nodes.forEach(node => node.visible && this.drawHiddenChain(node));
    world.edges.forEach(edge => {
      if (!edge.from.visible || !edge.to.visible) return;
      ctx.strokeStyle = "#777";
      ctx.beginPath(); ctx.moveTo(edge.from.x, edge.from.y); ctx.lineTo(edge.to.x, edge.to.y); ctx.stroke();
    });
    world.nodes.forEach(node => node.visible && this.drawNode(node, hovered, handActive, now, 1, activeBlue, allowMultipleBlue));
    ctx.restore();

    const hand = world.uiNodes.find(node => node.type === "手");
    if (hand?.visible) {
      ctx.strokeStyle = "#777";
      ctx.beginPath(); ctx.moveTo(world.body.x, world.body.y); ctx.lineTo(hand.x, hand.y); ctx.stroke();
    }
    const mouth = world.uiNodes.find(node => node.type === "嘴");
    if (mouth?.visible) {
      ctx.strokeStyle = "#777";
      ctx.beginPath(); ctx.moveTo(world.body.x, world.body.y); ctx.lineTo(mouth.x, mouth.y); ctx.stroke();
    }
    this.drawResourceLinks();
    // 天文节点已在背景层画完；这里仅绘制身体、背包等始终位于最前方的普通 UI。
    world.uiNodes
      .filter(node => !node.celestialUI && !this.workspacePanel?.isContentNode(node))
      .forEach(node => node.visible && this.drawNode(node, hovered, handActive, now, node.scalesWithWorld ? camera.scale : 1, activeBlue, allowMultipleBlue));
    this.drawSelectionBox(selectionBox);
    // 工作区最后绘制，因此刷新按钮、世界节点与底部 UI 都位于它的下方。
    this.drawWorkspacePanel(hovered, handActive, now, activeBlue, allowMultipleBlue);
    this.drawGameOver();
  }
}

window.TreeWorld.Renderer = Renderer;
})();
