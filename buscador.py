#!/usr/bin/env python3
"""
Buscador pessoal de passagens com milhas.

Fluxo: seats.aero (cache de disponibilidade) → avaliação (teto em R$ e
mediana histórica) → preço em dinheiro (Google Flights via SerpApi) →
histórico em SQLite → alertas no Telegram + painel HTML.

Uso:
  python buscador.py              # execução normal
  python buscador.py --teste      # roda com dados fictícios, sem API
  python buscador.py --sem-envio  # busca de verdade, mas não envia ao Telegram
"""
import argparse
import html
import os
import sqlite3
import statistics
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
import yaml

BASE = Path(__file__).resolve().parent
API = "https://seats.aero/partnerapi"

CABINES = {"economy": "Y", "premium": "W", "business": "J", "first": "F"}
NOME_CABINE = {"economy": "Econômica", "premium": "Premium Economy",
               "business": "Executiva", "first": "Primeira"}
PESO_CABINE = {"economy": 1.0, "premium": 1.2, "business": 1.5, "first": 1.7}
NOME_PROGRAMA = {
    "smiles": "Smiles", "azul": "Azul Fidelidade", "aeroplan": "Aeroplan",
    "flyingblue": "Flying Blue", "united": "United MileagePlus",
    "american": "AAdvantage", "alaska": "Alaska Mileage Plan",
    "delta": "Delta SkyMiles", "virginatlantic": "Virgin Atlantic",
    "aeromexico": "Club Premier", "connectmiles": "Copa ConnectMiles",
    "emirates": "Emirates Skywards", "etihad": "Etihad Guest",
    "qatar": "Qatar Privilege Club", "turkish": "Turkish Miles&Smiles",
    "singapore": "KrisFlyer", "lufthansa": "Miles&More",
    "eurobonus": "SAS EuroBonus", "finnair": "Finnair Plus",
    "ethiopian": "ShebaMiles", "saudia": "AlFursan", "qantas": "Qantas",
    "velocity": "Velocity", "jetblue": "TrueBlue", "iberia": "Iberia Club (Avios)", "latam": "LATAM Pass",
}
NOME_ORIGEM = {"saldo": "seu saldo", "livelo": "Livelo", "esfera": "Esfera"}


def fmt(n):
    """Número no padrão brasileiro: 95000 -> 95.000"""
    return f"{n:,.0f}".replace(",", ".")


def data_br(iso):
    return datetime.strptime(iso[:10], "%Y-%m-%d").strftime("%d/%m/%Y")


# ----------------------------------------------------------------- API
class SeatsAero:
    def __init__(self, chave):
        self.s = requests.Session()
        self.s.headers.update({"Partner-Authorization": chave,
                               "Accept": "application/json"})
        self.chamadas = 0

    def _get(self, caminho, params=None):
        for tentativa in range(3):
            r = self.s.get(f"{API}{caminho}", params=params, timeout=60)
            self.chamadas += 1
            if r.status_code == 429:  # limite de requisições
                time.sleep(30 * (tentativa + 1))
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError("seats.aero recusou por limite de requisições (429).")

    def busca(self, origens, destinos, inicio, fim, programas, max_paginas):
        params = {
            "origin_airport": ",".join(origens),
            "destination_airport": ",".join(destinos),
            "start_date": inicio, "end_date": fim, "take": 1000,
        }
        if programas:
            params["sources"] = ",".join(programas)
        vistos, resultado, cursor = set(), [], None
        for pagina in range(max_paginas):
            if cursor is not None:
                params.update(cursor=cursor, skip=len(resultado))
            resp = self._get("/search", params)
            cursor = resp.get("cursor", cursor)
            for r in resp.get("data", []):
                if r.get("ID") not in vistos:
                    vistos.add(r.get("ID"))
                    resultado.append(r)
            if not resp.get("hasMore"):
                break
        return resultado

    def trips(self, availability_id):
        return self._get(f"/trips/{availability_id}")


