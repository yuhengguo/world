/*
 * 应用入口。
 * 此文件只负责创建各模块、同步画布尺寸并启动渲染循环；具体规则分别留在对应模块中。
 */

(() => {
const { AudioManager, Interaction, Renderer, UI, World } = window.TreeWorld;

const canvas = document.getElementById("canvas");

/** 让画布始终覆盖视口，同时保持左下角 UI 的固定位置。 */
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

resize();
const world = new World(canvas.width, canvas.height);
const ui = new UI();
const audio = new AudioManager();
audio.startBackground();
// 某些浏览器要求用户手势才能播放声音；首次点击会自动补启背景音乐。
canvas.addEventListener("pointerdown", () => audio.startBackground(), { once: true });
const interaction = new Interaction(canvas, world, ui, audio);
const renderer = new Renderer(canvas, world, ui);
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
});

/** requestAnimationFrame 驱动 Canvas 持续重绘，以显示颤动与悬停状态。 */
function frame(now) {
  world.tick(now);
  restartButton.hidden = !world.gameOver;
  renderer.draw(interaction.camera, interaction.hovered, interaction.handActive, now, interaction.selectionBox);
  requestAnimationFrame(frame);
}

ui.setStatus("先点击树节点展开，直到出现花、种子或原木。");
requestAnimationFrame(frame);
})();
