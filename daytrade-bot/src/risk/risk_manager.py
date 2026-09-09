from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date


@dataclass
class RiskManager:
    """Controla tamanho de posição e os freios de segurança do dia.

    Nenhuma estratégia decide o tamanho da operação: é sempre o RiskManager,
    a partir do capital atual e da distância até o stop. Os limites diários
    (perda máxima, meta de lucro, número de trades) existem para o robô se
    desligar sozinho quando o dia já não vale a pena continuar sendo operado.
    """

    initial_capital: float
    risk_per_trade_pct: float = 0.005  # 0.5% do capital arriscado por trade
    daily_loss_limit_pct: float = 0.02  # para de operar se perder 2% no dia
    daily_profit_target_pct: float | None = 0.03  # trava lucro em 3% no dia (opcional)
    max_trades_per_day: int = 4
    point_value: float = 1.0  # valor financeiro de 1 ponto/unidade de preço por contrato/ação

    current_capital: float = field(init=False)
    _day: date | None = field(default=None, init=False)
    _daily_pnl: float = field(default=0.0, init=False)
    _trades_today: int = field(default=0, init=False)

    def __post_init__(self):
        self.current_capital = self.initial_capital

    def reset_day(self, day: date) -> None:
        if day != self._day:
            self._day = day
            self._daily_pnl = 0.0
            self._trades_today = 0

    @property
    def daily_pnl(self) -> float:
        return self._daily_pnl

    @property
    def trades_today(self) -> int:
        return self._trades_today

    def can_open_trade(self) -> tuple[bool, str]:
        loss_limit = -abs(self.daily_loss_limit_pct) * self.initial_capital
        if self._daily_pnl <= loss_limit:
            return False, "limite de perda diária atingido"

        if (
            self.daily_profit_target_pct is not None
            and self._daily_pnl >= self.daily_profit_target_pct * self.initial_capital
        ):
            return False, "meta de lucro diária atingida"

        if self._trades_today >= self.max_trades_per_day:
            return False, "número máximo de trades do dia atingido"

        return True, ""

    def position_size(self, entry_price: float, stop_price: float) -> int:
        risk_amount = self.current_capital * self.risk_per_trade_pct
        risk_per_unit = abs(entry_price - stop_price) * self.point_value
        if risk_per_unit <= 0:
            return 0
        return max(0, math.floor(risk_amount / risk_per_unit))

    def register_trade_result(self, pnl: float) -> None:
        self.current_capital += pnl
        self._daily_pnl += pnl

    def count_trade_opened(self) -> None:
        """Chamado quando uma ordem é enviada, para respeitar
        max_trades_per_day mesmo enquanto a posição ainda está aberta e o
        resultado (pnl) ainda não é conhecido."""
        self._trades_today += 1
