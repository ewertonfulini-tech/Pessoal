from __future__ import annotations

from datetime import time

import pandas as pd

from ..models import Action, Position, Signal
from .base import Strategy
from .indicators import atr as _atr


class FundingRateContrarianStrategy(Strategy):
    """Usa o funding rate de futuros perpétuos como sinal contrário: quando
    está muito positivo (comprados pagando caro para os vendidos — mercado
    "requentado" de posições compradas), aposta numa correção para baixo;
    quando muito negativo, aposta numa correção para cima.

    Importante: isto NÃO é a arbitragem de funding "de verdade" (que trava o
    resultado do funding com uma posição neutra à direção, comprada no
    mercado à vista e vendida no futuro, ou vice-versa). Esta versão ainda
    aposta em direção de preço — só usa uma fonte de informação diferente
    (posicionamento do mercado) em vez de indicador técnico de preço."""

    def __init__(
        self,
        extreme_threshold: float = 0.0005,
        atr_period: int = 14,
        atr_mult: float = 1.5,
        risk_reward: float = 1.5,
        session_close_time: time = time(23, 55),
    ):
        super().__init__(session_close_time)
        self.extreme_threshold = extreme_threshold
        self.atr_period = atr_period
        self.atr_mult = atr_mult
        self.risk_reward = risk_reward
        self.warmup_period = atr_period + 2

    def generate_signal(
        self, history: pd.DataFrame, position: Position | None
    ) -> Signal:
        if len(history) < self.warmup_period:
            return Signal(Action.HOLD, reason="aquecendo indicadores")

        if position is not None:
            return Signal(Action.HOLD)

        if "funding_rate" not in history.columns:
            return Signal(Action.HOLD, reason="funding rate indisponível")

        last_funding = history["funding_rate"].ffill().iloc[-1]
        if pd.isna(last_funding):
            return Signal(Action.HOLD, reason="funding rate indisponível")

        window = min(len(history), max(self.warmup_period * 5, 200))
        recent = history.iloc[-window:]
        last_atr = _atr(recent, self.atr_period).iloc[-1]
        last_close = float(recent["close"].iloc[-1])

        if pd.isna(last_atr) or last_atr <= 0:
            return Signal(Action.HOLD, reason="ATR indisponível")

        if last_funding > self.extreme_threshold:
            stop = last_close + last_atr * self.atr_mult
            risk = stop - last_close
            target = last_close - risk * self.risk_reward
            return Signal(
                Action.SELL,
                stop_loss=stop,
                take_profit=target,
                reason=f"funding rate muito positivo ({last_funding:.4%}), aposta contrária",
            )

        if last_funding < -self.extreme_threshold:
            stop = last_close - last_atr * self.atr_mult
            risk = last_close - stop
            target = last_close + risk * self.risk_reward
            return Signal(
                Action.BUY,
                stop_loss=stop,
                take_profit=target,
                reason=f"funding rate muito negativo ({last_funding:.4%}), aposta contrária",
            )

        return Signal(Action.HOLD)
