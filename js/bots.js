// bots.js – simulation multijoueur locale (IA simples)
import { TAU, angleBetween, dist2, randRange, uid, vecFromAngle } from './utils.js';
import { WORLD, createSnake } from './game.js';

export class BotManager {
  constructor(state) {
    this.state = state;
  }

  ensureBots(count = WORLD.maxBots) {
    let bots = 0;
    for (const s of this.state.players.values()) if (s.isBot) bots++;
    const NAMES = ['Léo','Mia','Noah','Lina','Eli','Nora','Zoe','Liam','Ava','Milo','Enzo','Léa','Sacha','Emma','Noé','Luna','Maé','Tom','Nina','Yanis','Chloé','Axel','Iris','Nolan','Lola','Maya','Ethan','Jade','Yuna','Adam'];
    while (bots < count) {
      const id = uid();
      // Utiliser le spawn sûr et réparti du GameState (quadrants + distances)
      const safe = this.state.getSafeSpawn ? this.state.getSafeSpawn(64) : { x: Math.random() * WORLD.width, y: Math.random() * WORLD.height };
      const name = NAMES[Math.floor(Math.random() * NAMES.length)];
      const snake = createSnake({ id, name, skinId: randomSkin(), x: safe.x, y: safe.y });
      snake.isBot = true;
      snake.score = Math.floor(randRange(0, 300));
      snake.targetDir = Math.random() * TAU;
      snake.lastMoveTime = performance.now();
      snake.invulUntil = performance.now() + 4000; // 4s spawn protection
      snake.boost = true; // start moving immediately
      this.state.addPlayer(snake);
      bots++;
    }
  }

  setCount(count) {
    // Add if fewer
    this.ensureBots(count);
    // Remove if more
    const botIds = [...this.state.players.values()].filter(s => s.isBot).map(s => s.id);
    while (botIds.length > count) {
      const id = botIds.pop();
      this.state.removePlayer(id);
    }
  }

