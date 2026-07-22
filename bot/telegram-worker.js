/* telegram-worker.js — Bot de Telegram para lançar despesas/receitas no app.
 *
 * Roda no Cloudflare Workers (grátis). Recebe mensagens do Telegram por webhook,
 * interpreta o texto (ex.: "50 mercado", "receita 5000 salário", "cartao 300 note 12x")
 * e grava direto no seu Firestore, no documento vaults/<seu_uid>. O app sincroniza
 * sozinho em seguida.
 *
 * Variáveis (configuradas como "Secrets"/"Variables" no Cloudflare):
 *   TELEGRAM_TOKEN      Token do bot (do @BotFather)
 *   SA_JSON             Conteúdo COMPLETO do arquivo JSON da conta de serviço do
 *                       Firebase (recomendado — cole o arquivo inteiro). Substitui
 *                       FIREBASE_PROJECT_ID/SA_CLIENT_EMAIL/SA_PRIVATE_KEY.
 *   TARGET_UID          (opcional) "ID de sincronização" do dono — compatibilidade.
 *                       No modo multiusuário, cada pessoa usa /vincular SEU_ID.
 *   ALLOWED_CHAT_ID     (opcional) chat_id do dono — se definido com TARGET_UID,
 *                       o dono continua lançando sem precisar de /vincular.
 *   WEBHOOK_SECRET      (opcional) valida o cabeçalho secreto do webhook do Telegram
 *
 *   Multiusuário: cada pessoa envia "/vincular <ID de sincronização>" (do app,
 *   em Ajustes → Sincronização). O bot guarda o vínculo em botlinks/<chatId> e
 *   passa a lançar na conta certa. Um mesmo bot atende várias pessoas.
 *
 *   Alternativa a SA_JSON (campos separados): FIREBASE_PROJECT_ID, SA_CLIENT_EMAIL,
 *   SA_PRIVATE_KEY.
 *
 * Veja o passo a passo em BOT-TELEGRAM.md.
 */

const HELP =
  'Olá! Eu lanço no seu gestor financeiro.\n\n' +
  '<b>Primeiro passo — vincule sua conta:</b>\n' +
  'Envie <code>/vincular SEU_ID</code> (o <b>ID de sincronização</b> fica no app em ' +
  '<b>Ajustes → Sincronização na nuvem</b>). Cada pessoa vincula a própria conta.\n\n' +
  '<b>Depois, é só mandar os lançamentos:</b>\n' +
  '• <b>50 mercado</b> → despesa de R$50 (Alimentação)\n' +
  '• <b>gastei 89,90 na farmácia</b> → despesa (Saúde)\n' +
  '• <b>1200 notebook 12x</b> → parcelado (já vai em 12x)\n' +
  '• <b>receita 5000 salário</b> → receita\n\n' +
  'Em cada despesa eu pergunto <b>onde lançar</b>: toque no cartão ou em ' +
  '<b>Despesa</b> (sem cartão). Ao escolher um cartão, se você não escreveu as ' +
  'parcelas (ex.: "12x"), eu pergunto <b>à vista ou em quantas parcelas</b> com botões.\n\n' +
  'Comandos: /vincular SEU_ID • /desvincular • /id • /ajuda';

