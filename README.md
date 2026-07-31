# Tris Online Multiplayer

Un gioco del Tris web multiplayer in tempo reale. Si entra inserendo soltanto il proprio nome, quindi si può cercare automaticamente un avversario oppure creare una stanza privata da condividere tramite codice.

## Funzionalità

- accesso immediato senza password;
- matchmaking rapido tra giocatori online;
- stanze private con codice di cinque caratteri;
- turni X/O sincronizzati e validati dal server;
- riconoscimento delle otto combinazioni vincenti e del pareggio;
- punteggio tra round e rivincita consensuale;
- alternanza dei simboli a ogni rivincita;
- gestione di abbandono, disconnessione e riconnessione;
- suoni, animazioni, confetti e interfaccia responsive;
- health check, Docker e test automatici.

## Avvio locale

Richiede Node.js 20 o successivo.

```bash
npm ci
npm start
```

Aprire `http://localhost:3000` in due browser per provare il multiplayer.

## Installazione VPS con Docker

```bash
docker compose up -d --build
```

Il gioco sarà disponibile sulla porta `3000`. Per pubblicarlo sulla porta 80 si può usare un reverse proxy Nginx oppure modificare la mappatura in `docker-compose.yml` da `3000:3000` a `80:3000`.

## Verifica

```bash
npm run check
```

La suite verifica regole, vittorie, pareggi, sanificazione degli input, stanze private, matchmaking, punteggio e rivincita.
