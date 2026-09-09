from datetime import date

from src.risk.risk_manager import RiskManager


def make_risk_manager(**overrides) -> RiskManager:
    defaults = dict(
        initial_capital=10_000,
        risk_per_trade_pct=0.01,
        daily_loss_limit_pct=0.02,
        daily_profit_target_pct=0.03,
        max_trades_per_day=3,
        point_value=1.0,
    )
    defaults.update(overrides)
    return RiskManager(**defaults)


def test_position_size_based_on_risk_per_trade():
    rm = make_risk_manager(initial_capital=10_000, risk_per_trade_pct=0.01)
    # risco por trade = 100 (1% de 10000); stop a 2 unidades de distância
    quantity = rm.position_size(entry_price=100, stop_price=98)
    assert quantity == 50  # 100 / 2


def test_position_size_zero_when_no_stop_distance():
    rm = make_risk_manager()
    assert rm.position_size(entry_price=100, stop_price=100) == 0


def test_daily_loss_limit_blocks_new_trades():
    rm = make_risk_manager(initial_capital=10_000, daily_loss_limit_pct=0.02)
    rm.reset_day(date(2024, 1, 1))

    can_trade, _ = rm.can_open_trade()
    assert can_trade is True

    rm.register_trade_result(-250)  # ainda dentro do limite (2% = 200... excede)
    can_trade, reason = rm.can_open_trade()
    assert can_trade is False
    assert "perda" in reason


def test_daily_profit_target_locks_in_gains():
    rm = make_risk_manager(initial_capital=10_000, daily_profit_target_pct=0.03)
    rm.reset_day(date(2024, 1, 1))

    rm.register_trade_result(350)  # acima de 3% = 300
    can_trade, reason = rm.can_open_trade()
    assert can_trade is False
    assert "lucro" in reason


def test_max_trades_per_day():
    rm = make_risk_manager(max_trades_per_day=2)
    rm.reset_day(date(2024, 1, 1))

    rm.count_trade_opened()
    rm.count_trade_opened()
    can_trade, reason = rm.can_open_trade()
    assert can_trade is False
    assert "máximo" in reason


def test_reset_day_clears_daily_counters():
    rm = make_risk_manager()
    rm.reset_day(date(2024, 1, 1))
    rm.register_trade_result(-500)
    rm.count_trade_opened()

    rm.reset_day(date(2024, 1, 2))
    assert rm.daily_pnl == 0.0
    assert rm.trades_today == 0


def test_daily_loss_limit_scales_down_with_shrunken_capital():
    # depois de perder metade do capital no dia 1, o limite de perda do dia 2
    # tem que ser 2% dos 500 que restaram (10), não 2% dos 1000 originais (20)
    rm = make_risk_manager(initial_capital=1000, daily_loss_limit_pct=0.02)
    rm.reset_day(date(2024, 1, 1))
    rm.register_trade_result(-500)

    rm.reset_day(date(2024, 1, 2))
    rm.register_trade_result(-15)
    can_trade, reason = rm.can_open_trade()
    assert can_trade is False
    assert "perda" in reason
