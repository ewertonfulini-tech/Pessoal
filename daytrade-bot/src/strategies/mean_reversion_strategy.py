from __future__ import annotations

from datetime import time

import pandas as pd

from ..models import Action, Position, Signal
from .base import Strategy
from .indicators import atr as _atr, rsi as _rsi


class MeanReversionStrategy(Strategy):
    """Reversão à média com Bandas de Bollinger + RSI: compra quando o preço
    fecha abaixo da banda inferior com RSI sobrevendido (aposta que o preço
    volta para a média), vende quando fecha acima da banda superior com RSI
    sobrecomprado. O alvo é a própria média móvel; o stop fica além da banda
    tocada.

    É o oposto de uma estratégia de rompimento como o ORB: faz mais sentido
    em mercado lateral/picotado, e tende a se sair mal em tendências fortes
    (o preço pode continuar "esticando" contra a entrada)."""

    def __init__(
        self,
        bb_period: int = 20,
        bb_std_mult: float = 2.0,
        rsi_period: int = 14,
        rsi_oversold: float = 30.0,
        rsi_overbought: float = 70.0,
        atr_period: int = 14,
        atr_mult: float = 1.5,
        session_close_time: time = time(23, 55),
    ):
        super().__init__(session_close_time)
        self.bb_period = bb_period
        self.bb_std_mult = bb_std_mult
        self.rsi_period = rsi_period
        self.rsi_oversold = rsi_oversold
        self.rsi_overbought = rsi_overbought
        self.atr_period = atr_period
        self.atr_mult = atr_mult
        self.warmup_period = max(bb_period, rsi_period, atr_period) + 2

    def generate_signal(
        self, history: pd.DataFrame, position: Position | None
    ) -> Signal:
        if len(history) < self.warmup_period:
            return Signal(Action.HOLD, reason="aquecendo indicadores")

        if position is not None:
            return Signal(Action.HOLD)

        window = min(len(history), max(self.warmup_period * 5, 200))
        recent = history.iloc[-window:]

        close = recent["close"]
        sma = close.rolling(self.bb_period).mean()
        std = close.rolling(self.bb_period).std()
        upper = sma + self.bb_std_mult * std
        lower = sma - self.bb_std_mult * std
        rsi = _rsi(close, self.rsi_period)
        atr = _atr(recent, self.atr_period)

        last_close = float(close.iloc[-1])
        last_sma = sma.iloc[-1]
        last_upper = upper.iloc[-1]
        last_lower = lower.iloc[-1]
        last_rsi = rsi.iloc[-1]
        last_atr = atr.iloc[-1]

        if pd.isna(last_sma) or pd.isna(last_atr) or last_atr <= 0:
            return Signal(Action.HOLD, reason="indicadores indisponíveis")

        if (
            last_close < last_lower
            and last_rsi < self.rsi_oversold
            and last_sma > last_close
        ):
            stop = last_close - last_atr * self.atr_mult
            return Signal(
                Action.BUY,
                stop_loss=stop,
                take_profit=float(last_sma),
                reason="preço abaixo da banda inferior + RSI sobrevendido",
            )

        if (
            last_close > last_upper
            and last_rsi > self.rsi_overbought
            and last_sma < last_close
        ):
            stop = last_close + last_atr * self.atr_mult
            return Signal(
                Action.SELL,
                stop_loss=stop,
                take_profit=float(last_sma),
                reason="preço acima da banda superior + RSI sobrecomprado",
            )

        return Signal(Action.HOLD)
