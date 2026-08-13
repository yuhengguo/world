/*
 * 右侧节点详情页。
 * 它只读取节点状态并更新 DOM，不参与 Canvas 绘制，也不改变任何游戏规则。
 */

(() => {
const { emoji, HARVEST_CLICKS_BY_TYPE, NODE_DESCRIPTIONS, NODE_TYPES } = window.TreeWorld;

class DetailPanel {
  constructor() {
    this.panel = document.getElementById("nodeDetailPanel");
    this.toggle = document.getElementById("nodeDetailToggle");
    this.emoji = document.getElementById("detailEmoji");
    this.name = document.getElementById("detailName");
    this.kind = document.getElementById("detailKind");
    this.description = document.getElementById("detailDescription");
    this.facts = document.getElementById("detailFacts");
    this.lastNode = null;
    this.viewMode = "";
    // 初始详情页已打开显示操作指南；玩家之后手动收起时不会被自动再次弹出。
    this.hasAutoOpened = true;
    this.toggle.addEventListener("click", () => this.setOpen(this.panel.classList.contains("collapsed")));
  }

  /** 切换详情页开合，并同步箭头方向。 */
  setOpen(open) {
    this.panel.classList.toggle("collapsed", !open);
    this.toggle.textContent = open ? ">" : "<";
    this.toggle.setAttribute("aria-label", open ? "收起节点详情" : "展开节点详情");
  }

  /** 根据当前节点类型提供第一版默认说明；配置中填写 description 时优先采用配置。 */
  descriptionFor(node) {
    const configured = NODE_DESCRIPTIONS[node.type] || NODE_TYPES[node.type]?.description;
    if (configured) return configured;
    if (node.type === "基岩") return "隐藏层最深处的基岩。无法采集，也不会消失。";
    if (node.edible) return "可从背包中用嘴进食，以补充饥饿值。";
    if (node.ui) return "固定在界面上的功能节点，不随世界位置变化。";
    if ((NODE_TYPES[node.type]?.children || []).length) return "可继续展开，发现更多下层或子节点。";
    return "世界中的终端节点，可使用手进行采集。";
  }

  /** 生成动态属性卡片：只显示当前节点确实具备的状态。 */
  factsFor(node) {
    const facts = [["类别", node.ui ? "UI 节点" : "世界节点"]];
    if (node.quantity !== undefined) facts.push(["数量", `×${node.quantity}`]);
    if (node.harvestProgress) facts.push(["采集进度", `${node.harvestProgress}/${HARVEST_CLICKS_BY_TYPE[node.type] || 4}`]);
    if (node.durability !== null && node.durability !== undefined) facts.push(["耐久", `${Math.round(node.durability)}%`]);
    if (node.edible) facts.push(["可进食", `回复 ${node.hungerRestore || 0}`]);
    if (node.children?.length) facts.push(["已生成子节点", String(node.children.length)]);
    if (node.underlays?.length) facts.push(["下方隐藏层", "存在"]);
    if (node.locked) facts.push(["状态", "尚未揭示"]);
    if (node.lost) facts.push(["状态", "已损坏"]);
    return facts;
  }

  /** 在没有选中节点时显示“节点世界”的完整但可快速浏览的规则总览。 */
  showRules() {
    if (this.viewMode === "rules") return;
    this.viewMode = "rules";
    this.emoji.textContent = "🧭";
    this.name.textContent = "节点世界";
    this.kind.textContent = "操作与探索指南";
    this.description.textContent = "世界由可展开的节点、会接替上层的地下层与自己的身体组成。先探索，再采集、整理、放置，慢慢把世界变成你的结构。";
    const rules = [
      ["展开 / 收起", "左键静态节点展开或收起分支；父节点收起时会保留原有展开结构。"],
      ["采集", "展开身体，左键手使其黏附光标，再连续点击可采集的终端节点。换目标会清空原进度。"],
      ["进食", "展开身体，左键嘴后点击工作区或背包中的可食物品；种子、花、鸟等是否可吃由配置决定。"],
      ["拖放", "终端节点或背包物品左键后黏附光标；再次左键放下，右键取消并返回原位。"],
      ["地下替补层", "树和矿层下方的问号卡片是替补层。上层被清空后，下层接替原位置；最深处永远是不可采集的基岩。"],
      ["放置", "携带背包物品时，按住空格并左键点击一条通向基岩、且下方只含矿物的替补链，即可压入最上层。"],
      ["背包与分类", "背包中的数字表示数量。单击可拆出一件，双击携带整 pile；用 + / − 建分类，Ctrl + 左键可命名或归类。"],
      ["工作区", "左侧工作区独立于世界缩放。拖动边缘 < 或 > 改宽，滚轮缩放内容，中键平移内容。"],
      ["命名与搜索", "Ctrl + 左键世界节点或分类可改名，名称全局唯一。Ctrl + F 输入名称、回车即可定位。"],
      ["生存", "采集会消耗饥饿；饥饿不足时扣生命。饥饿满且生命未满会缓慢回血；生命归零后重新开始。"],
      ["视角与时间", "世界区域滚轮缩放、中键平移。天空自动展开，太阳与月亮按昼夜从右向左运行。"]
    ];
    this.facts.replaceChildren(...rules.map(([label, value]) => {
      const item = document.createElement("div");
      item.className = "detail-fact";
      const title = document.createElement("small");
      title.textContent = label;
      const content = document.createElement("b");
      content.textContent = value;
      item.append(title, content);
      return item;
    }));
  }

  /** 有选择时更新最近节点；无选择时继续展示最近一次选择的节点。 */
  update(selectedNode) {
    if (!selectedNode) {
      this.showRules();
      return;
    }
    if (selectedNode) {
      this.viewMode = "node";
      this.lastNode = selectedNode;
      // 仅第一次获得节点详情时自动打开；之后是否展开完全由玩家控制。
      if (!this.hasAutoOpened) {
        this.setOpen(true);
        this.hasAutoOpened = true;
      }
    }
    const node = selectedNode || this.lastNode;
    if (!node) return;
    this.emoji.textContent = emoji[node.type] || "?";
    this.name.textContent = node.customNode ? node.customLabel : node.type;
    this.kind.textContent = selectedNode ? "当前选中" : "最近查看";
    this.description.textContent = this.descriptionFor(node);
    this.facts.replaceChildren(...this.factsFor(node).map(([label, value]) => {
      const item = document.createElement("div");
      item.className = "detail-fact";
      const title = document.createElement("small");
      title.textContent = label;
      const content = document.createElement("b");
      content.textContent = value;
      item.append(title, content);
      return item;
    }));
  }
}

window.TreeWorld.DetailPanel = DetailPanel;
})();
