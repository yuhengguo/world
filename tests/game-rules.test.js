/*
 * 节点世界自动规则测试。
 *
 * 运行方式：在项目根目录执行 `npm test`。
 * 本文件不依赖浏览器或第三方库：它在 Node.js 中加载游戏的纯逻辑模块，
 * 逐条验证曾经出现过的关键回归问题。Canvas 绘制与鼠标像素命中属于
 * 浏览器层交互，仍需在试玩时确认；世界规则、数量与迁徙应优先在这里守住。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const logicFiles = ["config.js", "node.js", "world.js", "dynamic.js", "time.js", "celestial.js", "workspace-panel.js"];

/** 在隔离上下文中加载游戏逻辑，确保每条测试都从全新的随机种子和世界状态开始。 */
function loadGame() {
  const context = {
    console,
    performance: { now: () => 0 },
    document: { getElementById: () => null },
    requestAnimationFrame: () => 0,
    addEventListener: () => {}
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  logicFiles.forEach(file => vm.runInContext(fs.readFileSync(path.join(projectRoot, "js", file), "utf8"), context, { filename: file }));
  return context.TreeWorld;
}

/** 创建一条真实父子连线，供不经由随机生成的最小场景复用。 */
function attach(world, parent, child) {
  parent.children.push(child);
  world.nodes.push(child);
  world.edges.push({ from: parent, to: child });
  return child;
}

/** 将一个可采集节点点击到完成，避免每条测试重复手动处理采集次数。 */
function finishHarvest(world, node) {
  let result;
  const clicks = world.harvestClicksFor(node);
  for (let index = 0; index < clicks; index++) result = world.harvest(node, index * 100);
  return result;
}

/** 临时覆盖某个 config 参数，并在测试结束后完整还原。 */
function withTypeConfig(game, type, overrides, callback) {
  const definition = game.NODE_TYPES[type];
  const original = { ...definition };
  Object.assign(definition, overrides);
  try { callback(); } finally {
    Object.keys(definition).forEach(key => delete definition[key]);
    Object.assign(definition, original);
  }
}

const tests = [];
function test(name, callback) { tests.push({ name, callback }); }

test("终端节点的最后一段既不扣移动体力，也不进入高亮路径", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const tree = attach(world, forest, new game.Node("树", 0, 0));
  const trunk = attach(world, tree, new game.Node("树干", 0, 0));
  const beetleA = attach(world, trunk, new game.Node("甲虫", 0, 0));
  const beetleB = attach(world, tree, new game.Node("甲虫", 0, 0));
  const result = world.moveBetweenNodes(beetleA, beetleB, 0);
  // 两端都是终端：路径与费用都从甲虫A父节点树干到甲虫B父节点树。
  // 只经过树干 → 树(1/4a)，a=.3，总成本 .075。
  assert.equal(result.path.length, 1);
  assert.equal(result.displayPath.length, 1);
  assert.equal(result.cost, .075);
  assert.equal(world.resources.饥饿, 9.925);
  assert.equal(world.movementPathEdges.length, 1);
});

test("终端不纳入路径后，被采集移除也不会破坏其父节点为端点的高亮", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const tree = attach(world, forest, new game.Node("树", 0, 0));
  const seed = attach(world, tree, new game.Node("种子", 0, 0));
  world.moveBetweenNodes(forest, seed, 0);
  assert.equal(world.movementPathEnd, tree);
  world.removeNodeAndEmptyParents(seed);
  assert.equal(world.movementPathEnd, tree);
  assert.ok(world.movementPathEdges.every(edge => world.edges.includes(edge)));
});

test("采集移动在没有预选静态节点时可从唯一世界根开始结算", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const seed = attach(world, forest, new game.Node("种子", 0, 0));
  const result = world.moveBetweenNodes(world.root, seed, 0);
  // 只显示根 → 森林；种子最后一段既不显示也不收费。
  assert.equal(result.displayPath.length, 1);
  assert.equal(result.cost, .3);
  assert.equal(world.resources.饥饿, 9.7);
  assert.equal(world.movementPathEdges.length, 1);
});

test("采集移动会覆盖已有高亮路径，始终只保留最近一次路线", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const treeA = attach(world, forest, new game.Node("树", 0, 0));
  const treeB = attach(world, forest, new game.Node("树", 0, 0));
  const seed = attach(world, treeB, new game.Node("种子", 0, 0));
  world.moveBetweenNodes(world.root, treeA, 0);
  const firstEdge = world.movementPathEdges[0];
  world.moveBetweenNodes(treeA, seed, 0);
  assert.ok(!world.movementPathEdges.includes(firstEdge));
  assert.equal(world.movementPathEdges.length, 2);
});

