from __future__ import annotations

from datetime import datetime

from ..models import Side
from .base import Broker, BrokerPosition


class MT5Broker(Broker):
    """Envio de ordens reais via MetaTrader 5. Só funciona no Windows, com o
    terminal MT5 aberto e logado numa conta (demo ou real).

    Cuidado: métodos aqui enviam ordens de verdade quando conectados a uma
    conta real. Sempre valide em conta demo antes.
    """

    def __init__(self, magic_number: int = 123456, deviation: int = 20):
        try:
            import MetaTrader5 as mt5
        except ImportError as exc:
            raise ImportError(
                "Pacote MetaTrader5 não instalado ou não suportado neste SO "
                "(só funciona no Windows). Rode: pip install MetaTrader5"
            ) from exc

        self._mt5 = mt5
        self.magic_number = magic_number
        self.deviation = deviation

    def get_account_balance(self) -> float:
        info = self._mt5.account_info()
        if info is None:
            raise RuntimeError(f"Não foi possível ler a conta MT5: {self._mt5.last_error()}")
        return float(info.balance)

    def _to_broker_position(self, position) -> BrokerPosition:
        side = Side.LONG if position.type == self._mt5.ORDER_TYPE_BUY else Side.SHORT
        return BrokerPosition(
            id=str(position.ticket),
            side=side,
            quantity=position.volume,
            entry_price=position.price_open,
        )

    def get_open_position(self, symbol: str) -> BrokerPosition | None:
        positions = self._mt5.positions_get(symbol=symbol)
        if not positions:
            return None
        return self._to_broker_position(positions[0])

    def send_market_order(
        self,
        symbol: str,
        side: Side,
        quantity: float,
        stop_loss: float,
        take_profit: float,
    ) -> BrokerPosition:
        mt5 = self._mt5
        order_type = mt5.ORDER_TYPE_BUY if side == Side.LONG else mt5.ORDER_TYPE_SELL
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise RuntimeError(f"Símbolo inválido ou sem cotação: {symbol}")
        price = tick.ask if side == Side.LONG else tick.bid

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(quantity),
            "type": order_type,
            "price": price,
            "sl": stop_loss,
            "tp": take_profit,
            "deviation": self.deviation,
            "magic": self.magic_number,
            "comment": "daytrade-bot",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"Falha ao enviar ordem: {result}")

        opened = self.get_open_position(symbol)
        if opened is None:
            raise RuntimeError("Ordem enviada mas posição não encontrada em seguida.")
        return opened

    def get_realized_pnl(self, position_id: str, since: datetime) -> float:
        """Soma o lucro líquido (profit + comissão + swap) dos negócios de
        fechamento associados a uma posição, para reconciliar o resultado
        real com o RiskManager (essencial para o limite de perda diária
        funcionar de verdade em conta real)."""
        deals = self._mt5.history_deals_get(since, datetime.now())
        if not deals:
            return 0.0
        ticket = int(position_id)
        return sum(
            d.profit + d.commission + d.swap
            for d in deals
            if d.position_id == ticket
        )

    def close_position(self, symbol: str) -> None:
        mt5 = self._mt5
        raw_positions = mt5.positions_get(symbol=symbol)
        if not raw_positions:
            return None
        position = raw_positions[0]

        is_long = position.type == mt5.ORDER_TYPE_BUY
        order_type = mt5.ORDER_TYPE_SELL if is_long else mt5.ORDER_TYPE_BUY
        tick = mt5.symbol_info_tick(symbol)
        price = tick.bid if is_long else tick.ask

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": position.volume,
            "type": order_type,
            "position": position.ticket,
            "price": price,
            "deviation": self.deviation,
            "magic": self.magic_number,
            "comment": "daytrade-bot-close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        result = mt5.order_send(request)
        if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
            raise RuntimeError(f"Falha ao fechar posição: {result}")
