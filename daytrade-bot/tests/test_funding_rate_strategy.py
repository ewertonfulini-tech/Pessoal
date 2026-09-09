import pandas as pd

from src.models import Action
from src.strategies.funding_rate_strategy import FundingRateContrarianStrategy


def make_history(closes: list[float], funding_rates: list[float]) -> pd.DataFrame:
    timestamps = pd.date_range("2024-01-02 00:00:00", periods=len(closes), freq="5min")
    data = {
        "open": [closes[0]] + closes[:-1],
        "high": [c + 1 for c in closes],
        "low": [c - 1 for c in closes],
        "close": closes,
        "volume": [1000] * len(closes),
        "funding_rate": funding_rates,
    }
    return pd.DataFrame(data, index=pd.DatetimeIndex(timestamps, name="timestamp"))


def make_strategy(**overrides) -> FundingRateContrarianStrategy:
    defaults = dict(extreme_threshold=0.0005, atr_period=5)
    defaults.update(overrides)
    return FundingRateContrarianStrategy(**defaults)


CLOSES = [100, 101, 99, 102, 98, 103, 100]


def test_sell_on_very_positive_funding_rate():
    strategy = make_strategy()
    history = make_history(CLOSES, [0.001] * len(CLOSES))

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.SELL
    assert signal.take_profit < CLOSES[-1] < signal.stop_loss


def test_buy_on_very_negative_funding_rate():
    strategy = make_strategy()
    history = make_history(CLOSES, [-0.001] * len(CLOSES))

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.BUY
    assert signal.stop_loss < CLOSES[-1] < signal.take_profit


def test_holds_when_funding_rate_is_normal():
    strategy = make_strategy()
    history = make_history(CLOSES, [0.0001] * len(CLOSES))

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.HOLD


def test_holds_when_funding_rate_column_missing():
    strategy = make_strategy()
    history = make_history(CLOSES, [0.001] * len(CLOSES)).drop(columns=["funding_rate"])

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.HOLD


def test_holds_while_warming_up_indicators():
    strategy = make_strategy()
    history = make_history([100, 99, 98], [0.001, 0.001, 0.001])

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.HOLD
