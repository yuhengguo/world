/*
 * 唯一的内容配置文件。
 * 以后新增普通节点时，只需在 NODE_TYPES 增加一项：emoji、children、harvestClicks 等。
 * hiddenLayer: true 表示该节点可随机成为隐藏层；indestructible: true 表示不可采集。
 */

(() => {
  window.TreeWorld = window.TreeWorld || {};

  const NODE_SIZE = { width: 100, height: 60 };
  const ZOOM = { min: 0.4, max: 2.5, sensitivity: 0.0001 };

  const NODE_TYPES = {
    树: { emoji: "🌳", children: ["树枝", "树干"], sound: "tree.wav" },
    树枝: { emoji: "🌿", children: ["花", "种子"], sound: "branch.wav" },
    树干: { emoji: "🌲", children: ["原木"], sound: "tree.wav" },
    原木: { emoji: "🪵", children: [], harvestClicks: 6, harvestHungerCost: .5, harvestWear: 1.2, sound: "wood.wav" },
    花: { emoji: "🌸", children: [], harvestClicks: 2, harvestHungerCost: .2, harvestWear: .4, edible: true, hungerRestore: 1, eatWear: .5, sound: "flower.wav" },
    种子: { emoji: "🌰", children: [], harvestClicks: 3, harvestHungerCost: .2, harvestWear: .6, edible: true, hungerRestore: 1.5, eatWear: .8, poisonChance: .2, poisonDamage: 2, sound: "seed.aiff" },

    土: { emoji: "🟫", children: ["土块"], hiddenLayer: true },
    土块: { emoji: "🟤", children: [], harvestClicks: 3, harvestHungerCost: .2, harvestWear: .7 },
    铁矿: { emoji: "⚙️", children: ["铁块"], hiddenLayer: true },
    铁块: { emoji: "🔩", children: [], harvestClicks: 5, harvestHungerCost: .4, harvestWear: 1.1 },
    铜矿: { emoji: "🟠", children: ["铜块"], hiddenLayer: true },
    铜块: { emoji: "🟤", children: [], harvestClicks: 4, harvestHungerCost: .3, harvestWear: .9 },
    金矿: { emoji: "🟡", children: ["金块"], hiddenLayer: true },
    金块: { emoji: "🟨", children: [], harvestClicks: 7, harvestHungerCost: .6, harvestWear: 1.5 },
    钻石: { emoji: "💎", children: ["钻石块"], hiddenLayer: true },
    钻石块: { emoji: "🔷", children: [], harvestClicks: 10, harvestHungerCost: .8, harvestWear: 2 },
    基岩: { emoji: "🪨", children: [], indestructible: true },

    身体: { emoji: "🧍", children: ["手", "嘴"], sound: "body.wav" },
    手: { emoji: "✋", children: [], durability: 100, durabilityRecovery: .5, defaultHarvestWear: 1, sound: "body.wav" },
    嘴: { emoji: "👄", children: [], durability: 100, durabilityRecovery: .5, defaultEatWear: 1, sound: "body.wav" },
    背包: { emoji: "🎒", children: [], sound: "backpack.wav" },
    思考: { emoji: "💡", children: [] },
    刷新: { emoji: "🔄", children: [] },
    饥饿: { emoji: "🍖", children: [] }, 生命: { emoji: "❤️", children: [] }, 专注: { emoji: "🎯", children: [] }
  };

  /* 以下派生数据由类型表自动生成，其他模块无需维护第二份节点信息。 */
  const emoji = Object.fromEntries(Object.entries(NODE_TYPES).map(([type, data]) => [type, data.emoji]));
  const rules = Object.fromEntries(Object.entries(NODE_TYPES).map(([type, data]) => [type, data.children || []]));
  const soundFiles = Object.fromEntries(Object.entries(NODE_TYPES).filter(([, data]) => data.sound).map(([type, data]) => [type, data.sound]));
  // UI 行为音效不属于节点类型；后续请将归类音频命名为 sounds/sort.wav。
  const uiSoundFiles = { 归类: "sort.wav" };
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
    NODE_SIZE, ZOOM, NODE_TYPES, emoji, rules, soundFiles, uiSoundFiles,
    HARVEST_CLICKS_BY_TYPE, HARVEST_HUNGER_COST_BY_TYPE, HARVEST_WEAR_BY_TYPE, EAT_WEAR_BY_TYPE, HIDDEN_LAYER_TYPES, INDESTRUCTIBLE_TYPES, FINAL_HIDDEN_LAYER_TYPE, RESOURCE_CONFIG
  });
})();
