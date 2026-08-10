/*
 * 天体系统。
 * 当前仅实现太阳；未来月亮、五大行星与二十八星宿都在这里添加各自的时间位置规则，
 * 不与鸟的 sibling-bound 动态移动系统混用。
 */
(() => {
const { NODE_TYPES, Node, TIME_CONFIG } = window.TreeWorld;

class CelestialSystem {
  constructor(world, clock, canvas) {
    this.world = world;
    this.clock = clock;
    this.canvas = canvas;
    this.sun = null;
  }

  /** 点击天空时切换展开状态；首次展开才创建太阳节点。 */
  toggleSky() {
    const sky = this.world.sky;
    sky.open = !sky.open;
    if (sky.open) this.ensureSun();
    sky.children.forEach(node => node.visible = sky.open);
    return sky.open;
  }

  /** 仅创建一次太阳，之后始终由游戏时间决定其位置与可见性。 */
  ensureSun() {
    if (this.sun) return this.sun;
    this.sun = new Node("太阳", this.canvas.width + TIME_CONFIG.sunMargin, TIME_CONFIG.sunY, true);
    this.sun.fixedUI = true;
    this.sun.celestialUI = true;
    this.sun.visible = false;
    this.world.sky.children.push(this.sun);
    this.world.uiNodes.push(this.sun);
    return this.sun;
  }

  /** 每帧根据昼夜进度更新太阳。夜晚保留节点数据但隐藏它。 */
  tick() {
    this.world.positionSky(this.canvas.width);
    if (!this.sun) return;
    const daytime = this.clock.isDaytime();
    this.sun.visible = Boolean(this.world.sky.open && daytime);
    if (!daytime) return;
    // 从右侧边缘内开始到左侧边缘内结束，刚展开天空时太阳即可被看见。
    const startX = this.canvas.width - TIME_CONFIG.sunMargin;
    const span = Math.max(0, this.canvas.width - TIME_CONFIG.sunMargin * 2);
    this.sun.x = startX - span * this.clock.dayProgress();
    this.sun.y = TIME_CONFIG.sunY;
  }
}

window.TreeWorld.CelestialSystem = CelestialSystem;
})();
