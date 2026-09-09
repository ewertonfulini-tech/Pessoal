from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime

from ..models import Side


@dataclass
class BrokerPosition:
    id: str
    side: Side
    quantity: float
    entry_price: float


class Broker(ABC):
    """Interface comum para envio de ordens reais, para que o LiveTrader não
    precise saber se está falando com MetaTrader5, Binance ou outra
    corretora/exchange."""

    @abstractmethod
    def get_open_position(self, symbol: str) -> BrokerPosition | None:
        ...

    @abstractmethod
    def send_market_order(
        self,
        symbol: str,
        side: Side,
        quantity: float,
        stop_loss: float,
        take_profit: float,
    ) -> BrokerPosition:
        ...

    @abstractmethod
    def close_position(self, symbol: str) -> None:
        ...

    @abstractmethod
    def get_realized_pnl(self, position_id: str, since: datetime) -> float:
        ...
