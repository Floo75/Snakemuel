// utils.js – fonctions utilitaires générales

export const TAU = Math.PI * 2;

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist2Torus(ax, ay, bx, by, W, H) {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > W / 2) dx = W - dx;
  if (dy > H / 2) dy = H - dy;
  return dx * dx + dy * dy;
}

export function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

export function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

export function angleBetween(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

export function vecFromAngle(a) {
  return { x: Math.cos(a), y: Math.sin(a) };
}

export function now() {
  return performance.now();
}

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

export function loadLocal(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (_) {
    return fallback;
  }
}
