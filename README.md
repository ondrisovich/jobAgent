# jobAgent

Webový přehled nabídek v průmyslové automatizaci a řídicích systémech v Evropě. Rozhraní třídí nabídky do záložek CZ, SWISS, DE+AU a EU. Zobrazuje detail pozice, plat, režim práce, datum prvního uložení a odkaz na inzerát. Srdíčko, „Not interesting“ a „Applied“ se ukládají na server.

## Instalace

Potřebuješ Git a Node.js 20 nebo novější. Projekt nemá balíčky k instalaci.

```sh
git clone https://github.com/ondrisovich/jobAgent.git
cd jobAgent
node local.mjs
```

Otevři [lokální přehled](http://127.0.0.1:3210). Pro jiný port nastav proměnnou prostředí `JOBS_PORT`; synchronizačnímu skriptu pak nastav stejnou adresu přes `JOBS_SITE_URL`.

## První import

V druhém terminálu se spuštěným webem použij ukázkovou dávku.

```sh
node sync-jobs.mjs examples/jobs.json
```

Skript přidá nové nabídky do webu, ověří jejich uložení a zapíše regionální soubory `CZ.json`, `SWISS.json`, `DE_AU.json` a `EU.json`. Spusť ho znovu se stejnou dávkou a výsledek zůstane bez duplicit. Pro vlastní sken nahraď ukázku JSON polem s reálnými nabídkami.

## Rozhraní a data

| Metoda a adresa | Účel |
| --- | --- |
| `GET /jobs.json` | Aktivní nabídky ve všech regionech |
| `POST /api/jobs` | Import JSON pole nabídek s `Content-Type: application/json` |
| `PATCH /api/jobs` | Odstranění potvrzeně uzavřených nabídek podle JSON pole původních URL |
| `GET /api/job-status` | Uložená označení |
| `POST /api/job-status` | Úprava `favorite` nebo `status` pro konkrétní `url` |

Pole `country` je dvoupísmenný kód země, `remote` přijímá `yes`, `no` nebo `na`. Neznámý plat nebo město zadej jako `null`. Server doplňuje `savedAt` při prvním importu a podle URL rozpozná opakované záznamy. Archiv stavů umožňuje zachovat označené inzeráty i po skončení jejich platnosti. Lokální server naslouchá pouze na rozhraní loopback.

## Napojení denní úlohy

Repozitář obsahuje web, importní skript a postup v [návodu pro denní sken](SCAN.md). Samotnou úlohu vytvoř v Codexu. Použij pravidelný běh, který vyhledá a ověří zdrojové odkazy, připraví dávku, spustí synchronizaci a následně prověří starší nabídky.

## Nasazení na soukromý Sites

Vytvoř vlastní privátní projekt Sites s úložištěm R2 pod vazbou `BUCKET`. Podle `.openai/hosting.example.json` připrav lokální `.openai/hosting.json` s ID vlastního projektu. Příkaz `node build.mjs` sestaví Worker do `dist/server/index.js`. Publikuj ho standardním postupem Sites pro soukromé projekty.

Pro vzdálený import nastav `JOBS_SITE_URL` na HTTPS adresu projektu a služební token Sites předej synchronizačnímu skriptu přes stdin. Lokální data, osobní údaje a přístupové údaje zůstávají mimo repozitář.