// Palavras-chave que ajudam a adivinhar a categoria (nome deve existir no app)
const SYNONYMS = {
  'Alimentação': ['mercado', 'supermercado', 'ifood', 'rappi', 'restaurante', 'almoco', 'almoço', 'jantar', 'janta', 'lanche', 'lanchonete', 'padaria', 'comida', 'feira', 'delivery', 'sorvete', 'chocolate', 'doce', 'doces', 'pizza', 'hamburguer', 'hambúrguer', 'sushi', 'acai', 'açaí', 'cafe', 'café', 'marmita', 'salgado', 'refeicao', 'refeição', 'pao', 'pão', 'churrasco'],
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

    // Toque em botão (escolha de cartão/despesa)
    if (update.callback_query) {
      await handleCallback(env, update.callback_query).catch(function () {});
      return new Response('ok');
    }

    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return new Response('ok');

    const chatId = msg.chat.id;
    const text = msg.text.trim();

    try {
      const sa = getServiceAccount(env);
      const projectId = env.FIREBASE_PROJECT_ID || sa.project_id;

      if (/^\/id\b/.test(text)) {
        await reply(env, chatId, 'Seu chat_id é: <code>' + chatId + '</code>');
        return new Response('ok');
      }
      if (/^\/(start|ajuda|help)\b/i.test(text)) {
        await reply(env, chatId, HELP);
        return new Response('ok');
      }

      // Vincular a conta do app a este Telegram: /vincular <ID de sincronização>
      const mVinc = text.match(/^\/vincular\s+(\S+)/i);
      if (mVinc) {
        const token = await getAccessToken(sa);
        const uid = mVinc[1].trim();
        const vault = await getVault(projectId, uid, token);
        if (!vault) {
          await reply(env, chatId, 'Não encontrei uma conta com esse ID 🤔. No app, vá em ' +
            '<b>Ajustes → Sincronização na nuvem</b>, faça login e sincronize uma vez; ' +
            'depois copie o <b>ID de sincronização</b> e envie <code>/vincular SEU_ID</code>.');
          return new Response('ok');
        }
        await setLink(projectId, chatId, token, uid);
        await reply(env, chatId, '✅ Conta vinculada a este Telegram! Agora é só mandar ' +
          'seus lançamentos. Para remover, use /desvincular.');
        return new Response('ok');
      }
      if (/^\/vincular\b/i.test(text)) {
        await reply(env, chatId, 'Use: <code>/vincular SEU_ID</code>\nO <b>ID de sincronização</b> ' +
          'fica no app em <b>Ajustes → Sincronização na nuvem</b>.');
        return new Response('ok');
      }
      if (/^\/desvincular\b/i.test(text)) {
        const token = await getAccessToken(sa);
        await deleteLink(projectId, chatId, token);
        await reply(env, chatId, 'Conta desvinculada deste Telegram. Use /vincular para conectar de novo.');
        return new Response('ok');
      }

      const amt = parseAmount(text);
      if (!amt) {
        await reply(env, chatId, 'Não entendi o valor 🤔. Ex.: <b>50 mercado</b> ou <b>receita 5000 salário</b>.');
        return new Response('ok');
      }

      const token = await getAccessToken(sa);
      let targetUid = await getLink(projectId, chatId, token);
      // Compatibilidade com a configuração antiga (dono com TARGET_UID + ALLOWED_CHAT_ID)
      if (!targetUid && env.TARGET_UID && env.ALLOWED_CHAT_ID &&
          String(chatId) === String(env.ALLOWED_CHAT_ID)) {
        targetUid = env.TARGET_UID;
      }
      if (!targetUid) {
        await reply(env, chatId, '🔗 Antes de lançar, vincule sua conta: envie ' +
          '<code>/vincular SEU_ID</code>.\nO ID está no app em <b>Ajustes → Sincronização na nuvem</b>.');
        return new Response('ok');
      }
      const data = await getVault(projectId, targetUid, token);
      if (!data) {
        await reply(env, chatId, 'Não encontrei seus dados. Abra o app, faça login e sincronize uma vez, depois tente de novo.');
        return new Response('ok');
      }
      if (!Array.isArray(data.categories)) data.categories = [];

      const n = normalize(text);
      const isIncome = /\b(receita|recebi|salario|entrada|ganhei)\b/.test(n);

      // Receitas: lançadas direto (cartão não se aplica)
      if (isIncome) {
        const result = applyMessage(data, text, amt);
        if (result.error) { await reply(env, chatId, result.error); return new Response('ok'); }
        await saveVault(projectId, targetUid, token, data);
        await reply(env, chatId, result.message);
        return new Response('ok');
      }

      // Despesa: monta o lançamento e pergunta ONDE lançar (cartão ou despesa)
      const categoryId = findCategory(data.categories, 'expense', text, data);
      const description = cleanDescription(text, amt.raw);
      const instMatch = n.match(/(\d+)\s*(?:x|vezes?|parcelas?)\b/);
      const installments = instMatch ? Math.max(1, parseInt(instMatch[1], 10)) : 1;
      const cards = Array.isArray(data.cards) ? data.cards : [];

      // Sem cartões cadastrados: não há o que escolher — lança direto como despesa
      if (!cards.length) {
        if (!Array.isArray(data.transactions)) data.transactions = [];
        data.transactions.push({
          id: uid('tx'), type: 'expense', description: description, amount: amt.value,
          date: todayBR(), categoryId: categoryId, recurrence: 'none', recurrenceEnd: '', accountId: ''
        });
        await saveVault(projectId, targetUid, token, data);
        await reply(env, chatId, '💸 Despesa de ' + brl(amt.value) + ' — "' + description +
          '" (' + catName(data.categories, categoryId) + ') lançada hoje.');
        return new Response('ok');
      }

      // Guarda o lançamento pendente e envia os botões
      const pending = { v: amt.value, d: description, c: categoryId, i: installments, dt: todayBR(), uid: targetUid };
      await setPending(projectId, chatId, token, pending);

      const rows = cards.map(function (c) {
        const label = installments > 1 ? '💳 ' + c.name + ' (' + installments + 'x)' : '💳 ' + c.name;
        return [{ text: label, callback_data: 'pk|c|' + c.id }];
      });
      rows.push([{ text: '💸 Despesa (sem cartão)', callback_data: 'pk|d' }]);

      const parcela = installments > 1 ? ' em ' + installments + 'x de ' + brl(amt.value / installments) : '';
      await sendKeyboard(env, chatId,
        '🧾 <b>' + brl(amt.value) + '</b>' + parcela + ' — "' + description + '" (' +
        catName(data.categories, categoryId) + ').\nOnde lançar?', rows);
      return new Response('ok');
    } catch (e) {
      await reply(env, chatId, '⚠️ Erro ao lançar: ' + (e && e.message ? e.message : e)).catch(function () {});
      return new Response('ok');
    }
  }
};