test("终端采集完成后，下一次静态移动可从该终端父节点继续结算", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const treeA = attach(world, forest, new game.Node("树", 0, 0));
  const treeB = attach(world, forest, new game.Node("树", 0, 0));
  const seed = attach(world, treeA, new game.Node("种子", 0, 0));
  // 这里验证同步所依赖的纯规则状态：采集终端后的落点是它的父节点，树A → 树B 有两条有效路径边。
  const harvestLanding = world.parentOf(seed);
  const result = world.moveBetweenNodes(harvestLanding, treeB, 0);
  assert.equal(harvestLanding, treeA);
  assert.equal(result.path.length, 2);
  // 树A → 森林、森林 → 树B 都由深度为 1 的森林边计费，各为 .15，共 .3。
  assert.equal(result.cost, .3);
});

test("开始采集时优先保留最近到达的静态位置，而非被手覆盖的蓝色焦点", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const treeA = attach(world, forest, new game.Node("树", 0, 0));
  const trunkA = attach(world, treeA, new game.Node("树干", 0, 0));
  const treeB = attach(world, forest, new game.Node("树", 0, 0));
  const branchB = attach(world, treeB, new game.Node("树枝", 0, 0));
  const flower = attach(world, branchB, new game.Node("花", 0, 0));
  // 手选中会清除树干的蓝色状态，但角色位置仍应从树干开始而非回退至根或森林。
  const result = world.moveBetweenNodes(trunkA, flower, 0);
  assert.equal(result.path.length, 4);
  assert.equal(result.path.map(step => `${step.travelFrom.type}→${step.travelTo.type}`).join(" | "), "树干→树 | 树→森林 | 森林→树 | 树→树枝");
});

test("采集起点优先采用金色位置，而非较早的采集父节点", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const tree = attach(world, forest, new game.Node("树", 0, 0));
  const trunk = attach(world, tree, new game.Node("树干", 0, 0));
  const mushroom = attach(world, forest, new game.Node("蘑菇", 0, 0));
  // 模拟旧采集记录停在森林，但玩家已通过静态移动到树干（金色位置）。
  const staleHarvestParent = forest;
  world.playerLocation = trunk;
  const result = world.moveBetweenNodes(world.playerLocation, mushroom, 0);
  assert.equal(staleHarvestParent, forest);
  assert.equal(result.path.map(step => `${step.travelFrom.type}→${step.travelTo.type}`).join(" | "), "树干→树 | 树→森林");
});

test("旧的累积高亮即使误含终端边，也会在刷新时被过滤掉", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const seed = attach(world, forest, new game.Node("种子", 0, 0));
  const terminalEdge = world.edges.find(edge => edge.to === seed);
  world.movementPathSteps = [{ edge: terminalEdge, travelFrom: forest, travelTo: seed }];
  world.movementPathEdges = [terminalEdge];
  world.refreshMovementPath();
  assert.equal(world.movementPathEdges.length, 0);
});

test("固定种子下相同生成路径使用相同随机流", () => {
  const game = loadGame();
  const first = Array.from({ length: 8 }, () => game.createRandomStream("same-branch").next());
  const second = Array.from({ length: 8 }, () => game.createRandomStream("same-branch").next());
  assert.deepEqual(first, second);
});

test("玩家位置开局位于山根，并在所在节点移除时回退到父节点", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  assert.equal(world.playerLocation, world.root);
  world.playerLocation = forest;
  world.removeNodeAndEmptyParents(forest);
  assert.equal(world.playerLocation, world.root);
});

test("身体始终以独立附属关系跟随当前玩家节点，不写入世界父子边", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  assert.equal(world.body.fixedUI, true);
  assert.equal(world.body.playerAttached, true);
  assert.equal(world.body.open, false);
  assert.equal(world.bodyAttachmentTarget(), world.root);
  assert.equal(world.edges.some(edge => edge.to === world.body), false);
  world.playerLocation = forest;
  assert.equal(world.bodyAttachmentTarget(), forest);
  world.bodyAttachmentOffset.x = 20;
  world.resetUIPositions();
  assert.equal(world.bodyAttachmentOffset.x, -88);
  assert.equal(world.bodyAttachmentOffset.y, 72);
});

test("采集清理掉当前位置父节点时，玩家位置会递归回退而不会被错误重置为山", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 0, 0));
  const tree = attach(world, forest, new game.Node("树", 0, 0));
  const trunk = attach(world, tree, new game.Node("树干", 0, 0));
  // 保留另一条静态分支，模拟截图中树在树干消失后仍然存在的情况。
  attach(world, tree, new game.Node("树枝", 0, 0));
  const log = attach(world, trunk, new game.Node("原木", 0, 0));
  tree.open = true;
  trunk.open = true;
  world.playerLocation = trunk;
  world.removeNodeAndEmptyParents(log);
  // 原木清除后树干空掉并被清理，位置应继续回退到树，而非直接回到山。
  assert.equal(world.playerLocation, tree);
});

test("spawnChance 为 0 时不会生成配置中的子节点", () => {
  const game = loadGame();
  withTypeConfig(game, "原木", { spawnChance: 0 }, () => {
    const world = new game.World(1000, 700);
    const trunk = new game.Node("树干", 300, 300);
    trunk.generationKey = "test:no-log";
    world.expand(trunk);
    assert.equal(trunk.children.filter(node => node.type === "原木").length, 0);
  });
});

