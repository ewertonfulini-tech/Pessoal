# ☁️ Sincronização entre celular e computador

Por padrão o app guarda tudo **só no navegador** de cada aparelho. Se você quer
que os lançamentos apareçam **automaticamente no celular e no computador**, ative
a sincronização na nuvem usando o **Firebase** (plano gratuito do Google).

> ⚠️ A sincronização precisa de internet e **não funciona no link do Artifact**
> (claude.ai bloqueia acesso à rede). Use o app pelo **GitHub Pages** (veja o
> final deste guia) ou por qualquer hospedagem comum.

---

## Parte 1 — Criar o projeto no Firebase (uma vez só, ~5 min)

1. Acesse **https://console.firebase.google.com** e faça login com sua conta Google.
2. Clique em **“Adicionar projeto”** (Add project). Dê um nome (ex: `meu-gestor`).
   Pode desativar o Google Analytics — não é necessário.
3. Com o projeto criado, no menu à esquerda vá em **Build → Authentication**:
   - Clique em **Get started**.
   - Na aba **Sign-in method**, habilite **Email/Password** e salve.
4. Ainda no menu, vá em **Build → Firestore Database**:
   - Clique em **Create database**.
   - Escolha o modo **Production** e uma região (ex: `southamerica-east1`).
   - Depois abra a aba **Rules** e cole exatamente estas regras (garante que só
     você acessa seus dados) e clique em **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /vaults/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

5. Agora pegue as credenciais do app web:
   - Clique na **engrenagem ⚙ → Project settings**.
   - Role até **Your apps** e clique no ícone **`</>`** (Web).
   - Dê um apelido (ex: `web`) e clique em **Register app**.
   - O Firebase vai mostrar um trecho com **`const firebaseConfig = { ... }`**.
     **Copie esse bloco inteiro** — é o que você vai colar no app.

---

## Parte 2 — Ativar no app

1. Abra o app e vá em **Configurações → Sincronização na nuvem**.
2. **Cole** o bloco `firebaseConfig` que você copiou e clique em **Conectar**.
3. Digite um **e-mail e senha** (mínimo 6 caracteres) e clique em **Criar conta**.
   - Esse e-mail/senha é seu, do app — não precisa ser um e-mail real de verdade,
     mas use algo que você lembre.
4. Pronto! No **outro aparelho**, faça o mesmo (colar o `firebaseConfig` e
   **Entrar** com o **mesmo e-mail e senha**). A partir daí, tudo que você lançar
   em um aparelho aparece no outro automaticamente. ✨

> Na primeira vez que você conecta um aparelho que já tinha dados, o app pergunta
> se deve **usar os dados da nuvem** ou **enviar os deste aparelho**. Faça um
> backup (Configurações → Exportar) antes, por segurança.

---

## Parte 3 — Hospedar no GitHub Pages (link grátis para acessar de qualquer lugar)

1. No GitHub, abra o repositório **Pessoal** → aba **Settings**.
2. No menu lateral, clique em **Pages**.
3. Em **Source**, escolha **Deploy from a branch**.
4. Em **Branch**, selecione **`claude/personal-expense-manager-9kxe4l`** e a
   pasta **`/ (root)`**. Clique em **Save**.
5. Aguarde ~1 minuto. O GitHub mostra o endereço, algo como:
   **`https://ewertonfulini-tech.github.io/Pessoal/`**
6. Abra esse link no computador e no celular (dá para “adicionar à tela inicial”
   no celular e usar como um app).

### Importante: autorizar o domínio no Firebase
Para o login funcionar no GitHub Pages, adicione o domínio nas configurações do
Firebase:
- **Authentication → Settings → Authorized domains → Add domain** e inclua
  **`ewertonfulini-tech.github.io`**.
- (`localhost` já vem autorizado, útil para testes.)

---

## Perguntas comuns

**Precisa pagar?** Não. O plano gratuito do Firebase (Spark) é mais que suficiente
para uso pessoal.

**Meus dados ficam seguros?** Sim. As regras acima garantem que somente a sua
conta logada lê e grava os seus dados. As credenciais `firebaseConfig` são
públicas por natureza (isso é normal em apps web) — a segurança vem do login +
das regras do Firestore.

**Funciona offline?** Sim. O app continua funcionando sem internet e sincroniza
assim que a conexão voltar.

**Quero desligar a sincronização.** Em Configurações → Sincronização, use
**Sair da conta** ou **Remover configuração**. Os dados locais permanecem.
