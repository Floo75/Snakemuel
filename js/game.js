// game.js – logique principale du jeu (état, update, collisions)
import { TAU, clamp, dist2, randRange, uid, vecFromAngle } from './utils.js';

// Constantes de jeu
export const WORLD = {
  width: 12000,
  height: 12000,
  foodCount: 1760,
  foodValue: 10,
  baseSpeed: 190, // px/s (encore plus rapide)
  boostSpeed: 360, // px/s (nettement plus rapide en boost)
  turnRate: 999, // rad/s (quasi-instantané)
  segmentSpacing: 12,
  minLength: 6, // segments
  maxBots: 50,
  respawnDelayMs: 1200,
  killBonus: 50,
  deathDropFactor: 0.25, // proportion of segments dropped as food (plus réaliste, moins d'objets)
  battleRoyale: true,
  // Black holes
  blackHoleCount: 5,
  bhInfluence: 450, // px radius of gravitational pull (softer)
  bhEventHorizon: 80, // px lethal radius (softer)
  bhStrength: 4200, // base pull strength (softer)
};

export const SKINS = [
  { id: 'aqua', colors: ['#22d3ee', '#60efff'] },
  { id: 'neon', colors: ['#a78bfa', '#6a8dff'] },
  { id: 'lime', colors: ['#a3e635', '#22c55e'] },
  { id: 'sun', colors: ['#f59e0b', '#f97316'] },
  { id: 'rose', colors: ['#fb7185', '#ef4444'] },
  { id: 'mint', colors: ['#34d399', '#22d3ee'] },
  { id: 'gold', colors: ['#fbbf24', '#fde047'] },
  { id: 'sky', colors: ['#38bdf8', '#60a5fa'] },
  { id: 'violet', colors: ['#8b5cf6', '#6d28d9'] },
  { id: 'peach', colors: ['#fb923c', '#fca5a5'] },
];

export function createFood(id, x, y) {
  return {
    id,
    x,
    y,
    r: 5 + Math.random() * 4,
    hue: Math.floor(Math.random() * 360),
    ring: Math.random() < 0.55,
    tilt: (Math.random() - 0.5) * 1.2, // -0.6..0.6 rad env.
    planet: pickPlanetLabel(),
    rotSpeed: (Math.random() * 0.5 + 0.1) * (Math.random() < 0.5 ? 1 : -1), // ~0.1..0.6 rad/s, random direction
    rotPhase: Math.random() * TAU,
  };
}

function planetScaleForGrowth(name) {
  const s = String(name || '').toLowerCase();
  // Keep these roughly aligned with Renderer._sizeScaleForTexture
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
  return 1.0;
}

