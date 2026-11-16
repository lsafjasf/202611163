// Built-in templates: one default case and one boundary case (extreme long
// text + tiny element) to exercise validation and error prompts.
import { createElement } from './overlay.js';

export function defaultTemplate() {
  return {
    params: { type: 'wood', scale: 1.5, angle: 15, contrast: 1.1, seed: 42 },
    repairs: [],
    elements: [
      createElement('text', {
        text: '天然纹理 · 2026', x: 106, y: 220, fontSize: 36,
        fontFamily: 'serif', color: '#fff8e7',
        keyframes: [
          { t: 0, x: 106, y: 220, opacity: 1 },
          { t: 0.5, x: 106, y: 200, opacity: 0.85 },
          { t: 1, x: 106, y: 220, opacity: 1 },
        ],
      }),
      createElement('rect', { x: 96, y: 280, w: 320, h: 6, color: '#fff8e7', opacity: 0.8 }),
    ],
    timeline: 0,
  };
}

export function boundaryTemplate() {
  return {
    params: { type: 'fabric', scale: 4, angle: 45, contrast: 2.2, seed: 7 },
    repairs: [{ x: 0.02, y: 0.5, r: 0.08, strength: 0.9 }],
    elements: [
      createElement('text', {
        text: '这是一段用于验证极端长文本边界情况的文字，'.repeat(30),
        x: 20, y: 20, fontSize: 28, fontFamily: 'sans-serif', color: '#ffffff',
      }),
      createElement('ellipse', { x: 250, y: 250, w: 2, h: 2, color: '#ffcc00' }),
      createElement('text', { text: '极小字号', x: 380, y: 460, fontSize: 3, color: '#ffffff' }),
    ],
    timeline: 0,
  };
}
