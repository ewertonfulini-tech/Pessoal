import argparse
import sys

from dotenv import load_dotenv

from .config import load_config, parse_date, parse_time
from .data_providers.base import DataProvider
from .risk.risk_manager import RiskManager
from .strategies.base import Strategy


def build_provider(config: dict) -> DataProvider:
    provider_name = config["market"]["provider"]
    if provider_name == "yfinance":
        from .data_providers.yfinance_provider import YFinanceProvider

        return YFinanceProvider()
    if provider_name == "mt5":
        from .data_providers.mt5_provider import MT5Provider

        return MT5Provider()
    if provider_name == "binance_futures":
        from .data_providers.binance_futures_provider import BinanceFuturesProvider

        exchange_config = config.get("exchange", {})
        return BinanceFuturesProvider(testnet=exchange_config.get("testnet", True))
    raise ValueError(f"Provider desconhecido: {provider_name}")


def build_strategy(config: dict) -> Strategy:
    strategy_config = config["strategy"]
    name = strategy_config["name"]
    session_close_time = parse_time(strategy_config["session_close_time"])

    if name == "orb":
        from .strategies.orb_strategy import OpeningRangeBreakoutStrategy

        return OpeningRangeBreakoutStrategy(
            session_open_time=parse_time(strategy_config["session_open_time"]),
            range_minutes=strategy_config["range_minutes"],
            risk_reward=strategy_config["risk_reward"],
            session_close_time=session_close_time,
        )
    if name == "ema_rsi":
        from .strategies.ema_rsi_strategy import EmaRsiStrategy

        return EmaRsiStrategy(session_close_time=session_close_time)

    raise ValueError(f"Estratégia desconhecida: {name}")


def build_risk_manager(config: dict) -> RiskManager:
    capital_config = config["capital"]
    return RiskManager(
        initial_capital=capital_config["initial"],
        risk_per_trade_pct=capital_config["risk_per_trade_pct"],
        daily_loss_limit_pct=capital_config["daily_loss_limit_pct"],
        daily_profit_target_pct=capital_config.get("daily_profit_target_pct"),
        max_trades_per_day=capital_config["max_trades_per_day"],
        point_value=capital_config.get("point_value", 1.0),
    )


def run_backtest(config: dict) -> None:
    from .engine.backtester import Backtester

    provider = build_provider(config)
    strategy = build_strategy(config)
    risk_manager = build_risk_manager(config)

    backtester = Backtester(
        provider=provider,
        strategy=strategy,
        risk_manager=risk_manager,
        symbol=config["market"]["symbol"],
        timeframe=config["market"]["timeframe"],
        slippage_pct=config["backtest"].get("slippage_pct", 0.0),
        commission_per_trade=config["backtest"].get("commission_per_trade", 0.0),
    )
    result = backtester.run(
        start=parse_date(config["backtest"]["start"]),
        end=parse_date(config["backtest"]["end"]),
    )
    result.print_summary()
    result.save_reports()
    print("Relatórios salvos em reports/trades.csv e reports/equity_curve.csv")


def run_paper(config: dict) -> None:
    from .engine.paper_trader import PaperTrader

    provider = build_provider(config)
    strategy = build_strategy(config)
    risk_manager = build_risk_manager(config)

    trader = PaperTrader(
        provider=provider,
        strategy=strategy,
        risk_manager=risk_manager,
        symbol=config["market"]["symbol"],
        timeframe=config["market"]["timeframe"],
        poll_interval_seconds=config["paper"].get("poll_interval_seconds", 30),
        warmup_days=config["paper"].get("warmup_days", 5),
    )
    trader.run()


def run_live(config: dict) -> None:
    from .engine.live_trader import LiveTrader

    provider_name = config["market"]["provider"]
    require_confirmation = True

    if provider_name == "mt5":
        from .broker.mt5_broker import MT5Broker

        broker = MT5Broker()
    elif provider_name == "binance_futures":
        from .broker.binance_futures_broker import BinanceFuturesBroker

        exchange_config = config.get("exchange", {})
        testnet = exchange_config.get("testnet", True)
        broker = BinanceFuturesBroker(
            testnet=testnet, leverage=exchange_config.get("leverage", 1)
        )
        # testnet não envolve dinheiro real, então dispensa a trava de confirmação.
        require_confirmation = not testnet
    else:
        print(
            "Live trading só é suportado com provider 'mt5' ou 'binance_futures'."
        )
        sys.exit(1)

    provider = build_provider(config)
    strategy = build_strategy(config)
    risk_manager = build_risk_manager(config)

    trader = LiveTrader(
        provider=provider,
        broker=broker,
        strategy=strategy,
        risk_manager=risk_manager,
        symbol=config["market"]["symbol"],
        timeframe=config["market"]["timeframe"],
        poll_interval_seconds=config["paper"].get("poll_interval_seconds", 30),
        warmup_days=config["paper"].get("warmup_days", 5),
        require_real_money_confirmation=require_confirmation,
    )
    trader.run()


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(description="Robô de day trade")
    parser.add_argument(
        "mode", choices=["backtest", "paper", "live"], help="Modo de execução"
    )
    parser.add_argument(
        "--config", default="config.yaml", help="Caminho do arquivo de configuração"
    )
    args = parser.parse_args()

    config = load_config(args.config)

    if args.mode == "backtest":
        run_backtest(config)
    elif args.mode == "paper":
        run_paper(config)
    elif args.mode == "live":
        run_live(config)


if __name__ == "__main__":
    main()
