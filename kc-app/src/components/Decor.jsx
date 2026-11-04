import React from 'react';

/**
 * 画板装饰层。
 * 坐标全部来自 KC-App-Design/dsl/*.json，单位是 1280×800 画板下的 css px。
 * 渲染时以 1280×800 为基准等比铺满窗口，保证贴纸与设计稿位置一致。
 */
export const SCREEN_W = 1280;
export const SCREEN_H = 800;
// .decor 铺在 .window 内容盒内，窗口在画板上的偏移与描边要从贴纸坐标里扣掉
export const WIN_X = 32;
export const WIN_Y = 22;
export const WIN_BORDER = 3;
const BOX_W = 1280 - WIN_X * 2 - WIN_BORDER * 2; // 1210
const BOX_H = 800 - WIN_Y * 2 - WIN_BORDER * 2; // 750

// 各画板用到的贴纸（DSL 名称 → 文件 + 设计稿坐标）
const SCENE = {
  p1: [
    { src: './img/stickers/login-window-cat-sticker.png', x: 115, y: 14, w: 286, h: 235, rot: 162 },
    { src: './img/stickers/login-planet-sticker.png', x: 610, y: 41, w: 152, h: 135, rot: -21.4 },
    { src: './img/stickers/p1-message-bubble.png', x: 894, y: 358, w: 365, h: 181, rot: 24.29 },
    { src: './img/stickers/login-shooting-star-sticker.png', x: 750, y: 226, w: 135, h: 102, rot: 18.4 },
    { src: './img/stickers/login-laptop-sticker.png', x: 835, y: 645, w: 166, h: 120, rot: 0 },
  ],
  p2: [
    { src: './img/stickers/p2-rainbow-clouds.png', x: 561, y: 627, w: 214, h: 103, rot: 13.67 },
    { src: './img/stickers/p2-pixel-star-sticker.png', x: 311, y: 640, w: 52, h: 43, rot: -35.31 },
    { src: './img/stickers/p2-pixel-star-sticker.png', x: 391, y: 63, w: 52, h: 43, rot: 18.96 },
    { src: './img/stickers/p2-pixel-folder-cat-sticker.png', x: 1129, y: 605, w: 111, h: 94, rot: -28.47 },
    { src: './img/stickers/p2-cat-plant.png', x: 952, y: 82, w: 66, h: 83, rot: 0 },
  ],
  // P3 的四种类型贴纸属于卡片图标，已在 NewTaskPage 内渲染，不放装饰层
  p3: [],
  p4: [
    { src: './img/stickers/p4-loading-window.png', x: 955, y: 190, w: 187, h: 93 },
    { src: './img/stickers/p4-cat-files.png', x: 82, y: 350, w: 32, h: 30 },
    { src: './img/stickers/p4-pink-notes.png', x: 94, y: 514, w: 116, h: 34 },
    { src: './img/stickers/p4-error-combo.png', x: 1081, y: 424, w: 147, h: 114 },
  ],
  p5: [
    { src: './img/stickers/p5-gear.png', x: 144, y: 122, w: 42, h: 42, rot: 0 },
    { src: './img/stickers/p5-net-cat.png', x: 520, y: 194, w: 58, h: 47, rot: 0 },
    { src: './img/stickers/p5-picasso.png', x: 1091, y: 415, w: 86, h: 67, rot: 0 },
    { src: './img/stickers/p5-notes.png', x: 535, y: 537, w: 54, h: 58, rot: 0 },
    { src: './img/stickers/p2-cat-plant.png', x: 984, y: 538, w: 48, h: 60, rot: 0 },
  ],
};

export default function Decor({ scene }) {
  const items = SCENE[scene] || [];
  if (!items.length) return null;
  return (
    <div className="decor" aria-hidden="true">
      {items.map((it, i) => (
        <img
          key={i}
          src={it.src}
          alt=""
          style={{
            left: `${((it.x - WIN_X - WIN_BORDER) / BOX_W) * 100}%`,
            top: `${((it.y - WIN_Y - WIN_BORDER) / BOX_H) * 100}%`,
            width: `${(it.w / BOX_W) * 100}%`,
            height: `${(it.h / BOX_H) * 100}%`,
            transform: it.rot ? `rotate(${it.rot}deg)` : undefined,
            transformOrigin: '50% 50%',
          }}
        />
      ))}
    </div>
  );
}