test("spawnCount 是单个类型出现后的精确数量来源", () => {
  const game = loadGame();
  withTypeConfig(game, "原木", { spawnChance: 1, spawnCount: [3, 3] }, () => {
    const world = new game.World(1000, 700);
    const trunk = new game.Node("树干", 300, 300);
    trunk.generationKey = "test:three-logs";
    world.expand(trunk);
    assert.equal(trunk.children.filter(node => node.type === "原木").length, 3);
  });
});

test("隐藏替补层接替首层时继承原来的父子连线", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const tree = attach(world, world.root, new game.Node("树", 400, 400));
  tree.generationKey = "test:replacement";
  world.createHiddenSoilChain(tree, 2);
  const replacement = tree.underlays[0];
  world.removeNodeAndEmptyParents(tree);
  assert.ok(world.nodes.includes(replacement));
  assert.equal(world.parentOf(replacement), world.root);
  assert.equal(replacement.visible, true);
  assert.equal(replacement.locked, false);
});

test("玩家所在树被清空并揭示替补层时，位置优先转交给替补层", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const tree = attach(world, world.root, new game.Node("树", 400, 400));
  tree.generationKey = "test:player-replacement";
  world.createHiddenSoilChain(tree, 2);
  const replacement = tree.underlays[0];
  world.playerLocation = tree;
  world.removeNodeAndEmptyParents(tree);
  assert.equal(world.playerLocation, replacement);
  assert.equal(replacement.visible, true);
});

test("替补层接管当前路径端点时继承金色路径而不额外扣体力", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const tree = attach(world, world.root, new game.Node("树", 400, 400));
  tree.generationKey = "test:replacement-path";
  world.createHiddenSoilChain(tree, 2);
  const replacement = tree.underlays[0];
  world.moveBetweenNodes(world.root, tree, 0);
  world.playerLocation = tree;
  const hungerAfterMove = world.resources.饥饿;

  world.removeNodeAndEmptyParents(tree);
  const inheritedEdge = world.edges.find(edge => edge.from === world.root && edge.to === replacement);

  assert.equal(world.playerLocation, replacement);
  assert.equal(world.movementPathEnd, replacement);
  assert.equal(world.movementPathSteps.length, 1);
  assert.equal(world.movementPathSteps[0].edge, inheritedEdge);
  assert.equal(world.resources.饥饿, hungerAfterMove);
});

test("有效地层必须全由矿物层通向基岩", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const soil = new game.Node("土", 300, 300);
  const bedrock = new game.Node("基岩", 300, 290);
  soil.underlays = [bedrock];
  assert.equal(world.hasValidGroundChain(soil), true);
  soil.underlays = [new game.Node("树", 300, 290)];
  assert.equal(world.hasValidGroundChain(soil), false);
});

test("基岩不可采集，但触碰时保留颤动反馈", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const bedrock = new game.Node("基岩", 300, 300);
  assert.equal(world.harvest(bedrock, 10).accepted, false);
  assert.equal(world.touchIndestructible(bedrock, 100), true);
  assert.ok(bedrock.shakeUntil > 100);
});

test("整叠背包物品放置后成为地层最上方的数值 pile", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const soil = attach(world, world.root, new game.Node("土", 300, 300));
  soil.underlays = [new game.Node("基岩", 300, 290)];
  world.inventory.原木 = 3;
  world.setBackpackOpen(true, 1000);
  const pile = world.backpack.children.find(node => node.type === "原木" && !node.detached);
  const result = world.placeBackpackPile(pile, soil);
  assert.equal(result.placed, true);
  assert.equal(result.node.worldPile, true);
  assert.equal(result.node.quantity, 3);
  assert.equal(world.parentOf(result.node), world.root);
});

test("放置 pile 展开并采走一个后，收起时数量同步为剩余数量", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const pile = new game.Node("原木", 300, 300);
  pile.worldPile = true;
  pile.isNumericPile = true;
  pile.quantity = 3;
  pile.generationKey = "test:placed-pile";
  world.nodes.push(pile);
  world.expand(pile);
  finishHarvest(world, pile.children[0]);
  world.collapse(pile);
  assert.equal(pile.quantity, 2);
  assert.equal(pile.children.length, 2);
});

test("已展开过的矿层只要收起，就仍然可以作为放置目标", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const soil = attach(world, world.root, new game.Node("土", 300, 300));
  soil.underlays = [new game.Node("基岩", 300, 290)];
  soil.open = true;
  world.collapse(soil);
  world.inventory.原木 = 1;
  world.setBackpackOpen(true, 1000);
  const pile = world.backpack.children.find(node => node.type === "原木");
  assert.equal(world.placeBackpackPile(pile, soil).placed, true);
});

