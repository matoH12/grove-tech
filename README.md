# grove-tech-test

Testovacia aplikácia na overenie hostingu **GroveCloud**. Overí naraz build, štart,
port, premenné prostredia, statické súbory aj API (GET + POST).

## Nastavenia do formulára "Nová aplikace"

| Pole | Hodnota |
|---|---|
| Adresa aplikace | `grove-tech` (→ https://grove-tech.grovecloud.cz) |
| Název aplikace | `grove-tech-test` |
| Typ aplikace | **Fullstack (frontend + API)** |
| Build příkaz | `npm install` |
| Startovací příkaz | `npm start` |
| Port | `3000` |

### Proměnné prostředí (nepovinné, ale odporúčam — otestuje sa aj ich prenos)

| Kľúč | Hodnota |
|---|---|
| `APP_MESSAGE` | `Ahoj z GroveCloud` |
| `APP_STAGE` | `production` |

> Appka počúva na `process.env.PORT` (fallback 3000) a na `0.0.0.0`, takže si poradí,
> aj keď platforma port pridelí sama.

## Čo appka vystavuje

| Endpoint | Popis |
|---|---|
| `GET /` | HTML stránka so stavom nasadenia (volá `/api/info`) |
| `GET /health` | Health check pre platformu — `{"status":"ok"}` |
| `GET /api/info` | Node verzia, hostname, port, uptime, protokol, `APP_*` premenné |
| `POST /api/echo` | Vráti odoslané JSON telo — test POST cez proxy |

## Ako to overiť po nasadení

```bash
curl https://grove-tech.grovecloud.cz/health
curl https://grove-tech.grovecloud.cz/api/info
curl -X POST https://grove-tech.grovecloud.cz/api/echo \
  -H 'Content-Type: application/json' -d '{"ahoj":"svet"}'
```

Na stránke `https://grove-tech.grovecloud.cz` uvidíš zelený stav, výpis prostredia
a tlačidlo na test POST requestu.

Ak `/api/info` vráti `"proto": "https"` a v `appEnv` sú tvoje premenné, hosting
funguje celý reťazec správne — build, štart, reverzná proxy aj TLS.

## Lokálny beh

```bash
npm install
PORT=3000 APP_MESSAGE="Ahoj lokálne" npm start
# → http://localhost:3000
```
