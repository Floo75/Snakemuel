// ui.js – personnalisation (pseudo, skins) et leaderboard
import { SKINS } from './game.js';

export function initCustomization(state, { nameInputId = 'nameInput', skinPickerId = 'skinPicker' } = {}) {
  const picker = document.getElementById(skinPickerId);
  const nameInput = document.getElementById(nameInputId);

  // Charger préférences sauvegardées
  try {
    const savedName = localStorage.getItem('playerName');
    const savedSkin = localStorage.getItem('skinId');
    if (savedName) state.playerName = savedName;
    if (savedSkin) state.selectedSkinId = savedSkin;
    if (nameInput) nameInput.value = state.playerName || '';
  } catch {}

  // Skins
  if (!picker) return; // si la cible n'est pas présente, ne rien faire
  picker.innerHTML = '';
  SKINS.forEach((s, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = s.id;
    btn.setAttribute('role', 'option');
    btn.style.background = `linear-gradient(90deg, ${s.colors[0]}, ${s.colors[1]})`;
    btn.addEventListener('click', () => {
      for (const el of picker.querySelectorAll('button')) el.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-selected', 'true');
      state.selectedSkinId = s.id;
      if (state.me) {
        state.me.skinId = s.id;
        state.me.colors = s.colors;
        // Appliquer la couleur principale du skin au rendu mono-couleur
        state.me.color = (s.colors && s.colors[0]) || '#ffffff';
      }
      try { localStorage.setItem('skinId', s.id); } catch {}
    });
    // Sélection initiale: skin sauvegardé sinon premier
    if ((state.selectedSkinId && state.selectedSkinId === s.id) || (!state.selectedSkinId && idx === 0)) {
      btn.setAttribute('aria-selected', 'true');
      if (!state.selectedSkinId) state.selectedSkinId = s.id;
    }
    picker.appendChild(btn);
  });

  // Name
  if (nameInput) {
    // Effacer le placeholder "Joueur" au focus, restaurer s'il reste vide au blur
    nameInput.addEventListener('focus', () => {
      if (!nameInput.value || nameInput.value.toLowerCase() === 'joueur') {
        nameInput.value = '';
      }
    });
    nameInput.addEventListener('blur', () => {
      if (!nameInput.value.trim()) {
        nameInput.value = 'Joueur';
        state.playerName = 'Joueur';
        try { localStorage.setItem('playerName', state.playerName); } catch {}
      }
    });
    nameInput.addEventListener('input', () => {
      state.playerName = nameInput.value || 'Joueur';
      if (state.me) state.me.name = state.playerName;
      try { localStorage.setItem('playerName', state.playerName); } catch {}
    });
  }
}

export function updateLeaderboard(state) {
  const lb = document.getElementById('leaderboard');
  const arr = [...state.players.values()].sort((a, b) => b.score - a.score);
  lb.innerHTML = '';
  arr.forEach((s, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span');
    const name = document.createElement('span');
    const score = document.createElement('span');
    const isMe = state.me && s.id === state.me.id;
    
    rank.className = 'rank';
    rank.textContent = String(i + 1).padStart(2, '0');
    name.textContent = (s.name || '???').toUpperCase(); // Forcer en majuscules
    score.textContent = String(s.score);
    
    if (isMe) {
      li.setAttribute('data-is-me', 'true');
    }
    
    // Marquer les éliminés
    if (!s.alive) { 
      li.style.color = '#ff4d6d'; 
      name.textContent += ' (ÉLIMINÉ)';
    }
    
    li.appendChild(rank);
    li.appendChild(name);
    li.appendChild(score);
    lb.appendChild(li);
  });
}
