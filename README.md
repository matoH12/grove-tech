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
| `GET /` | Dashboard s kompletnou diagnostikou kontajnera |
| `GET /health` | Health check pre platformu — `{"status":"ok"}` |
| `GET /api/info` | **Všetko, čo sa dá zistiť** o kontajneri a prostredí (sekcie nižšie) |
| `GET /api/info/:sekcia` | Jedna sekcia, napr. `/api/info/limits`, `/api/info/network` |
| `GET /api/request` | Hlavičky a údaje o požiadavke tak, ako prídu cez reverznú proxy |
| `POST /api/echo` | Vráti odoslané JSON telo — test POST cez proxy |
| `GET /api/stress?ms=500` | Krátka CPU záťaž — overí, či cgroup limity reálne platia |

### Sekcie v `/api/info`

| Sekcia | Čo obsahuje |
|---|---|
| `container` | Detekcia runtime (Docker / Podman / Kubernetes / LXC), `/.dockerenv`, `/proc/1/cgroup`, PID 1, overlayfs, odhad ID kontajnera |
| `limits` | cgroup v1/v2 limity: CPU kvóta a prepočet na jadrá, pamäťový limit a aktuálne využitie, swap, PID limit, počet vlákien |
| `runtime` | Node a všetky `process.versions` (V8, OpenSSL, libuv…), `execPath`, argv, cwd, PID/PPID, timezone, locale, `resourceUsage`, `memoryUsage` |
| `system` | Hostname, kernel (`uname -a`), `/etc/os-release`, machine-id, uptime hosta, loadavg, používateľ, UID/GID/skupiny, `/proc/self/limits` (ulimity), `/proc/self/status` |
| `cpu` | Model, počet jadier, frekvencia, CPU flagy, časy jednotlivých jadier, `availableParallelism` |
| `disk` | `statfs` pre `/`, app adresár a `/tmp` (veľkosť, voľné, inody), zoznam mountov, výpis `/` a app adresára, test zapisovateľnosti |
| `network` | Všetky sieťové rozhrania a adresy, DNS servery, `/etc/resolv.conf`, `/etc/hosts`, FQDN |
| `env` | Počet premenných, **všetky kľúče**, hodnoty (maskované — viď nižšie), samostatne `APP_*` |
| `request` | Metóda, HTTP verzia, `X-Forwarded-*`, IP klienta, lokálny/vzdialený port, či TLS ukončuje proxy, **všetky hlavičky** |

### Testy limitov kontajnera (`/api/test/*`)

Tieto endpointy vedia aplikáciu zhodiť alebo zaplniť disk — preto sú oddelené.
Ak nastavíš `DIAG_TOKEN`, vyžadujú `?token=…` (alebo hlavičku `X-Diag-Token`).
Bez neho sú otvorené, takže na verejnej URL ho nastav.

| Endpoint | Popis |
|---|---|
| `GET /api/test/memory` | Aktuálne cgroup využitie, RSS, heap, V8 heap limit, OOM počítadlá |
| `GET /api/test/memory/alloc?mb=64` | Alokuje a **dotkne sa** N MB (Buffer, mimo V8 heapu) — opakovaním až k OOM |
| `GET /api/test/memory/release` | Uvoľní všetky držané bloky |
| `GET /api/test/disk/write?mb=512&target=app\|tmp&fsync=0` | Zapíše súbor po 8 MB blokoch, zmeria priepustnosť a voľné miesto pred/po |
| `GET /api/test/disk/read?file=…` | Prečíta súbor späť a zmeria rýchlosť čítania |
| `GET /api/test/disk` | Vypíše testovacie súbory a stav diskov |
| `GET /api/test/disk/cleanup` | Zmaže všetky `zapis-test-*` súbory |
| `GET /api/test/marker/write` a `/read` | Marker pre overenie, či disk prežije reštart |
| `GET /api/test/crash` | Čistý pád procesu — overí, či platforma appku nahodí späť |