  update(dt) {
    const players = [...this.state.players.values()].filter(s => s.alive);
    for (const bot of players) {
      if (!bot.isBot) continue;

      const head = bot.segments[0];
      
      // Force movement if bot hasn't moved recently
      const currentTime = performance.now();
      if (!bot.lastPosition) bot.lastPosition = { x: head.x, y: head.y, time: currentTime };
      
      const dist = Math.hypot(head.x - bot.lastPosition.x, head.y - bot.lastPosition.y);
      const timeSinceLastPos = currentTime - bot.lastPosition.time;
      
      if (timeSinceLastPos > 1000 && dist < 50) { // stuck for 1s and barely moved
        bot.targetDir = Math.random() * TAU;
        bot.boost = true; // force boost to break free
        bot.lastPosition = { x: head.x, y: head.y, time: currentTime };
      } else if (dist > 20) { // moved significantly
        bot.lastPosition = { x: head.x, y: head.y, time: currentTime };
        bot.boost = false;
      }

      // 1) Évitement des trous noirs renforcé (torique)
      let avoidDir = null;
      let avoidWeight = 0;
      let immediateEscape = false;
      if (this.state.blackHoles && this.state.blackHoles.length) {
        let nearest = null; let nd2 = Infinity; let nearestScale = 1;
        for (const bh of this.state.blackHoles) {
          let dx = bh.x - head.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
          let dy = bh.y - head.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
          const d2 = dx*dx + dy*dy;
          if (d2 < nd2) { nd2 = d2; nearest = { dx, dy, d2 }; nearestScale = (bh.scale || 1); }
        }
        if (nearest) {
          const d = Math.max(1, Math.sqrt(nearest.d2));
          const lethal = WORLD.bhEventHorizon * nearestScale;
          const danger = lethal * 2.0;
          const away = Math.atan2(-nearest.dy, -nearest.dx);
          if (d < danger) {
            // Fuite immédiate si trop proche
            avoidDir = away;
            avoidWeight = 1.0;
            immediateEscape = true;
          } else if (nearest.d2 < WORLD.bhInfluence * WORLD.bhInfluence) {
            // Évitement prioritaire, plus fort qu'avant
            const influence = WORLD.bhInfluence;
            const w = Math.min(0.85, Math.max(0, (influence - d) / influence));
            avoidDir = away;
            avoidWeight = Math.sqrt(w); // courbe douce mais élevée
          }
        }
      }

      // 2) Ciblage offensif: attaquer d'autres serpents (y compris le joueur)
      let attackDir = null;
      let attackWeight = 0;
      {
        let bestTarget = null; let bestScore = -Infinity;
        for (const other of players) {
          if (other === bot) continue;
          const oHead = other.segments[0]; if (!oHead) continue;
          // delta toroïde
          let dx = oHead.x - head.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
          let dy = oHead.y - head.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
          const d2 = dx*dx + dy*dy;
          const d = Math.max(1, Math.sqrt(d2));
          // Éviter d'attaquer trop près d'un trou noir
          let nearBH = false;
          if (this.state.blackHoles && this.state.blackHoles.length) {
            for (const bh of this.state.blackHoles) {
              let bdx = oHead.x - bh.x; if (bdx > WORLD.width/2) bdx -= WORLD.width; else if (bdx < -WORLD.width/2) bdx += WORLD.width;
              let bdy = oHead.y - bh.y; if (bdy > WORLD.height/2) bdy -= WORLD.height; else if (bdy < -WORLD.height/2) bdy += WORLD.height;
              const sc = (bh.scale || 1); const safeR = (WORLD.bhEventHorizon * sc) * 2.0;
              if (bdx*bdx + bdy*bdy < safeR*safeR) { nearBH = true; break; }
            }
          }
          // Score: proximité (plus proche = mieux), pénalité proche BH, bonus si c'est le joueur
          const isPlayer = (this.state.me && other.id === this.state.me.id) ? 1 : 0;
          const score = (800 / d) - (nearBH ? 300 : 0) + (isPlayer ? 120 : 0);
          if (score > bestScore) { bestScore = score; bestTarget = { other, dx, dy, d }; }
        }
        if (bestTarget) {
          // Interception basique: viser légèrement en avant de la tête adverse
          const lead = 22;
          const dirTo = Math.atan2(bestTarget.dy, bestTarget.dx);
          attackDir = dirTo + randRange(-0.05, 0.05);
          attackWeight = Math.min(0.65, 400 / Math.max(60, bestTarget.d));
        }
      }

      // 3) Persistent goal: cluster centroid of nearby food (torus-aware)
      bot._retargetAcc = (bot._retargetAcc || 0) + dt;
      const needRetarget = !bot._goal || bot._retargetAcc > 0.25;
      if (needRetarget) {
        bot._retargetAcc = 0;
        // collect nearby foods and compute centroid weighted by 1/d2
        let sx = 0, sy = 0, wsum = 0;
        let closest = null; let closestD2 = Infinity; let cdx = 0, cdy = 0;
        const R = 240; const R2 = R*R;
        let denseCount = 0; let denseCx = 0; let denseCy = 0;
        for (const f of this.state.food.values()) {
          let dx = f.x - head.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
          let dy = f.y - head.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
          const d2 = dx*dx + dy*dy;
          if (d2 < closestD2) { closestD2 = d2; closest = { dx, dy }; }
          if (d2 < R2) {
            // Pénaliser la nourriture proche d'un trou noir pour éviter d'y conduire les bots
            let bhPenalty = 1;
            if (this.state.blackHoles && this.state.blackHoles.length) {
              for (const bh of this.state.blackHoles) {
                let bdx = f.x - bh.x; if (bdx > WORLD.width/2) bdx -= WORLD.width; else if (bdx < -WORLD.width/2) bdx += WORLD.width;
                let bdy = f.y - bh.y; if (bdy > WORLD.height/2) bdy -= WORLD.height; else if (bdy < -WORLD.height/2) bdy += WORLD.height;
                const bd2 = bdx*bdx + bdy*bdy;
                const sc = (bh.scale || 1);
                const safeR = (WORLD.bhEventHorizon * sc) * 2.5; // marge de sécurité
                if (bd2 < safeR * safeR) { bhPenalty *= 0.1; break; } // fuir cette cible
              }
            }
            const w = (1 / Math.max(64, d2)) * bhPenalty; // pondération pénalisée
            sx += dx * w;
            sy += dy * w;
            wsum += w;
            if (d2 < 80*80) { denseCount++; denseCx += dx; denseCy += dy; }
          }
        }
        if (denseCount >= 8) {
          // Prioritize loot pile: lock for 0.8s
          bot._goal = { gx: head.x + denseCx/Math.max(1,denseCount), gy: head.y + denseCy/Math.max(1,denseCount), lockedUntil: performance.now() + 800 };
        } else if (wsum > 0.0001) {
          bot._goal = { gx: head.x + sx/wsum, gy: head.y + sy/wsum };
        } else if (closest) {
          bot._goal = { gx: head.x + closest.dx, gy: head.y + closest.dy };
        } else {
          bot._goal = null;
        }
      }

      let desiredDir = bot.targetDir;
      // Préférence: si un évitement immédiat est requis, on s'éloigne d'abord
      if (bot._goal) {
        // aim at goal with small noise
        let dx = bot._goal.gx - head.x; if (dx > WORLD.width/2) dx -= WORLD.width; else if (dx < -WORLD.width/2) dx += WORLD.width;
        let dy = bot._goal.gy - head.y; if (dy > WORLD.height/2) dy -= WORLD.height; else if (dy < -WORLD.height/2) dy += WORLD.height;
        desiredDir = Math.atan2(dy, dx) + randRange(-0.03, 0.03);
      } else {
        // Gentle wandering as fallback
        desiredDir = bot.targetDir + randRange(-0.35, 0.35) * dt;
      }

      // 4) Mélange: attaque
      if (attackDir !== null && !immediateEscape) {
        const delta = Math.atan2(Math.sin(attackDir - desiredDir), Math.cos(attackDir - desiredDir));
        desiredDir = desiredDir + delta * attackWeight;
        // léger boost en mode attaque
        if (Math.random() < 0.15) bot.boost = true;
      }

      // 5) Blend avoidance si besoin
      if (avoidDir !== null) {
        // limiter: si l'évitement détourne fortement du but (>90°), réduire encore l'influence
        const goalDelta = Math.abs(Math.atan2(Math.sin(avoidDir - desiredDir), Math.cos(avoidDir - desiredDir)));
        let w = immediateEscape ? 1.0 : Math.min(0.85, avoidWeight); // fuite prioritaire si danger proche
        if (goalDelta > Math.PI/2 && !immediateEscape) w *= 0.5; // demi-poids si ça va clairement à l'opposé du but
        const delta = Math.atan2(Math.sin(avoidDir - desiredDir), Math.cos(avoidDir - desiredDir));
        desiredDir = desiredDir + delta * w;
      }

      // Respect goal lock (si défini et non expiré)
      if (bot._goal && bot._goal.lockedUntil) {
        if (performance.now() > bot._goal.lockedUntil) delete bot._goal.lockedUntil;
      }

      // Ensure finite direction; if not, randomize
      if (!Number.isFinite(desiredDir)) desiredDir = Math.random() * TAU;
      bot.targetDir = desiredDir;

      // Force boost more often to ensure movement
      if (!bot.boost) bot.boost = Math.random() < 0.05;

      // 6) Failsafe ultime: aucune immobilité prolongée
      bot._stuck2 = (bot._stuck2 || 0) + dt;
      if (bot._stuck2 > 2.0 && bot.lastPosition) {
        const moved2 = Math.hypot(head.x - bot.lastPosition.x, head.y - bot.lastPosition.y);
        if (moved2 < 40) {
          bot.targetDir = Math.random() * TAU;
          bot.boost = true;
          bot._stuck2 = 0;
        }
      }
    }
  }
}

function randomSkin() {
  const ids = ['aqua','neon','lime','sun','rose','mint','gold','sky','violet','peach'];
  return ids[Math.floor(Math.random() * ids.length)];
}
