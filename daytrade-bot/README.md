# Robô de Day Trade

Framework em Python para testar, simular e (opcionalmente) automatizar
operações de day trade, com foco em **gestão de risco rígida** em vez de
promessas de lucro garantido. Pensado para rodar 100% no macOS (sem
máquina virtual, sem Windows), usando **Binance Futures** como mercado
principal — a API funciona nativamente em qualquer sistema operacional.

## Aviso importante

**Nenhum robô garante lucro diário.** Day trade é uma atividade de altíssimo
risco — mais ainda com futuros/alavancagem, onde dá para perder mais do que
o valor investido (liquidação). A maioria dos operadores perde dinheiro no
longo prazo, e desempenho passado (inclusive em backtest) não garante
resultado futuro. Este projeto é uma ferramenta de estudo e automação, não
uma promessa de renda. Regras básicas antes de arriscar dinheiro real:

1. **Sempre** rode em backtest e depois em **testnet** (dinheiro fictício)
   por semanas antes de cogitar conta real.
2. Comece com alavancagem 1x e o menor capital possível em conta real, e só
   aumente depois de meses de resultado consistente em testnet.
3. Nunca desative os limites de risco (`daily_loss_limit_pct`,
   `max_trades_per_day`) "só para testar" com dinheiro real.
4. Isto não é recomendação de investimento.

## Por que Binance Futures e não MetaTrader5/B3?

O pacote Python do MetaTrader5 só funciona chamando a API nativa do
**Windows** — não roda em macOS nem Linux, mesmo com o app MT5 para Mac (que
por baixo dos panos usa uma camada de compatibilidade que não expõe essa
API). Como a maior parte das corretoras que dão acesso à B3 (mini índice,
mini dólar, ações) para automação usa justamente MT5 ou plataformas também
Windows-only, isso inviabilizava rodar tudo direto no seu Mac.

A Binance (e exchanges de cripto em geral) expõe tudo via API REST/WebSocket
comum, sem terminal nenhum — funciona igual em Mac, Linux ou Windows via a
biblioteca `ccxt`. Além disso a Binance Futures tem uma **testnet completa**
(https://testnet.binancefuture.com): mesma API, mesmo motor de execução,
mesmos dados de mercado em tempo real, só que com saldo fictício — ou seja,
dá pra fazer "paper trading" de verdade (não uma simulação local aproximada)
sem gastar nada.

Se no futuro você quiser voltar para ações/mini-índice na B3, o projeto já
tem um provider/broker para MT5 pronto (`src/data_providers/mt5_provider.py`,
`src/broker/mt5_broker.py`) — você só precisaria de uma VPS/VM Windows
rodando 24/7 (ex: Azure, AWS, Contabo) com o terminal MT5 + Python, acessada
por RDP do seu Mac. Veja a seção "Alternativa: B3 via Windows" no final.

## Como funciona a arquitetura

```
Fonte de dados (Binance Futures via ccxt, ou yfinance/MT5)
        │
        ▼
   Estratégia (ORB ou EMA+RSI) → gera sinal de compra/venda + stop/alvo
        │
        ▼
  Gestor de risco → decide TAMANHO da posição e se pode operar hoje
        │
        ▼
 ┌──────────────┬────────────────────┬──────────────────┐
 │  Backtest     │  Paper trading      │  Live trading     │
 │ (histórico)   │ (local, sem $ real, │ (ordens reais via │
 │               │  ou testnet)        │  Binance/MT5)      │
 └──────────────┴────────────────────┴──────────────────┘
```

- **Estratégias** (`src/strategies/`): decidem *quando* entrar e onde ficam
  stop/alvo.
  - `orb`: Opening Range Breakout — rompimento do range dos primeiros
    minutos de uma janela diária configurável. Como cripto é 24/7, essa
    janela é uma convenção sua (ex: 00:00 UTC) só para dar disciplina de
    "day trade" (o robô fecha tudo perto da virada do dia).
  - `ema_rsi`: cruzamento de médias móveis (EMA9/EMA21) filtrado por RSI,
    com stop baseado em ATR.
- **RiskManager** (`src/risk/risk_manager.py`): decide *quanto* operar, com
  base em % de risco por trade, e desliga o robô no dia se bater o limite de
  perda, a meta de lucro (trava de ganho) ou o número máximo de trades.
- **Backtester**: roda a estratégia sobre dados históricos sem look-ahead
  bias (o sinal é gerado com velas já fechadas, e a ordem é executada na
  abertura da vela seguinte).
- **PaperTrader**: roda a mesma lógica em tempo real com dados reais, mas só
  anota as operações num extrato virtual local — nenhuma ordem é enviada.
- **LiveTrader**: envia ordens reais (ou de testnet) via um `Broker`
  (`Binance Futures` ou `MT5`), com stop loss/take profit registrados na
  própria exchange/corretora como rede de segurança.

## Instalação (macOS)

Requer Python 3.9 ou superior (o que já vem pré-instalado no macOS serve).

```bash
cd daytrade-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml
cp .env.example .env
```

> Este projeto foi desenvolvido num ambiente sandbox sem acesso à internet
> para instalar dependências e rodar os testes automaticamente. O código foi
> revisado manualmente e a lógica de gestão de risco foi validada com
> asserções diretas, mas rode `pip install -r requirements.txt && pytest`
> na sua máquina antes de confiar no projeto.

## Modo 1 — Backtest

Por padrão o `config.example.yaml` já vem configurado para Binance Futures
(`BTC/USDT`), que não precisa de credencial nenhuma para puxar histórico
público:

```yaml
market:
  provider: binance_futures
  symbol: "BTC/USDT"
  timeframe: "5m"
backtest:
  start: "2024-06-01"
  end: "2024-08-01"
```

Rode:

```bash
python -m src.main backtest
```

O backtest sempre busca histórico real (mainnet), mesmo que
`exchange.testnet: true` no `config.yaml` — a testnet da Binance não guarda
histórico longo o suficiente para backtest, só serve para paper/live trading
em tempo real (modos 2 e 3 abaixo).

Isso imprime um resumo (retorno, drawdown, taxa de acerto, profit factor) e
salva `reports/trades.csv` e `reports/equity_curve.csv`.

## Modo 2 — Paper trading / testnet (recomendado antes de qualquer $ real)

Duas formas de "paper trading", ambas sem dinheiro de verdade:

**a) Simulação local** (`python -m src.main paper`): usa dados reais da
Binance, mas as ordens são só anotadas localmente. Não precisa de API key.

