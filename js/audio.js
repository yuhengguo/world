/*
 * 音效管理。
 * 音频缺失、浏览器自动播放限制等情况都会被忽略，确保游戏主逻辑不会中断。
 */

(() => {
const { BACKGROUND_MUSIC, soundFiles, soundVolumes, uiSoundFiles, uiSoundVolumes } = window.TreeWorld;

class AudioManager {
  constructor() {
    this.sounds = Object.fromEntries(Object.entries({ ...soundFiles, ...uiSoundFiles }).map(([type, file]) => {
      const sound = new Audio(`sounds/${file}`);
      // 音量由 config.js 的节点 volume 或 UI 音效音量表控制，并限制在浏览器允许范围内。
      sound.volume = Math.max(0, Math.min(1, soundVolumes[type] ?? uiSoundVolumes[type] ?? .7));
      return [type, sound];
    }));
    // 背景音乐独立于一次性节点音效，始终循环且不会被 play(type) 重置。
    this.background = new Audio(`sounds/${BACKGROUND_MUSIC.sound}`);
    this.background.loop = true;
    this.background.volume = Math.max(0, Math.min(1, BACKGROUND_MUSIC.volume));
    this.backgroundStarted = false;
  }

  /** 尝试启动背景音乐；浏览器拦截自动播放时，会在用户第一次点击后再次尝试。 */
  startBackground() {
    if (this.backgroundStarted) return;
    this.background.play().then(() => { this.backgroundStarted = true; }).catch(() => {});
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
