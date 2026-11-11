'use strict';
/* =============================================================
   cookies.js — consentimento de cookies (LGPD)
   - Google Analytics / Google Ads só são liberados após o aceite
     (Google Consent Mode v2: o padrão "denied" é definido no <head>).
   - A escolha fica salva no navegador e pode ser alterada pelo link
     "Preferências de cookies" no rodapé.
   ============================================================= */
(function () {
    const CHAVE = 'acrilife_consentimento';
    const VERSAO = 1;

    function lerConsentimento() {
        try {
            const c = JSON.parse(localStorage.getItem(CHAVE));
            return c && c.v === VERSAO ? c : null;
        } catch { return null; }
    }

    function aplicar(c) {
        if (typeof window.gtag !== 'function') return;
        window.gtag('consent', 'update', {
            analytics_storage:  c.analytics ? 'granted' : 'denied',
            ad_storage:         c.marketing ? 'granted' : 'denied',
            ad_user_data:       c.marketing ? 'granted' : 'denied',
            ad_personalization: c.marketing ? 'granted' : 'denied'
        });
    }

    function salvar(analytics, marketing) {
        const c = { v: VERSAO, analytics: !!analytics, marketing: !!marketing, data: new Date().toISOString() };
        try { localStorage.setItem(CHAVE, JSON.stringify(c)); } catch { /* navegação privada */ }
        aplicar(c);
        fechar();
    }

    let banner;
    function criarBanner() {
        banner = document.createElement('section');
        banner.className = 'cookie-banner';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-live', 'polite');
        banner.setAttribute('aria-label', 'Preferências de cookies');
        banner.innerHTML = `
            <div class="cookie-texto">
                <h2><span aria-hidden="true">🍪</span> Sua privacidade</h2>
                <p>Usamos cookies essenciais e, com sua permissão, cookies de estatística e anúncios.
                   <a href="privacidade.html#cookies">Saiba mais</a>.</p>
            </div>
            <div class="cookie-opcoes" hidden>
                <label class="cookie-opcao"><input type="checkbox" checked disabled>
                    <div><strong>Essenciais</strong><span>Necessários para o site funcionar (ex.: guardar sua escolha e o catálogo em cache). Sempre ativos.</span></div></label>
                <label class="cookie-opcao"><input type="checkbox" id="cookie-analytics">
                    <div><strong>Estatísticas</strong><span>Google Analytics: entender quais páginas são mais visitadas, de forma agregada.</span></div></label>
                <label class="cookie-opcao"><input type="checkbox" id="cookie-marketing">
                    <div><strong>Marketing</strong><span>Google Ads: medir resultados de anúncios e exibir anúncios mais relevantes.</span></div></label>
            </div>
            <div class="cookie-acoes">
                <button type="button" class="cookie-btn" data-acao="personalizar">Personalizar</button>
                <button type="button" class="cookie-btn" data-acao="recusar">Recusar opcionais</button>
                <button type="button" class="cookie-btn cookie-btn--primario" data-acao="aceitar">Aceitar todos</button>
            </div>`;
        banner.addEventListener('click', e => {
            const b = e.target.closest('[data-acao]'); if (!b) return;
            const acao = b.dataset.acao;
            if (acao === 'aceitar') salvar(true, true);
            if (acao === 'recusar') salvar(false, false);
            if (acao === 'personalizar') {
                banner.querySelector('.cookie-opcoes').hidden = false;
                b.dataset.acao = 'salvar';
                b.textContent = 'Salvar escolhas';
            } else if (acao === 'salvar') {
                salvar(banner.querySelector('#cookie-analytics').checked, banner.querySelector('#cookie-marketing').checked);
            }
        });
        document.body.appendChild(banner);
    }

    function abrir(personalizar) {
        if (!banner) criarBanner();
        const atual = lerConsentimento();
        banner.querySelector('#cookie-analytics').checked = !!atual?.analytics;
        banner.querySelector('#cookie-marketing').checked = !!atual?.marketing;
        banner.hidden = false;
        if (personalizar) banner.querySelector('[data-acao="personalizar"]')?.click();
    }

    function fechar() { if (banner) banner.hidden = true; }

    document.addEventListener('click', e => {
        if (e.target.closest('[data-abrir-cookies]')) { e.preventDefault(); abrir(true); }
    });

    document.addEventListener('DOMContentLoaded', () => {
        if (!lerConsentimento()) abrir(false);
    });

    window.AcrilifeCookies = { abrir, lerConsentimento };
})();
