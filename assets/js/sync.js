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

  // Configuração padrão do Firebase (credenciais públicas de projeto — não são
  // segredo; a segurança é garantida pelo login e pelas regras do Firestore).
  // Assim o app já vem pronto para sincronizar: basta fazer login. Se quiser usar
  // outro projeto, é só colar outro firebaseConfig em Configurações.
  const DEFAULT_CONFIG = {
    apiKey: 'AIzaSyCJBSoKRF-rKd2ZRTD73XWIEv3HvNkjpPg',
    authDomain: 'meu-gestor-bfeda.firebaseapp.com',
    projectId: 'meu-gestor-bfeda',
    storageBucket: 'meu-gestor-bfeda.firebasestorage.app',
    messagingSenderId: '722763677511',
    appId: '1:722763677511:web:d72546b2618cbef0221662'
  };

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
      S.config = raw ? JSON.parse(raw) : (DEFAULT_CONFIG || null);
    } catch (e) { S.config = DEFAULT_CONFIG || null; }
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
    // Volta para a configuração padrão embutida (se houver)
    S.config = DEFAULT_CONFIG || null;
    S.fb = null; S.user = null; S.ref = null;
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

    // Inicializa o Firestore em modo de compatibilidade:
    //  - long-polling automático: contorna redes/bloqueadores que quebram o
    //    canal padrão (causa comum de "client is offline" com login OK);
    //  - cache local persistente: mantém os dados offline entre recarregamentos.
    let db;
    try {
      db = fsMod.initializeFirestore(app, {
        experimentalAutoDetectLongPolling: true,
        localCache: fsMod.persistentLocalCache
          ? fsMod.persistentLocalCache({
              tabManager: fsMod.persistentMultipleTabManager
                ? fsMod.persistentMultipleTabManager() : undefined
            })
          : undefined
      });
    } catch (e) {
      // Fallback: configuração mais simples ainda com long-polling forçado
      try {
        db = fsMod.initializeFirestore(app, { experimentalForceLongPolling: true });
      } catch (e2) {
        db = fsMod.getFirestore(app);
      }
    }

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

  // Traduz erros do Firestore em algo acionável
  function friendlyFirestore(e) {
    const msg = (e && e.message) || '';
    if (/offline|unavailable|Failed to get document/i.test(msg)) {
      return 'Não foi possível conectar ao banco de dados (Firestore). ' +
        'Verifique se o Firestore Database foi CRIADO no Firebase (Build → ' +
        'Firestore Database → Create database, no modo Native). Se um bloqueador ' +
        'de anúncios estiver ativo, desative-o para este site. Depois toque em "Tentar novamente".';
    }
    if (/permission|insufficient/i.test(msg)) {
      return 'Sem permissão no Firestore. Publique as regras de segurança indicadas ' +
        'no guia (aba Rules do Firestore) e tente de novo.';
    }
    return 'Erro ao sincronizar: ' + msg;
  }

  async function startForUser(user) {
    const fb = S.fb;
    const ref = fb.fsMod.doc(fb.db, 'vaults', user.uid);
    S.ref = ref;
    setStatus('connecting', 'Carregando dados da nuvem...');

    try {
      // Reconciliação inicial (uma vez), evitando perder dados sem querer
      const snap = await fb.fsMod.getDoc(ref);
      if (snap.exists() && snap.data() && snap.data().json) {
        const remote = JSON.parse(snap.data().json);
        if (localIsEmpty()) {
          applyRemote(remote);
        } else {
          // Ambos têm dados: o usuário escolhe qual manter (sem travar)
          const useRemote = await chooseReconciliation();
          if (useRemote) applyRemote(remote);
          else await pushNow();
        }
      } else {
        // Nuvem vazia: envia o que existe localmente
        await pushNow();
      }

      startRealtime(ref);
      S.lastSync = Date.now();
      setStatus('ready', 'Sincronizado.');
    } catch (e) {
      // Não trava: mostra causa provável e permite "Tentar novamente"
      setStatus('error', friendlyFirestore(e));
    }
  }

  // Reexecuta a sincronização para o usuário logado (usado pelo botão "Tentar novamente")
  async function retry() {
    if (!S.fb || !S.fb.auth || !S.fb.auth.currentUser) return;
    await startForUser(S.fb.auth.currentUser);
  }

  // Modal com duas opções explícitas (Promise<boolean> — true = usar nuvem)
  function chooseReconciliation() {
    return new Promise(function (resolve) {
      const body = U.el('div', { class: 'modal-body' }, [
        U.el('p', { class: 'confirm-text', text:
          'A nuvem já contém dados sincronizados e este aparelho também tem ' +
          'lançamentos. Qual versão você quer manter?' }),
        U.el('p', { class: 'muted small', text:
          'Dica: faça um backup (Exportar) antes, por segurança.' })
      ]);
      global.UI.openModal('Sincronizar dados', body, {
        buttons: [
          { label: 'Enviar deste aparelho', variant: 'ghost',
            onClick: function (close) { close(); resolve(false); } },
          { label: 'Usar dados da nuvem', variant: 'primary',
            onClick: function (close) { close(); resolve(true); } }
        ]
      });
    });
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
    login: login, register: register, logout: logout, retry: retry,
    notifyLocalChange: notifyLocalChange
  };
})(window);
