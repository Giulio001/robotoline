# Terranovaland

Terranovaland è un’avventura voxel multiplayer che funziona direttamente nel browser. Tutti gli esploratori entrano dallo stesso spawn e condividono un mondo persistente: i blocchi scavati o costruiti, i profili, i clan e i progressi restano salvati sul server.

La difficoltà predefinita è **Avventura, medio-bassa**: i nemici richiedono attenzione ma la progressione rimane accessibile, la vita si rigenera lentamente fuori dal combattimento e i boss sono affrontabili con preparazione o con un piccolo gruppo di amici.

## Cosa include

- mondo 3D proceduralmente esteso per oltre due milioni di blocchi, generato e caricato continuamente a chunk, con sei biomi distinti, vegetazione dedicata, foreste, deserti, paludi, gelo, zone vulcaniche, fiumi, laghi, miniere e ciclo giorno/notte;
- multiplayer in tempo reale con nomi, chat, animazioni e spawn comune;
- scavo, costruzione, collisioni, corsa, salto e nove slot rapidi;
- 15 materiali, minerali rari, strumenti, armi, crafting e inventario;
- quattro famiglie di nemici, due boss con barra vita, drop, IA, difficoltà e ricompense differenti;
- campagna progressiva di 15 missioni, NPC con dialoghi, XP, livelli, tesori e ricompense uniche;
- dodici luoghi da scoprire, tre dungeon sotterranei e due dungeon sospesi raggiungibili in drago, con tesori e sentinelle celesti;
- loot fisico dei mostri con cinque rarità, oggetti rari ed equipaggiamento leggendario;
- vita e mana con rigenerazione, quattro abilità potenziabili e poteri attivi — estrazione 2×, colpo potente, cura e passo del vento;
- equipaggiamento indossabile, armatura, pozioni e mercato;
- clan fino a 12 membri;
- draghi condivisi che volano autonomamente e possono essere cavalcati;
- circuiti di pietrarossa con polvere conduttrice, leve, lampade e pistoni;
- castelli, torri, rovine, santuari e dungeon distribuiti proceduralmente;
- acqua animata con onde, riflessi, trasparenza e variazioni di profondità;
- oggetti fisici gettabili, raccoglibili e regalabili ai giocatori vicini;
- box persistente alla morte con inventario e monete recuperabili o trasportabili da un amico;
- salvataggio persistente e protezione della piazza iniziale;
- UI responsive, inventario personale, impostazioni grafiche/audio e modelli distinti di armi, strumenti, pozioni e blocchi visibili in prima persona;
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
| `E` | Interagisce con NPC, tesori, oggetti, leve e draghi |
| `F` | Usa pane o pozione curativa |
| `I`, `C`, `M`, `L` | Inventario, crafting, mercato, clan |
| `Tab` | Apre l’inventario personale |
| Rotella mouse | Seleziona l’oggetto rapido e lo mostra in mano |
| Click destro nell’inventario | Equipaggia un oggetto |
| Click sinistro nell’inventario | Regala o getta un oggetto |
| `T` oppure `Invio` | Chat |
| `O` | Impostazioni |
| `P` | Diario di esplorazione e luoghi scoperti |
| `K` | Abilità e punti disponibili |

Quando un esploratore muore, il suo inventario e le monete vengono racchiusi in un box nel punto della sconfitta. Il proprietario può recuperare tutto con `E`; un altro giocatore può raccogliere il box, trasportarlo e posarlo vicino al proprietario.

## Verifica

```bash
npm run check
```

Il server espone inoltre `GET /health`, adatto al monitoraggio del container o della VPS.
