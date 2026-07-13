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
    center.textContent = U.formatBRL(total);
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

  global.Charts = { donut, barsIncomeExpense };
})(window);
