# Robô de Day Trade

Framework em Python para testar, simular e (opcionalmente) automatizar
operações de day trade, com foco em **gestão de risco rígida** em vez de
promessas de lucro garantido.

## Aviso importante

**Nenhum robô garante lucro diário.** Day trade é uma atividade de altíssimo
risco: a maioria dos operadores perde dinheiro no longo prazo, e desempenho
passado (inclusive em backtest) não garante resultado futuro. Este projeto é
uma ferramenta de estudo e automação, não uma promessa de renda. Regras
básicas antes de arriscar dinheiro real:

1. **Sempre** rode em backtest e depois em paper trading (conta demo / sem
   dinheiro real) por semanas antes de cogitar conta real.
2. Comece com o menor capital possível em conta real, e só aumente depois de
   meses de resultado consistente em paper trading.
3. Nunca desative os limites de risco (`daily_loss_limit_pct`,
   `max_trades_per_day`) "só para testar" com dinheiro real.
4. Isto não é recomendação de investimento.

## Como funciona a arquitetura

```
Fonte de dados (yfinance ou MetaTrader5)
        │
        ▼
   Estratégia (ORB ou EMA+RSI) → gera sinal de compra/venda + stop/alvo
        │
        ▼
  Gestor de risco → decide TAMANHO da posição e se pode operar hoje
        │
        ▼
 ┌──────────────┬───────────────┬──────────────┐
 │  Backtest     │  Paper trading │  Live trading │
 │ (histórico)   │ (tempo real,   │ (ordens reais │
 │               │  sem $ real)   │  via MT5)     │
 └──────────────┴───────────────┴──────────────┘
```

- **Estratégias** (`src/strategies/`): decidem *quando* entrar e onde ficam
  stop/alvo. Vêm duas prontas:
  - `orb`: Opening Range Breakout — rompimento do range dos primeiros
    minutos do pregão. Clássica para mini índice (WIN) e mini dólar (WDO).
  - `ema_rsi`: cruzamento de médias móveis (EMA9/EMA21) filtrado por RSI,
    com stop baseado em ATR.
- **RiskManager** (`src/risk/risk_manager.py`): decide *quanto* operar, com
  base em % de risco por trade, e desliga o robô no dia se bater o limite de
  perda, a meta de lucro (trava de ganho) ou o número máximo de trades.
- **Backtester**: roda a estratégia sobre dados históricos sem look-ahead
  bias (o sinal é gerado com velas já fechadas, e a ordem é executada na
  abertura da vela seguinte).
- **PaperTrader**: roda a mesma lógica em tempo real, mas só anota as
  operações num extrato virtual — nenhuma ordem real é enviada.
- **LiveTrader**: envia ordens reais via MetaTrader5. Só liga com uma
  confirmação explícita (ver seção de live trading).

## Instalação

```bash
cd daytrade-bot
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp config.example.yaml config.yaml
cp .env.example .env
```

> Este projeto foi desenvolvido num ambiente sandbox sem acesso à internet
> para instalar dependências e rodar os testes automaticamente. O código foi
> revisado manualmente e a lógica de gestão de risco foi validada com
> asserções diretas, mas rode `pip install -r requirements.txt && pytest`
> na sua máquina antes de confiar no projeto.

## Modo 1 — Backtest (funciona em qualquer SO, é o ponto de partida)

Usa `yfinance` para baixar histórico de ações da B3 (ex: `PETR4.SA`,
`VALE3.SA`). Ajuste `config.yaml`:

```yaml
market:
  provider: yfinance
  symbol: "PETR4.SA"
  timeframe: "5m"
backtest:
  start: "2024-06-01"
  end: "2024-08-01"
```

Rode:

```bash
python -m src.main backtest
```

Isso imprime um resumo (retorno, drawdown, taxa de acerto, profit factor) e
salva `reports/trades.csv` e `reports/equity_curve.csv`.

Limitação do yfinance: histórico intraday é limitado a poucos dias/semanas
pela própria Yahoo Finance, então para testar períodos maiores use
timeframes maiores (`1d`) ou migre para uma fonte com mais histórico.

## Modo 2 — Paper trading com dados reais (recomendado antes de qualquer $ real)

Para paper trading de verdade com mini índice/mini dólar/ações via preço em
tempo real, é preciso o terminal **MetaTrader 5** rodando — e o MT5 **só
roda no Windows** (o pacote Python `MetaTrader5` se conecta ao terminal
local via API nativa do Windows). Isso significa:

1. Instale o MetaTrader 5 da sua corretora (a maioria das corretoras
   brasileiras que dão acesso à B3 via MT5 oferecem conta demo gratuita).
2. Nessa máquina Windows, instale Python e rode:
   ```
   pip install -r requirements.txt
   pip install MetaTrader5
   ```
3. Abra o MT5 e faça login numa conta **demo**.
4. Preencha `.env` com `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER` (dados da
   conta demo).
5. Configure `config.yaml`:
   ```yaml
   market:
     provider: mt5
     symbol: "WIN$"   # ou o código exato do ativo na sua corretora
     timeframe: "5m"
   ```
6. Rode:
   ```
   python -m src.main paper
   ```

O robô vai logar cada entrada/saída simulada no console, em `logs/` e em
`reports/paper_trades.csv` — sem enviar nenhuma ordem real.

## Modo 3 — Live trading (dinheiro real — use por sua conta e risco)

Só depois de validar a estratégia em paper trading por um bom tempo. Os
passos são os mesmos do paper trading, mas:

1. Troque a conta demo do MT5 por uma conta real (ou continue em demo para
   validar a integração de ordens antes — recomendado).
2. Defina no `.env`:
   ```
   LIVE_TRADING_ACK=EU_ENTENDO_O_RISCO
   ```
   Sem essa variável definida com esse valor exato, o `LiveTrader` se
   recusa a iniciar — é uma trava de segurança proposital.
3. Rode:
   ```
   python -m src.main live
   ```

O `LiveTrader` envia ordens de mercado com stop loss e take profit já
anexados na própria corretora (então mesmo que o robô trave ou a internet
caia, a corretora ainda protege a posição), fecha a posição automaticamente
no horário de fim de pregão configurado, e reconcilia o resultado real de
cada operação fechada com o `RiskManager` para que o limite de perda diária
funcione de verdade.

## Configuração de risco (`config.yaml`)

```yaml
capital:
  initial: 10000
  risk_per_trade_pct: 0.005       # 0.5% do capital arriscado por trade
  daily_loss_limit_pct: 0.02      # para no dia se perder 2%
  daily_profit_target_pct: 0.03   # trava lucro em 3% (null para desativar)
  max_trades_per_day: 4
  point_value: 1.0                 # R$ por ponto/unidade de preço (ajuste
                                    # para futuros: 1 ponto de WIN = R$0,20
                                    # por contrato — confira com a corretora)
```

## Rodando os testes

```bash
pip install -r requirements.txt
pytest
```

## Limitações conhecidas / próximos passos

- O backtest usa preenchimento na abertura da barra seguinte (sem
  look-ahead), mas não modela profundidade de livro/liquidez — para ativos
  pouco líquidos os resultados podem ser otimistas.
- `yfinance` é só para estudo/backtest; não use para decisões em tempo real.
- O `PaperTrader`/`LiveTrader` fazem *polling* (checam a última vela fechada
  periodicamente) em vez de processar tick a tick — suficiente para
  timeframes de minutos, mas não para scalping de milissegundos.
- Adicionar mais estratégias, walk-forward optimization e um filtro de
  regime de mercado (ex: só operar ORB em dias de volatilidade normal) são
  bons próximos passos antes de aumentar capital.