**b) Testnet da Binance Futures (recomendado, mais realista)**: usa o motor
de execução de verdade da exchange, com saldo fictício.

1. Crie uma conta e gere API keys em https://testnet.binancefuture.com
   (é separada da sua conta real da Binance).
2. Preencha `.env`:
   ```
   BINANCE_API_KEY=sua_chave_de_teste
   BINANCE_API_SECRET=seu_secret_de_teste
   ```
3. Em `config.yaml`, mantenha `exchange.testnet: true`.
4. Rode:
   ```bash
   python -m src.main live
   ```
   Como é testnet, não precisa da variável `LIVE_TRADING_ACK` — o robô só
   exige essa confirmação quando `exchange.testnet: false` (dinheiro real).

## Modo 3 — Live trading com dinheiro real

Só depois de validar bem a estratégia na testnet. Passos:

1. Gere API keys da sua conta **real** da Binance (Configurações → API
   Management), com permissão só de "Futures" habilitada — nunca habilite
   saque (withdraw) pela API.
2. Atualize `.env` com essas chaves reais e defina em `config.yaml`:
   ```yaml
   exchange:
     testnet: false
     leverage: 1
   ```
3. Defina no `.env`:
   ```
   LIVE_TRADING_ACK=EU_ENTENDO_O_RISCO
   ```
   Sem essa variável definida com esse valor exato, o `LiveTrader` se
   recusa a iniciar — é uma trava de segurança proposital.
4. Rode:
   ```bash
   python -m src.main live
   ```

O `LiveTrader` envia a ordem de entrada a mercado e, na sequência, duas
ordens condicionais (`STOP_MARKET` e `TAKE_PROFIT_MARKET`, ambas
`reduceOnly`) já registradas na própria Binance — então mesmo que o robô
trave ou a internet caia, a exchange ainda protege a posição. Ele fecha a
posição automaticamente perto da virada do dia (horário configurado) e
reconcilia o resultado real de cada operação com o `RiskManager` para que o
limite de perda diária funcione de verdade.

## Configuração de risco (`config.yaml`)

```yaml
capital:
  initial: 1000
  risk_per_trade_pct: 0.005       # 0.5% do capital arriscado por trade
  daily_loss_limit_pct: 0.02      # para no dia se perder 2%
  daily_profit_target_pct: 0.03   # trava lucro em 3% (null para desativar)
  max_trades_per_day: 4
  point_value: 1.0                 # 1.0 para cripto/ações (1 unidade de
                                    # preço = 1 unidade de PnL por contrato)
exchange:
  testnet: true
  leverage: 1                      # comece baixo — alavancagem maior
                                    # aumenta o risco de liquidação
```

## Rodando os testes

```bash
pip install -r requirements.txt
pytest
```

## Limitações conhecidas / próximos passos

- O backtest usa preenchimento na abertura da barra seguinte (sem
  look-ahead), mas não modela profundidade de livro/liquidez — para pares
  pouco líquidos os resultados podem ser otimistas.
- Futuros cobram *funding rate* periodicamente (a cada 8h normalmente); o
  backtest atual não simula isso — para operações que fecham no mesmo dia o
  impacto costuma ser pequeno, mas confira na testnet/conta real.
- `BinanceFuturesBroker.get_realized_pnl` aproxima o resultado somando o
  fluxo de caixa dos negócios desde a abertura da posição; para auditoria
  fina, confira sempre o extrato oficial da exchange.
- O `PaperTrader`/`LiveTrader` fazem *polling* (checam a última vela fechada
  periodicamente) em vez de processar tick a tick — suficiente para
  timeframes de minutos, mas não para scalping de milissegundos.
- Adicionar mais estratégias, walk-forward optimization e um filtro de
  regime de mercado são bons próximos passos antes de aumentar capital.

## Alternativa: B3 (ações/mini-índice) via Windows

Se no futuro você quiser voltar para a bolsa brasileira em vez de cripto:

1. Suba uma VPS/VM Windows (Azure, AWS, Contabo, Vultr — tipicamente
   R$30–150/mês) e acesse por RDP do seu Mac.
2. Instale o MetaTrader 5 da sua corretora (a maioria oferece conta demo
   gratuita) e faça login.
3. Nessa mesma VM, instale Python, rode
   `pip install -r requirements.txt && pip install MetaTrader5`.
4. Em `config.yaml`, troque `market.provider` para `mt5` e `market.symbol`
   para o código do ativo na sua corretora (ex: `"WIN$"`, `"PETR4"`).
5. Preencha `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER` no `.env`.
6. `python -m src.main paper` (ou `live`, com a mesma trava
   `LIVE_TRADING_ACK` de antes).

O código de `src/data_providers/mt5_provider.py` e `src/broker/mt5_broker.py`
já está pronto para isso — nenhuma mudança de arquitetura necessária.