/* ---------- Callback (toque nos botões) ---------- */

async function handleCallback(env, cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const msgId = cb.message && cb.message.message_id;
  const data0 = cb.data || '';

  const sa = getServiceAccount(env);
  const projectId = env.FIREBASE_PROJECT_ID || sa.project_id;
  const token = await getAccessToken(sa);

  const pending = await getPending(projectId, chatId, token);
  if (!pending) {
    await answerCb(env, cb.id, 'Lançamento expirado. Envie de novo.');
    await editMessage(env, chatId, msgId, '⌛ Este lançamento expirou. Envie a despesa de novo.');
    return;
  }

  // Conta alvo: gravada no pendente (multiusuário); fallback para a config antiga
  const targetUid = pending.uid || env.TARGET_UID;
  const data = await getVault(projectId, targetUid, token);
  if (!data) { await answerCb(env, cb.id, 'Não encontrei seus dados.'); return; }
  if (!Array.isArray(data.categories)) data.categories = [];

  const parts = data0.split('|');

  // Passo 2: escolha das parcelas (pc|<n>)
  if (parts[0] === 'pc') {
    const n = Math.max(1, parseInt(parts[1], 10) || 1);
    const card = (data.cards || []).find(function (c) { return c.id === pending.card; });
    if (!card) { await answerCb(env, cb.id, 'Cartão não encontrado.'); return; }
    const confirm = commitCardExpense(data, pending, card, n);
    await saveVault(projectId, targetUid, token, data);
    await deletePending(projectId, chatId, token);
    await answerCb(env, cb.id, 'Lançado!');
    await editMessage(env, chatId, msgId, confirm);
    return;
  }

  // Passo 1: escolha do cartão (pk|c|<id>) ou despesa sem cartão (pk|d)
  if (parts[1] === 'c') {
    const card = (data.cards || []).find(function (c) { return c.id === parts[2]; });
    if (!card) { await answerCb(env, cb.id, 'Cartão não encontrado.'); return; }
    const inst = pending.i || 1;
    if (inst > 1) {
      // parcelas já informadas na mensagem — lança direto
      const confirm = commitCardExpense(data, pending, card, inst);
      await saveVault(projectId, targetUid, token, data);
      await deletePending(projectId, chatId, token);
      await answerCb(env, cb.id, 'Lançado!');
      await editMessage(env, chatId, msgId, confirm);
      return;
    }
    // pergunta as parcelas
    pending.card = card.id;
    await setPending(projectId, chatId, token, pending);
    await answerCb(env, cb.id, '');
    const rows = [
      [{ text: 'À vista', callback_data: 'pc|1' }],
      [{ text: '2x', callback_data: 'pc|2' }, { text: '3x', callback_data: 'pc|3' }, { text: '4x', callback_data: 'pc|4' }],
      [{ text: '5x', callback_data: 'pc|5' }, { text: '6x', callback_data: 'pc|6' }, { text: '10x', callback_data: 'pc|10' }],
      [{ text: '12x', callback_data: 'pc|12' }, { text: '18x', callback_data: 'pc|18' }, { text: '24x', callback_data: 'pc|24' }]
    ];
    await editMessageKb(env, chatId, msgId,
      '💳 <b>' + card.name + '</b> — ' + brl(pending.v) + ' "' + pending.d +
      '".\nÀ vista ou em quantas parcelas?', rows);
    return;
  }

  // Despesa (sem cartão)
  if (!Array.isArray(data.transactions)) data.transactions = [];
  data.transactions.push({
    id: uid('tx'), type: 'expense', description: pending.d, amount: pending.v,
    date: pending.dt, categoryId: pending.c, recurrence: 'none', recurrenceEnd: '', accountId: ''
  });
  await saveVault(projectId, targetUid, token, data);
  await deletePending(projectId, chatId, token);
  await answerCb(env, cb.id, 'Lançado!');
  await editMessage(env, chatId, msgId, '💸 Despesa de ' + brl(pending.v) + ' — "' + pending.d +
    '" (' + catName(data.categories, pending.c) + ') lançada.');
}

