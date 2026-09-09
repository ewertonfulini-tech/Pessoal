import os
import time as time_module
from datetime import datetime, timedelta

import pandas as pd

from ..broker.base import Broker
from ..data_providers.base import DataProvider
from ..models import Action, Side
from ..risk.risk_manager import RiskManager
from ..strategies.base import Strategy
from ..utils.logger import get_logger

_CONFIRMATION_ENV_VAR = "LIVE_TRADING_ACK"
_CONFIRMATION_VALUE = "EU_ENTENDO_O_RISCO"


class LiveTrader:
    """Envia ordens REAIS através de um Broker (MT5, Binance Futures, etc).

    Por segurança, quando `require_real_money_confirmation=True` (o padrão),
    só inicia se a variável de ambiente LIVE_TRADING_ACK=EU_ENTENDO_O_RISCO
    estiver definida explicitamente. Use `require_real_money_confirmation=False`
    apenas para testnet/conta demo, onde não há dinheiro real em risco.
    """

    def __init__(
        self,
        provider: DataProvider,
        broker: Broker,
        strategy: Strategy,
        risk_manager: RiskManager,
        symbol: str,
        timeframe: str,
        poll_interval_seconds: int = 30,
        warmup_days: int = 5,
        require_real_money_confirmation: bool = True,
    ):
        if require_real_money_confirmation and os.getenv(
            _CONFIRMATION_ENV_VAR
        ) != _CONFIRMATION_VALUE:
            raise RuntimeError(
                "Execução real bloqueada por segurança. Para operar com "
                f"dinheiro de verdade, defina a variável de ambiente "
                f"{_CONFIRMATION_ENV_VAR}={_CONFIRMATION_VALUE} conscientemente."
            )

        self.provider = provider
        self.broker = broker
        self.strategy = strategy
        self.risk_manager = risk_manager
        self.symbol = symbol
        self.timeframe = timeframe
        self.poll_interval_seconds = poll_interval_seconds
        self.warmup_days = warmup_days
        self.logger = get_logger("live_trader")

        self.history = pd.DataFrame()
        self._last_ts = None
        self._open_position_id: str | None = None
        self._open_since: datetime | None = None

    def _bootstrap_history(self) -> None:
        end = datetime.now()
        start = end - timedelta(days=self.warmup_days)
        self.history = self.provider.get_historical(
            self.symbol, self.timeframe, start, end
        ).sort_index()
        if not self.history.empty:
            self._last_ts = self.history.index[-1]

        existing = self.broker.get_open_position(self.symbol)
        if existing is not None:
            self.logger.warning(
                "Posição já aberta em %s encontrada na corretora (id=%s). "
                "O robô vai monitorá-la para fechamento por horário/limites.",
                self.symbol,
                existing.id,
            )
            self._open_position_id = existing.id
            self._open_since = datetime.now()

    def _reconcile_closed_position(self) -> None:
        if self._open_position_id is None:
            return
        current = self.broker.get_open_position(self.symbol)
        if current is not None and current.id == self._open_position_id:
            return  # ainda aberta

        pnl = self.broker.get_realized_pnl(self._open_position_id, self._open_since)
        self.risk_manager.register_trade_result(pnl)
        self.logger.info(
            "[LIVE] Posição fechada (id=%s) | PnL real=%.2f | capital=%.2f",
            self._open_position_id,
            pnl,
            self.risk_manager.current_capital,
        )
        self._open_position_id = None
        self._open_since = None

    def _process_new_candle(self, candle: pd.Series, ts: datetime) -> None:
        self.risk_manager.reset_day(ts.date())
        self.history.loc[ts] = candle
        self.history = self.history.sort_index()

        if self._open_position_id is not None:
            self._reconcile_closed_position()
            if self._open_position_id is not None and self.strategy.should_force_close(
                ts.time()
            ):
                self.logger.info("Fechando posição por horário de sessão.")
                self.broker.close_position(self.symbol)
                self._reconcile_closed_position()
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

        self.logger.info(
            "[LIVE] Enviando ordem %s @ mercado | qtd=%s stop=%.2f alvo=%.2f | %s",
            side.value,
            quantity,
            signal.stop_loss,
            signal.take_profit,
            signal.reason,
        )
        opened = self.broker.send_market_order(
            self.symbol, side, quantity, signal.stop_loss, signal.take_profit
        )
        self._open_position_id = opened.id
        self._open_since = datetime.now()
        self.risk_manager.count_trade_opened()

    def run(self) -> None:
        self.logger.warning(
            "MODO LIVE ATIVO: ordens reais serão enviadas para %s.", self.symbol
        )
        self._bootstrap_history()
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
            self.logger.info("Live trading interrompido pelo usuário.")