function pickPlanetLabel() {
  // Weighted towards smaller bodies to keep variety; adjust as desired
  const options = [
    ['mercury', 8], ['venus', 8], ['earth', 8], ['moon', 10], ['mars', 8],
    ['jupiter', 5], ['saturn', 5], ['uranus', 4], ['neptune', 4], ['sun', 2],
  ];
  const total = options.reduce((a, [,w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [name, w] of options) { if ((r -= w) <= 0) return name; }
  return 'earth';
}

export function createSnake({ id, name, skinId, x, y }) {
  const dir = Math.random() * TAU;
  const head = { x, y };
  const segments = [head];
  for (let i = 1; i < WORLD.minLength; i++) {
    segments.push({ x: x - i * WORLD.segmentSpacing * Math.cos(dir), y: y - i * WORLD.segmentSpacing * Math.sin(dir) });
  }
  return {
    id,
    name,
    skinId,
    colors: ['#ffffff', '#ffffff'], // Force all snakes to be white initially
    color: '#ffffff', // single color rendering
    segments,
    dir,
    targetDir: dir,
    score: 0,
    alive: true,
    boost: false,
    pendingGrowth: 0,
    invulUntil: performance.now() + 3000, // 3s invulnerability at start to reduce early deaths
    isBot: false,
  };
}

export function wrapPosition(entity) {
  // Monde torique
  if (entity.x < 0) entity.x += WORLD.width;
  if (entity.y < 0) entity.y += WORLD.height;
  if (entity.x >= WORLD.width) entity.x -= WORLD.width;
  if (entity.y >= WORLD.height) entity.y -= WORLD.height;
}

export class GameState {
  constructor() {
    this.players = new Map(); // id -> snake
    this.food = new Map(); // id -> food
    this.meId = null;
    this.lastUpdate = performance.now();
    this.gameOver = false;
    this.winnerId = null;
    this.blackHoles = [];
    this.lastCollectedPlanet = null;
    this._spawnQuadrantIndex = 0; // pour répartir les spawns
  }

  // Trouve un point de spawn sûr: loin des autres serpents ET des trous noirs
  getSafeSpawn(samples = 32) {
    // Base quadrant (3x3) tournant pour éviter l'agglutination; avance à chaque appel
    const grid = 3;
    const qi = (this._spawnQuadrantIndex++ % (grid * grid));
    const qx = qi % grid;
    const qy = Math.floor(qi / grid);
    const qW = WORLD.width / grid;
    const qH = WORLD.height / grid;

    let best = { x: (qx + 0.5) * qW, y: (qy + 0.5) * qH, score: -Infinity };
    for (let t = 0; t < samples; t++) {
      const sx = (qx * qW) + (Math.random() * 0.8 + 0.1) * qW;
      const sy = (qy * qH) + (Math.random() * 0.8 + 0.1) * qH;
      // Distance minimale aux têtes des serpents vivants
      let minD2 = Infinity;
      for (const p of this.players.values()) {
        if (!p.segments || !p.segments.length || !p.alive) continue;
        const h = p.segments[0];
        const d2 = dist2(sx, sy, h.x, h.y);
        if (d2 < minD2) minD2 = d2;
      }
      // Distance minimale aux trous noirs (avec échelle)
      let minD2BH = Infinity;
      for (const bh of this.blackHoles) {
        let dx = sx - bh.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
        let dy = sy - bh.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
        const d2 = dx*dx + dy*dy;
        if (d2 < minD2BH) minD2BH = d2;
      }
      // Favorise les points éloignés des joueurs ET BH; booste un peu la dispersion quadrants avec un léger bruit
      const score = Math.min(minD2, minD2BH) * (0.9 + Math.random() * 0.2);
      if (score > best.score) best = { x: sx, y: sy, score };
    }
    return { x: best.x, y: best.y };
  }

  addPlayer(snake) { this.players.set(snake.id, snake); }
  removePlayer(id) { this.players.delete(id); }
  get me() { return this.players.get(this.meId); }

  spawnFoodIfNeeded() {
    while (this.food.size < WORLD.foodCount) {
      const id = uid();
      this.food.set(id, createFood(id, Math.random() * WORLD.width, Math.random() * WORLD.height));
    }
  }

  spawnBlackHolesIfNeeded() {
    // Génération/Regénération: distribution plus uniforme (blue-noise simple)
    if (!this.blackHoles.length || this.blackHoles.length !== WORLD.blackHoleCount) {
      const target = WORLD.blackHoleCount;
      const cells = Math.ceil(Math.sqrt(target * 2)); // grille ~carrée
      const cellW = WORLD.width / cells;
      const cellH = WORLD.height / cells;
      const minDist = Math.min(cellW, cellH) * 0.9; // distance minimale torique
      const holes = [];

      // Construire la liste des cellules et la mélanger (shuffle) pour éviter un remplissage par rangées
      const cellsList = [];
      for (let gy = 0; gy < cells; gy++) for (let gx = 0; gx < cells; gx++) cellsList.push({ gx, gy });
      for (let i = cellsList.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cellsList[i], cellsList[j]] = [cellsList[j], cellsList[i]]; }
      // Parcours des cellules en ordre aléatoire
      let placed = 0;
      for (const c of cellsList) {
        if (placed >= target) break;
        const baseX = c.gx * cellW;
        const baseY = c.gy * cellH;
        // Plusieurs tentatives pour respecter la distance minimale torique
        let ok = false; let candX = 0; let candY = 0;
        for (let t = 0; t < 12 && !ok; t++) {
          candX = (baseX + (Math.random() * 0.8 + 0.1) * cellW) % WORLD.width;
          candY = (baseY + (Math.random() * 0.8 + 0.1) * cellH) % WORLD.height;
          ok = true;
          for (const h of holes) {
            let dx = candX - h.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
            let dy = candY - h.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
            if (dx*dx + dy*dy < minDist * minDist) { ok = false; break; }
          }
        }
        if (ok) {
          holes.push({ x: candX, y: candY, scale: 0.8 + Math.random() * 0.8 });
          placed++;
        }
      }
      // Si pas assez placés (petite grille), compléter par rejets aléatoires avec distance mini
      let safety = 0;
      while (holes.length < target && safety++ < 500) {
        const candX = Math.random() * WORLD.width;
        const candY = Math.random() * WORLD.height;
        let ok = true;
        for (const h of holes) {
          let dx = candX - h.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
          let dy = candY - h.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
          if (dx*dx + dy*dy < minDist * minDist) { ok = false; break; }
        }
        if (ok) holes.push({ x: candX, y: candY, scale: 0.8 + Math.random() * 0.8 });
      }
      this.blackHoles = holes;
    }
    // Si des trous manquent (changement dynamique du count), compléter avec rejets contrôlés
    while (this.blackHoles.length < WORLD.blackHoleCount) {
      const minDist = Math.min(WORLD.width, WORLD.height) / 10;
      let attempts = 0;
      while (attempts++ < 100) {
        const candX = Math.random() * WORLD.width;
        const candY = Math.random() * WORLD.height;
        let ok = true;
        for (const h of this.blackHoles) {
          let dx = candX - h.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
          let dy = candY - h.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
          if (dx*dx + dy*dy < minDist * minDist) { ok = false; break; }
        }
        if (ok) { this.blackHoles.push({ x: candX, y: candY, scale: 0.8 + Math.random() * 0.8 }); break; }
      }
      if (attempts >= 100) {
        // dégradé: placer sans contrainte si impossible
        this.blackHoles.push({ x: Math.random() * WORLD.width, y: Math.random() * WORLD.height, scale: 0.8 + Math.random() * 0.8 });
      }
    }
  }

  killPlayer(snake, killerId = null, cause = 'unknown') {
    snake.alive = false;
    snake.lastDeath = performance.now();
    snake.lastDeathCause = cause;
    // Drop planets on the spot (at head) for the next player to collect
    const head = snake.segments[0] || { x: Math.random() * WORLD.width, y: Math.random() * WORLD.height };
    const drop = Math.min(120, Math.max(12, Math.floor(snake.segments.length))); // many stacked planets
    for (let i = 0; i < drop; i++) {
      const jitter = 4;
      const fx = head.x + (Math.random() * 2 - 1) * jitter;
      const fy = head.y + (Math.random() * 2 - 1) * jitter;
      const id = uid();
      this.food.set(id, createFood(id, fx, fy));
    }
    // Make the snake disappear immediately
    snake.segments = [];
    // Award killer
    if (killerId && this.players.has(killerId)) {
      const killer = this.players.get(killerId);
      killer.score += WORLD.killBonus;
      killer.pendingGrowth += 2; // small extra growth bump
    }

    // Check battle royale winner
    if (WORLD.battleRoyale) {
      const alive = [...this.players.values()].filter(p => p.alive);
      if (alive.length <= 1) {
        this.gameOver = true;
        this.winnerId = alive[0] ? alive[0].id : null;
      }
    }
    // Removed console logging to avoid mobile overlays
  }

  maybeRespawn(snake) {
    if (snake.alive) return;
    if (WORLD.battleRoyale) return; // no respawn in BR mode
    if (performance.now() - snake.lastDeath < WORLD.respawnDelayMs) return;
    // Try to find a safer spawn point away from others AND black holes
    let best = { x: Math.random() * WORLD.width, y: Math.random() * WORLD.height, score: -Infinity };
    for (let t = 0; t < 20; t++) {
      const sx = Math.random() * WORLD.width;
      const sy = Math.random() * WORLD.height;
      // distance to nearest other head
      let minD2 = Infinity;
      for (const other of this.players.values()) {
        if (other === snake || !other.alive || !other.segments.length) continue;
        const d2 = dist2(sx, sy, other.segments[0].x, other.segments[0].y);
        if (d2 < minD2) minD2 = d2;
      }
      // distance to nearest black hole (scaled lethal radius)
      let minD2BH = Infinity;
      for (const bh of this.blackHoles) {
        let dx = sx - bh.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
        let dy = sy - bh.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
        const d2 = dx*dx + dy*dy;
        if (d2 < minD2BH) minD2BH = d2;
      }
      // score combines both distances; weight BH safety strongly
      const score = Math.min(minD2, minD2BH);
      if (score > best.score) best = { x: sx, y: sy, score };
    }
    const x = best.x;
    const y = best.y;
    const skin = SKINS.find(s => s.id === snake.skinId) || SKINS[0];
    const dir = Math.random() * TAU;
    snake.segments = [];
    for (let i = 0; i < WORLD.minLength; i++) {
      snake.segments.push({ x: x - i * WORLD.segmentSpacing * Math.cos(dir), y: y - i * WORLD.segmentSpacing * Math.sin(dir) });
    }
    snake.dir = dir;
    snake.targetDir = dir;
    snake.speed = WORLD.baseSpeed;
    snake.alive = true;
    snake.pendingGrowth = 0;
    // Keep snakes white on respawn as requested
    snake.colors = ['#ffffff', '#ffffff'];
    // Invulnerability window after respawn
    snake.invulUntil = performance.now() + 1500; // 1.5s
    if (snake.isBot) snake.boost = true; // give bots a kick on respawn
  }

  update(dt) {
    // dt en secondes
    this.spawnFoodIfNeeded();
    this.spawnBlackHolesIfNeeded();

    for (const snake of this.players.values()) {
      this.maybeRespawn(snake);
      if (!snake.alive) continue;

      // Vitesse et direction
      const desired = snake.targetDir;
      if (snake.isBot) {
        // Bots: orientation instantanée (inchangé)
        if (Number.isFinite(desired)) {
          snake.dir = ((desired % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        }
      } else {
        // Joueur: orientation instantanée et robuste (supprime l'oscillation)
        const fallback = Number.isFinite(snake.lastDir) ? snake.lastDir : (Number.isFinite(snake.dir) ? snake.dir : 0);
        const nextDir = Number.isFinite(desired) ? desired : fallback;
        const norm = ((nextDir % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        snake.dir = norm;
        snake.lastDir = norm;
      }
      const v = vecFromAngle(snake.dir);
      const speed = snake.boost ? WORLD.boostSpeed : WORLD.baseSpeed;

      // Avancer la tête
      const head = snake.segments[0];
      const newHead = { x: head.x + v.x * speed * dt, y: head.y + v.y * speed * dt };

      // Bot failsafe: small random steering to avoid spinning/stall
      if (snake.isBot) {
        snake._steerAcc = (snake._steerAcc || 0) + dt;
        // track movement
        const lx = snake._lastX ?? head.x;
        const ly = snake._lastY ?? head.y;
        const moved = Math.hypot(newHead.x - lx, newHead.y - ly);
        snake._lastX = newHead.x;
        snake._lastY = newHead.y;
        if (snake._steerAcc > 0.7) {
          // periodic tiny nudge
          snake.targetDir += (Math.random() - 0.5) * 0.4; // ~±0.2 rad
          snake._steerAcc = 0;
        }
        if (moved < 10 * dt) {
          // very small movement: stronger nudge and occasional boost
          snake.targetDir += (Math.random() - 0.5) * 0.9; // ~±0.45 rad
          if (Math.random() < 0.2) snake.boost = true;
        }

        // Strong failsafe: if movement remains low for a while, force a big direction change + boost
        const now = performance.now();
        snake._stuckDur = (snake._stuckDur || 0) + (moved < 8 * dt ? dt : -dt * 0.5);
        if (snake._stuckDur < 0) snake._stuckDur = 0;
        const coolPassed = !snake._strongCooldownTs || (now - snake._strongCooldownTs > 2500);
        if (snake._stuckDur > 1.2 && coolPassed) {
          snake.targetDir += (Math.random() - 0.5) * 2.4; // ~±1.2 rad
          snake.boost = true;
          snake._strongCooldownTs = now;
          snake._stuckDur = 0;
          // schedule boost release ~0.8s later via a soft flag (checked each update)
          snake._boostUntil = now + 800;
        }
        if (snake._boostUntil && now > snake._boostUntil) {
          snake.boost = false;
          snake._boostUntil = 0;
        }
        // (drift removed) — rely on goal seeking and failsafes only
      }

      // Attraction des trous noirs désactivée: pas de force de traction appliquée

      wrapPosition(newHead);

      // Insérer la nouvelle tête et reculer les segments
      snake.segments.unshift(newHead);
      let targetLength = Math.max(WORLD.minLength, Math.floor(snake.score / 50) + WORLD.minLength);
      targetLength += snake.pendingGrowth;
      while (snake.segments.length > targetLength) snake.segments.pop();

      // Collision nourriture (collecte d'IDs à supprimer pour éviter la mutation pendant l'itération)
      const toDelete = [];
      for (const [fid, f] of this.food) {
        // gérer wrap-sensing en monde torique via distances simples (approx)
        // Augmenter la distance de collecte (r² = 900 pour un rayon effectif de 30px)
        if (dist2(newHead.x, newHead.y, f.x, f.y) < 900) {
          toDelete.push(fid);
          const scale = planetScaleForGrowth(f.planet);
          const growth = Math.max(1, Math.round(scale * 2));
          const bonus = Math.max(1, Math.round(WORLD.foodValue * scale));
          snake.score += bonus;
          snake.pendingGrowth += growth;
          this.lastCollectedPlanet = f.planet || 'unknown';
          // Removed console logging to avoid mobile overlays
        }
      }
      for (const fid of toDelete) this.food.delete(fid);
    }

    // Collisions entre serpents (tête contre corps d'autrui)
    const nowTs = performance.now();
    for (const a of this.players.values()) {
      if (!a.alive) continue;
      const aInvul = nowTs < (a.invulUntil || 0);
      const head = a.segments[0];
      const headR = 10;

      for (const b of this.players.values()) {
        if (!b.alive) continue;
        // Pas d'élimination sur son propre corps: ignorer totalement a === b
        if (a === b) continue;
        // If attacker is invulnerable, skip collisions
        if (aInvul) continue;
        const start = 1;
        for (let i = start; i < b.segments.length; i++) {
          const seg = b.segments[i];
          const r = 7; // slightly smaller body radius to reduce false positives
          if (dist2(head.x, head.y, seg.x, seg.y) < (headR + r) * (headR + r)) {
            this.killPlayer(a, b.id, 'snake_collision');
            break;
          }
        }
        if (!a.alive) break;
      }
    }

    // Collision avec les trous noirs (event horizon létal)
    const tsNow = performance.now();
    for (const a of this.players.values()) {
      if (!a.alive) continue;
      const head = a.segments[0];
      const invul = tsNow < (a.invulUntil || 0);
      for (const bh of this.blackHoles) {
        let dx = head.x - bh.x;
        let dy = head.y - bh.y;
        if (dx > WORLD.width / 2) dx -= WORLD.width; else if (dx < -WORLD.width / 2) dx += WORLD.width;
        if (dy > WORLD.height / 2) dy -= WORLD.height; else if (dy < -WORLD.height / 2) dy += WORLD.height;
        const scale = bh.scale || 1;
        const lethalR = WORLD.bhEventHorizon * scale;
        if (!invul && dx*dx + dy*dy < lethalR * lethalR) {
          this.killPlayer(a, null, 'black_hole');
          break;
        }
      }
    }
  }
}
