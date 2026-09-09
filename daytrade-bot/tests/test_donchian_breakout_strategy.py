from datetime import time

import pandas as pd

from src.models import Action
from src.strategies.donchian_breakout_strategy import DonchianBreakoutStrategy


def make_history(bars: list[tuple[float, float, float]]) -> pd.DataFrame:
    """bars = lista de (close, high, low), uma vela por dia."""
    timestamps = pd.date_range("2024-01-01", periods=len(bars), freq="1D")
    closes = [b[0] for b in bars]
    data = {
        "open": [closes[0]] + closes[:-1],
        "high": [b[1] for b in bars],
        "low": [b[2] for b in bars],
        "close": closes,
        "volume": [1000] * len(bars),
    }
    return pd.DataFrame(data, index=pd.DatetimeIndex(timestamps, name="timestamp"))


def make_strategy(**overrides) -> DonchianBreakoutStrategy:
    defaults = dict(entry_channel_period=5, atr_period=5, atr_mult=2.0, risk_reward=3.0)
    defaults.update(overrides)
    return DonchianBreakoutStrategy(**defaults)


BASE_BARS = [
    (100, 101, 99),
    (101, 102, 100),
    (99, 100, 98),
    (102, 103, 101),
    (98, 99, 97),
    (103, 104, 102),
]


def test_buy_on_upside_channel_breakout():
    strategy = make_strategy()
    history = make_history(BASE_BARS + [(110, 111, 100)])

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.BUY
    assert signal.stop_loss < 110 < signal.take_profit


def test_sell_on_downside_channel_breakout():
    strategy = make_strategy()
    history = make_history(BASE_BARS + [(90, 100, 89)])

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.SELL
    assert signal.take_profit < 90 < signal.stop_loss


def test_holds_when_close_stays_inside_the_channel():
    strategy = make_strategy()
    history = make_history(BASE_BARS + [(101, 102, 100)])

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.HOLD


def test_holds_while_warming_up_indicators():
    strategy = make_strategy()
    history = make_history(BASE_BARS[:3])

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.HOLD


def test_never_forces_close_and_allows_next_day_entry():
    strategy = make_strategy()

    assert strategy.requires_same_day_entry is False
    assert strategy.should_force_close(time(0, 0)) is False
    assert strategy.should_force_close(time(23, 59, 59)) is False