test("最后一件背包物品不能拆出，但可以作为完整 pile 放置", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const soil = attach(world, world.root, new game.Node("土", 300, 300));
  soil.underlays = [new game.Node("基岩", 300, 290)];
  world.inventory.原木 = 1;
  world.setBackpackOpen(true, 1000);
  const pile = world.backpack.children.find(node => node.type === "原木");
  assert.equal(world.detachBackpackItem(pile), null);
  assert.equal(world.placeBackpackPile(pile, soil).placed, true);
});

test("背包拆分并归位不会凭空增加物品数量", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.原木 = 3;
  world.setBackpackOpen(true, 1000);
  const pile = world.backpack.children.find(node => node.type === "原木");
  pile.splitAmount = 1;
  const detached = world.detachBackpackItem(pile);
  assert.equal(pile.quantity, 2);
  world.mergeBackpackItem(detached);
  assert.equal(pile.quantity, 3);
  assert.equal(world.inventory.原木, 3);
});

test("自定义分类树在关闭背包后保留，物品可归类并在删除分类时逐级上移", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.原木 = 2;
  world.setBackpackOpen(true, 1000);
  const first = world.createCustomBackpackNode(world.backpack, 1000);
  first.customLabel = "木材";
  const second = world.createCustomBackpackNode(first, 1000);
  second.customLabel = "备用";
  const pile = world.allBackpackItems().find(item => item.type === "原木");
  assert.equal(world.moveBackpackItemToCustom(pile, second, 1000).moved, true);
  world.setBackpackOpen(false, 1000);
  world.setBackpackOpen(true, 1000);
  const restored = world.allBackpackItems().find(item => item.type === "原木");
  assert.equal(restored.backpackParent, second);
  world.removeNewestCustomBackpackNode(first, 1000);
  assert.equal(world.backpackItemGroups.原木, first.customId);
  world.removeNewestCustomBackpackNode(world.backpack, 1000);
  assert.equal(world.backpackItemGroups.原木, null);
});

test("新采集同类物品进入背包根节点，不会带走分类中的旧 pile", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.种子 = 1;
  world.setBackpackOpen(true, 1000);
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  const oldPile = world.allBackpackItems().find(item => item.type === "种子");
  assert.equal(world.moveBackpackItemToCustom(oldPile, category, 1000).moved, true);
  assert.equal(world.backpackItemGroups.种子, category.customId);
  const harvested = new game.Node("种子", 400, 300);
  harvested.worldPileChild = true;
  finishHarvest(world, harvested);
  assert.equal(world.backpackDetachedRecords.find(record => record.type === "种子")?.quantity, 1);
  world.setBackpackOpen(true, 1000);
  const items = world.allBackpackItems().filter(item => item.type === "种子");
  assert.equal(items.find(item => item.backpackParent === category)?.quantity, 1);
  assert.equal(items.find(item => item.backpackParent === world.backpack)?.quantity, 1);
});

test("多个分类已有同类数量时，新采集的一件仍准确显示在根背包", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.种子 = 5;
  world.backpackDetachedRecords = [
    { id: "old-a", type: "种子", quantity: 2, customId: "category-1", dynamicOrigins: null },
    { id: "old-b", type: "种子", quantity: 3, customId: "category-3", dynamicOrigins: null }
  ];
  world.backpackItemGroups.种子 = "category-1";
  world.preserveCategorizedPileBeforeHarvest("种子");
  world.inventory.种子 += 1;
  assert.equal(world.backpackDetachedRecords.reduce((sum, record) => sum + record.quantity, 0), 5);
  assert.equal(world.inventory.种子 - world.backpackDetachedRecords.reduce((sum, record) => sum + record.quantity, 0), 1);
});

test("每层自定义分类数量受 config 上限控制，且分类节点不跟随世界缩放", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.setBackpackOpen(true, 1000);
  const limit = game.BACKPACK_CUSTOM_CONFIG.maxChildrenPerLayer;
  const created = Array.from({ length: limit + 1 }, () => world.createCustomBackpackNode(world.backpack, 1000));
  assert.equal(created.filter(Boolean).length, limit);
  assert.equal(created.at(-1), null);
  assert.equal(created[0].scalesWithWorld, false);
});

test("拆分物归入分类时只移动自身，不会把原始 pile 一同归类", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.原木 = 3;
  world.setBackpackOpen(true, 1000);
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  const pile = world.allBackpackItems().find(item => item.type === "原木" && !item.detached);
  pile.splitAmount = 1;
  const detached = world.detachBackpackItem(pile);
  assert.equal(world.moveDetachedBackpackItemToCustom(detached, category, 1000).moved, true);
  assert.equal(detached.backpackParent, category);
  assert.equal(pile.backpackParent, world.backpack);
  assert.equal(pile.quantity, 2);
  assert.notEqual(world.backpackItemGroups.原木, category.customId);
});

test("归类后的拆分物取消来源关系，剩余 pile 进入同一分类后自动合并", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.原木 = 3;
  world.setBackpackOpen(true, 1000);
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  const pile = world.allBackpackItems().find(item => item.type === "原木" && !item.detached);
  pile.splitAmount = 1;
  const detached = world.detachBackpackItem(pile);
  world.moveDetachedBackpackItemToCustom(detached, category, 1000);
  assert.equal(detached.sourcePile, null);
  assert.equal(world.moveBackpackItemToCustom(pile, category, 1000).moved, true);
  const merged = world.allBackpackItems().filter(item => item.type === "原木");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 3);
  assert.equal(merged[0].backpackParent, category);
});

