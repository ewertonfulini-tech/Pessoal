from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

import pandas as pd


class DataProvider(ABC):
    @abstractmethod
    def get_historical(
        self, symbol: str, timeframe: str, start: datetime, end: datetime
    ) -> pd.DataFrame:
        """Retorna um DataFrame indexado por timestamp com colunas open, high, low, close, volume."""

    @abstractmethod
    def get_latest_candle(self, symbol: str, timeframe: str) -> pd.Series | None:
        """Retorna a última vela fechada disponível (usado no polling de paper/live trading)."""
