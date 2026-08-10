/*
 * 应用入口。
 * 此文件只负责创建各模块、同步画布尺寸并启动渲染循环；具体规则分别留在对应模块中。
 */

(() => {
const { AudioManager, CelestialSystem, DetailPanel, DynamicNodeController, GameClock, Interaction, Renderer, UI, World } = window.TreeWorld;

const canvas = document.getElementById("canvas");

/** 让画布始终覆盖视口，同时保持左下角 UI 的固定位置。 */
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

resize();
const world = new World(canvas.width, canvas.height);
const dynamicNodes = new DynamicNodeController(world);
const gameClock = new GameClock();
const celestial = new CelestialSystem(world, gameClock, canvas);
const ui = new UI();
const audio = new AudioManager();
audio.startBackground();
// 某些浏览器要求用户手势才能播放声音；首次点击会自动补启背景音乐。
canvas.addEventListener("pointerdown", () => audio.startBackground(), { once: true });
const interaction = new Interaction(canvas, world, ui, audio, celestial);
const renderer = new Renderer(canvas, world, ui);
const detailPanel = new DetailPanel();
const restartButton = document.getElementById("restartButton");

// 固定的刷新节点：回退最深的一层展开，并将可拖动 UI 放回初始化位置。
function resetGameView() {
  interaction.returnHand();
  const collapsed = world.collapseOneLayer();
  // 关闭背包会重建/清除所有临时拆出物品，避免遗留独立节点。
  ui.backpackOpen = false;
  world.setBackpackOpen(false, canvas.width);
  world.resetUIPositions();
  ui.setStatus(collapsed ? "已收起最深的一层，并复原 UI 位置。" : "UI 已复原到初始位置。");
}
interaction.onReset = resetGameView;

// 页面刷新会重新创建整个世界，因此真正完成一局新的游戏。
restartButton.addEventListener("click", () => window.location.reload());

window.addEventListener("resize", () => {
  resize();
  // UI 使用屏幕坐标并由用户拖动决定位置；窗口缩放不会重置它们。
  world.positionResourcePiles(canvas.width, canvas.height);
  world.positionSky(canvas.width);
});

/** requestAnimationFrame 驱动 Canvas 持续重绘，以显示颤动与悬停状态。 */
function frame(now) {
  world.tick(now);
  dynamicNodes.tick(now);
  gameClock.tick(now);
  celestial.tick();
  restartButton.hidden = !world.gameOver;
  // 黏附到鼠标的节点优先成为唯一蓝色焦点；没有黏附节点时由普通选中状态决定。
  const attachedNode = interaction.carriedTerminal || interaction.carriedUIItem
    || (interaction.handActive && world.uiNodes.find(node => node.type === "手"))
    || (interaction.mouthActive && world.uiNodes.find(node => node.type === "嘴"));
  renderer.draw(interaction.camera, interaction.hovered, interaction.handActive, now, interaction.selectionBox, attachedNode);
  // 多选时取最后一个节点作为详情焦点；没有选中节点时由详情页自行保留最近一次信息。
  const selectedNode = [...world.nodes, ...world.uiNodes].filter(node => node.selected).at(-1) || attachedNode || null;
  detailPanel.update(selectedNode);
  requestAnimationFrame(frame);
}

ui.setStatus("先点击树节点展开，直到出现花、种子或原木。");
requestAnimationFrame(frame);
})();
