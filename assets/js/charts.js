/* charts.js — gráficos simples em SVG, sem bibliotecas externas */
(function (global) {
  'use strict';

  const U = global.Utils;
  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  // Gráfico de rosca (donut) para categorias
  // data: [{ name, color, total }]
  function donut(data, opts) {
    opts = opts || {};
    const size = opts.size || 200;
    const stroke = opts.stroke || 26;
    const r = (size - stroke) / 2;
    const cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    const total = data.reduce(function (s, d) { return s + d.total; }, 0);

    const svg = svgEl('svg', {
      viewBox: '0 0 ' + size + ' ' + size,
      class: 'chart-donut', width: size, height: size
    });

    if (total <= 0) {
      svg.appendChild(svgEl('circle', {
        cx: cx, cy: cy, r: r, fill: 'none',
        stroke: 'var(--track)', 'stroke-width': stroke
      }));
      const txt = svgEl('text', {
        x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'chart-donut-empty'
      });
      txt.textContent = 'Sem dados';
      svg.appendChild(txt);
      return svg;
    }

    // Trilha de fundo
    svg.appendChild(svgEl('circle', {
      cx: cx, cy: cy, r: r, fill: 'none',
      stroke: 'var(--track)', 'stroke-width': stroke
    }));

    let offset = 0;
    data.forEach(function (d) {
      const frac = d.total / total;
      const len = frac * circ;
      const seg = svgEl('circle', {
        cx: cx, cy: cy, r: r, fill: 'none',
        stroke: d.color, 'stroke-width': stroke,
        'stroke-dasharray': len + ' ' + (circ - len),
        'stroke-dashoffset': -offset,
        transform: 'rotate(-90 ' + cx + ' ' + cy + ')'
      });
      seg.appendChild(svgEl('title')).textContent = d.name + ': ' + U.formatBRL(d.total);
      svg.appendChild(seg);
      offset += len;
    });

    // Total no centro
    const center = svgEl('text', {
      x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'chart-donut-total'
    });
    center.textContent = opts.maskTotal ? 'R$ ••••' : U.formatBRL(total);
    const label = svgEl('text', {
      x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'chart-donut-label'
    });
    label.textContent = 'Total';
    svg.appendChild(center);
    svg.appendChild(label);
    return svg;
  }

  // Barras agrupadas receita x despesa por mês, com linha de saldo implícita
  // data: [{ label, income, expense, balance }]
  function barsIncomeExpense(data, opts) {
    opts = opts || {};
    const w = opts.width || 640;
    const h = opts.height || 240;
    const padL = 8, padR = 8, padT = 16, padB = 28;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    const maxVal = Math.max(
      1,
      ...data.map(function (d) { return Math.max(d.income, d.expense); })
    );

    const svg = svgEl('svg', {
      viewBox: '0 0 ' + w + ' ' + h, class: 'chart-bars',
      preserveAspectRatio: 'none'
    });

    const groups = data.length;
    const groupW = innerW / groups;
    const barW = Math.min(22, groupW / 3);

    // Linhas de grade horizontais
    for (let g = 0; g <= 3; g++) {
      const y = padT + (innerH * g / 3);
      svg.appendChild(svgEl('line', {
        x1: padL, y1: y, x2: w - padR, y2: y,
        stroke: 'var(--track)', 'stroke-width': 1
      }));
    }

    data.forEach(function (d, i) {
      const gx = padL + groupW * i + groupW / 2;
      const incH = (d.income / maxVal) * innerH;
      const expH = (d.expense / maxVal) * innerH;

      const incBar = svgEl('rect', {
        x: gx - barW - 2, y: padT + innerH - incH,
        width: barW, height: Math.max(0, incH), rx: 3,
        fill: 'var(--income)'
      });
      incBar.appendChild(svgEl('title')).textContent = 'Receitas: ' + U.formatBRL(d.income);

      const expBar = svgEl('rect', {
        x: gx + 2, y: padT + innerH - expH,
        width: barW, height: Math.max(0, expH), rx: 3,
        fill: 'var(--expense)'
      });
      expBar.appendChild(svgEl('title')).textContent = 'Despesas: ' + U.formatBRL(d.expense);

      svg.appendChild(incBar);
      svg.appendChild(expBar);

      const lbl = svgEl('text', {
        x: gx, y: h - 8, 'text-anchor': 'middle', class: 'chart-axis-label'
      });
      lbl.textContent = d.label;
      svg.appendChild(lbl);
    });

    return svg;
  }

  // Gráfico de rosca (donut) genérico — como donut(), mas com rótulo de centro customizável
  // entries: [{ name, color, total }]
  // opts.formatValue: fn(number) -> string (default U.formatBRL)
  // opts.topLabel: string (rótulo abaixo do valor central, default 'Total')
  // opts.emptyText: string (default 'Sem dados')
  function donutGeneric(entries, opts) {
    opts = opts || {};
    const size = opts.size || 200;
    const stroke = opts.stroke || 26;
    const r = (size - stroke) / 2;
    const cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    const total = entries.reduce(function (s, d) { return s + d.total; }, 0);
    const formatValue = opts.formatValue || U.formatBRL;
    const topLabel = opts.topLabel || 'Total';

    const svg = svgEl('svg', {
      viewBox: '0 0 ' + size + ' ' + size,
      class: 'chart-donut', width: size, height: size
    });

    svg.appendChild(svgEl('circle', {
      cx: cx, cy: cy, r: r, fill: 'none',
      stroke: 'var(--track)', 'stroke-width': stroke
    }));

    if (total <= 0) {
      const txt = svgEl('text', {
        x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'chart-donut-empty'
      });
      txt.textContent = opts.emptyText || 'Sem dados';
      svg.appendChild(txt);
      return svg;
    }

    let offset = 0;
    entries.forEach(function (d) {
      const frac = d.total / total;
      const len = frac * circ;
      const seg = svgEl('circle', {
        cx: cx, cy: cy, r: r, fill: 'none',
        stroke: d.color, 'stroke-width': stroke,
        'stroke-dasharray': len + ' ' + (circ - len),
        'stroke-dashoffset': -offset,
        transform: 'rotate(-90 ' + cx + ' ' + cy + ')'
      });
      seg.appendChild(svgEl('title')).textContent = d.name + ': ' + formatValue(d.total);
      svg.appendChild(seg);
      offset += len;
    });

    const center = svgEl('text', {
      x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'chart-donut-total'
    });
    center.textContent = formatValue(total);
    const label = svgEl('text', {
      x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'chart-donut-label'
    });
    label.textContent = topLabel;
    svg.appendChild(center);
    svg.appendChild(label);
    return svg;
  }

  // Barras verticais com suporte a valores negativos (linha de zero) e, opcionalmente,
  // um marcador de meta (barra tracejada) por grupo.
  // data: [{ label, bars: [{ value, color, name }], goal }]
  //   - "bars" é 1+ barras desenhadas lado a lado dentro do grupo (ex.: Aporte + Rendimento)
  //   - "goal", se presente, desenha uma barra tracejada (contorno) na altura desse valor
  // opts.formatValue: fn(number) -> string curto para eixo/tooltip (default U.formatBRL)
  function barsSigned(data, opts) {
    opts = opts || {};
    const w = opts.width || 640;
    const h = opts.height || 240;
    const padL = opts.padL || 8, padR = 8, padB = 28;
    const padT = opts.valueLabels ? 26 : 16;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const formatValue = opts.formatValue || U.formatBRL;
    const showLabels = !!opts.valueLabels;
    const labelFmt = opts.formatLabel || function (v) {
      const a = Math.abs(v);
      if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mi';
      if (a >= 1e3) return 'R$ ' + Math.round(v / 1e3) + ' mil';
      return 'R$ ' + Math.round(v);
    };

    const allValues = data.reduce(function (acc, g) {
      g.bars.forEach(function (b) { acc.push(b.value); });
      if (g.goal != null) acc.push(g.goal);
      return acc;
    }, [0]);
    const maxV = Math.max.apply(null, allValues);
    const minV = Math.min.apply(null, allValues);
    const span = (maxV - minV) || 1;
    const yScale = function (v) { return padT + (1 - (v - minV) / span) * innerH; };
    const zeroY = yScale(0);

    const svg = svgEl('svg', {
      viewBox: '0 0 ' + w + ' ' + h, class: 'chart-bars',
      preserveAspectRatio: 'none'
    });

    for (let g = 0; g <= 3; g++) {
      const y = padT + (innerH * g / 3);
      svg.appendChild(svgEl('line', {
        x1: padL, y1: y, x2: w - padR, y2: y,
        stroke: 'var(--track)', 'stroke-width': 1
      }));
    }

    const groups = data.length;
    const groupW = innerW / Math.max(1, groups);
    const barCount = Math.max.apply(null, data.map(function (g) { return g.bars.length; }).concat([1]));
    const barW = Math.min(26, groupW / (barCount + 1.5));
    const gap = 3;

    data.forEach(function (g, i) {
      const gx = padL + groupW * i + groupW / 2;
      const totalW = barW * g.bars.length + gap * (g.bars.length - 1);
      const startX = gx - totalW / 2;

      if (g.goal != null) {
        const goalY = yScale(g.goal);
        const goalH = Math.abs(goalY - zeroY);
        const goalBar = svgEl('rect', {
          x: startX, y: Math.min(goalY, zeroY),
          width: totalW, height: Math.max(0, goalH), rx: 3,
          fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5,
          'stroke-dasharray': '4 3', class: 'chart-bar-goal'
        });
        goalBar.appendChild(svgEl('title')).textContent = 'Meta: ' + formatValue(g.goal);
        svg.appendChild(goalBar);
      }

      g.bars.forEach(function (b, bi) {
        const bx = startX + bi * (barW + gap);
        const by = yScale(b.value);
        const top = Math.min(by, zeroY);
        const barH = Math.abs(by - zeroY);
        const bar = svgEl('rect', {
          x: bx, y: top, width: barW, height: Math.max(0, barH), rx: 3,
          fill: b.color, class: 'chart-bar-signed'
        });
        bar.appendChild(svgEl('title')).textContent = (b.name ? b.name + ': ' : '') + formatValue(b.value);
        svg.appendChild(bar);

        if (showLabels && b.value !== 0) {
          const isNeg = b.value < 0;
          const ly = isNeg ? Math.min(h - padB - 1, Math.max(by, zeroY) + 11)
            : Math.max(9, Math.min(by, zeroY) - 4);
          const t = svgEl('text', {
            x: bx + barW / 2, y: ly, 'text-anchor': 'middle', class: 'chart-bar-label'
          });
          t.textContent = labelFmt(b.value);
          svg.appendChild(t);
        }
      });

      const lbl = svgEl('text', {
        x: gx, y: h - 8, 'text-anchor': 'middle', class: 'chart-axis-label'
      });
      lbl.textContent = g.label;
      svg.appendChild(lbl);
    });

    if (minV < 0 && maxV > 0) {
      svg.appendChild(svgEl('line', {
        x1: padL, y1: zeroY, x2: w - padR, y2: zeroY,
        stroke: 'var(--axis, var(--border))', 'stroke-width': 1.5
      }));
    }

    return svg;
  }

  global.Charts = { donut, donutGeneric, barsIncomeExpense, barsSigned };
})(window);
