/*
 * 页面 UI 状态。
 * Canvas 内的身体、手与背包由交互模块处理；本模块仅负责 HTML 状态提示。
 */

(() => {
class UI {
  constructor() {
    this.status = document.getElementById("status");
    this.backpackOpen = false;
  }

  /** 在顶部中央显示一条简洁的操作反馈。 */
  setStatus(message) {
    this.status.textContent = message;
  }

  /** 切换背包面板显示状态，并返回切换后的值。 */
  toggleBackpack() {
    this.backpackOpen = !this.backpackOpen;
    this.setStatus(this.backpackOpen ? "背包已打开。" : "背包已收起。");
    return this.backpackOpen;
  }
}

window.TreeWorld.UI = UI;
})();
