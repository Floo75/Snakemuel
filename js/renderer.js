// renderer.js – rendu Canvas 2D moderne et responsive
import { TAU } from './utils.js';
import { WORLD } from './game.js';

export class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;
    // Zoom de départ légèrement dézoommé pour les grands mondes
    this.camera = { x: 0, y: 0, zoom: 0.9 };
    this.bgPattern = null;
    // Planet textures from Solar System Scope
    // Online: https://www.solarsystemscope.com/textures/
    this.onlinePlanetTextureUrls = [
      'https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_mars.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_moon.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_neptune.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_saturn.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_mercury.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_uranus.jpg',
      'https://www.solarsystemscope.com/textures/download/2k_sun.jpg',
    ];
    // Local copies expected at /textures (relative to index.html)
    this.localPlanetTextureUrls = [
      'textures/earth.jpg',
      'textures/jupiter.jpg',
      'textures/mars.jpg',
      'textures/venus.jpg',
      'textures/moon.jpg',
      'textures/neptune.jpg',
      'textures/saturn.jpg',
      'textures/mercury.jpg',
      'textures/uranus.jpg',
      'textures/sun.jpg',
    ];
    this.useOnlineTextures = false; // default to local textures
    this.planetTextures = [];
    this.foodTexMap = new WeakMap(); // food -> texture index
    this.foodSizeMap = new WeakMap(); // food -> size scale
    this.foodMoonsMap = new WeakMap(); // food -> array of moons
    this._loadPlanetTextures();
    this._loadBlackHoleTexture();
    // Minimap plus grande par défaut (peut être surchargée par le slider UI)
    this.minimapSize = 200;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  drawBlackHoles() {
    if (!this.state.blackHoles || !this.state.blackHoles.length) return;
    const ctx = this.ctx;
    const z = this.camera.zoom;
    const t = performance.now() / 1000;
    for (const bh of this.state.blackHoles) {
      const p = this.worldToScreen(bh.x, bh.y);
      const sc = (bh.scale || 1);
      const r = Math.max(38, 60 * z) * sc;

      if (this.blackHoleTex && this.blackHoleTex.complete && this.blackHoleTex.naturalWidth) {
        // Rotating textured black hole with circular clipping
        const size = r * 3.0; // slightly smaller to match reduced visuals
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(t * 0.6); // rotation speed
        ctx.globalAlpha = 0.95;
        // Clip to circle
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.clip();
        ctx.drawImage(this.blackHoleTex, -size/2, -size/2, size, size);
        ctx.restore();
      } else {
        // Procedural fallback core
        const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        core.addColorStop(0, 'rgba(0,0,0,1)');
        core.addColorStop(1, 'rgba(0,0,0,0.2)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }
      // Outer halo
      const halo = ctx.createRadialGradient(p.x, p.y, r * 0.9, p.x, p.y, r * 1.8);
      halo.addColorStop(0, 'rgba(0,0,0,0.18)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.8, 0, TAU);
      ctx.fill();
    }
  }

  _generateMoonsForHost(srcStr, planetRadius, f) {
    const r = planetRadius;
    const tilt = (f.tilt || 0) * 0.6;
    const moons = [];
    const make = (count, baseDist, baseRad, speedMin, speedMax, kind = 'moon', offsets = []) => {
      for (let i = 0; i < count; i++) {
        const off = offsets[i] ?? 0;
        moons.push({
          dist: r * baseDist * (0.95 + Math.random() * 0.1) + off,
          rad: Math.max(2.0, r * baseRad * (0.9 + Math.random() * 0.2)),
          speed: (speedMin + Math.random() * (speedMax - speedMin)) * (Math.random() < 0.5 ? 1 : -1),
          phase: Math.random() * TAU * (i + 1),
          tilt,
          kind,
        });
      }
    };

    if (srcStr.includes('earth')) {
      // 1 big Moon: farther and slower
      make(1, 3.4, 0.30, 0.10, 0.18, 'earth_moon');
    } else if (srcStr.includes('mars')) {
      // Phobos & Deimos (très petits, proches, rapides)
      make(2, 1.4, 0.10, 0.8, 1.4);
    } else if (srcStr.includes('jupiter')) {
      // Galiléennes simplifiées: 4 lunes, distances étagées, plutôt lentes
      make(4, 2.2, 0.14, 0.08, 0.18, 'moon', [r*0.2, r*0.5, r*0.9, r*1.4]);
    } else if (srcStr.includes('saturn')) {
      // Quelques lunes (moyennes), vitesse modérée
      make(3, 2.0, 0.13, 0.12, 0.28);
    } else if (srcStr.includes('uranus') || srcStr.includes('neptune')) {
      // Quelques lunes, modérées
      make(2, 1.9, 0.12, 0.15, 0.32);
    } else {
      // Mercury / Venus / others: pas de lune
    }
    return moons;
  }

  _sizeScaleForTexture(img) {
    // Default neutral scale
    const dflt = 1.0;
    if (!img || !img.src) return dflt;
    const s = String(img.src).toLowerCase();
    // Relative to Earth ~1.0, limited to a visually balanced range
    if (s.includes('mercury')) return 0.45;
    if (s.includes('moon')) return 0.5;
    if (s.includes('mars')) return 0.7;
    if (s.includes('venus')) return 0.8;
    if (s.includes('earth')) return 1.0;
    if (s.includes('neptune')) return 1.6;
    if (s.includes('uranus')) return 1.8;
    if (s.includes('saturn')) return 2.2;
    if (s.includes('jupiter')) return 2.5;
    if (s.includes('sun')) return 3.0;
    return dflt;
  }

  _loadPlanetTextures() {
    const srcList = this.useOnlineTextures ? this.onlinePlanetTextureUrls : this.localPlanetTextureUrls;
    this.planetTextures = srcList.map((url) => {
      const img = new Image();
      if (this.useOnlineTextures) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.src = url;
      return img;
    });
  }

  reloadPlanetTextures() {
    // Reset the mapping so foods can pick a texture index with the new list
    this.foodTexMap = new WeakMap();
    this._loadPlanetTextures();
  }

  _loadBlackHoleTexture() {
    // Attempt to load a local black hole texture
    // Accepts either textures/trounoir.png or textures/blackhole.png
    const candidates = [
      // User-specified file
      'textures/blackhole.jpg',
      // Parent folder fallback
      '../textures/blackhole.jpg',
    ];
    this.blackHoleTex = null;
    for (const url of candidates) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (!this.blackHoleTex) { this.blackHoleTex = img; console.info('[Renderer] Black hole texture loaded:', url); } };
      img.onerror = () => {};
      img.src = url;
    }
  }

  resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  updateCamera(dt) {
    const me = this.state.me;
    if (!me || !me.alive) return;
    // Smooth follow
    let targetX = me.segments[0].x;
    let targetY = me.segments[0].y;
    // Unwrap target relative to current camera to avoid big jumps across world wrap
    if (targetX - this.camera.x > WORLD.width / 2) targetX -= WORLD.width;
    if (targetX - this.camera.x < -WORLD.width / 2) targetX += WORLD.width;
    if (targetY - this.camera.y > WORLD.height / 2) targetY -= WORLD.height;
    if (targetY - this.camera.y < -WORLD.height / 2) targetY += WORLD.height;
    this.camera.x += (targetX - this.camera.x) * Math.min(1, dt * 5);
    this.camera.y += (targetY - this.camera.y) * Math.min(1, dt * 5);

    // Zoom based on length
    const len = me.segments.length;
    // Dézoomer un peu plus pour un grand monde
    const targetZoom = len > 30 ? 0.75 : len > 15 ? 0.85 : 0.9;
    this.camera.zoom += (targetZoom - this.camera.zoom) * Math.min(1, dt * 2);

  }

  worldToScreen(x, y) {
    const cx = this.camera.x;
    const cy = this.camera.y;
    const z = this.camera.zoom;
    const vw = this.canvas.clientWidth;
    const vh = this.canvas.clientHeight;
    // Wrap relative to camera so objects near edges render smoothly
    let dx = x - cx;
    let dy = y - cy;
    if (dx > WORLD.width / 2) dx -= WORLD.width;
    if (dx < -WORLD.width / 2) dx += WORLD.width;
    if (dy > WORLD.height / 2) dy -= WORLD.height;
    if (dy < -WORLD.height / 2) dy += WORLD.height;
    return { x: Math.round(dx * z + vw / 2), y: Math.round(dy * z + vh / 2) };
  }

  screenToWorld(sx, sy) {
    const cx = this.camera.x;
    const cy = this.camera.y;
    const z = this.camera.zoom;
    const vw = this.canvas.clientWidth;
    const vh = this.canvas.clientHeight;
    const dx = (sx - vw / 2) / z;
    const dy = (sy - vh / 2) / z;
    // Map back to world near camera; then wrap into [0, W/H)
    let x = cx + dx;
    let y = cy + dy;
    // normalize
    x = (x % WORLD.width + WORLD.width) % WORLD.width;
    y = (y % WORLD.height + WORLD.height) % WORLD.height;
    return { x, y };
  }

  drawBackground() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    // No grid: rely on CSS background for aesthetics
  }

  drawFood() {
    const ctx = this.ctx;
    const z = this.camera.zoom;
    const t = performance.now() / 1000;
    for (const f of this.state.food.values()) {
      const p = this.worldToScreen(f.x, f.y);
      // choose texture and size scale for this food
      let idx = this.foodTexMap.get(f);
      if (idx === undefined) {
        idx = Math.floor(Math.random() * this.planetTextures.length);
        this.foodTexMap.set(f, idx);
      }
      const tex = this.planetTextures[idx];
      let sizeScale = this.foodSizeMap.get(f);
      if (sizeScale === undefined) {
        sizeScale = this._sizeScaleForTexture(tex);
        this.foodSizeMap.set(f, sizeScale);
      }
      const r = Math.max(8, f.r * z * 1.2 * sizeScale);

      // Soft shadow below
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(p.x + r*0.12, p.y + r*0.55, r*0.9, r*0.32, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Draw textured planet if loaded (with rotation), else fallback gradient
      if (tex && tex.complete && tex.naturalWidth) {
        ctx.save();
        ctx.translate(p.x, p.y);
        const ang = (f.rotPhase || 0) + (f.rotSpeed || 0) * t;
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, TAU);
        ctx.clip();
        // Fit the texture square into the circle bounding box
        const size = r * 2;
        ctx.drawImage(tex, -r, -r, size, size);
        ctx.restore();
      } else {
        // Fallback procedural planet
        const body = ctx.createRadialGradient(p.x - r*0.4, p.y - r*0.4, r*0.2, p.x, p.y, r*1.05);
        body.addColorStop(0, `hsl(${f.hue}, 85%, 70%)`);
        body.addColorStop(1, `hsl(${f.hue}, 85%, 45%)`);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }

      // Simple highlight
      ctx.save();
      const highlight = ctx.createRadialGradient(p.x - r*0.5, p.y - r*0.5, 0, p.x, p.y, r);
      highlight.addColorStop(0, 'rgba(255,255,255,0.18)');
      highlight.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = highlight;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Moons (satellites) — realistic per host planet
      let moons = this.foodMoonsMap.get(f);
      const srcStr = tex && tex.src ? String(tex.src).toLowerCase() : '';
      if (!moons) {
        moons = this._generateMoonsForHost(srcStr, r, f);
        this.foodMoonsMap.set(f, moons);
      }

      if (moons && moons.length) {
        // Texture to use for Earth's moon
        let earthMoonTex = null;
        for (const img of this.planetTextures) {
          if (!img || !img.src) continue;
          const s = String(img.src).toLowerCase();
          if (s.includes('moon')) { earthMoonTex = img; break; }
        }
        for (const m of moons) {
          const ang = m.phase + t * m.speed;
          const mx = p.x + Math.cos(ang) * m.dist;
          const my = p.y + Math.sin(ang) * m.dist * Math.cos(m.tilt || 0);
          const mr = Math.max(3, m.rad);

          // Shadow under moon
          ctx.save();
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = 'rgba(0,0,0,.28)';
          ctx.beginPath();
          ctx.ellipse(mx + mr*0.1, my + mr*0.45, mr*0.6, mr*0.22, 0, 0, TAU);
          ctx.fill();
          ctx.restore();

          const useTex = m.kind === 'earth_moon' ? earthMoonTex : null;
          if (useTex && useTex.complete && useTex.naturalWidth) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(mx, my, mr, 0, TAU);
            ctx.clip();
            ctx.drawImage(useTex, mx - mr, my - mr, mr*2, mr*2);
            ctx.restore();
          } else {
            // Fallback sphere (color slightly varies)
            const grad = ctx.createRadialGradient(mx - mr*0.4, my - mr*0.4, mr*0.2, mx, my, mr);
            grad.addColorStop(0, 'hsl(210, 8%, 82%)');
            grad.addColorStop(1, 'hsl(210, 8%, 52%)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(mx, my, mr, 0, TAU);
            ctx.fill();
          }
        }
      }

      // Rings removed per user request
    }
  }

  drawSnake(s) {
    const ctx = this.ctx;
    const z = this.camera.zoom;

    // body
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(6, 12 * z);

    // Unwrap segments across world torus to avoid long lines and flashes
    if (s.segments.length > 1) {
      let prev = { x: s.segments[0].x, y: s.segments[0].y };
      // Halo de corps (feu) quand boost actif – tracé lumineux sur tout le contour
      if (s.boost) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const t = performance.now() / 1000;
        // Pulsation douce 0.9..1.1
        const pulse = 1 + Math.sin(t * 6.0) * 0.1;
        // Large outer glow (orange), décalé/écarté
        ctx.lineWidth = Math.max(12, 22 * z) * pulse;
        ctx.strokeStyle = 'rgba(255,140,0,0.35)';
        let glowPrev = { x: prev.x, y: prev.y };
        for (let i = 1; i < s.segments.length; i++) {
          const raw = s.segments[i];
          let dx = raw.x - glowPrev.x;
          let dy = raw.y - glowPrev.y;
          if (dx > WORLD.width / 2) dx -= WORLD.width; else if (dx < -WORLD.width / 2) dx += WORLD.width;
          if (dy > WORLD.height / 2) dy -= WORLD.height; else if (dy < -WORLD.height / 2) dy += WORLD.height;
          const cur = { x: glowPrev.x + dx, y: glowPrev.y + dy };
          // Décaler perpendiculairement (écarter du corps)
          const nx = -dy; // vecteur normal (non normalisé)
          const ny = dx;
          const off = Math.max(6, 12 * z) * 0.6 * pulse; // offset latéral
          const paW = { x: glowPrev.x + (nx) * off / (Math.hypot(nx, ny) || 1), y: glowPrev.y + (ny) * off / (Math.hypot(nx, ny) || 1) };
          const pbW = { x: cur.x + (nx) * off / (Math.hypot(nx, ny) || 1), y: cur.y + (ny) * off / (Math.hypot(nx, ny) || 1) };
          const pa = this.worldToScreen(paW.x, paW.y);
          const pb = this.worldToScreen(pbW.x, pbW.y);
          if (Math.hypot(pb.x - pa.x, pb.y - pa.y) <= 240) {
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
          glowPrev = cur;
        }
        // Inner hot glow (jaune)
        ctx.lineWidth = Math.max(8, 16 * z) * pulse;
        ctx.strokeStyle = 'rgba(255,220,120,0.25)';
        glowPrev = { x: prev.x, y: prev.y };
        for (let i = 1; i < s.segments.length; i++) {
          const raw = s.segments[i];
          let dx = raw.x - glowPrev.x;
          let dy = raw.y - glowPrev.y;
          if (dx > WORLD.width / 2) dx -= WORLD.width; else if (dx < -WORLD.width / 2) dx += WORLD.width;
          if (dy > WORLD.height / 2) dy -= WORLD.height; else if (dy < -WORLD.height / 2) dy += WORLD.height;
          const cur = { x: glowPrev.x + dx, y: glowPrev.y + dy };
          const pa = this.worldToScreen(glowPrev.x, glowPrev.y);
          const pb = this.worldToScreen(cur.x, cur.y);
          if (Math.hypot(pb.x - pa.x, pb.y - pa.y) <= 240) {
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
          glowPrev = cur;
        }
        ctx.restore();
      }
      for (let i = 1; i < s.segments.length; i++) {
        const raw = s.segments[i];
        // Minimal torus delta from prev to raw
        let dx = raw.x - prev.x;
        let dy = raw.y - prev.y;
        if (dx > WORLD.width / 2) dx -= WORLD.width; else if (dx < -WORLD.width / 2) dx += WORLD.width;
        if (dy > WORLD.height / 2) dy -= WORLD.height; else if (dy < -WORLD.height / 2) dy += WORLD.height;
        const cur = { x: prev.x + dx, y: prev.y + dy };

        // If the jump is abnormally large, skip drawing this segment to avoid a flash
        const maxSpan = 4 * 12; // ~4 segment spacings in world units (12px spacing default)
        if (Math.hypot(dx, dy) <= maxSpan) {
          const pa = this.worldToScreen(prev.x, prev.y);
          const pb = this.worldToScreen(cur.x, cur.y);
          // Extra safety: skip if on-screen distance is abnormally large (avoids bars across screen)
          if (Math.hypot(pb.x - pa.x, pb.y - pa.y) > 160) { prev = cur; continue; }
          // Single-color body
          ctx.strokeStyle = s.color || '#ffffff';
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        }

        prev = cur;
      }
    }

    // head
    const head = s.segments[0];
    const p = this.worldToScreen(head.x, head.y);
    const r = Math.max(6, 10 * z);

    // Effet boost: boule de feu + flamme dirigée
    if (s.boost) {
      const ctx = this.ctx;
      const hr = r * 2.4;
      // Halo principal (boule de feu)
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const fire = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, hr);
      fire.addColorStop(0.00, 'rgba(255, 230, 120, 0.85)');
      fire.addColorStop(0.35, 'rgba(255, 140, 0, 0.55)');
      fire.addColorStop(1.00, 'rgba(255, 80, 0, 0.0)');
      ctx.fillStyle = fire;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hr, 0, TAU);
      ctx.fill();

      // Flamme orientée (cône) derrière la tête
      const dir = s.dir || 0;
      const tailLen = r * 4.0;
      const tailWide = r * 1.4;
      const bx = p.x - Math.cos(dir) * (r * 0.6);
      const by = p.y - Math.sin(dir) * (r * 0.6);
      const tx = p.x - Math.cos(dir) * (tailLen + r);
      const ty = p.y - Math.sin(dir) * (tailLen + r);
      // Flamme interne (jaune)
      ctx.fillStyle = 'rgba(255, 220, 120, 0.85)';
      ctx.beginPath();
      ctx.moveTo(bx + Math.sin(dir) * (tailWide * 0.4), by - Math.cos(dir) * (tailWide * 0.4));
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx - Math.sin(dir) * (tailWide * 0.4), by + Math.cos(dir) * (tailWide * 0.4));
      ctx.closePath();
      ctx.fill();
      // Flamme externe (orange)
      ctx.fillStyle = 'rgba(255, 140, 0, 0.7)';
      ctx.beginPath();
      ctx.moveTo(bx + Math.sin(dir) * tailWide, by - Math.cos(dir) * tailWide);
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx - Math.sin(dir) * tailWide, by + Math.cos(dir) * tailWide);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    this.ctx.fillStyle = s.color || '#ffffff'; // single-color head
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, r, 0, TAU);
    this.ctx.fill();

    // eyes (only if alive)
    if (s.alive) {
      const eyeOffset = 6 * z;
      const ex = Math.cos(s.dir) * eyeOffset;
      const ey = Math.sin(s.dir) * eyeOffset;
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.arc(p.x + ex, p.y + ey, Math.max(1, 2 * z), 0, TAU);
      ctx.fill();
    }
  }

  drawHUD() {
    const me = this.state.me;
    const scoreEl = document.getElementById('score');
    const lengthEl = document.getElementById('length');
    if (me) {
      scoreEl.textContent = String(me.score);
      lengthEl.textContent = String(me.segments.length);
    }
  }

  render(dt, fps) {
    this.updateCamera(dt);
    this.drawBackground();
    this.drawZone();
    this.drawBlackHoles();
    this.drawFood();
    for (const s of this.state.players.values()) {
      if (!s.alive) continue;
      this.drawSnake(s);
    }
    this.drawHUD();

    // Minimap
    this.drawMinimap();

    // FPS
    const fpsEl = document.getElementById('fps');
    if (fpsEl) fpsEl.textContent = String(Math.round(fps));
  }

  drawZone() {
    const zstate = this.state.zone;
    if (!zstate || !zstate.enabled) return;
    const ctx = this.ctx;
    const c = this.worldToScreen(zstate.cx, zstate.cy);
    const r = zstate.r * this.camera.zoom; // radius in screen space
    ctx.save();
    ctx.strokeStyle = 'rgba(96, 239, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  drawMinimap() {
    const ctx = this.ctx;
    const pad = 14;
    const size = this.minimapSize || 140; // px
    const x = pad;
    const y = pad;
    ctx.save();
    ctx.globalAlpha = 0.95;
    // Background
    ctx.fillStyle = 'rgba(17,20,39,0.85)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect?.(x, y, size, size, 10);
    if (!ctx.roundRect) ctx.rect(x, y, size, size);
    ctx.fill();
    ctx.stroke();

    // World to minimap scale
    const sx = size / WORLD.width;
    const sy = size / WORLD.height;

    // Draw zone on minimap
    const zstate = this.state.zone;
    if (zstate && zstate.enabled) {
      const zx = x + zstate.cx * sx;
      const zy = y + zstate.cy * sy;
      const zr = zstate.r * sx; // assuming aspect 1:1
      ctx.strokeStyle = 'rgba(96,239,255,0.8)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(zx, zy, zr, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw players' heads
    // Black holes on minimap
    if (this.state.blackHoles && this.state.blackHoles.length) {
      ctx.fillStyle = 'rgba(96,239,255,0.95)';
      for (const bh of this.state.blackHoles) {
        const bx = x + bh.x * sx;
        const by = y + bh.y * sy;
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, TAU);
        ctx.fill();
      }
    }
    for (const s of this.state.players.values()) {
      if (!s.alive) continue; // show only alive snakes on minimap
      const head = s.segments[0];
      if (!head) continue;
      const px = x + head.x * sx;
      const py = y + head.y * sy;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, (this.state.me && s.id === this.state.me.id) ? 3 : 2, 0, TAU);
      ctx.fill();
    }

    // Camera rectangle
    const vw = this.canvas.clientWidth / this.camera.zoom;
    const vh = this.canvas.clientHeight / this.camera.zoom;
    // Camera center to top-left in world with wrap awareness
    let cx = this.camera.x - vw / 2;
    let cy = this.camera.y - vh / 2;
    // Normalize
    cx = (cx % WORLD.width + WORLD.width) % WORLD.width;
    cy = (cy % WORLD.height + WORLD.height) % WORLD.height;
    const rx = x + cx * sx;
    const ry = y + cy * sy;
    const rw = vw * sx;
    const rh = vh * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([4,3]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);

    ctx.restore();
  }
}
