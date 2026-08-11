/*
 * 游戏时间。
 * 只维护可暂停、可复用的游戏秒数；昼夜、天体、未来的植物生长都从这里读取时间，
 * 不直接依赖浏览器现实时间。
 */
(() => {
const { TIME_CONFIG } = window.TreeWorld;

class GameClock {
  constructor() {
    this.elapsed = 0;
    this.lastFrame = 0;
  }

  /** 由渲染循环推进游戏时间；长时间切出页面后最多补记一小段，避免天体突然跳完整圈。 */
  tick(now) {
    if (!this.lastFrame) { this.lastFrame = now; return; }
    const seconds = Math.min(.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.elapsed += seconds;
  }

  /** 返回当前昼夜周期中的秒数。 */
  cycleTime() {
    const cycle = TIME_CONFIG.dayDuration + TIME_CONFIG.nightDuration;
    return this.elapsed % cycle;
  }

  /** 当前是否处于太阳可见的白天。 */
  isDaytime() {
    return this.cycleTime() < TIME_CONFIG.dayDuration;
  }

  /** 白天内的标准化进度：0 为屏幕右侧，1 为屏幕左侧。 */
  dayProgress() {
    return Math.min(1, this.cycleTime() / TIME_CONFIG.dayDuration);
  }

  /** 夜晚内的标准化进度：0 为月亮从右侧升起，1 为月亮到达左侧。 */
  nightProgress() {
    const nightTime = Math.max(0, this.cycleTime() - TIME_CONFIG.dayDuration);
    return Math.min(1, nightTime / TIME_CONFIG.nightDuration);
  }
}

window.TreeWorld.GameClock = GameClock;
})();
