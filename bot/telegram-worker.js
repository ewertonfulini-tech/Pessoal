/* telegram-worker.js — Bot de Telegram para lançar despesas/receitas no app.
 *
 * Roda no Cloudflare Workers (grátis). Recebe mensagens do Telegram por webhook,
 * interpreta o texto (ex.: "50 mercado", "receita 5000 salário", "cartao 300 note 12x")
 * e grava direto no seu Firestore, no documento vaults/<seu_uid>. O app sincroniza
 * sozinho em seguida.
 *
 * Variáveis (configuradas como "Secrets"/"Variables" no Cloudflare):
 *   TELEGRAM_TOKEN      Token do bot (do @BotFather)
 *   FIREBASE_PROJECT_ID Ex.: meu-gestor-bfeda
 *   SA_CLIENT_EMAIL     E-mail da conta de serviço do Firebase
 *   SA_PRIVATE_KEY      Chave privada da conta de serviço (PEM)
 *   TARGET_UID          Seu "ID de sincronização" (Configurações → Sincronização)
 *   ALLOWED_CHAT_ID     Seu chat_id do Telegram (use /id no bot para descobrir)
 *   WEBHOOK_SECRET      (opcional) valida o cabeçalho secreto do webhook do Telegram
 *
 * Veja o passo a passo em BOT-TELEGRAM.md.
 */

const HELP =
  'Olá! Eu lanço no seu gestor financeiro. Exemplos:\n\n' +
  '• <b>50 mercado</b> → despesa de R$50 (Alimentação)\n' +
  '• <b>gastei 89,90 na farmácia</b> → despesa (Saúde)\n' +
  '• <b>receita 5000 salário</b> → receita\n' +
  '• <b>cartao 1200 notebook 12x</b> → compra parcelada no cartão\n\n' +
  'Comandos: /id (mostra seu chat_id) • /ajuda';

// Palavras-chave que ajudam a adivinhar a categoria (nome deve existir no app)
const SYNONYMS = {
  'Alimentação': ['mercado', 'supermercado', 'ifood', 'restaurante', 'almoco', 'almoço', 'janta', 'lanche', 'padaria', 'comida', 'feira'],
  'Transporte': ['uber', '99', 'gasolina', 'combustivel', 'onibus', 'ônibus', 'metro', 'metrô', 'estacionamento', 'passagem'],
  'Moradia': ['aluguel', 'luz', 'energia', 'agua', 'água', 'condominio', 'condomínio', 'gas', 'gás', 'internet'],
  'Saúde': ['farmacia', 'farmácia', 'remedio', 'remédio', 'medico', 'médico', 'consulta', 'dentista', 'academia'],
  'Lazer': ['cinema', 'bar', 'show', 'viagem', 'netflix', 'jogo', 'passeio'],
  'Educação': ['curso', 'faculdade', 'livro', 'escola', 'mensalidade'],
  'Assinaturas': ['spotify', 'assinatura', 'plano'],
  'Compras': ['roupa', 'loja', 'amazon', 'shopping', 'presente']
};

