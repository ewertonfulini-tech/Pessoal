/* storage.js — persistência em localStorage + estrutura de dados */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'meugestor_data_v1';
  const SCHEMA_VERSION = 1;

  const DEFAULT_CATEGORIES = [
    { id: 'cat_moradia', name: 'Moradia', color: '#6366f1', type: 'expense' },
    { id: 'cat_alimentacao', name: 'Alimentação', color: '#f59e0b', type: 'expense' },
    { id: 'cat_transporte', name: 'Transporte', color: '#06b6d4', type: 'expense' },
    { id: 'cat_saude', name: 'Saúde', color: '#ef4444', type: 'expense' },
    { id: 'cat_lazer', name: 'Lazer', color: '#ec4899', type: 'expense' },
    { id: 'cat_educacao', name: 'Educação', color: '#8b5cf6', type: 'expense' },
    { id: 'cat_assinaturas', name: 'Assinaturas', color: '#14b8a6', type: 'expense' },
    { id: 'cat_compras', name: 'Compras', color: '#f97316', type: 'expense' },
    { id: 'cat_outros_d', name: 'Outros', color: '#94a3b8', type: 'expense' },
    { id: 'cat_salario', name: 'Salário', color: '#22c55e', type: 'income' },
    { id: 'cat_freelance', name: 'Freelance', color: '#84cc16', type: 'income' },
    { id: 'cat_investimentos', name: 'Investimentos', color: '#10b981', type: 'income' },
    { id: 'cat_outros_r', name: 'Outros', color: '#4ade80', type: 'income' }
  ];

  function defaultData() {
    return {
      version: SCHEMA_VERSION,
      categories: DEFAULT_CATEGORIES.map(function (c) { return Object.assign({}, c); }),
      // Despesas e receitas (únicas ou recorrentes)
      transactions: [],
      // Cartões de crédito
      cards: [],
      // Compras no cartão (à vista ou parceladas)
      cardExpenses: [],
      // Marca de "pago" por ocorrência: chave "id:YYYY-MM" -> true
      paidOverrides: {},
      // Faturas pagas: chave "cardId:YYYY-MM" -> true
      invoicePaid: {},
      // Contas (banco/carteira/dinheiro) com saldo inicial
      accounts: [],
      // Orçamentos mensais por categoria: [{ categoryId, amount }]
      budgets: [],
      // Preferências gerais
      settings: {}
    };
  }

  let data = null;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { data = defaultData(); save(); return data; }
      const parsed = JSON.parse(raw);
      data = migrate(parsed);
      return data;
    } catch (e) {
      console.error('Falha ao carregar dados, iniciando vazio.', e);
      data = defaultData();
      return data;
    }
  }

  function migrate(parsed) {
    const base = defaultData();
    // Garante que todas as chaves existam
    const merged = Object.assign({}, base, parsed);
    merged.version = SCHEMA_VERSION;
    ['categories', 'transactions', 'cards', 'cardExpenses',
      'accounts', 'budgets'].forEach(function (k) {
      if (!Array.isArray(merged[k])) merged[k] = base[k];
    });
    if (!merged.paidOverrides || typeof merged.paidOverrides !== 'object') merged.paidOverrides = {};
    if (!merged.invoicePaid || typeof merged.invoicePaid !== 'object') merged.invoicePaid = {};
    if (!merged.settings || typeof merged.settings !== 'object') merged.settings = {};
    return merged;
  }

  let saveTimer = null;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Falha ao salvar dados.', e);
    }
    // Se a sincronização na nuvem estiver ativa, propaga a mudança
    if (global.Sync && global.Sync.notifyLocalChange) global.Sync.notifyLocalChange();
  }

  // Salva de forma agrupada para não travar em edições rápidas
  function saveDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 150);
  }

  function getData() { return data; }

  function replaceData(newData) {
    data = migrate(newData);
    save();
  }

  function exportJSON() {
    return JSON.stringify(data, null, 2);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('Arquivo inválido.');
    replaceData(parsed);
    return data;
  }

  function resetAll() {
    data = defaultData();
    save();
    return data;
  }

  global.Store = {
    STORAGE_KEY, SCHEMA_VERSION,
    load, save, saveDebounced, getData, replaceData,
    exportJSON, importJSON, resetAll, defaultData
  };
})(window);
