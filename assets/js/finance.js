/* finance.js — regras de negócio: recorrências, faturas e agregações */
(function (global) {
  'use strict';

  const U = global.Utils;

  function getCategory(id) {
    const d = global.Store.getData();
    return d.categories.find(function (c) { return c.id === id; }) ||
      { id: id, name: 'Sem categoria', color: '#94a3b8', type: 'expense' };
  }

  /* ------------------------------------------------------------------ *
   *  Ocorrências de transações (despesas/receitas) num mês             *
   * ------------------------------------------------------------------ */

  // Retorna a lista de ocorrências de uma transação dentro do mês (year, month0).
  // Cada ocorrência: { id, txId, date, amount, description, categoryId, type, recurrence, paid }
  function occurrencesOfTransaction(tx, year, month0) {
    const out = [];
    const start = U.parseISO(tx.date);
    const rec = tx.recurrence || 'none';

    // Mês pausado (recorrência): não gera ocorrência neste mês
    const skips = global.Store.getData().skipOverrides;
    if (skips && skips[tx.id + ':' + U.monthKey(year, month0)]) return out;

    function makeOcc(dateISO) {
      const store = global.Store.getData();
      const key = tx.id + ':' + U.monthKey(year, month0);
      const paid = !!store.paidOverrides[key];
      const ov = store.amountOverrides ? store.amountOverrides[key] : undefined;
      const overridden = (ov !== undefined && ov !== null);
      return {
        id: tx.id + '@' + dateISO,
        txId: tx.id,
        date: dateISO,
        amount: (overridden ? Number(ov) : Number(tx.amount)) || 0,
        description: tx.description,
        categoryId: tx.categoryId,
        type: tx.type,
        recurrence: rec,
        paidKey: key,
        paid: paid,
        // Valor personalizado só neste mês (exceção da recorrência)
        amountKey: key,
        overridden: overridden
      };
    }

    // Respeita data final de recorrência, se houver
    function beforeEnd(y, m0, day) {
      if (!tx.recurrenceEnd) return true;
      const e = U.parseISO(tx.recurrenceEnd);
      return (y * 372 + m0 * 31 + day) <= (e.year * 372 + e.month0 * 31 + e.day);
    }
    function afterStart(y, m0, day) {
      return (y * 372 + m0 * 31 + day) >= (start.year * 372 + start.month0 * 31 + start.day);
    }

    if (rec === 'none') {
      if (start.year === year && start.month0 === month0) out.push(makeOcc(tx.date));
      return out;
    }

    if (rec === 'monthly') {
      // Deve ter começado até este mês
      if (U.monthDiff(year, month0, start.year, start.month0) < 0) return out;
      const iso = U.buildISO(year, month0, start.day);
      const p = U.parseISO(iso);
      if (beforeEnd(p.year, p.month0, p.day)) out.push(makeOcc(iso));
      return out;
    }

    if (rec === 'yearly') {
      if (month0 !== start.month0) return out;
      if (year < start.year) return out;
      const iso = U.buildISO(year, month0, start.day);
      const p = U.parseISO(iso);
      if (beforeEnd(p.year, p.month0, p.day)) out.push(makeOcc(iso));
      return out;
    }

    if (rec === 'weekly') {
      const total = U.daysInMonth(year, month0);
      const targetWeekday = U.weekdayISO(tx.date);
      for (let day = 1; day <= total; day++) {
        const wd = new Date(year, month0, day).getDay();
        if (wd !== targetWeekday) continue;
        if (!afterStart(year, month0, day)) continue;
        if (!beforeEnd(year, month0, day)) continue;
        out.push(makeOcc(U.buildISO(year, month0, day)));
      }
      return out;
    }

    return out;
  }

  // Todas as ocorrências de um tipo ('expense'|'income') no mês
  function occurrencesInMonth(type, year, month0) {
    const d = global.Store.getData();
    let all = [];
    d.transactions.forEach(function (tx) {
      if (tx.type !== type) return;
      all = all.concat(occurrencesOfTransaction(tx, year, month0));
    });
    all.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return all;
  }

  /* ------------------------------------------------------------------ *
   *  Cartões de crédito e faturas                                       *
   * ------------------------------------------------------------------ */

  function getCard(id) {
    return global.Store.getData().cards.find(function (c) { return c.id === id; });
  }

  // Determina o mês de FECHAMENTO da 1ª parcela de uma compra.
  // Se a compra acontece até o dia de fechamento, entra na fatura que fecha
  // no mês da compra; caso contrário, na fatura do mês seguinte.
  function firstInvoiceMonth(purchaseISO, closingDay) {
    const p = U.parseISO(purchaseISO);
    if (p.day <= closingDay) return { year: p.year, month0: p.month0 };
    return U.addMonths(p.year, p.month0, 1);
  }

  // Mês de vencimento a partir do mês de fechamento.
  // Se o vencimento cai depois do fechamento, vence no mesmo mês; senão, no seguinte.
  function dueMonthFromClosing(closingYear, closingMonth0, closingDay, dueDay) {
    if (dueDay > closingDay) return { year: closingYear, month0: closingMonth0 };
    return U.addMonths(closingYear, closingMonth0, 1);
  }

  // Expande uma compra no cartão em parcelas, cada uma com seu mês de fatura.
  // Retorna [{ n, of, amount, closing:{year,month0}, due:{year,month0}, dueISO }]
  function installmentsOf(cardExpense) {
    const card = getCard(cardExpense.cardId);
    if (!card) return [];
    const closingDay = card.closingDay || 1;
    const dueDay = card.dueDay || 10;
    const count = Math.max(1, parseInt(cardExpense.installments, 10) || 1);
    const total = Number(cardExpense.totalAmount) || 0;

    // Distribui o total evitando erros de centavos: última parcela ajusta o resto
    const base = Math.floor((total / count) * 100) / 100;
    const parts = [];
    let acc = 0;
    for (let i = 0; i < count; i++) {
      let amt = base;
      if (i === count - 1) amt = Math.round((total - acc) * 100) / 100;
      acc = Math.round((acc + amt) * 100) / 100;
      parts.push(amt);
    }

    // Fatura forçada (dueOverride = "YYYY-MM" da fatura de vencimento da 1ª parcela):
    // preserva a data da compra, mas coloca a compra na fatura escolhida.
    let first;
    if (cardExpense.dueOverride && /^\d{4}-\d{2}$/.test(cardExpense.dueOverride)) {
      const ovYear = parseInt(cardExpense.dueOverride.slice(0, 4), 10);
      const ovMonth0 = parseInt(cardExpense.dueOverride.slice(5, 7), 10) - 1;
      // Descobre o mês de FECHAMENTO cujo vencimento cai no mês escolhido.
      first = (dueDay > closingDay)
        ? { year: ovYear, month0: ovMonth0 }
        : U.addMonths(ovYear, ovMonth0, -1);
    } else {
      first = firstInvoiceMonth(cardExpense.purchaseDate, closingDay);
    }
    const list = [];
    for (let i = 0; i < count; i++) {
      const closing = U.addMonths(first.year, first.month0, i);
      const due = dueMonthFromClosing(closing.year, closing.month0, closingDay, dueDay);
      list.push({
        n: i + 1,
        of: count,
        amount: parts[i],
        closing: closing,
        due: due,
        dueISO: U.buildISO(due.year, due.month0, dueDay)
      });
    }
    return list;
  }

  // Serial de dia (para comparar datas) — usa UTC para evitar fuso
  function daySerial(year, month0, day) { return Date.UTC(year, month0, day) / 86400000; }

  // Cobranças de UMA compra de cartão que caem na fatura que VENCE em (year, month0).
  // Trata compras únicas/parceladas (installmentsOf) e recorrentes (semanal/mensal/anual).
  function cardChargesInInvoice(ce, year, month0) {
    const card = getCard(ce.cardId);
    if (!card) return [];
    const rec = ce.recurrence || 'none';

    if (rec === 'none') {
      return installmentsOf(ce)
        .filter(function (p) { return p.due.year === year && p.due.month0 === month0; })
        .map(function (p) {
          return { amount: p.amount, n: p.n, of: p.of, purchaseDate: ce.purchaseDate,
            dueISO: p.dueISO, recurring: false };
        });
    }

    // Recorrente: descobre a janela de datas de compra cuja fatura vence em (year, month0)
    const closingDay = card.closingDay || 1;
    const dueDay = card.dueDay || 10;
    const closing = (dueDay > closingDay) ? { year: year, month0: month0 } : U.addMonths(year, month0, -1);
    const prevClose = U.addMonths(closing.year, closing.month0, -1);
    const winStart = daySerial(prevClose.year, prevClose.month0, closingDay + 1);
    const winEnd = daySerial(closing.year, closing.month0, closingDay);
    const dueISO = U.buildISO(year, month0, dueDay);

    const start = U.parseISO(ce.purchaseDate);
    const startSerial = daySerial(start.year, start.month0, start.day);
    const endSerial = ce.recurrenceEnd
      ? (function () { const e = U.parseISO(ce.recurrenceEnd); return daySerial(e.year, e.month0, e.day); })()
      : Infinity;
    const amount = Number(ce.totalAmount) || 0;
    const charges = [];
    function pushOcc(serial) {
      if (serial < startSerial || serial > endSerial || serial < winStart || serial > winEnd) return;
      const dt = new Date(serial * 86400000);
      charges.push({
        amount: amount, n: 1, of: 1, recurring: true, dueISO: dueISO,
        purchaseDate: U.buildISO(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
      });
    }

    if (rec === 'weekly') {
      const step = 7;
      let k = 0;
      if (winStart > startSerial) k = Math.ceil((winStart - startSerial) / step);
      for (let s = startSerial + k * step; s <= winEnd; s += step) pushOcc(s);
    } else if (rec === 'monthly') {
      // Uma ocorrência por mês, no dia da compra (ajustado ao fim do mês)
      [prevClose, closing].forEach(function (m) {
        const dim = U.daysInMonth(m.year, m.month0);
        pushOcc(daySerial(m.year, m.month0, Math.min(start.day, dim)));
      });
    } else if (rec === 'yearly') {
      [prevClose.year, closing.year].forEach(function (y) {
        const dim = U.daysInMonth(y, start.month0);
        pushOcc(daySerial(y, start.month0, Math.min(start.day, dim)));
      });
    }
    return charges;
  }

  // Itens que compõem a fatura de um cartão que VENCE em (year, month0)
  function invoiceItems(cardId, year, month0) {
    const d = global.Store.getData();
    const items = [];
    d.cardExpenses.forEach(function (ce) {
      if (ce.cardId !== cardId) return;
      cardChargesInInvoice(ce, year, month0).forEach(function (p) {
        items.push({
          cardExpenseId: ce.id,
          description: ce.description,
          categoryId: ce.categoryId,
          purchaseDate: p.purchaseDate,
          n: p.n, of: p.of,
          amount: p.amount,
          recurring: p.recurring,
          dueISO: p.dueISO
        });
      });
    });
    items.sort(function (a, b) { return a.purchaseDate < b.purchaseDate ? -1 : 1; });
    return items;
  }

  function invoiceTotal(cardId, year, month0) {
    return invoiceItems(cardId, year, month0).reduce(function (s, i) { return s + i.amount; }, 0);
  }

  function invoicePaidKey(cardId, year, month0) {
    return cardId + ':' + U.monthKey(year, month0);
  }

  function isInvoicePaid(cardId, year, month0) {
    return !!global.Store.getData().invoicePaid[invoicePaidKey(cardId, year, month0)];
  }

  // Uso atual do cartão: soma de parcelas ainda não vencidas (a partir do mês atual)
  function cardOpenBalance(cardId) {
    const d = global.Store.getData();
    const now = new Date();
    const curKey = now.getFullYear() * 12 + now.getMonth();
    let sum = 0;
    d.cardExpenses.forEach(function (ce) {
      if (ce.cardId !== cardId) return;
      if (ce.recurrence && ce.recurrence !== 'none') return; // recorrente não trava limite
      installmentsOf(ce).forEach(function (p) {
        const k = p.due.year * 12 + p.due.month0;
        if (k >= curKey) sum += p.amount;
      });
    });
    return sum;
  }

  /* ------------------------------------------------------------------ *
   *  Agregações do mês (dashboard)                                      *
   * ------------------------------------------------------------------ */

  function monthSummary(year, month0) {
    const d = global.Store.getData();
    const incomes = occurrencesInMonth('income', year, month0);
    const expenses = occurrencesInMonth('expense', year, month0);

    const totalIncome = incomes.reduce(function (s, o) { return s + o.amount; }, 0);
    const totalDirectExpense = expenses.reduce(function (s, o) { return s + o.amount; }, 0);

    let totalInvoices = 0;
    d.cards.forEach(function (c) {
      totalInvoices += invoiceTotal(c.id, year, month0);
    });

    const totalExpense = totalDirectExpense + totalInvoices;

    return {
      totalIncome: totalIncome,
      totalDirectExpense: totalDirectExpense,
      totalInvoices: totalInvoices,
      totalExpense: totalExpense,
      balance: totalIncome - totalExpense,
      incomes: incomes,
      expenses: expenses
    };
  }

  // Gasto por categoria no mês (inclui despesas diretas + itens de fatura)
  function expenseByCategory(year, month0) {
    const d = global.Store.getData();
    const map = {};
    function add(catId, amt) {
      if (!map[catId]) map[catId] = 0;
      map[catId] += amt;
    }
    occurrencesInMonth('expense', year, month0).forEach(function (o) {
      add(o.categoryId, o.amount);
    });
    d.cards.forEach(function (c) {
      invoiceItems(c.id, year, month0).forEach(function (i) {
        add(i.categoryId, i.amount);
      });
    });
    return Object.keys(map).map(function (catId) {
      const cat = getCategory(catId);
      return { categoryId: catId, name: cat.name, color: cat.color, total: map[catId] };
    }).sort(function (a, b) { return b.total - a.total; });
  }

  // Projeção de N meses a partir de um mês base
  function projection(baseYear, baseMonth0, months) {
    const out = [];
    for (let i = 0; i < months; i++) {
      const m = U.addMonths(baseYear, baseMonth0, i);
      const s = monthSummary(m.year, m.month0);
      out.push({
        year: m.year, month0: m.month0,
        label: U.MESES_CURTOS[m.month0],
        income: s.totalIncome,
        expense: s.totalExpense,
        balance: s.balance
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   *  Orçamentos por categoria                                           *
   * ------------------------------------------------------------------ */

  function getBudget(categoryId) {
    const b = global.Store.getData().budgets.find(function (x) { return x.categoryId === categoryId; });
    return b ? Number(b.amount) || 0 : 0;
  }

  function setBudget(categoryId, amount) {
    const d = global.Store.getData();
    const existing = d.budgets.find(function (x) { return x.categoryId === categoryId; });
    if (amount > 0) {
      if (existing) existing.amount = amount;
      else d.budgets.push({ categoryId: categoryId, amount: amount });
    } else if (existing) {
      d.budgets = d.budgets.filter(function (x) { return x.categoryId !== categoryId; });
    }
    global.Store.save();
  }

  // Situação de todos os orçamentos definidos no mês
  function budgetStatus(year, month0) {
    const d = global.Store.getData();
    const spentMap = {};
    expenseByCategory(year, month0).forEach(function (c) { spentMap[c.categoryId] = c.total; });
    return d.budgets
      .filter(function (b) { return Number(b.amount) > 0; })
      .map(function (b) {
        const cat = getCategory(b.categoryId);
        const limit = Number(b.amount) || 0;
        const spent = spentMap[b.categoryId] || 0;
        const pct = limit > 0 ? (spent / limit) * 100 : 0;
        return {
          categoryId: b.categoryId, name: cat.name, color: cat.color,
          limit: limit, spent: spent, remaining: limit - spent,
          pct: pct, over: spent > limit
        };
      })
      .sort(function (a, b) { return b.pct - a.pct; });
  }

  // Meta total do mês = soma dos orçamentos definidos
  function monthGoal(year, month0) {
    const status = budgetStatus(year, month0);
    const limit = status.reduce(function (s, b) { return s + b.limit; }, 0);
    const spent = status.reduce(function (s, b) { return s + b.spent; }, 0);
    return { limit: limit, spent: spent, remaining: limit - spent, count: status.length };
  }

  /* ------------------------------------------------------------------ *
   *  Contas e saldo                                                     *
   * ------------------------------------------------------------------ */

  function getAccount(id) {
    return global.Store.getData().accounts.find(function (a) { return a.id === id; });
  }

  // Saldo atual de uma conta: saldo inicial + lançamentos EFETIVADOS (pagos/recebidos)
  // vinculados a ela + faturas pagas de cartões vinculados.
  function accountBalance(accountId) {
    const d = global.Store.getData();
    const acc = getAccount(accountId);
    let balance = acc ? (Number(acc.initialBalance) || 0) : 0;

    // Lançamentos marcados como pagos/recebidos
    Object.keys(d.paidOverrides).forEach(function (key) {
      if (!d.paidOverrides[key]) return;
      const sep = key.lastIndexOf(':');
      const txId = key.slice(0, sep);
      const tx = d.transactions.find(function (t) { return t.id === txId; });
      if (!tx || tx.accountId !== accountId) return;
      const amt = Number(tx.amount) || 0;
      balance += (tx.type === 'income' ? amt : -amt);
    });

    // Faturas de cartão pagas por esta conta
    Object.keys(d.invoicePaid).forEach(function (key) {
      if (!d.invoicePaid[key]) return;
      const sep = key.lastIndexOf(':');
      const cardId = key.slice(0, sep);
      const ym = key.slice(sep + 1).split('-');
      const card = getCard(cardId);
      if (!card || card.accountId !== accountId) return;
      balance -= invoiceTotal(cardId, parseInt(ym[0], 10), parseInt(ym[1], 10) - 1);
    });

    return balance;
  }

  function totalAccountsBalance() {
    const d = global.Store.getData();
    return d.accounts.reduce(function (s, a) { return s + accountBalance(a.id); }, 0);
  }

  global.Finance = {
    getCategory,
    occurrencesOfTransaction, occurrencesInMonth,
    getCard, installmentsOf, invoiceItems, invoiceTotal,
    invoicePaidKey, isInvoicePaid, cardOpenBalance,
    monthSummary, expenseByCategory, projection,
    getBudget, setBudget, budgetStatus, monthGoal,
    getAccount, accountBalance, totalAccountsBalance
  };
})(window);