export default {
  async fetch(request, env) {
    if (request.method === 'GET') {
      return new Response('Bot ativo. Configure o webhook do Telegram para esta URL.', { status: 200 });
    }
    if (request.method !== 'POST') return new Response('ok');

    // Validação opcional do segredo do webhook
    if (env.WEBHOOK_SECRET) {
      const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
      if (got !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
    }

    let update;
    try { update = await request.json(); } catch (e) { return new Response('ok'); }
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return new Response('ok');

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    try {
      if (/^\/id\b/.test(text)) {
        await reply(env, chatId, 'Seu chat_id é: <code>' + chatId + '</code>');
        return new Response('ok');
      }
      if (/^\/(start|ajuda|help)\b/i.test(text)) {
        await reply(env, chatId, HELP);
        return new Response('ok');
      }
      if (env.ALLOWED_CHAT_ID && String(chatId) !== String(env.ALLOWED_CHAT_ID)) {
        await reply(env, chatId, 'Você não tem permissão para usar este bot.');
        return new Response('ok');
      }

      const amt = parseAmount(text);
      if (!amt) {
        await reply(env, chatId, 'Não entendi o valor 🤔. Ex.: <b>50 mercado</b> ou <b>receita 5000 salário</b>.');
        return new Response('ok');
      }

      const token = await getAccessToken(env);
      const data = await getVault(env, token);
      if (!data) {
        await reply(env, chatId, 'Não encontrei seus dados. Abra o app, faça login e sincronize uma vez, depois tente de novo.');
        return new Response('ok');
      }

      const result = applyMessage(data, text, amt);
      if (result.error) {
        await reply(env, chatId, result.error);
        return new Response('ok');
      }

      await saveVault(env, token, data);
      await reply(env, chatId, result.message);
      return new Response('ok');
    } catch (e) {
      await reply(env, chatId, '⚠️ Erro ao lançar: ' + (e && e.message ? e.message : e)).catch(function () {});
      return new Response('ok');
    }
  }
};

/* ---------- Interpretação da mensagem ---------- */

function normalize(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function parseAmount(text) {
  const m = text.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[0];
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : { value: Math.round(n * 100) / 100, raw: m[0] };
}

function findCategory(categories, type, text) {
  const n = normalize(text);
  const list = categories.filter(function (c) { return c.type === type; });
  // 1) nome da categoria aparece no texto
  for (const c of list) {
    if (n.indexOf(normalize(c.name)) > -1) return c.id;
  }
  // 2) sinônimos -> nome da categoria
  for (const catName in SYNONYMS) {
    if (SYNONYMS[catName].some(function (w) { return n.indexOf(w) > -1; })) {
      const c = list.find(function (x) { return normalize(x.name) === normalize(catName); });
      if (c) return c.id;
    }
  }
  // 3) "Outros" ou a primeira
  const outros = list.find(function (c) { return normalize(c.name) === 'outros'; });
  return outros ? outros.id : (list[0] ? list[0].id : '');
}

function cleanDescription(text, amountRaw) {
  let d = text.replace(amountRaw, ' ');
  d = d.replace(/\b(\d+)\s*x\b/gi, ' ');
  d = d.replace(/\b(gastei|paguei|comprei|recebi|ganhei|receita|entrada|salario|salário|cartao|cartão|credito|crédito|reais|no|na|de|do|da|em|um|uma)\b/gi, ' ');
  d = d.replace(/r\$/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!d) return 'Lançamento';
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function todayBR() {
  const br = new Date(Date.now() - 3 * 3600 * 1000); // UTC-3 (Brasil)
  const y = br.getUTCFullYear();
  const m = String(br.getUTCMonth() + 1).padStart(2, '0');
  const d = String(br.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function brl(n) {
  return 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function catName(categories, id) {
  const c = categories.find(function (x) { return x.id === id; });
  return c ? c.name : 'Sem categoria';
}

// Aplica a mensagem ao objeto de dados (muta data). Retorna {message} ou {error}.
function applyMessage(data, text, amt) {
  if (!Array.isArray(data.categories)) data.categories = [];
  const n = normalize(text);
  const isIncome = /\b(receita|recebi|salario|entrada|ganhei)\b/.test(n);
  const isCard = /\b(cartao|credito)\b/.test(n);
  const description = cleanDescription(text, amt.raw);

  if (isCard) {
    if (!Array.isArray(data.cards) || !data.cards.length) {
      return { error: 'Você ainda não tem cartão cadastrado. Cadastre um no app primeiro.' };
    }
    const card = data.cards[0];
    const instMatch = n.match(/(\d+)\s*x\b/);
    const installments = instMatch ? Math.max(1, parseInt(instMatch[1], 10)) : 1;
    const categoryId = findCategory(data.categories, 'expense', text);
    if (!Array.isArray(data.cardExpenses)) data.cardExpenses = [];
    data.cardExpenses.push({
      id: uid('ce'), cardId: card.id, description: description,
      totalAmount: amt.value, purchaseDate: todayBR(),
      installments: installments, categoryId: categoryId
    });
    const extra = installments > 1
      ? ' em ' + installments + 'x de ' + brl(amt.value / installments) : '';
    return { message: '💳 Compra no cartão <b>' + card.name + '</b>: ' + brl(amt.value) + extra +
      ' — "' + description + '" (' + catName(data.categories, categoryId) + ').' };
  }

  const type = isIncome ? 'income' : 'expense';
  const categoryId = findCategory(data.categories, type, text);
  if (!Array.isArray(data.transactions)) data.transactions = [];
  data.transactions.push({
    id: uid('tx'), type: type, description: description, amount: amt.value,
    date: todayBR(), categoryId: categoryId, recurrence: 'none',
    recurrenceEnd: '', accountId: ''
  });
  const icon = isIncome ? '💰' : '💸';
  const label = isIncome ? 'Receita' : 'Despesa';
  return { message: icon + ' ' + label + ' de ' + brl(amt.value) + ' — "' + description +
    '" (' + catName(data.categories, categoryId) + ') lançada hoje.' };
}

/* ---------- Autenticação da conta de serviço (JWT -> OAuth token) ---------- */

function b64url(input) {
  let bin;
  if (typeof input === 'string') {
    bin = btoa(unescape(encodeURIComponent(input)));
  } else {
    const bytes = new Uint8Array(input);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    bin = btoa(s);
  }
  return bin.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const clean = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(clean);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.SA_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  const pem = String(env.SA_PRIVATE_KEY).replace(/\\n/g, '\n');
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(sig);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Falha na autenticação da conta de serviço.');
  return data.access_token;
}

/* ---------- Firestore REST ---------- */

function firestoreBase(env) {
  return 'https://firestore.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT_ID +
    '/databases/(default)/documents';
}

async function getVault(env, token) {
  const res = await fetch(firestoreBase(env) + '/vaults/' + env.TARGET_UID, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore GET ' + res.status);
  const doc = await res.json();
  const json = doc.fields && doc.fields.json && doc.fields.json.stringValue;
  return json ? JSON.parse(json) : null;
}

async function saveVault(env, token, data) {
  const body = {
    fields: {
      json: { stringValue: JSON.stringify(data) },
      updatedAt: { integerValue: String(Date.now()) },
      device: { stringValue: 'telegram' }
    }
  };
  const url = firestoreBase(env) + '/vaults/' + env.TARGET_UID +
    '?updateMask.fieldPaths=json&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=device';
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Firestore PATCH ' + res.status);
}

/* ---------- Telegram ---------- */

async function tg(env, method, payload) {
  return fetch('https://api.telegram.org/bot' + env.TELEGRAM_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

function reply(env, chatId, text) {
  return tg(env, 'sendMessage', { chat_id: chatId, text: text, parse_mode: 'HTML' });
}
