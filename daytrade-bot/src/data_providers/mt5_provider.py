import os
from datetime import datetime

import pandas as pd

from .base import DataProvider

_TIMEFRAME_MAP = {
    "1m": "TIMEFRAME_M1",
    "5m": "TIMEFRAME_M5",
    "15m": "TIMEFRAME_M15",
    "30m": "TIMEFRAME_M30",
    "1h": "TIMEFRAME_H1",
    "1d": "TIMEFRAME_D1",
}


class MT5Provider(DataProvider):
    """Fonte de dados em tempo real via terminal MetaTrader 5.

    Só funciona no Windows, com o terminal MT5 instalado e logado numa conta
    (demo ou real) da corretora que dá acesso à B3 (mini índice, mini dólar,
    ações, etc). Requer `pip install MetaTrader5`.
    """

    def __init__(self):
        try:
            import MetaTrader5 as mt5
        except ImportError as exc:
            raise ImportError(
                "Pacote MetaTrader5 não instalado ou não suportado neste SO "
                "(só funciona no Windows). Rode: pip install MetaTrader5"
            ) from exc

        self._mt5 = mt5
        if not mt5.initialize():
            raise RuntimeError(f"Falha ao iniciar o MT5: {mt5.last_error()}")

        login = os.getenv("MT5_LOGIN")
        password = os.getenv("MT5_PASSWORD")
        server = os.getenv("MT5_SERVER")
        if login and password and server:
            authorized = mt5.login(int(login), password=password, server=server)
            if not authorized:
                raise RuntimeError(f"Falha ao logar no MT5: {mt5.last_error()}")

    def _resolve_timeframe(self, timeframe: str):
        if timeframe not in _TIMEFRAME_MAP:
            raise ValueError(
                f"Timeframe '{timeframe}' não suportado. Use um de: {list(_TIMEFRAME_MAP)}"
            )
        return getattr(self._mt5, _TIMEFRAME_MAP[timeframe])

    @staticmethod
    def _rates_to_dataframe(rates) -> pd.DataFrame:
        if rates is None or len(rates) == 0:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        df = pd.DataFrame(rates)
        df["timestamp"] = pd.to_datetime(df["time"], unit="s")
        df = df.set_index("timestamp")
        df = df.rename(columns={"tick_volume": "volume"})
        return df[["open", "high", "low", "close", "volume"]]

    def get_historical(
        self, symbol: str, timeframe: str, start: datetime, end: datetime
    ) -> pd.DataFrame:
        tf = self._resolve_timeframe(timeframe)
        rates = self._mt5.copy_rates_range(symbol, tf, start, end)
        return self._rates_to_dataframe(rates)

    def get_latest_candle(self, symbol: str, timeframe: str) -> pd.Series | None:
        tf = self._resolve_timeframe(timeframe)
        # pos=1 pula a vela em formação (pos=0) e pega a última vela já fechada.
        rates = self._mt5.copy_rates_from_pos(symbol, tf, 1, 1)
        df = self._rates_to_dataframe(rates)
        if df.empty:
            return None
        return df.iloc[-1]

    def shutdown(self):
        self._mt5.shutdown()
