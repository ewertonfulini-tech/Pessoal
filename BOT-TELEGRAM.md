# 🤖 Bot de Telegram — lançar por mensagem

Com este bot você manda uma mensagem no Telegram (ex.: **"50 mercado"**) e o
lançamento aparece no app automaticamente (via Firestore). É **grátis** e roda
num **Cloudflare Worker** (sem instalar nada, tudo pelo navegador).

Exemplos que ele entende:
- `50 mercado` → despesa de R$50 (Alimentação)
- `gastei 89,90 na farmácia` → despesa (Saúde)
- `receita 5000 salário` → receita
- `cartao 1200 notebook 12x` → compra parcelada no 1º cartão

---

## Visão geral do que você vai fazer (uma vez, ~15 min)

1. Criar o bot no Telegram (pegar o **token**).
2. Copiar o seu **ID de sincronização** no app.
3. Gerar uma **chave de conta de serviço** do Firebase.
4. Criar um **Cloudflare Worker** e colar o código do bot.
5. Preencher as **variáveis** e conectar o **webhook** do Telegram.
6. Descobrir seu **chat_id** e testar.

---

## 1) Criar o bot no Telegram
1. No Telegram, abra o **@BotFather**.
2. Envie `/newbot`, escolha um nome e um usuário (termina em `bot`).
3. Ele te dá um **token** parecido com `123456:ABC-DEF...`. **Guarde.**

## 2) Copiar seu ID de sincronização (no app)
- Abra o app → **Configurações → Sincronização na nuvem** → em **ID de
  sincronização**, toque em **Copiar**. Guarde esse valor (é o `TARGET_UID`).

## 3) Chave de conta de serviço do Firebase
1. No **console.firebase.google.com** → engrenagem ⚙ → **Project settings**.
2. Aba **Service accounts** → **Generate new private key** → baixa um **JSON**.
3. Abra o JSON. Você vai usar três campos:
   - `project_id`  → variável `FIREBASE_PROJECT_ID`
   - `client_email` → variável `SA_CLIENT_EMAIL`
   - `private_key`  → variável `SA_PRIVATE_KEY` (o texto começa com
     `-----BEGIN PRIVATE KEY-----`)
   > ⚠️ Essa chave é secreta e dá acesso ao seu Firebase. **Nunca** compartilhe
   > nem coloque no GitHub. Ela só vai nos "Secrets" do Cloudflare.

## 4) Criar o Cloudflare Worker
1. Crie uma conta grátis em **dash.cloudflare.com** (não pede cartão).
2. Menu **Workers & Pages** → **Create application** → **Create Worker**.
3. Dê um nome (ex.: `gestor-bot`) e clique **Deploy**.
4. Clique em **Edit code**, apague o exemplo e **cole todo o conteúdo** do
   arquivo [`bot/telegram-worker.js`](bot/telegram-worker.js). Clique em
   **Deploy** (salvar).
5. Copie a **URL do Worker** (algo como
   `https://gestor-bot.SEU-USUARIO.workers.dev`).

## 5) Preencher as variáveis do Worker
No Worker, vá em **Settings → Variables and Secrets** (ou "Variables") e
adicione (use **Encrypt/Secret** para as sensíveis):

| Nome | Valor |
|------|-------|
| `TELEGRAM_TOKEN` 🔒 | token do passo 1 |
| `SA_JSON` 🔒 | **cole o conteúdo inteiro do arquivo `.json`** da conta de serviço (abra o arquivo, selecione tudo, copie e cole aqui) |
| `TARGET_UID` | seu ID de sincronização (passo 2) |
| `WEBHOOK_SECRET` 🔒 | uma senha só com letras/números/`_`/`-` (ex.: `gestorbot2026`) |

> 💡 `SA_JSON` substitui os três campos separados e evita erros com as quebras de
> linha da chave. (Se preferir, ainda dá para usar `FIREBASE_PROJECT_ID`,
> `SA_CLIENT_EMAIL` e `SA_PRIVATE_KEY` no lugar de `SA_JSON`.)

Clique em **Deploy** para salvar. (O `ALLOWED_CHAT_ID` a gente adiciona no passo 6.)

## 6) Conectar o webhook do Telegram
Abra esta URL no navegador (troque os valores em MAIÚSCULO):

```
https://api.telegram.org/botSEU_TELEGRAM_TOKEN/setWebhook?url=URL_DO_WORKER&secret_token=SEU_WEBHOOK_SECRET
```

Deve responder `{"ok":true,...}`.

## 7) Descobrir seu chat_id e travar o bot para você
1. No Telegram, abra seu bot e envie `/id`. Ele responde **seu chat_id** (um número).
2. Volte ao Worker → **Variables** → adicione `ALLOWED_CHAT_ID` = esse número →
   **Deploy**. (Isso impede que qualquer outra pessoa use o seu bot.)

## 8) Testar 🎉
Envie ao bot: **`50 mercado`**. Ele confirma o lançamento e, em segundos, a
despesa aparece no app (com o app aberto e conectado).

---

## Dicas e observações
- **Categoria automática:** o bot tenta adivinhar pela descrição (mercado →
  Alimentação, uber → Transporte, aluguel → Moradia, farmácia → Saúde, etc.).
  Se não reconhecer, cai em **Outros** — você ajusta no app depois.
- **Data:** usa o dia de hoje (horário de Brasília).
- **Cartão:** `cartao ...` lança no **primeiro** cartão cadastrado. (Dá para
  evoluir para escolher o cartão, se você quiser.)
- **Segurança:** só o seu `ALLOWED_CHAT_ID` consegue lançar. A chave do Firebase
  fica apenas nos Secrets do Cloudflare, nunca no código publicado.
- **Custo:** Telegram e Cloudflare Workers são gratuitos para esse uso.

Se algo der errado, me diga a mensagem que o bot respondeu (ele informa o motivo,
ex.: dados não encontrados, sem cartão, etc.) que eu te ajudo a ajustar.
