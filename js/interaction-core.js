/*
 * 交互协调核心。
 * 仅保存所有交互共享的状态、命中测试与事件分发顺序；具体规则分别交给
 * interaction-world.js、interaction-ui.js、interaction-tools.js、interaction-view.js。
 */

(() => {
const { NODE_SIZE } = window.TreeWorld;

class Interaction {
  /** 创建交互协调器，并让各职责模块共享同一份状态。 */
  constructor(canvas, world, ui, audio, celestial = null, workspacePanel = null) {
    this.canvas = canvas;
    this.world = world;
    this.ui = ui;
    this.audio = audio;
    this.celestial = celestial;
    this.workspacePanel = workspacePanel;
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
    // 双击背包 pile 后使用的整叠携带状态；它不属于“拆出的单件物品”。
    this.carriedBulkPile = null;
    this.carriedBulkPileOrigin = null;
    this.placeKeyHeld = false;
    this.quantityInput = document.getElementById("splitInput");
    this.quantityInputNode = null;
    this.dragging = false;
    this.middle = false;
    this.down = null;
    this.lastWorld = null;
    this.lastScreen = null;
    this.bind();
  }

  /** 将屏幕坐标转换为当前相机下的世界坐标。 */
  worldPosition(event) {
    const screenX = event.clientX ?? event.x;
    const screenY = event.clientY ?? event.y;
    return { x: (screenX - this.camera.x) / this.camera.scale, y: (screenY - this.camera.y) / this.camera.scale };
  }

  /** 判断坐标是否命中节点；缩放型 UI 节点使用相机缩放后的尺寸。 */
  hit(node, point) {
    // 工作区节点使用独立坐标系：先反算其内容坐标，再以原始卡片尺寸命中。
    if (this.workspacePanel?.isContentNode(node)) {
      // 从工作区拖出的物品暂时使用世界屏幕坐标，仍可继续点击或放置。
      if (node.workspaceFloating) {
        return Math.abs(point.x - node.x) < NODE_SIZE.width / 2 && Math.abs(point.y - node.y) < NODE_SIZE.height / 2;
      }
      if (!this.workspacePanel.open) return false;
      if (!this.workspacePanel.scalesContentNode(node)) {
        const scale = this.workspacePanel.contentScale;
        return Math.abs(point.x - node.x) < NODE_SIZE.width * scale / 2 && Math.abs(point.y - node.y) < NODE_SIZE.height * scale / 2;
      }
      const local = this.workspacePanel.toContent(point);
      return Math.abs(local.x - node.x) < NODE_SIZE.width / 2 && Math.abs(local.y - node.y) < NODE_SIZE.height / 2;
    }
    const scale = node.scalesWithWorld ? this.camera.scale : 1;
    return Math.abs(point.x - node.x) < NODE_SIZE.width * scale / 2 && Math.abs(point.y - node.y) < NODE_SIZE.height * scale / 2;
  }

  /** 更新最上层可交互节点的悬停状态。 */
  updateHover(event) {
    this.hovered = null;
    if (!this.handActive) this.hovered = [...this.world.uiNodes].reverse().find(node => node.visible && this.hit(node, event)) || null;
    // 鼠标落在已展开面板的空白处时，不把下方世界节点误认为可操作对象。
    if (!this.hovered && !(this.workspacePanel?.open && this.workspacePanel.contains(event))) {
      const point = this.worldPosition(event);
      this.hovered = [...this.world.nodes].reverse().find(node => node.visible && !node.locked && this.hit(node, point)) || null;
    }
    if (!this.handActive) this.canvas.style.cursor = this.hovered ? "pointer" : "default";
  }

  /** 集中注册浏览器事件，并按“视角 → UI → 工具 → 世界”的优先级分发。 */
  bind() {
    this.bindQuantityInput();

    this.canvas.addEventListener("mousedown", event => {
      if (this.workspacePanel?.pointerDown(event)) { event.preventDefault(); return; }
      if (this.startViewPan(event)) return;
      if (event.button !== 0) return;
      if (this.handleCarriedTerminalDown(event)) return;
      if (this.handleCarriedUIDown(event)) return;
      if (this.handleCarriedBulkPileDown(event)) return;
      if (this.handleBulkPilePlacementDown(event)) return;
      if (this.handleToolNodeDown(event)) return;
      if (this.handleUINodeDown(event)) return;
      if (this.workspacePanel?.open && this.workspacePanel.contains(event)) {
        this.workspacePanel.active = true;
        return;
      }
      if (this.mouthActive || this.handActive) return;
      this.handleWorldPointerDown(event);
    });
    this.canvas.addEventListener("mousemove", event => {
      if (this.workspacePanel?.pointerMove(event)) { this.updateHover(event); return; }
      this.moveTools(event);
      this.moveCarriedTerminal(event);
      this.moveCarriedUI(event);
      this.moveCarriedBulkPile(event);
      this.moveViewPan(event);
      this.moveSelectedUIInteraction(event);
      this.moveWorldInteraction(event);
      this.updateHover(event);
    });
    this.canvas.addEventListener("mouseup", event => {
      if (this.workspacePanel?.pointerUp()) {
        // 把手的点击/拖宽不应继续穿透成一次世界或背包节点点击。
        this.skipClickAfterDrag = true;
        this.dragging = false;
        return;
      }
      this.endViewPan(event);
      this.endWorldInteraction(event);
      this.endSelectedUIInteraction(event);
    });
    this.canvas.addEventListener("click", event => this.handleCanvasClick(event));
    this.canvas.addEventListener("contextmenu", event => this.handleContextMenu(event));
    this.canvas.addEventListener("wheel", event => this.handleWheel(event), { passive: false });
    this.canvas.addEventListener("dblclick", event => this.handleDoubleClick(event));
  }

  /** 处理一次普通左键点击的最终动作。 */
  handleCanvasClick(event) {
    if (this.skipClickAfterDrag) { this.skipClickAfterDrag = false; this.dragging = false; return; }
    if (this.dragging) { this.dragging = false; return; }
    if (this.workspacePanel?.open && this.workspacePanel.contains(event)) return;
    if (this.handleMouthClick(event)) return;
    const uiNode = !this.handActive && [...this.world.uiNodes].reverse().find(node => node.visible && this.hit(node, event));
    if (uiNode && this.handleUIClick(uiNode, event)) return;
    if (this.handleHandClick(event)) return;
    this.handleWorldClick(event);
  }

  /** 右键依次取消终端携带、UI 携带、工具模式。 */
  handleContextMenu(event) {
    if (this.cancelCarriedTerminal(event)) return;
    if (this.cancelCarriedUI(event)) return;
    if (this.cancelCarriedBulkPile(event)) return;
    this.cancelTool(event);
  }
}

window.TreeWorld.Interaction = Interaction;
})();