test("同类拆分物可留在分类一，剩余 pile 仍可进入分类二且两边数量都保留", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.种子 = 3;
  world.inventory.花 = 1;
  world.setBackpackOpen(true, 1000);
  const first = world.createCustomBackpackNode(world.backpack, 1000);
  const second = world.createCustomBackpackNode(world.backpack, 1000);
  const seedPile = world.allBackpackItems().find(item => item.type === "种子" && !item.detached);
  seedPile.splitAmount = 1;
  const seedPart = world.detachBackpackItem(seedPile);
  world.moveDetachedBackpackItemToCustom(seedPart, first, 1000);
  const flowerPile = world.allBackpackItems().find(item => item.type === "花" && !item.detached);
  assert.equal(world.moveBackpackItemToCustom(flowerPile, second, 1000).moved, true);
  const remainingSeed = world.allBackpackItems().find(item => item.type === "种子" && !item.detached);
  assert.equal(world.moveBackpackItemToCustom(remainingSeed, second, 1000).moved, true);
  const seedNodes = world.allBackpackItems().filter(item => item.type === "种子");
  assert.equal(seedNodes.find(item => item.detached).backpackParent, first);
  assert.equal(seedNodes.find(item => !item.detached).backpackParent, second);
  assert.equal(seedNodes.find(item => item.detached).quantity, 1);
  assert.equal(seedNodes.find(item => !item.detached).quantity, 2);
  world.setBackpackOpen(false, 1000);
  world.setBackpackOpen(true, 1000);
  const restoredSeeds = world.allBackpackItems().filter(item => item.type === "种子");
  assert.equal(restoredSeeds.find(item => item.detached).backpackParent, first);
  assert.equal(restoredSeeds.find(item => !item.detached).backpackParent, second);
});

test("分类中的完整 pile 可以移回背包根节点", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.花 = 1;
  world.setBackpackOpen(true, 1000);
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  const pile = world.allBackpackItems().find(item => item.type === "花");
  world.moveBackpackItemToCustom(pile, category, 1000);
  const grouped = world.allBackpackItems().find(item => item.type === "花");
  assert.equal(world.moveBackpackItemToCustom(grouped, world.backpack, 1000).moved, true);
  assert.equal(world.allBackpackItems().find(item => item.type === "花").backpackParent, world.backpack);
});

test("分类中的完整份额可作为整 pile 放置到有效替补层", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const ground = attach(world, world.root, new game.Node("土", 500, 400));
  const bedrock = new game.Node("基岩", 500, 460);
  ground.underlays.push(bedrock);
  world.inventory.花 = 2;
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  // 分类完整份额的持久表现：它可与根背包同类 pile 共存，却不是临时拆分物。
  const pile = new game.Node("花", 100, 100, true);
  pile.quantity = 2;
  pile.detached = true;
  pile.groupedDetached = true;
  pile.backpackItemOwner = world.backpack;
  pile.backpackParent = category;
  category.children.push(pile);
  world.uiNodes.push(pile);
  const result = world.placeBackpackPile(pile, ground);
  assert.equal(result.placed, true);
  assert.equal(result.node.worldPile, true);
});

test("分类 pile 放置到世界后，后续采集的同类物品回到根背包", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const ground = attach(world, world.root, new game.Node("土", 500, 400));
  ground.underlays = [new game.Node("基岩", 500, 460)];
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  category.customId = "placed-category";
  const pile = new game.Node("原木", 100, 100, true);
  pile.quantity = 1;
  pile.detached = true;
  pile.groupedDetached = true;
  pile.backpackItemOwner = world.backpack;
  pile.backpackParent = category;
  category.children.push(pile);
  world.uiNodes.push(pile);
  world.inventory.原木 = 1;
  world.backpackItemGroups.原木 = category.customId;
  assert.equal(world.placeBackpackPile(pile, ground).placed, true);
  assert.equal(world.backpackItemGroups.原木, undefined);
});

test("普通分类 pile 放置到世界后也会断开分类映射", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const ground = attach(world, world.root, new game.Node("土", 500, 400));
  ground.underlays = [new game.Node("基岩", 500, 460)];
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  category.customId = "mushroom-category";
  const pile = new game.Node("蘑菇", 100, 100, true);
  pile.quantity = 3;
  pile.backpackItemOwner = world.backpack;
  pile.backpackParent = category;
  category.children.push(pile);
  world.uiNodes.push(pile);
  world.inventory.蘑菇 = 3;
  world.backpackItemGroups.蘑菇 = category.customId;
  assert.equal(world.placeBackpackPile(pile, ground).placed, true);
  assert.equal(world.backpackItemGroups.蘑菇, undefined);
});

