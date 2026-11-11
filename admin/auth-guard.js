// admin/auth-guard.js
// ─────────────────────────────────────────────────────────────
// AUTH GUARD — Supabase Auth + Role "admin"
//
// REQUISITOS NO SUPABASE:
//   1. Supabase Auth ativo (Email/Password provider habilitado)
//   2. Tabela `profiles` com colunas:
//        id   uuid references auth.users(id) primary key
//        role text not null default 'user'
//   3. RLS na tabela profiles:
//        CREATE POLICY "Leitura própria" ON profiles
//          FOR SELECT USING (auth.uid() = id);
//   4. O admin deve ter profiles.role = 'admin'
//
// USO NAS PÁGINAS PROTEGIDAS:
//   <!-- Supabase SDK deve vir antes de config.js e auth-guard.js -->
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="config.js"></script>
//   <script src="auth-guard.js"></script>
//
//   Então, no DOMContentLoaded da página:
//     const ok = await guardAdminPage();
//     if (!ok) return; // já redirecionou para login.html
//     // continua a inicialização normal
//
// SEGURANÇA:
//   ✅ Sessão validada server-side pelo Supabase (JWT)
//   ✅ Role verificado via SELECT na tabela profiles (server-side RLS)
//   ✅ CSS/hidden não são a proteção — o body só é revelado após ok
//   ✅ Sem hardcode de senhas ou credenciais
// ─────────────────────────────────────────────────────────────

(function () {
    'use strict';

    // ── Constantes internas ───────────────────────────────────────
    // Resolvido a partir da pasta deste script (funciona também em /uploads/)
    const LOGIN_URL         = new URL('login.html', (document.currentScript && document.currentScript.src) || window.location.href).href;
    const ROLE_REQUIRED     = 'admin';
    const PROFILES_TABLE    = 'profiles';
    const ROLE_COLUMN       = 'role';

    // ── Singleton do cliente Supabase ─────────────────────────────
    let _client = null;

    /**
     * Cria (ou retorna) o cliente Supabase usando SUPABASE_CONFIG
     * definido em config.js (carregado antes deste script).
     */
    function _getClient() {
        if (_client) return _client;

        if (typeof SUPABASE_CONFIG === 'undefined') {
            console.error('[auth-guard] SUPABASE_CONFIG não encontrado. Inclua config.js antes de auth-guard.js.');
            return null;
        }
        if (!window.supabase) {
            console.error('[auth-guard] SDK do Supabase não carregado.');
            return null;
        }

        _client = window.supabase.createClient(
            SUPABASE_CONFIG.url,
            SUPABASE_CONFIG.anonKey
        );

        // Expõe o cliente para outros scripts da mesma página
        // (admin-script.js usa window._supabaseClient)
        window._supabaseClient = _client;

        return _client;
    }

    /**
     * Redireciona para a página de login, preservando a URL atual
     * como parâmetro `redirect` para retorno pós-login.
     */
    function _redirectToLogin() {
        const current = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`${LOGIN_URL}?redirect=${current}`);
    }

    /**
     * guardAdminPage()
     *
     * Deve ser chamado com `await` no DOMContentLoaded de cada
     * página protegida do painel.
     *
     * Fluxo:
     *   1. Obtém sessão ativa do Supabase Auth (JWT verificado server-side)
     *   2. Busca o perfil do usuário na tabela `profiles`
     *   3. Verifica se profiles.role === 'admin'
     *   4. Retorna true (admin confirmado) ou redireciona para login
     *
     * @returns {Promise<boolean>}
     */
    async function guardAdminPage() {
        const sb = _getClient();
        if (!sb) {
            _redirectToLogin();
            return false;
        }

        try {
            // ── 1. Sessão Supabase Auth ───────────────────────────
            const { data: { session }, error: sessionErr } = await sb.auth.getSession();

            if (sessionErr || !session) {
                _redirectToLogin();
                return false;
            }

            // ── 2. Verifica role na tabela profiles ───────────────
            //    A política RLS garante que só o próprio usuário lê
            //    seu registro — o SELECT só retorna dados se autenticado.
            const { data: profile, error: profileErr } = await sb
                .from(PROFILES_TABLE)
                .select(ROLE_COLUMN)
                .eq('id', session.user.id)
                .single();

            if (profileErr || !profile) {
                console.warn('[auth-guard] Perfil não encontrado para uid:', session.user.id);
                _redirectToLogin();
                return false;
            }

            // ── 3. Checa role ─────────────────────────────────────
            if (profile[ROLE_COLUMN] !== ROLE_REQUIRED) {
                console.warn('[auth-guard] Acesso negado — role:', profile[ROLE_COLUMN]);
                _redirectToLogin();
                return false;
            }

            // ── 4. OK — expõe o usuário para outros scripts ───────
            window._adminUser = {
                id:    session.user.id,
                email: session.user.email,
                nome:  (session.user.user_metadata && session.user.user_metadata.display_name) || null,
                role:  profile[ROLE_COLUMN],
            };

            return true;

        } catch (err) {
            console.error('[auth-guard] Erro inesperado:', err);
            _redirectToLogin();
            return false;
        }
    }

    /**
     * confirmLogout()
     *
     * Encerra a sessão Supabase e redireciona para o login.
     * Exportado globalmente para uso em botões de sair.
     */
    async function confirmLogout() {
        const sb = _getClient();
        if (sb) {
            await sb.auth.signOut().catch(() => {});
        }
        // Limpa quaisquer dados de exibição residuais (não-sensíveis)
        sessionStorage.clear();
        window.location.replace(LOGIN_URL);
    }

    // ── Exports globais ───────────────────────────────────────────
    window.guardAdminPage = guardAdminPage;
    window.confirmLogout  = confirmLogout;

})();