// Cria a compra no cartão (n parcelas) e retorna o texto de confirmação
function commitCardExpense(data, pending, card, n) {
  if (!Array.isArray(data.cardExpenses)) data.cardExpenses = [];
  data.cardExpenses.push({
    id: uid('ce'), cardId: card.id, description: pending.d,
    totalAmount: pending.v, purchaseDate: pending.dt,
    installments: n || 1, categoryId: pending.c
  });
  const extra = (n || 1) > 1 ? ' em ' + n + 'x de ' + brl(pending.v / n) : ' à vista';
  return '💳 Cartão <b>' + card.name + '</b>: ' + brl(pending.v) + extra +
    ' — "' + pending.d + '" (' + catName(data.categories, pending.c) + ').';
}

/* ---------- Interpretação da mensagem ---------- */

function normalize(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseAmount(text) {
  const m = text.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[0];
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : { value: Math.round(n * 100) / 100, raw: m[0] };
}

// Palavras genéricas demais para "aprender" pelo histórico (evitam falso-positivo)
const HIST_STOP = {
  conta: 1, compra: 1, compras: 1, pagamento: 1, pago: 1, parcela: 1, parcelas: 1,
  mensal: 1, mensalidade: 1, valor: 1, gasto: 1, gastos: 1, taxa: 1, fatura: 1
};

// Aprende com o histórico: se uma palavra da nova mensagem já apareceu numa
// descrição lançada antes, usa a categoria daquele lançamento (a mais frequente).
function categoryFromHistory(n, type, list, data) {
  if (!data) return '';
  const valid = {};
  list.forEach(function (c) { valid[c.id] = true; });
  const scores = {};
  function scan(desc, catId) {
    if (!catId || !valid[catId] || !desc) return;
    normalize(desc).split(/[^a-z0-9]+/).forEach(function (w) {
      if (w.length < 4 || HIST_STOP[w]) return;
      const re = new RegExp('(^|[^0-9a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^0-9a-z])');
      if (re.test(n)) scores[catId] = (scores[catId] || 0) + 1;
    });
  }
  (data.transactions || []).forEach(function (t) { if (t.type === type) scan(t.description, t.categoryId); });
  if (type === 'expense') (data.cardExpenses || []).forEach(function (ce) { scan(ce.description, ce.categoryId); });
  let best = '', bestScore = 0;
  for (const id in scores) { if (scores[id] > bestScore) { bestScore = scores[id]; best = id; } }
  return bestScore > 0 ? best : '';
}

function findCategory(categories, type, text, data) {
  const n = normalize(text);
  // casa por palavra inteira (evita "gás" casar dentro de "gastei", "99" dentro de "990" etc.)
  function hasWord(w) {
    w = normalize(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!w) return false;
    return new RegExp('(^|[^0-9a-z])' + w + '($|[^0-9a-z])').test(n);
  }
  const list = categories.filter(function (c) { return c.type === type; });
  // 1) nome da categoria aparece no texto
  for (const c of list) {
    if (hasWord(c.name)) return c.id;
  }
  // 2) histórico do usuário: item parecido já classificado antes (aprende com você)
  const fromHist = categoryFromHistory(n, type, list, data);
  if (fromHist) return fromHist;
  // 3) sinônimos -> nome da categoria
  for (const catName in SYNONYMS) {
    if (SYNONYMS[catName].some(hasWord)) {
      const c = list.find(function (x) { return normalize(x.name) === normalize(catName); });
      if (c) return c.id;
    }
  }
  // 4) "Outros" ou a primeira
  const outros = list.find(function (c) { return normalize(c.name) === 'outros'; });
  return outros ? outros.id : (list[0] ? list[0].id : '');
}

// Extrai uma descrição limpa preservando o texto real (não remove conectores
// no meio, para não quebrar "pão de queijo", "conta de luz", "posto da esquina").
function cleanDescription(text, amountRaw) {
  let d = String(text);
  // remove o valor digitado e o símbolo de moeda
  if (amountRaw) d = d.replace(amountRaw, ' ');
  d = d.replace(/r\$/gi, ' ');
  // remove parcelas "12x", "12 vezes", "12 parcelas" e a palavra "parcelado"
  d = d.replace(/\b\d+\s*(?:x|vezes?|parcelas?)\b/gi, ' ');
  d = d.replace(/\bparcelad[oa]s?\b/gi, ' ');
  // marcadores de canal/filler nunca são descrição — remove em qualquer posição
  d = d.replace(/\b(cartao|cartão|cartões|cartoes|credito|crédito|reais|real)\b/gi, ' ');
  d = d.replace(/\s+/g, ' ').trim();

  // verbos/marcadores/conectores presos no INÍCIO (repete enquanto houver)
  const lead = /^(gastei|gasto|paguei|pago|comprei|compra|comprar|recebi|ganhei|receita|entrada|despesa|saida|saída|de|do|da|no|na|em|com|pra|para|um|uma)\s+/i;
  let prev;
  do { prev = d; d = d.replace(lead, '').trim(); } while (d !== prev);
  // conectores soltos no FIM (ex.: "... no", "... de")
  const tail = /\s+(de|do|da|no|na|em|com|pra|para)$/i;
  do { prev = d; d = d.replace(tail, '').trim(); } while (d !== prev);

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
    const categoryId = findCategory(data.categories, 'expense', text, data);
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
  const categoryId = findCategory(data.categories, type, text, data);
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

// Resolve a conta de serviço: aceita o JSON inteiro (SA_JSON) OU campos separados
function getServiceAccount(env) {
  if (env.SA_JSON) {
    let raw = String(env.SA_JSON).trim();
    // tolera aspas envolventes coladas por engano
    if (raw[0] === '"' && raw[raw.length - 1] === '"') { try { raw = JSON.parse(raw); } catch (e) {} }
    const sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { client_email: sa.client_email, private_key: sa.private_key, project_id: sa.project_id };
  }
  return {
    client_email: env.SA_CLIENT_EMAIL,
    private_key: env.SA_PRIVATE_KEY,
    project_id: env.FIREBASE_PROJECT_ID
  };
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  };
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claim));
  // Aceita chave com \n literais (campos separados) ou quebras reais (do JSON)
  const pem = String(sa.private_key).replace(/\\n/g, '\n');
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

