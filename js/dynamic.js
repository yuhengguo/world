/*
 * 动态节点控制器。
 * 动态节点由 config.js 的 dynamic 字段启用；本文件只负责移动，
 * 因而日后可在不触碰采集和渲染逻辑的前提下加入更多生物或 NPC。
 */

(() => {
class DynamicNodeController {
  constructor(world) {
    this.world = world;
  }

  /** 收集一个父节点下所有可见后代；动态节点自身不参与自己的边界计算。 */
  visibleDescendants(node, excluded) {
    const nodes = [];
    node.children.forEach(child => {
      if (child !== excluded && child.visible) nodes.push(child);
      nodes.push(...this.visibleDescendants(child, excluded));
    });
    return nodes;
  }

  /** 以父节点整条可见分支中所有节点的外边缘为准，计算动态节点允许活动的矩形。 */
  siblingBounds(node) {
    const parent = this.world.edges.find(edge => edge.to === node)?.from;
    if (!parent) return null;
    const rangeNodes = this.visibleDescendants(parent, node);
    if (!rangeNodes.length) return null;
    // 使用节点外边缘而非中心点：范围节点只剩一个时仍有 100×60 的活动空间，不会卡在一点。
    const halfWidth = 50;
    const halfHeight = 30;
    const staticChildren = parent.children.filter(child => child !== node && !child.dynamic && child.visible);
    // 只剩一个静态子节点时，用类型配置额外扩大范围，避免动态节点被卡在这张卡片附近。
    const padding = staticChildren.length === 1 ? (node.dynamic.singleStaticBoundsPadding || {}) : {};
    const padX = Math.max(0, Number(padding.x) || 0);
    const padY = Math.max(0, Number(padding.y) || 0);
    return {
      minX: Math.min(...rangeNodes.map(item => item.x - halfWidth)) - padX,
      maxX: Math.max(...rangeNodes.map(item => item.x + halfWidth)) + padX,
      minY: Math.min(...rangeNodes.map(item => item.y - halfHeight)) - padY,
      maxY: Math.max(...rangeNodes.map(item => item.y + halfHeight)) + padY
    };
  }

  /** 随机选一个飞行方向，并在配置规定的时长后重新转向。 */
  chooseDirection(node, now) {
    const [minInterval, maxInterval] = node.dynamic.turnInterval || [650, 1500];
    const random = window.TreeWorld.dynamicRandom;
    const angle = random.next() * Math.PI * 2;
    node.dynamicState = {
      vx: Math.cos(angle) * node.dynamic.speed,
      vy: Math.sin(angle) * node.dynamic.speed,
      turnAt: now + minInterval + random.next() * (maxInterval - minInterval),
      lastTick: now
    };
  }

  /** 更新每只可见鸟的位置，并将 X/Y 严格限制在兄弟节点的极值范围内。 */
  tick(now) {
    this.world.nodes.filter(node => node.visible && node.dynamic).forEach(node => {
      const bounds = this.siblingBounds(node);
      if (!bounds) return;
      if (!node.dynamicState || now >= node.dynamicState.turnAt) this.chooseDirection(node, now);
      const state = node.dynamicState;
      const seconds = Math.min(.08, Math.max(0, (now - state.lastTick) / 1000));
      state.lastTick = now;
      node.x = Math.max(bounds.minX, Math.min(bounds.maxX, node.x + state.vx * seconds));
      node.y = Math.max(bounds.minY, Math.min(bounds.maxY, node.y + state.vy * seconds));
      if (node.x === bounds.minX || node.x === bounds.maxX || node.y === bounds.minY || node.y === bounds.maxY) this.chooseDirection(node, now);
    });
  }
}

window.TreeWorld.DynamicNodeController = DynamicNodeController;
})();
