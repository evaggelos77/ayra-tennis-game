# ΑΥΡΑ × POWERADE Tennis Challenge

Web kiosk game (Three.js) + AI magazine-cover face-swap (AKOOL) + QR souvenir.
Node server (built-ins only) serving the prebuilt `dist/`.

## Run
```
npm start   # node server.mjs  (uses $PORT)
```

## Deploy (Render)
One-click via `render.yaml` (Blueprint). Set the env var **AKOOL_API_KEY** in the
Render dashboard for the AI covers to work (the game itself runs without it).

The QR souvenir link uses the public HTTPS host automatically.
