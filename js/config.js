/*
 * 唯一的内容配置文件。
 * 以后新增普通节点时，只需在 NODE_TYPES 增加一项：emoji、children、harvestClicks 等。
 * hiddenLayer: true 表示该节点可随机成为隐藏层；indestructible: true 表示不可采集。
 */

(() => {
  window.TreeWorld = window.TreeWorld || {};

  const NODE_SIZE = { width: 100, height: 60 };
  const ZOOM = { min: 0.4, max: 2.5, sensitivity: 0.0001 };
  // 游戏启动后循环播放的背景音乐；volume 范围为 0 到 1。
  const BACKGROUND_MUSIC = { sound: "background.wav", volume: 0.6};

  const NODE_TYPES = {
    树: { emoji: "🌳", children: ["树枝", "树干"], sound: "tree.wav", volume: .7 },
    树枝: { emoji: "🌿", children: ["花", "种子"], sound: "branch.wav", volume: .7 },
    树干: { emoji: "🌲", children: ["原木"], sound: "trunk.wav", volume: .7 },
    原木: { emoji: "🪵", children: [], harvestClicks: 6, harvestHungerCost: .5, harvestWear: 1.2, sound: "wood.wav", volume: .75 },
    花: { emoji: "🌸", children: [], harvestClicks: 2, harvestHungerCost: .2, harvestWear: .4, edible: true, hungerRestore: 2, eatWear: .5, sound: "flower.wav", volume: .65 },
    种子: { emoji: "🌰", children: [], harvestClicks: 3, harvestHungerCost: .2, harvestWear: .6, edible: true, hungerRestore: 4, eatWear: .8, poisonChance: .2, poisonDamage: 2, sound: "seed.wav", volume: .65 },

    // 这些节点可能出现在土块下方的隐藏层；每种都可单独替换音频与音量。
    土: { emoji: "🟫", children: ["土块"], hiddenLayer: true, sound: "soil.wav", volume: .6 },
    土块: {
      emoji: "🟤", children: [], harvestClicks: 3, harvestHungerCost: .2, harvestWear: .7,
      sound: "dirt-block.wav", // 文件路径：sounds/dirt-block.wav
      volume: .65 // 音量：65%。正确参数名是 volume，不是 volumn。
    },
    铁矿: { emoji: "⚙️", children: ["铁块"], hiddenLayer: true, sound: "iron-ore.wav", volume: .65 },
    铁块: { emoji: "🔩", children: [], harvestClicks: 5, harvestHungerCost: .4, harvestWear: 1.1, sound: "iron-ingot.wav", volume: .7 },
    铜矿: { emoji: "🟠", children: ["铜块"], hiddenLayer: true, sound: "copper-ore.wav", volume: .65 },
    铜块: { emoji: "🟤", children: [], harvestClicks: 4, harvestHungerCost: .3, harvestWear: .9, sound: "copper-ingot.wav", volume: .7 },
    金矿: { emoji: "🟡", children: ["金块"], hiddenLayer: true, sound: "gold-ore.wav", volume: .65 },
    金块: { emoji: "🟨", children: [], harvestClicks: 7, harvestHungerCost: .6, harvestWear: 1.5, sound: "gold-ingot.wav", volume: .75 },
    钻石: { emoji: "💎", children: ["钻石块"], hiddenLayer: true, sound: "diamond-ore.wav", volume: .7 },
    钻石块: { emoji: "🔷", children: [], harvestClicks: 10, harvestHungerCost: .8, harvestWear: 2, sound: "diamond.wav", volume: .8 },
    基岩: { emoji: "🪨", children: [], indestructible: true, sound: "bedrock.wav", volume: .7 },

    身体: { emoji: "🧍", children: ["手", "嘴"], sound: "body.wav", volume: .7 },
    手: { emoji: "✋", children: [], durability: 100, durabilityRecovery: .5, defaultHarvestWear: 1, sound: "hand.wav", volume: .65 },
    嘴: { emoji: "👄", children: [], durability: 100, durabilityRecovery: .5, defaultEatWear: 1, sound: "mouth.wav", volume: .65 },
    背包: { emoji: "🎒", children: [], sound: "backpack.wav", volume: .7 },
    思考: { emoji: "💡", children: [], sound: "thought.wav", volume: .6 },
    刷新: { emoji: "🔄", children: [], sound: "refresh.wav", volume: .6 },
    饥饿: { emoji: "🍖", children: [], sound: "hunger.wav", volume: .55 },
    生命: { emoji: "❤️", children: [], sound: "life.wav", volume: .55 },
    专注: { emoji: "🎯", children: [], sound: "focus.wav", volume: .55 }
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
    NODE_SIZE, ZOOM, BACKGROUND_MUSIC, NODE_TYPES, emoji, rules, soundFiles, soundVolumes, uiSoundFiles, uiSoundVolumes,
    HARVEST_CLICKS_BY_TYPE, HARVEST_HUNGER_COST_BY_TYPE, HARVEST_WEAR_BY_TYPE, EAT_WEAR_BY_TYPE, HIDDEN_LAYER_TYPES, INDESTRUCTIBLE_TYPES, FINAL_HIDDEN_LAYER_TYPE, HIDDEN_LAYER_AUDIO, RESOURCE_CONFIG
  });
})();