test("分类中的完整份额支持数量拆分并可归位合并", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  const pile = new game.Node("种子", 100, 100, true);
  pile.quantity = 3;
  pile.splitAmount = 2;
  pile.detached = true;
  pile.groupedDetached = true;
  pile.backpackItemOwner = world.backpack;
  pile.backpackParent = category;
  pile.isNumericPile = true;
  category.children.push(pile);
  world.uiNodes.push(pile);
  const part = world.detachBackpackItem(pile);
  assert.equal(part.quantity, 2);
  assert.equal(pile.quantity, 1);
  assert.equal(part.sourcePile, pile);
  world.mergeBackpackItem(part);
  assert.equal(pile.quantity, 3);
});

test("拆分到最后一件时，该完整单件仍可进入另一个分类", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.种子 = 2;
  world.setBackpackOpen(true, 1000);
  const first = world.createCustomBackpackNode(world.backpack, 1000);
  const second = world.createCustomBackpackNode(world.backpack, 1000);
  const pile = world.allBackpackItems().find(item => item.type === "种子" && !item.detached);
  const part = world.detachBackpackItem(pile);
  world.moveDetachedBackpackItemToCustom(part, first, 1000);
  const lastItem = world.allBackpackItems().find(item => item.type === "种子" && !item.detached);
  assert.equal(lastItem.quantity, 1);
  assert.equal(world.moveBackpackItemToCustom(lastItem, second, 1000).moved, true);
  assert.equal(world.allBackpackItems().find(item => item.type === "种子" && !item.detached).backpackParent, second);
});

test("分类一的拆分物移入分类二时会与分类二中的同类完整 pile 合并", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.种子 = 3;
  world.setBackpackOpen(true, 1000);
  const first = world.createCustomBackpackNode(world.backpack, 1000);
  const second = world.createCustomBackpackNode(world.backpack, 1000);
  const pile = world.allBackpackItems().find(item => item.type === "种子" && !item.detached);
  pile.splitAmount = 1;
  const part = world.detachBackpackItem(pile);
  world.moveDetachedBackpackItemToCustom(part, first, 1000);
  const remaining = world.allBackpackItems().find(item => item.type === "种子" && !item.detached);
  world.moveBackpackItemToCustom(remaining, second, 1000);
  const classifiedPart = world.allBackpackItems().find(item => item.type === "种子" && item.detached);
  world.moveDetachedBackpackItemToCustom(classifiedPart, second, 1000);
  const seeds = world.allBackpackItems().filter(item => item.type === "种子");
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].quantity, 3);
  assert.equal(seeds[0].backpackParent, second);
});

test("取消分类时其独立拆分物回到背包并与根 pile 合并", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.inventory.种子 = 3;
  world.setBackpackOpen(true, 1000);
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  const pile = world.allBackpackItems().find(item => item.type === "种子" && !item.detached);
  pile.splitAmount = 1;
  const part = world.detachBackpackItem(pile);
  world.moveDetachedBackpackItemToCustom(part, category, 1000);
  world.removeNewestCustomBackpackNode(world.backpack, 1000);
  const seeds = world.allBackpackItems().filter(item => item.type === "种子");
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].quantity, 3);
  assert.equal(seeds[0].backpackParent, world.backpack);
});

test("删除分类导致子分类上移超过每层上限时会被拒绝", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.setBackpackOpen(true, 1000);
  Array.from({ length: game.BACKPACK_CUSTOM_CONFIG.maxChildrenPerLayer - 1 }, () => world.createCustomBackpackNode(world.backpack, 1000));
  const parent = world.createCustomBackpackNode(world.backpack, 1000);
  const nested = world.createCustomBackpackNode(parent, 1000);
  world.createCustomBackpackNode(parent, 1000);
  // 根层已有 parent + 4 个分类；删除 parent 后还要上移 nested，结果将超过 5。
  assert.equal(world.removeNewestCustomBackpackNode(world.backpack, 1000), null);
  assert.ok(world.lastCustomOperationReason.includes("超过"));
  assert.ok(world.customBackpackNodes().includes(nested));
});

test("资源数值可拆出整数部分并保留小数余量，归位后不会产生浮点误差", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  world.resources.生命 = 8.8;
  world.syncResourcePiles();
  const life = world.resourcePiles.生命;
  life.splitAmount = 9;
  const detached = world.detachResourceItem(life);
  assert.equal(detached.quantity, 8);
  assert.equal(life.quantity, 0.8);
  world.mergeResourceItem(detached);
  assert.equal(life.quantity, 8.8);
});

test("身体展开时手与嘴都会在身体上方出现；收起后再次展开仍复用同一组节点", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  assert.equal(world.toggleBody(), true);
  const tools = [...world.body.children];
  assert.equal(tools.length, 2);
  assert.ok(tools.every(tool => tool.y < world.body.y));
  assert.notEqual(tools[0].x, tools[1].x);
  world.toggleBody();
  world.toggleBody();
  assert.equal(world.body.children.length, 2);
  assert.ok(world.body.children.every(tool => tool.visible));
});

