/* patrimonio.js — aba de Patrimônio: investimentos, imóveis/veículos, FGTS e metas */
(function (global) {
  'use strict';

  const U = global.Utils;
  const UI = global.UI;
  const el = U.el;

  const TIPOS = ['A classificar', 'Renda Fixa', 'Tesouro', 'Fundos', 'COE', 'FIIs', 'Ações',
    'Multimercado', 'Cripto', 'Previdência', 'Caixa', 'Outros'];
  const TYPE_ORDER = ['Renda Fixa', 'Tesouro', 'Fundos', 'COE', 'FIIs', 'Ações', 'Multimercado',
    'Cripto', 'Previdência', 'Caixa', 'Outros', 'A classificar'];
  // Paleta categórica reaproveitando os tons semânticos existentes + alguns extras
  // condizentes com a paleta escuro/champagne/dourado do app (sem tocar styles.css).
  const PALETTE = ['var(--primary)', 'var(--income)', 'var(--expense)', 'var(--warn)',
    'var(--danger)', '#8a7fd9', '#4fa3c9', '#b98fd1'];

  const view = document.getElementById('view');

  function pat() { return global.Store.getData().patrimonio; }
  function refresh() { render(); }

  function formatUSD(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
  }
  function monthLabelShort(mes) {
    const m = String(mes || '').match(/(\d{4})-(\d{1,2})/);
    if (!m) return mes || '—';
    return U.MESES_CURTOS[(+m[2] - 1 + 12) % 12] + '/' + m[1].slice(2);
  }
  function countInstituicoes(p) {
    return new Set(p.investimentos.filter(function (i) { return +i.valor > 0; })
      .map(function (i) { return i.instituicao; })).size;
  }

  /* ---------- Componentes locais (mesma convenção de app.js) ---------- */
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

  /* ---------- Derivação ---------- */
  function derive() {
    const p = pat();
    const imobTotal = p.imobilizado.reduce(function (a, i) { return a + (+i.valor || 0); }, 0);
    const dividaTotal = p.imobilizado.reduce(function (a, i) { return a + (+i.divida || 0); }, 0);
    const invTotal = p.investimentos.reduce(function (a, i) { return a + (+i.valor || 0); }, 0);
    const fgts = +p.fgts || 0;
    const bruto = imobTotal + invTotal;
    const liquidoSemFGTS = bruto - dividaTotal;
    const liquidoComFGTS = liquidoSemFGTS + fgts;
    const usdVal = p.cambioUSD > 0 ? liquidoSemFGTS / p.cambioUSD : 0;
    return { imobTotal, dividaTotal, invTotal, fgts, bruto, liquidoSemFGTS, liquidoComFGTS, usdVal };
  }

  /* ================================================================== *
   *  Render principal                                                   *
   * ================================================================== */
  function render() {
    const d = derive();
    view.innerHTML = '';
    view.appendChild(sectionHeader('Patrimônio'));

    view.appendChild(renderKpis(d));

    const grid1 = el('div', { class: 'dashboard-grid' });
    grid1.appendChild(renderComposicaoPanel(d));
    grid1.appendChild(renderMetaPanel(d));
    view.appendChild(grid1);

    view.appendChild(renderEvolucaoPanel(d));

    const grid2 = el('div', { class: 'dashboard-grid' });
    grid2.appendChild(renderInstituicoesPanel(d));
    grid2.appendChild(renderTiposPanel(d));
    view.appendChild(grid2);

    view.appendChild(renderImobPanel());
    view.appendChild(renderInvPanel());
    view.appendChild(renderMovimentacaoPanel());
    view.appendChild(renderHistoricoPanel());

    if (global.PatrimonioImport) view.appendChild(global.PatrimonioImport.buildPanel(refresh));
  }

  /* ---------- KPIs ---------- */
  function renderKpis(d) {
    const p = pat();
    const cards = [
      statCard('Patrimônio líquido', U.formatBRL(d.liquidoSemFGTS), d.liquidoSemFGTS >= 0 ? 'positive' : 'negative',
        formatUSD(d.usdVal) + ' · câmbio R$ ' + U.formatNumber(p.cambioUSD)),
      statCard('Líquido + FGTS', U.formatBRL(d.liquidoComFGTS), 'positive',
        'inclui FGTS de ' + U.formatBRL(d.fgts)),
      statCard('Imóveis & veículos', U.formatBRL(d.imobTotal), '',
        p.imobilizado.length + ' bem(ns)'),
      statCard('Investimentos', U.formatBRL(d.invTotal), '',
        countInstituicoes(p) + ' instituição(ões)'),
      statCard('Dívidas / financiamentos', U.formatBRL(d.dividaTotal), d.dividaTotal > 0 ? 'negative' : '',
        (d.bruto > 0 ? (d.dividaTotal / d.bruto * 100).toFixed(0) : 0) + '% do patrimônio bruto')
    ];
    return el('div', { class: 'stat-grid four' }, cards);
  }

  /* ---------- Composição (donut) ---------- */
  function renderComposicaoPanel(d) {
    const entries = [
      { name: 'Imóveis & veículos', color: PALETTE[0], total: d.imobTotal },
      { name: 'Investimentos', color: PALETTE[1], total: d.invTotal },
      { name: 'FGTS', color: PALETTE[3], total: d.fgts }
    ].filter(function (e) { return e.total > 0; });
    const totalAtivos = entries.reduce(function (a, e) { return a + e.total; }, 0);

    const panel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Composição do patrimônio' })
    ]);
    const donutWrap = el('div', { class: 'donut-wrap' }, [
      global.Charts.donutGeneric(entries, { size: 180, stroke: 24, topLabel: 'ativos' })
    ]);
    const legend = el('div', { class: 'legend' });
    entries.forEach(function (e) {
      legend.appendChild(el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:' + e.color }),
        el('span', { class: 'legend-name', text: e.name }),
        el('span', { class: 'legend-val', text: U.formatBRL(e.total) })
      ]));
    });
    if (d.dividaTotal > 0) {
      legend.appendChild(el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:var(--danger)' }),
        el('span', { class: 'legend-name', text: '(–) Dívidas' }),
        el('span', { class: 'legend-val', text: '-' + U.formatBRL(d.dividaTotal) })
      ]));
    }
    if (!entries.length) legend.appendChild(el('p', { class: 'muted', text: 'Sem dados ainda.' }));
    panel.appendChild(el('div', { class: 'donut-layout' }, [donutWrap, legend]));
    if (totalAtivos > 0) {
      panel.appendChild(el('p', { class: 'muted small', text:
        'Ativos totais: ' + U.formatBRL(totalAtivos) + ' · dívidas de ' + U.formatBRL(d.dividaTotal) + ' deduzidas do líquido' }));
    }
    return panel;
  }

  /* ---------- Meta ---------- */
  function renderMetaPanel(d) {
    const p = pat();
    const meta = +p.meta.valor || 0;
    const falta = Math.max(meta - d.invTotal, 0);
    const prog = meta > 0 ? Math.min(d.invTotal / meta * 100, 100) : 0;
    const now = new Date();
    const mesesRest = (now.getFullYear() === +p.meta.ano) ? Math.max(12 - now.getMonth(), 1) : 12;
    const mensal = falta / mesesRest;

    const editBtn = el('button', {
      class: 'icon-btn small', text: '✎', title: 'Editar meta e configurações',
      onclick: function () { openGoalModal(refresh); }
    });

    return el('div', { class: 'panel goal-panel' }, [
      el('div', { class: 'panel-head-row' }, [
        el('h3', { class: 'panel-title', text: 'Meta ' + p.meta.ano }),
        editBtn
      ]),
      el('div', { class: 'goal-head' }, [
        el('span', { text: U.formatBRL(d.invTotal) + ' de ' + U.formatBRL(meta) }),
        el('strong', { class: falta > 0 ? 'neg' : '', text: falta > 0 ? 'falta ' + U.formatBRL(falta) : 'meta atingida' })
      ]),
      el('div', { class: 'progress' }, [
        el('div', { class: 'progress-fill', style: 'width:' + prog + '%' })
      ]),
      el('div', { class: 'goal-foot muted small', text:
        meta > 0
          ? 'Aporte mensal necessário: ' + U.formatBRL(mensal) + '/mês (' + mesesRest + ' meses restantes em ' + p.meta.ano + ')'
          : 'Defina um valor de meta para ver a projeção.' })
    ]);
  }

  /* ---------- Evolução anual ---------- */
  function renderEvolucaoPanel(d) {
    const p = pat();
    const hist = p.historico.slice().sort(function (a, b) { return a.ano - b.ano; })
      .map(function (h) { return { ano: +h.ano, valor: +h.valor || 0, tipo: 'real' }; });
    const anoAtual = +p.meta.ano;
    const found = hist.find(function (h) { return h.ano === anoAtual; });
    if (!found) hist.push({ ano: anoAtual, valor: d.invTotal, tipo: 'atual' });
    else { found.valor = d.invTotal; found.tipo = 'atual'; }

    const chartData = hist.map(function (h) {
      return {
        label: String(h.ano),
        bars: [{
          value: h.valor,
          color: h.tipo === 'atual' ? PALETTE[0] : 'var(--track)',
          name: h.tipo === 'atual' ? 'Atual' : 'Fechamento'
        }],
        goal: (h.ano === anoAtual && p.meta.valor > 0) ? (+p.meta.valor || 0) : null
      };
    });

    return el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Evolução anual (investimentos)' }),
      el('div', { class: 'bars-wrap' }, [global.Charts.barsSigned(chartData, { height: 220 })])
    ]);
  }

  /* ---------- Por instituição ---------- */
  function renderInstituicoesPanel(d) {
    const p = pat();
    const agg = new Map();
    p.investimentos.forEach(function (i) {
      if (+i.valor > 0) {
        const cur = agg.get(i.instituicao) || { valor: 0, local: i.local };
        cur.valor += +i.valor;
        if (i.local === 'Exterior') cur.local = 'Exterior';
        agg.set(i.instituicao, cur);
      }
    });
    const items = Array.from(agg.entries()).map(function (e) {
      return { instituicao: e[0], valor: e[1].valor, local: e[1].local };
    }).sort(function (a, b) { return b.valor - a.valor; });
    const max = Math.max.apply(null, items.map(function (i) { return i.valor; }).concat([1]));

    const panel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Por instituição' })
    ]);
    if (!items.length) {
      panel.appendChild(el('p', { class: 'muted', text: 'Nenhum investimento cadastrado.' }));
      return panel;
    }
    items.forEach(function (it, i) {
      const color = PALETTE[i % PALETTE.length];
      const pct = d.invTotal > 0 ? (it.valor / d.invTotal * 100) : 0;
      panel.appendChild(el('div', { class: 'budget-row' }, [
        el('div', { class: 'budget-cat' }, [
          el('span', { class: 'cat-dot', style: 'background:' + color }),
          el('span', { class: 'budget-name', text: it.instituicao + (it.local === 'Exterior' ? ' (US)' : '') })
        ]),
        el('div', { class: 'budget-track' }, [
          el('div', { class: 'progress slim' }, [
            el('div', { class: 'progress-fill', style: 'width:' + (it.valor / max * 100) + '%;background:' + color })
          ]),
          el('div', { class: 'budget-values muted small', text: U.formatBRL(it.valor) + ' · ' + pct.toFixed(0) + '%' })
        ])
      ]));
    });
    return panel;
  }

  /* ---------- Por tipo de ativo ---------- */
  function renderTiposPanel(d) {
    const p = pat();
    const map = new Map();
    p.investimentos.forEach(function (i) {
      if (+i.valor > 0) {
        const t = i.tipo || 'A classificar';
        map.set(t, (map.get(t) || 0) + (+i.valor));
      }
    });
    const types = Array.from(map.keys()).sort(function (a, b) {
      let ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia !== ib ? ia - ib : a.localeCompare(b, 'pt-BR');
    });
    const entries = types.map(function (t, i) {
      return { name: t, color: t === 'A classificar' ? 'var(--muted)' : PALETTE[i % PALETTE.length], total: map.get(t) };
    });
    const naoClass = map.get('A classificar') || 0;

    const panel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Por tipo de ativo' })
    ]);
    if (naoClass > 0) {
      panel.appendChild(el('p', { class: 'muted small', text: U.formatBRL(naoClass) + ' ainda sem classificação.' }));
    }
    const donutWrap = el('div', { class: 'donut-wrap' }, [
      global.Charts.donutGeneric(entries, { size: 180, stroke: 24, topLabel: 'total' })
    ]);
    const legend = el('div', { class: 'legend' });
    entries.forEach(function (e) {
      legend.appendChild(el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:' + e.color }),
        el('span', { class: 'legend-name', text: e.name }),
        el('span', { class: 'legend-val', text: U.formatBRL(e.total) })
      ]));
    });
    if (!entries.length) legend.appendChild(el('p', { class: 'muted', text: 'Sem dados ainda.' }));
    panel.appendChild(el('div', { class: 'donut-layout' }, [donutWrap, legend]));
    return panel;
  }

  /* ---------- Tabela: imóveis e veículos ---------- */
  function renderImobPanel() {
    const p = pat();
    const addBtn = el('button', {
      class: 'btn small primary', text: '+ Imóvel/veículo',
      onclick: function () { openPropertyModal(null, refresh); }
    });
    const panel = el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head-row' }, [
        el('h3', { class: 'panel-title', text: 'Imóveis e veículos' }),
        addBtn
      ])
    ]);
    if (!p.imobilizado.length) {
      panel.appendChild(el('p', { class: 'muted', text: 'Nenhum imóvel ou veículo cadastrado.' }));
      return panel;
    }
    const list = el('div', { class: 'txn-list' });
    p.imobilizado.slice().sort(function (a, b) { return (b.valor - b.divida) - (a.valor - a.divida); })
      .forEach(function (it) {
        const liq = (+it.valor || 0) - (+it.divida || 0);
        list.appendChild(el('div', { class: 'txn-row' }, [
          el('div', { class: 'txn-main' }, [
            el('span', { class: 'txn-desc', text: it.nome }),
            el('span', { class: 'txn-meta', text: it.classe + ' · líquido ' + U.formatBRL(liq) +
              (it.divida > 0 ? ' · dívida ' + U.formatBRL(it.divida) : '') })
          ]),
          el('div', { class: 'txn-right' }, [
            el('span', { class: 'txn-amount', text: U.formatBRL(it.valor) }),
            el('div', { class: 'row-actions' }, [
              el('button', {
                class: 'icon-btn small', text: '✎', title: 'Editar',
                onclick: function () { openPropertyModal(it, refresh); }
              }),
              el('button', {
                class: 'icon-btn small danger', text: '🗑', title: 'Excluir',
                onclick: function () { deleteProperty(it); }
              })
            ])
          ])
        ]));
      });
    panel.appendChild(list);
    return panel;
  }

  /* ---------- Tabela: investimentos ---------- */
  function renderInvPanel() {
    const p = pat();
    const addBtn = el('button', {
      class: 'btn small primary', text: '+ Investimento',
      onclick: function () { openInvestmentModal(null, refresh); }
    });
    const panel = el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head-row' }, [
        el('h3', { class: 'panel-title', text: 'Carteira de investimentos' }),
        addBtn
      ])
    ]);
    if (!p.investimentos.length) {
      panel.appendChild(el('p', { class: 'muted', text: 'Nenhum investimento cadastrado.' }));
      return panel;
    }
    const totByInst = new Map();
    p.investimentos.forEach(function (i) { totByInst.set(i.instituicao, (totByInst.get(i.instituicao) || 0) + (+i.valor || 0)); });
    const list = el('div', { class: 'txn-list' });
    p.investimentos.slice()
      .sort(function (a, b) { return (totByInst.get(b.instituicao) - totByInst.get(a.instituicao)) || (b.valor - a.valor); })
      .forEach(function (it) {
        list.appendChild(el('div', { class: 'txn-row' }, [
          el('div', { class: 'txn-main' }, [
            el('span', { class: 'txn-desc', text: it.instituicao + (it.local === 'Exterior' ? ' (US)' : '') }),
            el('span', { class: 'txn-meta', text: it.tipo || 'A classificar' })
          ]),
          el('div', { class: 'txn-right' }, [
            el('span', { class: 'txn-amount', text: U.formatBRL(it.valor) }),
            el('div', { class: 'row-actions' }, [
              el('button', {
                class: 'icon-btn small', text: '✎', title: 'Editar',
                onclick: function () { openInvestmentModal(it, refresh); }
              }),
              el('button', {
                class: 'icon-btn small danger', text: '🗑', title: 'Excluir',
                onclick: function () { deleteInvestment(it); }
              })
            ])
          ])
        ]));
      });
    panel.appendChild(list);
    return panel;
  }

  /* ---------- Movimentação mensal ---------- */
  function renderMovimentacaoPanel() {
    const p = pat();
    const movs = p.movimentacoes.slice().filter(function (m) { return m.mes; })
      .sort(function (a, b) { return a.mes < b.mes ? -1 : 1; });
    const addBtn = el('button', {
      class: 'btn small primary', text: '+ Movimentação',
      onclick: function () { openMovementModal(null, refresh); }
    });
    const panel = el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head-row' }, [
        el('h3', { class: 'panel-title', text: 'Movimentação mensal' }),
        addBtn
      ])
    ]);
    if (!movs.length) {
      panel.appendChild(el('p', { class: 'muted', text: 'Nenhuma movimentação mensal ainda.' }));
      return panel;
    }

    const totAporte = movs.reduce(function (a, m) { return a + (+m.aporte || 0); }, 0);
    const totRend = movs.reduce(function (a, m) { return a + (+m.rentabilidade || 0); }, 0);
    panel.appendChild(el('div', { class: 'stat-grid slim' }, [
      statCard('Aporte no período', U.formatBRL(totAporte), ''),
      statCard('Rendimento no período', U.formatBRL(totRend), totRend >= 0 ? 'positive' : 'negative')
    ]));

    const chartData = movs.map(function (m) {
      return {
        label: monthLabelShort(m.mes),
        bars: [
          { value: +m.aporte || 0, color: PALETTE[0], name: 'Aporte' },
          { value: +m.rentabilidade || 0, color: PALETTE[1], name: 'Rendimento' }
        ]
      };
    });
    panel.appendChild(el('div', { class: 'bars-wrap' }, [global.Charts.barsSigned(chartData, { height: 220 })]));
    panel.appendChild(el('div', { class: 'legend-inline' }, [
      el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:' + PALETTE[0] }), el('span', { text: 'Aporte' })
      ]),
      el('span', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:' + PALETTE[1] }), el('span', { text: 'Rendimento' })
      ])
    ]));

    if (p.movNota) {
      panel.appendChild(el('p', { class: 'muted small', text: 'ℹ️ ' + p.movNota }));
    }

    const list = el('div', { class: 'txn-list' });
    movs.slice().reverse().forEach(function (m) {
      list.appendChild(el('div', { class: 'txn-row compact' }, [
        el('div', { class: 'txn-main' }, [
          el('span', { class: 'txn-desc', text: monthLabelShort(m.mes) }),
          el('span', { class: 'txn-meta', text: 'saldo ' + U.formatBRL(m.saldo || 0) + ' · aporte ' + U.formatBRL(m.aporte || 0) })
        ]),
        el('div', { class: 'txn-right' }, [
          el('span', {
            class: 'txn-amount ' + ((+m.rentabilidade || 0) >= 0 ? 'pos' : 'neg'),
            text: U.formatBRL(m.rentabilidade || 0)
          }),
          el('div', { class: 'row-actions' }, [
            el('button', {
              class: 'icon-btn small', text: '✎', title: 'Editar',
              onclick: function () { openMovementModal(m, refresh); }
            }),
            el('button', {
              class: 'icon-btn small danger', text: '🗑', title: 'Excluir',
              onclick: function () { deleteMovement(m); }
            })
          ])
        ])
      ]));
    });
    panel.appendChild(list);
    return panel;
  }

  /* ---------- Histórico anual (lista inline de adicionar/remover) ---------- */
  function renderHistoricoPanel() {
    const p = pat();
    const addBtn = el('button', {
      class: 'btn small primary', text: '+ Ano',
      onclick: function () { addHistoricoYear(); }
    });
    const panel = el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head-row' }, [
        el('h3', { class: 'panel-title', text: 'Histórico de patrimônio (por ano)' }),
        addBtn
      ]),
      el('p', { class: 'muted small', text:
        'Usado no gráfico de evolução anual. O ano da meta é sempre calculado a partir dos investimentos atuais.' })
    ]);
    if (!p.historico.length) {
      panel.appendChild(el('p', { class: 'muted', text: 'Nenhum ano cadastrado ainda.' }));
      return panel;
    }
    const chips = el('div', { class: 'cat-chip-grid' });
    p.historico.slice().sort(function (a, b) { return a.ano - b.ano; }).forEach(function (h) {
      const anoIn = el('input', { type: 'number', style: 'width:70px', value: h.ano });
      const valIn = UI.numberInput(U.formatNumber(h.valor || 0), { style: 'width:110px' });
      anoIn.addEventListener('change', function () {
        h.ano = parseInt(anoIn.value, 10) || h.ano;
        global.Store.save();
      });
      valIn.addEventListener('change', function () {
        h.valor = U.parseAmount(valIn.value);
        global.Store.save();
      });
      chips.appendChild(el('div', { class: 'cat-chip' }, [
        anoIn, valIn,
        el('button', {
          class: 'icon-btn tiny danger', text: '✕', title: 'Remover',
          onclick: function () { removeHistoricoYear(h.id); }
        })
      ]));
    });
    panel.appendChild(chips);
    return panel;
  }

  function addHistoricoYear() {
    const p = pat();
    p.historico.push({ id: U.uid('pat'), ano: new Date().getFullYear() - 1, valor: 0 });
    global.Store.save();
    render();
  }
  function removeHistoricoYear(id) {
    const p = pat();
    p.historico = p.historico.filter(function (h) { return h.id !== id; });
    global.Store.save();
    render();
  }

  /* ================================================================== *
   *  Modais de CRUD                                                     *
   * ================================================================== */
  function openPropertyModal(existing, onSaved) {
    const isEdit = !!existing;
    const it = existing || { nome: '', classe: 'Imóvel', valor: '', divida: '' };
    const nomeIn = UI.textInput(it.nome, { placeholder: 'Ex: Apartamento, Carro...' });
    const classeIn = UI.select([
      { value: 'Imóvel', label: 'Imóvel' },
      { value: 'Veículo', label: 'Veículo' },
      { value: 'Outro', label: 'Outro' }
    ], it.classe || 'Imóvel');
    const valorIn = UI.numberInput(it.valor ? U.formatNumber(it.valor) : '');
    const dividaIn = UI.numberInput(it.divida ? U.formatNumber(it.divida) : '');

    const body = el('div', { class: 'modal-body' }, [
      UI.field('Nome', nomeIn),
      UI.field('Classe', classeIn),
      el('div', { class: 'field-row' }, [
        UI.field('Valor (R$)', valorIn),
        UI.field('Dívida/financiamento (R$)', dividaIn, 'Opcional.')
      ])
    ]);

    function save(close) {
      if (!nomeIn.value.trim()) { U.toast('Informe o nome.', 'error'); return; }
      const payload = {
        nome: nomeIn.value.trim(), classe: classeIn.value,
        valor: U.parseAmount(valorIn.value), divida: U.parseAmount(dividaIn.value)
      };
      const p = pat();
      if (isEdit) {
        Object.assign(p.imobilizado.find(function (x) { return x.id === it.id; }), payload);
      } else {
        p.imobilizado.push(Object.assign({ id: U.uid('pat') }, payload));
      }
      global.Store.save();
      U.toast(isEdit ? 'Alterações salvas.' : 'Adicionado.', 'success');
      close();
      onSaved && onSaved();
    }

    UI.openModal(isEdit ? 'Editar imóvel/veículo' : 'Novo imóvel/veículo', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  function deleteProperty(it) {
    UI.confirmModal('Excluir', 'Excluir "' + it.nome + '"?', function () {
      const p = pat();
      p.imobilizado = p.imobilizado.filter(function (x) { return x.id !== it.id; });
      global.Store.save();
      U.toast('Excluído.', 'success');
      render();
    }, true);
  }

  function openInvestmentModal(existing, onSaved) {
    const isEdit = !!existing;
    const it = existing || { instituicao: '', tipo: 'A classificar', local: 'Brasil', valor: '' };
    const instIn = UI.textInput(it.instituicao, { placeholder: 'Ex: XP, Nubank, Itaú...' });
    const tipoIn = UI.select(TIPOS.map(function (t) { return { value: t, label: t }; }), it.tipo || 'A classificar');
    const localIn = UI.select([
      { value: 'Brasil', label: 'Brasil' }, { value: 'Exterior', label: 'Exterior' }
    ], it.local || 'Brasil');
    const valorIn = UI.numberInput(it.valor ? U.formatNumber(it.valor) : '');

    const body = el('div', { class: 'modal-body' }, [
      UI.field('Instituição', instIn),
      el('div', { class: 'field-row' }, [
        UI.field('Tipo', tipoIn),
        UI.field('Local', localIn)
      ]),
      UI.field('Valor (R$)', valorIn)
    ]);

    function save(close) {
      if (!instIn.value.trim()) { U.toast('Informe a instituição.', 'error'); return; }
      const payload = {
        instituicao: instIn.value.trim(), tipo: tipoIn.value, local: localIn.value,
        valor: U.parseAmount(valorIn.value)
      };
      const p = pat();
      if (isEdit) {
        Object.assign(p.investimentos.find(function (x) { return x.id === it.id; }), payload);
      } else {
        p.investimentos.push(Object.assign({ id: U.uid('pat') }, payload));
      }
      global.Store.save();
      U.toast(isEdit ? 'Alterações salvas.' : 'Adicionado.', 'success');
      close();
      onSaved && onSaved();
    }

    UI.openModal(isEdit ? 'Editar investimento' : 'Novo investimento', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  function deleteInvestment(it) {
    UI.confirmModal('Excluir', 'Excluir o investimento em "' + it.instituicao + '"?', function () {
      const p = pat();
      p.investimentos = p.investimentos.filter(function (x) { return x.id !== it.id; });
      global.Store.save();
      U.toast('Excluído.', 'success');
      render();
    }, true);
  }

  function openMovementModal(existing, onSaved) {
    const isEdit = !!existing;
    const m = existing || { mes: U.todayISO().slice(0, 7), saldo: '', aporte: '', rentabilidade: '' };
    const mesIn = el('input', { type: 'month', value: m.mes || U.todayISO().slice(0, 7) });
    const saldoIn = UI.numberInput(m.saldo ? U.formatNumber(m.saldo) : '');
    const aporteIn = UI.numberInput(m.aporte ? U.formatNumber(m.aporte) : '');
    const rendIn = UI.numberInput(m.rentabilidade ? U.formatNumber(m.rentabilidade) : '');

    const body = el('div', { class: 'modal-body' }, [
      UI.field('Mês', mesIn),
      UI.field('Saldo final', saldoIn),
      el('div', { class: 'field-row' }, [
        UI.field('Aporte', aporteIn),
        UI.field('Rendimento', rendIn)
      ])
    ]);

    function save(close) {
      if (!mesIn.value) { U.toast('Informe o mês.', 'error'); return; }
      const payload = {
        mes: mesIn.value, saldo: U.parseAmount(saldoIn.value),
        aporte: U.parseAmount(aporteIn.value), rentabilidade: U.parseAmount(rendIn.value)
      };
      const p = pat();
      // upsert por mês: se já existir outra linha para o mesmo mês, atualiza-a em vez de duplicar
      const dup = p.movimentacoes.find(function (x) { return x.mes === payload.mes && x.id !== m.id; });
      if (dup) {
        Object.assign(dup, payload);
        if (isEdit) p.movimentacoes = p.movimentacoes.filter(function (x) { return x.id !== m.id; });
      } else if (isEdit) {
        Object.assign(p.movimentacoes.find(function (x) { return x.id === m.id; }), payload);
      } else {
        p.movimentacoes.push(Object.assign({ id: U.uid('pat') }, payload));
      }
      global.Store.save();
      U.toast('Salvo.', 'success');
      close();
      onSaved && onSaved();
    }

    UI.openModal(isEdit ? 'Editar movimentação' : 'Nova movimentação', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  function deleteMovement(m) {
    UI.confirmModal('Excluir', 'Excluir a movimentação de ' + monthLabelShort(m.mes) + '?', function () {
      const p = pat();
      p.movimentacoes = p.movimentacoes.filter(function (x) { return x.id !== m.id; });
      global.Store.save();
      U.toast('Excluído.', 'success');
      render();
    }, true);
  }

  function openGoalModal(onSaved) {
    const p = pat();
    const anoIn = el('input', { type: 'number', value: p.meta.ano });
    const valorIn = UI.numberInput(p.meta.valor ? U.formatNumber(p.meta.valor) : '');
    const fgtsIn = UI.numberInput(p.fgts ? U.formatNumber(p.fgts) : '');
    const cambioIn = UI.numberInput(U.formatNumber(p.cambioUSD || 5));

    const body = el('div', { class: 'modal-body' }, [
      el('div', { class: 'field-row' }, [
        UI.field('Ano da meta', anoIn),
        UI.field('Valor da meta (R$)', valorIn)
      ]),
      el('div', { class: 'field-row' }, [
        UI.field('FGTS (R$)', fgtsIn),
        UI.field('Câmbio USD (R$)', cambioIn)
      ])
    ]);

    function save(close) {
      p.meta.ano = parseInt(anoIn.value, 10) || p.meta.ano;
      p.meta.valor = U.parseAmount(valorIn.value);
      p.fgts = U.parseAmount(fgtsIn.value);
      p.cambioUSD = U.parseAmount(cambioIn.value) || p.cambioUSD;
      global.Store.save();
      U.toast('Meta atualizada.', 'success');
      close();
      onSaved && onSaved();
    }

    UI.openModal('Editar meta e configurações', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  global.Patrimonio = { render, refresh, derive, TIPOS };
})(window);
