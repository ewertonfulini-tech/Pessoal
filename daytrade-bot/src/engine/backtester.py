from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import pandas as pd

from ..data_providers.base import DataProvider
from ..models import Action, Position, Side, Trade
from ..risk.risk_manager import RiskManager
from ..strategies.base import Strategy


@dataclass
class BacktestResult:
    trades: list[Trade] = field(default_factory=list)
    equity_curve: list[tuple[datetime, float]] = field(default_factory=list)
    initial_capital: float = 0.0
    final_capital: float = 0.0

    @property
    def total_trades(self) -> int:
        return len(self.trades)

    @property
    def win_rate(self) -> float:
        if not self.trades:
            return 0.0
        wins = sum(1 for t in self.trades if t.pnl > 0)
        return wins / len(self.trades)

    @property
    def profit_factor(self) -> float:
        gross_profit = sum(t.pnl for t in self.trades if t.pnl > 0)
        gross_loss = abs(sum(t.pnl for t in self.trades if t.pnl < 0))
        if gross_loss == 0:
            return math.inf if gross_profit > 0 else 0.0
        return gross_profit / gross_loss

    @property
    def total_return_pct(self) -> float:
        if self.initial_capital == 0:
            return 0.0
        return (self.final_capital - self.initial_capital) / self.initial_capital

    @property
    def max_drawdown_pct(self) -> float:
        if not self.equity_curve:
            return 0.0
        values = [v for _, v in self.equity_curve]
        peak = values[0]
        max_dd = 0.0
        for v in values:
            peak = max(peak, v)
            dd = (v - peak) / peak if peak > 0 else 0.0
            max_dd = min(max_dd, dd)
        return max_dd

    @property
    def avg_trade_pnl(self) -> float:
        if not self.trades:
            return 0.0
        return sum(t.pnl for t in self.trades) / len(self.trades)

    def print_summary(self) -> None:
        print("=" * 50)
        print("RESULTADO DO BACKTEST")
        print("=" * 50)
        print(f"Capital inicial:      R$ {self.initial_capital:,.2f}")
        print(f"Capital final:        R$ {self.final_capital:,.2f}")
        print(f"Retorno total:        {self.total_return_pct * 100:.2f}%")
        print(f"Máximo drawdown:      {self.max_drawdown_pct * 100:.2f}%")
        print(f"Total de trades:      {self.total_trades}")
        print(f"Taxa de acerto:       {self.win_rate * 100:.2f}%")
        print(f"Profit factor:        {self.profit_factor:.2f}")
        print(f"PnL médio por trade:  R$ {self.avg_trade_pnl:,.2f}")
        print("=" * 50)

    def save_reports(self, output_dir: str = "reports") -> None:
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        trades_df = pd.DataFrame([t.__dict__ for t in self.trades])
        trades_df.to_csv(out / "trades.csv", index=False)

        equity_df = pd.DataFrame(self.equity_curve, columns=["timestamp", "capital"])
        equity_df.to_csv(out / "equity_curve.csv", index=False)


class Backtester:
    """Simula a estratégia sobre dados históricos, barra a barra, sem
    lookahead bias: o sinal é gerado com as barras já fechadas e a ordem é
    executada na ABERTURA da barra seguinte."""

    def __init__(
        self,
        provider: DataProvider,
        strategy: Strategy,
        risk_manager: RiskManager,
        symbol: str,
        timeframe: str,
        slippage_pct: float = 0.0,
        commission_per_trade: float = 0.0,
        commission_pct: float = 0.0,
    ):
        self.provider = provider
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.symbol = symbol
        self.timeframe = timeframe
        self.slippage_pct = slippage_pct
        self.commission_per_trade = commission_per_trade
        self.commission_pct = commission_pct

    def _fill_price(self, price: float, side: Side, is_entry: bool) -> float:
        direction = 1 if (side == Side.LONG) == is_entry else -1
        return price * (1 + direction * self.slippage_pct)

    def run(self, start: datetime, end: datetime) -> BacktestResult:
        df = self.provider.get_historical(self.symbol, self.timeframe, start, end)
        if df.empty:
            raise ValueError(
                f"Nenhum dado histórico retornado para {self.symbol} "
                f"({self.timeframe}) entre {start} e {end}."
            )
        df = df.sort_index()

        result = BacktestResult(initial_capital=self.risk_manager.initial_capital)
        position: Position | None = None
        start_idx = max(self.strategy.warmup_period, 1)

        if len(df) <= start_idx:
            raise ValueError(
                f"Foram retornadas só {len(df)} vela(s) para {self.symbol} "
                f"({self.timeframe}) entre {start} e {end} — poucos dados para "
                f"rodar o backtest. Confira o símbolo, o timeframe e o período, "
                f"e se a fonte de dados realmente tem histórico nesse intervalo."
            )

        for i in range(start_idx, len(df)):
            current_ts = df.index[i]
            bar = df.iloc[i]
            self.risk_manager.reset_day(current_ts.date())
            result.equity_curve.append((current_ts, self.risk_manager.current_capital))

            if position is not None:
                exit_price = None
                exit_reason = None

                if position.side == Side.LONG:
                    if bar["low"] <= position.stop_loss:
                        exit_price, exit_reason = position.stop_loss, "stop"
                    elif bar["high"] >= position.take_profit:
                        exit_price, exit_reason = position.take_profit, "alvo"
                else:
                    if bar["high"] >= position.stop_loss:
                        exit_price, exit_reason = position.stop_loss, "stop"
                    elif bar["low"] <= position.take_profit:
                        exit_price, exit_reason = position.take_profit, "alvo"

                if exit_price is None and self.strategy.should_force_close(
                    current_ts.time()
                ):
                    exit_price, exit_reason = bar["close"], "fechamento do pregão"

                if exit_price is not None:
                    fill = self._fill_price(exit_price, position.side, is_entry=False)
                    direction = 1 if position.side == Side.LONG else -1
                    notional = (position.entry_price + fill) * position.quantity
                    pnl = (
                        direction
                        * (fill - position.entry_price)
                        * position.quantity
                        * self.risk_manager.point_value
                    ) - self.commission_per_trade - (notional * self.commission_pct)
                    self.risk_manager.register_trade_result(pnl)
                    result.trades.append(
                        Trade(
                            side=position.side,
                            entry_price=position.entry_price,
                            exit_price=fill,
                            quantity=position.quantity,
                            opened_at=position.opened_at,
                            closed_at=current_ts,
                            exit_reason=exit_reason,
                            pnl=pnl,
                        )
                    )
                    position = None
                continue

            if self.strategy.should_force_close(current_ts.time()):
                continue

            history = df.iloc[: i + 1]
            signal = self.strategy.generate_signal(history, position=None)

            if signal.action not in (Action.BUY, Action.SELL):
                continue

            can_trade, _reason = self.risk_manager.can_open_trade()
            if not can_trade:
                continue

            if i + 1 >= len(df):
                continue

            entry_bar = df.iloc[i + 1]
            entry_ts = df.index[i + 1]
            if entry_ts.date() != current_ts.date():
                continue

            side = Side.LONG if signal.action == Action.BUY else Side.SHORT
            entry_price = self._fill_price(entry_bar["open"], side, is_entry=True)
            quantity = self.risk_manager.position_size(entry_price, signal.stop_loss)
            if quantity <= 0:
                continue

            self.risk_manager.count_trade_opened()
            position = Position(
                side=side,
                entry_price=entry_price,
                quantity=quantity,
                stop_loss=signal.stop_loss,
                take_profit=signal.take_profit,
                opened_at=entry_ts,
            )

        result.final_capital = self.risk_manager.current_capital
        return result
