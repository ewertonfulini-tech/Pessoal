# Buscador pessoal de passagens com milhas

Monitora disponibilidade de resgates em 26 programas de fidelidade, compara tudo em reais e manda no Telegram só o que vale a pena — priorizando executiva, voos diretos e preços bem abaixo do normal da rota.

## Como funciona

1. Quatro vezes por dia (06h, 12h, 18h e 00h de Brasília) consulta o cache de disponibilidade do **seats.aero**.
2. Converte as milhas de cada programa em R$ usando o **seu** custo do milheiro (`config.yaml`), o que permite comparar Smiles com Aeroplan na mesma régua.
3. Marca como oportunidade quando o custo em R$ fica abaixo do teto que você definiu para a rota **ou** quando está ≥ 30% abaixo da mediana histórica (o histórico começa a valer após ~2 semanas de coleta).
4. Mantém só a opção mais barata por trecho/data/cabine, ordena por prioridade (executiva > econômica, direto > conexão) e envia as 5 melhores novas ao Telegram, com voos, taxas e link do programa.
5. Para cada alerta, consulta **o preço da mesma passagem em dinheiro** no Google Flights e diz se vale usar milhas (economia em R$ e quanto suas milhas rendem por milheiro) ou se compensa mais pagar.
6. Diz **como emitir com os seus programas**: usar o saldo, quantos pontos transferir da Esfera ou da Livelo (pela paridade) e, quando há assento em voo direto da Iberia ou da Delta, a opção pela **tabela fixa** da Iberia (Avios, baixa e alta temporada) ou da **LATAM Pass** (parceiras).
7. Atualiza `painel.html` com o ranking completo e guarda o histórico em `dados/historico.db`.

## Seus programas e tabela fixa

No `config.yaml`:
- `meus_programas`: preencha os saldos (opcional) para o alerta dizer se já dá para emitir ou quanto falta.
- `acesso`: quais programas você alcança e a paridade de cada transferência (levantadas em set/2026; confira antes de transferir, mudam sem aviso). Com `somente_programas_acessiveis: true`, ofertas de programas que você não alcança (Aeroplan, AAdvantage etc.) não viram alerta.
- `tabela_fixa`: valores da Iberia e da LATAM Pass (Delta) por trecho, nos dois sentidos. Preencha `temporada_alta` com o calendário do site da Iberia para o buscador escolher o valor certo de cada data.

## Instalação (≈ 20 minutos, uma vez só)

**1. seats.aero Pro** — assine em seats.aero (US$ 9,99/mês) e gere a chave em *Settings → API*.

**2. SerpApi (preço em dinheiro)** — crie conta em serpapi.com e copie a *API key*. O plano gratuito é limitado; ajuste `max_buscas_mes` no `config.yaml` ao seu plano. Sem essa chave o buscador funciona normalmente, só sem o preço em dinheiro.

**3. Bot do Telegram**
- No Telegram, fale com **@BotFather** → `/newbot` → guarde o *token*.
- Mande qualquer mensagem para o seu bot novo.
- Abra no navegador `https://api.telegram.org/bot<SEU_TOKEN>/getUpdates` e copie o número em `"chat":{"id": ...}`.

**4. GitHub (gratuito)**
- Crie um repositório **privado** e envie todos os arquivos desta pasta (incluindo `.github/`).
- Em *Settings → Secrets and variables → Actions → New repository secret*, crie:
  - `SEATS_AERO_API_KEY`
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`
  - `SERPAPI_KEY`
- Em *Actions*, abra "Buscador de milhas" e clique em **Run workflow** para o primeiro teste.

**5. Ajuste o `config.yaml`** — rotas, cabines, tetos em R$ e, principalmente, o `valor_milheiro` de cada programa. Pode editar direto no site do GitHub.

## Rodar no próprio computador (opcional)

```bash
pip install -r requirements.txt
python buscador.py --teste           # dados fictícios, sem API
export SEATS_AERO_API_KEY=...        # no Windows: set SEATS_AERO_API_KEY=...
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=...
export SERPAPI_KEY=...
python buscador.py                   # execução real
python buscador.py --sem-envio       # busca real, sem mandar ao Telegram
```

## Custos

| Item | Custo |
|---|---|
| seats.aero Pro | US$ 9,99/mês |
| GitHub Actions (repositório privado) | grátis (~120 de 2.000 min/mês) |
| SerpApi (preço em dinheiro) | plano gratuito limitado; pago se quiser mais buscas |
| Telegram | grátis |

Consumo de API: até ~20 chamadas por rodada, ~80/dia — bem abaixo do limite de 1.000/dia.

## Limitações importantes

- A tabela fixa da Iberia também é detectada por um sinal indireto: assento de resgate em voo direto operado pela Iberia, visto em outro programa da oneworld. É um forte indício, não garantia — confirme em iberia.com antes de transferir.
- **LATAM Pass: só a tabela fixa de parceiras (Delta) é detectada**, por sinal indireto (assento da Delta visto em parceiros como Virgin Atlantic). Voos da própria LATAM têm preço dinâmico e não são monitorados. A emissão pela tabela é só por telefone (4002-5700) ou WhatsApp (+56 9 6825 0850). Valores de referência: 57.000 (econômica) e 112.500 (executiva) por trecho Brasil–América do Norte — confirme com a central antes de transferir pontos.
- Os dados vêm de **cache**: um resgate pode ter sumido desde a última atualização. Confirme sempre no site do programa antes de transferir pontos.
- O custo em R$ das milhas é uma **estimativa** baseada no custo do milheiro que você informou.
- O preço em dinheiro é a tarifa só de ida mais barata do Google Flights naquela data e cabine — pode não ser exatamente o mesmo voo do resgate. É consultado só para os alertas, com cache de 24h, para não estourar a cota.
- TudoAzul, Qatar, Turkish, Singapore, Emirates e Qantas não informam número de assentos (aparecem como "n/d").
- A chave Pro do seats.aero é para **uso pessoal, não comercial**. Para virar produto, é preciso negociar licença com eles.
