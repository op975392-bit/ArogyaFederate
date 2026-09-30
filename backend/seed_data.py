"""Generate deterministic, realistic demo data. Run: python seed_data.py"""
from datetime import date, timedelta
import random
from database import Base, engine, SessionLocal
from models import PHC, Inventory, Consumption

random.seed(27)
ITEMS = ["Paracetamol", "Insulin", "Oxygen Cylinders", "Vaccines"]
DISTRICTS = {
    "District A": (22.72, 75.86),  # Indore region
    "District B": (23.18, 75.78),  # Ujjain region
    "District C": (22.97, 76.06),  # Dewas region
}
BASE_DAILY = {"Paracetamol": 18, "Insulin": 5, "Oxygen Cylinders": 2, "Vaccines": 7}

def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        db.query(Consumption).delete()
        db.query(Inventory).delete()
        db.query(PHC).delete()
        today = date.today()
        for di, (district, (lat0, lon0)) in enumerate(DISTRICTS.items()):
            for n in range(10):
                phc = PHC(
                    name=f"{district} PHC {n + 1:02d}", district=district,
                    latitude=round(lat0 + random.uniform(-0.21, 0.21), 5),
                    longitude=round(lon0 + random.uniform(-0.22, 0.22), 5),
                    bed_capacity=random.randint(12, 36), staff_count=random.randint(12, 24),
                    occupied_beds=0, staff_present=0,
                )
                phc.occupied_beds = random.randint(0, phc.bed_capacity)
                phc.staff_present = random.randint(max(5, phc.staff_count - 6), phc.staff_count)
                db.add(phc)
                db.flush()
                for item in ITEMS:
                    scale = random.uniform(0.75, 1.25)
                    daily = BASE_DAILY[item] * scale
                    # Recent-history stock profiles deliberately include critical, low and well-stocked sites.
                    profile = n % 10
                    if profile == 0:
                        stock = 0 if item in ("Insulin", "Oxygen Cylinders") else int(daily * random.uniform(3, 8))
                    elif profile in (1, 2):
                        stock = int(daily * random.uniform(5, 14))
                    elif profile in (3, 4):
                        stock = int(daily * random.uniform(18, 30))
                    else:
                        stock = int(daily * random.uniform(35, 65))
                    db.add(Inventory(phc_id=phc.id, item=item, stock=stock,
                                     expiry_date=today + timedelta(days=random.randint(75, 540))))
                    # The 90-day series has modest trend, weekday variation, and noise.
                    for age in range(89, -1, -1):
                        day = today - timedelta(days=age)
                        trend = 1 + (90 - age) * random.uniform(-0.0007, 0.0013)
                        weekday = 1.16 if day.weekday() < 5 else 0.72
                        qty = max(0, round(daily * trend * weekday + random.gauss(0, max(0.7, daily * 0.14))))
                        db.add(Consumption(phc_id=phc.id, item=item, day=day, quantity=qty))
        db.commit()
        print(f"Seeded {db.query(PHC).count()} PHCs, {db.query(Inventory).count()} stock records, "
              f"and {db.query(Consumption).count()} daily consumption records into {engine.url}.")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
