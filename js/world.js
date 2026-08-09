/*
 * 世界规则与状态管理。
 * 这里负责节点的生成、消失、采集，以及“隐藏土层必须逐层揭示”的核心规则。
 */

(() => {
const { FINAL_HIDDEN_LAYER_TYPE, HARVEST_CLICKS_BY_TYPE, HARVEST_HUNGER_COST_BY_TYPE, HARVEST_WEAR_BY_TYPE, EAT_WEAR_BY_TYPE, HIDDEN_LAYER_TYPES, INDESTRUCTIBLE_TYPES, NODE_SIZE, NODE_TYPES, RESOURCE_CONFIG, rules, Node } = window.TreeWorld;

const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** 将 config.js 中的概率节点数量配置统一为安全的 [最小值, 最大值] 形式。 */
const spawnCountRange = definition => {
  const configured = definition?.spawnCount;
  if (Array.isArray(configured)) {
    const min = Math.max(0, Math.floor(configured[0] || 0));
    const max = Math.max(min, Math.floor(configured[1] ?? min));
    return [min, max];
  }
  const count = Math.max(0, Math.floor(configured ?? 1));
  return [count, count];
};

class World {
  /** 创建树、身体、背包及其初始状态。 */
  constructor(width, height) {
    this.nodes = [];
    this.edges = [];
    this.uiNodes = [];
    this.inventory = {};
    this.resources = Object.fromEntries(Object.entries(RESOURCE_CONFIG).map(([type, data]) => [type, data.initial]));
    this.gameOver = false;
    this.lastTick = 0;

    this.root = new Node("树", width / 2, 120);
    this.root.soilLayerCount = random(3, 6);
    this.createHiddenSoilChain(this.root, this.root.soilLayerCount);
    this.nodes.push(this.root);

    // UI 使用屏幕坐标：初始化在左侧中部，永远不受世界相机缩放影响。
    // 身体固定在底栏、饥饿节点左侧，不允许被拖动。
    this.body = new Node("身体", width / 2 - 240, height - 75, true);
    this.body.fixedUI = true;
    this.backpack = new Node("背包", 80, height / 2 + 55, true);
    this.thought = new Node("思考", this.backpack.x, this.backpack.y - 105, true);
    this.thought.fixedUI = true;
    this.resetNode = new Node("刷新", 70, 55, true);
    this.resetNode.fixedUI = true;
    // 保存初始化坐标，复原按钮只需读取这里即可恢复 UI。
    this.initialUIPositions = {
      body: { x: this.body.x, y: this.body.y },
      backpack: { x: this.backpack.x, y: this.backpack.y }
    };
    this.uiNodes.push(this.body, this.backpack, this.thought, this.resetNode);
    this.createResourcePiles(width, height);
  }

  /**
   * 创建一条隐藏资源链。链上的节点只在前一层被清除后才会出现，
   * 因此问号卡不会被直接拖出或提前操作。
   */
  createHiddenSoilChain(owner, count) {
    const gap = Math.max(5, Math.min(10, 32 / count));
    let parent = owner;
    for (let index = 0; index < count; index++) {
      // 隐藏层纵向向上错开，最上方节点最后由树显示在整叠最下端。
      // 每条隐藏链的终点固定为配置中唯一的不可破坏节点。
      const type = index === count - 1
        ? FINAL_HIDDEN_LAYER_TYPE
        : HIDDEN_LAYER_TYPES[Math.floor(Math.random() * HIDDEN_LAYER_TYPES.length)];
      const layer = new Node(type, owner.x, owner.y - (index + 1) * gap);
      layer.visible = false;
      layer.hiddenUnderlay = true;
      layer.locked = true;
      parent.underlays = [layer];
      parent = layer;
    }
  }

  /** 仅揭示所属节点的下一层，不会一次把所有隐藏层放进世界。 */
  revealNextUnderlay(node) {
    const next = node.underlays[0];
    if (!next) return null;
    next.visible = true;
    next.hiddenUnderlay = false;
    next.locked = false;
    if (!this.nodes.includes(next)) this.nodes.push(next);
    return next;
  }

  /** 判断节点是否是规则上的终端节点，从而允许采集。 */
  isHarvestable(node) {
    return !node.ui && !this.isIndestructible(node) && node.children.length === 0 && (rules[node.type] || []).length === 0;
  }

  /** 根据配置判断节点是否为不可采集、不可删除的硬性节点。 */
  isIndestructible(node) {
    return INDESTRUCTIBLE_TYPES.includes(node.type);
  }

  /** 返回节点类型对应的采集次数；未配置的终端节点默认需要 4 次。 */
  harvestClicksFor(node) {
    return HARVEST_CLICKS_BY_TYPE[node.type] || 4;
  }

  /** 不可破坏节点不可采集；触碰它只提供一次短暂的视觉反馈。 */
  touchIndestructible(node, now) {
    if (!this.isIndestructible(node)) return false;
    node.shakeUntil = now + 180;
    return true;
  }

  /** 在不与可见节点重叠的位置生成子节点。 */
  findPosition(parent) {
    for (let radius = 150; radius < 700; radius += 80) {
      for (let i = 0; i < 50; i++) {
        const angle = Math.random() * Math.PI * 2;
        const x = parent.x + Math.cos(angle) * radius;
        const y = parent.y + Math.sin(angle) * radius;
        const occupied = this.nodes.some(n => n.visible && Math.abs(n.x - x) < NODE_SIZE.width && Math.abs(n.y - y) < NODE_SIZE.height);
        if (!occupied) return { x, y };
      }
    }
    return { x: parent.x + 200, y: parent.y + 150 };
  }

  /** 展开普通世界节点；土也只会展开出一层终端土块。 */
  expand(node) {
    if (node.children.length) {
      // 兼容旧存档：必定出现的概率节点会补齐到 spawnCount 设定的最小数量。
      (rules[node.type] || []).filter(type => NODE_TYPES[type]?.spawnChance >= 1).forEach(type => {
        const [minimum] = spawnCountRange(NODE_TYPES[type]);
        const missing = Math.max(0, minimum - node.children.filter(child => child.type === type).length);
        for (let index = 0; index < missing; index++) {
          const position = this.findPosition(node);
          const child = new Node(type, position.x, position.y);
          node.children.push(child);
          this.nodes.push(child);
          this.edges.push({ from: node, to: child });
        }
      });
      node.open = true;
      this.showOpenDescendants(node);
      return [];
    }
    const available = rules[node.type] || [];
    if (!available.length) return [];

    const created = [];
    const count = random(3, 6);
    // 概率子节点按“本次展开是否出现”判定；出现后按 spawnCount 生成多个同类型节点。
    const specialChildren = available.flatMap(type => {
      const definition = NODE_TYPES[type];
      if (definition?.spawnChance === undefined || Math.random() >= definition.spawnChance) return [];
      const [minimum, maximum] = spawnCountRange(definition);
      return Array.from({ length: random(minimum, maximum) }, () => type);
    });
    const regularChildren = available.filter(type => NODE_TYPES[type]?.spawnChance === undefined);
    for (let i = 0; i < Math.max(count, specialChildren.length); i++) {
      // 先生成本轮已掷中的特殊节点，其余名额由普通子节点填充。
      const type = i < specialChildren.length
        ? specialChildren[i]
        : regularChildren[Math.floor(Math.random() * regularChildren.length)];
      const position = this.findPosition(node);
      const child = new Node(type, position.x, position.y);
      node.children.push(child);
      this.nodes.push(child);
      this.edges.push({ from: node, to: child });
      created.push(child);
    }
    node.open = true;
    return created;
  }

  /**
   * 恢复一次收起前已展开的分支。
   * 子节点无论是否展开都应显示；只有 child.open 为真时才继续显示其后代。
   */
  showOpenDescendants(node) {
    node.children.forEach(child => {
      child.visible = true;
      if (child.open) this.showOpenDescendants(child);
    });
  }

  /** 收起节点时隐藏后代，但保留已生成的数据。 */
  collapse(node) {
    const hide = current => current.children.forEach(child => { child.visible = false; hide(child); });
    hide(node);
    node.open = false;
  }

  /** 移动节点、它的普通后代及其尚未出现的隐藏层。 */
  moveTree(node, dx, dy) {
    node.x += dx;
    node.y += dy;
    node.underlays.forEach(layer => this.moveTree(layer, dx, dy));
    node.children.forEach(child => this.moveTree(child, dx, dy));
  }

  /** 移动屏幕 UI 节点，并保持其子节点相对位置不变。 */
  moveUI(node, dx, dy) {
    node.x += dx;
    node.y += dy;
    node.children.forEach(child => this.moveUI(child, dx, dy));
  }

  /** 返回节点的直接父节点；根节点没有父节点。 */
  parentOf(node) {
    return this.edges.find(edge => edge.to === node)?.from || null;
  }

  /** 在一条可见分支内寻找指定类型节点，用于动态节点迁徙时定位同类型父节点。 */
  findVisibleDescendantByType(node, type) {
    if (node.visible && node.type === type) return node;
    for (const child of node.children) {
      const found = this.findVisibleDescendantByType(child, type);
      if (found) return found;
    }
    return null;
  }

  /**
   * 父节点即将消失时，为动态子节点寻找新的同类型父节点。
   * 搜索从父节点的兄弟分支开始，逐层上溯；到根仍找不到时，该动态节点消失。
   */
  migrateDynamicNode(node, formerParent) {
    const requiredParentType = formerParent.type;
    let branch = formerParent;
    while (true) {
      const ancestor = this.parentOf(branch);
      if (!ancestor) break;
      for (const sibling of ancestor.children.filter(child => child !== branch && child.visible)) {
        const newParent = this.findVisibleDescendantByType(sibling, requiredParentType);
        if (!newParent) continue;
        formerParent.children = formerParent.children.filter(child => child !== node);
        this.edges = this.edges.filter(edge => !(edge.from === formerParent && edge.to === node));
        newParent.children.push(node);
        this.edges.push({ from: newParent, to: node });
        node.x = newParent.x;
        node.y = newParent.y;
        node.dynamicState = null;
        return true;
      }
      branch = ancestor;
    }
    formerParent.children = formerParent.children.filter(child => child !== node);
    this.nodes = this.nodes.filter(item => item !== node);
    this.edges = this.edges.filter(edge => edge.from !== node && edge.to !== node);
    return false;
  }

  /** 创建固定在屏幕底部中央的三组数值资源节点；每组都可按数量拆出临时节点。 */
  createResourcePiles(width, height) {
    this.resourcePiles = {};
    ["饥饿", "生命", "专注"].forEach((type, index) => {
      const anchor = new Node(type, width / 2 + (index - 1) * 160 + 80, height - 75, true);
      anchor.fixedUI = true;
      anchor.visible = true;
      anchor.quantity = this.resources[type];
      anchor.splitAmount = 1;
      anchor.isNumericPile = true;
      anchor.resourcePileOwner = anchor;
      this.resourcePiles[type] = anchor;
      this.uiNodes.push(anchor);
    });
    this.syncResourcePiles();
  }

  /** 同步资源总量到原节点，同时保留已经拆出、正在画面中的资源节点。 */
  syncResourcePiles() {
    Object.entries(this.resourcePiles).forEach(([type, anchor]) => {
      const detached = anchor.children.filter(item => item.detached);
      const detachedAmount = detached.reduce((sum, item) => sum + item.quantity, 0);
      // 所有资源显示统一保留一位小数，避免 0.1 的浮点误差累积到节点数量上。
      anchor.quantity = Math.max(0, Math.round((this.resources[type] - detachedAmount) * 10) / 10);
      anchor.splitAmount = Math.min(anchor.splitAmount || 1, Math.max(1, anchor.quantity - 1));
    });
  }

  /** 将底部资源原节点按 1 为单位拆出；至少保留 1 点资源在原节点。 */
  detachResourceItem(item) {
    if (!item?.resourcePileOwner || item.detached || item.quantity <= 1) return null;
    const rounded = Math.max(1, Math.min(Math.round(item.splitAmount || 1), Math.floor(item.quantity - 1)));
    item.quantity = Math.round((item.quantity - rounded) * 10) / 10;
    const detached = new Node(item.type, item.x, item.y, true);
    detached.quantity = rounded;
    detached.detached = true;
    detached.sourcePile = item;
    detached.resourcePileOwner = item;
    detached.isNumericPile = true;
    item.children.push(detached);
    this.uiNodes.push(detached);
    return detached;
  }

  /** 将拆出的资源放回原节点附近时，恢复为原节点中的数值。 */
  returnResourceItemIfDropped(item) {
    if (!item?.detached || !item.sourcePile || !item.resourcePileOwner) return false;
    if (Math.abs(item.x - item.sourcePile.x) > NODE_SIZE.width || Math.abs(item.y - item.sourcePile.y) > NODE_SIZE.height) return false;
    return this.mergeResourceItem(item);
  }

  /** 强制收回资源拆分节点，并从资源总值重新计算原节点，避免重复累加。 */
  mergeResourceItem(item) {
    if (!item?.detached || !item.sourcePile) return false;
    item.sourcePile.children = item.sourcePile.children.filter(child => child !== item);
    this.uiNodes = this.uiNodes.filter(node => node !== item);
    this.syncResourcePiles();
    return true;
  }

  /** 窗口尺寸变化时重新把固定资源 pile 锚定到屏幕下方中央。 */
  positionResourcePiles(width, height) {
    ["饥饿", "生命", "专注"].forEach((type, index) => {
      this.resourcePiles[type].x = width / 2 + (index - 1) * 160 + 80;
      this.resourcePiles[type].y = height - 75;
    });
    this.syncResourcePiles();
  }

  /** 每次成功采集点击先消耗饥饿，饥饿不足的部分自动扣除生命。 */
  consumeHarvestResources(node) {
    if (this.gameOver) return { cost: 0, gameOver: true };
    const cost = HARVEST_HUNGER_COST_BY_TYPE[node.type] || 1;
    const fromHunger = Math.min(this.resources.饥饿, cost);
    this.resources.饥饿 = Math.round((this.resources.饥饿 - fromHunger) * 10) / 10;
    this.resources.生命 = Math.max(0, Math.round((this.resources.生命 - (cost - fromHunger)) * 10) / 10);
    if (this.resources.生命 <= 0) this.gameOver = true;
    this.syncResourcePiles();
    return { cost, gameOver: this.gameOver };
  }

  /** 复原按钮调用：恢复所有资源并解除游戏结束状态，不重置世界进度。 */
  resetResources() {
    Object.values(this.resourcePiles).forEach(anchor => {
      anchor.children.forEach(item => this.uiNodes = this.uiNodes.filter(node => node !== item));
      anchor.children = [];
    });
    Object.entries(RESOURCE_CONFIG).forEach(([type, data]) => this.resources[type] = data.initial);
    this.gameOver = false;
    this.syncResourcePiles();
  }

  /** 取得深度最深的一批已展开节点并收起，实现“全局回退一层”。 */
  collapseOneLayer() {
    const depth = new Map([[this.root, 0]]);
    this.edges.forEach(edge => depth.set(edge.to, (depth.get(edge.from) || 0) + 1));
    const openNodes = this.nodes.filter(node => node.visible && node.open);
    const deepest = Math.max(-1, ...openNodes.map(node => depth.get(node) || 0));
    openNodes.filter(node => (depth.get(node) || 0) === deepest).forEach(node => this.collapse(node));
    return deepest >= 0;
  }

  /** 将身体、背包以及其 UI 子节点一起移动回最初的屏幕坐标。 */
  resetUIPositions() {
    const body = this.initialUIPositions.body;
    const backpack = this.initialUIPositions.backpack;
    this.moveUI(this.body, body.x - this.body.x, body.y - this.body.y);
    this.moveUI(this.backpack, backpack.x - this.backpack.x, backpack.y - this.backpack.y);
  }

  /**
   * 用背包库存重建 UI 子节点。每一种物品只对应一个数值节点，数量显示在节点左下角；
   * 节点右下的分离条决定下一次拆出多少数量，分离后的节点仍通过连线指向原节点。
   */
  setBackpackOpen(open, viewportWidth = Infinity) {
    this.uiNodes = this.uiNodes.filter(node => node.backpackItemOwner !== this.backpack);
    this.backpack.children = this.backpack.children.filter(node => !node.backpackItemOwner);
    this.backpack.open = open;
    if (!open) return;

    const entries = Object.entries(this.inventory);
    const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
    const rows = Math.ceil(entries.length / columns);
    const direction = this.backpack.x > viewportWidth / 2 ? -1 : 1;

    entries.filter(([, count]) => count > 0).forEach(([type, count], typeIndex) => {
      // 不同 pile 以 130×90 的网格均匀排开，避免 100×60 节点彼此相撞。
      const column = typeIndex % columns;
      const row = Math.floor(typeIndex / columns);
      const pileX = this.backpack.x + direction * (150 + column * 130);
      const pileY = this.backpack.y + (row - (rows - 1) / 2) * 90;
      const item = new Node(type, pileX, pileY, true);
      item.pileAnchor = { x: pileX, y: pileY };
      item.quantity = count;
      item.splitAmount = 1;
      item.detached = false;
      item.backpackItemOwner = this.backpack;
      item.isNumericPile = true;
      // 背包展开物品的大小跟随世界缩放，位置仍保留在屏幕 UI 层。
      item.scalesWithWorld = true;
      this.backpack.children.push(item);
      this.uiNodes.push(item);
    });
  }

  /** 从数值背包节点按分离条的数量拆出一个独立节点；最后一件不能拆出。 */
  detachBackpackItem(item) {
    if (!item?.backpackItemOwner || item.detached || item.quantity <= 1) return null;
    const amount = Math.max(1, Math.min(item.splitAmount || 1, item.quantity - 1));
    item.quantity -= amount;
    item.splitAmount = Math.min(item.splitAmount || 1, Math.max(1, item.quantity - 1));
    const detached = new Node(item.type, item.x, item.y, true);
    detached.quantity = amount;
    detached.detached = true;
    detached.pileAnchor = { ...item.pileAnchor };
    detached.sourcePile = item;
    detached.backpackItemOwner = this.backpack;
    detached.isNumericPile = true;
    detached.scalesWithWorld = true;
    this.backpack.children.push(detached);
    this.uiNodes.push(detached);
    return detached;
  }

  /** 兼容旧交互调用：数值背包节点不再需要逐层重新排版。 */
  layoutPile(type) {
    return this.backpack.children.find(item => item.type === type && !item.detached);
  }

  /** 若拆出的数值节点放回原节点附近，则合并回其来源节点。 */
  returnBackpackItemIfDropped(item) {
    if (!item?.detached || !item.sourcePile) return false;
    const anchor = item.sourcePile;
    if (Math.abs(item.x - anchor.x) > NODE_SIZE.width || Math.abs(item.y - anchor.y) > NODE_SIZE.height) return false;
    this.mergeBackpackItem(item);
    return true;
  }

  /** 无论当前位置如何，强制把一个拆出节点还原到来源数值节点。 */
  mergeBackpackItem(item) {
    if (!item?.detached || !item.sourcePile) return false;
    const anchor = item.sourcePile;
    this.backpack.children = this.backpack.children.filter(node => node !== item);
    this.uiNodes = this.uiNodes.filter(node => node !== item);
    // inventory 才是背包物品的唯一总数；回收时根据仍在外面的拆分节点重算，不能直接 +1。
    const remainingDetached = this.backpack.children
      .filter(node => node.type === anchor.type && node.detached)
      .reduce((sum, node) => sum + node.quantity, 0);
    anchor.quantity = Math.max(0, (this.inventory[anchor.type] || 0) - remainingDetached);
    anchor.splitAmount = Math.min(anchor.splitAmount || 1, Math.max(1, anchor.quantity - 1));
    return true;
  }

  /** 删除采集完成的节点；父节点空了会递归消失并揭示下一隐藏层。 */
  removeNodeAndEmptyParents(node) {
    const parents = this.edges.filter(edge => edge.to === node).map(edge => edge.from);
    const revealed = this.revealNextUnderlay(node);
    this.nodes = this.nodes.filter(item => item !== node);
    this.edges = this.edges.filter(edge => edge.from !== node && edge.to !== node);

    parents.forEach(parent => {
      parent.children = parent.children.filter(child => child !== node);
      // 动态子节点不阻止父节点消失：先迁徙它们，再按普通空节点规则递归清理父节点。
      const structuralChildren = parent.children.filter(child => !child.dynamic);
      if (structuralChildren.length === 0 && parent.open) {
        parent.children.filter(child => child.dynamic).forEach(child => this.migrateDynamicNode(child, parent));
        this.removeNodeAndEmptyParents(parent);
      }
    });
    return revealed;
  }

  /** 完成一次采集点击，返回是否完成及新揭示的节点。 */
  harvest(node, now) {
    if (!this.isHarvestable(node)) return { accepted: false };
    node.harvestProgress++;
    node.shakeUntil = now + 180;
    const required = this.harvestClicksFor(node);
    if (node.harvestProgress < required) return { accepted: true, completed: false, required };

    this.inventory[node.type] = (this.inventory[node.type] || 0) + 1;
    const revealed = this.removeNodeAndEmptyParents(node);
    return { accepted: true, completed: true, revealed, required };
  }

  /** 身体的 UI 子节点仅在展开时创建一次。 */
  toggleBody() {
    if (this.body.open) {
      this.body.children.forEach(child => child.visible = false);
      this.body.open = false;
      return false;
    }
    if (!this.body.children.length) {
      rules.身体.forEach((type, index) => {
        const position = this.toolHomePosition(type, index);
        // 手和嘴在身体上方展开，横向留出空隙，避免与身体及底栏资源重叠。
        const tool = new Node(type, position.x, position.y, true);
        // 工具位置属于屏幕 UI，但图标和卡片尺寸跟随世界缩放，形成与世界的视觉关联。
        tool.scalesWithWorld = true;
        this.body.children.push(tool);
        this.uiNodes.push(tool);
      });
    }
    this.body.children.forEach(child => child.visible = !child.lost);
    this.body.open = true;
    return true;
  }

  /** 返回工具收起或右键取消后的位置；与身体上方的展开布局保持一致。 */
  toolHomePosition(type, fallbackIndex = 0) {
    const index = rules.身体.indexOf(type);
    const offset = (index >= 0 ? index : fallbackIndex) === 0 ? -65 : 65;
    return { x: this.body.x + offset, y: this.body.y - 105 };
  }

  /** 消耗手或嘴的磨损；磨损降到零后，该工具永久消失。 */
  wearTool(type, amount) {
    const tool = this.body.children.find(child => child.type === type);
    if (!tool || tool.lost || tool.durability === null) return { broken: Boolean(tool?.lost) };
    tool.durability = Math.max(0, tool.durability - amount);
    if (tool.durability === 0) {
      tool.lost = true;
      tool.visible = false;
      return { broken: true };
    }
    return { broken: false };
  }

  /** 返回配置中可调整的单次手、嘴磨损数值。 */
  toolWearFor(toolType, target) {
    if (toolType === "手") return HARVEST_WEAR_BY_TYPE[target?.type] || NODE_TYPES.手.defaultHarvestWear || 1;
    return EAT_WEAR_BY_TYPE[target?.type] || NODE_TYPES.嘴.defaultEatWear || 1;
  }

  /** 吃掉背包中的一件食物（可以直接吃原数值节点，也可以吃拆出的节点）。 */
  eatBackpackItem(item, now) {
    if (!item?.edible || !item.backpackItemOwner || item.quantity <= 0) return { eaten: false };
    // 进食反馈：直接吃原节点时震动它；吃拆分节点时来源节点也同步震动。
    item.shakeUntil = now + 180;
    if (item.detached && item.sourcePile) item.sourcePile.shakeUntil = now + 180;
    this.inventory[item.type] = Math.max(0, (this.inventory[item.type] || 0) - 1);
    item.quantity -= 1;
    if (item.quantity <= 0) {
      if (item.detached && item.sourcePile) item.sourcePile.splitAmount = Math.min(item.sourcePile.splitAmount || 1, Math.max(1, item.sourcePile.quantity - 1));
      // 保留最后一件到震动结束，确保被吃掉的独立节点也能显示视觉反馈。
      item.consumedUntil = now + 180;
    }
    this.resources.饥饿 = Math.min(RESOURCE_CONFIG.饥饿.max, this.resources.饥饿 + item.hungerRestore);
    if (item.poisoned) this.resources.生命 = Math.max(0, this.resources.生命 - item.poisonDamage);
    if (this.resources.生命 <= 0) this.gameOver = true;
    this.syncResourcePiles();
    return { eaten: true, poisoned: item.poisoned };
  }

  /** 饥饿满值时每秒缓慢恢复生命。 */
  tick(now) {
    if (!this.lastTick) this.lastTick = now;
    const seconds = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (!this.gameOver && this.resources.饥饿 >= RESOURCE_CONFIG.饥饿.max && this.resources.生命 < RESOURCE_CONFIG.生命.max) {
      this.resources.生命 = Math.min(RESOURCE_CONFIG.生命.max, this.resources.生命 + seconds * .5);
      this.syncResourcePiles();
    }
    // 未损坏的手和嘴会随时间慢慢恢复耐久；已彻底损坏的工具不会复活。
    this.body.children.forEach(tool => {
      const recovery = NODE_TYPES[tool.type]?.durabilityRecovery || 0;
      if (!tool.lost && tool.durability !== null && recovery > 0) {
        tool.durability = Math.min(100, tool.durability + seconds * recovery);
      }
    });
    // 吃完但仍在震动的背包节点在效果结束后才从画面和背包临时列表中移除。
    this.backpack.children.filter(item => item.consumedUntil && now >= item.consumedUntil).forEach(item => {
      this.backpack.children = this.backpack.children.filter(node => node !== item);
      this.uiNodes = this.uiNodes.filter(node => node !== item);
    });
  }
}

window.TreeWorld.World = World;
})();
