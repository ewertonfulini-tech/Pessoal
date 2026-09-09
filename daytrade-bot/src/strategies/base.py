from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import time

import pandas as pd

from ..models import Position, Signal


class Strategy(ABC):
    """Contrato de estratégia de day trade.

    A estratégia nunca decide sozinha stop/alvo em pontos fixos sem relação
    com o mercado: ela deve basear stop e alvo em algo mensurável (range de
    abertura, ATR, etc). Quem decide o TAMANHO da posição é sempre o
    RiskManager, não a estratégia.
    """

    #: quantidade mínima de candles anteriores necessários antes de operar
    warmup_period: int = 20

    def __init__(self, session_close_time: time = time(17, 20)):
        self.session_close_time = session_close_time

    @abstractmethod
    def generate_signal(
        self, history: pd.DataFrame, position: Position | None
    ) -> Signal:
        """`history` contém apenas candles já fechados (o último = mais recente)."""

    def should_force_close(self, current_time: time) -> bool:
        """Day trade não fica com posição aberta fora do horário de sessão."""
        return current_time >= self.session_close_time
