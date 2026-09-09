from __future__ import annotations

from datetime import date, datetime, time, timedelta

from ..models import Action, Position, Signal
from .base import Strategy


class OpeningRangeBreakoutStrategy(Strategy):
    """Opening Range Breakout (ORB): uma das estratégias intraday mais usadas
    para mini índice / mini dólar.

    Define o range (máxima/mínima) dos primeiros `range_minutes` do pregão e
    entra comprado no rompimento da máxima ou vendido no rompimento da
    mínima, com stop no lado oposto do range. Faz no máximo 1 entrada por dia
    (o RiskManager ainda pode bloquear a entrada por limites diários).
    """

    warmup_period = 1

    def __init__(
        self,
        session_open_time: time = time(10, 0),
        range_minutes: int = 15,
        risk_reward: float = 2.0,
        session_close_time: time = time(17, 20),
    ):
        super().__init__(session_close_time)
        self.session_open_time = session_open_time
        self.range_minutes = range_minutes
        self.risk_reward = risk_reward
        self._range_end_time = (
            datetime.combine(date.min, session_open_time)
            + timedelta(minutes=range_minutes)
        ).time()
        self._day = None
        self._range_high = None
        self._range_low = None
        self._range_ready = False
        self._traded_today = False

    def _reset_if_new_day(self, current_date: date) -> None:
        if current_date != self._day:
            self._day = current_date
            self._range_high = None
            self._range_low = None
            self._range_ready = False
            self._traded_today = False

    def generate_signal(
        self, history, position: Position | None
    ) -> Signal:
        if history.empty:
            return Signal(Action.HOLD)

        current_ts = history.index[-1]
        self._reset_if_new_day(current_ts.date())

        if current_ts.time() < self._range_end_time:
            return Signal(Action.HOLD, reason="formando range de abertura")

        if not self._range_ready:
            today_bars = history[history.index.date == current_ts.date()]
            opening_bars = today_bars[today_bars.index.time < self._range_end_time]
            if opening_bars.empty:
                return Signal(Action.HOLD, reason="sem candles no range de abertura")
            self._range_high = float(opening_bars["high"].max())
            self._range_low = float(opening_bars["low"].min())
            self._range_ready = True

        if position is not None or self._traded_today:
            return Signal(Action.HOLD)

        range_size = self._range_high - self._range_low
        if range_size <= 0:
            return Signal(Action.HOLD, reason="range de abertura inválido")

        close = float(history["close"].iloc[-1])

        if close > self._range_high:
            stop = self._range_low
            risk = close - stop
            target = close + risk * self.risk_reward
            self._traded_today = True
            return Signal(
                Action.BUY,
                stop_loss=stop,
                take_profit=target,
                reason="rompimento de alta do range de abertura",
            )

        if close < self._range_low:
            stop = self._range_high
            risk = stop - close
            target = close - risk * self.risk_reward
            self._traded_today = True
            return Signal(
                Action.SELL,
                stop_loss=stop,
                take_profit=target,
                reason="rompimento de baixa do range de abertura",
            )

        return Signal(Action.HOLD)
