# jobAgent

Track industrial automation and control systems jobs across Europe. jobAgent combines a Node.js dashboard with a JSON import API and an optional daily search workflow.

## Install and run

Requirements are Git and Node.js 20 or newer. There are no dependencies to install.

```sh
git clone https://github.com/ondrisovich/jobAgent.git
cd jobAgent
node local.mjs
```

Open [the local dashboard](http://127.0.0.1:3210). The local server listens on loopback. Set `JOBS_PORT` to use a different port and set `JOBS_SITE_URL` to the matching origin when running the importer.

## Import your first jobs

Keep the server running and open another terminal in the repository.

```sh
node sync-jobs.mjs jobs.example.json
```

The importer verifies the write and updates `CZ.json`, `SWISS.json`, `DE_AU.json`, and `EU.json`. Repeating the same import skips existing URLs. An offer appears under CZ, SWISS, DE+AU, or EU according to its country.

The dashboard shows the location, salary, remote policy, first import date, and original listing. The heart marks a favorite. The cross moves an offer to **Not interesting**. The checkmark moves it to **Applied**. Click an active control again to undo it. These selections persist on the server.

## Data and API

Use [the example batch](jobs.example.json) as the input format. Supply an uppercase two-letter country code, and use `yes`, `no`, or `na` for remote work. Use `null` for an unknown city or salary. A salary string can include currency and pay period. The server sets `savedAt` at first import.

| Method and path | Purpose |
| --- | --- |
| `GET /jobs.json` | Read active listings |
| `POST /api/jobs` | Append new listings from a JSON array |
| `PATCH /api/jobs` | Remove confirmed closed listings by exact URL |
| `GET /api/job-status` | Read saved selections |
| `POST /api/job-status` | Update `favorite` or `status` for a listing URL |

Send request bodies as `application/json`. Local application data is stored in `dist/jobs.json` and `dist/job-status.json`.

## Daily search

See [the scan workflow](SCAN.md) for a Codex scheduled task. The task prepares an import batch from verified sources and then checks older listings for closures. Set up the schedule in Codex for the account and machine that will run it.

## Private hosting

Create a private Sites project and provision an R2 bucket binding called `BUCKET`. Copy `hosting.example.json` to `.openai/hosting.json` and set your own project ID. Run `node build.mjs` to build the Worker at `dist/server/index.js` and publish it through your private Sites deployment workflow.

For remote imports, set `JOBS_SITE_URL` to your HTTPS site origin and supply the Sites service token over stdin. Keep site credentials and personal data out of Git.
