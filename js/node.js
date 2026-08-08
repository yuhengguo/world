/*
 * 世界节点的数据模型。
 * Node 只保存状态，不处理绘制或鼠标事件，便于其他模块复用。
 */

(() => {
class Node {
  /**
   * @param {string} type 节点类别，例如“树”“花”。
   * @param {number} x 世界/屏幕横坐标。
   * @param {number} y 世界/屏幕纵坐标。
   * @param {boolean} ui 是否属于固定在屏幕上的 UI 节点。
   */
  constructor(type, x, y, ui = false) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.ui = ui;
    this.children = [];
    this.visible = true;
    this.open = false;
    this.selected = false;
    this.harvestProgress = 0;
    this.shakeUntil = 0;

    // underlays 是“叠在下方但尚未出现”的独立层，不属于 children。
    this.underlays = [];
    this.hiddenUnderlay = false;
    this.locked = false;
    // 可食用与中毒参数从配置类型表复制到实例，便于背包内的单个物品独立判定。
    const definition = window.TreeWorld.NODE_TYPES?.[type] || {};
    this.edible = Boolean(definition.edible);
    this.hungerRestore = definition.hungerRestore || 0;
    this.poisonChance = definition.poisonChance || 0;
    this.poisonDamage = definition.poisonDamage || 0;
    this.poisoned = this.poisonChance > 0 && Math.random() < this.poisonChance;
    this.durability = definition.durability ?? null;
    this.lost = false;
  }
}

window.TreeWorld.Node = Node;
})();
