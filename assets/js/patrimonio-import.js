/* patrimonio-import.js — import/export da aba Patrimônio:
 * colar JSON, importar CSV/OFX, importar extrato em PDF (pdf.js offline),
 * exportar backup JSON e gerar um snapshot protegido por senha (AES-256). */
(function (global) {
  'use strict';

  const U = global.Utils;
  const el = U.el;

  // Valores em R$ sem casas decimais (consistente com o restante do painel de Patrimônio)
  function money(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  const PDFJS_WORKER_URL = 'assets/js/vendor/pdfjs-worker.js';
  const PDFJS_MAIN_URL = 'assets/js/vendor/pdfjs-main.js';
  const LOCKED_BLOB_PLACEHOLDER = '/*__LOCKED_BLOB__*/null';

  function pat() { return global.Store.getData().patrimonio; }

  // Parser de número mais permissivo que U.parseAmount: aceita tanto formato
  // BR (1.234,56) quanto US (1,234.56), usado ao ler CSV/OFX/PDF de bancos
  // diversos — U.parseAmount assume sempre formato BR (digitado pelo usuário).
  function parseFlexibleNumber(raw) {
    if (raw == null) return 0;
    let s = String(raw).trim().replace(/r\$/i, '').replace(/%/g, '').replace(/\s/g, '');
    if (!s) return 0;
    const neg = /^-/.test(s);
    s = s.replace(/[^0-9.,]/g, '');
    if (s.indexOf('.') > -1 && s.indexOf(',') > -1) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (s.indexOf(',') > -1) {
      s = s.replace(',', '.');
    } else if (s.indexOf('.') > -1) {
      const p = s.split('.');
      if (p.length > 2 || p[p.length - 1].length === 3) s = p.join('');
    }
    let n = parseFloat(s);
    if (isNaN(n)) n = 0;
    return neg ? -n : n;
  }

  /* ================================================================== *
   *  Aplicar import (único ponto de merge, usado por JSON/CSV/OFX/PDF   *
   *  e pelo "Importar backup (JSON)" do dashboard antigo)                *
   * ================================================================== */
  function applyImport(obj) {
    const p = pat();
    const res = [];
    if (obj.cambioUSD != null) { p.cambioUSD = +obj.cambioUSD || p.cambioUSD; res.push('câmbio'); }
    if (obj.fgts != null) { p.fgts = parseFlexibleNumber(obj.fgts); res.push('FGTS'); }
    if (obj.meta) { p.meta = Object.assign({}, p.meta, obj.meta); res.push('meta'); }
    if (obj.movNota != null) { p.movNota = obj.movNota; }
    if (Array.isArray(obj.historico)) {
      p.historico = obj.historico.map(function (h) {
        return { id: h.id || U.uid('pat'), ano: +h.ano, valor: parseFlexibleNumber(h.valor) };
      });
      res.push(obj.historico.length + ' ano(s)');
    }
    if (Array.isArray(obj.imobilizado)) {
      p.imobilizado = obj.imobilizado.map(function (i) {
        return {
          id: i.id || U.uid('pat'), nome: i.nome, classe: i.classe || 'Imóvel',
          valor: parseFlexibleNumber(i.valor), divida: parseFlexibleNumber(i.divida)
        };
      });
      res.push(obj.imobilizado.length + ' bem(ns)');
    }
    if (Array.isArray(obj.investimentos)) {
      const clean = obj.investimentos.map(function (i) {
        return {
          id: i.id || U.uid('pat'), instituicao: String(i.instituicao || '').trim(),
          tipo: i.tipo || 'A classificar', local: i.local || 'Brasil', valor: parseFlexibleNumber(i.valor)
        };
      }).filter(function (i) { return i.instituicao; });
      // substitui as instituições presentes no bloco, preserva as demais
      const insts = new Set(clean.map(function (i) { return i.instituicao; }));
      p.investimentos = p.investimentos.filter(function (i) { return !insts.has(i.instituicao); }).concat(clean);
      res.push(insts.size + ' instituição(ões)');
    }
    if (Array.isArray(obj.movimentacoes)) {
      // Chave por mês + instituição: cada instituição reporta seu próprio
      // extrato, então o mesmo mês pode ter uma linha por banco/corretora.
      function movKey(m) { return m.mes + '|' + String(m.instituicao || ''); }
      const map = new Map((p.movimentacoes || []).map(function (m) { return [movKey(m), m]; }));
      obj.movimentacoes.forEach(function (m) {
        if (m.mes) {
          const existing = map.get(movKey(m));
          map.set(movKey(m), {
            id: (existing && existing.id) || U.uid('pat'), mes: m.mes,
            instituicao: String(m.instituicao || '').trim(),
            saldo: parseFlexibleNumber(m.saldo), aporte: parseFlexibleNumber(m.aporte),
            rentabilidade: parseFlexibleNumber(m.rentabilidade)
          });
        }
      });
      p.movimentacoes = Array.from(map.values());
      res.push(obj.movimentacoes.length + ' mês(es)');
    }
    return res;
  }

  /* ================================================================== *
   *  CSV / OFX                                                          *
   * ================================================================== */
  function csvRows(text) {
    text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const first = text.split('\n')[0] || '';
    const sep = (first.split(';').length > first.split(',').length) ? ';' : ',';
    const rows = []; let cur = [], val = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else q = false; }
        else val += c;
      } else {
        if (c === '"') q = true;
        else if (c === sep) { cur.push(val); val = ''; }
        else if (c === '\n') { cur.push(val); rows.push(cur); cur = []; val = ''; }
        else val += c;
      }
    }
    if (val.length || cur.length) { cur.push(val); rows.push(cur); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  function normh(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  }

  function pickCol(cols, names) {
    for (let n = 0; n < names.length; n++) {
      const i = cols.indexOf(normh(names[n]));
      if (i >= 0) return i;
    }
    return -1;
  }

  function classifTipo(raw) {
    const s = normh(raw);
    if (!s) return 'A classificar';
    if (/(cdb|lci|lca|cri|cra|deb|rdb|posfix|prefix|inflacao|rendafixa|tesouro?direto)/.test(s)) {
      if (/tesouro/.test(s)) return 'Tesouro';
      return 'Renda Fixa';
    }
    if (/tesouro/.test(s)) return 'Tesouro';
    if (/(acao|acoes|rendavariavel|equity)/.test(s)) return 'Ações';
    if (/(fii|imobiliario|fundoslistados)/.test(s)) return 'FIIs';
    if (/coe/.test(s)) return 'COE';
    if (/previd/.test(s)) return 'Previdência';
    if (/(multimercado|alternativo|hedge)/.test(s)) return 'Multimercado';
    if (/(fundo|fic|fim)/.test(s)) return 'Fundos';
    if (/(caixa|cash|saldo)/.test(s)) return 'Caixa';
    return 'A classificar';
  }

  function parseCSVImport(text) {
    const rows = csvRows(text);
    if (rows.length < 2) return null;
    const cols = rows[0].map(normh);
    const iMes = pickCol(cols, ['mes', 'competencia', 'periodo', 'data', 'datareferencia', 'mesano']);
    const iAporte = pickCol(cols, ['aporte', 'aplicacao', 'aplicacoes', 'movimentacoes', 'movimentacao', 'entradas']);
    const iRend = pickCol(cols, ['rendimento', 'rentabilidade', 'ganho', 'ganhofinanceiro', 'rendimentos', 'proventos']);
    const iSaldo = pickCol(cols, ['saldo', 'saldofinal', 'patrimonio', 'patrimoniofinal', 'posicao', 'valor', 'valorbruto']);

    if (iMes >= 0 && (iAporte >= 0 || iRend >= 0)) {
      const linhas = rows.slice(1).map(function (r) {
        const raw = String(r[iMes] || '');
        const mk = raw.match(/(\d{4})[-/](\d{1,2})/) || raw.match(/(\d{1,2})[-/](\d{4})/);
        let mes = '';
        if (mk) {
          const y = ('' + mk[1]).length === 4 ? mk[1] : mk[2];
          const mo = ('' + mk[1]).length === 4 ? mk[2] : mk[1];
          mes = y + '-' + String(mo).padStart(2, '0');
        }
        return mes ? {
          mes: mes, saldo: iSaldo >= 0 ? parseFlexibleNumber(r[iSaldo]) : 0,
          aporte: iAporte >= 0 ? parseFlexibleNumber(r[iAporte]) : 0,
          rentabilidade: iRend >= 0 ? parseFlexibleNumber(r[iRend]) : 0
        } : null;
      }).filter(Boolean);
      if (linhas.length) return { tipo: 'movimentacoes', linhas: linhas };
    }

    const iAtivo = pickCol(cols, ['ativo', 'produto', 'papel', 'descricao', 'fundo', 'nome', 'emissor']);
    const iTipo = pickCol(cols, ['tipo', 'classe', 'categoria', 'estrategia', 'classepapel']);
    const iVal = iSaldo >= 0 ? iSaldo : pickCol(cols, ['valorliquido', 'valorbruto', 'financeiro', 'posicao', 'montante']);
    if ((iAtivo >= 0 || iTipo >= 0) && iVal >= 0) {
      const linhas = rows.slice(1).map(function (r) {
        return {
          ativo: iAtivo >= 0 ? String(r[iAtivo] || '').trim() : '',
          tipo: iTipo >= 0 ? classifTipo(r[iTipo]) : 'A classificar',
          valor: parseFlexibleNumber(r[iVal])
        };
      }).filter(function (l) { return l.valor > 0; });
      if (linhas.length) return { tipo: 'investimentos', linhas: linhas };
    }
    return null;
  }

  function parseOFX(text) {
    const trns = Array.from(text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)).map(function (m) { return m[1]; });
    const get = function (b, tag) {
      const r = new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i').exec(b);
      return r ? r[1].trim() : '';
    };
    const byMes = new Map();
    trns.forEach(function (b) {
      const dt = get(b, 'DTPOSTED');
      const amt = parseFlexibleNumber(get(b, 'TRNAMT').replace('.', ','));
      const mk = dt.match(/^(\d{4})(\d{2})/);
      if (!mk) return;
      const mes = mk[1] + '-' + mk[2];
      byMes.set(mes, (byMes.get(mes) || 0) + amt);
    });
    const linhas = Array.from(byMes.entries()).sort().map(function (e) {
      return { mes: e[0], saldo: 0, aporte: e[1], rentabilidade: 0 };
    });
    return linhas.length ? { tipo: 'movimentacoes', linhas: linhas, ofx: true } : null;
  }

  /* ================================================================== *
   *  PDF (pdf.js embutido como asset local, offline)                    *
   * ================================================================== */
  let _pdfjs = null;
  async function getPdfjs() {
    if (_pdfjs) return _pdfjs;
    const wc = await fetch(PDFJS_WORKER_URL).then(function (r) { return r.text(); });
    const mc = await fetch(PDFJS_MAIN_URL).then(function (r) { return r.text(); });
    const lib = await import(URL.createObjectURL(new Blob([mc], { type: 'text/javascript' })));
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([wc], { type: 'text/javascript' }));
    _pdfjs = lib;
    return lib;
  }

  async function extractPdfText(arrbuf) {
    const lib = await getPdfjs();
    const pdf = await lib.getDocument({ data: new Uint8Array(arrbuf) }).promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent();
      const rows = new Map();
      tc.items.forEach(function (it) {
        if (it.str === undefined) return;
        const x = it.transform[4], y = Math.round(it.transform[5]);
        let key = null;
        rows.forEach(function (_, k) { if (key === null && Math.abs(k - y) <= 2) key = k; });
        if (key === null) { key = y; rows.set(key, []); }
        rows.get(key).push({ x: x, s: it.str, w: it.width || 0 });
      });
      const ys = Array.from(rows.keys()).sort(function (a, b) { return b - a; });
      ys.forEach(function (y) {
        const line = rows.get(y).sort(function (a, b) { return a.x - b.x; });
        let s = '', pe = null;
        line.forEach(function (it) {
          if (pe !== null && it.x - pe > 1.5) s += ' ';
          s += it.s; pe = it.x + it.w;
        });
        out += s.trim() + '\n';
      });
    }
    return out;
  }

  function parseBankPDF(text) {
    const flat = text.replace(/\s+/g, ' ');
    const cambioUSD = (+pat().cambioUSD) || 5;
    const TMAP = {
      'Ações': 'Ações', 'Renda Fixa': 'Renda Fixa', 'Fundos de investimento': 'Fundos',
      'Tesouro Direto': 'Tesouro', 'Previdência Privada': 'Previdência', 'Coe': 'COE',
      'Fundos imobiliários': 'FIIs'
    };
    const MES = { jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06', jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12' };

    // 1) XP — relatório de rentabilidade (movimentação mensal)
    {
      const re = /(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\/(\d{2})\s+((?:-?R\$\s*[\d.,]+\s*){6})(\d[\d,]*)%/gi;
      const linhas = []; let m;
      while ((m = re.exec(flat))) {
        const mo = MES[m[1].toLowerCase()], yr = '20' + m[2];
        const nums = (m[3].match(/-?R\$\s*[\d.,]+/g) || []).map(parseFlexibleNumber);
        if (nums.length >= 6) linhas.push({ mes: yr + '-' + mo, saldo: nums[4], aporte: nums[1], rentabilidade: nums[5] });
      }
      if (linhas.length >= 2) return { banco: 'XP — relatório de rentabilidade', tipo: 'movimentacoes', linhas: linhas };
    }
    // 2) XP — posição consolidada
    {
      const re = /(\d[\d.,]*)%\s+(Ações|Renda Fixa|Fundos de investimento|Tesouro Direto|Previdência Privada|Coe|Fundos imobiliários)\s+R\$\s*([\d.]+,\d{2})/g;
      const linhas = []; const seen = new Set(); let m;
      while ((m = re.exec(flat))) {
        const t = TMAP[m[2]];
        if (seen.has(t)) continue;
        seen.add(t);
        linhas.push({ tipo: t, valor: parseFlexibleNumber(m[3]) });
      }
      if (linhas.length) return { banco: 'XP — posição', tipo: 'investimentos', instituicao: 'XP', local: 'Brasil', linhas: linhas };
    }
    // 3) Daycoval
    if (/BANCO DAYCOVAL/i.test(flat)) {
      const linhas = [];
      const rf = /TOTAL CLASSE PAPEL\s+[\d.]+,\d{2}\s+([\d.]+,\d{2})/.exec(flat);
      if (rf) linhas.push({ tipo: 'Renda Fixa', valor: parseFlexibleNumber(rf[1]) });
      const fu = /Saldo Final\s+([\d.]+,\d{2})/.exec(flat);
      if (fu) linhas.push({ tipo: 'Fundos', valor: parseFlexibleNumber(fu[1]) });
      if (linhas.length) return { banco: 'Daycoval', tipo: 'investimentos', instituicao: 'Daycoval', local: 'Brasil', linhas: linhas };
    }
    // 4) BRB / Genial
    if (/GENIAL INVESTIMENTOS/i.test(flat) || /MEUS INVESTIMENTOS/i.test(flat)) {
      const linhas = [];
      const pv = /Previd[êe]ncia Privada\s+R\$\s*([\d.]+,\d{2})/.exec(flat);
      if (pv) linhas.push({ tipo: 'Previdência', valor: parseFlexibleNumber(pv[1]) });
      const rf = /Renda Fixa[^R]{0,20}R\$\s*([\d.]+,\d{2})/.exec(flat);
      if (rf) linhas.push({ tipo: 'Renda Fixa', valor: parseFlexibleNumber(rf[1]) });
      const cx = /DISPON[ÍI]VEL PARA INVESTIR\s+R\$\s*([\d.]+,\d{2})/.exec(flat);
      if (cx && parseFlexibleNumber(cx[1]) > 0) linhas.push({ tipo: 'Caixa', valor: parseFlexibleNumber(cx[1]) });
      if (linhas.length) return { banco: 'BRB / Genial', tipo: 'investimentos', instituicao: 'BRB', local: 'Brasil', linhas: linhas };
    }
    // 5) ARQ / Alpaca (US$ → R$)
    if (/Alpaca/i.test(flat)) {
      const tot = /Total Market Value\s+\$?([\d,]+\.\d{2})/.exec(flat);
      const lg = /Long\s+\$?([\d,]+\.\d{2})/.exec(flat);
      if (tot) {
        const totV = parseFlexibleNumber(tot[1]), secV = lg ? parseFlexibleNumber(lg[1]) : totV, cashV = Math.max(totV - secV, 0);
        const linhas = [{ tipo: 'Ações', valor: Math.round(secV * cambioUSD * 100) / 100 }];
        if (cashV > 0.5) linhas.push({ tipo: 'Caixa', valor: Math.round(cashV * cambioUSD * 100) / 100 });
        return { banco: 'ARQ / Alpaca (US$→R$ ' + cambioUSD + ')', tipo: 'investimentos', instituicao: 'ARQ', local: 'Exterior', linhas: linhas };
      }
    }
    // 6) Itaú — posição consolidada (Personnalité)
    if (/itaupersonnalite/i.test(flat) ||
        (/total investido/i.test(flat) && /ag[êe]ncia\s+conta corrente/i.test(flat))) {
      const ITAU_TMAP = {
        'Investimentos Imobiliários': 'FIIs',
        'Tesouro Direto': 'Tesouro',
        'Ações': 'Ações',
        'Poupança': 'Caixa',
        'Fundos de Investimento': 'Fundos',
        'CDB, Renda Fixa e Estruturados': 'Renda Fixa',
        'Previdência': 'Previdência'
      };
      const linhas = [];
      Object.keys(ITAU_TMAP).forEach(function (label) {
        const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(esc + '\\s+(?:R\\$\\s*-?[\\d.,]+|-)\\s+(?:-?[\\d.,]+%|-)\\s+(?:R\\$\\s*([\\d.,]+)|-)');
        const m = re.exec(flat);
        if (m && m[1]) {
          const v = parseFlexibleNumber(m[1]);
          if (v > 0) linhas.push({ tipo: ITAU_TMAP[label], valor: v });
        }
      });
      if (linhas.length) return { banco: 'Itaú — posição consolidada', tipo: 'investimentos', instituicao: 'Itaú', local: 'Brasil', linhas: linhas };
    }
    // 7) BRB — Genial Seguros (extrato de previdência, vários planos PGBL)
    if (/Genial\s+(Corretora\s+de\s+)?Seguros/i.test(flat) && /SALDO FINAL/i.test(flat)) {
      const re = /SALDO FINAL\s+R\$([\d,]+\.\d{2})/gi;
      let total = 0; let m;
      while ((m = re.exec(flat))) total += parseFlexibleNumber(m[1]);
      if (total > 0) {
        return {
          banco: 'BRB — Genial Seguros (previdência)', tipo: 'investimentos',
          instituicao: 'BRB Previdência', local: 'Brasil',
          linhas: [{ tipo: 'Previdência', valor: Math.round(total * 100) / 100 }]
        };
      }
    }
    return null;
  }

  /* ================================================================== *
   *  Export: backup JSON e snapshot protegido por senha                 *
   * ================================================================== */
  function exportBackupJSON() {
    const blob = new Blob([JSON.stringify(pat(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'patrimonio-backup-' + U.todayISO() + '.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    U.toast('Backup exportado.', 'success');
  }

  const _b64 = function (u8) { let s = ''; u8.forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); };
  async function deriveKey(pw) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: 210000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );
    return { key: key, salt: salt };
  }
  async function encryptState(obj, key, salt) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, salt: _b64(salt), iv: _b64(iv), ct: _b64(new Uint8Array(ct)) });
  }

  async function exportProtectedSnapshot(password) {
    if (!global.PatrimonioSnapshotTemplate) throw new Error('Template do snapshot não carregado.');
    const { key, salt } = await deriveKey(password);
    const blob = await encryptState(pat(), key, salt);
    const html = global.PatrimonioSnapshotTemplate.replace(LOCKED_BLOB_PLACEHOLDER, JSON.stringify(blob));
    const a = el('a', {
      href: URL.createObjectURL(new Blob([html], { type: 'text/html' })),
      download: 'Patrimonio-protegido.html'
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ================================================================== *
   *  Painel de UI (Importar/Exportar) — anexado à aba Patrimônio        *
   * ================================================================== */
  function msgEl(node, text, ok) {
    node.textContent = text;
    node.style.color = ok ? 'var(--income)' : 'var(--danger)';
  }

  function buildPanel(refresh) {
    const panel = el('div', { class: 'panel' }, [
      el('h3', { class: 'panel-title', text: 'Importar / exportar' }),
      el('p', { class: 'muted small', text:
        'Cole um bloco JSON (ex.: do backup exportado pelo app antigo), importe um extrato em PDF ' +
        '(offline, reconhece XP, Daycoval, BRB/Genial, BRB Previdência, ARQ e Itaú), importe um CSV/OFX, ou exporte um backup.' }),
    ]);

    // Colar JSON
    const jsonArea = el('textarea', { rows: 5, style: 'width:100%;font-family:monospace;font-size:12px', placeholder: '{ "investimentos": [...] }' });
    const jsonMsg = el('p', { class: 'small', style: 'margin:6px 0 0' });
    panel.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'field-label', text: 'Colar bloco JSON' }),
      jsonArea,
      el('div', { class: 'button-row', style: 'margin-top:8px' }, [
        el('button', {
          class: 'btn primary small', text: 'Aplicar JSON',
          onclick: function () {
            const raw = jsonArea.value.trim();
            if (!raw) { msgEl(jsonMsg, 'Cole um bloco JSON primeiro.', false); return; }
            let obj;
            try { obj = JSON.parse(raw); } catch (e) { msgEl(jsonMsg, 'JSON inválido: ' + e.message, false); return; }
            try {
              const parts = applyImport(obj);
              global.Store.save();
              msgEl(jsonMsg, parts.length ? 'Aplicado ✓ (' + parts.join(', ') + ').' : 'Nada reconhecido no bloco.', parts.length > 0);
              if (parts.length) { jsonArea.value = ''; refresh(); }
            } catch (e) { msgEl(jsonMsg, 'Erro ao aplicar: ' + e.message, false); }
          }
        })
      ]),
      jsonMsg
    ]));

    // Importar backup (JSON) — mesmo caminho do bloco colado, mas via arquivo
    const backupFileIn = el('input', {
      type: 'file', accept: '.json,application/json', style: 'display:none',
      onchange: function (e) {
        const f = e.target.files[0]; if (!f) return;
        const reader = new FileReader();
        reader.onload = function () {
          try {
            const obj = JSON.parse(reader.result);
            const parts = applyImport(obj);
            global.Store.save();
            U.toast(parts.length ? 'Backup importado (' + parts.join(', ') + ').' : 'Nada reconhecido no arquivo.', parts.length > 0 ? 'success' : 'error');
            refresh();
          } catch (err) { U.toast('Arquivo inválido: ' + err.message, 'error'); }
        };
        reader.readAsText(f, 'utf-8');
      }
    });

    // CSV / OFX
    const filePreview = el('div', { style: 'margin-top:8px' });
    const fileIn = el('input', {
      type: 'file', accept: '.csv,.ofx,.txt', style: 'display:none',
      onchange: function (e) {
        const f = e.target.files[0]; if (!f) return;
        const reader = new FileReader();
        reader.onload = function () {
          try {
            const text = reader.result;
            const isOFX = /<OFX>/i.test(text) || /OFXHEADER/i.test(text);
            const parsed = isOFX ? parseOFX(text) : parseCSVImport(text);
            renderParsedPreview(parsed, f.name, filePreview, refresh);
          } catch (err) {
            filePreview.innerHTML = '';
            filePreview.appendChild(el('p', { class: 'small', style: 'color:var(--danger)', text: 'Não consegui ler: ' + err.message }));
          }
        };
        reader.readAsText(f, 'utf-8');
      }
    });

    // PDF
    const pdfPreview = el('div', { style: 'margin-top:8px' });
    const pdfIn = el('input', {
      type: 'file', accept: 'application/pdf,.pdf', style: 'display:none',
      onchange: async function (e) {
        const f = e.target.files[0]; if (!f) return;
        pdfPreview.innerHTML = '';
        pdfPreview.appendChild(el('p', { class: 'muted small', text: 'Lendo ' + f.name + '…' }));
        try {
          const buf = await f.arrayBuffer();
          const text = await extractPdfText(buf);
          const parsed = parseBankPDF(text);
          if (!parsed) {
            pdfPreview.innerHTML = '';
            pdfPreview.appendChild(el('p', { class: 'small', style: 'color:var(--danger)', text: 'Não reconheci o formato de ' + f.name + '.' }));
            return;
          }
          renderParsedPreview(parsed, f.name, pdfPreview, refresh);
        } catch (err) {
          pdfPreview.innerHTML = '';
          pdfPreview.appendChild(el('p', { class: 'small', style: 'color:var(--danger)', text: 'Erro ao ler o PDF: ' + err.message }));
        }
      }
    });

    panel.appendChild(el('div', { class: 'button-row', style: 'margin-top:4px' }, [
      el('button', { class: 'btn small', text: '↥ Importar CSV/OFX', onclick: function () { fileIn.click(); } }),
      el('button', { class: 'btn small', text: '↥ Importar PDF de extrato', onclick: function () { pdfIn.click(); } }),
      el('button', { class: 'btn small', text: '↑ Importar backup (JSON)', onclick: function () { backupFileIn.click(); } }),
      el('button', { class: 'btn primary small', text: '↓ Exportar backup (JSON)', onclick: exportBackupJSON })
    ]));
    panel.appendChild(fileIn);
    panel.appendChild(pdfIn);
    panel.appendChild(backupFileIn);
    panel.appendChild(filePreview);
    panel.appendChild(pdfPreview);

    // Snapshot protegido por senha
    const pwIn = el('input', { type: 'password', placeholder: 'Senha (mín. 6 caracteres)' });
    const pw2In = el('input', { type: 'password', placeholder: 'Confirmar senha' });
    const protMsg = el('p', { class: 'small', style: 'margin:6px 0 0' });
    panel.appendChild(el('div', { class: 'field', style: 'margin-top:16px;border-top:1px solid var(--border);padding-top:14px' }, [
      el('label', { class: 'field-label', text: '🔒 Gerar versão protegida (arquivo standalone com senha)' }),
      el('small', { class: 'field-hint', text:
        'Baixa um único arquivo HTML com os dados de Patrimônio cifrados (AES-256). ' +
        'Sem a senha, o arquivo é ilegível — seguro para hospedar ou abrir no celular.' }),
      el('div', { class: 'field-row', style: 'margin-top:8px' }, [pwIn, pw2In]),
      el('div', { class: 'button-row', style: 'margin-top:8px' }, [
        el('button', {
          class: 'btn small', text: 'Gerar versão protegida',
          onclick: async function () {
            if (pwIn.value.length < 6) { msgEl(protMsg, 'Use pelo menos 6 caracteres.', false); return; }
            if (pwIn.value !== pw2In.value) { msgEl(protMsg, 'As senhas não coincidem.', false); return; }
            msgEl(protMsg, 'Gerando arquivo protegido…', true);
            try {
              await exportProtectedSnapshot(pwIn.value);
              msgEl(protMsg, 'Pronto ✓ Baixado "Patrimonio-protegido.html".', true);
              pwIn.value = ''; pw2In.value = '';
            } catch (e) { msgEl(protMsg, 'Erro ao gerar: ' + e.message, false); }
          }
        })
      ]),
      protMsg
    ]));

    return panel;
  }

  function renderParsedPreview(parsed, name, box, refresh) {
    box.innerHTML = '';
    if (!parsed || !parsed.linhas.length) {
      box.appendChild(el('p', { class: 'small', style: 'color:var(--danger)', text:
        'Não reconheci dados úteis em ' + name + '. Se for um extrato em PDF de outro banco, tente colar um bloco JSON.' }));
      return;
    }
    const total = parsed.linhas.reduce(function (a, l) { return a + (parsed.tipo === 'investimentos' ? (+l.valor || 0) : 0); }, 0);

    const box2 = el('div', { class: 'panel', style: 'padding:12px;font-size:12.5px' }, [
      el('p', { text: name + ' — ' + (parsed.banco ? parsed.banco + ' · ' : '') +
        (parsed.tipo === 'investimentos' ? ('investimentos (' + money(total) + ')') : ('movimentação mensal (' + parsed.linhas.length + ' mês(es))')) })
    ]);

    let instIn = null;
    let institMvIn = null;
    let mesIn = null;
    if (parsed.tipo === 'investimentos') {
      instIn = el('input', { type: 'text', value: parsed.instituicao || '', placeholder: 'Instituição (ex.: XP)' });
      box2.appendChild(el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Instituição' }), instIn]));
      mesIn = el('input', { type: 'month', value: U.todayISO().slice(0, 7) });
      box2.appendChild(el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Mês de referência deste extrato' }), mesIn,
        el('small', { class: 'field-hint', text:
          'Usado só para o saldo na Evolução mensal. Se o extrato for de um mês anterior, troque aqui — ' +
          'nesse caso o saldo salvo é só desta instituição (não dá pra saber o valor das outras naquele mês).' })
      ]));
    } else {
      // Adivinha a instituição a partir do "banco" detectado (ex.: "XP —
      // relatório de rentabilidade" -> "XP"), mas deixa editável.
      const guess = (parsed.banco || '').split(' — ')[0].trim();
      institMvIn = el('input', { type: 'text', value: guess, placeholder: 'Instituição (ex.: XP)' });
      box2.appendChild(el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Instituição' }), institMvIn,
        el('small', { class: 'field-hint', text:
          'A Evolução mensal soma o aporte/rendimento de cada instituição por mês.' })
      ]));
    }

    const list = el('div', { style: 'max-height:150px;overflow:auto;margin:8px 0;border-top:1px solid var(--border);padding-top:6px' });
    parsed.linhas.slice(0, 14).forEach(function (l) {
      list.appendChild(el('div', { class: 'muted small', style: 'display:flex;justify-content:space-between' }, [
        el('span', { text: parsed.tipo === 'investimentos' ? (l.tipo || 'A classificar') : U.formatDateBR(l.mes + '-01') }),
        el('span', { text: parsed.tipo === 'investimentos' ? money(l.valor) : ('aporte ' + money(l.aporte) + ' · rend. ' + money(l.rentabilidade)) })
      ]));
    });
    if (parsed.linhas.length > 14) list.appendChild(el('p', { class: 'muted small', text: '… +' + (parsed.linhas.length - 14) }));
    box2.appendChild(list);

    const applyMsg = el('p', { class: 'small' });
    box2.appendChild(el('button', {
      class: 'btn primary small', text: 'Importar',
      onclick: function () {
        const inst = (instIn ? instIn.value : (institMvIn ? institMvIn.value : '')).trim();
        let obj;
        if (parsed.tipo === 'investimentos') {
          if (!inst) { msgEl(applyMsg, 'Informe a instituição.', false); return; }
          obj = { investimentos: parsed.linhas.map(function (l) {
            return { instituicao: inst, tipo: l.tipo || 'A classificar', local: parsed.local || 'Brasil', valor: l.valor };
          }) };
        } else {
          obj = { movimentacoes: parsed.linhas.map(function (l) {
            return Object.assign({ instituicao: inst }, l);
          }) };
          if (parsed.banco) pat().movNota = 'Série baseada no relatório de ' + parsed.banco + '.';
        }
        const parts = applyImport(obj);
        if (parsed.tipo === 'investimentos') {
          // Atualiza o saldo do mês desta instituição na Evolução mensal. O
          // mês corrente é sempre sobrescrito pelo total AO VIVO da carteira
          // no gráfico (renderEvolucaoMensalPanel), então aqui só precisa
          // guardar o valor desta instituição — não dá pra saber, num extrato
          // de uma instituição só, quanto valiam as outras naquele mês.
          const mes = /^\d{4}-\d{2}$/.test(mesIn.value) ? mesIn.value : U.todayISO().slice(0, 7);
          const mv = pat().movimentacoes || (pat().movimentacoes = []);
          const existingMv = mv.find(function (m) { return m.mes === mes && m.instituicao === inst; });
          if (existingMv) existingMv.saldo = total;
          else mv.push({ id: U.uid('pat'), mes: mes, instituicao: inst, saldo: total, aporte: 0, rentabilidade: 0 });
          parts.push('saldo de ' + inst + ' em ' + U.formatDateBR(mes + '-01').slice(3));
        }
        global.Store.save();
        msgEl(applyMsg, 'Importado ✓ (' + parts.join(', ') + ').', true);
        refresh();
      }
    }));
    box2.appendChild(applyMsg);
    box.appendChild(box2);
  }

  global.PatrimonioImport = {
    applyImport, parseCSVImport, parseOFX, parseBankPDF, extractPdfText,
    exportBackupJSON, exportProtectedSnapshot, buildPanel
  };
})(window);
