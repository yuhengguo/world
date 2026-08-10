/*
 * 唯一的内容配置文件。
 * 以后新增普通节点时，只需在 NODE_TYPES 增加一项：emoji、children、harvestClicks 等。
 * hiddenLayer: true 表示该节点可随机成为隐藏层；indestructible: true 表示不可采集。
 */

(() => {
  window.TreeWorld = window.TreeWorld || {};

  const NODE_SIZE = { width: 100, height: 60 };
  // min 越小，可缩小得越远；山与森林节点变多后可用更大的视野查看整体结构。
  const ZOOM = { min: 0.15, max: 2.5, sensitivity: 0.0001 };
  // 全局随机种子：修改这个整数后会生成一套新的世界；保持不变即可复刻同一套随机结果。
  // 注意：要完全复刻鸟的飞行位置，也需要以相同节奏执行相同的操作。
  const RANDOM_SEED = 202608103;

  /** 可复位的伪随机数发生器；项目内所有随机结果必须从这里取得，不能直接调用 Math.random()。 */
  class SeededRandom {
    constructor(seed) {
      this.reset(seed);
    }

    /** 用配置种子重置序列；页面重新开始时 config.js 会重新创建本实例。 */
    reset(seed) {
      this.seed = Number(seed) >>> 0;
      this.state = this.seed;
    }

    /** 返回稳定的 [0, 1) 随机小数；采用 Mulberry32 算法。 */
    next() {
      this.state = (this.state + 0x6D2B79F5) >>> 0;
      let value = this.state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    }

    /** 返回包含上下界的稳定随机整数。 */
    integer(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /** 从数组中稳定地随机抽取一项。 */
    pick(items) {
      return items[this.integer(0, items.length - 1)];
    }
  }

  const random = new SeededRandom(RANDOM_SEED);
  // 动态节点使用由同一主种子派生出的独立序列，避免鸟的转向时机影响树、矿物等世界生成结果。
  const dynamicRandom = new SeededRandom(RANDOM_SEED ^ 0x9E3779B9);

  /** 将节点路径和用途稳定地映射为 32 位种子，供每个生成分支拥有自己的局部随机流。 */
  const hashRandomKey = key => {
    let hash = 2166136261;
    for (const character of String(key)) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  };

  /**
   * 从唯一的 RANDOM_SEED 派生局部随机流。
   * 同一节点路径、同一用途总会得到同一串结果，调节其它分支的概率不会扰乱这里。
   */
  const createRandomStream = key => new SeededRandom(RANDOM_SEED ^ hashRandomKey(key));

  /** 新开一局时同步复位全部随机序列；种子只需要在本文件顶部修改一次。 */
  const resetRandomSequences = () => {
    random.reset(RANDOM_SEED);
    dynamicRandom.reset(RANDOM_SEED ^ 0x9E3779B9);
  };
  // 游戏启动后循环播放的背景音乐；volume 范围为 0 到 1。
  const BACKGROUND_MUSIC = { sound: "background.wav", volume: 0.6};

  // 游戏时间与第一版昼夜表现。一个白天从太阳进入屏幕右侧开始，到离开左侧结束；夜晚暂不显示天体。
  const TIME_CONFIG = {
    dayDuration: 60,
    nightDuration: 20,
    sunY: 165,
    sunMargin: 90
  };

  const NODE_TYPES = {
    // spawnChance 控制该类型出现的概率；spawnCount 控制出现后生成的数量范围（含两端）。
    山: { emoji: "⛰️", children: ["森林"], spawnChance: 1, spawnCount: [1, 1], sound: "mountain.wav", volume: .75 },
    // 森林生成多棵独立的树；每棵树都会带有自己的地下层、鸟与采集分支。
    森林: { emoji: "🌳🌳", children: ["树", "蘑菇"], spawnChance: 1, spawnCount: [1, 1], sound: "forest.wav", volume: .7 },
    树: { emoji: "🌳", children: ["树枝", "树干", "鸟"], minimumStaticChildren: 1, spawnChance: 1, spawnCount: [4, 6], sound: "tree.wav", volume: .7 },
    树枝: { emoji: "🌿", children: ["花", "种子"], spawnChance: 1, spawnCount: [1, 1], sound: "branch.wav", volume: .7 },
    树干: { emoji: "🪵🪵", children: ["原木"], spawnChance: 1, spawnCount: [1, 1], sound: "trunk.wav", volume: .7 },
    原木: { emoji: "🪵", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 6, harvestHungerCost: .5, harvestWear: 1.2, sound: "wood.wav", volume: .75 },
    花: { emoji: "🌸", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 2, harvestHungerCost: .2, harvestWear: .4, edible: true, hungerRestore: 2, eatWear: .5, sound: "flower.wav", volume: .65 },
    种子: { emoji: "🌰", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 3, harvestHungerCost: .2, harvestWear: .6, edible: true, hungerRestore: 4, eatWear: .8, poisonChance: .2, poisonDamage: 2, sound: "seed.wav", volume: .65 },
    蘑菇: { emoji: "🍄", children: [], spawnChance: 1, spawnCount: [1, 3], harvestClicks: 3, harvestHungerCost: .2, harvestWear: .6, edible: true, hungerRestore: 4, eatWear: .8, poisonChance: .2, poisonDamage: 2, sound: "seed.wav", volume: .65 },

    // 动态节点示例：spawnChance 是每次展开树时出现鸟群的概率；spawnCount 是出现后鸟的随机数量范围（含两端）。
    // 例如改成 spawnChance: .5, spawnCount: [1, 4]，表示有 50% 概率出现 1 到 4 只鸟。
    鸟: { emoji: "🐦", children: [], spawnChance: 1, spawnCount: [1, 3], dynamic: { speed: 420, turnInterval: [650, 1500] }, harvestClicks: 4, harvestHungerCost: .3, harvestWear: .8, edible: true, hungerRestore: 3, eatWear: 1, sound: "bird.wav", volume: .65 },

    // 这些节点可能出现在土块下方的隐藏层；每种都可单独替换音频与音量。
    土: { emoji: "🟫", children: ["土块"], spawnChance: 1, spawnCount: [1, 1], hiddenLayer: true, groundLayer: true, sound: "soil.wav", volume: .6 },
    土块: {
      emoji: "🟤", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 3, harvestHungerCost: .2, harvestWear: .7,
      sound: "dirt-block.wav", // 文件路径：sounds/dirt-block.wav
      volume: .65 // 音量：65%。正确参数名是 volume，不是 volumn。
    },
    铁矿: { emoji: "⚙️", children: ["铁块"], spawnChance: 1, spawnCount: [1, 1], hiddenLayer: true, groundLayer: true, sound: "iron-ore.wav", volume: .65 },
    铁块: { emoji: "🔩", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 5, harvestHungerCost: .4, harvestWear: 1.1, sound: "iron-ingot.wav", volume: .7 },
    铜矿: { emoji: "🟠", children: ["铜块"], spawnChance: 1, spawnCount: [1, 1], hiddenLayer: true, groundLayer: true, sound: "copper-ore.wav", volume: .65 },
    铜块: { emoji: "🟤", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 4, harvestHungerCost: .3, harvestWear: .9, sound: "copper-ingot.wav", volume: .7 },
    金矿: { emoji: "🟡", children: ["金块"], spawnChance: 1, spawnCount: [1, 1], hiddenLayer: true, groundLayer: true, sound: "gold-ore.wav", volume: .65 },
    金块: { emoji: "🟨", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 7, harvestHungerCost: .6, harvestWear: 1.5, sound: "gold-ingot.wav", volume: .75 },
    钻石: { emoji: "💎", children: ["钻石块"], spawnChance: 1, spawnCount: [1, 1], hiddenLayer: true, groundLayer: true, sound: "diamond-ore.wav", volume: .7 },
    钻石块: { emoji: "🔷", children: [], spawnChance: 1, spawnCount: [1, 1], harvestClicks: 10, harvestHungerCost: .8, harvestWear: 2, sound: "diamond.wav", volume: .8 },
    基岩: { emoji: "🪨", children: [], spawnChance: 1, spawnCount: [1, 1], groundLayer: true, indestructible: true, sound: "bedrock.wav", volume: .7 },

    身体: { emoji: "🧍", children: ["手", "嘴"], spawnChance: 1, spawnCount: [1, 1], sound: "body.wav", volume: .7 },
    手: { emoji: "✋", children: [], spawnChance: 1, spawnCount: [1, 1], durability: 100, durabilityRecovery: .5, defaultHarvestWear: 1, sound: "hand.wav", volume: .65 },
    嘴: { emoji: "👄", children: [], spawnChance: 1, spawnCount: [1, 1], durability: 100, durabilityRecovery: .5, defaultEatWear: 1, sound: "mouth.wav", volume: .65 },
    背包: { emoji: "🎒", children: [], spawnChance: 1, spawnCount: [1, 1], sound: "backpack.wav", volume: .7 },
    思考: { emoji: "💡", children: [], spawnChance: 1, spawnCount: [1, 1], sound: "thought.wav", volume: .6 },
    刷新: { emoji: "🔄", children: [], spawnChance: 1, spawnCount: [1, 1], sound: "refresh.wav", volume: .6 },
    饥饿: { emoji: "🍖", children: [], spawnChance: 1, spawnCount: [1, 1], sound: "hunger.wav", volume: .55 },
    生命: { emoji: "❤️", children: [], spawnChance: 1, spawnCount: [1, 1], sound: "life.wav", volume: .55 },
    专注: { emoji: "🎯", children: [], spawnChance: 1, spawnCount: [1, 1], sound: "focus.wav", volume: .55 },
    天空: { emoji: "🌌", children: ["太阳"], spawnChance: 1, spawnCount: [1, 1], sound: "sky.wav", volume: .5 },
    太阳: { emoji: "☀️", children: [], spawnChance: 1, spawnCount: [1, 1], sound: "sun.wav", volume: .55 }
  };

  // 面向玩家的节点说明。新增节点时在这里补一条，即可显示在右侧详情页。
  const NODE_DESCRIPTIONS = {
    山: "整片世界的起点。展开山脉，找到能够继续探索的区域。",
    森林: "山中的一片森林。展开后会出现多棵独立生长的树，每棵树下都藏着自己的土地。",
    树: "一棵能不断展开的树。把它的枝叶清理干净，脚下的秘密才会慢慢露出来。",
    树枝: "树向外伸出的枝条，花和种子往往藏在这里。",
    树干: "结实的树干，继续展开可以找到可收集的原木。",
    原木: "沉甸甸的一截木头。需要多花几下功夫，才会进入你的背包。",
    花: "一朵轻盈的花。可以采走，也可以在饿的时候吃掉它。",
    种子: "小小的种子，能填一点肚子；不过有时它也会让你不太舒服。",
    鸟: "一只在树间飞动的小鸟。用手多抓几次，才能把它真正捕获；饿的时候也能吃掉它。",
    土: "脚下的一层土。挖开它，下面也许有矿，也许有更深的路。",
    土块: "一块刚挖出的泥土。它不值钱，但每一层秘密都从这里开始。",
    铁矿: "埋在土里的铁矿。打开它，收集属于你的铁块。",
    铁块: "可以带走的铁块。硬一点，也更磨你的手。",
    铜矿: "泛着暖色的铜矿，耐心挖开它看看。",
    铜块: "一块铜。比土更有分量，也更值得留在背包里。",
    金矿: "闪闪发亮的金矿。它很难采，但看起来很值得。",
    金块: "一块金。想拿走它，需要先付出一点耐心和手的磨损。",
    钻石: "深层中的钻石矿。它在等愿意一直挖下去的人。",
    钻石块: "一小块钻石。很难采，但这正是它珍贵的原因。",
    基岩: "世界最深处的基岩。你可以碰到它，但不能带走它。",
    身体: "这是你在节点世界里的身体。打开它，叫出手和嘴开始行动。",
    手: "这是你勤劳的双手。用它采集东西，给自己弄点吃的；别忘了它也会磨损。",
    嘴: "这是你的嘴。把背包里的花或种子送到这里，给自己补充一点饥饿。",
    背包: "这是你的背包。采到的东西都会放在这里，也可以按数量拆出来摆放。",
    思考: "一盏亮起来的小灯。它提醒你：这个世界还可以被继续想象。",
    刷新: "想重新整理眼前的结构时，就按一下这里。",
    饥饿: "你的肚子正在计数。采集会消耗它，吃东西可以补回来。",
    生命: "这是你还能继续探索的余量。饥饿耗尽后，生命会替你付账。",
    专注: "你的专注储备。先留在这里，未来它会成为更复杂行动的燃料。",
    天空: "抬头看看天空。打开它，太阳会按照游戏中的时间穿过这片世界。",
    太阳: "正在天空中运行的太阳。它不可以采集，只用来告诉你时间正在流逝。"
  };

  /* 以下派生数据由类型表自动生成，其他模块无需维护第二份节点信息。 */
  const emoji = Object.fromEntries(Object.entries(NODE_TYPES).map(([type, data]) => [type, data.emoji]));
  const rules = Object.fromEntries(Object.entries(NODE_TYPES).map(([type, data]) => [type, data.children || []]));
  const soundFiles = Object.fromEntries(Object.entries(NODE_TYPES).filter(([, data]) => data.sound).map(([type, data]) => [type, data.sound]));
  // volume 范围为 0 到 1；这是每种节点的独立音量参数。
  const soundVolumes = Object.fromEntries(Object.entries(NODE_TYPES).map(([type, data]) => [type, data.volume ?? .7]));
  // 问号卡片代表的隐藏层被揭示时，播放这个独立文件：sounds/hidden-layer.wav。
  const HIDDEN_LAYER_AUDIO = { sound: "hidden-layer.wav", volume: .65 };
  const uiSoundFiles = { 归类: "sort.wav", 隐藏层: HIDDEN_LAYER_AUDIO.sound };
  const uiSoundVolumes = { 归类: .6, 隐藏层: HIDDEN_LAYER_AUDIO.volume };
  const HARVEST_CLICKS_BY_TYPE = Object.fromEntries(Object.entries(NODE_TYPES).filter(([, data]) => data.harvestClicks).map(([type, data]) => [type, data.harvestClicks]));
  const HIDDEN_LAYER_TYPES = Object.entries(NODE_TYPES).filter(([, data]) => data.hiddenLayer).map(([type]) => type);
  const INDESTRUCTIBLE_TYPES = Object.entries(NODE_TYPES).filter(([, data]) => data.indestructible).map(([type]) => type);
  const FINAL_HIDDEN_LAYER_TYPE = "基岩";
  const HARVEST_HUNGER_COST_BY_TYPE = Object.fromEntries(Object.entries(NODE_TYPES).filter(([, data]) => data.harvestHungerCost).map(([type, data]) => [type, data.harvestHungerCost]));
  const HARVEST_WEAR_BY_TYPE = Object.fromEntries(Object.entries(NODE_TYPES).filter(([, data]) => data.harvestWear).map(([type, data]) => [type, data.harvestWear]));
  const EAT_WEAR_BY_TYPE = Object.fromEntries(Object.entries(NODE_TYPES).filter(([, data]) => data.eatWear).map(([type, data]) => [type, data.eatWear]));
  /* 底部资源 pile 的初始值与最大值；修改这里即可调节采集消耗体系。 */
  const RESOURCE_CONFIG = {
    饥饿: { initial: 10, max: 10 },
    生命: { initial: 10, max: 10 },
    专注: { initial: 10, max: 10 }
  };

  Object.assign(window.TreeWorld, {
    NODE_SIZE, ZOOM, RANDOM_SEED, random, dynamicRandom, createRandomStream, resetRandomSequences, BACKGROUND_MUSIC, TIME_CONFIG, NODE_TYPES, NODE_DESCRIPTIONS, emoji, rules, soundFiles, soundVolumes, uiSoundFiles, uiSoundVolumes,
    HARVEST_CLICKS_BY_TYPE, HARVEST_HUNGER_COST_BY_TYPE, HARVEST_WEAR_BY_TYPE, EAT_WEAR_BY_TYPE, HIDDEN_LAYER_TYPES, INDESTRUCTIBLE_TYPES, FINAL_HIDDEN_LAYER_TYPE, HIDDEN_LAYER_AUDIO, RESOURCE_CONFIG
  });
})();
