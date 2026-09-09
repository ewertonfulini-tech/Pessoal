from __future__ import annotations

import os
from datetime import datetime

from ..models import Side
from .base import Broker, BrokerPosition


class BinanceFuturesBroker(Broker):
    """Envio de ordens reais (ou de testnet) via Binance USDT-M Futures,
    usando `ccxt`. Funciona nativamente em qualquer SO, sem VM nem terminal
    externo.

    Por padrão usa a testnet (https://testnet.binancefuture.com) — peça uma
    API key de teste lá, é dinheiro fictício mas com o motor de execução
    real da exchange.

    Futuros usam alavancagem: mesmo com `leverage=1`, a exchange pode exigir
    margem mínima e cobra taxa de funding periodicamente. Day trade que
    fecha tudo no mesmo dia evita a maior parte disso, mas confira as regras
    do símbolo antes de operar com dinheiro real.
    """

    def __init__(
        self,
        testnet: bool = True,
        leverage: int = 1,
        api_key: str | None = None,
        api_secret: str | None = None,
    ):
        try:
            import ccxt
        except ImportError as exc:
            raise ImportError(
                "Pacote ccxt não instalado. Rode: pip install ccxt"
            ) from exc

        self._exchange = ccxt.binanceusdm(
            {
                "apiKey": api_key or os.getenv("BINANCE_API_KEY", ""),
                "secret": api_secret or os.getenv("BINANCE_API_SECRET", ""),
                "enableRateLimit": True,
            }
        )
        if testnet:
            self._exchange.set_sandbox_mode(True)
        self.leverage = leverage
        self._leverage_set_for: set[str] = set()

    def _ensure_leverage(self, symbol: str) -> None:
        if symbol in self._leverage_set_for:
            return
        try:
            self._exchange.set_leverage(self.leverage, symbol)
        except Exception:
            pass  # algumas contas/símbolos já vêm com alavancagem fixa
        self._leverage_set_for.add(symbol)

    def get_account_balance(self, quote_asset: str = "USDT") -> float:
        balance = self._exchange.fetch_balance()
        return float(balance.get(quote_asset, {}).get("free", 0.0))

    def get_open_position(self, symbol: str) -> BrokerPosition | None:
        positions = self._exchange.fetch_positions([symbol])
        for p in positions:
            contracts = float(p.get("contracts") or 0)
            if contracts == 0:
                continue
            side = Side.LONG if p.get("side") == "long" else Side.SHORT
            return BrokerPosition(
                id=symbol,
                side=side,
                quantity=abs(contracts),
                entry_price=float(p.get("entryPrice") or 0.0),
            )
        return None

    def send_market_order(
        self,
        symbol: str,
        side: Side,
        quantity: float,
        stop_loss: float,
        take_profit: float,
    ) -> BrokerPosition:
        self._ensure_leverage(symbol)

        entry_side = "buy" if side == Side.LONG else "sell"
        self._exchange.create_order(symbol, "market", entry_side, quantity)

        close_side = "sell" if side == Side.LONG else "buy"
        # "STOP_MARKET"/"TAKE_PROFIT_MARKET" são os tipos nativos da Binance
        # Futures; valide numa ordem de teste na testnet antes de ir para conta real.
        self._exchange.create_order(
            symbol,
            "STOP_MARKET",
            close_side,
            quantity,
            None,
            {"stopPrice": stop_loss, "reduceOnly": True},
        )
        self._exchange.create_order(
            symbol,
            "TAKE_PROFIT_MARKET",
            close_side,
            quantity,
            None,
            {"stopPrice": take_profit, "reduceOnly": True},
        )

        position = self.get_open_position(symbol)
        if position is None:
            raise RuntimeError(
                f"Ordem enviada para {symbol} mas posição não apareceu em seguida."
            )
        return position

    def get_realized_pnl(self, position_id: str, since: datetime) -> float:
        """Aproxima o PnL líquido somando o fluxo de caixa dos negócios
        (trades) do símbolo desde a abertura da posição, já descontando
        taxas. Assume que só há uma posição por vez neste símbolo (é como o
        LiveTrader opera)."""
        symbol = position_id
        since_ms = int(since.timestamp() * 1000)
        trades = self._exchange.fetch_my_trades(symbol, since=since_ms)
        pnl = 0.0
        for trade in trades:
            cost = trade.get("cost") or (trade["price"] * trade["amount"])
            signed_cashflow = cost if trade["side"] == "sell" else -cost
            fee = trade.get("fee") or {}
            fee_cost = fee.get("cost") or 0.0
            pnl += signed_cashflow - fee_cost
        return pnl

    def close_position(self, symbol: str) -> None:
        for order in self._exchange.fetch_open_orders(symbol):
            self._exchange.cancel_order(order["id"], symbol)

        position = self.get_open_position(symbol)
        if position is None:
            return None

        close_side = "sell" if position.side == Side.LONG else "buy"
        self._exchange.create_order(
            symbol, "market", close_side, position.quantity, None, {"reduceOnly": True}
        )