# -------------------------------------------------------------- banco
def abrir_banco(caminho):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(caminho)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS observacoes (
            origem TEXT, destino TEXT, data_voo TEXT, programa TEXT,
            cabine TEXT, milhas INTEGER, assentos INTEGER, dia_visto TEXT,
            PRIMARY KEY (origem, destino, data_voo, programa, cabine, dia_visto));
        CREATE INDEX IF NOT EXISTS idx_rota
            ON observacoes (origem, destino, programa, cabine, dia_visto);
        CREATE TABLE IF NOT EXISTS alertas (chave TEXT PRIMARY KEY, enviado_em TEXT);
        CREATE TABLE IF NOT EXISTS precos_dinheiro (
            origem TEXT, destino TEXT, data_voo TEXT, cabine TEXT,
            preco REAL, nivel TEXT, faixa TEXT, link TEXT, consultado_em TEXT,
            PRIMARY KEY (origem, destino, data_voo, cabine));
        CREATE TABLE IF NOT EXISTS uso_api (mes TEXT, servico TEXT, chamadas INTEGER,
            PRIMARY KEY (mes, servico));
    """)
    return con


def carregar_historico(con, dias):
    desde = (date.today() - timedelta(days=dias)).isoformat()
    hist = defaultdict(list)
    for o, d, p, c, m in con.execute(
            "SELECT origem, destino, programa, cabine, milhas FROM observacoes "
            "WHERE dia_visto >= ?", (desde,)):
        hist[(o, d, p, c)].append(m)
    return hist


def registrar(con, ofertas):
    hoje = date.today().isoformat()
    con.executemany(
        "INSERT OR REPLACE INTO observacoes VALUES (?,?,?,?,?,?,?,?)",
        [(o["origem"], o["destino"], o["data"], o["programa"], o["cabine"],
          o["milhas"], o["assentos"], hoje) for o in ofertas])


def ja_alertado(con, chave, dias):
    row = con.execute("SELECT enviado_em FROM alertas WHERE chave=?", (chave,)).fetchone()
    if not row:
        return False
    return datetime.fromisoformat(row[0]) > datetime.now(timezone.utc) - timedelta(days=dias)


def marcar_alertado(con, chave):
    con.execute("INSERT OR REPLACE INTO alertas VALUES (?,?)",
                (chave, datetime.now(timezone.utc).isoformat()))


# ---------------------------------------------------------- avaliação
def extrair_ofertas(registros, cabines, assentos_min):
    ofertas = []
    for r in registros:
        rota = r.get("Route") or {}
        for cab in cabines:
            L = CABINES[cab]
            if not r.get(f"{L}Available"):
                continue
            try:
                milhas = int(r.get(f"{L}MileageCost") or 0)
            except (TypeError, ValueError):
                continue
            if milhas <= 0:
                continue
            assentos = int(r.get(f"{L}RemainingSeats") or 0)
            if assentos and assentos < assentos_min:
                continue  # 0 = programa não informa; não descartamos
            ofertas.append({
                "id": r.get("ID"), "origem": rota.get("OriginAirport"),
                "destino": rota.get("DestinationAirport"), "data": r.get("Date"),
                "programa": r.get("Source") or rota.get("Source"), "cabine": cab,
                "milhas": milhas, "assentos": assentos,
                "direto": bool(r.get(f"{L}Direct")),
                "cias": r.get(f"{L}Airlines") or "",
            })
    return ofertas


def avaliar(o, rota, cfg, hist):
    vm = cfg["valor_milheiro"].get(o["programa"], cfg["valor_milheiro"].get("padrao", 90))
    custo = o["milhas"] * vm / 1000
    teto = (rota.get("teto_reais") or {}).get(o["cabine"])
    crit = cfg["criterios"]
    amostras = hist.get((o["origem"], o["destino"], o["programa"], o["cabine"]), [])
    mediana = statistics.median(amostras) if len(amostras) >= crit["amostras_minimas"] else None
    desconto = 1 - o["milhas"] / mediana if mediana else None

    motivos = []
    if o.get("tabela"):
        motivos.append("assento liberado na tabela fixa")
    if teto and custo <= teto:
        motivos.append(f"≈ R$ {fmt(custo)}, abaixo do seu teto de R$ {fmt(teto)}")
    if desconto is not None and desconto >= crit["desconto_vs_mediana"]:
        motivos.append(f"{desconto:.0%} abaixo da mediana ({fmt(mediana)} milhas)")
    if not motivos:
        return None

    score = (max(0, 1 - custo / teto) if teto else 0) + max(0, desconto or 0)
    if o.get("tabela"):
        score += 0.3
    score *= PESO_CABINE[o["cabine"]] * (1.1 if o["direto"] else 1.0)
    return {**o, "rota": rota["nome"], "custo_reais": custo, "mediana": mediana,
            "desconto": desconto, "motivos": motivos, "score": score}


def melhor_por_voo(oportunidades):
    """Mantém só a opção mais barata (em R$) por trecho/data/cabine."""
    melhores = {}
    for o in oportunidades:
        k = (o["origem"], o["destino"], o["data"], o["cabine"])
        if k not in melhores or o["custo_reais"] < melhores[k]["custo_reais"]:
            melhores[k] = o
    return sorted(melhores.values(), key=lambda x: x["score"], reverse=True)


def enriquecer(cliente, o):
    """Busca voos, taxas e link de reserva da opção mais barata (1 chamada)."""
    if not o.get("id"):
        return
    try:
        resp = cliente.trips(o["id"])
    except Exception as e:  # não derruba a execução por causa do detalhe
        print(f"  aviso: sem detalhes para {o['id']}: {e}", file=sys.stderr)
        return
    trips = [t for t in resp.get("data", []) if t.get("Cabin") == o["cabine"]]
    if trips:
        t = min(trips, key=lambda t: t.get("MileageCost") or 10**9)
        o["voos"] = t.get("FlightNumbers")
        o["paradas"] = t.get("Stops")
        if t.get("TotalTaxes"):
            o["taxas"] = f"{t['TotalTaxes'] / 100:.2f} {t.get('TaxesCurrency') or ''}".strip()
    links = resp.get("booking_links") or []
    principal = next((l for l in links if l.get("primary")), links[0] if links else None)
    if principal:
        o["link"] = principal.get("link")




# -------------------------------------------- tabela fixa e emissão
def em_temporada_alta(dia, periodos):
    return any(ini <= dia <= fim for ini, fim in (periodos or []))


def detectar_tabela_fixa(registros, rota, cfg):
    """Assento de resgate em voo direto da cia da tabela → opção de emitir pela tabela."""
    ofertas = {}
    for prog, tab in (cfg.get("tabela_fixa") or {}).items():
        cia = tab["cia_operadora"]
        ignorar = set(tab.get("ignorar_fontes") or [])
        for r in registros:
            rt = r.get("Route") or {}
            if (r.get("Source") or rt.get("Source")) in ignorar:
                continue
            o_, d_ = rt.get("OriginAirport"), rt.get("DestinationAirport")
            trecho = next((t for t in tab["trechos"]
                           if (o_ in t["origens"] and d_ in t["destinos"])
                           or (d_ in t["origens"] and o_ in t["destinos"])), None)
            if not trecho:
                continue
            for cab in rota["cabines"]:
                L = CABINES[cab]
                precos = trecho.get(cab)
                cias = [x.strip() for x in (r.get(f"{L}Airlines") or "").split(",")]
                if not (precos and r.get(f"{L}Available") and r.get(f"{L}Direct") and cia in cias):
                    continue
                if isinstance(precos, (int, float)):
                    precos = {"fixo": int(precos)}
                alta = em_temporada_alta(r["Date"], tab.get("temporada_alta"))
                milhas = (precos.get("fixo") or precos.get("alta" if alta else "baixa")
                          or precos.get("baixa"))
                k = (prog, o_, d_, r["Date"], cab)
                assentos = int(r.get(f"{L}RemainingSeats") or 0)
                if k not in ofertas or assentos > ofertas[k]["assentos"]:
                    ofertas[k] = {
                        "id": None, "origem": o_, "destino": d_, "data": r["Date"],
                        "programa": prog, "cabine": cab, "milhas": milhas,
                        "assentos": assentos, "direto": True, "cias": cia,
                        "tabela": {"fixo": precos.get("fixo"),
                                   "baixa": precos.get("baixa"), "alta": precos.get("alta"),
                                   "temporada": ("alta" if alta else "baixa")
                                   if tab.get("temporada_alta") else None,
                                   "descricao": tab.get("descricao"),
                                   "onde": tab.get("onde_emitir")},
                    }
    return list(ofertas.values())


def acessivel(programa, cfg):
    return programa in (cfg.get("acesso") or {})


def guia_emissao(o, cfg):
    """Linhas de 'como emitir' com o que a pessoa tem."""
    caminhos = (cfg.get("acesso") or {}).get(o["programa"])
    if not caminhos:
        return ["🧭 Programa fora dos seus (sem saldo nem parceiro de transferência)."]
    saldos = cfg.get("meus_programas") or {}
    partes, linhas = [], []
    if "saldo" in caminhos:
        tem = saldos.get(caminhos["saldo"]) or 0
        if tem >= o["milhas"]:
            partes.append(f"seu saldo já cobre ({fmt(tem)})")
        elif tem:
            partes.append(f"saldo {fmt(tem)}, faltam {fmt(o['milhas'] - tem)}")
    for origem in ("esfera", "livelo"):
        if origem in caminhos:
            par = caminhos[origem]
            saldo_origem = saldos.get(origem) or 0
            if par:
                necess = o["milhas"] * par
                txt = f"{NOME_ORIGEM[origem]} {str(par).replace('.', ',')}:1 = {fmt(necess)} pts"
                if saldo_origem and saldo_origem >= necess:
                    txt += " ✔"
            else:
                txt = f"{NOME_ORIGEM[origem]} (confira a paridade)"
            partes.append(txt)
    prog = NOME_PROGRAMA.get(o["programa"], o["programa"])
    linhas.append(f"🧭 Emitir via {prog}: " + " · ".join(partes) if partes else f"🧭 Emitir via {prog}")
    tab = o.get("tabela")
    if tab:
        if tab.get("fixo"):
            linhas.append(f"📋 {tab['descricao']}: {fmt(tab['fixo'])} por trecho")
        elif tab["temporada"]:
            linhas.append(f"📋 {tab['descricao']}: {fmt(o['milhas'])} Avios (temporada {tab['temporada']})")
        else:
            alta = f" / {fmt(tab['alta'])} na alta" if tab.get("alta") else ""
            linhas.append(f"📋 {tab['descricao']}: {fmt(tab['baixa'])} na baixa{alta} (por trecho)")
        if tab.get("onde"):
            linhas.append(f"Onde: {tab['onde']}")
    return linhas


def resumo_acesso(o, cfg):
    caminhos = (cfg.get("acesso") or {}).get(o["programa"]) or {}
    itens = []
    for k, v in caminhos.items():
        if k == "saldo":
            itens.append("saldo")
        else:
            itens.append(f"{NOME_ORIGEM[k]} {str(v).replace('.', ',')}:1" if v else NOME_ORIGEM[k])
    return " / ".join(itens) or "fora do alcance"


# ---------------------------------------------------- preço em dinheiro
CLASSE_GOOGLE = {"economy": 1, "premium": 2, "business": 3, "first": 4}
NIVEL_PRECO = {"low": "baixo", "typical": "normal", "high": "alto"}


def uso_mes(con, servico):
    mes = date.today().strftime("%Y-%m")
    row = con.execute("SELECT chamadas FROM uso_api WHERE mes=? AND servico=?",
                      (mes, servico)).fetchone()
    return row[0] if row else 0


def somar_uso(con, servico):
    mes = date.today().strftime("%Y-%m")
    con.execute("INSERT INTO uso_api VALUES (?,?,1) ON CONFLICT(mes, servico) "
                "DO UPDATE SET chamadas = chamadas + 1", (mes, servico))


def preco_em_cache(con, o, horas=24):
    row = con.execute(
        "SELECT preco, nivel, faixa, link, consultado_em FROM precos_dinheiro "
        "WHERE origem=? AND destino=? AND data_voo=? AND cabine=?",
        (o["origem"], o["destino"], o["data"], o["cabine"])).fetchone()
    if row and datetime.fromisoformat(row[4]) > datetime.now(timezone.utc) - timedelta(hours=horas):
        return {"preco": row[0], "nivel": row[1], "faixa": row[2], "link": row[3]}
    return None


def consultar_google_flights(o, chave, moeda):
    """Tarifa mais barata só de ida no Google Flights (via SerpApi). 1 busca."""
    params = {
        "engine": "google_flights", "api_key": chave, "type": 2,  # só ida
        "departure_id": o["origem"], "arrival_id": o["destino"],
        "outbound_date": o["data"], "travel_class": CLASSE_GOOGLE[o["cabine"]],
        "currency": moeda, "gl": "br", "hl": "pt-br",
    }
    r = requests.get("https://serpapi.com/search.json", params=params, timeout=90)
    r.raise_for_status()
    resp = r.json()
    if resp.get("error"):
        raise RuntimeError(resp["error"])
    voos = (resp.get("best_flights") or []) + (resp.get("other_flights") or [])
    precos = [v["price"] for v in voos if isinstance(v.get("price"), (int, float))]
    insights = resp.get("price_insights") or {}
    faixa = insights.get("typical_price_range")
    return {
        "preco": min(precos) if precos else None,
        "nivel": NIVEL_PRECO.get(insights.get("price_level"), insights.get("price_level")),
        "faixa": f"R$ {fmt(faixa[0])}–{fmt(faixa[1])}" if faixa and len(faixa) == 2 else None,
        "link": (resp.get("search_metadata") or {}).get("google_flights_url"),
    }


def anexar_preco_dinheiro(con, o, cfg, teste=False):
    """Preenche o['dinheiro'] e o veredito milhas x dinheiro."""
    dcfg = cfg.get("dinheiro") or {}
    if not dcfg.get("ativo"):
        return
    info = preco_em_cache(con, o, dcfg.get("cache_horas", 24))
    if info is None:
        if teste:
            fator = 2.2 if o["cabine"] == "business" else 1.4
            info = {"preco": round(o["custo_reais"] * fator, -1), "nivel": "normal",
                    "faixa": None, "link": None}
        else:
            chave = os.getenv("SERPAPI_KEY")
            if not chave:
                return
            if uso_mes(con, "serpapi") >= dcfg.get("max_buscas_mes", 90):
                print("  cota mensal de preços em dinheiro atingida — pulando", file=sys.stderr)
                return
            try:
                somar_uso(con, "serpapi")
                info = consultar_google_flights(o, chave, dcfg.get("moeda", "BRL"))
            except Exception as e:
                print(f"  aviso: preço em dinheiro indisponível ({e})", file=sys.stderr)
                return
        con.execute("INSERT OR REPLACE INTO precos_dinheiro VALUES (?,?,?,?,?,?,?,?,?)",
                    (o["origem"], o["destino"], o["data"], o["cabine"], info["preco"],
                     info["nivel"], info["faixa"], info["link"],
                     datetime.now(timezone.utc).isoformat()))
    if not info or not info.get("preco"):
        return
    preco = info["preco"]
    o["dinheiro"] = info
    o["economia"] = preco - o["custo_reais"]
    o["valor_obtido_milheiro"] = preco / o["milhas"] * 1000
    o["usar_milhas"] = o["economia"] > preco * dcfg.get("economia_minima", 0.2)


# ------------------------------------------------------------- saídas
def texto_alerta(o, cfg=None):
    e = html.escape
    prog = NOME_PROGRAMA.get(o["programa"], o["programa"])
    assentos = f"{o['assentos']} assento(s)" if o["assentos"] else "assentos n/d"
    linhas = [
        f"✈️ <b>{e(o['origem'])} → {e(o['destino'])}</b> · {data_br(o['data'])} · {NOME_CABINE[o['cabine']]}",
        f"{e(prog)}: <b>{fmt(o['milhas'])} {'Avios' if o['programa'] == 'iberia' else 'milhas'}</b> (≈ R$ {fmt(o['custo_reais'])})"
        + (f" + taxas {e(o['taxas'])}" if o.get("taxas") else ""),
        f"{'Direto' if o['direto'] else 'Com conexão'} · {e(o['cias'])} · {assentos}",
        "Por quê: " + "; ".join(e(m) for m in o["motivos"]),
    ]
    d = o.get("dinheiro")
    if d:
        nivel = f" · preço {d['nivel']} para a rota" if d.get("nivel") else ""
        faixa = f" (faixa usual {d['faixa']})" if d.get("faixa") else ""
        linhas.append(f"💵 Em dinheiro: <b>R$ {fmt(d['preco'])}</b>{nivel}{faixa}")
        if o["usar_milhas"]:
            linhas.append(f"✅ Vale usar milhas: economia ≈ R$ {fmt(o['economia'])} · "
                          f"suas milhas rendem R$ {fmt(o['valor_obtido_milheiro'])}/milheiro")
        else:
            linhas.append(f"⚠️ Compensa mais pagar em dinheiro ou guardar as milhas "
                          f"(rendem só R$ {fmt(o['valor_obtido_milheiro'])}/milheiro)")
    if o.get("voos"):
        linhas.append(f"Voos: {e(o['voos'])}")
    if cfg is not None:
        linhas += [e(x) for x in guia_emissao(o, cfg)]
    if o.get("link"):
        linhas.append(f'<a href="{e(o["link"])}">Abrir no programa</a>')
    if d and d.get("link"):
        linhas.append(f'<a href="{e(d["link"])}">Ver no Google Flights</a>')
    return "\n".join(linhas)


RODAPE = ("ℹ️ Antes de transferir pontos, confirme o voo no site do programa: "
          "transferências são irreversíveis e podem levar dias. Prefira transferir em promoção bonificada.")


def enviar_telegram(mensagens):
    mensagens = mensagens + [RODAPE]
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not (token and chat):
        print("Telegram não configurado — alertas só no console.")
        return False
    bloco = ""
    blocos = []
    for m in mensagens:  # Telegram aceita até 4096 caracteres por mensagem
        if len(bloco) + len(m) > 3800:
            blocos.append(bloco)
            bloco = ""
        bloco += m + "\n\n"
    if bloco:
        blocos.append(bloco)
    for b in blocos:
        r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                          json={"chat_id": chat, "text": b, "parse_mode": "HTML",
                                "disable_web_page_preview": True}, timeout=30)
        r.raise_for_status()
    return True


def gerar_painel(oportunidades, caminho, cfg=None):
    e = html.escape
    linhas = "".join(
        f"<tr><td>{e(o['rota'])}</td><td>{e(o['origem'])} → {e(o['destino'])}</td>"
        f"<td>{data_br(o['data'])}</td><td>{NOME_CABINE[o['cabine']]}</td>"
        f"<td>{e(NOME_PROGRAMA.get(o['programa'], o['programa']))}</td>"
        f"<td class='n'>{fmt(o['milhas'])}</td><td class='n'>R$ {fmt(o['custo_reais'])}</td>"
        f"<td class='n'>{'R$ ' + fmt(o['dinheiro']['preco']) if o.get('dinheiro') else '—'}</td>"
        f"<td>{('Milhas' if o['usar_milhas'] else 'Dinheiro') if o.get('dinheiro') else '—'}</td>"
        f"<td class='n'>{o['assentos'] or 'n/d'}</td><td>{'Sim' if o['direto'] else 'Não'}</td>"
        f"<td>{e('; '.join(o['motivos']))}</td>"
        f"<td>{e(resumo_acesso(o, cfg or {}))}</td></tr>"
        for o in oportunidades) or "<tr><td colspan='13'>Nenhuma oportunidade nesta rodada.</td></tr>"
    agora = datetime.now(timezone(timedelta(hours=-3))).strftime("%d/%m/%Y %H:%M")
    caminho.write_text(f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oportunidades em milhas</title><style>
body{{font-family:system-ui,sans-serif;margin:16px;color:#1a1a1a;background:#fafafa}}
h1{{font-size:1.3rem;margin:0 0 4px}} p{{color:#666;margin:0 0 16px}}
.w{{overflow-x:auto}} table{{border-collapse:collapse;width:100%;font-size:.85rem;background:#fff}}
th,td{{padding:8px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap}}
th{{background:#0b3d91;color:#fff;position:sticky;top:0}} td.n{{text-align:right}}
tr:hover td{{background:#f2f6ff}}
</style></head><body><h1>Oportunidades em milhas</h1>
<p>Atualizado em {agora} (Brasília) · ordenado por prioridade · confirme sempre no site do programa</p>
<div class="w"><table><tr><th>Rota</th><th>Trecho</th><th>Data</th><th>Cabine</th><th>Programa</th>
<th>Milhas</th><th>≈ R$ (milhas)</th><th>R$ dinheiro</th><th>Melhor opção</th><th>Assentos</th><th>Direto</th><th>Por quê</th><th>Como emitir</th></tr>{linhas}</table></div>
</body></html>""", encoding="utf-8")


