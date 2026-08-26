/* 工具交互：身体展开后的手、嘴，以及采集与进食模式。 */
(() => {
const { Interaction } = window.TreeWorld;

Interaction.prototype.returnHand = function() {
  const hand = this.world.uiNodes.find(node => node.type === "手");
  if (!hand) return;
  this.handActive = false;
  this.harvestTarget = null;
  this.world.setActiveHarvestTarget(null);
  const home = this.world.toolHomePosition("手");
  hand.x = home.x;
  hand.y = home.y;
  hand.workspaceInPanel = false;
  hand.followsBody = true;
  this.canvas.style.cursor = "default";
  this.ui.setStatus("手已回到身体旁。");
};

Interaction.prototype.handleToolNodeDown = function(event) {
  if (this.handActive || this.mouthActive) return false;
  const node = [...this.world.uiNodes].reverse().find(item => item.visible && this.hit(item, event));
  if (!node || !["手", "嘴"].includes(node.type)) return false;
  this.world.uiNodes.forEach(item => item.selected = false);
  node.selected = true;
  if (node.lost) { this.ui.setStatus(`${node.type}已经磨损殆尽，无法再使用。`); return true; }
  if (node.type === "手") {
    this.handActive = true;
    this.audio.play(node.type);
    node.x = event.clientX;
    node.y = event.clientY;
    node.followsBody = false;
    this.canvas.style.cursor = "none";
    this.ui.setStatus("手已跟随光标：连续点击终端节点即可采集。");
  } else {
    this.mouthActive = true;
    this.audio.play(node.type);
    node.x = event.clientX;
    node.y = event.clientY;
    node.followsBody = false;
    this.canvas.style.cursor = "none";
    this.ui.setStatus("嘴已跟随光标：点击背包中的可食用物品即可进食。");
  }
  return true;
};

Interaction.prototype.moveTools = function(event) {
  if (this.handActive) {
    const hand = this.world.uiNodes.find(node => node.type === "手");
    if (hand) {
      hand.x = event.clientX;
      hand.y = event.clientY;
      // 工具始终使用屏幕坐标跟随，因此可自然进入工作区并显示在其内容之上。
      hand.workspaceInPanel = Boolean(this.workspacePanel?.open && this.workspacePanel.contains(event));
    }
  }
  if (this.mouthActive) {
    const mouth = this.world.uiNodes.find(node => node.type === "嘴");
    if (mouth) {
      mouth.x = event.clientX;
      mouth.y = event.clientY;
      mouth.workspaceInPanel = Boolean(this.workspacePanel?.open && this.workspacePanel.contains(event));
    }
  }
};

Interaction.prototype.handleMouthClick = function(event) {
  if (!this.mouthActive) return false;
  // 嘴进入工作区时，依然可命中经过工作区坐标变换后的背包食物。
  const food = [...this.world.uiNodes].reverse().find(node => node.backpackItemOwner && node.edible && node.visible && this.hit(node, event));
  if (!food) return true;
  const result = this.world.eatBackpackItem(food, performance.now());
  if (!result.eaten) return true;
  this.audio.play(food.type);
  const wear = this.world.wearTool("嘴", this.world.toolWearFor("嘴", food));
  if (wear.broken) this.mouthActive = false;
  this.ui.setStatus(result.poisoned ? "吃下了中毒食物，生命受损。" : "吃下食物，饥饿值得到补充。");
  return true;
};

Interaction.prototype.handleHandClick = function(event) {
  if (!this.handActive) return false;
  // 手尚未定义背包内部采集效果；在工作区只消耗这次点击，绝不穿透到下方世界。
  if (this.workspacePanel?.open && this.workspacePanel.contains(event)) return true;
  if (this.world.gameOver) { this.ui.setStatus("游戏结束：请点击“重新开始”。"); return true; }
  const point = this.worldPosition(event);
  const target = [...this.world.nodes].reverse().find(node => node.visible && (this.world.isHarvestable(node) || this.world.isIndestructible(node)) && this.hit(node, point));
  if (!target) return true;
  if (this.world.touchIndestructible(target, performance.now())) { this.ui.setStatus(`触碰到${target.type}：它无法被采集。`); return true; }
  if (this.harvestTarget && this.harvestTarget !== target) this.harvestTarget.harvestProgress = 0;
  // 同一目标的连续点击只推进采集进度；换目标时才结算从上一次采集父节点到新目标父节点的移动。
  if (this.harvestTarget !== target) this.beginHarvestMovement(target);
  this.harvestTarget = target;
  this.world.setActiveHarvestTarget(target);
  this.audio.play(target.type);
  const resources = this.world.consumeHarvestResources(target);
  if (resources.gameOver) { this.ui.setStatus("生命归零，游戏结束。请点击“重新开始”。"); return true; }
  const result = this.world.harvest(target, performance.now());
  if (result.revealed) this.audio.play("隐藏层");
  const wear = this.world.wearTool("手", this.world.toolWearFor("手", target));
  if (wear.broken) { this.handActive = false; this.canvas.style.cursor = "default"; }
  if (result.completed && this.ui.backpackOpen) this.world.setBackpackOpen(true, this.canvas.width);
  const movementText = this.harvestMovementDebug ? `${this.harvestMovementDebug}｜` : "";
  if (!result.completed) this.ui.setStatus(`${movementText}采集 ${target.type}：${target.harvestProgress}/${result.required}`);
  else {
    // harvest 已经删除目标及其可能空掉的父级，并在递归清理中把 playerLocation 正确回退。
    // 此处绝不能再用已删除 target 查父节点，否则会查空并错误覆盖为山根。
    const landing = this.world.nodes.includes(this.world.playerLocation)
      ? this.world.playerLocation
      : this.world.root;
    this.worldMovementOrigin = landing;
    this.harvestMovementOrigin = landing;
    this.world.playerLocation = landing;
    this.harvestTarget = null;
    this.world.setActiveHarvestTarget(null);
    this.ui.setStatus(`${movementText}已摘除 ${target.type}，已放入背包。`);
  }
  return true;
};

Interaction.prototype.cancelTool = function(event) {
  if (this.mouthActive) {
    event.preventDefault();
    const mouth = this.world.uiNodes.find(node => node.type === "嘴");
    if (mouth) Object.assign(mouth, this.world.toolHomePosition("嘴"));
    if (mouth) { mouth.workspaceInPanel = false; mouth.followsBody = true; }
    this.mouthActive = false;
    this.canvas.style.cursor = "default";
    return true;
  }
  if (!this.handActive) return false;
  event.preventDefault();
  this.returnHand();
  return true;
};
})();