function firestoreBase(projectId) {
  return 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents';
}

async function getVault(projectId, targetUid, token) {
  const res = await fetch(firestoreBase(projectId) + '/vaults/' + targetUid, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore GET ' + res.status);
  const doc = await res.json();
  const json = doc.fields && doc.fields.json && doc.fields.json.stringValue;
  return json ? JSON.parse(json) : null;
}

// Vínculo Telegram→conta (multiusuário): mapeia o chat do Telegram ao UID do app.
async function getLink(projectId, chatId, token) {
  const res = await fetch(firestoreBase(projectId) + '/botlinks/' + chatId, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore link GET ' + res.status);
  const doc = await res.json();
  return (doc.fields && doc.fields.uid && doc.fields.uid.stringValue) || null;
}

async function setLink(projectId, chatId, token, uid) {
  const body = { fields: {
    uid: { stringValue: uid },
    updatedAt: { integerValue: String(Date.now()) }
  } };
  const res = await fetch(firestoreBase(projectId) + '/botlinks/' + chatId, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Firestore link PATCH ' + res.status);
}

async function deleteLink(projectId, chatId, token) {
  await fetch(firestoreBase(projectId) + '/botlinks/' + chatId, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
  });
}

// Lançamento pendente (entre a mensagem e o toque no botão). Coleção separada,
// não interfere no vault que o app sincroniza.
async function setPending(projectId, chatId, token, obj) {
  const body = { fields: {
    json: { stringValue: JSON.stringify(obj) },
    ts: { integerValue: String(Date.now()) }
  } };
  const res = await fetch(firestoreBase(projectId) + '/botpending/' + chatId, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Firestore pending PATCH ' + res.status);
}

async function getPending(projectId, chatId, token) {
  const res = await fetch(firestoreBase(projectId) + '/botpending/' + chatId, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Firestore pending GET ' + res.status);
  const doc = await res.json();
  const j = doc.fields && doc.fields.json && doc.fields.json.stringValue;
  return j ? JSON.parse(j) : null;
}

async function deletePending(projectId, chatId, token) {
  await fetch(firestoreBase(projectId) + '/botpending/' + chatId, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token }
  });
}

async function saveVault(projectId, targetUid, token, data) {
  const body = {
    fields: {
      json: { stringValue: JSON.stringify(data) },
      updatedAt: { integerValue: String(Date.now()) },
      device: { stringValue: 'telegram' }
    }
  };
  const url = firestoreBase(projectId) + '/vaults/' + targetUid +
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

function sendKeyboard(env, chatId, text, rows) {
  return tg(env, 'sendMessage', {
    chat_id: chatId, text: text, parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  });
}

function editMessage(env, chatId, messageId, text) {
  return tg(env, 'editMessageText', {
    chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML'
  });
}

function editMessageKb(env, chatId, messageId, text, rows) {
  return tg(env, 'editMessageText', {
    chat_id: chatId, message_id: messageId, text: text, parse_mode: 'HTML',
    reply_markup: { inline_keyboard: rows }
  });
}

function answerCb(env, callbackQueryId, text) {
  return tg(env, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: text });
}

// Exportado apenas para testes (o Cloudflare Workers usa só o export default acima).
export { cleanDescription, parseAmount, findCategory, applyMessage };
