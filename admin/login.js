(function () {
    'use strict';

    // ── Configurações locais ──────────────────────────────────────
    const CFG = Object.freeze({
        ADMIN_URL:        'index.html',
        LOGO_BUCKET:      'imagens',
        ROLE_REQUIRED:    'admin',
        // Página de nova senha na mesma pasta do login (funciona em qualquer domínio)
        RESET_REDIRECT:   new URL('reset-password.html', window.location.href).href,
    });

    // ── Cliente Supabase (singleton) ──────────────────────────────
    let _sb = null;

    function _getClient() {
        if (_sb) return _sb;
        if (typeof SUPABASE_CONFIG === 'undefined' || !window.supabase) {
            console.error('[login.js] SUPABASE_CONFIG ou SDK não encontrado.');
            return null;
        }
        _sb = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
        return _sb;
    }

    // ── Referências da UI ─────────────────────────────────────────
    const ui = {
        get form()          { return document.getElementById('loginForm'); },
        get emailInput()    { return document.getElementById('username'); },   
        get passwordInput() { return document.getElementById('password'); },
        get togglePwBtn()   { return document.getElementById('togglePassword'); },
        get loginBtn()      { return document.getElementById('loginBtn'); },
        get btnLabel()      { return document.getElementById('loginBtnLabel'); },
        get btnSpinner()    { return document.getElementById('loginBtnSpinner'); },
        get errorBanner()   { return document.getElementById('loginErrorBanner'); },
        get errorText()     { return document.getElementById('loginErrorText'); },
        get fieldEmail()    { return document.getElementById('fieldUsername'); },
        get fieldPassword() { return document.getElementById('fieldPassword'); },
        get emailError()    { return document.getElementById('usernameError'); },
        get passwordError() { return document.getElementById('passwordError'); },
    };

    // ── Helpers de UI ─────────────────────────────────────────────
    function _setFieldError(fieldEl, errorEl, msg) {
        if (!fieldEl || !errorEl) return;
        if (msg) {
            fieldEl.classList.add('has-error');
            errorEl.textContent = msg;
            errorEl.classList.add('visible');
        } else {
            fieldEl.classList.remove('has-error');
            errorEl.textContent = '';
            errorEl.classList.remove('visible');
        }
    }

    function _clearErrors() {
        _setFieldError(ui.fieldEmail,    ui.emailError,    '');
        _setFieldError(ui.fieldPassword, ui.passwordError, '');
    }

    function _showBanner(msg, isSuccess = false) {
        if (!ui.errorBanner || !ui.errorText) return;
        ui.errorText.textContent = msg;
        ui.errorBanner.removeAttribute('hidden');
        
        if(isSuccess) {
            ui.errorBanner.style.background = '#f0fdf4';
            ui.errorBanner.style.borderColor = '#86efac';
            ui.errorBanner.style.color = '#166534';
            ui.errorBanner.querySelector('i').className = 'fas fa-check-circle';
        } else {
            ui.errorBanner.style.background = '';
            ui.errorBanner.style.borderColor = '';
            ui.errorBanner.style.color = '';
            ui.errorBanner.querySelector('i').className = 'fas fa-exclamation-circle';
            // Re-anima o shake
            ui.errorBanner.style.animation = 'none';
            void ui.errorBanner.offsetWidth;
            ui.errorBanner.style.animation = '';
        }
        
        clearTimeout(_showBanner._t);
        _showBanner._t = setTimeout(() => ui.errorBanner?.setAttribute('hidden', ''), 7000);
    }

    function _hideBanner() {
        ui.errorBanner?.setAttribute('hidden', '');
    }

    function _setLoading(loading) {
        if (!ui.loginBtn) return;
        ui.loginBtn.disabled = loading;
        ui.loginBtn.classList.toggle('loading', loading);
        if (ui.btnLabel)   ui.btnLabel.textContent = loading ? 'Verificando…' : 'Entrar';
        if (ui.btnSpinner) loading ? ui.btnSpinner.removeAttribute('hidden') : ui.btnSpinner.setAttribute('hidden', '');
    }

    // ── Logo instantânea direto do Bucket ─────────────────────────
    function _loadLogosDireto() {
        if (typeof SUPABASE_CONFIG === 'undefined') return;

        const box = document.getElementById('logoBox');
        
        const baseUrl = `${SUPABASE_CONFIG.url}/storage/v1/object/public/${CFG.LOGO_BUCKET}/site`;
        const logoUrl = `${baseUrl}/AcrilifeLogoCompleta.png`;
        const faviconUrl = `${baseUrl}/AcrilifeLogo.png`;

        // Coloca a Logo no Painel
        if (box) {
            box.innerHTML = `<img src="${logoUrl}" alt="Acrilife" onerror="this.outerHTML='<i class=\\'fas fa-gem logo-fallback-icon\\'></i>'">`;
        }

        // Coloca os Favicons
        const f1 = document.getElementById('dynamic-favicon');
        const f2 = document.getElementById('dynamic-apple-icon');
        if(f1) f1.href = faviconUrl;
        if(f2) f2.href = faviconUrl;
    }

    // Volta para a página que pediu login (?redirect=), apenas caminhos do próprio site
    function _destinoPosLogin() {
        const r = new URLSearchParams(window.location.search).get('redirect');
        if (r && /^\/(?![\/\\])/.test(r) && !/login\.html/.test(r)) return r;
        return CFG.ADMIN_URL;
    }

    // ── Sessão existente ──────────────────────────────────────────
    async function _checkExistingSession() {
        const sb = _getClient();
        if (!sb) return false;
        try {
            const { data: { session } } = await sb.auth.getSession();
            if (!session) return false;
            // Só pula o login se a sessão for de um administrador
            // (antes: sessão sem perfil admin causava loop login <-> painel)
            const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
            if (profile?.role === CFG.ROLE_REQUIRED) return true;
            await sb.auth.signOut().catch(() => {});
            return false;
        } catch {
            return false;
        }
    }

    // ── Fluxo de login ────────────────────────────────────────────
    function _validate() {
        _clearErrors();
        const email    = ui.emailInput?.value.trim()  ?? '';
        const password = ui.passwordInput?.value       ?? '';
        let valid = true;

        if (!email) {
            _setFieldError(ui.fieldEmail, ui.emailError, 'Informe o e-mail.');
            ui.emailInput?.focus();
            valid = false;
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            _setFieldError(ui.fieldEmail, ui.emailError, 'E-mail inválido.');
            ui.emailInput?.focus();
            valid = false;
        }

        if (!password) {
            _setFieldError(ui.fieldPassword, ui.passwordError, 'Informe a senha.');
            if (valid) ui.passwordInput?.focus();
            valid = false;
        }

        return { valid, email, password };
    }

    async function _performLogin() {
        _hideBanner();

        const { valid, email, password } = _validate();
        if (!valid) return;

        _setLoading(true);

        try {
            const sb = _getClient();
            if (!sb) throw new Error('Serviço indisponível. Tente novamente.');

            const { data, error: authErr } = await sb.auth.signInWithPassword({ email, password });

            if (authErr) {
                _setFieldError(ui.fieldPassword, ui.passwordError, 'E-mail ou senha incorretos.');
                _showBanner('Credenciais inválidas. Verifique e tente novamente.');
                ui.passwordInput?.select();
                return;
            }

            const { data: profile, error: profileErr } = await sb.from('profiles').select('role').eq('id', data.user.id).single();

            if (profileErr || !profile || profile.role !== CFG.ROLE_REQUIRED) {
                await sb.auth.signOut().catch(() => {});
                _showBanner('Acesso restrito a administradores.');
                return;
            }

            if (ui.btnLabel) ui.btnLabel.textContent = 'Redirecionando…';
            setTimeout(() => window.location.replace(_destinoPosLogin()), 200);

        } catch (err) {
            _showBanner(err.message || 'Erro inesperado. Tente novamente.');
        } finally {
            if (document.getElementById('loginBtn')) _setLoading(false);
        }
    }

    async function _solicitarReset() {
        const email = ui.emailInput?.value.trim() ?? '';

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            _setFieldError(ui.fieldEmail, ui.emailError, 'Digite seu e-mail acima primeiro.');
            ui.emailInput?.focus();
            return;
        }

        const btn = document.getElementById('btnEsqueceuSenha');
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }

        try {
            const sb = _getClient();
            if (!sb) throw new Error('Serviço indisponível.');

            const { error } = await sb.auth.resetPasswordForEmail(email, {
                redirectTo: CFG.RESET_REDIRECT
            });

            if (error) throw error;
            _showBanner(`Link enviado para ${email}. Verifique sua caixa de entrada.`, true);

        } catch (err) {
            _showBanner(err.message || 'Erro ao enviar. Tente novamente.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Esqueceu a senha?'; }
        }
    }

    // ── Toggle senha e Helpers ──────────────────────────────────────────────
    function _setupPasswordToggle() {
        const btn   = ui.togglePwBtn;
        const input = ui.passwordInput;
        if (!btn || !input) return;
        btn.addEventListener('click', () => {
            const hidden = input.type === 'password';
            input.type   = hidden ? 'text' : 'password';
            const icon   = btn.querySelector('i');
            if (icon) icon.className = hidden ? 'fas fa-eye-slash' : 'fas fa-eye';
            btn.setAttribute('aria-label', hidden ? 'Ocultar senha' : 'Mostrar senha');
        });
    }

    function _setupClearOnInput() {
        ui.emailInput?.addEventListener('input', () => { _setFieldError(ui.fieldEmail, ui.emailError, ''); _hideBanner(); });
        ui.passwordInput?.addEventListener('input', () => { _setFieldError(ui.fieldPassword, ui.passwordError, ''); _hideBanner(); });
    }

    // ── Inicialização ─────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        if (await _checkExistingSession()) {
            window.location.replace(_destinoPosLogin());
            return;
        }

        _loadLogosDireto(); // Carrega a logo da sua empresa direto do storage
        const linkSite = document.querySelector('.form-footer__link');
        if (linkSite && window.ACRILIFE_SITE_URL) linkSite.href = window.ACRILIFE_SITE_URL;
        _setupPasswordToggle();
        _setupClearOnInput();

        ui.form?.addEventListener('submit', e => { e.preventDefault(); _performLogin(); });
        [ui.emailInput, ui.passwordInput].forEach(input => {
            input?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); _performLogin(); } });
        });

        ui.emailInput?.focus();
        document.getElementById('btnEsqueceuSenha')?.addEventListener('click', _solicitarReset);
    });

})();