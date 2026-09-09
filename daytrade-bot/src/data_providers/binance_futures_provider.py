from __future__ import annotations

import os
from datetime import datetime

import pandas as pd

from .base import DataProvider


class BinanceFuturesProvider(DataProvider):
    """Dados via Binance USDT-M Futures, usando a biblioteca `ccxt`.

    Funciona nativamente em qualquer SO (Mac incluído), sem precisar de
    terminal nenhum instalado — só a API da exchange. Por padrão aponta para
    a testnet (dados reais de mercado, mas conta de teste).
    """

    def __init__(
        self,
        testnet: bool = True,
        api_key: str | None = None,
        api_secret: str | None = None,
    ):
        try:
            import ccxt
        except ImportError as exc:
            raise ImportError(
                "Pacote ccxt não instalado. Rode: pip install ccxt"
            ) from exc

        self._exchange = ccxt.binanceusdm(
            {
                "apiKey": api_key or os.getenv("BINANCE_API_KEY", ""),
                "secret": api_secret or os.getenv("BINANCE_API_SECRET", ""),
                "enableRateLimit": True,
            }
        )
        if testnet:
            self._exchange.set_sandbox_mode(True)

    @staticmethod
    def _rows_to_dataframe(rows: list) -> pd.DataFrame:
        if not rows:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        df = pd.DataFrame(
            rows, columns=["timestamp", "open", "high", "low", "close", "volume"]
        )
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        return df.set_index("timestamp")

    def _fetch_funding_rate_history(
        self, symbol: str, start: datetime, end: datetime
    ) -> pd.DataFrame:
        """Histórico do funding rate (liquidado a cada 8h), usado como coluna
        auxiliar `funding_rate` no histórico de preços — não é essencial
        para a maioria das estratégias, então qualquer falha aqui não deve
        quebrar o backtest/paper trading (só faltará essa coluna)."""
        try:
            since = int(start.timestamp() * 1000)
            end_ms = int(end.timestamp() * 1000)
            entries: list = []
            cursor = since
            while cursor < end_ms:
                batch = self._exchange.fetch_funding_rate_history(
                    symbol, since=cursor, limit=1000
                )
                if not batch:
                    break
                entries.extend(batch)
                next_cursor = batch[-1]["timestamp"] + 1
                if next_cursor <= cursor or len(batch) < 1000:
                    break
                cursor = next_cursor

            if not entries:
                return pd.DataFrame(columns=["funding_rate"])

            funding_df = pd.DataFrame(
                {
                    "timestamp": [
                        pd.to_datetime(e["timestamp"], unit="ms") for e in entries
                    ],
                    "funding_rate": [e["fundingRate"] for e in entries],
                }
            )
            return funding_df.set_index("timestamp").sort_index()
        except Exception:
            return pd.DataFrame(columns=["funding_rate"])

    def get_historical(
        self, symbol: str, timeframe: str, start: datetime, end: datetime
    ) -> pd.DataFrame:
        since = int(start.timestamp() * 1000)
        end_ms = int(end.timestamp() * 1000)
        rows: list = []

        while since < end_ms:
            batch = self._exchange.fetch_ohlcv(
                symbol, timeframe, since=since, limit=1000
            )
            if not batch:
                break
            rows.extend(batch)
            next_since = batch[-1][0] + 1
            if next_since <= since or len(batch) < 1000:
                break
            since = next_since

        df = self._rows_to_dataframe(rows)
        if df.empty:
            return df
        df = df[(df.index >= start) & (df.index <= end)].sort_index()

        funding_df = self._fetch_funding_rate_history(symbol, start, end)
        if funding_df.empty:
            df["funding_rate"] = float("nan")
            return df

        merged = pd.merge_asof(
            df, funding_df, left_index=True, right_index=True, direction="backward"
        )
        merged.index = df.index
        return merged

    def get_latest_candle(self, symbol: str, timeframe: str) -> pd.Series | None:
        # o último candle retornado pela Binance ainda está em formação;
        # o penúltimo é o último já fechado.
        batch = self._exchange.fetch_ohlcv(symbol, timeframe, limit=2)
        df = self._rows_to_dataframe(batch)
        if len(df) < 2:
            return None
        candle = df.iloc[-2].copy()
        try:
            funding = self._exchange.fetch_funding_rate(symbol)
            candle["funding_rate"] = funding.get("fundingRate")
        except Exception:
            candle["funding_rate"] = float("nan")
        return candle
