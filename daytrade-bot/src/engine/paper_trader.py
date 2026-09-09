from __future__ import annotations

import csv
import time as time_module
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from ..data_providers.base import DataProvider
from ..models import Action, Position, Side, Trade
from ..risk.risk_manager import RiskManager
from ..strategies.base import Strategy
from ..utils.logger import get_logger


class PaperTrader:
    """Roda a estratégia em tempo real contra a fonte de dados, mas NENHUMA
    ordem real é enviada: as entradas/saídas são só anotadas num extrato
    virtual. Serve para validar a estratégia com dados ao vivo antes de
    arriscar dinheiro de verdade."""

    def __init__(
        self,
        provider: DataProvider,
        strategy: Strategy,
        risk_manager: RiskManager,
        symbol: str,
        timeframe: str,
        poll_interval_seconds: int = 30,
        warmup_days: int = 5,
        reports_dir: str = "reports",
    ):
        self.provider = provider
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.symbol = symbol
        self.timeframe = timeframe
        self.poll_interval_seconds = poll_interval_seconds
        self.warmup_days = warmup_days
        self.logger = get_logger("paper_trader")

        self.history = pd.DataFrame()
        self.position: Position | None = None
        self._last_ts = None

        self.trades_path = Path(reports_dir) / "paper_trades.csv"
        self.trades_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.trades_path.exists():
            with open(self.trades_path, "w", newline="") as f:
                csv.writer(f).writerow(
                    [
                        "side",
                        "entry_price",
                        "exit_price",
                        "quantity",
                        "opened_at",
                        "closed_at",
                        "exit_reason",
                        "pnl",
                    ]
                )

    def _bootstrap_history(self) -> None:
        end = datetime.now()
        start = end - timedelta(days=self.warmup_days)
        self.history = self.provider.get_historical(
            self.symbol, self.timeframe, start, end
        ).sort_index()
        if not self.history.empty:
            self._last_ts = self.history.index[-1]
        self.logger.info(
            "Histórico inicial carregado: %d candles.", len(self.history)
        )

    def _log_trade(self, trade: Trade) -> None:
        with open(self.trades_path, "a", newline="") as f:
            csv.writer(f).writerow(
                [
                    trade.side.value,
                    trade.entry_price,
                    trade.exit_price,
                    trade.quantity,
                    trade.opened_at,
                    trade.closed_at,
                    trade.exit_reason,
                    trade.pnl,
                ]
            )

    def _process_new_candle(self, candle: pd.Series, ts: datetime) -> None:
        self.risk_manager.reset_day(ts.date())
        self.history.loc[ts] = candle
        self.history = self.history.sort_index()

        if self.position is not None:
            self._check_exit(candle, ts)
            return

        if self.strategy.should_force_close(ts.time()):
            return

        signal = self.strategy.generate_signal(self.history, position=None)
        if signal.action not in (Action.BUY, Action.SELL):
            return

        can_trade, reason = self.risk_manager.can_open_trade()
        if not can_trade:
            self.logger.info("Sinal ignorado (%s): %s", signal.action.value, reason)
            return

        side = Side.LONG if signal.action == Action.BUY else Side.SHORT
        entry_price = float(candle["close"])
        quantity = self.risk_manager.position_size(entry_price, signal.stop_loss)
        if quantity <= 0:
            self.logger.info("Quantidade calculada é zero, sinal ignorado.")
            return

        self.risk_manager.count_trade_opened()
        self.position = Position(
            side=side,
            entry_price=entry_price,
            quantity=quantity,
            stop_loss=signal.stop_loss,
            take_profit=signal.take_profit,
            opened_at=ts,
        )
        self.logger.info(
            "[PAPER] Entrada %s @ %.2f | qtd=%s stop=%.2f alvo=%.2f | %s",
            side.value,
            entry_price,
            quantity,
            signal.stop_loss,
            signal.take_profit,
            signal.reason,
        )

    def _check_exit(self, candle: pd.Series, ts: datetime) -> None:
        position = self.position
        exit_price = None
        exit_reason = None

        if position.side == Side.LONG:
            if candle["low"] <= position.stop_loss:
                exit_price, exit_reason = position.stop_loss, "stop"
            elif candle["high"] >= position.take_profit:
                exit_price, exit_reason = position.take_profit, "alvo"
        else:
            if candle["high"] >= position.stop_loss:
                exit_price, exit_reason = position.stop_loss, "stop"
            elif candle["low"] <= position.take_profit:
                exit_price, exit_reason = position.take_profit, "alvo"

        if exit_price is None and self.strategy.should_force_close(ts.time()):
            exit_price, exit_reason = float(candle["close"]), "fechamento do pregão"

        if exit_price is None:
            return

        direction = 1 if position.side == Side.LONG else -1
        pnl = (
            direction
            * (exit_price - position.entry_price)
            * position.quantity
            * self.risk_manager.point_value
        )
        self.risk_manager.register_trade_result(pnl)
        trade = Trade(
            side=position.side,
            entry_price=position.entry_price,
            exit_price=exit_price,
            quantity=position.quantity,
            opened_at=position.opened_at,
            closed_at=ts,
            exit_reason=exit_reason,
            pnl=pnl,
        )
        self._log_trade(trade)
        self.logger.info(
            "[PAPER] Saída (%s) @ %.2f | PnL=%.2f | capital=%.2f",
            exit_reason,
            exit_price,
            pnl,
            self.risk_manager.current_capital,
        )
        self.position = None

    def run(self) -> None:
        self._bootstrap_history()
        self.logger.info(
            "Paper trading iniciado para %s (%s). Nenhuma ordem real será enviada.",
            self.symbol,
            self.timeframe,
        )
        try:
            while True:
                candle = self.provider.get_latest_candle(self.symbol, self.timeframe)
                if candle is not None:
                    ts = candle.name
                    if self._last_ts is None or ts > self._last_ts:
                        self._process_new_candle(candle, ts)
                        self._last_ts = ts
                time_module.sleep(self.poll_interval_seconds)
        except KeyboardInterrupt:
            self.logger.info("Paper trading interrompido pelo usuário.")
