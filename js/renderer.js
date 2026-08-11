/*
 * Canvas 渲染器。
 * 不修改游戏数据，只按当前 world、ui 与交互状态绘制每一帧。
 */

(() => {
const { emoji, HARVEST_CLICKS_BY_TYPE, NODE_SIZE } = window.TreeWorld;

class Renderer {
  constructor(canvas, world, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.world = world;
    this.ui = ui;
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
    if (hovered === node) {
      ctx.fillStyle = "#ddd";
      ctx.font = "14px Microsoft YaHei";
      ctx.fillText(node.type, node.x, node.y + 48);
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
  drawBackpackLinks() {
    const { ctx, world, ui } = this;
    if (!ui.backpackOpen) return;
    const piles = new Map();
    world.backpack.children.filter(item => !item.detached).forEach(item => {
      const pile = piles.get(item.type) || [];
      pile.push(item);
      piles.set(item.type, pile);
    });
    ctx.strokeStyle = "#777";
    piles.forEach(pile => {
      const center = pile.reduce((sum, item) => ({ x: sum.x + item.x, y: sum.y + item.y }), { x: 0, y: 0 });
      // 所有 pile 连接点统一使用节点堆叠的几何中心。
      center.x /= pile.length;
      center.y /= pile.length;
      ctx.beginPath();
      ctx.moveTo(world.backpack.x, world.backpack.y);
      ctx.lineTo(center.x, center.y);
      ctx.stroke();
    });

    // 已拆出的物品从原 pile 左侧中心引出一条独立连线。
    world.backpack.children.filter(item => item.detached).forEach(item => {
      const remaining = world.backpack.children.filter(other => other.type === item.type && !other.detached);
      const sourceX = remaining.length ? remaining.reduce((sum, other) => sum + other.x, 0) / remaining.length : item.x;
      const sourceY = remaining.length ? remaining.reduce((sum, other) => sum + other.y, 0) / remaining.length : item.y;
      ctx.beginPath();
      ctx.moveTo(sourceX, sourceY);
      ctx.lineTo(item.x, item.y);
      ctx.stroke();
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
    // 天空只与当前可见的昼/夜天体连线；太阳与月亮不会同时出现。
    ["太阳", "月亮"].map(type => world.uiNodes.find(node => node.type === type)).filter(node => world.sky?.open && node?.visible).forEach(celestial => {
      ctx.strokeStyle = "#777";
      ctx.beginPath(); ctx.moveTo(world.sky.x, world.sky.y); ctx.lineTo(celestial.x, celestial.y); ctx.stroke();
    });
    this.drawBackpackLinks();
    this.drawResourceLinks();
    world.uiNodes.forEach(node => node.visible && this.drawNode(node, hovered, handActive, now, node.scalesWithWorld ? camera.scale : 1, activeBlue, allowMultipleBlue));
    this.drawSelectionBox(selectionBox);
    this.drawGameOver();
  }
}

window.TreeWorld.Renderer = Renderer;
})();