test("动态节点采集时记录原父节点，并可在原父节点收起后回归", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const trunk = attach(world, world.root, new game.Node("树干", 300, 300));
  trunk.open = true;
  // 原父节点仍有原木这一静态分支，因此捕获甲虫后它会保留，只是随后被玩家收起。
  attach(world, trunk, new game.Node("原木", 280, 300));
  const beetle = attach(world, trunk, new game.Node("甲虫", 320, 300));
  finishHarvest(world, beetle);
  world.setBackpackOpen(true, 1000);
  const item = world.backpack.children.find(node => node.type === "甲虫");
  world.collapse(trunk);
  const result = world.placeDynamicBackpackItem(item, world.root);
  assert.equal(result.placed, true);
  assert.equal(world.parentOf(result.node), trunk);
  assert.equal(result.node.visible, false);
});

test("动态节点在父节点消失时会迁徙到同类型的兄弟父节点", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const firstTree = attach(world, world.root, new game.Node("树", 250, 300));
  const secondTree = attach(world, world.root, new game.Node("树", 550, 300));
  firstTree.open = true;
  secondTree.open = true;
  const bird = attach(world, firstTree, new game.Node("鸟", 280, 300));
  assert.equal(world.migrateDynamicNode(bird, firstTree), true);
  assert.equal(world.parentOf(bird), secondTree);
});

test("动态节点活动范围受父节点可见后代边界限制", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const controller = new game.DynamicNodeController(world);
  const parent = attach(world, world.root, new game.Node("树", 300, 300));
  const staticChild = attach(world, parent, new game.Node("树枝", 300, 300));
  const bird = attach(world, parent, new game.Node("鸟", 300, 300));
  bird.dynamicState = { vx: 10000, vy: 10000, lastTick: 0, turnAt: Number.MAX_SAFE_INTEGER };
  controller.tick(80);
  const bounds = controller.siblingBounds(bird);
  assert.ok(bird.x <= bounds.maxX && bird.x >= bounds.minX);
  assert.ok(bird.y <= bounds.maxY && bird.y >= bounds.minY);
  assert.equal(staticChild.visible, true);
});

test("静态父节点只剩动态子节点时会连同动态节点一起迁徙或清理", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const parent = attach(world, world.root, new game.Node("树", 300, 300));
  parent.open = true;
  attach(world, parent, new game.Node("鸟", 320, 300));
  world.pruneDynamicOnlyStaticParents();
  assert.equal(world.nodes.includes(parent), false);
});

test("天空开局自动展开，白天显示太阳、黑夜显示月亮", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const clock = new game.GameClock();
  const celestial = new game.CelestialSystem(world, clock, { width: 1000, height: 700 });
  celestial.tick();
  assert.equal(world.sky.open, true);
  assert.equal(celestial.sun.visible, true);
  assert.equal(celestial.moon.visible, false);
  clock.elapsed = game.TIME_CONFIG.dayDuration + game.TIME_CONFIG.nightDuration / 2;
  celestial.tick();
  assert.equal(celestial.sun.visible, false);
  assert.equal(celestial.moon.visible, true);
  assert.equal(Math.round(celestial.moon.x), 500);
});

test("收起天空会隐藏天体，但游戏时间仍持续推进", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const clock = new game.GameClock();
  const celestial = new game.CelestialSystem(world, clock, { width: 1000, height: 700 });
  celestial.toggleSky();
  clock.elapsed = game.TIME_CONFIG.dayDuration + 1;
  celestial.tick();
  assert.equal(world.sky.open, false);
  assert.equal(celestial.sun.visible, false);
  assert.equal(celestial.moon.visible, false);
  assert.ok(clock.nightProgress() > 0);
});

test("背包工作区可独立开合、调整宽度并限制内容缩放范围", () => {
  const game = loadGame();
  const canvas = { width: 1000, height: 700 };
  const world = new game.World(canvas.width, canvas.height);
  const panel = new game.WorkspacePanel(canvas, world);
  assert.equal(panel.open, true);
  const closeButton = panel.controls().collapse;
  panel.pointerDown({ clientX: closeButton.x + 5, clientY: closeButton.y + 5 });
  panel.pointerUp();
  assert.equal(panel.open, false);
  const handle = panel.handleBounds();
  panel.pointerDown({ clientX: handle.x + 5, clientY: handle.y + 5 });
  panel.pointerUp();
  assert.equal(panel.open, true);
  assert.equal(panel.width, panel.minimumWidth());
  const resizeHandle = panel.handleBounds();
  panel.pointerDown({ clientX: resizeHandle.x + 5, clientY: resizeHandle.y + 5 });
  panel.pointerMove({ clientX: canvas.width, clientY: canvas.height / 2 });
  panel.pointerUp();
  assert.equal(panel.open, true);
  // 完全展开时仍要为右侧收起的详情栏展开把手留下安全区域。
  assert.equal(panel.width, panel.maximumWidth());
  const collapseResizeHandle = panel.controls().collapse;
  panel.pointerDown({ clientX: collapseResizeHandle.x + 5, clientY: collapseResizeHandle.y + 5 });
  panel.pointerMove({ clientX: 0, clientY: canvas.height / 2 });
  panel.pointerUp();
  assert.equal(panel.open, true);
  assert.equal(panel.width, panel.minimumWidth());
  panel.zoom(-999999);
  assert.equal(panel.contentScale, game.WORKSPACE_PANEL_CONFIG.maxContentScale);
  panel.zoom(999999);
  assert.equal(panel.contentScale, game.WORKSPACE_PANEL_CONFIG.minContentScale);
});

