# 💰 Meu Gestor Financeiro

Um gestor de finanças pessoais **100% local**, inspirado no Mobills, porém
personalizável e sem depender de nenhum serviço externo. Roda direto no
navegador — basta abrir um arquivo, sem instalar nada.

## ✨ Funcionalidades

- **Despesas únicas e recorrentes** (mensais, semanais ou anuais), com categorias
  e marcação de "pago".
- **Previsão de receitas** — receitas únicas ou recorrentes para projetar o saldo.
- **Cartões de crédito** — cadastro de vários cartões (limite, dia de fechamento
  e vencimento) com compras **à vista e parceladas**. As parcelas são distribuídas
  automaticamente nas faturas corretas mês a mês.
- **Orçamento por categoria** (estilo "Planejamento" do Mobills) — defina um limite
  mensal por categoria, com barra de progresso, quanto ainda resta e **alerta quando
  o orçamento estoura**.
- **Contas e saldo** — cadastre contas (banco, carteira, dinheiro), vincule
  despesas/receitas/cartões a elas e acompanhe o **saldo real** (considerando apenas
  o que foi efetivado). Saldo consolidado de todas as contas.
- **Busca e filtros** nas listas de despesas e receitas: por descrição, categoria e
  status (pago/pendente).
- **Resumo diário** — lançamentos agrupados por dia com subtotal, e **meta de gastos**
  do mês com barra de progresso.
- **Visão geral (dashboard)** com:
  - Cartões de resumo (receitas, despesas, saldo previsto e saldo em contas).
  - Gráfico de rosca de **despesas por categoria**.
  - **Projeção de 6 meses** (receitas × despesas).
  - Alertas de orçamento estourado e lista dos lançamentos do mês.
- **Navegação por mês** (‹ ›) para ver o passado e planejar o futuro.
- **Backup**: exportar/importar seus dados em JSON.

## 🚀 Como usar

Não precisa de servidor nem de instalação. Escolha uma opção:

**Opção 1 — abrir direto**
1. Baixe/clone este repositório.
2. Dê um duplo clique em `index.html` (ou arraste para o navegador).

**Opção 2 — servidor local (opcional)**
```bash
# dentro da pasta do projeto
python3 -m http.server 8000
# depois abra http://localhost:8000
```

## 💾 Sobre os dados

Seus dados ficam salvos **apenas no seu navegador** (localStorage), de forma
privada — nada é enviado para a internet. Por isso:

- Use **Configurações → Exportar backup** de tempos em tempos.
- Ao trocar de navegador/dispositivo, use **Importar backup** para restaurar.
- Limpar os dados de navegação do site apaga as informações — mantenha um backup.

## 🗂️ Estrutura do projeto

```
index.html                 # estrutura da página
assets/css/styles.css      # estilos (tema claro/escuro automático)
assets/js/
  ├─ storage.js            # persistência em localStorage
  ├─ utils.js              # formatação (R$), datas e helpers de DOM
  ├─ finance.js            # regras: recorrências, faturas e agregações
  ├─ charts.js             # gráficos em SVG (sem bibliotecas externas)
  ├─ ui.js                 # modais e formulários
  └─ app.js                # navegação e renderização das abas
```

## 🧩 Como as faturas de cartão são calculadas

- Uma compra feita **até o dia de fechamento** entra na fatura que fecha no mês
  da compra; depois disso, na fatura do mês seguinte.
- O **vencimento** é no mesmo mês do fechamento se o dia de vencimento for maior
  que o de fechamento; caso contrário, no mês seguinte.
- Em compras parceladas, cada parcela cai na fatura de um mês subsequente, e a
  última parcela ajusta eventuais centavos para bater o total exato.

## 🔧 Personalização

Como é tudo código aberto e local, você pode adaptar à vontade: categorias e
cores já são editáveis pela tela de **Configurações**, e o restante (regras,
gráficos, layout) fica nos arquivos em `assets/`.
