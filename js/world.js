/*
 * 世界规则与状态管理。
 * 这里负责节点的生成、消失、采集，以及“隐藏土层必须逐层揭示”的核心规则。
 */

(() => {
const { BACKPACK_CUSTOM_CONFIG, FINAL_HIDDEN_LAYER_TYPE, HARVEST_CLICKS_BY_TYPE, HARVEST_HUNGER_COST_BY_TYPE, HARVEST_WEAR_BY_TYPE, EAT_WEAR_BY_TYPE, HIDDEN_LAYER_TYPES, INDESTRUCTIBLE_TYPES, NODE_SIZE, NODE_TYPES, RESOURCE_CONFIG, rules, Node, createRandomStream, resetRandomSequences } = window.TreeWorld;

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
    // 新世界从 config.js 的同一随机种子重新起算，便于完全复现世界生成。
    resetRandomSequences();
    this.nodes = [];
    this.edges = [];
    this.uiNodes = [];
    this.inventory = {};
    // 动态物品除了数量外还需保存“被捕获前属于哪一个父节点”的信息，供放回世界时判定归属。
    this.dynamicInventoryOrigins = {};
    this.nextDynamicOriginId = 1;
    this.resources = Object.fromEntries(Object.entries(RESOURCE_CONFIG).map(([type, data]) => [type, data.initial]));
    this.gameOver = false;
    this.lastTick = 0;

    // 山是不可被清空的世界根；森林、草地和岩壁等区域都会挂在它下面。
    this.root = new Node("山", width / 2, height / 2);
    // 生成路径是局部随机流的唯一地址；同一总种子下，每条分支都可独立复现。
    this.root.generationKey = "world-root";
    this.nodes.push(this.root);

    // 天空属于固定屏幕层：它不是山的子节点，也不会因缩放、平移或拖动而改变位置。
    this.sky = new Node("天空", width / 2, 75, true);
    this.sky.fixedUI = true;
    this.sky.celestialUI = true;

    // UI 使用屏幕坐标：初始化在左侧中部，永远不受世界相机缩放影响。
    // 身体固定在底栏、饥饿节点左侧，不允许被拖动。
    this.body = new Node("身体", width / 2 - 240, height - 75, true);
    this.body.fixedUI = true;
    // 工作区固定入口分居屏幕上下两个区域：背包在 1/4，思考在 3/4，x 坐标保持左侧不变。
    this.backpack = new Node("背包", 80, height / 4, true);
    // 背包分类树独立于 inventory：关闭背包后物品卡片会重建，但自定义节点与归属关系必须永久保留。
    this.backpackItemGroups = {};
    // 已归类的拆分物需要跨“关闭/重开背包”保存；每条记录代表一份独立数量与其分类位置。
    this.backpackDetachedRecords = [];
    this.nextBackpackDetachedRecordId = 1;
    this.nextCustomBackpackId = 1;
    this.thought = new Node("思考", this.backpack.x, height * 3 / 4, true);
    this.thought.fixedUI = true;
    this.resetNode = new Node("刷新", 70, 55, true);
    this.resetNode.fixedUI = true;
    // 保存初始化坐标，复原按钮只需读取这里即可恢复 UI。
    this.initialUIPositions = {
      body: { x: this.body.x, y: this.body.y },
      backpack: { x: this.backpack.x, y: this.backpack.y }
    };
    this.uiNodes.push(this.sky, this.body, this.backpack, this.thought, this.resetNode);
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
      const candidates = HIDDEN_LAYER_TYPES.filter(type => {
        const definition = NODE_TYPES[type] || {};
        const chance = definition.spawnChance ?? 1;
        return createRandomStream(`${owner.generationKey}:underlay:${index}:chance:${type}`).next() < chance;
      });
      // 最后一层永远是基岩；若本层没有任何矿物通过概率判定，也提前以基岩封底。
      const type = index === count - 1 || !candidates.length
        ? FINAL_HIDDEN_LAYER_TYPE
        : createRandomStream(`${owner.generationKey}:underlay:${index}:type`).pick(candidates);
      const layer = new Node(type, owner.x, owner.y - (index + 1) * gap);
      layer.generationKey = `${owner.generationKey}/underlay:${index}:${type}`;
      layer.visible = false;
      layer.hiddenUnderlay = true;
      layer.locked = true;
      // 地层属于替补 pile；揭示后也不应像普通独立终端节点一样被单独拖动。
      layer.replacementLayer = true;
      parent.underlays = [layer];
      parent = layer;
      if (type === FINAL_HIDDEN_LAYER_TYPE) break;
    }
  }

  /** 返回替补 pile 中紧挨着 node 的下一层；普通 children 不参与这条链。 */
  nextReplacement(node) {
    return node?.underlays[0] || null;
  }

  /**
   * 用 replacement 接替 node 在所有父节点中的位置。
   * 这是替补 pile 的连接核心：替补节点继承上层节点的父级连线，而不是成为普通子节点。
   */
  replaceInParents(node, replacement) {
    const parents = this.edges.filter(edge => edge.to === node).map(edge => edge.from);
    parents.forEach(parent => {
      const index = parent.children.indexOf(node);
      if (index >= 0) {
        if (parent.children.includes(replacement)) parent.children.splice(index, 1);
        else parent.children[index] = replacement;
      } else if (!parent.children.includes(replacement)) {
        parent.children.push(replacement);
      }
      this.edges = this.edges.filter(edge => !(edge.from === parent && edge.to === node));
      if (!this.edges.some(edge => edge.from === parent && edge.to === replacement)) {
        this.edges.push({ from: parent, to: replacement });
      }
    });
    return parents;
  }

  /**
   * 移除替补 pile 的首层，让其下一层接替到画面和父级连接中。
   * 树、放置物、土与矿物都可使用本方法，因此“消失后由下一层替补”只有一个实现入口。
   */
  removeReplacementHead(node) {
    const next = this.nextReplacement(node);
    if (!next) return null;
    next.visible = true;
    next.hiddenUnderlay = false;
    next.locked = false;
    if (!this.nodes.includes(next)) this.nodes.push(next);
    const inheritedParents = this.replaceInParents(node, next);
    // 没有父级连接的孤立节点才回退挂到世界根，保证替补节点仍可见、可操作。
    if (!inheritedParents.length && !this.root.children.includes(next)) {
      this.root.children.push(next);
      this.edges.push({ from: this.root, to: next });
    }
    return next;
  }

  /**
   * 将 newHead 压入 currentHead 的上方，成为替补 pile 的新首层。
   * currentHead 不会被删除，只会暂时隐藏，直到 newHead 被移除后再次接替回来。
   */
  pushReplacementHead(currentHead, newHead) {
    newHead.underlays = [currentHead];
    newHead.replacementLayer = true;
    currentHead.visible = false;
    currentHead.hiddenUnderlay = true;
    currentHead.locked = true;
    if (!this.nodes.includes(newHead)) this.nodes.push(newHead);
    this.replaceInParents(currentHead, newHead);
    return newHead;
  }

  /**
   * 检查替补 pile 是否是一条通向基岩、且中间全为地质节点的有效承载链。
   * 显示父子线可以变化，但这里始终只沿 underlays 读取真实的替补顺序。
   */
  hasValidGroundChain(node) {
    const visited = new Set();
    let current = node;
    while (current && !visited.has(current)) {
      visited.add(current);
      const definition = NODE_TYPES[current.type] || {};
      if (!definition.groundLayer) return false;
      if (current.type === FINAL_HIDDEN_LAYER_TYPE) return true;
      current = this.nextReplacement(current);
    }
    return false;
  }

  /** 记录动态节点被收集前的父级与祖先链；即使原父级之后消失，也可按原迁徙规则寻找替代家园。 */
  captureDynamicOrigin(node) {
    const parent = this.parentOf(node);
    const lineage = [];
    let branch = parent;
    while (branch) {
      const ancestor = this.parentOf(branch);
      if (!ancestor) break;
      lineage.push({ branch, ancestor });
      branch = ancestor;
    }
    return { id: this.nextDynamicOriginId++, parent, parentType: parent?.type || null, lineage };
  }

  /** 将捕获记录加入同类动态物品的库存队列；数字库存仍保留在 inventory 中作为统一总数。 */
  storeDynamicOrigin(type, origin) {
    if (!origin) return;
    this.dynamicInventoryOrigins[type] = this.dynamicInventoryOrigins[type] || [];
    this.dynamicInventoryOrigins[type].push(origin);
  }

  /** 从动态库存记录中移除一只已被吃掉或重新放回世界的动态节点。 */
  consumeDynamicOrigin(type, origin) {
    if (!origin) return;
    this.dynamicInventoryOrigins[type] = (this.dynamicInventoryOrigins[type] || []).filter(item => item.id !== origin.id);
  }

  /** 将一个动态世界节点接回静态父节点，并恢复它作为世界节点的可见性与运动资格。 */
  attachDynamicNode(type, origin, parent) {
    const node = new Node(type, parent.x, parent.y);
    node.dynamicOrigin = origin;
    node.visible = Boolean(parent.visible && parent.open);
    parent.children.push(node);
    this.nodes.push(node);
    this.edges.push({ from: parent, to: node });
    return node;
  }

  /** 原父节点已不存在时，按捕获时保存的兄弟/祖先路径寻找同类型的新父节点。 */
  findDynamicMigrationTarget(origin) {
    for (const { branch, ancestor } of origin?.lineage || []) {
      if (!this.nodes.includes(ancestor)) continue;
      for (const sibling of ancestor.children.filter(child => child !== branch && !child.dynamic)) {
        const target = this.findDescendantByType(sibling, origin.parentType);
        if (target && !target.dynamic) return { parent: target, host: null };
        if (this.canEventuallyContainType(sibling.type, origin.parentType)) return { parent: null, host: sibling };
      }
    }
    return { parent: null, host: null };
  }

  /**
   * 放置动态背包物品：同类父节点上直接重新挂载；放错位置则优先飞回原父节点，
   * 原父节点已消失时再沿原有迁徙规则寻找替代父节点，找不到才消失。
   */
  placeDynamicBackpackItem(item, target) {
    const origin = item.dynamicOrigins?.[0];
    if (!origin?.parentType) return { placed: false, reason: "这个动态物品缺少原父节点记录，无法放回世界。" };
    if (!target || target.dynamic || target.ui) return { placed: false, reason: "请放到一个静态世界节点上。" };

    let parent = null;
    let pendingHost = null;
    let message = "";
    if (target.type === origin.parentType) {
      parent = target;
      message = `${item.type} 已成为 ${target.type} 的子节点。`;
    // 原父节点只要仍在世界中，就优先回归；它被收起时会先以隐藏状态挂回，待玩家再次展开后出现。
    } else if (this.nodes.includes(origin.parent) && !origin.parent.dynamic) {
      parent = origin.parent;
      message = `放置位置不匹配，${item.type} 已飞回原来的 ${parent.type}。`;
    } else {
      const destination = this.findDynamicMigrationTarget(origin);
      parent = destination.parent;
      pendingHost = destination.host;
      message = parent
        ? `放置位置不匹配，${item.type} 已迁徙到另一处 ${parent.type}。`
        : pendingHost
          ? `放置位置不匹配，${item.type} 已停靠到未展开的 ${pendingHost.type}。`
          : `放置位置不匹配，${item.type} 找不到同类父节点，已离开世界。`;
    }

    let node = parent ? this.attachDynamicNode(item.type, origin, parent) : null;
    if (!node && pendingHost) {
      node = new Node(item.type, pendingHost.x, pendingHost.y);
      node.dynamicOrigin = origin;
      this.nodes.push(node);
      this.parkDynamicNode(node, pendingHost, origin.parentType);
    }
    this.consumeDynamicOrigin(item.type, origin);
    item.dynamicOrigins.shift();
    this.inventory[item.type] = Math.max(0, (this.inventory[item.type] || 0) - 1);
    item.quantity -= 1;
    if (item.quantity <= 0) {
      this.removeBackpackVisualItem(item);
      this.uiNodes = this.uiNodes.filter(nodeItem => nodeItem !== item);
    }
    this.syncBackpackQuantity(item.type);
    return { placed: true, node, itemRemaining: item.quantity > 0, message };
  }

  /** 将一整叠动态物品逐一按原父节点规则放回世界；动态节点绝不成为地下替补容器。 */
  placeDynamicBackpackPile(item, target) {
    const results = [];
    while (item.quantity > 0 && item.dynamicOrigins?.length) {
      results.push(this.placeDynamicBackpackItem(item, target));
    }
    if (!results.length) return { placed: false, reason: "这个动态 pile 没有可放回世界的个体记录。" };
    const returned = results.filter(result => result.node).length;
    const departed = results.length - returned;
    return {
      placed: true,
      node: results.find(result => result.node)?.node || null,
      itemRemaining: false,
      message: departed
        ? `已处理 ${results.length} 个动态节点：${returned} 个重新找到父节点，${departed} 个离开世界。`
        : `已将 ${returned} 个动态节点按原父节点规则放回世界。`
    };
  }

  /** 展开世界中的静态 pile，生成与其数量相同、必须逐个采集的同类终端子节点。 */
  expandWorldPile(node) {
    if (!node.worldPileChildrenCreated) {
      const count = Math.max(1, Math.floor(node.quantity));
      const radius = Math.max(115, Math.min(220, 70 + count * 14));
      for (let index = 0; index < count; index++) {
        const angle = count === 1 ? -Math.PI / 2 : -Math.PI / 2 + index * Math.PI * 2 / count;
        const child = new Node(node.type, node.x + Math.cos(angle) * radius, node.y + Math.sin(angle) * radius);
        // 这些子节点虽与 pile 同类型，但始终作为终端资源采集，不能再次展开成类型默认子节点。
        child.worldPileChild = true;
        child.generationKey = `${node.generationKey || `placed:${node.type}`}:pile-item:${index}`;
        node.children.push(child);
        this.nodes.push(child);
        this.edges.push({ from: node, to: child });
      }
      node.worldPileChildrenCreated = true;
    }
    node.open = true;
    node.children.forEach(child => child.visible = true);
    return node.children;
  }

  /**
   * 将选中的整个背包 pile 放入世界。
   * 静态物品成为替补链新首层的容器；动态物品则逐只回归或迁徙，不走地层规则。
   */
  placeBackpackPile(item, groundNode) {
    // 分类里的完整份额以 detached + groupedDetached 保存，以便它能与根背包同类 pile 共存；
    // 它不是从来源 pile 临时拆出的物品，因此允许作为完整 pile 放置。真正临时拆出物仍禁止整叠放置。
    const categoryPile = Boolean(item?.detached && item.groupedDetached && !item.sourcePile);
    if (!item?.backpackItemOwner || (!categoryPile && item.detached) || item.quantity < 1) {
      return { placed: false, reason: "需要选中背包中的完整 pile。" };
    }
    if (this.allBackpackItems().some(node => node !== item && node.type === item.type && node.detached && !node.groupedDetached)) {
      return { placed: false, reason: "请先收回同类已拆出的物品，再放置整叠。" };
    }
    if (NODE_TYPES[item.type]?.dynamic) return this.placeDynamicBackpackPile(item, groundNode);
    if (!this.hasValidGroundChain(groundNode)) return { placed: false, reason: "这里下方必须是一条通向基岩的纯矿物地层。" };
    if (groundNode.open) return { placed: false, reason: "请先收起当前展开的地层。" };

    const placed = new Node(item.type, groundNode.x, groundNode.y);
    placed.placedInWorld = true;
    placed.worldPile = true;
    placed.isNumericPile = true;
    placed.quantity = item.quantity;
    placed.worldPileChildrenCreated = false;
    placed.generationKey = `placed-pile:${item.type}:${this.nodes.length}`;
    this.pushReplacementHead(groundNode, placed);

    this.inventory[item.type] = Math.max(0, (this.inventory[item.type] || 0) - item.quantity);
    // 无论该 pile 是普通完整 pile，还是分类中的独立份额，只要它的直接父节点是分类，
    // 放进世界就必须切断这条背包分类映射。世界 pile 是新的世界实体；以后重新采集时
    // 应视为新的收获，全部先进入根背包，不能回到它放置前所在的分类。
    if (item.backpackParent?.customNode && this.backpackItemGroups[item.type] === item.backpackParent.customId) {
      delete this.backpackItemGroups[item.type];
    }
    this.removeBackpackVisualItem(item);
    this.uiNodes = this.uiNodes.filter(node => node !== item);
    this.syncBackpackQuantity(item.type);
    return { placed: true, node: placed, itemRemaining: false, message: `已将 ${placed.type} ×${placed.quantity} 放入地层最上方。` };
  }

  /**
   * 消耗一个背包拆分物品，并让它接替当前最上层地层。
   * 被覆盖的地层进入新物品的替补链；物品被移除后，该地层会再接替回来。
   */
  placeBackpackItem(item, groundNode) {
    // 最后一件背包物品无法再“拆出”，但可以整层作为待放置物；底部生命、饥饿、专注资源仍不走此逻辑。
    if (!item?.backpackItemOwner || item.quantity < 1) return { placed: false, reason: "需要先拿起一个背包物品。" };
    // 动态节点不是地层材料；它们优先依据原父节点类型重新挂载或迁徙。
    if (NODE_TYPES[item.type]?.dynamic) return this.placeDynamicBackpackItem(item, groundNode);
    if (!this.hasValidGroundChain(groundNode)) return { placed: false, reason: "这里下方必须是一条通向基岩的纯矿物地层。" };
    // 曾经展开过的矿层保留其内部子节点数据，但只要当前已收起，就可作为完整替补层被覆盖。
    // 这样放置物移除后，原矿层仍能按原来的展开状态继续被探索。
    if (groundNode.open) return { placed: false, reason: "请先收起当前展开的地层。" };

    const placed = new Node(item.type, groundNode.x, groundNode.y);
    placed.placedInWorld = true;
    // 放置物成为替补 pile 的新首层，原地层则作为下一层等待再次接替。
    this.pushReplacementHead(groundNode, placed);

    // inventory 是背包总数的唯一来源；放置一件后只扣总数，显示数量由统一同步函数负责重算。
    this.inventory[item.type] = Math.max(0, (this.inventory[item.type] || 0) - 1);
    item.quantity -= 1;
    if (item.quantity <= 0) {
      this.removeBackpackVisualItem(item);
      this.uiNodes = this.uiNodes.filter(node => node !== item);
    }
    this.syncBackpackQuantity(item.type);
    return { placed: true, node: placed, itemRemaining: item.quantity > 0 };
  }

  /** 判断节点是否是规则上的终端节点，从而允许采集。 */
  isHarvestable(node) {
    return !node.ui && !node.worldPile && !this.isIndestructible(node)
      && (node.worldPileChild || (node.children.length === 0 && (rules[node.type] || []).length === 0));
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
  findPosition(parent, stream) {
    for (let radius = 150; radius < 700; radius += 80) {
      for (let i = 0; i < 50; i++) {
        const angle = stream.next() * Math.PI * 2;
        const x = parent.x + Math.cos(angle) * radius;
        const y = parent.y + Math.sin(angle) * radius;
        // 动态生物不会改变静态节点的生成位置，否则鸟在不同时间飞到哪里会间接扰乱同一种子的世界布局。
        const occupied = this.nodes.some(n => !n.dynamic && n.visible && Math.abs(n.x - x) < NODE_SIZE.width && Math.abs(n.y - y) < NODE_SIZE.height);
        if (!occupied) return { x, y };
      }
    }
    return { x: parent.x + 200, y: parent.y + 150 };
  }

  /** 创建并接入一个世界子节点；树在这里获得各自独立的地下隐藏层。 */
  createWorldChild(parent, type) {
    const sameTypeIndex = parent.children.filter(child => child.type === type).length;
    const parentKey = parent.generationKey || parent.type;
    const generationKey = `${parentKey}/${type}:${sameTypeIndex}`;
    const position = this.findPosition(parent, createRandomStream(`${generationKey}:position`));
    const child = new Node(type, position.x, position.y);
    child.generationKey = generationKey;
    if (type === "树") {
      child.soilLayerCount = createRandomStream(`${generationKey}:underlay-count`).integer(3, 6);
      this.createHiddenSoilChain(child, child.soilLayerCount);
    }
    parent.children.push(child);
    this.nodes.push(child);
    this.edges.push({ from: parent, to: child });
    return child;
  }

  /** 展开普通世界节点；土也只会展开出一层终端土块。 */
  expand(node) {
    if (node.worldPile) return this.expandWorldPile(node);
    const structuralChildren = node.children.filter(child => !child.dynamic);
    if (structuralChildren.length) {
      // 已生成过的节点只恢复原有展开结构；概率只会在第一次展开时结算一次。
      node.open = true;
      this.showOpenDescendants(node);
      this.resolvePendingDynamicNodes(node);
      return [];
    }
    const available = rules[node.type] || [];
    if (!available.length) return [];

    const created = [];
    // 每一种候选子节点都有独立随机流：调整“花”的概率，不会改变“树枝”或其他树的结果。
    const candidates = available.filter(type => {
      const definition = NODE_TYPES[type] || {};
      const chance = definition.spawnChance ?? 1;
      // 迁徙进来的动态节点不占用该父节点自身的生成名额：每个树干仍会按配置生成自己的甲虫，
      // 因而一只外来甲虫迁入后，展开树干时可同时看到“原生甲虫 + 迁徙甲虫”。
      return createRandomStream(`${node.generationKey}:spawn:${type}:chance`).next() < chance;
    });
    const staticTypes = available.filter(type => !NODE_TYPES[type]?.dynamic);
    const generatedTypes = candidates.flatMap(type => {
      const [minimum, maximum] = spawnCountRange(NODE_TYPES[type]);
      const amount = createRandomStream(`${node.generationKey}:spawn:${type}:count`).integer(minimum, maximum);
      return Array.from({ length: amount }, () => type);
    });
    // 树至少拥有一个静态子节点，避免只剩鸟时触发“静态父节点不能仅留动态子节点”的清理规则。
    const minimumStatic = NODE_TYPES[node.type]?.minimumStaticChildren ?? 0;
    while (generatedTypes.filter(type => !NODE_TYPES[type]?.dynamic).length < minimumStatic && staticTypes.length) {
      const index = generatedTypes.filter(type => !NODE_TYPES[type]?.dynamic).length;
      generatedTypes.push(createRandomStream(`${node.generationKey}:static-fallback:${index}`).pick(staticTypes));
    }
    // spawnCount 是节点出现后的唯一数量来源；不再使用父节点的“凑数量”逻辑重复生成同一种节点。
    generatedTypes.forEach(type => created.push(this.createWorldChild(node, type)));
    node.open = true;
    // 首次展开时若已暂存迁徙鸟，也要与新生成的树枝、树干一同显示。
    node.children.forEach(child => child.visible = true);
    this.resolvePendingDynamicNodes(node);
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

  /** 收起节点时隐藏普通后代与其地下层，但保留已生成的数据供下次展开恢复。 */
  collapse(node) {
    const hide = current => {
      current.children.forEach(child => { child.visible = false; hide(child); });
      current.underlays.forEach(layer => { layer.visible = false; hide(layer); });
    };
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

  /** 在已生成的分支内寻找指定类型节点；未展开节点也可作为动态迁徙的暂存目标。 */
  findDescendantByType(node, type) {
    if (node.type === type) return node;
    for (const child of node.children) {
      const found = this.findDescendantByType(child, type);
      if (found) return found;
    }
    return null;
  }

  /** 根据 config.js 的 children 定义判断一个未展开分支未来能否生成所需父节点类型。 */
  canEventuallyContainType(type, requiredType, visited = new Set()) {
    if (type === requiredType) return true;
    if (visited.has(type)) return false;
    visited.add(type);
    return (rules[type] || []).some(childType => this.canEventuallyContainType(childType, requiredType, visited));
  }

  /** 将已存在的动态节点暂存到未展开的分支，等待其未来生成所需父节点后再正式挂载。 */
  parkDynamicNode(node, host, requiredParentType) {
    node.pendingDynamicHost = host;
    node.pendingParentType = requiredParentType;
    node.visible = false;
    node.dynamicState = null;
    host.pendingDynamicNodes = host.pendingDynamicNodes || [];
    host.pendingDynamicNodes.push(node);
  }

  /** 在节点展开后，把此前停靠在这里的动态节点接到刚生成的正确父节点下。 */
  resolvePendingDynamicNodes(host) {
    if (!host.pendingDynamicNodes?.length) return;
    const pending = host.pendingDynamicNodes.splice(0);
    pending.forEach(node => {
      const parent = this.findDescendantByType(host, node.pendingParentType);
      if (!parent || parent.dynamic) {
        // 当前配置仍未生成目标父节点时继续停靠，不让动态节点丢失。
        host.pendingDynamicNodes.push(node);
        return;
      }
      node.pendingDynamicHost = null;
      node.pendingParentType = null;
      node.x = parent.x;
      node.y = parent.y;
      node.visible = Boolean(parent.visible && parent.open);
      parent.children.push(node);
      this.edges.push({ from: parent, to: node });
    });
  }

  /** 从一条即将失效的父级分支中寻找真实父节点，或寻找可在未来生成该父节点的未展开宿主。 */
  findMigrationDestinationFromBranch(branch, requiredParentType) {
    let currentBranch = branch;
    while (currentBranch) {
      const ancestor = this.parentOf(currentBranch);
      if (!ancestor) break;
      for (const sibling of ancestor.children.filter(child => child !== currentBranch && !child.dynamic)) {
        const existingParent = this.findDescendantByType(sibling, requiredParentType);
        if (existingParent && !existingParent.dynamic) return { parent: existingParent, host: null };
        if (this.canEventuallyContainType(sibling.type, requiredParentType)) return { parent: null, host: sibling };
      }
      currentBranch = ancestor;
    }
    return { parent: null, host: null };
  }

  /**
   * 父节点即将消失时，为动态子节点寻找新的同类型父节点。
   * 搜索从父节点的兄弟分支开始，逐层上溯；到根仍找不到时，该动态节点消失。
   */
  migrateDynamicNode(node, formerParent) {
    const requiredParentType = formerParent.type;
    formerParent.children = formerParent.children.filter(child => child !== node);
    this.nodes = this.nodes.filter(item => item !== node);
    this.edges = this.edges.filter(edge => !(edge.from === formerParent && edge.to === node));
    const destination = this.findMigrationDestinationFromBranch(formerParent, requiredParentType);
    if (destination.parent) {
      node.x = destination.parent.x;
      node.y = destination.parent.y;
      node.visible = Boolean(destination.parent.visible && destination.parent.open);
      node.dynamicState = null;
      destination.parent.children.push(node);
      this.nodes.push(node);
      this.edges.push({ from: destination.parent, to: node });
      return true;
    }
    if (destination.host) {
      // 暂存节点本身仍保留在 world.nodes 中，确保之后展开宿主时可以接回正确的父级。
      this.nodes.push(node);
      this.parkDynamicNode(node, destination.host, requiredParentType);
      return true;
    }
    this.edges = this.edges.filter(edge => edge.from !== node && edge.to !== node);
    return false;
  }

  /**
   * 持续维护“静态父节点不能只挂动态子节点”的硬性规则。
   * 这能覆盖复原、收起或旧状态恢复等未经过正常采集回调的路径，避免树下只剩鸟却不迁徙。
   */
  pruneDynamicOnlyStaticParents() {
    const candidates = this.nodes.filter(parent => {
      if (parent === this.root || parent.ui || parent.dynamic || !parent.children.length) return false;
      const onlyDynamicChildren = parent.children.every(child => child.dynamic);
      // 只有已展开的静态节点才会被清理；未展开树可暂存迁徙来的鸟，待展开时再生成自己的静态分支。
      return onlyDynamicChildren && parent.open;
    });
    candidates.forEach(parent => {
      // 前一个候选项可能已递归清理此节点，因此每次处理前重新确认它仍存在。
      if (!this.nodes.includes(parent) || parent.children.some(child => !child.dynamic)) return;
      parent.children.slice().filter(child => child.dynamic).forEach(child => this.migrateDynamicNode(child, parent));
      if (this.nodes.includes(parent)) this.removeNodeAndEmptyParents(parent);
    });
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
      // 所有资源显示统一保留一位小数，避免 7.00000000001 之类的浮点误差累积到输入框。
      anchor.quantity = Math.max(0, Math.round((this.resources[type] - detachedAmount + Number.EPSILON) * 10) / 10);
      // 资源可以保留小数余量：8.8 最多拆出 8，留下 0.8；以总量限幅可避免拆出期间把输入值错误压成 1。
      const maximumSplit = Math.max(1, Math.floor(this.resources[type] + Number.EPSILON));
      anchor.splitAmount = Math.min(anchor.splitAmount || 1, maximumSplit);
    });
  }

  /** 将底部资源原节点按整数单位拆出；允许原节点保留不足 1 的小数余量。 */
  detachResourceItem(item) {
    if (!item?.resourcePileOwner || item.detached) return null;
    const maximum = Math.floor(item.quantity + Number.EPSILON);
    if (maximum < 1) return null;
    const amount = Math.max(1, Math.min(Math.round(Number(item.splitAmount) || 1), maximum));
    const detached = new Node(item.type, item.x, item.y, true);
    detached.quantity = amount;
    detached.detached = true;
    detached.sourcePile = item;
    detached.resourcePileOwner = item;
    detached.isNumericPile = true;
    item.children.push(detached);
    this.uiNodes.push(detached);
    this.syncResourcePiles();
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

  /** 窗口宽度变化时，天空始终锚定在屏幕顶端正中央。 */
  positionSky(width) {
    this.sky.x = width / 2;
    this.sky.y = 75;
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

  /** 返回背包自定义分类树中的所有分类节点，顺序与玩家创建顺序一致。 */
  customBackpackNodes(parent = this.backpack, result = []) {
    parent.children.filter(child => child.customNode).forEach(child => {
      result.push(child);
      this.customBackpackNodes(child, result);
    });
    return result;
  }

  /** 返回背包分类树中所有物品卡片，包括已拆出的独立物品。 */
  allBackpackItems(parent = this.backpack, result = []) {
    parent.children.forEach(child => {
      if (child.customNode) this.allBackpackItems(child, result);
      else if (child.backpackItemOwner === this.backpack) result.push(child);
    });
    return result;
  }

  /** 根据持久 id 找回自定义分类；找不到时归入背包根节点，避免配置或旧存档导致物品丢失。 */
  customBackpackContainer(id) {
    return this.customBackpackNodes().find(node => node.customId === id) || this.backpack;
  }

  /** 创建一个背包内部分类节点；父级可以是背包本身或任意已有自定义节点。 */
  createCustomBackpackNode(parent = this.backpack, viewportWidth = Infinity) {
    const limit = Math.max(1, Number(BACKPACK_CUSTOM_CONFIG.maxChildrenPerLayer) || 5);
    if (parent.children.filter(child => child.customNode).length >= limit) return null;
    const node = new Node("自定义", parent.x, parent.y, true);
    node.customNode = true;
    node.customId = `custom-${this.nextCustomBackpackId++}`;
    node.customLabel = `分类 ${this.nextCustomBackpackId - 1}`;
    node.customParent = parent;
    node.open = true;
    // 分类是背包的固定 UI 结构，不随世界相机缩放；其内部物品仍沿用原有的缩放表现。
    node.scalesWithWorld = false;
    parent.children.push(node);
    if (this.backpack.open) this.setBackpackOpen(true, viewportWidth);
    return node;
  }

  /** 删除父级最近创建的直接分类，并把其中全部内容（含更深分类）上移给父级。 */
  removeNewestCustomBackpackNode(parent = this.backpack, viewportWidth = Infinity) {
    const children = parent.children.filter(child => child.customNode);
    const node = children.at(-1);
    if (!node) return null;
    const limit = Math.max(1, Number(BACKPACK_CUSTOM_CONFIG.maxChildrenPerLayer) || 5);
    const adoptedCustomCount = node.children.filter(child => child.customNode).length;
    // 删除分类会把它的直接子分类上移；若上移后超过同层上限，就拒绝删除而不是悄悄突破规则。
    if (children.length - 1 + adoptedCustomCount > limit) {
      this.lastCustomOperationReason = `删除后会让这一层超过 ${limit} 个自定义分类。`;
      return null;
    }
    const index = parent.children.indexOf(node);
    const adopted = [...node.children];
    // 背包关闭时普通物品卡片并不在树上，仍需通过持久归属表把原本直接位于该分类的物品上移。
    Object.keys(this.backpackItemGroups).forEach(type => {
      if (this.backpackItemGroups[type] === node.customId) this.backpackItemGroups[type] = parent.customId || null;
    });
    this.backpackDetachedRecords.forEach(record => {
      if (record.customId === node.customId) record.customId = parent.customId || null;
    });
    adopted.forEach(child => {
      if (child.customNode) child.customParent = parent;
      if (child.backpackItemOwner === this.backpack) {
        child.backpackParent = parent;
        if (!child.detached && this.backpackItemGroups[child.type] === node.customId) {
          this.backpackItemGroups[child.type] = parent.customId || null;
        }
      }
    });
    parent.children.splice(index, 1, ...adopted);
    // 分类消失后，回到同一父级的同类独立份额应立即合并，避免根背包出现无法归位的重复物品。
    [...new Set(adopted.filter(child => child.backpackItemOwner === this.backpack).map(child => child.type))]
      .forEach(type => this.mergeGroupedBackpackItemsInContainer(parent, type));
    node.children = [];
    node.visible = false;
    this.uiNodes = this.uiNodes.filter(item => item !== node);
    if (this.backpack.open) this.setBackpackOpen(true, viewportWidth);
    return node;
  }

  /** 将一个完整 pile 移入自定义分类或背包根节点；背包根节点同样是合法的整理目标。 */
  moveBackpackItemToCustom(item, customNode, viewportWidth = Infinity) {
    if (!item?.backpackItemOwner || item.detached || (!customNode?.customNode && customNode !== this.backpack)) return { moved: false, reason: "请选择一个完整的背包物品和一个分类或背包。" };
    const detachedParts = this.allBackpackItems().filter(other => other.type === item.type && other.detached);
    // 未归类的拆分物仍须先处理；已归类到其它分类的拆分物可以独立保留，不再阻止剩余 pile 进入新分类。
    if (detachedParts.some(other => !other.groupedDetached)) {
      return { moved: false, reason: "请先收回该 pile 已拆出的物品，再进行归类。" };
    }
    // 同一分类中的拆分物与原 pile 合并；其它分类中的同类拆分物保持独立数量与独立分类。
    detachedParts.filter(other => other.backpackParent === customNode).forEach(other => this.removeBackpackVisualItem(other));
    this.backpackItemGroups[item.type] = customNode.customId || null;
    this.setBackpackOpen(true, viewportWidth);
    return { moved: true, mergedParts: detachedParts.filter(other => other.backpackParent === customNode).length };
  }

  /** 将同一容器内的同类独立份额合并：优先并入完整 pile，否则合并为一份独立数量。 */
  mergeGroupedBackpackItemsInContainer(container, type) {
    const sameType = container.children.filter(item => item.backpackItemOwner === this.backpack && item.type === type);
    const primary = sameType.find(item => !item.detached);
    const groupedParts = sameType.filter(item => item.detached && item.groupedDetached);
    if (primary && groupedParts.length) {
      groupedParts.forEach(item => this.removeBackpackVisualItem(item));
      this.syncBackpackQuantity(type);
      return true;
    }
    if (!primary && groupedParts.length > 1) {
      const anchor = groupedParts[0];
      anchor.quantity = groupedParts.reduce((sum, item) => sum + item.quantity, 0);
      groupedParts.slice(1).forEach(item => this.removeBackpackVisualItem(item));
      this.captureGroupedDetachedBackpackItems();
      return true;
    }
    return false;
  }

  /** 将已拆出的单独物品卡片移入分类或背包根；它不改变库存，只改变该独立份额的归属。 */
  moveDetachedBackpackItemToCustom(item, customNode, viewportWidth = Infinity) {
    if (!item?.backpackItemOwner || !item.detached || (!customNode?.customNode && customNode !== this.backpack)) {
      return { moved: false, reason: "只有已拆出的单独物品可以移入分类或背包。" };
    }
    const previousParent = item.backpackParent || this.backpack;
    previousParent.children = previousParent.children.filter(child => child !== item);
    customNode.children.push(item);
    item.backpackParent = customNode;
    // 归类后的拆分物不再是原 pile 的临时延伸：取消来源引用与来源线，但保留 detached 标记用于正确扣除原 pile 数量。
    item.sourcePile = null;
    item.groupedDetached = true;
    item.detachedRecordId = item.detachedRecordId || `detached-${this.nextBackpackDetachedRecordId++}`;
    this.mergeGroupedBackpackItemsInContainer(customNode, item.type);
    this.captureGroupedDetachedBackpackItems();
    this.layoutBackpackTree(viewportWidth);
    return { moved: true };
  }

  /** 从当前显示树中移除物品卡片；库存本身仍由 inventory 统一保存。 */
  removeBackpackVisualItem(item) {
    const parent = item?.backpackParent || this.backpack;
    parent.children = parent.children.filter(node => node !== item);
    this.uiNodes = this.uiNodes.filter(node => node !== item);
    if (item?.detachedRecordId) {
      this.backpackDetachedRecords = this.backpackDetachedRecords.filter(record => record.id !== item.detachedRecordId);
    }
  }

  /** 将当前已归类的拆分物写回持久记录；普通临时拆分物仍会在关闭背包时按旧规则归位。 */
  captureGroupedDetachedBackpackItems() {
    const visibleRecords = this.allBackpackItems()
      .filter(item => item.detached && item.groupedDetached && item.quantity > 0)
      .map(item => ({
        id: item.detachedRecordId || `detached-${this.nextBackpackDetachedRecordId++}`,
        type: item.type,
        quantity: item.quantity,
        customId: item.backpackParent?.customId || null,
        dynamicOrigins: item.dynamicOrigins ? [...item.dynamicOrigins] : null
      }));
    // 新采集前冻结的分类份额当时还没有可见的 detached 卡片；不能在下一次重建前
    // 被这里的“可见卡片快照”覆盖掉。等它被重建为可见卡片后，才由同 id 的快照接管。
    const visibleIds = new Set(visibleRecords.map(record => record.id));
    const hiddenPreserved = this.backpackDetachedRecords.filter(record => !visibleIds.has(record.id));
    this.backpackDetachedRecords = [...hiddenPreserved, ...visibleRecords];
  }

  /**
   * 在获得同类新物品前，保留玩家已放进分类的旧 pile。
   * inventory 记录的是同类物品总数；若直接删掉 backpackItemGroups，旧数量会在下次
   * 背包重建时错误地跟随新收获一起回到根背包。因此这里把旧数量转为“已归类的独立份额”，
   * 再让即将获得的新数量自然成为根背包的普通 pile。
   */
  preserveCategorizedPileBeforeHarvest(type) {
    const customId = this.backpackItemGroups[type];
    const existingQuantity = this.inventory[type] || 0;
    if (!customId || existingQuantity <= 0) return;

    // 已经是独立分类份额的记录先扣除；当前完整 pile 仅代表剩余那一部分。
    // 例如“分类 1 有 2、分类 3 有 3”时，库存 5 里只有 2 属于当前完整 pile，
    // 绝不能把全部 5 再冻结进分类 1，否则新采集的第 6 个会错误显示为 0。
    const recordedQuantity = this.backpackDetachedRecords
      .filter(record => record.type === type)
      .reduce((sum, record) => sum + record.quantity, 0);
    const primaryQuantity = Math.max(0, existingQuantity - recordedQuantity);
    if (primaryQuantity <= 0) {
      delete this.backpackItemGroups[type];
      return;
    }

    const existingRecord = this.backpackDetachedRecords.find(record => record.type === type && record.customId === customId);
    if (existingRecord) {
      existingRecord.quantity += primaryQuantity;
    } else {
      this.backpackDetachedRecords.push({
        id: `detached-${this.nextBackpackDetachedRecordId++}`,
        type,
        quantity: primaryQuantity,
        customId,
        // 动态来源若存在，随旧物品留在分类份额中；新捕获的动态节点会进入根背包。
        dynamicOrigins: this.dynamicInventoryOrigins[type] ? [...this.dynamicInventoryOrigins[type]] : null
      });
    }
    delete this.backpackItemGroups[type];
  }

  /** 关闭/重建背包前清理瞬时物品卡片，但保留自定义分类树。 */
  clearBackpackVisualItems(parent = this.backpack) {
    parent.children.filter(child => child.customNode).forEach(child => this.clearBackpackVisualItems(child));
    parent.children = parent.children.filter(child => child.customNode);
  }

  /** 根据当前展开状态递归显示分类树，并使用分层列布局避免同级物品重叠。 */
  layoutBackpackTree(viewportWidth = Infinity) {
    const direction = this.backpack.x > viewportWidth / 2 ? -1 : 1;
    const rows = [];
    const visit = (parent, depth, visible) => {
      parent.children.forEach(child => {
        child.visible = visible;
        if (visible) rows.push({ node: child, depth });
        if (child.customNode) visit(child, depth + 1, visible && child.open);
      });
    };
    visit(this.backpack, 1, this.backpack.open);
    rows.forEach(({ node, depth }, index) => {
      node.x = this.backpack.x + direction * (150 + (depth - 1) * 135);
      node.y = this.backpack.y + (index - (rows.length - 1) / 2) * 82;
      if (node.backpackItemOwner && !node.detached) node.pileAnchor = { x: node.x, y: node.y };
    });
  }

  /**
   * 用库存重建背包物品卡片。新采集物默认归背包根节点；只有玩家主动 Ctrl 归类后，
   * backpackItemGroups 才会把对应 pile 恢复到自定义分类中。
   * 自定义节点对象本身不会重建，所以关闭、复原或再次打开背包都不会丢失玩家整理出的层级。
   */
  setBackpackOpen(open, viewportWidth = Infinity) {
    // 仅在当前确实打开时从可见卡片采集记录；关闭后再次打开必须沿用上一次保存的分类拆分物。
    if (this.backpack.open) this.captureGroupedDetachedBackpackItems();
    this.uiNodes = this.uiNodes.filter(node => node.backpackItemOwner !== this.backpack && !node.customNode);
    this.clearBackpackVisualItems();
    this.backpack.open = open;
    if (!open) {
      this.layoutBackpackTree(viewportWidth);
      return;
    }

    const customNodes = this.customBackpackNodes();
    this.uiNodes.push(...customNodes);
    const sourcePiles = new Map();
    Object.entries(this.inventory).filter(([, count]) => count > 0).forEach(([type, count]) => {
      const parent = this.customBackpackContainer(this.backpackItemGroups[type]);
      const item = new Node(type, parent.x, parent.y, true);
      item.quantity = count;
      item.splitAmount = 1;
      item.detached = false;
      item.backpackItemOwner = this.backpack;
      item.backpackParent = parent;
      item.isNumericPile = true;
      if (NODE_TYPES[type]?.dynamic) item.dynamicOrigins = [...(this.dynamicInventoryOrigins[type] || [])];
      item.scalesWithWorld = true;
      parent.children.push(item);
      this.uiNodes.push(item);
      sourcePiles.set(type, item);
    });
    // 恢复已归类的独立拆分物：它们不再连接原 pile，但仍会从原 pile 的可用数量中扣除。
    this.backpackDetachedRecords.forEach(record => {
      if (!(this.inventory[record.type] > 0) || !(record.quantity > 0)) return;
      const parent = this.customBackpackContainer(record.customId);
      const item = new Node(record.type, parent.x, parent.y, true);
      item.quantity = record.quantity;
      item.detached = true;
      item.groupedDetached = true;
      item.detachedRecordId = record.id;
      item.backpackItemOwner = this.backpack;
      item.backpackParent = parent;
      item.isNumericPile = true;
      item.scalesWithWorld = true;
      if (record.dynamicOrigins) {
        item.dynamicOrigins = [...record.dynamicOrigins];
        const source = sourcePiles.get(record.type);
        if (source?.dynamicOrigins) {
          const ids = new Set(item.dynamicOrigins.map(origin => origin.id));
          source.dynamicOrigins = source.dynamicOrigins.filter(origin => !ids.has(origin.id));
        }
      }
      parent.children.push(item);
      this.uiNodes.push(item);
    });
    Object.keys(this.inventory).forEach(type => this.syncBackpackQuantity(type));
    this.layoutBackpackTree(viewportWidth);
  }

  /** 返回某一类型目前仍被拆出、尚未归位的总数量；库存总数不在这里修改。 */
  detachedBackpackQuantity(type) {
    return this.allBackpackItems()
      .filter(item => item.type === type && item.detached)
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  /**
   * 背包数量的唯一同步入口。
   * 原 pile 显示数量始终等于库存总数减去同类已拆出的数量；放置、归位、拆分、进食均调用这里，
   * 因而不会再分别做“加一”或“减一”的局部计算。
   */
  syncBackpackQuantity(type) {
    const available = Math.max(0, (this.inventory[type] || 0) - this.detachedBackpackQuantity(type));
    this.allBackpackItems()
      .filter(item => item.type === type && !item.detached && item.backpackItemOwner === this.backpack)
      .forEach(item => {
        item.quantity = available;
        item.splitAmount = Math.min(item.splitAmount || 1, Math.max(1, available - 1));
      });
    return available;
  }

  /** 从数值背包节点按分离条的数量拆出一个独立节点；最后一件不能拆出。 */
  detachBackpackItem(item) {
    // 分类中的完整份额也带 detached 标记，但它没有 sourcePile，且 groupedDetached 为真；
    // 它是可继续拆分的来源 pile，不应和临时拆出物混为一谈。
    const categorySource = Boolean(item?.detached && item.groupedDetached && !item.sourcePile);
    if (!item?.backpackItemOwner || (item.detached && !categorySource) || item.quantity <= 1) return null;
    const amount = Math.max(1, Math.min(item.splitAmount || 1, item.quantity - 1));
    const detached = new Node(item.type, item.x, item.y, true);
    detached.quantity = amount;
    detached.detached = true;
    detached.pileAnchor = { ...item.pileAnchor };
    detached.sourcePile = item;
    detached.backpackItemOwner = this.backpack;
    detached.isNumericPile = true;
    detached.scalesWithWorld = true;
    if (item.dynamicOrigins) {
      detached.dynamicOrigins = item.dynamicOrigins.splice(0, amount);
    }
    detached.backpackParent = item.backpackParent || this.backpack;
    detached.backpackParent.children.push(detached);
    this.uiNodes.push(detached);
    // 根背包的数量由 syncBackpackQuantity 统一推导；分类来源 pile 则须直接减少自身份额。
    if (categorySource) item.quantity -= amount;
    this.syncBackpackQuantity(item.type);
    return detached;
  }

  /** 兼容旧交互调用：数值背包节点不再需要逐层重新排版。 */
  layoutPile(type) {
    return this.allBackpackItems().find(item => item.type === type && !item.detached);
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
    const categorySource = Boolean(anchor.groupedDetached && !anchor.sourcePile);
    if (categorySource) anchor.quantity += item.quantity;
    this.removeBackpackVisualItem(item);
    if (item.dynamicOrigins?.length) {
      anchor.dynamicOrigins = [...item.dynamicOrigins, ...(anchor.dynamicOrigins || [])];
    }
    this.syncBackpackQuantity(anchor.type);
    return true;
  }

  /** 删除采集完成的节点；父节点空了会递归消失并揭示下一隐藏层。 */
  removeNodeAndEmptyParents(node) {
    const parents = this.edges.filter(edge => edge.to === node).map(edge => edge.from);
    const revealed = this.removeReplacementHead(node);
    this.nodes = this.nodes.filter(item => item !== node);
    this.edges = this.edges.filter(edge => edge.from !== node && edge.to !== node);

    parents.forEach(parent => {
      parent.children = parent.children.filter(child => child !== node);
      // 放置到世界的数值 pile 展开后会生成逐个采集的同类子节点。
      // 每删除一个子节点，立即按仍存在的子节点数回写容器数量；因此收起后左下角的 ×N 始终是剩余数量。
      if (parent.worldPile) {
        parent.quantity = parent.children.filter(child => child.worldPileChild).length;
      }
      // 静态父节点不能只留下动态子节点独立存在：先迁徙动态节点，再清理这个静态父节点。
      const structuralChildren = parent.children.filter(child => !child.dynamic);
      // 山作为世界根始终保留；动态父节点不套用此规则，避免错误清理未来的动态群落节点。
      if (parent !== this.root && !parent.dynamic && structuralChildren.length === 0 && parent.open) {
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

    // 先隔离分类中的旧同类物品，避免本次新收获把它们错误带回背包根节点。
    this.preserveCategorizedPileBeforeHarvest(node.type);
    if (node.dynamic) this.storeDynamicOrigin(node.type, this.captureDynamicOrigin(node));
    this.inventory[node.type] = (this.inventory[node.type] || 0) + 1;
    // 新收获始终归根背包；分类只由玩家的明确整理操作决定。
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
    if (NODE_TYPES[item.type]?.dynamic) this.consumeDynamicOrigin(item.type, item.dynamicOrigins?.shift());
    item.quantity -= 1;
    this.syncBackpackQuantity(item.type);
    if (item.quantity <= 0) {
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
    this.pruneDynamicOnlyStaticParents();
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
    this.allBackpackItems().filter(item => item.consumedUntil && now >= item.consumedUntil).forEach(item => {
      this.removeBackpackVisualItem(item);
    });
  }
}

window.TreeWorld.World = World;
})();
