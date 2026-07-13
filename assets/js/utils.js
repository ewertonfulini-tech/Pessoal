/* utils.js — helpers de formatação, datas e DOM */
(function (global) {
  'use strict';

  const MESES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  const MESES_CURTOS = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ];

  // Identificador simples e único o suficiente para uso local
  function uid(prefix) {
    return (prefix || 'id') + '_' +
      Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  // Formata número em Real brasileiro
  function formatBRL(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    });
  }

  // Formata sem símbolo (para inputs)
  function formatNumber(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Converte texto digitado ("1.234,56" ou "1234.56") em número
  function parseAmount(text) {
    if (typeof text === 'number') return text;
    if (!text) return 0;
    let s = String(text).trim().replace(/\s|R\$/g, '');
    if (s.indexOf(',') > -1) {
      // formato brasileiro: ponto = milhar, vírgula = decimal
      s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /* ---------- Datas (trabalhamos sempre com strings YYYY-MM-DD) ---------- */

  function pad2(n) { return String(n).padStart(2, '0'); }

  // Chave de mês "YYYY-MM"
  function monthKey(year, month0) {
    return year + '-' + pad2(month0 + 1);
  }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Extrai partes de uma data ISO sem problemas de fuso
  function parseISO(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return { year: y, month0: (m - 1), day: d };
  }

  function daysInMonth(year, month0) {
    return new Date(year, month0 + 1, 0).getDate();
  }

  // Constrói data ISO limitando o dia ao máximo do mês
  function buildISO(year, month0, day) {
    const maxD = daysInMonth(year, month0);
    const d = Math.min(day, maxD);
    return year + '-' + pad2(month0 + 1) + '-' + pad2(d);
  }

  // Soma meses a um {year, month0}
  function addMonths(year, month0, delta) {
    const total = year * 12 + month0 + delta;
    return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
  }

  // Diferença em meses (a - b)
  function monthDiff(aYear, aMonth0, bYear, bMonth0) {
    return (aYear * 12 + aMonth0) - (bYear * 12 + bMonth0);
  }

  function formatDateBR(iso) {
    if (!iso) return '';
    const { year, month0, day } = parseISO(iso);
    return pad2(day) + '/' + pad2(month0 + 1) + '/' + year;
  }

  function monthLabel(year, month0) {
    return MESES[month0] + ' de ' + year;
  }

  function weekdayISO(iso) {
    const { year, month0, day } = parseISO(iso);
    return new Date(year, month0, day).getDay(); // 0=Dom
  }

  /* ---------- DOM helpers ---------- */

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(message, type) {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const t = el('div', { class: 'toast ' + (type || 'info'), text: message });
    root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, 2600);
  }

  global.Utils = {
    MESES, MESES_CURTOS,
    uid, formatBRL, formatNumber, parseAmount, pad2,
    monthKey, todayISO, parseISO, daysInMonth, buildISO,
    addMonths, monthDiff, formatDateBR, monthLabel, weekdayISO,
    el, escapeHtml, toast
  };
})(window);
