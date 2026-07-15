/* app.js — estado da aplicação, navegação e renderização das abas */
(function (global) {
  'use strict';

  const U = global.Utils;
  const F = global.Finance;
  const el = U.el;

  const state = {
    tab: 'dashboard',
    year: new Date().getFullYear(),
    month0: new Date().getMonth(),
    // Filtros das listas de despesas/receitas
    filters: {
      expense: { q: '', category: '', status: '' },
      income: { q: '', category: '', status: '' }
    }
  };

  // Estado de UI (não persistido): quais cartões estão com a lista expandida
  const cardExpanded = {};

  const view = document.getElementById('view');

  /* ================================================================== *
   *  Navegação                                                          *
   * ================================================================== */
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    render();
  }

  function shiftMonth(delta) {
    const m = U.addMonths(state.year, state.month0, delta);
    state.year = m.year; state.month0 = m.month0;
    updateMonthLabel();
    render();
  }
  function goToday() {
    const d = new Date();
    state.year = d.getFullYear(); state.month0 = d.getMonth();
    updateMonthLabel();
    render();
  }
  function updateMonthLabel() {
    document.getElementById('currentMonthLabel').textContent =
      U.monthLabel(state.year, state.month0);
  }

  function refresh() { render(); }

  /* ================================================================== *
   *  Componentes reutilizáveis                                          *
   * ================================================================== */
  function sectionHeader(title, actionNode) {
    return el('div', { class: 'section-header' }, [
      el('h1', { class: 'section-title', text: title }),
      actionNode || null
    ]);
  }

  function statCard(label, value, cls, sub) {
    return el('div', { class: 'stat-card ' + (cls || '') }, [
      el('span', { class: 'stat-label', text: label }),
      el('strong', { class: 'stat-value', text: value }),
      sub ? el('span', { class: 'stat-sub', text: sub }) : null
    ]);
  }

  function emptyState(msg, actionNode) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'empty-icon', text: '∅' }),
      el('p', { text: msg }),
      actionNode || null
    ]);
  }

  function catBadge(categoryId) {
    const c = F.getCategory(categoryId);
    return el('span', { class: 'cat-badge' }, [
      el('span', { class: 'cat-dot', style: 'background:' + c.color }),
      el('span', { text: c.name })
    ]);
  }

  /* ================================================================== *
   *  Aba: Visão geral (dashboard)                                       *
   * ================================================================== */
  function renderDashboard() {
    const s = F.monthSummary(state.year, state.month0);
    view.innerHTML = '';
    view.appendChild(sectionHeader('Visão geral'));

    // Cards de resumo
    const d = global.Store.getData();
    const statCards = [
      statCard('Receitas previstas', U.formatBRL(s.totalIncome), 'income'),
      statCard('Despesas do mês', U.formatBRL(s.totalExpense), 'expense',
        'Contas ' + U.formatBRL(s.totalDirectExpense) + ' + cartões ' + U.formatBRL(s.totalInvoices)),
      statCard('Saldo previsto', U.formatBRL(s.balance), s.balance >= 0 ? 'positive' : 'negative')
    ];
    if (d.accounts.length) {
      const bal = F.totalAccountsBalance();
      statCards.push(statCard('Saldo em contas', U.formatBRL(bal), bal >= 0 ? 'positive' : 'negative',
        'Somente valores efetivados'));
    }
    view.appendChild(el('div', { class: 'stat-grid' + (statCards.length === 4 ? ' four' : '') }, statCards));

    // Alertas de orçamento estourado
    const overBudgets = F.budgetStatus(state.year, state.month0).filter(function (b) { return b.over; });
    if (overBudgets.length) {
      view.appendChild(el('div', { class: 'alert-banner' }, [
        el('span', { class: 'alert-icon', text: '⚠' }),
        el('span', { html: '<strong>Orçamento estourado</strong> em ' +
          overBudgets.map(function (b) { return U.escapeHtml(b.name); }).join(', ') + '.' })
      ]));
    }

    // Gráficos
    const grid = el('div', { class: 'dashboard-grid' });

    // Donut por categoria
    const byCat = F.expenseByCategory(state.year, state.month0);
    const donutCard = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Despesas por categoria' })
    ]);
    const donutWrap = el('div', { class: 'donut-wrap' }, [
      global.Charts.donut(byCat, { size: 180, stroke: 24 })
    ]);
    const legend = el('div', { class: 'legend' });
    byCat.slice(0, 8).forEach(function (c) {
      legend.appendChild(el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:' + c.color }),
        el('span', { class: 'legend-name', text: c.name }),
        el('span', { class: 'legend-val', text: U.formatBRL(c.total) })
      ]));
    });
    if (!byCat.length) legend.appendChild(el('p', { class: 'muted', text: 'Nenhuma despesa neste mês.' }));
    donutCard.appendChild(el('div', { class: 'donut-layout' }, [donutWrap, legend]));
    grid.appendChild(donutCard);

    // Projeção de 6 meses
    const proj = F.projection(state.year, state.month0, 6);
    const projCard = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Projeção (6 meses)' }),
      el('div', { class: 'bars-wrap' }, [global.Charts.barsIncomeExpense(proj)]),
      el('div', { class: 'legend-inline' }, [
        el('span', { class: 'legend-item' }, [
          el('span', { class: 'legend-dot', style: 'background:var(--income)' }),
          el('span', { text: 'Receitas' })
        ]),
        el('span', { class: 'legend-item' }, [
          el('span', { class: 'legend-dot', style: 'background:var(--expense)' }),
          el('span', { text: 'Despesas' })
        ])
      ])
    ]);
    grid.appendChild(projCard);
    view.appendChild(grid);

    // Próximos lançamentos do mês
    const upcoming = s.expenses.concat(
      s.incomes.map(function (i) { return Object.assign({}, i); })
    ).sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    const listPanel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Lançamentos do mês' })
    ]);
    if (!upcoming.length) {
      listPanel.appendChild(el('p', { class: 'muted', text: 'Nada lançado ainda neste mês.' }));
    } else {
      const list = el('div', { class: 'txn-list' });
      upcoming.slice(0, 12).forEach(function (o) {
        list.appendChild(el('div', { class: 'txn-row compact' }, [
          el('div', { class: 'txn-main' }, [
            el('span', { class: 'txn-desc', text: o.description }),
            el('span', { class: 'txn-meta', text: U.formatDateBR(o.date) })
          ]),
          el('span', {
            class: 'txn-amount ' + (o.type === 'income' ? 'pos' : 'neg'),
            text: (o.type === 'income' ? '+ ' : '- ') + U.formatBRL(o.amount)
          })
        ]));
      });
      listPanel.appendChild(list);
    }
    view.appendChild(listPanel);
  }

  /* ================================================================== *
   *  Abas: Despesas e Receitas                                          *
   * ================================================================== */
  function renderTransactions(type) {
    const isIncome = type === 'income';
    const occ = F.occurrencesInMonth(type, state.year, state.month0);
    const total = occ.reduce(function (s, o) { return s + o.amount; }, 0);
    const paidTotal = occ.reduce(function (s, o) { return s + (o.paid ? o.amount : 0); }, 0);
    const openTotal = total - paidTotal;

    view.innerHTML = '';
    const addBtn = el('button', {
      class: 'btn ' + (isIncome ? 'success' : 'danger'),
      text: isIncome ? '+ Nova receita' : '+ Nova despesa',
      onclick: function () { global.UI.openTransactionModal(type, null, refresh); }
    });
    view.appendChild(sectionHeader(isIncome ? 'Receitas' : 'Despesas', addBtn));

    view.appendChild(el('div', { class: 'stat-grid' }, [
      statCard(isIncome ? 'Previsto no mês' : 'Total no mês',
        U.formatBRL(total), isIncome ? 'income' : 'expense'),
      statCard(isIncome ? 'Já recebido' : 'Já pago', U.formatBRL(paidTotal), 'positive'),
      statCard(isIncome ? 'A receber' : 'A pagar', U.formatBRL(openTotal),
        openTotal > 0 ? 'expense' : '')
    ]));

    // Meta do mês (para despesas, se houver orçamentos)
    if (!isIncome) {
      const goal = F.monthGoal(state.year, state.month0);
      if (goal.limit > 0) {
        const pct = Math.min(100, (goal.spent / goal.limit) * 100);
        const over = goal.remaining < 0;
        view.appendChild(el('div', { class: 'panel goal-panel' }, [
          el('div', { class: 'goal-head' }, [
            el('span', { text: 'Meta de gastos do mês' }),
            el('strong', {
              class: over ? 'neg' : '',
              text: over
                ? 'Estourou ' + U.formatBRL(-goal.remaining)
                : 'Resta ' + U.formatBRL(goal.remaining)
            })
          ]),
          el('div', { class: 'progress' }, [
            el('div', { class: 'progress-fill ' + (over ? 'over' : ''), style: 'width:' + pct + '%' })
          ]),
          el('div', { class: 'goal-foot muted small', text:
            U.formatBRL(goal.spent) + ' de ' + U.formatBRL(goal.limit) + ' orçados' })
        ]));
      }
    }

    if (!occ.length) {
      const b = el('button', {
        class: 'btn ' + (isIncome ? 'success' : 'danger'),
        text: isIncome ? '+ Nova receita' : '+ Nova despesa',
        onclick: function () { global.UI.openTransactionModal(type, null, refresh); }
      });
      view.appendChild(emptyState(
        isIncome ? 'Nenhuma receita neste mês.' : 'Nenhuma despesa neste mês.', b));
      return;
    }

    // Barra de busca e filtros
    const f = state.filters[type];
    const searchIn = el('input', {
      type: 'search', class: 'toolbar-search', placeholder: 'Buscar por descrição...', value: f.q
    });
    const catFilter = el('select', { class: 'toolbar-select' });
    catFilter.appendChild(el('option', { value: '', text: 'Todas as categorias' }));
    const catIds = {};
    global.Store.getData().categories
      .filter(function (c) { return c.type === type; })
      .forEach(function (c) {
        catIds[c.id] = true;
        const opt = el('option', { value: c.id, text: c.name });
        if (c.id === f.category) opt.selected = true;
        catFilter.appendChild(opt);
      });
    const noneOpt = el('option', { value: '__none__', text: 'Sem categoria (a classificar)' });
    if (f.category === '__none__') noneOpt.selected = true;
    catFilter.appendChild(noneOpt);
    const statusFilter = el('select', { class: 'toolbar-select' }, [
      el('option', { value: '', text: 'Todos' }),
      el('option', { value: 'paid', text: isIncome ? 'Recebidos' : 'Pagos' }),
      el('option', { value: 'open', text: isIncome ? 'A receber' : 'A pagar' })
    ]);
    statusFilter.value = f.status;

    const countLabel = el('span', { class: 'muted small toolbar-count' });
    const listContainer = el('div', { class: 'panel' });

    function applyFilters() {
      f.q = searchIn.value;
      f.category = catFilter.value;
      f.status = statusFilter.value;
      const q = f.q.trim().toLowerCase();
      const filtered = occ.filter(function (o) {
        if (q && o.description.toLowerCase().indexOf(q) === -1) return false;
        if (f.category === '__none__') { if (o.categoryId && catIds[o.categoryId]) return false; }
        else if (f.category && o.categoryId !== f.category) return false;
        if (f.status === 'paid' && !o.paid) return false;
        if (f.status === 'open' && o.paid) return false;
        return true;
      });
      countLabel.textContent = filtered.length + ' de ' + occ.length + ' lançamentos';
      renderTxnGroups(listContainer, filtered, type);
    }

    searchIn.addEventListener('input', applyFilters);
    catFilter.addEventListener('change', applyFilters);
    statusFilter.addEventListener('change', applyFilters);

    view.appendChild(el('div', { class: 'toolbar' }, [
      searchIn,
      el('div', { class: 'toolbar-filters' }, [catFilter, statusFilter]),
      countLabel
    ]));
    view.appendChild(listContainer);
    applyFilters();
  }

  // Renderiza lançamentos agrupados por dia, com subtotal diário
  function renderTxnGroups(container, list, type) {
    const isIncome = type === 'income';
    container.innerHTML = '';
    if (!list.length) {
      container.appendChild(el('p', { class: 'muted', text: 'Nenhum lançamento com esses filtros.' }));
      return;
    }
    const d = global.Store.getData();
    // Agrupa por data
    const groups = [];
    const byDate = {};
    list.forEach(function (o) {
      if (!byDate[o.date]) { byDate[o.date] = []; groups.push(o.date); }
      byDate[o.date].push(o);
    });

    groups.forEach(function (date) {
      const rows = byDate[date];
      const subtotal = rows.reduce(function (s, o) { return s + o.amount; }, 0);
      container.appendChild(el('div', { class: 'day-header' }, [
        el('span', { class: 'day-date', text: U.formatDateBR(date) }),
        el('span', {
          class: 'day-subtotal ' + (isIncome ? 'pos' : 'neg'),
          text: (isIncome ? '+ ' : '- ') + U.formatBRL(subtotal)
        })
      ]));
      rows.forEach(function (o) {
        const tx = d.transactions.find(function (t) { return t.id === o.txId; });
        const recTag = o.recurrence !== 'none'
          ? el('span', { class: 'tag', text: recurrenceLabel(o.recurrence) }) : null;
        const ovTag = o.overridden
          ? el('span', { class: 'tag', title: 'Valor personalizado só neste mês', text: '✎ valor ajustado' }) : null;
        const acc = tx && tx.accountId ? F.getAccount(tx.accountId) : null;
        const accTag = acc
          ? el('span', { class: 'tag tag-account' }, [
              el('span', { class: 'cat-dot', style: 'background:' + (acc.color || '#888') }),
              el('span', { text: acc.name })
            ]) : null;

        const paidBtn = el('button', {
          class: 'chip ' + (o.paid ? 'chip-on' : ''),
          text: o.paid ? (isIncome ? '✓ Recebido' : '✓ Pago') : (isIncome ? 'Receber' : 'Marcar pago'),
          onclick: function () { togglePaid(o.paidKey); }
        });

        container.appendChild(el('div', { class: 'txn-row' }, [
          el('div', { class: 'txn-main' }, [
            el('div', { class: 'txn-title-line' }, [
              el('span', { class: 'txn-desc', text: o.description }), recTag, ovTag, accTag
            ]),
            el('div', { class: 'txn-meta-line' }, [ catBadge(o.categoryId) ])
          ]),
          el('div', { class: 'txn-right' }, [
            el('span', {
              class: 'txn-amount ' + (isIncome ? 'pos' : 'neg'),
              text: (isIncome ? '+ ' : '- ') + U.formatBRL(o.amount)
            }),
            paidBtn,
            rowActions(
              function () { global.UI.openTransactionModal(type, tx, refresh, { year: state.year, month0: state.month0 }); },
              function () { deleteTransaction(tx, o.recurrence !== 'none'); }
            )
          ])
        ]));
      });
    });
  }

  function recurrenceLabel(r) {
    return { monthly: 'Mensal', weekly: 'Semanal', yearly: 'Anual' }[r] || '';
  }

  function togglePaid(key) {
    const d = global.Store.getData();
    if (d.paidOverrides[key]) delete d.paidOverrides[key];
    else d.paidOverrides[key] = true;
    global.Store.save();
    render();
  }

  function deleteTransaction(tx, isRecurring) {
    const msg = isRecurring
      ? 'Excluir "' + tx.description + '"? Isso remove a recorrência de todos os meses.'
      : 'Excluir "' + tx.description + '"?';
    global.UI.confirmModal('Excluir lançamento', msg, function () {
      const d = global.Store.getData();
      d.transactions = d.transactions.filter(function (t) { return t.id !== tx.id; });
      global.Store.save();
      U.toast('Lançamento excluído.', 'success');
      render();
    }, true);
  }

  function rowActions(onEdit, onDelete) {
    return el('div', { class: 'row-actions' }, [
      el('button', { class: 'icon-btn small', text: '✎', title: 'Editar', onclick: onEdit }),
      el('button', { class: 'icon-btn small danger', text: '🗑', title: 'Excluir', onclick: onDelete })
    ]);
  }

  /* ================================================================== *
   *  Aba: Cartões                                                       *
   * ================================================================== */
  function renderCards() {
    const d = global.Store.getData();
    view.innerHTML = '';

    const addCardBtn = el('button', {
      class: 'btn primary', text: '+ Novo cartão',
      onclick: function () { global.UI.openCardModal(null, refresh); }
    });
    view.appendChild(sectionHeader('Cartões de crédito', addCardBtn));

    if (!d.cards.length) {
      const b = el('button', {
        class: 'btn primary', text: '+ Cadastrar cartão',
        onclick: function () { global.UI.openCardModal(null, refresh); }
      });
      view.appendChild(emptyState('Você ainda não cadastrou nenhum cartão.', b));
      return;
    }

    d.cards.forEach(function (card) {
      view.appendChild(renderCardPanel(card));
    });
  }

  function renderCardPanel(card) {
    const items = F.invoiceItems(card.id, state.year, state.month0);
    const total = items.reduce(function (s, i) { return s + i.amount; }, 0);
    const paid = F.isInvoicePaid(card.id, state.year, state.month0);
    const openBal = F.cardOpenBalance(card.id);
    const available = card.limit ? (card.limit - openBal) : null;

    const header = el('div', { class: 'card-panel-header', style: '--card-color:' + card.color }, [
      el('div', { class: 'card-badge', style: 'background:' + card.color }, [
        el('span', { text: card.name.slice(0, 2).toUpperCase() })
      ]),
      el('div', { class: 'card-headinfo' }, [
        el('strong', { text: card.name }),
        el('span', { class: 'muted small', text:
          'Fecha dia ' + card.closingDay + ' • Vence dia ' + card.dueDay })
      ]),
      el('div', { class: 'card-head-actions' }, [
        el('button', {
          class: 'btn small primary', text: '+ Compra',
          onclick: function () { global.UI.openCardExpenseModal(card.id, null, refresh); }
        }),
        el('button', { class: 'icon-btn small', text: '✎', title: 'Editar cartão',
          onclick: function () { global.UI.openCardModal(card, refresh); } }),
        el('button', { class: 'icon-btn small danger', text: '🗑', title: 'Excluir cartão',
          onclick: function () { deleteCard(card); } })
      ])
    ]);

    const metrics = el('div', { class: 'card-metrics' }, [
      el('div', { class: 'card-metric' }, [
        el('span', { class: 'muted small', text: 'Fatura de ' + U.MESES[state.month0] }),
        el('strong', { class: 'card-metric-val', text: U.formatBRL(total) })
      ]),
      card.limit ? el('div', { class: 'card-metric' }, [
        el('span', { class: 'muted small', text: 'Limite disponível' }),
        el('strong', { class: 'card-metric-val ' + (available < 0 ? 'neg' : ''),
          text: U.formatBRL(available) }),
        el('div', { class: 'limit-bar' }, [
          el('div', { class: 'limit-fill', style:
            'width:' + Math.min(100, Math.max(0, (openBal / card.limit) * 100)) + '%;' +
            'background:' + card.color })
        ])
      ]) : null,
      el('div', { class: 'card-metric' }, [
        el('span', { class: 'muted small', text: 'Situação da fatura' }),
        el('button', {
          class: 'chip ' + (paid ? 'chip-on' : ''),
          text: paid ? '✓ Paga' : 'Marcar como paga',
          onclick: function () { toggleInvoicePaid(card.id); }
        })
      ])
    ]);

    const panel = el('div', { class: 'panel card-panel' }, [header, metrics]);

    if (!items.length) {
      panel.appendChild(el('p', { class: 'muted card-empty', text: 'Sem lançamentos nesta fatura.' }));
      return panel;
    }

    const expanded = !!cardExpanded[card.id];
    const toggle = el('button', {
      class: 'card-toggle' + (expanded ? ' open' : ''),
      onclick: function () { cardExpanded[card.id] = !expanded; renderCards(); }
    }, [
      el('span', { class: 'card-toggle-caret', text: expanded ? '▾' : '▸' }),
      el('span', { text: (expanded ? 'Ocultar lançamentos' : 'Ver lançamentos') +
        ' (' + items.length + ')' })
    ]);
    panel.appendChild(toggle);

    if (expanded) {
      const list = el('div', { class: 'txn-list card-txn-list' });
      items.forEach(function (i) {
        const ce = global.Store.getData().cardExpenses.find(function (x) { return x.id === i.cardExpenseId; });
        const instTag = i.of > 1
          ? el('span', { class: 'tag', text: i.n + '/' + i.of }) : null;
        list.appendChild(el('div', { class: 'txn-row' }, [
          el('div', { class: 'txn-main' }, [
            el('div', { class: 'txn-title-line' }, [
              el('span', { class: 'txn-desc', text: i.description }), instTag
            ]),
            el('div', { class: 'txn-meta-line' }, [
              catBadge(i.categoryId),
              el('span', { class: 'txn-meta', text: 'Compra ' + U.formatDateBR(i.purchaseDate) })
            ])
          ]),
          el('div', { class: 'txn-right' }, [
            el('span', { class: 'txn-amount neg', text: '- ' + U.formatBRL(i.amount) }),
            rowActions(
              function () { global.UI.openCardExpenseModal(card.id, ce, refresh); },
              function () { deleteCardExpense(ce); }
            )
          ])
        ]));
      });
      panel.appendChild(list);
    }
    return panel;
  }

  function toggleInvoicePaid(cardId) {
    const d = global.Store.getData();
    const key = F.invoicePaidKey(cardId, state.year, state.month0);
    if (d.invoicePaid[key]) delete d.invoicePaid[key];
    else d.invoicePaid[key] = true;
    global.Store.save();
    render();
  }

  function deleteCard(card) {
    const d = global.Store.getData();
    const count = d.cardExpenses.filter(function (x) { return x.cardId === card.id; }).length;
    const msg = count
      ? 'Excluir "' + card.name + '" e suas ' + count + ' compra(s) cadastradas?'
      : 'Excluir o cartão "' + card.name + '"?';
    global.UI.confirmModal('Excluir cartão', msg, function () {
      d.cards = d.cards.filter(function (c) { return c.id !== card.id; });
      d.cardExpenses = d.cardExpenses.filter(function (x) { return x.cardId !== card.id; });
      global.Store.save();
      U.toast('Cartão excluído.', 'success');
      render();
    }, true);
  }

  function deleteCardExpense(ce) {
    global.UI.confirmModal('Excluir compra',
      'Excluir "' + ce.description + '"? Todas as parcelas serão removidas.', function () {
        const d = global.Store.getData();
        d.cardExpenses = d.cardExpenses.filter(function (x) { return x.id !== ce.id; });
        global.Store.save();
        U.toast('Compra excluída.', 'success');
        render();
      }, true);
  }

  /* ================================================================== *
   *  Aba: Orçamento                                                     *
   * ================================================================== */
  function renderBudgets() {
    const d = global.Store.getData();
    view.innerHTML = '';
    view.appendChild(sectionHeader('Orçamento por categoria'));

    const goal = F.monthGoal(state.year, state.month0);
    const spentAll = F.expenseByCategory(state.year, state.month0)
      .reduce(function (s, c) { return s + c.total; }, 0);

    view.appendChild(el('div', { class: 'stat-grid' }, [
      statCard('Total orçado', U.formatBRL(goal.limit), ''),
      statCard('Gasto no mês', U.formatBRL(spentAll), 'expense'),
      statCard('Saldo do orçamento', U.formatBRL(goal.remaining),
        goal.remaining >= 0 ? 'positive' : 'negative')
    ]));

    view.appendChild(el('p', { class: 'muted', text:
      'Defina um limite mensal para cada categoria de despesa. A barra mostra o quanto você já gastou ' +
      'no mês selecionado e alerta quando o orçamento estoura.' }));

    const expenseCats = d.categories.filter(function (c) { return c.type === 'expense'; });
    const spentMap = {};
    F.expenseByCategory(state.year, state.month0).forEach(function (c) { spentMap[c.categoryId] = c.total; });

    const panel = el('div', { class: 'panel' });
    expenseCats.forEach(function (cat) {
      const limit = F.getBudget(cat.id);
      const spent = spentMap[cat.id] || 0;
      const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
      const over = limit > 0 && spent > limit;

      const input = el('input', {
        type: 'text', inputmode: 'decimal', class: 'input-money budget-input',
        placeholder: 'Sem limite', value: limit > 0 ? U.formatNumber(limit) : ''
      });
      input.addEventListener('change', function () {
        F.setBudget(cat.id, U.parseAmount(input.value));
        renderBudgets();
      });

      const bar = limit > 0
        ? el('div', { class: 'progress slim' }, [
            el('div', { class: 'progress-fill ' + (over ? 'over' : ''), style:
              'width:' + pct + '%;background:' + (over ? '' : cat.color) })
          ])
        : el('div', { class: 'muted small', text: 'Defina um limite para acompanhar.' });

      panel.appendChild(el('div', { class: 'budget-row' }, [
        el('div', { class: 'budget-cat' }, [
          el('span', { class: 'cat-dot', style: 'background:' + cat.color }),
          el('span', { class: 'budget-name', text: cat.name })
        ]),
        el('div', { class: 'budget-track' }, [
          bar,
          limit > 0 ? el('div', { class: 'budget-values muted small', text:
            U.formatBRL(spent) + ' de ' + U.formatBRL(limit) +
            (over ? ' • estourou ' + U.formatBRL(spent - limit) : ' • resta ' + U.formatBRL(limit - spent))
          }) : null
        ]),
        el('div', { class: 'budget-input-wrap' }, [
          el('span', { class: 'muted small', text: 'R$' }), input
        ])
      ]));
    });
    view.appendChild(panel);
  }

  /* ================================================================== *
   *  Aba: Contas                                                        *
   * ================================================================== */
  function renderAccounts() {
    const d = global.Store.getData();
    view.innerHTML = '';
    const addBtn = el('button', {
      class: 'btn primary', text: '+ Nova conta',
      onclick: function () { global.UI.openAccountModal(null, refresh); }
    });
    view.appendChild(sectionHeader('Contas', addBtn));

    if (!d.accounts.length) {
      const b = el('button', {
        class: 'btn primary', text: '+ Criar primeira conta',
        onclick: function () { global.UI.openAccountModal(null, refresh); }
      });
      view.appendChild(emptyState(
        'Cadastre suas contas (banco, carteira, dinheiro) para acompanhar o saldo real. ' +
        'Depois vincule despesas, receitas e cartões a elas.', b));
      return;
    }

    const totalBal = F.totalAccountsBalance();
    view.appendChild(el('div', { class: 'stat-grid single' }, [
      statCard('Saldo total das contas', U.formatBRL(totalBal),
        totalBal >= 0 ? 'positive' : 'negative', 'Somente lançamentos efetivados')
    ]));

    const typeLabels = {
      banco: 'Conta bancária', carteira: 'Carteira digital',
      dinheiro: 'Dinheiro', poupanca: 'Poupança', outro: 'Conta'
    };
    const grid = el('div', { class: 'account-grid' });
    d.accounts.forEach(function (acc) {
      const bal = F.accountBalance(acc.id);
      grid.appendChild(el('div', { class: 'panel account-card', style: '--acc:' + acc.color }, [
        el('div', { class: 'account-top' }, [
          el('div', { class: 'account-badge', style: 'background:' + acc.color, text: acc.name.slice(0, 2).toUpperCase() }),
          el('div', { class: 'account-info' }, [
            el('strong', { text: acc.name }),
            el('span', { class: 'muted small', text: typeLabels[acc.type] || 'Conta' })
          ]),
          el('div', { class: 'row-actions' }, [
            el('button', { class: 'icon-btn small', text: '✎', title: 'Editar',
              onclick: function () { global.UI.openAccountModal(acc, refresh); } }),
            el('button', { class: 'icon-btn small danger', text: '🗑', title: 'Excluir',
              onclick: function () { deleteAccount(acc); } })
          ])
        ]),
        el('div', { class: 'account-balance' }, [
          el('span', { class: 'muted small', text: 'Saldo atual' }),
          el('strong', { class: 'account-balance-val ' + (bal >= 0 ? 'pos' : 'neg'),
            text: U.formatBRL(bal) })
        ]),
        el('div', { class: 'muted small', text: 'Saldo inicial ' + U.formatBRL(acc.initialBalance || 0) })
      ]));
    });
    view.appendChild(grid);
  }

  function deleteAccount(acc) {
    global.UI.confirmModal('Excluir conta',
      'Excluir a conta "' + acc.name + '"? Os lançamentos vinculados ficam sem conta.',
      function () {
        const d = global.Store.getData();
        d.accounts = d.accounts.filter(function (a) { return a.id !== acc.id; });
        d.transactions.forEach(function (t) { if (t.accountId === acc.id) t.accountId = ''; });
        d.cards.forEach(function (c) { if (c.accountId === acc.id) c.accountId = ''; });
        global.Store.save();
        U.toast('Conta excluída.', 'success');
        render();
      }, true);
  }

  /* ================================================================== *
   *  Aba: Configurações                                                 *
   * ================================================================== */
  function renderConfig() {
    const d = global.Store.getData();
    view.innerHTML = '';
    view.appendChild(sectionHeader('Configurações'));

    // Categorias
    ['expense', 'income'].forEach(function (type) {
      const isIncome = type === 'income';
      const cats = d.categories.filter(function (c) { return c.type === type; });
      const addBtn = el('button', {
        class: 'btn small primary', text: '+ Categoria',
        onclick: function () { global.UI.openCategoryModal(type, null, refresh); }
      });
      const panel = el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head-row' }, [
          el('h3', { class: 'panel-title', text: isIncome ? 'Categorias de receita' : 'Categorias de despesa' }),
          addBtn
        ])
      ]);
      const chips = el('div', { class: 'cat-chip-grid' });
      cats.forEach(function (c) {
        chips.appendChild(el('div', { class: 'cat-chip', style: 'border-color:' + c.color }, [
          el('span', { class: 'cat-dot', style: 'background:' + c.color }),
          el('span', { class: 'cat-chip-name', text: c.name }),
          el('button', { class: 'icon-btn tiny', text: '✎', title: 'Editar',
            onclick: function () { global.UI.openCategoryModal(type, c, refresh); } }),
          el('button', { class: 'icon-btn tiny danger', text: '✕', title: 'Excluir',
            onclick: function () { deleteCategory(c); } })
        ]));
      });
      panel.appendChild(chips);
      view.appendChild(panel);
    });

    // Sincronização na nuvem
    if (global.Sync) view.appendChild(renderSyncPanel());

    // Backup
    const backupPanel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Backup e dados' }),
      el('p', { class: 'muted', text:
        'Seus dados ficam salvos apenas neste navegador. Exporte um backup regularmente ' +
        'para não perder informações ao limpar o navegador ou trocar de dispositivo.' }),
      el('div', { class: 'button-row' }, [
        el('button', { class: 'btn primary', text: '↓ Exportar backup (JSON)', onclick: exportBackup }),
        el('button', { class: 'btn', text: '↑ Importar backup', onclick: importBackup }),
        el('button', { class: 'btn danger', text: '⟳ Apagar tudo', onclick: resetEverything })
      ]),
      el('input', { type: 'file', id: 'importFile', accept: '.json,application/json',
        style: 'display:none', onchange: onImportFile })
    ]);
    view.appendChild(backupPanel);

    // Importar lançamentos (soma, não substitui)
    const importPanel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Importar lançamentos' }),
      el('p', { class: 'muted', text:
        'Adiciona vários lançamentos de uma vez (ex.: exportação de outra planilha), ' +
        'sem apagar o que já existe. Categorias novas são criadas automaticamente e ' +
        'lançamentos idênticos são ignorados para evitar duplicidade.' }),
      el('div', { class: 'button-row' }, [
        el('button', { class: 'btn primary', text: '↥ Importar lançamentos (JSON)',
          onclick: function () { document.getElementById('importTxFile').click(); } }),
        el('button', { class: 'btn danger', text: '🗑 Remover lançamentos deste arquivo',
          onclick: function () { document.getElementById('removeTxFile').click(); } })
      ]),
      el('small', { class: 'field-hint', text:
        'Para desfazer uma importação, selecione o MESMO arquivo em "Remover": ' +
        'apaga apenas os lançamentos idênticos aos do arquivo.' }),
      el('input', { type: 'file', id: 'importTxFile', accept: '.json,application/json',
        style: 'display:none', onchange: onImportTxFile }),
      el('input', { type: 'file', id: 'removeTxFile', accept: '.json,application/json',
        style: 'display:none', onchange: onRemoveTxFile })
    ]);
    view.appendChild(importPanel);

    // Estatísticas rápidas
    view.appendChild(el('div', { class: 'panel muted small' }, [
      el('p', { text:
        d.transactions.length + ' lançamento(s) • ' +
        d.cards.length + ' cartão(ões) • ' +
        d.cardExpenses.length + ' compra(s) no cartão • ' +
        d.categories.length + ' categoria(s).' })
    ]));
  }

  /* ---------- Painel de sincronização na nuvem ---------- */
  function renderSyncPanel() {
    const st = global.Sync.getState();
    const panel = el('div', { class: 'panel sync-panel' });

    const statusDotClass = st.connected ? 'ok'
      : (st.status === 'error' || st.status === 'offline') ? 'err'
      : st.status === 'connecting' || st.status === 'syncing' ? 'warn' : 'idle';

    panel.appendChild(el('div', { class: 'panel-head-row' }, [
      el('h3', { class: 'panel-title', text: 'Sincronização na nuvem' }),
      el('span', { class: 'sync-status' }, [
        el('span', { class: 'sync-dot ' + statusDotClass }),
        el('span', { class: 'muted small', text:
          st.connected ? 'Conectado' :
          st.status === 'connecting' ? 'Conectando...' :
          st.status === 'syncing' ? 'Sincronizando...' :
          st.status === 'error' ? 'Erro' :
          st.status === 'offline' ? 'Offline' : 'Desativada' })
      ])
    ]));

    // Mensagem de erro/status visível para diagnóstico
    if (st.message && (st.status === 'error' || st.status === 'offline')) {
      panel.appendChild(el('div', { class: 'alert-banner' }, [
        el('span', { class: 'alert-icon', text: '⚠' }),
        el('span', { text: st.message })
      ]));
    }

    // Estado 1: não configurado -> colar firebaseConfig
    if (!st.configured) {
      const ta = el('textarea', {
        class: 'sync-textarea', rows: 7,
        placeholder: 'Cole aqui o objeto firebaseConfig do console do Firebase, ex:\n\n' +
          'const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...",\n' +
          '  projectId: "...",\n  appId: "..."\n};'
      });
      panel.appendChild(el('p', { class: 'muted small', html:
        'Para sincronizar entre celular e computador, crie um projeto gratuito no ' +
        '<strong>Firebase</strong> e cole aqui as credenciais. Passo a passo no arquivo ' +
        '<code>SINCRONIZACAO.md</code> do projeto.' }));
      panel.appendChild(ta);
      panel.appendChild(el('div', { class: 'button-row' }, [
        el('button', {
          class: 'btn primary', text: 'Conectar',
          onclick: function () {
            try {
              global.Sync.saveConfig(ta.value);
              U.toast('Configuração salva. Agora faça login.', 'success');
              render();
            } catch (e) { U.toast(e.message, 'error'); }
          }
        })
      ]));
      return panel;
    }

    // Estado 2: configurado mas sem login -> email/senha
    if (!st.email) {
      const emailIn = el('input', { type: 'email', class: 'sync-input', placeholder: 'seu@email.com' });
      const passIn = el('input', { type: 'password', class: 'sync-input', placeholder: 'senha (mín. 6 caracteres)' });
      panel.appendChild(el('p', { class: 'muted small', text:
        'Entre com seu e-mail e senha. Use os mesmos dados nos dois aparelhos para os ' +
        'lançamentos sincronizarem automaticamente.' }));
      panel.appendChild(el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'E-mail' }), emailIn]),
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Senha' }), passIn])
      ]));
      if (st.message) panel.appendChild(el('p', { class: 'muted small', text: st.message }));
      panel.appendChild(el('div', { class: 'button-row' }, [
        el('button', {
          class: 'btn primary', text: 'Entrar',
          onclick: function () {
            global.Sync.login(emailIn.value, passIn.value)
              .catch(function (e) { U.toast('Erro ao entrar: ' + friendlyAuth(e), 'error'); });
          }
        }),
        el('button', {
          class: 'btn', text: 'Criar conta',
          onclick: function () {
            global.Sync.register(emailIn.value, passIn.value)
              .then(function () { U.toast('Conta criada!', 'success'); })
              .catch(function (e) { U.toast('Erro ao criar: ' + friendlyAuth(e), 'error'); });
          }
        }),
        el('button', {
          class: 'btn ghost', text: 'Remover configuração',
          onclick: function () {
            global.UI.confirmModal('Remover sincronização',
              'Isso apaga as credenciais do Firebase deste aparelho (os dados locais ' +
              'permanecem). Continuar?', function () {
                global.Sync.removeConfig(); render();
              }, true);
          }
        })
      ]));
      return panel;
    }

    // Estado 3: logado
    panel.appendChild(el('p', { class: '', html:
      'Conectado como <strong>' + U.escapeHtml(st.email) + '</strong>. Seus lançamentos ' +
      'sincronizam automaticamente entre os aparelhos com esta mesma conta.' }));
    if (st.lastSync) {
      panel.appendChild(el('p', { class: 'muted small', text:
        'Última sincronização: ' + new Date(st.lastSync).toLocaleString('pt-BR') }));
    }

    // ID de sincronização (uid) — usado para integrar um bot (ex: Telegram)
    if (st.uid) {
      const idField = el('code', { class: 'uid-box', text: st.uid });
      panel.appendChild(el('div', { class: 'uid-row' }, [
        el('span', { class: 'muted small', text: 'ID de sincronização:' }),
        idField,
        el('button', {
          class: 'btn small', text: 'Copiar',
          onclick: function () {
            const done = function () { U.toast('ID copiado.', 'success'); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(st.uid).then(done).catch(function () {
                window.prompt('Copie o ID:', st.uid);
              });
            } else { window.prompt('Copie o ID:', st.uid); }
          }
        })
      ]));
      panel.appendChild(el('p', { class: 'muted small', text:
        'Use este ID para conectar um bot (ex.: Telegram) que lança despesas por mensagem.' }));
    }

    const actions = el('div', { class: 'button-row' }, [
      el('button', {
        class: 'btn', text: 'Sair da conta',
        onclick: function () {
          global.Sync.logout().then(function () { render(); });
        }
      })
    ]);
    // Botão de reconectar quando houver erro/offline
    if (st.status === 'error' || st.status === 'offline') {
      actions.insertBefore(el('button', {
        class: 'btn primary', text: '↻ Tentar novamente',
        onclick: function () {
          U.toast('Reconectando...', 'info');
          global.Sync.retry();
        }
      }), actions.firstChild);
    }
    panel.appendChild(actions);
    return panel;
  }

  function friendlyAuth(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/invalid-email': 'e-mail inválido.',
      'auth/invalid-credential': 'e-mail ou senha incorretos.',
      'auth/wrong-password': 'senha incorreta.',
      'auth/user-not-found': 'conta não encontrada — use "Criar conta".',
      'auth/email-already-in-use': 'este e-mail já tem conta — use "Entrar".',
      'auth/weak-password': 'senha muito fraca (mínimo 6 caracteres).',
      'auth/missing-password': 'informe a senha.',
      'auth/network-request-failed': 'sem conexão com a internet.',
      'auth/too-many-requests': 'muitas tentativas — aguarde alguns minutos e tente de novo.',
      'auth/invalid-api-key': 'chave do Firebase inválida (verifique o firebaseConfig).',
      'auth/operation-not-allowed': 'login por e-mail/senha NÃO está ativado no Firebase. Ative em Authentication → Sign-in method → Email/Password.',
      'auth/configuration-not-found': 'Authentication não configurado no Firebase. Ative em Authentication → Get started → Email/Password.',
      'auth/unauthorized-domain': 'domínio não autorizado no Firebase. Adicione o domínio deste site em Authentication → Settings → Authorized domains.'
    };
    const base = map[code] || (e && e.message) || 'erro desconhecido.';
    return code ? base + ' [' + code + ']' : base;
  }

  function deleteCategory(cat) {
    global.UI.confirmModal('Excluir categoria',
      'Excluir a categoria "' + cat.name + '"? Lançamentos existentes ficam sem categoria.',
      function () {
        const d = global.Store.getData();
        d.categories = d.categories.filter(function (c) { return c.id !== cat.id; });
        global.Store.save();
        render();
      }, true);
  }

  function exportBackup() {
    const blob = new Blob([global.Store.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', {
      href: url,
      download: 'gestor-financeiro-' + U.todayISO() + '.json'
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    U.toast('Backup exportado.', 'success');
  }

  function importBackup() { document.getElementById('importFile').click(); }

  function onImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        global.Store.importJSON(reader.result);
        U.toast('Backup importado com sucesso.', 'success');
        render();
      } catch (err) {
        U.toast('Arquivo inválido: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /* ---------- Importação de lançamentos (mescla) ---------- */
  function normImportDate(v) {
    v = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return br[3] + '-' + br[2] + '-' + br[1];
    return '';
  }
  function normName(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }

  function importTransactions(list) {
    if (!Array.isArray(list)) throw new Error('O arquivo deve conter uma lista de lançamentos.');
    const d = global.Store.getData();
    // Deduplica só contra o que JÁ existe (permite reimportar sem duplicar;
    // linhas repetidas dentro do mesmo arquivo são todas importadas).
    const existing = {};
    d.transactions.forEach(function (t) {
      existing[t.type + '|' + t.date + '|' + normName(t.description) + '|' + (Number(t.amount) || 0)] = true;
    });
    let added = 0, dupes = 0, invalid = 0, uncategorized = 0;

    list.forEach(function (item) {
      const type = item.type === 'income' ? 'income' : 'expense';
      const amount = Math.round((Number(item.amount) || 0) * 100) / 100;
      const date = normImportDate(item.date);
      if (amount <= 0 || !date) { invalid++; return; }
      const desc = String(item.description || 'Lançamento').trim();
      const key = type + '|' + date + '|' + normName(desc) + '|' + amount;
      if (existing[key]) { dupes++; return; }

      // Não cria categorias: usa só as já existentes (nome igual); senão, deixa
      // sem categoria ("a classificar").
      const catName = String(item.category || '').trim();
      let categoryId = '';
      if (catName) {
        const cat = d.categories.find(function (c) {
          return c.type === type && normName(c.name) === normName(catName);
        });
        if (cat) categoryId = cat.id;
      }
      if (!categoryId) uncategorized++;

      d.transactions.push({
        id: U.uid('tx'), type: type, description: desc, amount: amount, date: date,
        categoryId: categoryId, recurrence: 'none', recurrenceEnd: '', accountId: ''
      });
      added++;
    });

    global.Store.save();
    return { added: added, dupes: dupes, invalid: invalid, uncategorized: uncategorized };
  }

  // Remove os lançamentos que batem (tipo+data+descrição+valor) com os do arquivo
  function removeTransactions(list) {
    if (!Array.isArray(list)) throw new Error('O arquivo deve conter uma lista de lançamentos.');
    const d = global.Store.getData();
    const targets = {};
    list.forEach(function (item) {
      const type = item.type === 'income' ? 'income' : 'expense';
      const amount = Math.round((Number(item.amount) || 0) * 100) / 100;
      const date = normImportDate(item.date);
      const desc = String(item.description || 'Lançamento').trim();
      if (amount <= 0 || !date) return;
      targets[type + '|' + date + '|' + normName(desc) + '|' + amount] = true;
    });
    const before = d.transactions.length;
    d.transactions = d.transactions.filter(function (t) {
      const key = t.type + '|' + t.date + '|' + normName(t.description) + '|' + (Number(t.amount) || 0);
      return !targets[key];
    });
    const removed = before - d.transactions.length;
    global.Store.save();
    return { removed: removed };
  }

  function onRemoveTxFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let list;
      try {
        const parsed = JSON.parse(reader.result);
        list = Array.isArray(parsed) ? parsed : parsed.transactions;
      } catch (err) {
        U.toast('Arquivo inválido (não é JSON).', 'error'); return;
      }
      global.UI.confirmModal('Remover lançamentos',
        'Isso vai apagar os lançamentos deste aparelho que forem idênticos aos do ' +
        'arquivo (mesma data, descrição e valor). Deseja continuar?',
        function () {
          try {
            const r = removeTransactions(list);
            U.toast(r.removed + ' lançamento(s) removido(s).', 'success');
            render();
          } catch (err) { U.toast(err.message, 'error'); }
        }, true);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function onImportTxFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let list;
      try {
        const parsed = JSON.parse(reader.result);
        list = Array.isArray(parsed) ? parsed : parsed.transactions;
      } catch (err) {
        U.toast('Arquivo inválido (não é JSON).', 'error'); return;
      }
      try {
        const r = importTransactions(list);
        global.UI.confirmModal('Importação concluída',
          r.added + ' lançamento(s) importado(s). ' +
          (r.uncategorized ? r.uncategorized + ' sem categoria (a classificar). ' : '') +
          (r.dupes ? r.dupes + ' duplicado(s) ignorado(s). ' : '') +
          (r.invalid ? r.invalid + ' inválido(s) ignorado(s).' : ''),
          function () { render(); });
        U.toast(r.added + ' lançamentos importados.', 'success');
        render();
      } catch (err) {
        U.toast(err.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function resetEverything() {
    global.UI.confirmModal('Apagar todos os dados',
      'Isso remove TODOS os lançamentos, cartões e categorias personalizadas. ' +
      'Recomendamos exportar um backup antes. Deseja continuar?',
      function () {
        global.Store.resetAll();
        U.toast('Dados reiniciados.', 'success');
        render();
      }, true);
  }

  /* ================================================================== *
   *  Roteador de render                                                 *
   * ================================================================== */
  function render() {
    switch (state.tab) {
      case 'despesas': renderTransactions('expense'); break;
      case 'receitas': renderTransactions('income'); break;
      case 'cartoes': renderCards(); break;
      case 'orcamento': renderBudgets(); break;
      case 'contas': renderAccounts(); break;
      case 'patrimonio': global.Patrimonio.render(); break;
      case 'config': renderConfig(); break;
      default: renderDashboard();
    }
  }

  /* ---------- Botão flutuante (FAB) ---------- */
  function setupFab() {
    const fab = document.getElementById('fab');
    const main = document.getElementById('fabMain');
    const actions = document.getElementById('fabActions');
    const backdrop = document.getElementById('fabBackdrop');
    if (!fab || !main) return;

    // A visibilidade é controlada pela classe .open no CSS (não pelo atributo hidden)
    function open() {
      fab.classList.add('open');
      main.textContent = '✕';
      main.setAttribute('aria-expanded', 'true');
    }
    function close() {
      fab.classList.remove('open');
      main.textContent = '$';
      main.setAttribute('aria-expanded', 'false');
    }
    function toggle(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      fab.classList.contains('open') ? close() : open();
    }

    main.addEventListener('click', toggle);
    backdrop.addEventListener('click', close);

    actions.querySelectorAll('.fab-action').forEach(function (btn) {
      btn.addEventListener('click', function () {
        close();
        const action = btn.dataset.action;
        if (action === 'expense') global.UI.openTransactionModal('expense', null, refresh);
        else if (action === 'income') global.UI.openTransactionModal('income', null, refresh);
        else if (action === 'card') global.UI.openCardExpenseModal(null, null, refresh);
      });
    });
  }

  /* ---------- Tema claro/escuro ---------- */
  function effectiveTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
      ? 'light' : 'dark';
  }
  function updateThemeButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const cur = effectiveTheme();
    btn.textContent = cur === 'light' ? '☀' : '☾';
    btn.title = cur === 'light' ? 'Tema claro — tocar para escuro' : 'Tema escuro — tocar para claro';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('meugestor_theme', theme); } catch (e) {}
    updateThemeButton();
  }
  function setupTheme() {
    try {
      const saved = localStorage.getItem('meugestor_theme');
      if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
    } catch (e) {}
    updateThemeButton();
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', function () {
      applyTheme(effectiveTheme() === 'light' ? 'dark' : 'light');
    });
  }

  /* ---------- Service worker (permite instalar na tela inicial) ---------- */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    // Registro relativo funciona em subpastas (ex: GitHub Pages /Pessoal/)
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline/local: ignora */ });
  }

  /* ================================================================== *
   *  Inicialização                                                      *
   * ================================================================== */
  function init() {
    global.Store.load();

    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });
    document.getElementById('prevMonth').addEventListener('click', function () { shiftMonth(-1); });
    document.getElementById('nextMonth').addEventListener('click', function () { shiftMonth(1); });
    document.getElementById('todayBtn').addEventListener('click', goToday);

    setupTheme();
    setupFab();
    registerServiceWorker();

    updateMonthLabel();
    render();

    // Sincronização na nuvem (opcional): reflete mudanças de status na tela de config
    if (global.Sync) {
      global.Sync.onChange(function () { if (state.tab === 'config') render(); });
      global.Sync.init();
    }
  }

  global.App = { refresh: refresh, setTab: setTab };
  document.addEventListener('DOMContentLoaded', init);
})(window);
