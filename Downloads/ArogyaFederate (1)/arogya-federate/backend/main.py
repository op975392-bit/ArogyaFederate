from datetime import date, timedelta
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import Base, engine, get_db
from models import PHC, Inventory, Consumption
from optimizer import build_transfer_plan

Base.metadata.create_all(bind=engine)
app = FastAPI(title="ArogyaFederate API", version="1.0.0", description="Offline-ready PHC supply visibility and redistribution prototype")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class PHCUpdate(BaseModel):
    phc_id: int
    item: Optional[str] = None
    stock: Optional[int] = Field(default=None, ge=0)
    bed_capacity: Optional[int] = Field(default=None, ge=0)
    occupied_beds: Optional[int] = Field(default=None, ge=0)
    staff_present: Optional[int] = Field(default=None, ge=0)

class RedistributeRequest(BaseModel):
    item: Optional[str] = None

class TransferApproval(BaseModel):
    from_phc: int
    to_phc: int
    item: str
    quantity: int = Field(gt=0)

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ArogyaFederate", "date": date.today().isoformat()}

def phc_payload(db: Session, p: PHC):
    rows = db.query(Inventory).filter(Inventory.phc_id == p.id).all()
    avg = {item: daily or 0 for item, daily in db.query(Consumption.item, func.avg(Consumption.quantity))
           .filter(Consumption.phc_id == p.id).group_by(Consumption.item).all()}
    stocks = {}
    risks = []
    for row in rows:
        daily = avg.get(row.item, 0)
        if row.stock <= 0: risk = "Red"
        elif row.stock < daily * 7: risk = "Yellow"
        else: risk = "Green"
        risks.append(risk)
        stocks[row.item] = {"stock": row.stock, "expiry_date": row.expiry_date.isoformat(),
                            "avg_daily_use": round(daily, 1), "risk": risk}
    risk = "Red" if "Red" in risks else "Yellow" if "Yellow" in risks else "Green"
    return {"id": p.id, "name": p.name, "district": p.district, "latitude": p.latitude, "longitude": p.longitude,
            "bed_capacity": p.bed_capacity, "occupied_beds": p.occupied_beds, "staff_count": p.staff_count,
            "staff_present": p.staff_present, "risk": risk, "stocks": stocks}

@app.get("/api/phcs")
def list_phcs(db: Session = Depends(get_db)):
    phcs = db.query(PHC).order_by(PHC.district, PHC.name).all()
    values = [phc_payload(db, p) for p in phcs]
    return {"phcs": values, "stats": {"total_phcs": len(values), "critical": sum(p["risk"] == "Red" for p in values),
            "at_risk": sum(p["risk"] == "Yellow" for p in values), "safe": sum(p["risk"] == "Green" for p in values),
            "beds_available": sum(p["bed_capacity"] - p["occupied_beds"] for p in values),
            "staff_present": sum(p["staff_present"] for p in values)}}

@app.post("/api/phc/update")
def update_phc(payload: PHCUpdate, db: Session = Depends(get_db)):
    phc = db.get(PHC, payload.phc_id)
    if not phc: raise HTTPException(404, "PHC not found")
    for field in ("bed_capacity", "occupied_beds", "staff_present"):
        value = getattr(payload, field)
        if value is not None: setattr(phc, field, value)
    if phc.occupied_beds > phc.bed_capacity: raise HTTPException(400, "Occupied beds cannot exceed bed capacity")
    if phc.staff_present is not None and phc.staff_present > phc.staff_count: raise HTTPException(400, "Present staff cannot exceed staff count")
    if payload.stock is not None:
        if not payload.item: raise HTTPException(400, "item is required when updating stock")
        row = db.query(Inventory).filter_by(phc_id=phc.id, item=payload.item).first()
        if not row: raise HTTPException(404, "Inventory item not found")
        row.stock = payload.stock
    db.commit()
    return {"message": "PHC updated", "phc": phc_payload(db, phc)}

@app.get("/api/forecast/{phc_id}/{item}")
def forecast(phc_id: int, item: str, db: Session = Depends(get_db)):
    phc = db.get(PHC, phc_id)
    if not phc: raise HTTPException(404, "PHC not found")
    records = db.query(Consumption).filter_by(phc_id=phc_id, item=item).order_by(Consumption.day).all()
    if not records: raise HTTPException(404, "No consumption history for this item")
    history = [max(0, float(r.quantity)) for r in records]
    # Lag/weekday features + Random Forest; recursive forecast keeps the dependency light and local.
    predictions = []
    try:
        import numpy as np
        from sklearn.ensemble import RandomForestRegressor
        X, y = [], []
        for i in range(14, len(history)):
            X.append([i, i % 7, history[i-1], history[i-7], history[i-14], sum(history[i-7:i])/7])
            y.append(history[i])
        model = RandomForestRegressor(n_estimators=100, max_depth=5, random_state=42, n_jobs=1)
        model.fit(np.array(X), np.array(y))
        seq = history[:]
        for i in range(len(history), len(history) + 30):
            features = [[i, i % 7, seq[-1], seq[-7], seq[-14], sum(seq[-7:])/7]]
            value = max(0, float(model.predict(features)[0]))
            predictions.append(round(value, 1)); seq.append(value)
        model_name = "Random Forest (lag features)"
    except ImportError:
        weekly = sum(history[-7:]) / min(7, len(history))
        predictions = [round(max(0, weekly * (1.06 if (i % 7) < 5 else 0.88)), 1) for i in range(30)]
        model_name = "7-day seasonal average (fallback)"
    today = date.today()
    historical = [{"date": r.day.isoformat(), "actual": r.quantity} for r in records[-30:]]
    predicted = [{"date": (today + timedelta(days=i+1)).isoformat(), "predicted": val} for i, val in enumerate(predictions)]
    return {"phc_id": phc_id, "phc_name": phc.name, "item": item, "model": model_name,
            "history": historical, "forecast": predicted, "predicted_30d_total": round(sum(predictions)),
            "current_stock": (db.query(Inventory.stock).filter_by(phc_id=phc_id, item=item).scalar() or 0)}

@app.post("/api/redistribute")
def redistribute(payload: RedistributeRequest = RedistributeRequest(), db: Session = Depends(get_db)):
    return build_transfer_plan(db, payload.item)

@app.post("/api/redistribute/approve")
def approve_transfer(payload: TransferApproval, db: Session = Depends(get_db)):
    source = db.query(Inventory).filter_by(phc_id=payload.from_phc, item=payload.item).first()
    target = db.query(Inventory).filter_by(phc_id=payload.to_phc, item=payload.item).first()
    if not source or not target: raise HTTPException(404, "Source or destination inventory not found")
    if source.stock < payload.quantity: raise HTTPException(409, "Source no longer has enough stock; refresh recommendations")
    source.stock -= payload.quantity
    target.stock += payload.quantity
    db.commit()
    return {"message": "Transfer approved and stock balances updated", "from_stock": source.stock, "to_stock": target.stock}

@app.get("/api/federation/status")
def federation_status():
    return {"mode": "simulation", "round": 8, "nodes": [
        {"country": "India", "node": "Node_India", "status": "Connected", "samples": 1280},
        {"country": "Brazil", "node": "Node_Brazil", "status": "Connected", "samples": 940},
        {"country": "South Africa", "node": "Node_SouthAfrica", "status": "Standby", "samples": 760}],
        "global_mae": 2.7, "privacy": "Raw records remain on local nodes; only model parameters are aggregated."}
