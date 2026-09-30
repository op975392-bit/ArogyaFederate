# ArogyaFederate — BRICS health resilience prototype

A local-first hackathon prototype for PHC inventory, bed/staff reporting, demand forecasting, distance-aware redistribution, a command-center map, and a Flower FedAvg proof of concept. **All bundled facility and demand data are synthetic.** This is not a clinical decision-support system.

## Project layout

```text
arogya-federate/
├── backend/
│   ├── main.py              FastAPI endpoints
│   ├── database.py          SQLite engine/session
│   ├── models.py            SQLAlchemy entities
│   ├── optimizer.py         PuLP transportation LP (greedy fallback)
│   ├── seed_data.py         Deterministic demo data generator
│   ├── fl_server.py         Flower FedAvg server
│   ├── fl_client.py         Synthetic local Flower client
│   └── requirements.txt
└── frontend/                Vite + React dashboard
```

## Requirements

- Python 3.10+ (3.11 recommended)
- Node.js 18+ and npm
- For Flower POC: two more terminal sessions; localhost port `8080` available

## Start the API

```bash
cd arogya-federate/backend
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python seed_data.py
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API docs are at `http://localhost:8000/docs`. Seeding is repeatable and **replaces** the existing demo PHCs/inventory/history in the SQLite database. The DB file (`arogya_federate.db`) is created in `backend/`.

## Start the dashboard

In another terminal:

```bash
cd arogya-federate/frontend
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`). The Vite dev server proxies `/api` requests to `http://127.0.0.1:8000` by default, so no browser-side localhost API call or CORS setup is needed. For a separately hosted API, set `VITE_API_URL` before building/starting Vite. The interactive Leaflet map uses OpenStreetMap tiles, so tile display requires internet access; facility data and API run locally.

## Try the prototype

- Click a map dot to open a PHC profile, review stock/expiry/bed/staff values, and view its 30-day forecast.
- Use **Update PHC data** to submit stock, occupied beds, and staff present. When disconnected, edits are queued in browser local storage and retried on reconnect.
- Review suggested routes and click **Approve**. Approval atomically reduces source stock and increases destination stock; the dashboard refreshes after approval.
- Export the current network snapshot as CSV.
- `/api/redistribute` accepts `{"item":"Insulin"}` to calculate a plan for one item, or `{}` for all items.

## Federated learning demo (optional)

Install Flower in the backend virtual environment only if you want to run the optional POC: `pip install -r requirements-flower.txt`. In three backend terminal sessions using the same virtual environment, start the server and then two clients:

```bash
# Terminal 1
python fl_server.py
# Terminal 2
python fl_client.py India
# Terminal 3
python fl_client.py Brazil
```

The server aggregates three linear-model coefficients with FedAvg for five rounds. Each client generates/trains on its own synthetic records; only model parameters and sample counts are sent. The dashboard's country-node card is illustrative status data from the API and is not wired to the live Flower process. The POC is not differential privacy or secure aggregation; it demonstrates the model-weight-only data flow, not a production privacy guarantee.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | API health check |
| GET | `/api/phcs` | PHCs, inventory risk, and network summary stats |
| POST | `/api/phc/update` | Update stock, occupancy, staff attendance |
| GET | `/api/forecast/{phc_id}/{item}` | Fit local Random Forest and return 30 future daily estimates |
| POST | `/api/redistribute` | Distance-costed LP transfer recommendations |
| POST | `/api/redistribute/approve` | Apply one recommended stock transfer |
| GET | `/api/federation/status` | Illustrative BRICS node/model status |

Risk thresholds are intentionally simple: **Red** if any medicine has zero stock, **Yellow** if any has under seven days of average historical use, otherwise **Green**. The forecast uses lag and weekday features from the seeded 90-day series. The LP covers 30-day projected deficits with donor stock above a 20% demand buffer, minimizing quantity-weighted Haversine distance and reporting unmet demand when supply is insufficient.

## Prototype limitations

No user authentication/RBAC, audit trail, encryption-at-rest, facility identity validation, expiry-aware FEFO logic, route-network travel-time engine, real country-node transport, or clinical validation is included. SQLite and the browser queue are suitable for a local demo only; use a secured, reviewed backend before handling real health data.