# ------------------------------------------------------------ teste
def dados_de_teste():
    def reg(id_, o, d, dia, prog, cab, milhas, assentos, direto, cias):
        L = CABINES[cab]
        r = {"ID": id_, "Date": dia, "Source": prog,
             "Route": {"OriginAirport": o, "DestinationAirport": d, "Source": prog}}
        for x in "YWJF":
            r[f"{x}Available"] = False
        r.update({f"{L}Available": True, f"{L}MileageCost": str(milhas),
                  f"{L}RemainingSeats": assentos, f"{L}Direct": direto, f"{L}Airlines": cias})
        return r
    d = (date.today() + timedelta(days=120)).isoformat()
    return [
        reg("t1", "GRU", "LIS", d, "smiles", "business", 95000, 4, True, "TP"),
        reg("t2", "GRU", "MAD", d, "aeroplan", "economy", 30000, 7, False, "LA, IB"),
        reg("t3", "GIG", "CDG", d, "flyingblue", "business", 150000, 2, True, "AF"),
        reg("t4", "GRU", "REC", d, "azul", "economy", 18000, 0, True, "AD"),
        reg("t5", "GRU", "MIA", d, "american", "business", 57500, 1, True, "AA"),
        reg("t6", "GRU", "MAD", d, "american", "business", 57500, 3, True, "IB"),
        reg("t7", "GRU", "ATL", d, "virginatlantic", "business", 47500, 2, True, "DL"),
        reg("t8", "GRU", "ATL", d, "delta", "economy", 30000, 9, True, "DL"),
        reg("t9", "MAD", "GIG", d, "american", "economy", 22000, 4, True, "IB"),
    ]


