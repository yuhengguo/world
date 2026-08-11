/*
 * 交互模块的兼容入口。
 * 实现已按职责拆分到 interaction-core、interaction-view、interaction-ui、
 * interaction-tools 与 interaction-world；此文件保留原有加载名称，供 main.js 使用。
 */
(() => {
  if (!window.TreeWorld.Interaction) throw new Error("交互模块加载顺序错误：请先加载 interaction-core.js。");
})();
