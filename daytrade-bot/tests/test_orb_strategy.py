from datetime import time

import pandas as pd

from src.models import Action
from src.strategies.orb_strategy import OpeningRangeBreakoutStrategy


def make_history(rows: list[tuple[str, float, float, float, float]]) -> pd.DataFrame:
    timestamps = [
        pd.Timestamp(f"2024-01-02 {ts}") for ts, *_ in rows
    ]
    data = {
        "open": [r[1] for r in rows],
        "high": [r[2] for r in rows],
        "low": [r[3] for r in rows],
        "close": [r[4] for r in rows],
        "volume": [1000 for _ in rows],
    }
    return pd.DataFrame(data, index=pd.DatetimeIndex(timestamps, name="timestamp"))


def make_strategy() -> OpeningRangeBreakoutStrategy:
    return OpeningRangeBreakoutStrategy(
        session_open_time=time(10, 0),
        range_minutes=15,
        risk_reward=2.0,
        session_close_time=time(17, 20),
    )


def test_holds_while_forming_opening_range():
    strategy = make_strategy()
    history = make_history(
        [
            ("10:00:00", 100, 101, 99, 100.5),
        ]
    )
    signal = strategy.generate_signal(history, position=None)
    assert signal.action == Action.HOLD


def test_buy_signal_on_upside_breakout():
    strategy = make_strategy()
    history = make_history(
        [
            ("10:00:00", 100, 101, 99, 100.5),
            ("10:05:00", 100.5, 102, 100, 101.5),
            ("10:10:00", 101.5, 101.8, 101, 101.2),
            ("10:15:00", 101.2, 103, 101, 102.5),  # fecha acima do range (102)
        ]
    )
    signal = strategy.generate_signal(history, position=None)
    assert signal.action == Action.BUY
    assert signal.stop_loss == 99
    assert signal.take_profit == 102.5 + (102.5 - 99) * 2.0


def test_sell_signal_on_downside_breakout():
    strategy = make_strategy()
    history = make_history(
        [
            ("10:00:00", 100, 101, 99, 100.5),
            ("10:05:00", 100.5, 102, 100, 101.5),
            ("10:10:00", 101.5, 101.8, 101, 101.2),
            ("10:15:00", 101.2, 101.5, 97, 98),  # fecha abaixo do range (99)
        ]
    )
    signal = strategy.generate_signal(history, position=None)
    assert signal.action == Action.SELL
    assert signal.stop_loss == 102
    assert signal.take_profit == 98 - (102 - 98) * 2.0


def test_only_one_trade_per_day():
    strategy = make_strategy()
    history = make_history(
        [
            ("10:00:00", 100, 101, 99, 100.5),
            ("10:05:00", 100.5, 102, 100, 101.5),
            ("10:10:00", 101.5, 101.8, 101, 101.2),
            ("10:15:00", 101.2, 103, 101, 102.5),
        ]
    )
    first_signal = strategy.generate_signal(history, position=None)
    assert first_signal.action == Action.BUY

    more_history = pd.concat(
        [
            history,
            make_history([("10:20:00", 102.5, 104, 102, 103.5)]),
        ]
    )
    second_signal = strategy.generate_signal(more_history, position=None)
    assert second_signal.action == Action.HOLD
