# Factory · Automazione

Un piccolo clone browser di Factorio, single player, in vista isometrica (2.5D): si estraggono minerali di ferro e rame a mano o con un Trapano Minerario, li si trasporta con Nastri trasportatori, un Inserter dal braccio animato li sposta dentro/fuori dalle macchine, un Assemblatore li trasforma in piastre/ingranaggi/circuiti, e una Cassa li raccoglie.

## Funzionalità

- mondo isometrico esteso (70×46 tile) con telecamera che segue il personaggio, zoom con la rotella e minimappa;
- movimento fluido in ogni direzione (anche diagonale), con estrazione manuale delle risorse;
- Trapano Minerario, Nastro trasportatore, Inserter, Assemblatore e Cassa piazzabili e ruotabili, con anteprima di piazzamento prima del click;
- l'Inserter è un braccio meccanico animato: preleva oggetti dalla piastrella dietro di sé e li deposita in quella davanti (nastro, macchina o cassa) — è l'unico modo per far entrare/uscire oggetti da Assemblatore e Cassa;
- quattro ricette di crafting (fusione ferro/rame, ingranaggio, circuito elettronico), automatiche in assemblatore o manuali dall'inventario;
- flusso di produzione a tick continuo (estrazione → trasporto → inserimento → crafting → stoccaggio), con oggetti ed edifici animati (nastri con freccine scorrevoli, trapano che perfora, ingranaggio rotante, braccio dell'inserter che oscilla);
- checklist di obiettivi che guida i primi passi;
- terreni ed elementi decorativi variati, effetti sonori, interfaccia responsive, tema scuro, health check e test automatici.

## Avvio locale

Richiede Node.js 20 o successivo.

```bash
npm ci
npm start
```

Aprire `http://localhost:3000`.

### Comandi di gioco

- `WASD` / frecce: muovi il personaggio;
- `E`: interagisci (estrai a mano, ritira dalla cassa, apri le ricette dell'assemblatore);
- `R`: ruota la direzione di piazzamento;
- Click sinistro: piazza l'elemento selezionato nella hotbar;
- Click destro: rimuovi l'elemento sotto al cursore;
- Rotella del mouse: zoom in/out;
- Tasti `1`-`6`: selezionano Trapano, Nastro, Inserter, Assemblatore, Cassa, Rimuovi.

## Installazione VPS con Docker

```bash
docker compose up -d --build
```

Il gioco sarà disponibile sulla porta `3000`. Per pubblicarlo sulla porta 80 si può usare un reverse proxy Nginx oppure modificare la mappatura in `docker-compose.yml` da `3000:3000` a `80:3000`.

## Verifica

```bash
npm run check
```
