"""Distance-costed transportation LP for inter-PHC redistribution."""
from math import asin, cos, radians, sin, sqrt
from typing import Any
from models import PHC, Inventory, Consumption

try:
    import pulp
except ImportError:  # Keep the demo usable even before optional solver installation.
    pulp = None

def haversine_km(a: PHC, b: PHC) -> float:
    r = 6371.0
    dlat, dlon = radians(b.latitude - a.latitude), radians(b.longitude - a.longitude)
    h = sin(dlat / 2) ** 2 + cos(radians(a.latitude)) * cos(radians(b.latitude)) * sin(dlon / 2) ** 2
    return 2 * r * asin(sqrt(h))

def build_transfer_plan(db, selected_item: str | None = None) -> dict[str, Any]:
    phcs = db.query(PHC).all()
    invs = db.query(Inventory).all()
    stock = {(i.phc_id, i.item): i.stock for i in invs}
    items = [selected_item] if selected_item else sorted({i.item for i in invs})
    plan, summaries = [], []
    for item in items:
        rows = db.query(Consumption.phc_id, Consumption.quantity).filter(Consumption.item == item).all()
        totals: dict[int, list[int]] = {}
        for pid, qty in rows:
            totals.setdefault(pid, []).append(qty)
        avg_daily = {pid: (sum(vals) / len(vals) if vals else 0) for pid, vals in totals.items()}
        demand, surplus = {}, {}
        for p in phcs:
            expected = max(1, round(avg_daily.get(p.id, 0) * 30))
            current = stock.get((p.id, item), 0)
            # Replenish sites projected to run short; donors retain a 20% demand buffer.
            demand[p.id] = max(0, expected - current)
            surplus[p.id] = max(0, current - round(expected * 1.2))
        deficit_sites = [p for p in phcs if demand[p.id] > 0]
        donor_sites = [p for p in phcs if surplus[p.id] > 0]
        if not deficit_sites or not donor_sites:
            summaries.append({"item": item, "unmet_units": sum(demand.values())})
            continue
        if pulp:
            problem = pulp.LpProblem(f"redistribute_{item.replace(' ', '_')}", pulp.LpMinimize)
            x = {(s.id, t.id): pulp.LpVariable(f"x_{s.id}_{t.id}", lowBound=0, cat="Integer")
                 for s in donor_sites for t in deficit_sites if s.id != t.id}
            unmet = {t.id: pulp.LpVariable(f"unmet_{t.id}", lowBound=0, cat="Integer") for t in deficit_sites}
            problem += pulp.lpSum(x[key] * haversine_km(next(p for p in donor_sites if p.id == key[0]),
                                                           next(p for p in deficit_sites if p.id == key[1]))
                                  for key in x) + pulp.lpSum(unmet.values()) * 10000
            for s in donor_sites:
                problem += pulp.lpSum(var for (sid, _), var in x.items() if sid == s.id) <= surplus[s.id]
            for t in deficit_sites:
                problem += pulp.lpSum(var for (_, tid), var in x.items() if tid == t.id) + unmet[t.id] == demand[t.id]
            problem.solve(pulp.PULP_CBC_CMD(msg=False))
            for (sid, tid), var in x.items():
                qty = int(round(var.value() or 0))
                if qty > 0:
                    src, dst = next(p for p in donor_sites if p.id == sid), next(p for p in deficit_sites if p.id == tid)
                    coverage = stock.get((tid, item), 0) / max(avg_daily.get(tid, 0) * 7, 1)
                    plan.append({"from_phc": src.id, "from_name": src.name, "to_phc": dst.id, "to_name": dst.name,
                                 "item": item, "quantity": qty, "distance_km": round(haversine_km(src, dst), 1),
                                 "priority": "Critical" if coverage < 2 else "High" if coverage < 5 else "Moderate"})
            remaining = sum(int(round(v.value() or 0)) for v in unmet.values())
        else:
            remaining = 0
            for dst in sorted(deficit_sites, key=lambda p: stock.get((p.id, item), 0) / max(avg_daily.get(p.id, 0) * 7, 1)):
                need = demand[dst.id]
                for src in sorted(donor_sites, key=lambda p: haversine_km(p, dst)):
                    qty = min(need, surplus[src.id])
                    if qty:
                        plan.append({"from_phc": src.id, "from_name": src.name, "to_phc": dst.id, "to_name": dst.name,
                                     "item": item, "quantity": qty, "distance_km": round(haversine_km(src, dst), 1),
                                     "priority": "High"})
                        need -= qty
                        surplus[src.id] -= qty
                    if not need: break
                remaining += need
        summaries.append({"item": item, "unmet_units": remaining})
    plan.sort(key=lambda p: (0 if p["priority"] == "Critical" else 1, p["distance_km"]))
    return {"plan": plan, "summary": summaries, "solver": "PuLP CBC" if pulp else "greedy fallback"}
