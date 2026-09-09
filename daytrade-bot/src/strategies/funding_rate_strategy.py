from __future__ import annotations

from datetime import time

import pandas as pd

from ..models import Action, Position, Signal
from .base import Strategy
from .indicators import atr as _atr


class FundingRateContrarianStrategy(Strategy):
    """Usa o funding rate de futuros perpétuos como sinal contrário: quando
    está no extremo superior (comprados pagando caro para os vendidos —
    mercado "requentado" de posições compradas) da sua própria distribuição
    recente, aposta numa correção para baixo; no extremo inferior, aposta
    numa correção para cima.

    O limiar é RELATIVO (percentil sobre uma janela recente), não um valor
    fixo — o range típico do funding rate muda de regime ao longo do tempo
    (ex: comprimiu bastante entre 2024 e 2025/2026 para o BTC/USDT), então um
    limiar fixo calibrado num período pode nunca disparar em outro.

    Importante: isto NÃO é a arbitragem de funding "de verdade" (que trava o
    resultado do funding com uma posição neutra à direção, comprada no
    mercado à vista e vendida no futuro, ou vice-versa). Esta versão ainda
    aposta em direção de preço — só usa uma fonte de informação diferente
    (posicionamento do mercado) em vez de indicador técnico de preço."""

    def __init__(
        self,
        lookback_bars: int = 8640,  # ~30 dias em candles de 5m
        percentile: float = 0.95,
        min_funding_samples: int = 500,
        atr_period: int = 14,
        atr_mult: float = 1.5,
        risk_reward: float = 1.5,
        session_close_time: time = time(23, 55),
    ):
        super().__init__(session_close_time)
        self.lookback_bars = lookback_bars
        self.percentile = percentile
        self.min_funding_samples = min_funding_samples
        self.atr_period = atr_period
        self.atr_mult = atr_mult
        self.risk_reward = risk_reward
        self.warmup_period = max(atr_period, min_funding_samples) + 2

    def generate_signal(
        self, history: pd.DataFrame, position: Position | None
    ) -> Signal:
        if len(history) < self.warmup_period:
            return Signal(Action.HOLD, reason="aquecendo indicadores")

        if position is not None:
            return Signal(Action.HOLD)

        if "funding_rate" not in history.columns:
            return Signal(Action.HOLD, reason="funding rate indisponível")

        funding = history["funding_rate"].ffill()
        last_funding = funding.iloc[-1]
        if pd.isna(last_funding):
            return Signal(Action.HOLD, reason="funding rate indisponível")

        funding_window = funding.iloc[-self.lookback_bars :].dropna()
        if len(funding_window) < self.min_funding_samples:
            return Signal(Action.HOLD, reason="aquecendo distribuição de funding")

        upper = funding_window.quantile(self.percentile)
        lower = funding_window.quantile(1 - self.percentile)

        window = min(len(history), max(self.atr_period * 5, 200))
        recent = history.iloc[-window:]
        last_atr = _atr(recent, self.atr_period).iloc[-1]
        last_close = float(recent["close"].iloc[-1])

        if pd.isna(last_atr) or last_atr <= 0:
            return Signal(Action.HOLD, reason="ATR indisponível")

        if last_funding > upper and last_funding > 0:
            stop = last_close + last_atr * self.atr_mult
            risk = stop - last_close
            target = last_close - risk * self.risk_reward
            return Signal(
                Action.SELL,
                stop_loss=stop,
                take_profit=target,
                reason=(
                    f"funding no percentil {self.percentile:.0%} superior "
                    f"da janela recente ({last_funding:.4%}), aposta contrária"
                ),
            )

        if last_funding < lower and last_funding < 0:
            stop = last_close - last_atr * self.atr_mult
            risk = last_close - stop
            target = last_close + risk * self.risk_reward
            return Signal(
                Action.BUY,
                stop_loss=stop,
                take_profit=target,
                reason=(
                    f"funding no percentil {1 - self.percentile:.0%} inferior "
                    f"da janela recente ({last_funding:.4%}), aposta contrária"
                ),
            )

        return Signal(Action.HOLD)
