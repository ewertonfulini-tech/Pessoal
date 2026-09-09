from datetime import datetime

import pandas as pd

from .base import DataProvider


class YFinanceProvider(DataProvider):
    """Fonte de dados gratuita, útil para backtest de ações da B3 (ex: PETR4.SA).

    Não é adequada para live/paper trading real: os dados têm atraso e o
    histórico intraday é limitado pela própria Yahoo Finance (poucos dias
    para timeframes menores que 1 dia).
    """

    def __init__(self):
        try:
            import yfinance  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "yfinance não está instalado. Rode: pip install yfinance"
            ) from exc

    def get_historical(
        self, symbol: str, timeframe: str, start: datetime, end: datetime
    ) -> pd.DataFrame:
        import yfinance as yf

        df = yf.download(
            symbol,
            start=start,
            end=end,
            interval=timeframe,
            progress=False,
            auto_adjust=False,
        )
        if df.empty:
            return df

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        df = df.rename(
            columns={
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            }
        )
        df.index.name = "timestamp"
        return df[["open", "high", "low", "close", "volume"]]

    def get_latest_candle(self, symbol: str, timeframe: str) -> pd.Series | None:
        import yfinance as yf

        df = yf.download(
            symbol, period="5d", interval=timeframe, progress=False, auto_adjust=False
        )
        if df.empty:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.rename(
            columns={
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            }
        )
        return df.iloc[-1]
