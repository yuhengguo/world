/*
 * 左侧背包工作区。
 * 它是独立于世界相机的 Canvas 屏幕层：负责展开/收起、调整宽度和内容缩放，
 * 不保存背包数据；背包、思考和分类树的真实数据仍由 World 管理。
 */
(() => {
const { WORKSPACE_PANEL_CONFIG } = window.TreeWorld;

class WorkspacePanel {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.open = true;
    // 开局即处于可向左收窄到的最小边界，避免工作区一开始占用过多世界视野。
    this.width = this.minimumWidth();
    // 收起前的宽度单独保存；点击 > 时恢复到玩家最后一次使用的区域。
    this.lastExpandedWidth = this.width;
    this.contentScale = 1;
    // 工作区内容的可视偏移；背包与思考入口不使用此偏移，始终停在左侧固定位置。
    this.contentOffset = { x: 0, y: 0 };
    this.active = true;
    this.resizing = false;
    this.dragMoved = false;
  }

  /** 背包、思考、分类和背包物品都属于工作区内容；其它 UI 保持原有层级与坐标。 */
  isContentNode(node) {
    return node === this.world.backpack || node === this.world.thought || node.customNode || node.backpackItemOwner === this.world.backpack;
  }

  /** 背包与思考位置固定；它们会缩放卡片大小，但不随内容平移。 */
  scalesContentNode(node) {
    return this.isContentNode(node) && node !== this.world.backpack && node !== this.world.thought && !node.workspaceFloating;
  }

  /** 返回节点当前显示的屏幕位置，供跨缩放连线与悬浮物品共用。 */
  displayPoint(node) {
    if (node.workspaceFloating || !this.scalesContentNode(node)) return { x: node.x, y: node.y };
    return this.toScreen(node);
  }

  /** 内容缩放以面板中心为原点，平移独立叠加，方便稳定地查看与搜索定位内容。 */
  contentAnchor() { return { x: this.width / 2, y: this.canvas.height / 2 }; }
  toScreen(point) {
    const anchor = this.contentAnchor();
    const x = point.x ?? point.clientX;
    const y = point.y ?? point.clientY;
    return {
      x: anchor.x + (x - anchor.x) * this.contentScale + this.contentOffset.x,
      y: anchor.y + (y - anchor.y) * this.contentScale + this.contentOffset.y
    };
  }
  toContent(point) {
    const anchor = this.contentAnchor();
    const x = point.x ?? point.clientX;
    const y = point.y ?? point.clientY;
    return {
      x: anchor.x + (x - anchor.x - this.contentOffset.x) / this.contentScale,
      y: anchor.y + (y - anchor.y - this.contentOffset.y) / this.contentScale
    };
  }

  /** 展开时占据左侧区域；收起时只保留贴在左边缘的 > 按钮。 */
  contains(point) {
    const x = point.x ?? point.clientX;
    const y = point.y ?? point.clientY;
    return this.open && x >= 0 && x <= this.width && y >= 0 && y <= this.canvas.height;
  }
  /** 面板不能缩到盖住背包或思考节点的右边缘。 */
  minimumWidth() {
    const rightEdge = Math.max(this.world.backpack.x + 50, this.world.thought.x + 50);
    return Math.max(WORKSPACE_PANEL_CONFIG.minWidth, rightEdge + 15);
  }
  /** 工作区即使完全展开，也要避开右侧详情页收起后仍保留的展开把手。 */
  maximumWidth() {
    return Math.max(this.minimumWidth(), this.canvas.width - WORKSPACE_PANEL_CONFIG.collapsedDetailClearance);
  }
  /** 供窗口缩放和外部定位统一调用，保证当前与记忆宽度都落在合法范围内。 */
  clampWidth() {
    const minimum = this.minimumWidth();
    const maximum = this.maximumWidth();
    this.width = Math.max(minimum, Math.min(maximum, this.width));
    this.lastExpandedWidth = Math.max(minimum, Math.min(maximum, this.lastExpandedWidth));
  }
  /** 开启时边框同时显示 <（收起/拖宽）与 >（恢复/拖宽）；收起后仅显示 >。 */
  controls() {
    const y = this.canvas.height / 2 - 34;
    if (!this.open) return { expand: { x: 0, y, width: 28, height: 68 } };
    return {
      collapse: { x: this.width - 28, y, width: 28, height: 68 },
      expand: { x: this.width, y, width: 28, height: 68 }
    };
  }
  // 保留这个小接口，让其它模块在只需定位 > 按钮时不依赖控制器内部结构。
  handleBounds() {
    return this.controls().expand;
  }
  hitControl(point, box) {
    const x = point.x ?? point.clientX;
    const y = point.y ?? point.clientY;
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  }

  /** 两个箭头都可拖宽；只有未拖动时，< 执行收起，> 执行恢复。 */
  pointerDown(event) {
    const controls = this.controls();
    if (controls.collapse && this.hitControl(event, controls.collapse)) {
      this.resizing = true;
      this.controlAction = "collapse";
      this.dragMoved = false;
      return true;
    }
    if (!this.hitControl(event, controls.expand)) return false;
    this.resizing = true;
    this.controlAction = "expand";
    this.dragMoved = false;
    return true;
  }
  pointerMove(event) {
    if (!this.resizing) return false;
    const next = Math.max(this.minimumWidth(), Math.min(this.maximumWidth(), event.clientX));
    if (Math.abs(next - this.width) > 4) this.dragMoved = true;
    this.width = next;
    this.open = true;
    this.lastExpandedWidth = next;
    return true;
  }
  pointerUp() {
    if (!this.controlAction) return false;
    const action = this.controlAction;
    this.resizing = false;
    this.controlAction = null;
    if (action === "collapse" && !this.dragMoved) {
      this.lastExpandedWidth = this.width;
      this.open = false;
      return true;
    }
    if (!this.dragMoved) {
      this.open = true;
      this.width = Math.max(this.minimumWidth(), Math.min(this.maximumWidth(), this.lastExpandedWidth));
    }
    return true;
  }

  /** 在工作区内按住鼠标滚轮拖动时，只移动可缩放内容的视野。 */
  startPan(event) {
    if (!this.contains(event)) return false;
    this.panning = true;
    this.lastPanPoint = { x: event.clientX, y: event.clientY };
    return true;
  }
  movePan(event) {
    if (!this.panning) return false;
    this.contentOffset.x += event.clientX - this.lastPanPoint.x;
    this.contentOffset.y += event.clientY - this.lastPanPoint.y;
    this.lastPanPoint = { x: event.clientX, y: event.clientY };
    return true;
  }
  endPan() {
    if (!this.panning) return false;
    this.panning = false;
    this.lastPanPoint = null;
    return true;
  }

  /** 工作区内滚轮仅改变工作区内容大小，不影响世界相机。 */
  zoom(deltaY) {
    this.contentScale = Math.max(WORKSPACE_PANEL_CONFIG.minContentScale, Math.min(WORKSPACE_PANEL_CONFIG.maxContentScale, this.contentScale * Math.exp(-deltaY * WORKSPACE_PANEL_CONFIG.zoomSensitivity)));
  }

}

window.TreeWorld.WorkspacePanel = WorkspacePanel;
})();
