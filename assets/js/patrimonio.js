/* patrimonio.js — aba de Patrimônio: investimentos, imóveis/veículos, FGTS e metas */
(function (global) {
  'use strict';

  const U = global.Utils;
  const UI = global.UI;
  const el = U.el;

  // Valores em R$ sem casas decimais (todo o painel de Patrimônio)
  function money(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  const TIPOS = ['A classificar', 'Renda Fixa', 'Tesouro', 'Fundos', 'COE', 'FIIs', 'Ações',
    'Multimercado', 'Cripto', 'Previdência', 'Caixa', 'Outros'];
  const TYPE_ORDER = ['Renda Fixa', 'Tesouro', 'Fundos', 'COE', 'FIIs', 'Ações', 'Multimercado',
    'Cripto', 'Previdência', 'Caixa', 'Outros', 'A classificar'];
  // Paleta categórica reaproveitando os tons semânticos existentes + alguns extras
  // condizentes com a paleta escuro/champagne/dourado do app (sem tocar styles.css).
  const PALETTE = ['var(--primary)', 'var(--income)', 'var(--expense)', 'var(--warn)',
    'var(--danger)', '#8a7fd9', '#4fa3c9', '#b98fd1'];

  const view = document.getElementById('view');

  // Estado de UI (não persistido): detalhamentos expandidos
  let imobExpanded = false;
  let invExpanded = false;

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

  /* ---------- Selo da instituição (monograma com a cor da marca) ----------
   * Usamos as iniciais da instituição sobre a cor característica dela — não
   * embutimos logotipos de terceiros (marcas registradas) no projeto.
   */
  const BRAND_COLORS = {
    itau: '#EC7000', 'banco do brasil': '#F9DD16', bb: '#F9DD16', bradesco: '#CC092F',
    santander: '#EC0000', caixa: '#0070AF', nubank: '#820AD1', nu: '#820AD1',
    inter: '#FF7A00', c6: '#242424', 'c6 bank': '#242424', original: '#00A868',
    xp: '#0F0F0F', 'xp investimentos': '#0F0F0F', rico: '#F5333F', clear: '#00B2A9',
    btg: '#00285E', 'btg pactual': '#00285E', 'modal mais': '#0A2240', modalmais: '#0A2240',
    genial: '#00C08B', daycoval: '#003B71', safra: '#0C2340', sicredi: '#3FA110',
    sicoob: '#003641', banrisul: '#0072BC', 'mercado pago': '#00B1EA', picpay: '#21C25E',
    'will bank': '#FFDD00', neon: '#00E1FF', pan: '#00A1E0', avenue: '#0B1F3A',
    nomad: '#111827', 'interactive brokers': '#D81222', binance: '#F0B90B',
    'porto seguro': '#0033A0', porto: '#0033A0', 'brb': '#0A5C36', agora: '#E30613'
  };
  function normBrand(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  }
  function brandColor(nome, fallback) {
    const n = normBrand(nome);
    if (BRAND_COLORS[n]) return BRAND_COLORS[n];
    // casa pelo primeiro token conhecido (ex.: "Itau - Personnalite" -> itau)
    const keys = Object.keys(BRAND_COLORS);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k.length >= 3 && new RegExp('(^|[^a-z0-9])' + k + '($|[^a-z0-9])').test(n)) return BRAND_COLORS[k];
    }
    return fallback || 'var(--primary)';
  }
  // Preto/branco conforme o contraste da cor de fundo (para marcas claras)
  function inkFor(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#fff';
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? '#111' : '#fff';
  }
  function brandInitials(nome) {
    const parts = String(nome || '').trim().split(/[^A-Za-zÀ-ÿ0-9]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function brandBadge(nome, fallbackColor) {
    const bg = brandColor(nome, fallbackColor);
    return el('span', {
      class: 'brand-badge', title: nome,
      style: 'background:' + bg + ';color:' + inkFor(bg),
      text: brandInitials(nome)
    });
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
    const editValuesBtn = el('button', {
      class: 'icon-btn small', text: '✎', title: 'Editar FGTS, câmbio e meta',
      onclick: function () { openGoalModal(refresh); }
    });
    view.appendChild(sectionHeader('Patrimônio', editValuesBtn));

    view.appendChild(renderKpis(d));

    const grid1 = el('div', { class: 'dashboard-grid' });
    grid1.appendChild(renderComposicaoPanel(d));
    grid1.appendChild(renderMetaPanel(d));
    view.appendChild(grid1);

    view.appendChild(renderEvolucaoPanel(d));
    view.appendChild(renderEvolucaoMensalPanel(d));

    const grid2 = el('div', { class: 'dashboard-grid' });
    grid2.appendChild(renderInvPanel());
    grid2.appendChild(renderTiposPanel(d));
    view.appendChild(grid2);

    view.appendChild(renderImobPanel());
    view.appendChild(renderHistoricoPanel());

    if (global.PatrimonioImport) view.appendChild(global.PatrimonioImport.buildPanel(refresh));
  }

  /* ---------- KPIs ---------- */
  function renderKpis(d) {
    const p = pat();
    // 1ª linha: Investimentos · Imóveis e veículos · Dívidas
    const row1 = el('div', { class: 'stat-grid' }, [
      statCard('Investimentos', money(d.invTotal), '',
        countInstituicoes(p) + ' instituição(ões)'),
      statCard('Imóveis & veículos', money(d.imobTotal), '',
        p.imobilizado.length + ' bem(ns)'),
      statCard('Dívidas / financiamentos', money(d.dividaTotal), d.dividaTotal > 0 ? 'negative' : '',
        (d.bruto > 0 ? (d.dividaTotal / d.bruto * 100).toFixed(0) : 0) + '% do patrimônio bruto')
    ]);
    // 2ª linha: Patrimônio líquido · Líquido + FGTS
    const row2 = el('div', { class: 'stat-grid', style: 'grid-template-columns:repeat(2,1fr)' }, [
      statCard('Patrimônio líquido', money(d.liquidoSemFGTS), d.liquidoSemFGTS >= 0 ? 'positive' : 'negative',
        formatUSD(d.usdVal) + ' · câmbio R$ ' + U.formatNumber(p.cambioUSD)),
      statCard('Líquido + FGTS', money(d.liquidoComFGTS), 'positive',
        'inclui FGTS de ' + money(d.fgts))
    ]);
    return el('div', {}, [row1, row2]);
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
    // O anel mostra a composição dos ativos (imóveis, investimentos, FGTS),
    // mas o valor central é o LÍQUIDO — já descontando as dívidas.
    const donutWrap = el('div', { class: 'donut-wrap' }, [
      global.Charts.donutGeneric(entries, {
        size: 180, stroke: 24, topLabel: 'líquido', formatValue: money,
        centerTotal: d.liquidoComFGTS
      })
    ]);
    const legend = el('div', { class: 'legend' });
    entries.forEach(function (e) {
      legend.appendChild(el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:' + e.color }),
        el('span', { class: 'legend-name', text: e.name }),
        el('span', { class: 'legend-val', text: money(e.total) })
      ]));
    });
    if (d.dividaTotal > 0) {
      legend.appendChild(el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:var(--danger)' }),
        el('span', { class: 'legend-name', text: '(–) Dívidas' }),
        el('span', { class: 'legend-val', text: '-' + money(d.dividaTotal) })
      ]));
    }
    if (!entries.length) legend.appendChild(el('p', { class: 'muted', text: 'Sem dados ainda.' }));
    panel.appendChild(el('div', { class: 'donut-layout' }, [donutWrap, legend]));
    if (totalAtivos > 0) {
      panel.appendChild(el('p', { class: 'muted small', text:
        'Ativos totais: ' + money(totalAtivos) + ' · dívidas de ' + money(d.dividaTotal) + ' deduzidas do líquido' }));
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
        el('span', { text: money(d.invTotal) + ' de ' + money(meta) }),
        el('strong', { class: falta > 0 ? 'neg' : '', text: falta > 0 ? 'falta ' + money(falta) : 'meta atingida' })
      ]),
      el('div', { class: 'progress' }, [
        el('div', { class: 'progress-fill', style: 'width:' + prog + '%' })
      ]),
      el('div', { class: 'goal-foot muted small', text:
        meta > 0
          ? 'Aporte mensal necessário: ' + money(mensal) + '/mês (' + mesesRest + ' meses restantes em ' + p.meta.ano + ')'
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
      el('div', { class: 'bars-wrap' }, [global.Charts.barsSigned(chartData, { height: 240, valueLabels: true, formatValue: money })])
    ]);
  }

  /* ---------- Evolução mensal ---------- */
  function renderEvolucaoMensalPanel(d) {
    const p = pat();
    const mesAtual = U.todayISO().slice(0, 7);

    // Agrupa por mês, somando as instituições que já reportaram aquele mês.
    const byMes = new Map();
    (p.movimentacoes || []).filter(function (m) { return m.mes; }).forEach(function (m) {
      const cur = byMes.get(m.mes) || { saldo: 0, aporte: 0, rentabilidade: 0, insts: new Set() };
      cur.saldo += (+m.saldo || 0);
      cur.aporte += (+m.aporte || 0);
      cur.rentabilidade += (+m.rentabilidade || 0);
      if (m.instituicao) cur.insts.add(m.instituicao);
      byMes.set(m.mes, cur);
    });
    // O mês atual sempre reflete o total AO VIVO da carteira (soma de todas
    // as instituições agora), não o que foi salvo num import — evita mostrar
    // um saldo desatualizado se o extrato do mês ainda não chegou.
    const atualEntry = byMes.get(mesAtual) || { saldo: 0, aporte: 0, rentabilidade: 0, insts: new Set() };
    atualEntry.saldo = d.invTotal;
    byMes.set(mesAtual, atualEntry);

    const meses = Array.from(byMes.keys()).sort().slice(-12); // últimos 12 meses
    if (meses.length < 2) {
      return el('div', { class: 'panel' }, [
        el('h3', { class: 'panel-title', text: 'Evolução mensal (investimentos)' }),
        el('p', { class: 'muted', text:
          'Ainda não há histórico suficiente. O saldo do mês é preenchido automaticamente ' +
          'sempre que você importa um extrato de posição, e o aporte/rendimento quando o ' +
          'extrato já traz essa divisão (ex.: relatório de rentabilidade da XP).' })
      ]);
    }

    const temQuebra = meses.some(function (mes) {
      const e = byMes.get(mes);
      return e.aporte !== 0 || e.rentabilidade !== 0;
    });

    const chartData = meses.map(function (mes) {
      const e = byMes.get(mes);
      const bars = temQuebra
        ? [
            { value: e.aporte, color: PALETTE[0], name: 'Aporte' },
            { value: e.rentabilidade, color: PALETTE[1], name: 'Rendimento' }
          ]
        : [{ value: e.saldo, color: mes === mesAtual ? PALETTE[0] : 'var(--track)', name: 'Saldo' }];
      return { label: monthLabelShort(mes), bars: bars };
    });

    const panel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Evolução mensal (investimentos)' }),
      el('div', { class: 'bars-wrap' }, [global.Charts.barsSigned(chartData, { height: 240, valueLabels: true, formatValue: money })])
    ]);
    if (temQuebra) {
      panel.appendChild(el('div', { class: 'legend-inline' }, [
        el('span', { class: 'legend-item' }, [
          el('span', { class: 'legend-dot', style: 'background:' + PALETTE[0] }), el('span', { text: 'Aporte' })
        ]),
        el('span', { class: 'legend-item' }, [
          el('span', { class: 'legend-dot', style: 'background:' + PALETTE[1] }), el('span', { text: 'Rendimento' })
        ])
      ]));
    }
    const list = el('div', { class: 'txn-list' });
    meses.slice().reverse().forEach(function (mes) {
      const e = byMes.get(mes);
      list.appendChild(el('div', { class: 'txn-row compact' }, [
        el('div', { class: 'txn-main' }, [
          el('span', { class: 'txn-desc', text: monthLabelShort(mes) }),
          el('span', { class: 'txn-meta', text:
            'saldo ' + money(e.saldo) + (e.insts.size ? ' · ' + e.insts.size + ' instituição(ões)' : '') })
        ]),
        el('span', {
          class: 'txn-amount ' + (e.rentabilidade >= 0 ? 'pos' : 'neg'),
          text: (e.aporte || e.rentabilidade) ? money(e.rentabilidade) : ''
        })
      ]));
    });
    panel.appendChild(list);
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
    // Do maior para o menor valor (empate: ordem padrão dos tipos)
    const types = Array.from(map.keys()).sort(function (a, b) {
      const diff = map.get(b) - map.get(a);
      if (diff !== 0) return diff;
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
      panel.appendChild(el('p', { class: 'muted small', text: money(naoClass) + ' ainda sem classificação.' }));
    }
    const donutWrap = el('div', { class: 'donut-wrap' }, [
      global.Charts.donutGeneric(entries, { size: 180, stroke: 24, topLabel: 'total', formatValue: money })
    ]);
    const legend = el('div', { class: 'legend' });
    entries.forEach(function (e) {
      legend.appendChild(el('div', { class: 'legend-item' }, [
        el('span', { class: 'legend-dot', style: 'background:' + e.color }),
        el('span', { class: 'legend-name', text: e.name }),
        el('span', { class: 'legend-val', text: money(e.total) })
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

    // Resumo por classe (ícone + total), com o detalhamento recolhido
    const CLASS_ICON = { 'Imóvel': '🏠', 'Veículo': '🚗', 'Outro': '📦' };
    const byClass = new Map();
    p.imobilizado.forEach(function (it) {
      const k = it.classe || 'Outro';
      const cur = byClass.get(k) || { valor: 0, divida: 0, n: 0 };
      cur.valor += (+it.valor || 0);
      cur.divida += (+it.divida || 0);
      cur.n += 1;
      byClass.set(k, cur);
    });
    const resumo = el('div', { class: 'imob-summary' });
    ['Imóvel', 'Veículo', 'Outro'].forEach(function (k) {
      const c = byClass.get(k);
      if (!c) return;
      const liq = c.valor - c.divida;
      resumo.appendChild(el('div', { class: 'imob-sum-card' }, [
        el('span', { class: 'imob-sum-icon', text: CLASS_ICON[k] || '📦' }),
        el('div', { class: 'imob-sum-text' }, [
          el('span', { class: 'muted small', text: (k === 'Imóvel' ? 'Imóveis' : k === 'Veículo' ? 'Veículos' : 'Outros') +
            ' · ' + c.n + ' item(ns)' }),
          el('strong', { class: 'imob-sum-val', text: money(c.valor) }),
          el('span', { class: 'muted small', text: c.divida > 0
            ? 'líquido ' + money(liq) + ' · dívida ' + money(c.divida)
            : 'sem dívidas' })
        ])
      ]));
    });
    panel.appendChild(resumo);

    const expanded = !!imobExpanded;
    panel.appendChild(el('button', {
      class: 'card-toggle' + (expanded ? ' open' : ''),
      onclick: function () { imobExpanded = !expanded; refresh(); }
    }, [
      el('span', { class: 'card-toggle-caret', text: expanded ? '▾' : '▸' }),
      el('span', { text: (expanded ? 'Ocultar detalhamento' : 'Ver detalhamento') +
        ' (' + p.imobilizado.length + ')' })
    ]));
    if (!expanded) return panel;

    const list = el('div', { class: 'txn-list' });
    p.imobilizado.slice().sort(function (a, b) { return (b.valor - b.divida) - (a.valor - a.divida); })
      .forEach(function (it) {
        const liq = (+it.valor || 0) - (+it.divida || 0);
        list.appendChild(el('div', { class: 'txn-row' }, [
          el('div', { class: 'txn-main' }, [
            el('span', { class: 'txn-desc', text: it.nome }),
            el('span', { class: 'txn-meta', text: it.classe + ' · líquido ' + money(liq) +
              (it.divida > 0 ? ' · dívida ' + money(it.divida) : '') })
          ]),
          el('div', { class: 'txn-right' }, [
            el('span', { class: 'txn-amount', text: money(it.valor) }),
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
    p.investimentos.forEach(function (i) {
      const cur = totByInst.get(i.instituicao) || { valor: 0, n: 0, local: i.local };
      cur.valor += (+i.valor || 0);
      cur.n += 1;
      if (i.local === 'Exterior') cur.local = 'Exterior';
      totByInst.set(i.instituicao, cur);
    });

    // Resumo por instituição (selo + valor somado), detalhamento recolhido
    const insts = Array.from(totByInst.entries()).sort(function (a, b) { return b[1].valor - a[1].valor; });
    const resumo = el('div', { class: 'imob-summary' });
    insts.forEach(function (e) {
      const nome = e[0], info = e[1];
      resumo.appendChild(el('div', { class: 'imob-sum-card' }, [
        brandBadge(nome),
        el('div', { class: 'imob-sum-text' }, [
          el('span', { class: 'muted small', text: nome + (info.local === 'Exterior' ? ' (US)' : '') + ' · ' + info.n + ' item(ns)' }),
          el('strong', { class: 'imob-sum-val', text: money(info.valor) })
        ])
      ]));
    });
    panel.appendChild(resumo);

    const expanded = !!invExpanded;
    panel.appendChild(el('button', {
      class: 'card-toggle' + (expanded ? ' open' : ''),
      onclick: function () { invExpanded = !expanded; refresh(); }
    }, [
      el('span', { class: 'card-toggle-caret', text: expanded ? '▾' : '▸' }),
      el('span', { text: (expanded ? 'Ocultar detalhamento' : 'Ver detalhamento') +
        ' (' + p.investimentos.length + ')' })
    ]));
    if (!expanded) return panel;

    const list = el('div', { class: 'txn-list' });
    p.investimentos.slice()
      .sort(function (a, b) { return (totByInst.get(b.instituicao).valor - totByInst.get(a.instituicao).valor) || (b.valor - a.valor); })
      .forEach(function (it) {
        list.appendChild(el('div', { class: 'txn-row' }, [
          el('div', { class: 'txn-main inst-main' }, [
            brandBadge(it.instituicao),
            el('div', { class: 'inst-text' }, [
              el('span', { class: 'txn-desc', text: it.instituicao + (it.local === 'Exterior' ? ' (US)' : '') }),
              el('span', { class: 'txn-meta', text: it.tipo || 'A classificar' })
            ])
          ]),
          el('div', { class: 'txn-right' }, [
            el('span', { class: 'txn-amount', text: money(it.valor) }),
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

    UI.openModal('Editar meta, FGTS e câmbio', body, {
      buttons: [
        { label: 'Cancelar', variant: 'ghost', onClick: function (c) { c(); } },
        { label: 'Salvar', variant: 'primary', onClick: save }
      ]
    });
  }

  global.Patrimonio = { render, refresh, derive, TIPOS };
})(window);
