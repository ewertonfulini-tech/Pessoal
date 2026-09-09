from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum


class Action(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    CLOSE = "CLOSE"
    HOLD = "HOLD"


class Side(str, Enum):
    LONG = "LONG"
    SHORT = "SHORT"


@dataclass
class Candle:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Signal:
    action: Action
    stop_loss: float | None = None
    take_profit: float | None = None
    reason: str = ""


@dataclass
class Position:
    side: Side
    entry_price: float
    quantity: float
    stop_loss: float
    take_profit: float
    opened_at: datetime


@dataclass
class Trade:
    side: Side
    entry_price: float
    exit_price: float
    quantity: float
    opened_at: datetime
    closed_at: datetime
    exit_reason: str
    pnl: float
