// main.js – point d'entrée de l'application
import { GameState, WORLD, createSnake, SKINS } from './game.js';
import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { BotManager } from './bots.js';
import { initCustomization } from './ui.js';
import { now, uid, angleBetween, dist2Torus } from './utils.js';

const canvas = document.getElementById('game');
// Make the canvas focusable to ensure reliable keyboard input capture
canvas.tabIndex = 0;
canvas.addEventListener('click', () => canvas.focus());
const state = new GameState();
const renderer = new Renderer(canvas, state);
const input = new Input(canvas);
const bots = new BotManager(state);

// Mise à jour du classement dans le jeu
const leaderboardElement = document.getElementById('leaderboard');

const updateLeaderboard = (players) => {
  if (!leaderboardElement) return;
  
  try {
    // Vérifier que players est une Map ou un objet itérable
    const playersMap = players instanceof Map ? players : 
                      (players && typeof players[Symbol.iterator] === 'function') ? 
                      new Map(Array.isArray(players) ? players.map((p, i) => [i, p]) : Object.entries(players)) : 
                      new Map();
    
    // Convertir en tableau d'objets avec les données nécessaires
    const playersArray = [];
    playersMap.forEach((player, id) => {
      if (player) {
        // Utiliser la longueur des segments comme score si size n'est pas défini
        const score = player.segments ? player.segments.length : 0;
        playersArray.push({
          id: id,
          name: player.name || 'Joueur',
          size: score,
          isMe: state.me && id === state.me.id
        });
      }
    });
    
    // Trier les joueurs par score (du plus grand au plus petit)
    const sortedPlayers = playersArray.sort((a, b) => b.size - a.size);
    
    // Mettre à jour l'affichage
    leaderboardElement.innerHTML = '';
    
    // Afficher les 10 premiers joueurs
    const topPlayers = sortedPlayers.slice(0, 10);
    
    topPlayers.forEach((player, index) => {
      if (!player) return;
      
      const li = document.createElement('li');
      const rank = index + 1;
      const score = Math.floor(player.size || 0);
      const name = player.name || 'Joueur';
      
      li.setAttribute('data-rank', rank);
      if (player.isMe) {
        li.setAttribute('data-is-me', 'true');
      }
      
      // Créer un élément span pour le nom et le score
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${name}: ${score}`;
      
      // Ajouter le span au li
      li.appendChild(nameSpan);
      leaderboardElement.appendChild(li);
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du classement:', error);
  }
};
// Enable continuous mouse aim by default (panel toggle is hidden now)
input.mouseAimEnabled = true;

// DOM refs used across the file (declare early)
const pauseBtn = document.getElementById('pauseBtn');
const overlayActions = document.getElementById('overlayActions');
const customModal = document.getElementById('customModal');
const modalStartBtn = document.getElementById('modalStartBtn');
// Settings panel elements (some may be hidden now but keep for compatibility)
const brToggle = document.getElementById('brToggle');
const botsRange = document.getElementById('botsRange');
const botsValue = document.getElementById('botsValue');
const miniRange = document.getElementById('miniRange');
const miniValue = document.getElementById('miniValue');
const mouseAimToggle = document.getElementById('mouseAimToggle');
const replayBtn = document.getElementById('replayBtn');
const zoneToggle = document.getElementById('zoneToggle');
const quickDuelBtn = document.getElementById('quickDuelBtn');
const replayTopBtn = document.getElementById('replayTopBtn');
const keySensRange = document.getElementById('keySensRange');
const keySensValue = document.getElementById('keySensValue');
const texToggle = document.getElementById('texToggle');

// Simple error overlay to surface runtime issues
const errorBox = document.createElement('div');
errorBox.style.position = 'fixed';
errorBox.style.zIndex = '9999';
errorBox.style.right = '8px';
errorBox.style.bottom = '8px';
errorBox.style.maxWidth = '48vw';
errorBox.style.background = 'rgba(255, 77, 109, .12)';
errorBox.style.border = '1px solid rgba(255, 77, 109, .6)';
errorBox.style.backdropFilter = 'blur(6px)';
errorBox.style.padding = '8px 12px';
errorBox.style.borderRadius = '8px';
errorBox.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
errorBox.style.fontSize = '12px';
errorBox.style.color = '#ffdfe6';
errorBox.style.display = 'none';
errorBox.style.pointerEvents = 'none';
document.body.appendChild(errorBox);

function showError(msg) {
  errorBox.style.display = 'block';
  const time = new Date().toLocaleTimeString();
  errorBox.textContent = `[${time}] ${msg}`;
}

window.addEventListener('error', (e) => {
  showError(e.message || String(e.error || 'Erreur inconnue'));
});

// (moved below element declarations)

window.addEventListener('unhandledrejection', (e) => {
  showError(e.reason ? (e.reason.message || String(e.reason)) : 'Unhandled rejection');
});

// Initial UI values
state.playerName = 'Joueur';
state.selectedSkinId = 'rose'; // rouge par défaut
state.paused = false;
state.zone = { enabled: false, cx: WORLD.width / 2, cy: WORLD.height / 2, r: Math.max(WORLD.width, WORLD.height) * 0.5, shrinkRate: 0 }; // zone disabled by default
// Init customization in side panel
initCustomization(state);
// Init customization in modal (IDs spécifiques)
initCustomization(state, { nameInputId: 'nameInputModal', skinPickerId: 'skinPickerModal' });

// Ensure black holes exist before spawning anyone (safe spawn uses them)
state.spawnBlackHolesIfNeeded();

// Créer mon joueur avec un spawn sûr et réparti
const myId = uid();
state.meId = myId;
const safeMe = state.getSafeSpawn?.(48) || { x: Math.random() * WORLD.width, y: Math.random() * WORLD.height };
const me = createSnake({ id: myId, name: state.playerName, skinId: state.selectedSkinId, x: safeMe.x, y: safeMe.y });
// Couleur du joueur selon skin (rouge par défaut)
try {
  const skin = (SKINS || []).find(s => s.id === state.selectedSkinId);
  me.color = (skin && (skin.colors?.[1] || skin.colors?.[0])) || '#ef4444';
} catch { me.color = '#ef4444'; }
state.addPlayer(me);
// Bots
bots.ensureBots();

// Leaderboard initial
if (state.players) {
  updateLeaderboard(state.players);
}

// Entrées et respawn
window.addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P') {
    togglePause();
  }
});

// Debug HUD removed per user request

// Boucle de jeu
let last = now();
let accTime = 0;
let frames = 0;
let fps = 60;
let lbAcc = 0; // leaderboard update accumulator

function loop() {
  try {
    const t = now();
    const dt = Math.min(0.05, (t - last) / 1000); // clamp dt max 50ms
    last = t;

    // Overlay handling (pause / game over / eliminated)
    const overlay = document.getElementById('overlay');
    const overlayText = document.getElementById('overlayText');
    if (state.gameOver) {
      const winner = state.players.get(state.winnerId);
      overlayText.textContent = winner ? `Victoire: ${winner.name}` : 'Partie terminée';
      overlay.hidden = false;
      overlayActions.hidden = false;
      if (customModal) customModal.hidden = true;
    } else if (state.paused) {
      // En pause: afficher la modale de personnalisation avec bouton "Reprendre"
      overlay.hidden = true;
      overlayActions.hidden = true;
      if (customModal) {
        const btn = document.getElementById('modalStartBtn');
        if (btn) btn.textContent = 'Reprendre';
        customModal.hidden = false;
      }
    } else if (state.me && !state.me.alive) {
      overlayText.textContent = 'Éliminé';
      overlay.hidden = false;
      // In Battle Royale, allow replay even if others still alive
      overlayActions.hidden = WORLD.battleRoyale ? false : true;
      if (customModal) customModal.hidden = true;
    } else {
      overlay.hidden = true;
      overlayActions.hidden = true;
      if (customModal) customModal.hidden = true;
    }

    const effectiveDt = (state.paused || state.gameOver) ? 0 : dt;
    // Mettre à jour le timer de burst de boost
    input.updateBoostTimer?.();

    // Mise à jour direction/boost du joueur local à partir des entrées
    const me = state.me;
    if (me) {
      // Mouse aim prioritaire en continu quand actif
      if (input.mouseAimEnabled && input.mouseActive && renderer.screenToWorld) {
        const head = me.segments[0];
        const worldPos = renderer.screenToWorld(input.mouseX || 0, input.mouseY || 0);
        
        if (Number.isFinite(worldPos.x) && Number.isFinite(worldPos.y)) {
          // Calcul direct de l'angle sans seuil ni lissage
          // pour éviter tout effet de bord qui pourrait causer des oscillations
          const targetAngle = angleBetween(head.x, head.y, worldPos.x, worldPos.y);
          
          // Mise à jour directe de la direction
          // Sans vérification de distance minimale qui pourrait causer des problèmes
          if (Number.isFinite(targetAngle)) {
            me.targetDir = targetAngle;
          }
        }
      } else {
        // Keyboard fallback with smooth steering
        input.updateFromKeyboard(dt, me.targetDir);
        if (Number.isFinite(input.targetDir)) {
          me.targetDir = input.targetDir;
        }
      }
      me.boost = !!input.boost;
    }

    // Update bots
    if (!state.paused && !state.gameOver) bots.update(effectiveDt);

    // Update game state
    if (!state.paused && !state.gameOver) state.update(effectiveDt);

    // Zone shrinking and elimination disabled

    // Render
    renderer.render(effectiveDt, fps);
    
    // Mettre à jour le classement à chaque frame
    if (state.players && state.players.size > 0) {
      updateLeaderboard(state.players);
    }

    // Update Zone percentage in topbar
    const zonePctEl = document.getElementById('zonePct');
    if (zonePctEl && state.zone) {
      const r0 = Math.max(WORLD.width, WORLD.height) * 0.5;
      const pct = Math.max(0, Math.min(100, Math.round((state.zone.r / r0) * 100)));
      zonePctEl.textContent = `${pct}%`;
    }

    // Debug HUD removed

    // fps simple
    frames++;
    accTime += dt;
    if (accTime >= 0.5) {
      fps = Math.round(frames / accTime);
      frames = 0;
      accTime = 0;
    }
  } catch (err) {
    showError(err && err.message ? err.message : String(err));
  } finally {
    requestAnimationFrame(loop);
  }
}

// Montrer la modale au démarrage et connecter son bouton
if (customModal) {
  customModal.hidden = false;
  state.paused = true;
  pauseBtn && pauseBtn.setAttribute('aria-pressed', 'true');
}
// (modalStartBtn wiring defined once above)

 

// Boutons de mode rapides
const modeBtnBR = document.getElementById('modeBtnBR');
const modeBtnDuelRespawn = document.getElementById('modeBtnDuelRespawn');
function resetAllScores(state) {
  // Remise à zéro des scores et longueur de tous les joueurs
  for (const player of state.players.values()) {
    player.score = 0;
    player.pendingGrowth = 0;
    // Réinitialiser la longueur du serpent
    if (player.segments && player.segments.length > WORLD.minLength) {
      // Garder uniquement les premiers segments (tronçon initial)
      player.segments = player.segments.slice(0, WORLD.minLength);
    }
  }
}

function applyCommonStart() {
  // Réinitialisation des scores AVANT de commencer
  resetAllScores(state);
  
  // Appliquer nom/skin au serpent contrôlé
  if (state.me) {
    state.me.name = state.playerName || state.me.name;
    state.me.skinId = state.selectedSkinId || state.me.skinId;
    try {
      const skin = (SKINS || []).find(s => s.id === state.selectedSkinId);
      state.me.color = (skin && (skin.colors?.[1] || skin.colors?.[0])) || state.me.color;
    } catch {}
  }
  if (customModal) customModal.hidden = true;
  state.paused = false;
  pauseBtn && pauseBtn.setAttribute('aria-pressed', 'false');
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.hidden = true;
  canvas.focus();
  if (state.players) {
    updateLeaderboard(state.players);
  }
}
if (modeBtnBR) {
  modeBtnBR.addEventListener('click', (e) => {
    e.preventDefault();
    WORLD.battleRoyale = true;
    // Option Duel rapide: peu de bots, beaucoup de nourriture
    try {
      // Ajustements rapides (restent en mémoire runtime)
      // Ici on garde maxBots existant; tu peux me dire si tu veux le forcer à 2
    } catch {}
    applyCommonStart();
  });
}
if (modeBtnDuelRespawn) {
  modeBtnDuelRespawn.addEventListener('click', (e) => {
    e.preventDefault();
    WORLD.battleRoyale = false;
    applyCommonStart();
  });
}

// Pause & control switching controls
function togglePause() {
  state.paused = !state.paused;
  if (pauseBtn) pauseBtn.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
}
if (pauseBtn) pauseBtn.addEventListener('click', togglePause);

// Changer de serpent contrôlé: bascule sur le prochain vivant (C ou Tab)
function switchControlledSnake(direction = 1) {
  const arr = [...state.players.values()].filter(p => p.alive);
  if (!state.me || arr.length <= 1) return;
  const idx = arr.findIndex(p => p.id === state.me.id);
  if (idx === -1) return;
  const next = arr[(idx + direction + arr.length) % arr.length];
  if (!next || next.id === state.me.id) return;
  // Laisser l’actuel redevenir bot si c’était le joueur
  const cur = state.me;
  cur.isBot = true;
  // Prendre le contrôle du suivant
  next.isBot = false;
  state.meId = next.id;
  // Appliquer le nom choisi au nouveau serpent
  next.name = state.playerName || next.name || 'Joueur';
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C' || e.key === 'Tab') {
    e.preventDefault();
    switchControlledSnake(1);
  }
});

// Settings wiring (listeners only; elements defined at top)

// Keyboard sensitivity
if (keySensRange && keySensValue) {
  const apply = () => {
    keySensValue.textContent = keySensRange.value;
    const v = parseInt(keySensRange.value, 10);
    input.keyboardTurnRate = 2.0 + (v - 1) * (6.0 / 9.0);
  };
  keySensRange.addEventListener('input', apply);
  apply();
}

// Online textures toggle
if (texToggle) {
  const applyTex = () => { renderer.useOnlineTextures = texToggle.checked; }
  texToggle.addEventListener('change', applyTex);
  applyTex();
}

if (brToggle) {
  brToggle.addEventListener('change', () => {
    WORLD.battleRoyale = brToggle.checked;
  });
  brToggle.checked = true;
  WORLD.battleRoyale = true;
}
if (botsRange) {
  botsRange.addEventListener('input', () => {
    botsValue.textContent = botsRange.value;
  });
  botsRange.addEventListener('change', () => {
    bots.setCount(parseInt(botsRange.value, 10));
  });
}
if (miniRange) {
  miniRange.addEventListener('input', () => {
    miniValue.textContent = miniRange.value;
    renderer.minimapSize = parseInt(miniRange.value, 10);
  });
  renderer.minimapSize = parseInt(miniRange.value, 10);
}
if (mouseAimToggle) {
  mouseAimToggle.addEventListener('change', () => {
    input.mouseAimEnabled = mouseAimToggle.checked;
  });
  // Par défaut activer le contrôle souris continu
  input.mouseAimEnabled = mouseAimToggle.checked ?? true;
}
if (replayBtn) replayBtn.addEventListener('click', resetGame);
if (replayTopBtn) replayTopBtn.addEventListener('click', resetGame);
if (zoneToggle) {
  // Disable by default
  zoneToggle.checked = false;
  zoneToggle.addEventListener('change', () => {
    if (!state.zone) state.zone = { enabled: false, cx: WORLD.width / 2, cy: WORLD.height / 2, r: Math.max(WORLD.width, WORLD.height) * 0.5, shrinkRate: 0 };
    // Only toggles visual drawing via drawZone(); elimination is fully disabled
    state.zone.enabled = zoneToggle.checked;
  });
}
if (quickDuelBtn) quickDuelBtn.addEventListener('click', () => {
  // Preset: Duel rapide
  WORLD.battleRoyale = true;
  WORLD.killBonus = 80;
  WORLD.foodCount = 500;
  botsRange && (botsRange.value = '2');
  botsValue && (botsValue.textContent = '2');
  bots.setCount(2);
  // Zone disabled in this mode as requested
  if (!state.zone) state.zone = { enabled: false, cx: WORLD.width / 2, cy: WORLD.height / 2, r: Math.max(WORLD.width, WORLD.height) * 0.5, shrinkRate: 0 };
  state.zone.enabled = false;
  state.zone.shrinkRate = 0;
  zoneToggle && (zoneToggle.checked = false);
  // Repartir une manche
  resetGame();
});

function resetGame() {
  // Reset state to a fresh match
  state.gameOver = false;
  state.winnerId = null;
  state.food.clear();
  // Reset zone radius to initial if enabled
  if (state.zone) {
    state.zone.cx = WORLD.width / 2;
    state.zone.cy = WORLD.height / 2;
    state.zone.r = Math.max(WORLD.width, WORLD.height) * 0.5;
  }
  // Keep your preferences/players list but revive everyone at new spawn
  for (const s of state.players.values()) {
    s.alive = true;
    s.colors = ['#ffffff', '#ffffff']; // Force all snakes white on reset
    s.color = '#ffffff'; // single color
    s.score = 0;
    s.pendingGrowth = 0;
    s.lastDeath = 0;
    const safe = state.getSafeSpawn?.(48) || { x: Math.random() * WORLD.width, y: Math.random() * WORLD.height };
    const x = safe.x;
    const y = safe.y;
    const dir = Math.random() * Math.PI * 2;
    s.segments = [];
    for (let i = 0; i < WORLD.minLength; i++) {
      s.segments.push({ x: x - i * WORLD.segmentSpacing * Math.cos(dir), y: y - i * WORLD.segmentSpacing * Math.sin(dir) });
    }
    s.dir = dir;
    s.targetDir = dir;
    s.invulUntil = performance.now() + 1000;
    // Ensure bots have movement tracking
    if (s.isBot) {
      s.lastPosition = { x, y, time: performance.now() };
    }
  }
  bots.ensureBots(parseInt(botsRange?.value || WORLD.maxBots, 10));
  overlayActions.hidden = true;
}


// Adapter le canvas à son conteneur
function resizeCanvasToContainer() {
  const parent = canvas.parentElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}
resizeCanvasToContainer();

// Indication de mode réseau
const netModeEl = document.getElementById('netMode');
if (netModeEl) netModeEl.textContent = 'Hors-ligne (simulation locale)';

requestAnimationFrame(loop);