Stropy: alokácia max 1200 MB naraz, zápis max 8 GB na súbor.

### Bezpečnosť výpisu premenných

Appka beží na verejnej URL bez prihlásenia, takže hodnoty premenných sú **maskované**:
kľúče vidno vždy, hodnoty len pre neutrálne premenné (`APP_*`, `NODE_*`, `PATH`, `PORT`…).
Čokoľvek s `secret`, `token`, `key`, `password`, `auth` a podobne sa nahradí `«skryté, N znakov»`.

Ak chceš vidieť úplne všetko, nastav `DIAG_SHOW_ALL_ENV=1` — appka na to upozorní v logu
aj na stránke. Po teste to zase vypni, inak sú prípadné tokeny verejné.

## Ako to overiť po nasadení

```bash
curl https://grove-tech.grovecloud.cz/health
curl -s https://grove-tech.grovecloud.cz/api/info | jq .          # všetko
curl -s https://grove-tech.grovecloud.cz/api/info/limits | jq .   # len limity kontajnera
curl -s https://grove-tech.grovecloud.cz/api/info/container | jq .
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

## Namerané na GroveCloud (10. 9. 2026)

Tarif: **0,75 jadra CPU, 768 MB RAM**, Docker + cgroup v2, Alpine 3.23, Node 20.20.2.

### CPU kvóta

`cpu.max = 75000/100000`. Pri trvalej záťaži appka dostane **0,72–0,75 jadra**
a kernel ju škrtí v **29 z 32** stoms period (0,71 s uspaného času z 3,2 s).
Žiadny burst kredit — krátke špičky nedostanú viac než trvalá záťaž.

### Pamäťový limit

`memory.max = 768 MB`, bez `memory.high` (žiadne mäkké brzdenie).
Alokácia rástla plynulo až po **756 MB (98,4 %)**, ďalších 16 MB proces **zabilo**
bez akejkoľvek chyby v aplikácii — čistý OOM kill. Aplikácia bola späť **do 2 sekúnd**.

Pozor na interpretáciu `memory.current`: pri zápise na disk vyskočí na 100 %,
lebo cgroup si účtuje aj page cache. Pri teste to nastalo 13 103-krát
(`memory.events.max`), ale `oom_kill` zostalo 0 — cache je zahoditeľná.
**100 % využitia pamäte teda neznamená, že appka ide spadnúť.**

### Disk

`/` je overlayfs nad containerd, **žiadny perzistentný zväzok**, `/tmp` nie je tmpfs
(zápis ide na disk, nie do RAM). `/dev/shm` má len 64 MB.
`statfs` hlási 37,2 GB / 32,2 GB voľných — to je disk hosta, nie kvóta kontajnera.

| Test | Priepustnosť |
|---|---|
| Zápis 64 MB + fsync | 338 MB/s |
| Zápis 256 MB + fsync | 535 MB/s |
| Zápis 1 GB + fsync | 767 MB/s |
| Zápis 1 GB bez fsync | 779 MB/s |
| Čítanie 1 GB | 283 MB/s |

Voľné miesto ubúdalo presne 1:1 so zapísanými dátami a po zmazaní sa vrátilo.
Do 2,5 GB sa neprejavila žiadna kvóta — nad to som netlačil, lebo je to
zdieľaný disk hosta.

### Reštart a perzistencia

**Reštart po páde:** vráti sa **rovnaký kontajner** (`hostname` nezmenený) do 2 s
a súbory zapísané pred pádom prežijú. cgroup počítadlá sa pritom vynulujú,
takže sa reštartuje celý kontajner, nie len proces.

**Redeploy (git push):** vytvorí sa **nový kontajner** (hostname `f36cf39ecd02` →
`cea3655f7eb8`) a všetko zapísané zmizne — marker v `/app/data` aj v `/tmp` bol po
redeployi `ENOENT`. Zápis na disk je teda použiteľný len ako cache v rámci jedného
nasadenia; čokoľvek, čo má prežiť deploy, patrí do databázy alebo externého úložiska.
