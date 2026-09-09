import pandas as pd

from src.models import Action
from src.strategies.mean_reversion_strategy import MeanReversionStrategy


def make_history(closes: list[float]) -> pd.DataFrame:
    timestamps = pd.date_range("2024-01-02 00:00:00", periods=len(closes), freq="5min")
    data = {
        "open": [closes[0]] + closes[:-1],
        "high": [c + 1 for c in closes],
        "low": [c - 1 for c in closes],
        "close": closes,
        "volume": [1000] * len(closes),
    }
    data["low"][-1] = closes[-1] - 10  # dá espaço para o ATR não ficar zerado
    return pd.DataFrame(data, index=pd.DatetimeIndex(timestamps, name="timestamp"))


def make_strategy(**overrides) -> MeanReversionStrategy:
    defaults = dict(bb_period=5, bb_std_mult=1.5, rsi_period=5, atr_period=5)
    defaults.update(overrides)
    return MeanReversionStrategy(**defaults)


def test_buy_on_oversold_dip_below_lower_band():
    strategy = make_strategy()
    closes = [100, 100, 100, 100, 100, 100, 100, 98, 96, 94, 92, 83]
    history = make_history(closes)

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.BUY
    assert signal.stop_loss < closes[-1] < signal.take_profit


def test_sell_on_overbought_spike_above_upper_band():
    strategy = make_strategy()
    closes = [100, 100, 100, 100, 100, 100, 100, 102, 104, 103, 108, 117]
    history = make_history(closes)

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.SELL
    assert signal.take_profit < closes[-1] < signal.stop_loss


def test_holds_on_flat_market_within_bands():
    strategy = make_strategy()
    closes = [100, 100.2, 99.8, 100.1, 99.9, 100, 100.1, 99.9, 100, 100.05, 99.95, 100]
    history = make_history(closes)

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.HOLD


def test_holds_while_warming_up_indicators():
    strategy = make_strategy()
    history = make_history([100, 99, 98])

    signal = strategy.generate_signal(history, position=None)

    assert signal.action == Action.HOLD


def test_holds_when_already_in_a_position():
    strategy = make_strategy()
    closes = [100, 100, 100, 100, 100, 100, 100, 98, 96, 94, 92, 83]
    history = make_history(closes)

    signal = strategy.generate_signal(history, position="qualquer coisa não-None")

    assert signal.action == Action.HOLD
