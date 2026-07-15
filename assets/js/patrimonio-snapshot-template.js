/* patrimonio-snapshot-template.js — template estático de um snapshot standalone,
 * somente-leitura, protegido por senha (AES-256), do estado de Patrimônio.
 *
 * Este arquivo NÃO depende de Store/UI/Charts/pdf.js — é injetado como string
 * dentro de um novo HTML baixado pelo usuário (ver PatrimonioImport.exportProtectedSnapshot).
 * O ponto /*__LOCKED_BLOB__*\/null é substituído pelo blob cifrado na hora da exportação.
 *
 * Atenção: como é um template estático, ele precisa ser atualizado manualmente
 * se as seções visuais da aba Patrimônio (patrimonio.js) mudarem no futuro —
 * não é gerado automaticamente a partir do render ao vivo.
 */
(function (global) {
  'use strict';

  const SNAPSHOT_HTML_TEMPLATE = '<!doctype html>\n' +
'<html lang="pt-BR">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>Patrimônio — protegido</title>\n' +
'<style>\n' +
':root{\n' +
'  --bg:#efe9dd; --panel:#ffffff; --border:#ece4d5; --text:#211e18; --muted:#8a8175;\n' +
'  --primary:#a97e39; --income:#4f9e73; --expense:#bf6a44; --warn:#c08a2e; --danger:#bf6a44; --track:#eae2d3;\n' +
'}\n' +
'@media (prefers-color-scheme: dark){\n' +
'  :root{ --bg:#0d0c0f; --panel:#15131a; --border:#2a2630; --text:#f3eee6; --muted:#9a9089;\n' +
'    --primary:#c9a15a; --income:#7bbf98; --expense:#d68a68; --warn:#d9b46a; --danger:#d9694a; --track:#241f2a; }\n' +
'}\n' +
'*{box-sizing:border-box}\n' +
'body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.45;padding:24px;max-width:900px;margin:0 auto}\n' +
'h1{font-size:20px;margin:0 0 2px}\n' +
'.sub{color:var(--muted);font-size:13px;margin:0 0 20px}\n' +
'.snap-panel{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px}\n' +
'.snap-title{margin:0 0 12px;font-size:15px}\n' +
'.snap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px}\n' +
'.snap-stat{border-left:3px solid var(--primary);padding:4px 0 4px 12px}\n' +
'.snap-label{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:block}\n' +
'.snap-value{font-size:20px;font-weight:700}\n' +
'.snap-sub{font-size:11.5px;color:var(--muted);display:block}\n' +
'.snap-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;gap:10px}\n' +
'.snap-row:last-child{border-bottom:none}\n' +
'.snap-bar-track{flex:1;height:8px;border-radius:999px;background:var(--track);overflow:hidden;margin:0 10px}\n' +
'.snap-bar-fill{height:100%;border-radius:999px;background:var(--primary)}\n' +
'.snap-muted{color:var(--muted);font-size:12.5px}\n' +
'#lock{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px}\n' +
'#lock .box{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:26px;max-width:340px;width:100%}\n' +
'#lock input{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text);margin-top:10px;font-size:14px}\n' +
'#lock button{width:100%;margin-top:14px;padding:10px;border:none;border-radius:8px;background:var(--primary);color:#fff;font-weight:600;cursor:pointer}\n' +
'#lock-msg{font-size:12.5px;margin-top:8px;min-height:16px}\n' +
'#app{display:none}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<div id="lock"><form class="box" id="lock-form">\n' +
'  <h1>Patrimônio protegido</h1>\n' +
'  <p class="sub">Digite a senha para desbloquear.</p>\n' +
'  <input type="password" id="lock-pw" placeholder="Senha" autofocus>\n' +
'  <button type="submit">Entrar</button>\n' +
'  <p id="lock-msg"></p>\n' +
'</form></div>\n' +
'<div id="app">\n' +
'  <h1>Patrimônio</h1>\n' +
'  <p class="sub">Snapshot somente-leitura — gerado pelo Gestor Financeiro.</p>\n' +
'  <div id="kpis" class="snap-grid"></div>\n' +
'  <div class="snap-panel"><h3 class="snap-title">Composição do patrimônio</h3><div id="composicao"></div></div>\n' +
'  <div class="snap-panel"><h3 class="snap-title">Evolução anual (investimentos)</h3><div id="evolucao"></div></div>\n' +
'  <div class="snap-panel"><h3 class="snap-title">Por instituição</h3><div id="instituicoes"></div></div>\n' +
'  <div class="snap-panel"><h3 class="snap-title">Por tipo de ativo</h3><div id="tipos"></div></div>\n' +
'  <div class="snap-panel"><h3 class="snap-title">Imóveis e veículos</h3><div id="imoveis"></div></div>\n' +
'  <div class="snap-panel"><h3 class="snap-title">Carteira de investimentos</h3><div id="investimentos"></div></div>\n' +
'  <div class="snap-panel"><h3 class="snap-title">Movimentação mensal</h3><div id="movimentacao"></div></div>\n' +
'</div>\n' +
'<script>\n' +
'const LOCKED_BLOB = /*__LOCKED_BLOB__*/null;\n' +
'const brl = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});\n' +
'const usd = new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});\n' +
'const pct = (x,d)=> (x==null?"—":x.toLocaleString("pt-BR",{minimumFractionDigits:d||0,maximumFractionDigits:d||0})+"%");\n' +
'const _ub64=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));\n' +
'async function deriveKey(pw, saltB64){\n' +
'  const salt=_ub64(saltB64);\n' +
'  const base=await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);\n' +
'  return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:210000, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["decrypt"]);\n' +
'}\n' +
'async function decryptBlob(blobStr, pw){\n' +
'  const o=JSON.parse(blobStr);\n' +
'  const key=await deriveKey(pw, o.salt);\n' +
'  const pt=await crypto.subtle.decrypt({name:"AES-GCM", iv:_ub64(o.iv)}, key, _ub64(o.ct));\n' +
'  return JSON.parse(new TextDecoder().decode(pt));\n' +
'}\n' +
'function derive(p){\n' +
'  const imobTotal=(p.imobilizado||[]).reduce((a,i)=>a+(+i.valor||0),0);\n' +
'  const dividaTotal=(p.imobilizado||[]).reduce((a,i)=>a+(+i.divida||0),0);\n' +
'  const invTotal=(p.investimentos||[]).reduce((a,i)=>a+(+i.valor||0),0);\n' +
'  const fgts=+p.fgts||0, bruto=imobTotal+invTotal, liquidoSemFGTS=bruto-dividaTotal;\n' +
'  const liquidoComFGTS=liquidoSemFGTS+fgts, usdVal=p.cambioUSD>0?liquidoSemFGTS/p.cambioUSD:0;\n' +
'  return {imobTotal,dividaTotal,invTotal,fgts,bruto,liquidoSemFGTS,liquidoComFGTS,usdVal};\n' +
'}\n' +
'function statHtml(label,value,sub){\n' +
'  return \'<div class="snap-stat"><span class="snap-label">\'+label+\'</span><strong class="snap-value">\'+value+\'</strong><span class="snap-sub">\'+(sub||"")+\'</span></div>\';\n' +
'}\n' +
'function renderAll(p){\n' +
'  const d=derive(p);\n' +
'  document.getElementById("kpis").innerHTML=\n' +
'    statHtml("Patrimônio líquido", brl.format(d.liquidoSemFGTS), usd.format(d.usdVal)) +\n' +
'    statHtml("Líquido + FGTS", brl.format(d.liquidoComFGTS), "FGTS " + brl.format(d.fgts)) +\n' +
'    statHtml("Imóveis & veículos", brl.format(d.imobTotal), (p.imobilizado||[]).length + " bem(ns)") +\n' +
'    statHtml("Investimentos", brl.format(d.invTotal), "") +\n' +
'    statHtml("Dívidas", brl.format(d.dividaTotal), "");\n' +
'\n' +
'  const entries=[["Imóveis & veículos",d.imobTotal],["Investimentos",d.invTotal],["FGTS",d.fgts]].filter(e=>e[1]>0);\n' +
'  const totalAtivos=d.bruto+d.fgts;\n' +
'  document.getElementById("composicao").innerHTML = entries.length ? entries.map(e=>\n' +
'    \'<div class="snap-row"><span>\'+e[0]+\'</span><span class="snap-bar-track"><span class="snap-bar-fill" style="width:\'+(totalAtivos>0?(e[1]/totalAtivos*100):0)+\'%"></span></span><span>\'+brl.format(e[1])+\'</span></div>\'\n' +
'  ).join("") : \'<p class="snap-muted">Sem dados.</p>\';\n' +
'\n' +
'  const hist=(p.historico||[]).slice().sort((a,b)=>a.ano-b.ano).map(h=>({ano:+h.ano,valor:+h.valor||0}));\n' +
'  const anoAtual=+(p.meta&&p.meta.ano)||new Date().getFullYear();\n' +
'  if(!hist.find(h=>h.ano===anoAtual)) hist.push({ano:anoAtual, valor:d.invTotal});\n' +
'  else hist.forEach(h=>{ if(h.ano===anoAtual) h.valor=d.invTotal; });\n' +
'  const maxH=Math.max.apply(null, hist.map(h=>h.valor).concat([1]));\n' +
'  document.getElementById("evolucao").innerHTML = hist.map(h=>\n' +
'    \'<div class="snap-row"><span>\'+h.ano+\'</span><span class="snap-bar-track"><span class="snap-bar-fill" style="width:\'+(h.valor/maxH*100)+\'%"></span></span><span>\'+brl.format(h.valor)+\'</span></div>\'\n' +
'  ).join("");\n' +
'\n' +
'  const agg=new Map();\n' +
'  (p.investimentos||[]).forEach(i=>{ if(+i.valor>0) agg.set(i.instituicao,(agg.get(i.instituicao)||0)+ +i.valor); });\n' +
'  const inst=Array.from(agg.entries()).sort((a,b)=>b[1]-a[1]);\n' +
'  const maxI=Math.max.apply(null, inst.map(i=>i[1]).concat([1]));\n' +
'  document.getElementById("instituicoes").innerHTML = inst.length ? inst.map(i=>\n' +
'    \'<div class="snap-row"><span>\'+i[0]+\'</span><span class="snap-bar-track"><span class="snap-bar-fill" style="width:\'+(i[1]/maxI*100)+\'%"></span></span><span>\'+brl.format(i[1])+\'</span></div>\'\n' +
'  ).join("") : \'<p class="snap-muted">Nenhum investimento.</p>\';\n' +
'\n' +
'  const tmap=new Map();\n' +
'  (p.investimentos||[]).forEach(i=>{ if(+i.valor>0){ const t=i.tipo||"A classificar"; tmap.set(t,(tmap.get(t)||0)+ +i.valor); } });\n' +
'  const types=Array.from(tmap.entries()).sort((a,b)=>b[1]-a[1]);\n' +
'  document.getElementById("tipos").innerHTML = types.length ? types.map(t=>\n' +
'    \'<div class="snap-row"><span>\'+t[0]+\'</span><span class="snap-bar-track"><span class="snap-bar-fill" style="width:\'+(t[1]/d.invTotal*100)+\'%"></span></span><span>\'+brl.format(t[1])+\' · \'+pct(t[1]/d.invTotal*100)+\'</span></div>\'\n' +
'  ).join("") : \'<p class="snap-muted">Sem dados.</p>\';\n' +
'\n' +
'  document.getElementById("imoveis").innerHTML = (p.imobilizado||[]).length ? (p.imobilizado||[]).map(it=>\n' +
'    \'<div class="snap-row"><span>\'+it.nome+\' <span class="snap-muted">(\'+it.classe+\')</span></span><span>\'+brl.format(it.valor)+(it.divida>0?\' − \'+brl.format(it.divida)+\' dívida\':\'\')+\'</span></div>\'\n' +
'  ).join("") : \'<p class="snap-muted">Nenhum imóvel/veículo.</p>\';\n' +
'\n' +
'  document.getElementById("investimentos").innerHTML = (p.investimentos||[]).length ? (p.investimentos||[]).map(it=>\n' +
'    \'<div class="snap-row"><span>\'+it.instituicao+(it.local==="Exterior"?" (US)":"")+\' <span class="snap-muted">\'+(it.tipo||"A classificar")+\'</span></span><span>\'+brl.format(it.valor)+\'</span></div>\'\n' +
'  ).join("") : \'<p class="snap-muted">Nenhum investimento.</p>\';\n' +
'\n' +
'  const movs=(p.movimentacoes||[]).slice().filter(m=>m.mes).sort((a,b)=>a.mes<b.mes?-1:1);\n' +
'  document.getElementById("movimentacao").innerHTML = movs.length ? movs.slice().reverse().map(m=>\n' +
'    \'<div class="snap-row"><span>\'+m.mes+\'</span><span>saldo \'+brl.format(m.saldo||0)+\' · aporte \'+brl.format(m.aporte||0)+\' · rend. \'+brl.format(m.rentabilidade||0)+\'</span></div>\'\n' +
'  ).join("") : \'<p class="snap-muted">Nenhuma movimentação.</p>\';\n' +
'}\n' +
'document.getElementById("lock-form").addEventListener("submit", async function(e){\n' +
'  e.preventDefault();\n' +
'  const pw=document.getElementById("lock-pw").value;\n' +
'  const msgEl=document.getElementById("lock-msg");\n' +
'  msgEl.textContent="Verificando…"; msgEl.style.color="var(--muted)";\n' +
'  try{\n' +
'    const p=await decryptBlob(LOCKED_BLOB, pw);\n' +
'    document.getElementById("lock").style.display="none";\n' +
'    document.getElementById("app").style.display="block";\n' +
'    renderAll(p);\n' +
'  }catch(err){ msgEl.textContent="Senha incorreta."; msgEl.style.color="var(--danger)"; }\n' +
'});\n' +
'if(!LOCKED_BLOB){ document.getElementById("lock-msg").textContent="Nenhum dado embutido neste arquivo."; }\n' +
'</' + 'script>\n' +
'</body>\n' +
'</html>\n';

  global.PatrimonioSnapshotTemplate = SNAPSHOT_HTML_TEMPLATE;
})(window);
