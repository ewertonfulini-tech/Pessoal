from __future__ import annotations

from datetime import time

import pandas as pd

from ..models import Action, Position, Signal
from .base import Strategy


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _rsi(series: pd.Series, period: int) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    return (100 - (100 / (1 + rs))).fillna(50)


def _atr(df: pd.DataFrame, period: int) -> pd.Series:
    prev_close = df["close"].shift(1)
    true_range = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.rolling(period).mean()


class EmaRsiStrategy(Strategy):
    """Cruzamento de médias móveis (EMA rápida x EMA lenta) filtrado por RSI,
    com stop baseado em ATR. Estratégia de tendência de curto prazo, mais
    adequada para ativos líquidos com boa volatilidade intradiária."""

    def __init__(
        self,
        fast_period: int = 9,
        slow_period: int = 21,
        rsi_period: int = 14,
        atr_period: int = 14,
        atr_mult: float = 1.5,
        risk_reward: float = 1.5,
        rsi_overbought: float = 70.0,
        rsi_oversold: float = 30.0,
        session_close_time: time = time(17, 20),
    ):
        super().__init__(session_close_time)
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.rsi_period = rsi_period
        self.atr_period = atr_period
        self.atr_mult = atr_mult
        self.risk_reward = risk_reward
        self.rsi_overbought = rsi_overbought
        self.rsi_oversold = rsi_oversold
        self.warmup_period = max(slow_period, rsi_period, atr_period) + 2

    def generate_signal(
        self, history: pd.DataFrame, position: Position | None
    ) -> Signal:
        if len(history) < self.warmup_period:
            return Signal(Action.HOLD, reason="aquecendo indicadores")

        if position is not None:
            return Signal(Action.HOLD)

        close = history["close"]
        ema_fast = _ema(close, self.fast_period)
        ema_slow = _ema(close, self.slow_period)
        rsi = _rsi(close, self.rsi_period)
        atr = _atr(history, self.atr_period)

        prev_fast, last_fast = ema_fast.iloc[-2], ema_fast.iloc[-1]
        prev_slow, last_slow = ema_slow.iloc[-2], ema_slow.iloc[-1]
        last_rsi = rsi.iloc[-1]
        last_atr = atr.iloc[-1]
        last_close = float(close.iloc[-1])

        if pd.isna(last_atr) or last_atr <= 0:
            return Signal(Action.HOLD, reason="ATR indisponível")

        crossed_up = prev_fast <= prev_slow and last_fast > last_slow
        crossed_down = prev_fast >= prev_slow and last_fast < last_slow

        if crossed_up and last_rsi < self.rsi_overbought:
            stop = last_close - last_atr * self.atr_mult
            risk = last_close - stop
            target = last_close + risk * self.risk_reward
            return Signal(
                Action.BUY,
                stop_loss=stop,
                take_profit=target,
                reason="EMA rápida cruzou acima da lenta com RSI favorável",
            )

        if crossed_down and last_rsi > self.rsi_oversold:
            stop = last_close + last_atr * self.atr_mult
            risk = stop - last_close
            target = last_close - risk * self.risk_reward
            return Signal(
                Action.SELL,
                stop_loss=stop,
                take_profit=target,
                reason="EMA rápida cruzou abaixo da lenta com RSI favorável",
            )

        return Signal(Action.HOLD)