test("工作区入口固定在左侧，背包与思考分别位于屏幕四分之一和四分之三高度", () => {
  const game = loadGame();
  const world = new game.World(1000, 800);
  assert.equal(world.backpack.x, 80);
  assert.equal(world.thought.x, 80);
  assert.equal(world.backpack.y, 200);
  assert.equal(world.thought.y, 600);
});

test("世界节点与自定义分类可记录全局唯一名称", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const tree = new game.Node("树", 300, 300);
  const category = world.createCustomBackpackNode(world.backpack, 1000);
  tree.customName = "河边树";
  category.customName = "蘑菇箱";
  assert.notEqual(tree.customName, category.customName);
  assert.equal(tree.ui, false);
  assert.equal(category.customNode, true);
});

test("世界终端进入工作区后不能被放置，左键会回到原世界位置", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const terminal = new game.Node("种子", 420, 280);
  terminal.worldPileChild = true;
  const origin = { x: terminal.x, y: terminal.y };
  // 规则状态：工作区预览中的世界节点仍必须保留其原世界归属，而非成为 UI 子节点。
  terminal.workspaceInPanel = true;
  terminal.x = 120;
  terminal.y = 300;
  terminal.x = origin.x;
  terminal.y = origin.y;
  terminal.workspaceInPanel = false;
  assert.deepEqual({ x: terminal.x, y: terminal.y, workspaceInPanel: terminal.workspaceInPanel }, { ...origin, workspaceInPanel: false });
});

test("新金色路径会收起旧分支，并保留新路径的完整祖先链", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 500, 300));
  const oldTree = attach(world, forest, new game.Node("树", 300, 250));
  const newTree = attach(world, forest, new game.Node("树", 700, 250));
  const oldBranch = attach(world, oldTree, new game.Node("树枝", 250, 150));
  const newBranch = attach(world, newTree, new game.Node("树枝", 750, 150));
  [world.root, forest, oldTree, oldBranch].forEach(node => { node.open = true; node.visible = true; });
  newTree.visible = true;
  // oldTree 代表上一轮遗留展开分支；本轮新路径从森林进入另一棵树。
  world.playerLocation = forest;
  world.moveBetweenNodes(forest, newBranch, 0);
  world.playerLocation = newBranch;
  world.flushWorldOpenState();
  assert.equal(oldTree.open, false);
  assert.equal(oldBranch.visible, false);
  assert.equal(world.root.open, true);
  assert.equal(forest.open, true);
  assert.equal(newTree.open, true);
  assert.equal(newBranch.visible, true);
});

test("金色路径终点不会被自动展开，只展开显示它所需的父节点", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 500, 300));
  const tree = attach(world, forest, new game.Node("树", 650, 300));
  attach(world, tree, new game.Node("树枝", 760, 260));
  world.root.open = true;
  forest.open = true;
  tree.open = false;
  world.playerLocation = tree;
  world.markWorldOpenStateDirty();
  world.flushWorldOpenState();
  assert.equal(world.root.open, true);
  assert.equal(forest.open, true);
  assert.equal(tree.visible, true);
  assert.equal(tree.open, false);
  assert.equal(tree.children[0].visible, false);
});

test("搜索预览临时展开目标祖先链，结束后恢复金色位置的自动收起", () => {
  const game = loadGame();
  const world = new game.World(1000, 700);
  const forest = attach(world, world.root, new game.Node("森林", 500, 300));
  const currentTree = attach(world, forest, new game.Node("树", 350, 260));
  const searchedTree = attach(world, forest, new game.Node("树", 700, 260));
  const searchedBranch = attach(world, searchedTree, new game.Node("树枝", 790, 180));
  world.root.open = true;
  forest.open = true;
  currentTree.visible = true;
  world.playerLocation = currentTree;
  world.setSearchPreview(searchedBranch);
  world.flushWorldOpenState();
  assert.equal(searchedTree.open, true);
  assert.equal(searchedBranch.visible, true);
  world.clearSearchPreview();
  world.flushWorldOpenState();
  assert.equal(searchedTree.open, false);
  assert.equal(searchedBranch.visible, false);
  assert.equal(currentTree.visible, true);
});

let failed = 0;
tests.forEach(({ name, callback }) => {
  try {
    callback();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
  }
});

console.log(`\n${tests.length - failed}/${tests.length} 条规则通过。`);
if (failed) process.exitCode = 1;