# ------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="Buscador pessoal de passagens com milhas")
    ap.add_argument("--config", default=str(BASE / "config.yaml"))
    ap.add_argument("--teste", action="store_true", help="usa dados fictícios, sem API")
    ap.add_argument("--sem-envio", action="store_true", help="não envia ao Telegram")
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    banco = BASE / "dados" / ("teste.db" if args.teste else "historico.db")
    con = abrir_banco(banco)
    hist = carregar_historico(con, cfg["criterios"]["historico_dias"])

    cliente = None
    if not args.teste:
        chave = os.getenv("SEATS_AERO_API_KEY")
        if not chave:
            sys.exit("Defina SEATS_AERO_API_KEY (Settings → API no seats.aero).")
        cliente = SeatsAero(chave)

    hoje = date.today()
    inicio = (hoje + timedelta(days=cfg["janela"]["dias_inicio"])).isoformat()
    fim = (hoje + timedelta(days=cfg["janela"]["dias_fim"])).isoformat()

    oportunidades = []
    for rota in cfg["rotas"]:
        if args.teste:
            registros = [r for r in dados_de_teste()
                         if r["Route"]["OriginAirport"] in rota["origens"]
                         and r["Route"]["DestinationAirport"] in rota["destinos"]]
        else:
            try:
                registros = cliente.busca(rota["origens"], rota["destinos"], inicio, fim,
                                          cfg.get("programas") or [],
                                          cfg["seats_aero"]["max_paginas_por_rota"])
            except Exception as e:
                print(f"[{rota['nome']}] falha na busca: {e}", file=sys.stderr)
                continue
        ofertas = extrair_ofertas(registros, rota["cabines"], cfg["assentos_minimos"])
        candidatas = ofertas + detectar_tabela_fixa(registros, rota, cfg)
        if cfg.get("somente_programas_acessiveis"):
            candidatas = [o for o in candidatas if acessivel(o["programa"], cfg)]
        achadas = [a for a in (avaliar(o, rota, cfg, hist) for o in candidatas) if a]
        oportunidades += achadas
        registrar(con, ofertas)
        print(f"[{rota['nome']}] {len(registros)} registros · {len(ofertas)} ofertas · "
              f"{len(achadas)} oportunidades")
    con.commit()

    ranking = melhor_por_voo(oportunidades)
    for o in ranking[:200]:  # painel: só usa o que já está em cache (sem gastar cota)
        if (cfg.get("dinheiro") or {}).get("ativo") and preco_em_cache(con, o):
            anexar_preco_dinheiro(con, o, cfg)
    gerar_painel(ranking[:200], BASE / ("painel-teste.html" if args.teste else "painel.html"), cfg)

    dias_realerta = cfg["alertas"]["realertar_apos_dias"]
    novas = []
    for o in ranking:
        chave = f"{o['origem']}-{o['destino']}-{o['data']}-{o['cabine']}-{o['programa']}-{o['milhas']}"
        if not ja_alertado(con, chave, dias_realerta):
            o["chave"] = chave
            novas.append(o)
        if len(novas) >= cfg["alertas"]["max_por_execucao"]:
            break

    if cliente:
        for o in novas:
            enriquecer(cliente, o)
    for o in novas:
        anexar_preco_dinheiro(con, o, cfg, teste=args.teste)
    con.commit()
    gerar_painel(ranking[:200], BASE / ("painel-teste.html" if args.teste else "painel.html"), cfg)

    if novas:
        mensagens = [texto_alerta(o, cfg) for o in novas]
        print("\n" + "\n\n".join(mensagens))
        enviado = False
        if not (args.teste or args.sem_envio):
            enviado = enviar_telegram(mensagens)
        if enviado or args.teste:
            for o in novas:
                marcar_alertado(con, o["chave"])
            con.commit()
    else:
        print("Nenhuma oportunidade nova nesta rodada.")

    if cliente:
        print(f"\nChamadas à API nesta execução: {cliente.chamadas} (limite Pro: 1.000/dia)")
        if (cfg.get("dinheiro") or {}).get("ativo"):
            print(f"Buscas de preço em dinheiro no mês: {uso_mes(con, 'serpapi')}/"
                  f"{cfg['dinheiro'].get('max_buscas_mes', 90)}")


if __name__ == "__main__":
    main()
