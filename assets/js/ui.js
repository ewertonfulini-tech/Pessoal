/* ui.js — modais e formulários reutilizáveis */
(function (global) {
  'use strict';

  const U = global.Utils;
  const el = U.el;

  /* ---------- Modal base ---------- */
  function openModal(title, bodyNode, opts) {
    opts = opts || {};
    const root = document.getElementById('modalRoot');
    root.innerHTML = '';

    function close() {
      overlay.classList.remove('show');
      setTimeout(function () { root.innerHTML = ''; }, 180);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);

    const header = el('div', { class: 'modal-header' }, [
      el('h2', { text: title }),
      el('button', { class: 'icon-btn', text: '✕', onclick: close, title: 'Fechar' })
    ]);

    const footer = el('div', { class: 'modal-footer' });
    (opts.buttons || []).forEach(function (b) {
      footer.appendChild(el('button', {
        class: 'btn ' + (b.variant || ''),
        text: b.label,
        onclick: function () { b.onClick(close); }
      }));
    });

    const modal = el('div', { class: 'modal' }, [header, bodyNode, footer]);
    const overlay = el('div', {
      class: 'modal-overlay',
      onclick: function (e) { if (e.target === overlay) close(); }
    }, [modal]);

    root.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });

    const firstInput = modal.querySelector('input, select, textarea');
    if (firstInput) setTimeout(function () { firstInput.focus(); }, 60);
    return { close: close };
  }

  function confirmModal(title, message, onConfirm, danger) {
    openModal(title, el('div', { class: 'modal-body' }, [
      el('p', { class: 'confirm-text', text: message })
    ]), {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        {
          label: 'Confirmar', variant: danger ? 'danger' : 'primary',
          onClick: function (c) { onConfirm(); c(); }
        }
      ]
    });
  }

  /* ---------- Helpers de formulário ---------- */
  function field(labelText, inputNode, hint) {
    const children = [el('label', { class: 'field-label', text: labelText }), inputNode];
    if (hint) children.push(el('small', { class: 'field-hint', text: hint }));
    return el('div', { class: 'field' }, children);
  }

  function textInput(value, attrs) {
    return el('input', Object.assign({ type: 'text', value: value == null ? '' : value }, attrs || {}));
  }
  function numberInput(value, attrs) {
    return el('input', Object.assign({
      type: 'text', inputmode: 'decimal', value: value == null ? '' : value,
      placeholder: '0,00', class: 'input-money'
    }, attrs || {}));
  }
  function dateInput(value, attrs) {
    return el('input', Object.assign({ type: 'date', value: value || U.todayISO() }, attrs || {}));
  }
  function select(options, selected, attrs) {
    const s = el('select', attrs || {});
    options.forEach(function (o) {
      const opt = el('option', { value: o.value, text: o.label });
      if (String(o.value) === String(selected)) opt.selected = true;
      s.appendChild(opt);
    });
    return s;
  }

  function categoryOptions(type) {
    const d = global.Store.getData();
    return d.categories
      .filter(function (c) { return c.type === type; })
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }); })
      .map(function (c) { return { value: c.id, label: c.name }; });
  }

  function cardOptions() {
    const d = global.Store.getData();
    return d.cards.map(function (c) { return { value: c.id, label: c.name }; });
  }

  function accountOptions(withNone) {
    const d = global.Store.getData();
    const opts = d.accounts.map(function (a) { return { value: a.id, label: a.name }; });
    if (withNone) opts.unshift({ value: '', label: '— Sem conta —' });
    return opts;
  }

  const ACCOUNT_TYPES = [
    { value: 'banco', label: 'Conta bancária' },
    { value: 'carteira', label: 'Carteira digital' },
    { value: 'dinheiro', label: 'Dinheiro' },
    { value: 'poupanca', label: 'Poupança' },
    { value: 'outro', label: 'Outro' }
  ];

  const RECURRENCE_OPTS = [
    { value: 'none', label: 'Única (não repete)' },
    { value: 'monthly', label: 'Mensal' },
    { value: 'weekly', label: 'Semanal' },
    { value: 'yearly', label: 'Anual' }
  ];

  /* ---------- Modal: Despesa / Receita ---------- */
  // occCtx (opcional): { year, month0 } do mês em edição — habilita escolher o
  // escopo do valor numa recorrência ("só este mês" vs "todos os meses").
  function openTransactionModal(type, existing, onSaved, occCtx) {
    const isEdit = !!existing;
    const tx = existing || {
      type: type, description: '', amount: '', date: U.todayISO(),
      categoryId: (categoryOptions(type)[0] || {}).value, recurrence: 'none', recurrenceEnd: ''
    };
    const title = (isEdit ? 'Editar ' : 'Nova ') + (type === 'income' ? 'receita' : 'despesa');

    // Contexto de recorrência: só oferecemos escopo de valor ao editar uma
    // recorrência dentro de um mês específico.
    const isRecurring = isEdit && tx.recurrence && tx.recurrence !== 'none';
    const monthKey = occCtx ? U.monthKey(occCtx.year, occCtx.month0)
      : (isEdit ? U.monthKey(U.parseISO(tx.date).year, U.parseISO(tx.date).month0) : null);
    const overrideKey = (isRecurring && monthKey) ? (tx.id + ':' + monthKey) : null;
    const overrides = global.Store.getData().amountOverrides || {};
    const hasOverride = overrideKey && overrides[overrideKey] != null;
    // Valor efetivo do mês em edição (exceção, se houver)
    const effectiveAmount = hasOverride ? overrides[overrideKey] : tx.amount;

    const descIn = textInput(tx.description, { placeholder: 'Ex: Aluguel, Salário...' });
    const amountIn = numberInput(effectiveAmount ? U.formatNumber(effectiveAmount) : '');
    const dateIn = dateInput(tx.date);
    const catIn = select(categoryOptions(type), tx.categoryId);
    const recIn = select(RECURRENCE_OPTS, tx.recurrence || 'none');
    const endIn = el('input', { type: 'date', value: tx.recurrenceEnd || '' });
    const hasAccounts = global.Store.getData().accounts.length > 0;
    const acctIn = hasAccounts ? select(accountOptions(true), tx.accountId || '') : null;

    const endField = field('Repetir até (opcional)', endIn, 'Deixe vazio para repetir indefinidamente.');
    function syncEnd() { endField.style.display = recIn.value === 'none' ? 'none' : ''; }
    recIn.addEventListener('change', syncEnd);
    syncEnd();

    // Escopo do valor (só ao editar uma recorrência dentro de um mês)
    let scopeIn = null, scopeField = null;
    if (isRecurring && monthKey) {
      const mLabel = occCtx ? U.monthLabel(occCtx.year, occCtx.month0) : monthKey;
      // Padrão: alterar só o mês em edição (recorrências costumam ter valores
      // diferentes por mês; mudar todos deve ser uma escolha explícita).
      scopeIn = select([
        { value: 'month', label: 'Somente ' + mLabel },
        { value: 'all', label: 'Todos os meses' }
      ], 'month');
      scopeField = field('Aplicar o valor em', scopeIn,
        hasOverride
          ? 'Este mês já tem um valor personalizado. Escolha "Todos os meses" para voltar ao valor da recorrência.'
          : 'Por padrão, altera só este mês. Escolha "Todos os meses" para mudar o valor de toda a recorrência.');
      // O seletor de escopo não faz sentido se a recorrência for removida
      function syncScope() { scopeField.style.display = recIn.value === 'none' ? 'none' : ''; }
      recIn.addEventListener('change', syncScope);
      syncScope();
    }

    const body = el('div', { class: 'modal-body' }, [
      field('Descrição', descIn),
      el('div', { class: 'field-row' }, [
        field('Valor (R$)', amountIn),
        field(type === 'income' ? 'Data prevista' : 'Data', dateIn)
      ]),
      scopeField,
      el('div', { class: 'field-row' }, [
        field('Categoria', catIn),
        field('Recorrência', recIn)
      ]),
      hasAccounts ? field(type === 'income' ? 'Receber na conta' : 'Pagar com a conta', acctIn,
        'Usada para calcular o saldo quando marcado como ' + (type === 'income' ? 'recebido.' : 'pago.')) : null,
      endField
    ]);

    function save(close) {
      const amount = U.parseAmount(amountIn.value);
      if (!descIn.value.trim()) { U.toast('Informe uma descrição.', 'error'); return; }
      if (amount <= 0) { U.toast('Informe um valor maior que zero.', 'error'); return; }

      const d = global.Store.getData();
      const accountId = acctIn ? acctIn.value : (tx.accountId || '');
      if (isEdit) {
        const ref = d.transactions.find(function (t) { return t.id === tx.id; });
        // Campos da série sempre aplicam à recorrência inteira
        ref.description = descIn.value.trim();
        ref.date = dateIn.value;
        ref.categoryId = catIn.value;
        ref.recurrence = recIn.value;
        ref.accountId = accountId;
        ref.recurrenceEnd = recIn.value === 'none' ? '' : (endIn.value || '');
        // Valor: "só este mês" grava uma exceção; "todos os meses" grava na série
        const scope = (scopeIn && recIn.value !== 'none') ? scopeIn.value : 'all';
        if (scope === 'month' && overrideKey) {
          d.amountOverrides[overrideKey] = amount;
        } else {
          ref.amount = amount;
          if (overrideKey && d.amountOverrides[overrideKey] != null) delete d.amountOverrides[overrideKey];
        }
      } else {
        d.transactions.push({
          id: U.uid('tx'), type: type,
          description: descIn.value.trim(), amount: amount, date: dateIn.value,
          categoryId: catIn.value, recurrence: recIn.value, accountId: accountId,
          recurrenceEnd: recIn.value === 'none' ? '' : (endIn.value || '')
        });
      }
      global.Store.save();
      U.toast(isEdit ? 'Alterações salvas.' : 'Lançamento adicionado.', 'success');
      close();
      onSaved && onSaved();
    }

    openModal(title, body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: type === 'income' ? 'success' : 'primary', onClick: save }
      ]
    });
  }

  /* ---------- Modal: Cartão ---------- */
  function openCardModal(existing, onSaved) {
    const isEdit = !!existing;
    const card = existing || {
      name: '', limit: '', closingDay: 1, dueDay: 10, color: '#6366f1', accountId: ''
    };
    const nameIn = textInput(card.name, { placeholder: 'Ex: Nubank, Itaú...' });
    const limitIn = numberInput(card.limit ? U.formatNumber(card.limit) : '');
    const closeIn = el('input', { type: 'number', min: 1, max: 31, value: card.closingDay || 1 });
    const dueIn = el('input', { type: 'number', min: 1, max: 31, value: card.dueDay || 10 });
    const colorIn = el('input', { type: 'color', value: card.color || '#6366f1', class: 'input-color' });
    const hasAccounts = global.Store.getData().accounts.length > 0;
    const acctIn = hasAccounts ? select(accountOptions(true), card.accountId || '') : null;

    const body = el('div', { class: 'modal-body' }, [
      field('Nome do cartão', nameIn),
      field('Limite (R$)', limitIn, 'Opcional. Usado para acompanhar o limite disponível.'),
      el('div', { class: 'field-row' }, [
        field('Dia de fechamento', closeIn),
        field('Dia de vencimento', dueIn)
      ]),
      hasAccounts ? field('Conta que paga a fatura', acctIn,
        'Ao marcar a fatura como paga, o valor é debitado desta conta.') : null,
      field('Cor', colorIn)
    ]);

    function save(close) {
      if (!nameIn.value.trim()) { U.toast('Informe o nome do cartão.', 'error'); return; }
      const d = global.Store.getData();
      const payload = {
        name: nameIn.value.trim(),
        limit: U.parseAmount(limitIn.value),
        closingDay: Math.min(31, Math.max(1, parseInt(closeIn.value, 10) || 1)),
        dueDay: Math.min(31, Math.max(1, parseInt(dueIn.value, 10) || 10)),
        color: colorIn.value,
        accountId: acctIn ? acctIn.value : (card.accountId || '')
      };
      if (isEdit) {
        Object.assign(d.cards.find(function (c) { return c.id === card.id; }), payload);
      } else {
        d.cards.push(Object.assign({ id: U.uid('card') }, payload));
      }
      global.Store.save();
      U.toast(isEdit ? 'Cartão atualizado.' : 'Cartão cadastrado.', 'success');
      close();
      onSaved && onSaved();
    }

    openModal(isEdit ? 'Editar cartão' : 'Novo cartão', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  /* ---------- Modal: Compra no cartão ---------- */
  // defaults (opcional): { type: 'estorno' } abre já no modo estorno
  function openCardExpenseModal(defaultCardId, existing, onSaved, defaults) {
    const isEdit = !!existing;
    const cards = cardOptions();
    if (!cards.length) { U.toast('Cadastre um cartão primeiro.', 'error'); return; }

    const ce = existing || {
      cardId: defaultCardId || cards[0].value, description: '', totalAmount: '',
      purchaseDate: U.todayISO(), installments: 1,
      categoryId: (categoryOptions('expense')[0] || {}).value
    };

    const initialType = (Number(ce.totalAmount) < 0) ? 'estorno'
      : (defaults && defaults.type === 'estorno' ? 'estorno' : 'compra');
    const cardIn = select(cards, ce.cardId);
    const typeIn = select([
      { value: 'compra', label: 'Compra' },
      { value: 'estorno', label: 'Estorno (crédito)' }
    ], initialType);
    const descIn = textInput(ce.description, { placeholder: 'Ex: Notebook, Mercado...' });
    const amountIn = numberInput(ce.totalAmount ? U.formatNumber(Math.abs(ce.totalAmount)) : '');
    const dateIn = dateInput(ce.purchaseDate);
    const instIn = el('input', { type: 'number', min: 1, max: 120, value: ce.installments || 1 });
    const catIn = select(categoryOptions('expense'), ce.categoryId);
    const recIn = select(RECURRENCE_OPTS, ce.recurrence || 'none');
    const endIn = el('input', { type: 'date', value: ce.recurrenceEnd || '' });

    const RECUR_LABEL = { weekly: 'semanal', monthly: 'mensal', yearly: 'anual' };
    const parcelField = field('Parcelas', instIn);
    const endField = field('Repetir até (opcional)', endIn, 'Deixe vazio para repetir indefinidamente.');

    const preview = el('div', { class: 'installment-preview' });
    function isEstorno() { return typeIn.value === 'estorno'; }
    function isRecurring() { return !isEstorno() && recIn.value !== 'none'; }
    function updatePreview() {
      const total = U.parseAmount(amountIn.value);
      if (total <= 0) { preview.innerHTML = ''; return; }
      if (isEstorno()) {
        preview.innerHTML = U.escapeHtml('Estorno (crédito) de ' + U.formatBRL(total) + ' — abate da fatura.');
        return;
      }
      if (isRecurring()) {
        preview.innerHTML = U.escapeHtml('Cobrança ' + RECUR_LABEL[recIn.value] + ' de ' + U.formatBRL(total) +
          ' — lançada automaticamente na fatura de cada período.');
        return;
      }
      const n = Math.max(1, parseInt(instIn.value, 10) || 1);
      const per = total / n;
      preview.innerHTML = n > 1
        ? U.escapeHtml(n + 'x de ' + U.formatBRL(per) + '  •  total ' + U.formatBRL(total))
        : U.escapeHtml('À vista: ' + U.formatBRL(total));
    }
    const recurRow = el('div', { class: 'field-row' }, [field('Recorrência', recIn), endField]);
    function syncAll() {
      const est = isEstorno();
      recurRow.style.display = est ? 'none' : '';
      parcelField.style.display = (est || isRecurring()) ? 'none' : '';
      endField.style.display = (!est && isRecurring()) ? '' : 'none';
      if (est || isRecurring()) instIn.value = 1;
      updatePreview();
    }
    amountIn.addEventListener('input', updatePreview);
    instIn.addEventListener('input', updatePreview);
    recIn.addEventListener('change', syncAll);
    typeIn.addEventListener('change', syncAll);

    const body = el('div', { class: 'modal-body' }, [
      field('Cartão', cardIn),
      field('Tipo', typeIn),
      field('Descrição', descIn),
      el('div', { class: 'field-row' }, [
        field('Valor (R$)', amountIn),
        parcelField
      ]),
      el('div', { class: 'field-row' }, [
        field('Data', dateIn),
        field('Categoria', catIn)
      ]),
      recurRow,
      preview
    ]);
    syncAll();

    function save(close) {
      const total = U.parseAmount(amountIn.value);
      if (!descIn.value.trim()) { U.toast('Informe uma descrição.', 'error'); return; }
      if (total <= 0) { U.toast('Informe um valor maior que zero.', 'error'); return; }
      const d = global.Store.getData();
      const est = isEstorno();
      const recurrence = est ? 'none' : recIn.value;
      const payload = {
        cardId: cardIn.value, description: descIn.value.trim(),
        // Estorno é lançado como valor negativo (crédito que abate a fatura)
        totalAmount: est ? -Math.abs(total) : total,
        purchaseDate: dateIn.value,
        installments: (est || recurrence !== 'none') ? 1 : Math.max(1, parseInt(instIn.value, 10) || 1),
        categoryId: catIn.value,
        recurrence: recurrence,
        recurrenceEnd: recurrence === 'none' ? '' : (endIn.value || '')
      };
      if (isEdit) {
        Object.assign(d.cardExpenses.find(function (x) { return x.id === ce.id; }), payload);
      } else {
        d.cardExpenses.push(Object.assign({ id: U.uid('ce') }, payload));
      }
      global.Store.save();
      const label = est ? 'Estorno' : 'Compra';
      U.toast(isEdit ? (label + ' atualizado(a).') : (label + ' adicionado(a).'), 'success');
      close();
      onSaved && onSaved();
    }

    openModal(isEdit ? 'Editar lançamento' : 'Novo lançamento no cartão', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  /* ---------- Modal: Categoria ---------- */
  function openCategoryModal(type, existing, onSaved) {
    const isEdit = !!existing;
    const cat = existing || { name: '', color: '#6366f1', type: type };
    const nameIn = textInput(cat.name, { placeholder: 'Nome da categoria' });
    const colorIn = el('input', { type: 'color', value: cat.color, class: 'input-color' });
    const body = el('div', { class: 'modal-body' }, [
      field('Nome', nameIn),
      field('Cor', colorIn)
    ]);
    function save(close) {
      if (!nameIn.value.trim()) { U.toast('Informe o nome.', 'error'); return; }
      const d = global.Store.getData();
      if (isEdit) {
        Object.assign(d.categories.find(function (c) { return c.id === cat.id; }),
          { name: nameIn.value.trim(), color: colorIn.value });
      } else {
        d.categories.push({
          id: U.uid('cat'), name: nameIn.value.trim(), color: colorIn.value, type: cat.type
        });
      }
      global.Store.save();
      close();
      onSaved && onSaved();
    }
    openModal(isEdit ? 'Editar categoria' : 'Nova categoria', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  /* ---------- Modal: Conta ---------- */
  function openAccountModal(existing, onSaved) {
    const isEdit = !!existing;
    const acc = existing || { name: '', type: 'banco', initialBalance: '', color: '#6366f1' };
    const nameIn = textInput(acc.name, { placeholder: 'Ex: Nubank, Carteira, Dinheiro...' });
    const typeIn = select(ACCOUNT_TYPES, acc.type);
    const balIn = numberInput(
      (acc.initialBalance !== '' && acc.initialBalance != null) ? U.formatNumber(acc.initialBalance) : ''
    );
    const colorIn = el('input', { type: 'color', value: acc.color || '#6366f1', class: 'input-color' });

    const body = el('div', { class: 'modal-body' }, [
      field('Nome da conta', nameIn),
      el('div', { class: 'field-row' }, [
        field('Tipo', typeIn),
        field('Saldo inicial (R$)', balIn)
      ]),
      el('small', { class: 'field-hint', text:
        'O saldo evolui somando receitas recebidas e subtraindo despesas/faturas pagas nesta conta.' }),
      field('Cor', colorIn)
    ]);

    function save(close) {
      if (!nameIn.value.trim()) { U.toast('Informe o nome da conta.', 'error'); return; }
      const d = global.Store.getData();
      const payload = {
        name: nameIn.value.trim(), type: typeIn.value,
        initialBalance: U.parseAmount(balIn.value), color: colorIn.value
      };
      if (isEdit) {
        Object.assign(d.accounts.find(function (a) { return a.id === acc.id; }), payload);
      } else {
        d.accounts.push(Object.assign({ id: U.uid('acc') }, payload));
      }
      global.Store.save();
      U.toast(isEdit ? 'Conta atualizada.' : 'Conta criada.', 'success');
      close();
      onSaved && onSaved();
    }

    openModal(isEdit ? 'Editar conta' : 'Nova conta', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  global.UI = {
    openModal, confirmModal,
    field, textInput, numberInput, dateInput, select,
    openTransactionModal, openCardModal, openCardExpenseModal, openCategoryModal,
    openAccountModal
  };
})(window);
