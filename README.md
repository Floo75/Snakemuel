# Snake.io Clone – Web Multiplayer (Simulation Locale)

Un clone moderne de Snake.io jouable sur desktop et mobile.

- Rendu Canvas 2D fluide, couleurs vives.
- Contrôles clavier (ZQSD/WASD/Flèches) et tactile (joystick virtuel + bouton Boost).
- Croissance en ramassant des points (nourriture).
- Collisions tête-corps (avec soi-même et les autres).
- Mort et respawn après un court délai (Entrée pour forcer quand délai écoulé).
- Leaderboard en temps réel.
- Personnalisation du pseudo et du skin.
- Simulation multijoueur locale (bots IA). Une intégration WebSocket pourra être ajoutée par la suite.

## Structure

- `index.html` – structure de la page et conteneurs UI.
- `styles.css` – styles modernes et responsive.
- `js/utils.js` – utilitaires généraux (math, storage, etc.).
- `js/game.js` – logique du jeu (état, serpents, nourriture, collisions, respawn).
- `js/renderer.js` – rendu canvas 2D (arrière-plan, serpents, nourriture, HUD).
- `js/input.js` – gestion des entrées clavier/tactile et boost.
- `js/bots.js` – IA simple pour bots (ciblage nourriture, errance, boost occasionnel).
- `js/ui.js` – UI de personnalisation et leaderboard.
- `js/main.js` – point d’entrée, boucle, initialisation.

## Lancer localement

1. Ouvrez ce dossier dans votre IDE.
2. Servez les fichiers statiques via un serveur HTTP local. Par exemple avec Python 3:

```bash
python3 -m http.server 5173
```

Puis ouvrez [http://localhost:5173](http://localhost:5173) dans votre navigateur.

Sur macOS vous pouvez aussi utiliser:

```bash
open -a "Google Chrome" http://localhost:5173
```

## Contrôles

- Déplacement: ZQSD, WASD ou Flèches.
- Boost: Espace (desktop) ou bouton Boost (mobile).
- Respawn: Entrée (si KO et délai écoulé).

## Notes d’implémentation

- Monde torique (wrap) pour continuer à l’infini.
- Vitesse de base et boost paramétrables via `WORLD` dans `js/game.js`.
- Taux de rotation contraint pour une maniabilité fluide.
- Croissance basée sur le score + `pendingGrowth`.
- Leaderboard trié par score; surlignage du joueur local.
- Rendu optimisé: devicePixelRatio plafonné à 2 pour éviter des coûts GPU élevés sur mobile.

## Ajouter un vrai multijoueur

- Remplacer la `BotManager` par un client WebSocket qui envoie:
  - position/dir/boost du joueur local;
  - reçoit l’état des autres joueurs et la nourriture.
- Maintenir une interpolation client pour les serpents distants.
- Prévoir la validation côté serveur des collisions et du score.
