// input.js – gestion des entrées clavier et tactiles (joystick), boost
import { angleBetween } from './utils.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.targetDir = 0; // radians
    this.boost = false;

    this.keys = new Set();
    // Mouse aiming
    this.mouseActive = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseLeftDown = false;
    this.mouseRightDown = false;
    // Gestion du burst de boost sur n'importe quelle touche
    this._boostBurstUntil = 0;

    // Clavier (sur document pour capter de façon fiable)
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));
    // Nettoyer les touches appuyées lorsque la fenêtre perd le focus
    window.addEventListener('blur', () => { this.keys.clear(); this.boost = false; });

    // Tactile: joystick
    this.joystick = document.getElementById('joystick');
    this.stick = this.joystick ? this.joystick.querySelector('.stick') : null;
    this.activeTouchId = null;

    const js = this.joystick;
    if (js) {
      js.addEventListener('pointerdown', (e) => { try { e.preventDefault(); this.onJoyStart(e); } catch (_) {} }, { passive: false });
      js.addEventListener('pointermove', (e) => { try { e.preventDefault(); this.onJoyMove(e); } catch (_) {} }, { passive: false });
      js.addEventListener('pointerup',   (e) => { try { e.preventDefault(); this.onJoyEnd(); } catch (_) {} }, { passive: false });
      js.addEventListener('pointercancel', (e) => { try { e.preventDefault(); this.onJoyEnd(); } catch (_) {} }, { passive: false });
    }

    // Bouton boost
    this.boostBtn = document.getElementById('boostBtn');
    if (this.boostBtn) {
      this.boostBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.boost = true; }, { passive: false });
      this.boostBtn.addEventListener('pointerup',   (e) => { e.preventDefault(); this.boost = false; }, { passive: false });
      this.boostBtn.addEventListener('pointerleave',(e) => { e.preventDefault(); this.boost = false; }, { passive: false });
      this.boostBtn.addEventListener('pointercancel',(e) => { e.preventDefault(); this.boost = false; }, { passive: false });
    }

    // Gestion simplifiée de la souris
    let isMouseInside = false;
    
    const updateMouse = (e) => {
      const rect = canvas.getBoundingClientRect();
      
      // Mise à jour immédiate des coordonnées
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      
      // Vérifier si la souris est dans le canvas (avec une marge)
      const margin = 10;
      isMouseInside = this.mouseX >= -margin && 
                     this.mouseY >= -margin && 
                     this.mouseX <= rect.width + margin && 
                     this.mouseY <= rect.height + margin;
      
      // Activer/désactiver le suivi de la souris
      this.mouseActive = isMouseInside;
    };
    
    // Gestion de la sortie du canvas
    const handleMouseLeave = () => {
      this.mouseActive = false;
      isMouseInside = false;
    };
    window.addEventListener('mousemove', updateMouse);
    // Keep legacy canvas listeners for right-click and focus handling
    canvas.addEventListener('mousemove', updateMouse);
    canvas.addEventListener('mouseleave', () => {
      this.mouseActive = false;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.mouseLeftDown = true;
        // Boost maintenu tant que le bouton gauche est enfoncé
        this._boostBurstUntil = 0;
        this.boost = true;
      }
      if (e.button === 2) { this.mouseRightDown = true; this.boost = true; } // right click boost continu
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) {
        this.mouseLeftDown = false;
        // Si pas de clic droit ni touches boost, couper le boost après relâche
        if (!this.mouseRightDown && !this.keys.has('shift') && !this.keys.has(' ')) this.boost = false;
      }
      if (e.button === 2) { this.mouseRightDown = false; if (!this.mouseLeftDown && !this.keys.has('shift') && !this.keys.has(' ')) this.boost = false; }
    });
    // Prevent context menu on right-click for smoother control
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onKeyDown(e) {
    const k = (e.key || '').toLowerCase();
    const c = (e.code || '').toLowerCase();
    const kc = e.keyCode || e.which || 0;
    this.keys.add(k);
    // Normalize arrow codes to ensure capture across platforms/keymaps
    if (c === 'arrowright' || k === 'right') this.keys.add('arrowright');
    if (c === 'arrowleft'  || k === 'left')  this.keys.add('arrowleft');
    if (c === 'arrowup'    || k === 'up')    this.keys.add('arrowup');
    if (c === 'arrowdown'  || k === 'down')  this.keys.add('arrowdown');
    if (kc === 39) this.keys.add('arrowright');
    if (kc === 37) this.keys.add('arrowleft');
    if (kc === 38) this.keys.add('arrowup');
    if (kc === 40) this.keys.add('arrowdown');
    // Emergency: directly set aim for arrow keys to guarantee movement
    if (c === 'arrowright' || k === 'right' || kc === 39) this.targetDir = 0;
    if (c === 'arrowleft'  || k === 'left'  || kc === 37) this.targetDir = Math.PI;
    if (c === 'arrowup'    || k === 'up'    || kc === 38) this.targetDir = -Math.PI/2;
    if (c === 'arrowdown'  || k === 'down'  || kc === 40) this.targetDir = Math.PI/2;
    if (k === ' ' || k === 'shift') this.boost = true;
    else {
      // Toute autre touche déclenche un burst de 300ms
      try { this._boostBurstUntil = performance.now() + 300; } catch { this._boostBurstUntil = Date.now() + 300; }
      this.boost = true;
    }
    if (k.startsWith('arrow') || c.startsWith('arrow') || k === ' ' || k === 'shift') e.preventDefault();
  }

  // A appeler à chaque frame pour couper le burst si nécessaire
  updateBoostTimer() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (this._boostBurstUntil && now > this._boostBurstUntil) {
      this._boostBurstUntil = 0;
      // Si aucune touche de boost maintenue, couper
      if (!this.keys.has('shift') && !this.keys.has(' ') && !this.mouseRightDown) {
        this.boost = false;
      }
    }
  }

  onKeyUp(e) {
    const k = (e.key || '').toLowerCase();
    const c = (e.code || '').toLowerCase();
    const kc = e.keyCode || e.which || 0;
    this.keys.delete(k);
    if (c === 'arrowright' || k === 'right') this.keys.delete('arrowright');
    if (c === 'arrowleft'  || k === 'left')  this.keys.delete('arrowleft');
    if (c === 'arrowup'    || k === 'up')    this.keys.delete('arrowup');
    if (c === 'arrowdown'  || k === 'down')  this.keys.delete('arrowdown');
    if (kc === 39) this.keys.delete('arrowright');
    if (kc === 37) this.keys.delete('arrowleft');
    if (kc === 38) this.keys.delete('arrowup');
    if (kc === 40) this.keys.delete('arrowdown');
    if (k === ' ' || k === 'shift') this.boost = false;
    if (k.startsWith('arrow') || c.startsWith('arrow') || k === ' ' || k === 'shift') e.preventDefault();
  }

  getAxis() {
    // Support A/Z/Q/WASD/ZQSD et flèches
    let x = 0, y = 0;
    if (this.keys.has('arrowleft')  || this.keys.has('left')  || this.keys.has('a') || this.keys.has('q')) x -= 1;
    if (this.keys.has('arrowright') || this.keys.has('right') || this.keys.has('d')) x += 1;
    if (this.keys.has('arrowup')    || this.keys.has('up')    || this.keys.has('w') || this.keys.has('z')) y -= 1;
    if (this.keys.has('arrowdown')  || this.keys.has('down')  || this.keys.has('s')) y += 1;
    // Debug logging removed
    return { x, y };
  }

  updateFromKeyboard(dt = 0, currentDir = 0) {
    // Instant steering for axes/diagonals
    let dir = currentDir;
    const left = this.keys.has('arrowleft')  || this.keys.has('left')  || this.keys.has('a') || this.keys.has('q');
    const right = this.keys.has('arrowright') || this.keys.has('right') || this.keys.has('d');
    const up = this.keys.has('arrowup')    || this.keys.has('up')    || this.keys.has('w') || this.keys.has('z');
    const down = this.keys.has('arrowdown')  || this.keys.has('down')  || this.keys.has('s');

    // If using WASD axes (e.g. up+left), prefer direct vector
    const ax = (right ? 1 : 0) + (left ? -1 : 0);
    const ay = (down ? 1 : 0) + (up ? -1 : 0);
    if (ax !== 0 || ay !== 0) {
      const aim = Math.atan2(ay, ax);
      // Instant orientation for any axis or diagonal
      dir = aim;
      // Debug logging removed
    }

    this.targetDir = dir;
  }

  onJoyStart(e) {
    if (!this.joystick) return;
    this.activeTouchId = e.pointerId ?? 0;
    try { this.joystick.setPointerCapture?.(e.pointerId); } catch {}
    this.onJoyMove(e);
  }

  onJoyMove(e) {
    if (!this.joystick) return;
    if (this.activeTouchId !== (e.pointerId ?? 0)) return;
    const rect = this.joystick.getBoundingClientRect?.();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX ?? 0) - cx;
    const dy = (e.clientY ?? 0) - cy;
    const dist = Math.min(Math.hypot(dx, dy), Math.max(10, rect.width / 2 - 10));
    const angle = Math.atan2(dy, dx);
    const sx = Math.cos(angle) * dist;
    const sy = Math.sin(angle) * dist;
    if (this.stick && this.stick.style) {
      this.stick.style.transform = `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px))`;
    }
    this.targetDir = angle;
  }

  onJoyEnd() {
    this.activeTouchId = null;
    if (this.stick && this.stick.style) {
      this.stick.style.transform = 'translate(-50%, -50%)';
    }
  }
}
