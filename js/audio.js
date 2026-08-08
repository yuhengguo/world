/*
 * 音效管理。
 * 音频缺失、浏览器自动播放限制等情况都会被忽略，确保游戏主逻辑不会中断。
 */

(() => {
const { soundFiles, uiSoundFiles } = window.TreeWorld;

class AudioManager {
  constructor() {
    this.sounds = Object.fromEntries(Object.entries({ ...soundFiles, ...uiSoundFiles }).map(([type, file]) => [type, new Audio(`sounds/${file}`)]));
  }

  /** 从头播放指定节点的音效，用于展开与每次采集点击。 */
  play(type) {
    const sound = this.sounds[type];
    if (!sound) return;
    sound.currentTime = 0;
    sound.play().catch(() => {});
  }
}

window.TreeWorld.AudioManager = AudioManager;
})();
