# Terranovaland

Terranovaland è un’avventura voxel multiplayer che funziona direttamente nel browser. Tutti gli esploratori entrano dallo stesso spawn e condividono un mondo persistente: i blocchi scavati o costruiti, i profili, i clan e i progressi restano salvati sul server.

## Cosa include

- mondo 3D procedurale con biomi, foreste, neve, spiagge, acqua, miniere e ciclo giorno/notte;
- multiplayer in tempo reale con nomi, chat, animazioni e spawn comune;
- scavo, costruzione, collisioni, corsa, salto e nove slot rapidi;
- 15 materiali, minerali rari, strumenti, armi, crafting e inventario;
- quattro famiglie di nemici con IA, difficoltà e ricompense differenti;
- missioni, monete e mercato;
- clan fino a 12 membri;
- draghi condivisi e cavalcabili per volare;
- salvataggio persistente e protezione della piazza iniziale;
- UI responsive, comandi integrati e modalità a movimento ridotto;
- immagine Docker, health check e configurazione pronta per VPS.

## Avvio locale

Richiede Node.js 20 o più recente.

```bash
npm install
npm start
```

Apri `http://localhost:3000`. Per una partita multiplayer, gli amici devono aprire l’indirizzo del server sulla stessa porta.

## Installazione consigliata su VPS con Docker

```bash
git clone https://github.com/Giulio001/robotoline.git
cd robotoline
docker compose up -d --build
```

Il gioco risponde sulla porta `3000`. Verifica con:

```bash
curl http://127.0.0.1:3000/health
```

Se utilizzi un firewall:

```bash
sudo ufw allow 3000/tcp
```

Poi apri `http://IP-DELLA-VPS:3000`.

## Pubblicazione su porta 80 con Nginx

Installa Nginx e crea `/etc/nginx/sites-available/terranovaland`:

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
```

Quindi:

```bash
sudo ln -s /etc/nginx/sites-available/terranovaland /etc/nginx/sites-enabled/terranovaland
sudo nginx -t
sudo systemctl reload nginx
```

È consigliato aggiungere in seguito un dominio e HTTPS tramite Certbot. Socket.IO usa WebSocket, quindi le intestazioni `Upgrade` e `Connection` nella configurazione Nginx sono necessarie.

## Salvataggi e backup

Con Docker i salvataggi risiedono nel volume `terranovaland_data`. Senza Docker vengono scritti in `./data/terranovaland.json`. È possibile scegliere un percorso diverso impostando `DATA_DIR`.

Il nome scelto all’accesso identifica il profilo. Questa modalità è intenzionalmente semplice per partite private tra amici; se il server viene reso pubblico è opportuno introdurre account con password o accesso tramite invito.

## Comandi principali

| Comando | Azione |
| --- | --- |
| `W A S D` | Movimento |
| `Spazio` | Salta / sale in volo |
| `Shift` | Corre / scende in volo |
| Click sinistro | Scava o attacca |
| Click destro | Posiziona un blocco |
| `E` | Cavalca o lascia un drago |
| `F` | Mangia il pane |
| `I`, `C`, `M`, `L` | Inventario, crafting, mercato, clan |
| `T` | Chat |

## Verifica

```bash
npm run check
```

Il server espone inoltre `GET /health`, adatto al monitoraggio del container o della VPS.
