from __future__ import annotations

from datetime import time

import pandas as pd

from ..models import Action, Position, Signal
from .base import Strategy
from .indicators import atr as _atr


class DonchianBreakoutStrategy(Strategy):
    """Rompimento de canal Donchian (máxima/mínima dos N períodos
    anteriores) — o sistema de trend-following clássico dos "Turtle
    Traders", historicamente usado em timeframes de dias/semanas.

    Pensado para SWING TRADE, não day trade: não fecha a posição no fim do
    dia (`should_force_close` sempre retorna False) e permite que a entrada
    aconteça no dia seguinte ao sinal (`requires_same_day_entry = False`) —
    faz sentido já que numa vela diária o próximo candle É o dia seguinte.

    Use com `market.timeframe: "1d"` (ou "4h") no config.yaml, não "5m"."""

    requires_same_day_entry = False

    def __init__(
        self,
        entry_channel_period: int = 20,
        atr_period: int = 14,
        atr_mult: float = 2.0,
        risk_reward: float = 3.0,
    ):
        # session_close_time nunca é usado de fato (should_force_close está
        # sobrescrito abaixo), mas o construtor da classe-base exige um valor.
        super().__init__(session_close_time=time(23, 59, 59))
        self.entry_channel_period = entry_channel_period
        self.atr_period = atr_period
        self.atr_mult = atr_mult
        self.risk_reward = risk_reward
        self.warmup_period = max(entry_channel_period, atr_period) + 2

    def should_force_close(self, current_time: time) -> bool:
        return False

    def generate_signal(
        self, history: pd.DataFrame, position: Position | None
    ) -> Signal:
        if len(history) < self.warmup_period:
            return Signal(Action.HOLD, reason="aquecendo indicadores")

        if position is not None:
            return Signal(Action.HOLD)

        window = min(len(history), max(self.warmup_period * 5, 200))
        recent = history.iloc[-window:]

        # o canal usa só as velas ANTERIORES à atual — senão a própria vela
        # do rompimento infla o canal e o rompimento nunca acontece.
        prior = recent.iloc[:-1]
        if len(prior) < self.entry_channel_period:
            return Signal(Action.HOLD, reason="aquecendo canal Donchian")

        channel_high = prior["high"].iloc[-self.entry_channel_period :].max()
        channel_low = prior["low"].iloc[-self.entry_channel_period :].min()

        last_atr = _atr(recent, self.atr_period).iloc[-1]
        last_close = float(recent["close"].iloc[-1])

        if pd.isna(last_atr) or last_atr <= 0:
            return Signal(Action.HOLD, reason="ATR indisponível")

        if last_close > channel_high:
            stop = last_close - last_atr * self.atr_mult
            risk = last_close - stop
            target = last_close + risk * self.risk_reward
            return Signal(
                Action.BUY,
                stop_loss=stop,
                take_profit=target,
                reason=f"rompimento de alta do canal de {self.entry_channel_period} períodos",
            )

        if last_close < channel_low:
            stop = last_close + last_atr * self.atr_mult
            risk = stop - last_close
            target = last_close - risk * self.risk_reward
            return Signal(
                Action.SELL,
                stop_loss=stop,
                take_profit=target,
                reason=f"rompimento de baixa do canal de {self.entry_channel_period} períodos",
            )

        return Signal(Action.HOLD)
