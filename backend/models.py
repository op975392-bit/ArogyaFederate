from datetime import date
from sqlalchemy import Date, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base

class PHC(Base):
    __tablename__ = "phcs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    district: Mapped[str] = mapped_column(String(80), index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    bed_capacity: Mapped[int] = mapped_column(Integer)
    occupied_beds: Mapped[int] = mapped_column(Integer, default=0)
    staff_count: Mapped[int] = mapped_column(Integer)
    staff_present: Mapped[int] = mapped_column(Integer)
    inventory: Mapped[list["Inventory"]] = relationship(back_populates="phc", cascade="all, delete-orphan")

class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (UniqueConstraint("phc_id", "item", name="uq_phc_item"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phc_id: Mapped[int] = mapped_column(ForeignKey("phcs.id"), index=True)
    item: Mapped[str] = mapped_column(String(80), index=True)
    stock: Mapped[int] = mapped_column(Integer, default=0)
    expiry_date: Mapped[date] = mapped_column(Date)
    phc: Mapped[PHC] = relationship(back_populates="inventory")

class Consumption(Base):
    __tablename__ = "consumption"
    __table_args__ = (UniqueConstraint("phc_id", "item", "day", name="uq_phc_item_day"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phc_id: Mapped[int] = mapped_column(ForeignKey("phcs.id"), index=True)
    item: Mapped[str] = mapped_column(String(80), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    quantity: Mapped[int] = mapped_column(Integer)
