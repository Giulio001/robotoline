# Factory · Automazione

Un piccolo clone browser di Factorio, single player: si estraggono minerali di ferro e rame a mano o con un Trapano Minerario, li si trasporta con Nastri trasportatori, li si trasforma in piastre/ingranaggi/circuiti con un Assemblatore, e li si raccoglie con una Cassa.

## Funzionalità

- movimento a griglia con estrazione manuale delle risorse;
- Trapano Minerario, Nastro trasportatore, Assemblatore e Cassa piazzabili e ruotabili;
- quattro ricette di crafting (fusione ferro/rame, ingranaggio, circuito elettronico), automatiche in assemblatore o manuali dall'inventario;
- flusso di produzione a tick continuo (estrazione → trasporto → crafting → stoccaggio);
- checklist di obiettivi che guida i primi passi;
- interfaccia responsive, tema scuro, health check e test automatici.

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
- Tasti `1`-`5`: selezionano Trapano, Nastro, Assemblatore, Cassa, Rimuovi.

## Installazione VPS con Docker

```bash
docker compose up -d --build
```

Il gioco sarà disponibile sulla porta `3000`. Per pubblicarlo sulla porta 80 si può usare un reverse proxy Nginx oppure modificare la mappatura in `docker-compose.yml` da `3000:3000` a `80:3000`.

## Verifica

```bash
npm run check
```
