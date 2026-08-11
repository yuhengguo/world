/*
 * 天体系统。
 * 当前实现太阳与月亮；未来五大行星与二十八星宿都在这里添加各自的时间位置规则，
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
    this.moon = null;
    // 天空是开局即存在的世界说明层，因此默认展开；之后玩家仍可点击天空手动收起。
    this.world.sky.open = true;
    this.ensureCelestials();
  }

  /** 点击天空时切换展开状态；天体只会创建一次，收起时仅隐藏。 */
  toggleSky() {
    const sky = this.world.sky;
    sky.open = !sky.open;
    if (sky.open) this.ensureCelestials();
    sky.children.forEach(node => node.visible = sky.open);
    return sky.open;
  }

  /** 创建昼夜天体；它们始终保留在天空子节点中，由 tick 决定谁可见。 */
  ensureCelestials() {
    if (!this.sun) this.sun = this.createCelestial("太阳");
    if (!this.moon) this.moon = this.createCelestial("月亮");
  }

  /** 创建一个固定屏幕坐标的天体节点，并连接到天空节点。 */
  createCelestial(type) {
    const node = new Node(type, this.canvas.width + TIME_CONFIG.sunMargin, TIME_CONFIG.sunY, true);
    node.fixedUI = true;
    node.celestialUI = true;
    node.visible = false;
    this.world.sky.children.push(node);
    this.world.uiNodes.push(node);
    return node;
  }

  /** 每帧根据昼夜进度切换太阳/月亮，并让当值天体从东向西运行。 */
  tick() {
    this.world.positionSky(this.canvas.width);
    this.ensureCelestials();
    const daytime = this.clock.isDaytime();
    this.sun.visible = Boolean(this.world.sky.open && daytime);
    this.moon.visible = Boolean(this.world.sky.open && !daytime);
    // 从右侧边缘内开始到左侧边缘内结束，刚展开天空时太阳即可被看见。
    const startX = this.canvas.width - TIME_CONFIG.sunMargin;
    const span = Math.max(0, this.canvas.width - TIME_CONFIG.sunMargin * 2);
    const activeCelestial = daytime ? this.sun : this.moon;
    const progress = daytime ? this.clock.dayProgress() : this.clock.nightProgress();
    activeCelestial.x = startX - span * progress;
    activeCelestial.y = TIME_CONFIG.sunY;
  }
}

window.TreeWorld.CelestialSystem = CelestialSystem;
})();
