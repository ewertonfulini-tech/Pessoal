/* sync.js — sincronização opcional na nuvem via Firebase (Auth + Firestore).
 *
 * É totalmente opcional: se o usuário não configurar, o app funciona 100%
 * local (localStorage), como antes. Quando configurado e logado, os dados
 * passam a sincronizar automaticamente entre dispositivos em tempo real.
 *
 * Observação: requer acesso à internet, portanto NÃO funciona dentro do
 * visualizador de Artifact do claude.ai (que bloqueia rede). Use no
 * GitHub Pages ou em qualquer hospedagem comum.
 */
(function (global) {
  'use strict';

  const U = global.Utils;
  const CONFIG_KEY = 'meugestor_fb_config';
  const SDK_VERSION = '10.12.0';
  const SDK = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';

  // Estado interno
  const S = {
    config: null,       // objeto firebaseConfig
    fb: null,           // { appMod, authMod, fsMod, app, auth, db }
    user: null,         // usuário logado (ou null)
    ref: null,          // referência do documento na nuvem
    unsub: null,        // função para cancelar o listener em tempo real
    status: 'idle',     // idle | connecting | ready | syncing | error | offline
    message: '',        // mensagem de status legível
    lastSync: null,     // timestamp da última sincronização
    applying: false     // true enquanto aplicamos dados vindos da nuvem
  };

  let pushTimer = null;
  const listeners = [];

  function deviceId() {
    let id = localStorage.getItem('meugestor_device');
    if (!id) { id = U.uid('dev'); localStorage.setItem('meugestor_device', id); }
    return id;
  }

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function setStatus(status, message) {
    S.status = status;
    if (message != null) S.message = message;
    emit();
  }

  function getState() {
    return {
      configured: !!S.config,
      connected: S.status === 'ready' || S.status === 'syncing',
      status: S.status,
      message: S.message,
      email: S.user ? S.user.email : null,
      lastSync: S.lastSync
    };
  }

  /* ---------- Configuração ---------- */

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      S.config = raw ? JSON.parse(raw) : null;
    } catch (e) { S.config = null; }
    return S.config;
  }

  // Extrai as chaves de um texto colado (aceita o objeto firebaseConfig inteiro)
  function parseConfig(text) {
    const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket',
      'messagingSenderId', 'appId'];
    const cfg = {};
    keys.forEach(function (k) {
      const m = text.match(new RegExp(k + '\\s*:\\s*["\']([^"\']+)["\']'));
      if (m) cfg[k] = m[1];
    });
    const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
    const missing = required.filter(function (k) { return !cfg[k]; });
    if (missing.length) {
      throw new Error('Configuração incompleta. Faltando: ' + missing.join(', '));
    }
    return cfg;
  }

  function saveConfig(text) {
    const cfg = parseConfig(text);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    S.config = cfg;
    emit();
    return cfg;
  }

  function removeConfig() {
    if (S.unsub) { S.unsub(); S.unsub = null; }
    localStorage.removeItem(CONFIG_KEY);
    S.config = null; S.user = null; S.ref = null;
    setStatus('idle', '');
  }

  /* ---------- Inicialização do Firebase ---------- */

  async function ensureFirebase() {
    if (S.fb) return S.fb;
    if (!S.config) throw new Error('Configure a sincronização primeiro.');
    setStatus('connecting', 'Conectando ao Firebase...');
    const [appMod, authMod, fsMod] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js')
    ]);
    const app = appMod.initializeApp(S.config);
    const auth = authMod.getAuth(app);
    await authMod.setPersistence(auth, authMod.browserLocalPersistence);
    const db = fsMod.getFirestore(app);
    try {
      await fsMod.enableIndexedDbPersistence(db);
    } catch (e) { /* múltiplas abas ou sem suporte: segue sem cache offline */ }

    S.fb = { appMod: appMod, authMod: authMod, fsMod: fsMod, app: app, auth: auth, db: db };

    // Observa mudanças de login/logout
    authMod.onAuthStateChanged(auth, function (user) {
      S.user = user || null;
      if (user) {
        startForUser(user).catch(function (err) {
          setStatus('error', 'Erro ao sincronizar: ' + err.message);
        });
      } else {
        if (S.unsub) { S.unsub(); S.unsub = null; }
        setStatus('idle', 'Desconectado.');
      }
    });
    return S.fb;
  }

  /* ---------- Autenticação ---------- */

  async function login(email, password) {
    const fb = await ensureFirebase();
    setStatus('connecting', 'Entrando...');
    await fb.authMod.signInWithEmailAndPassword(fb.auth, email.trim(), password);
  }

  async function register(email, password) {
    const fb = await ensureFirebase();
    setStatus('connecting', 'Criando conta...');
    await fb.authMod.createUserWithEmailAndPassword(fb.auth, email.trim(), password);
  }

  async function logout() {
    if (!S.fb) return;
    if (S.unsub) { S.unsub(); S.unsub = null; }
    await S.fb.authMod.signOut(S.fb.auth);
  }

  /* ---------- Sincronização ---------- */

  function localIsEmpty() {
    const d = global.Store.getData();
    return d.transactions.length === 0 && d.cards.length === 0 &&
      d.cardExpenses.length === 0 && d.accounts.length === 0 &&
      d.budgets.length === 0;
  }

  async function startForUser(user) {
    const fb = S.fb;
    const ref = fb.fsMod.doc(fb.db, 'vaults', user.uid);
    S.ref = ref;
    setStatus('connecting', 'Carregando dados da nuvem...');

    // Reconciliação inicial (uma vez), evitando perder dados sem querer
    const snap = await fb.fsMod.getDoc(ref);
    if (snap.exists() && snap.data() && snap.data().json) {
      const remote = JSON.parse(snap.data().json);
      if (localIsEmpty()) {
        applyRemote(remote);
      } else {
        await new Promise(function (resolve) {
          global.UI.confirmModal('Dados na nuvem encontrados',
            'A nuvem já contém dados sincronizados. Deseja SUBSTITUIR os dados ' +
            'deste aparelho pelos da nuvem?\n\n' +
            'OK = usar os dados da nuvem.\nCancelar = manter os deste aparelho ' +
            '(eles serão enviados para a nuvem).',
            function () { applyRemote(remote); resolve(); },
            false);
          // Se o usuário cancelar, o modal fecha sem callback; tratamos via timeout curto
          setTimeout(function () { resolve(); }, 60000);
        });
        if (!localIsEmpty()) await pushNow();
      }
    } else {
      // Nuvem vazia: envia o que existe localmente
      await pushNow();
    }

    startRealtime(ref);
    S.lastSync = Date.now();
    setStatus('ready', 'Sincronizado.');
  }

  function startRealtime(ref) {
    const fb = S.fb;
    if (S.unsub) S.unsub();
    S.unsub = fb.fsMod.onSnapshot(ref, function (snap) {
      // Ignora o "eco" das nossas próprias escritas
      if (snap.metadata.hasPendingWrites) return;
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data || !data.json) return;
      if (data.device === deviceId()) return; // originado neste aparelho
      try {
        applyRemote(JSON.parse(data.json));
        S.lastSync = Date.now();
        setStatus('ready', 'Atualizado a partir de outro aparelho.');
        U.toast('Dados atualizados de outro aparelho.', 'success');
      } catch (e) { /* ignora payload inválido */ }
    }, function (err) {
      setStatus('offline', 'Sincronização offline: ' + err.message);
    });
  }

  // Aplica dados vindos da nuvem sem disparar novo envio
  function applyRemote(remoteData) {
    S.applying = true;
    global.Store.replaceData(remoteData);
    S.applying = false;
    if (global.App && global.App.refresh) global.App.refresh();
  }

  async function pushNow() {
    if (!S.ref || !S.fb) return;
    setStatus('syncing', 'Enviando para a nuvem...');
    try {
      await S.fb.fsMod.setDoc(S.ref, {
        json: JSON.stringify(global.Store.getData()),
        updatedAt: Date.now(),
        device: deviceId()
      });
      S.lastSync = Date.now();
      setStatus('ready', 'Sincronizado.');
    } catch (e) {
      setStatus('error', 'Falha ao enviar: ' + e.message);
    }
  }

  // Chamado pelo Store após cada gravação local
  function notifyLocalChange() {
    if (S.applying) return;           // mudança veio da nuvem, não reenviar
    if (!S.ref || !S.user) return;    // não conectado
    clearTimeout(pushTimer);
    setStatus('syncing', 'Sincronizando...');
    pushTimer = setTimeout(function () { pushNow(); }, 800);
  }

  /* ---------- Init ---------- */

  function init() {
    loadConfig();
    if (S.config) {
      // Tenta reconectar automaticamente uma sessão já existente
      ensureFirebase().catch(function (err) {
        setStatus('error', 'Não foi possível conectar: ' + err.message);
      });
    }
  }

  global.Sync = {
    init: init, onChange: onChange, getState: getState,
    saveConfig: saveConfig, removeConfig: removeConfig,
    login: login, register: register, logout: logout,
    notifyLocalChange: notifyLocalChange
  };
})(window);
