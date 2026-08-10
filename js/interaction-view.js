/* 视角交互：中键平移与滚轮缩放。 */
(() => {
const { Interaction, ZOOM } = window.TreeWorld;

Interaction.prototype.startViewPan = function(event) {
  if (event.button !== 1) return false;
  this.middle = true;
  this.lastScreen = { x: event.clientX, y: event.clientY };
  return true;
};

Interaction.prototype.moveViewPan = function(event) {
  if (!this.middle) return;
  this.camera.x += event.clientX - this.lastScreen.x;
  this.camera.y += event.clientY - this.lastScreen.y;
  this.lastScreen = { x: event.clientX, y: event.clientY };
};

Interaction.prototype.endViewPan = function(event) {
  if (event.button === 1) this.middle = false;
};

Interaction.prototype.handleWheel = function(event) {
  event.preventDefault();
  const old = this.camera.scale;
  this.camera.scale = Math.max(ZOOM.min, Math.min(ZOOM.max, old * Math.exp(-event.deltaY * ZOOM.sensitivity)));
  this.camera.x = event.clientX - (event.clientX - this.camera.x) * this.camera.scale / old;
  this.camera.y = event.clientY - (event.clientY - this.camera.y) * this.camera.scale / old;
};
})();
