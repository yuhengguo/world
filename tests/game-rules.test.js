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
const logicFiles = ["config.js", "node.js", "world.js", "dynamic.js", "time.js", "celestial.js"];

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

test("固定种子下相同生成路径使用相同随机流", () => {
  const game = loadGame();
  const first = Array.from({ length: 8 }, () => game.createRandomStream("same-branch").next());
  const second = Array.from({ length: 8 }, () => game.createRandomStream("same-branch").next());
  assert.deepEqual(first, second);
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
