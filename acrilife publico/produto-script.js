'use strict';

// ==========================================
// CONFIGURAÇÕES E ESTADO DO PRODUTO
// ==========================================
const CONFIG = {
    URL: 'https://svirnutlsmybvvuyctak.supabase.co',
    // anon key: pública por design; a proteção real é o RLS no Supabase
    KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2aXJudXRsc215YnZ2dXljdGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTExNjYsImV4cCI6MjA4NjA2NzE2Nn0.zLuvrf78CaQsPYzXf-E5WcTuyaQS3fzcaj8DDFb_e6A',
    BUCKET: 'imagens'
};

const STATE = {
    sb: null,
    produto: null,
    categoria: null,
    relacionados: [],
    imagensUrls: [],
    imagemAtual: 0,
    configSite: {}
};

// ==========================================
// UTILITÁRIOS
// ==========================================
const getUrl = path => {
    if (!path || typeof path !== 'string') return '';
    if (/^(https?:|data:)/.test(path)) return path;
    return `${CONFIG.URL}/storage/v1/object/public/${CONFIG.BUCKET}/${path}`;
};
const esc = (str = '') => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatarDescricao = texto => esc(texto).replace(/\n/g, '<br>');
const fmtBRL = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#eef2f7"/><path d="M150 250l40-50 30 35 25-30 55 45z" fill="#c5d0de"/><circle cx="165" cy="160" r="20" fill="#c5d0de"/></svg>');

function listaImagens(p) {
    let imgs = [];
    if (Array.isArray(p.imagens)) imgs = p.imagens;
    else if (typeof p.imagens === 'string' && p.imagens) {
        try { imgs = JSON.parse(p.imagens); } catch { imgs = [p.imagens]; }
    }
    if (!imgs.length && p.imagem_principal) imgs = [p.imagem_principal];
    return imgs.filter(Boolean);
}

function precoHTML(p, grande = false) {
    if (p.sob_consulta || !Number(p.preco)) {
        return `<span class="preco-consulta${grande ? ' preco-consulta--grande' : ''}">Preço sob consulta</span>`;
    }
    return fmtBRL(p.preco);
}

function setMeta(prop, content, attr = 'property') {
    let el = document.querySelector(`meta[${attr}="${prop}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute(attr, prop); document.head.appendChild(el); }
    el.setAttribute('content', content);
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('ano-atual').textContent = new Date().getFullYear();
    carregarLogos();
    setupHamburger();

    // Aceita ?id=... e também /produto/ID (URL amigável)
    const params = new URLSearchParams(window.location.search);
    const produtoId = params.get('id') || (location.pathname.match(/\/produto\/([^/]+)/) || [])[1];
    if (!produtoId) { window.location.href = 'index.html#galeria'; return; }

    if (!window.supabase) return showError('Não foi possível conectar. Verifique sua internet e tente novamente.');
    STATE.sb = window.supabase.createClient(CONFIG.URL, CONFIG.KEY, { auth: { persistSession: false } });

    try {
        const [config, produtoRes] = await Promise.all([
            STATE.sb.from('config_site').select('*').eq('id', 'site_config').maybeSingle(),
            STATE.sb.from('produtos').select('*').eq('id', produtoId).eq('ativo', true).maybeSingle()
        ]);

        STATE.configSite = config.data || {};
        STATE.produto = produtoRes.data;
        aplicarConfiguracoes(STATE.configSite);

        if (!STATE.produto) return showError('Este produto não existe ou foi removido.');

        const p = STATE.produto;
        if (p.categoria_id) {
            const [catRes, relRes] = await Promise.all([
                STATE.sb.from('categorias').select('id,nome').eq('id', p.categoria_id).maybeSingle(),
                STATE.sb.from('produtos')
                    .select('id,nome,preco,sob_consulta,imagens,imagem_principal')
                    .eq('categoria_id', p.categoria_id).eq('ativo', true).neq('id', p.id).limit(4)
            ]);
            STATE.categoria = catRes.data;
            STATE.relacionados = relRes.data || [];
        }

        // Completa com outros produtos se a categoria tiver poucos
        if (STATE.relacionados.length < 4) {
            const ids = [p.id, ...STATE.relacionados.map(r => r.id)];
            const { data } = await STATE.sb.from('produtos')
                .select('id,nome,preco,sob_consulta,imagens,imagem_principal')
                .eq('ativo', true).not('id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`)
                .order('created_at', { ascending: false }).limit(4 - STATE.relacionados.length);
            STATE.relacionados.push(...(data || []));
        }

        atualizarSEO(p);
        renderProduto();
        renderRelacionados();
    } catch (err) {
        console.error(err);
        showError('Não foi possível carregar o produto agora. Tente novamente em instantes.');
    }
});

// ==========================================
// LOGOS E CONFIGURAÇÕES
// ==========================================
function carregarLogos() {
    const faviconUrl = getUrl('site/AcrilifeLogo.png');
    document.querySelectorAll('link[rel*="icon"]').forEach(el => el.href = faviconUrl);

    const wrapper = document.getElementById('logo-imagem-wrapper');
    if (!wrapper) return;
    const img = new Image();
    img.className = 'logo-img';
    img.alt = 'AcriLife';
    img.onload = () => wrapper.classList.add('logo-imagem-wrapper--visivel');
    img.onerror = () => { const f = document.getElementById('logo-fallback'); if (f) f.style.display = 'flex'; img.remove(); };
    img.src = getUrl('site/AcrilifeLogoCompleta.png');
    wrapper.appendChild(img);
}

function whatsappLink(msg) {
    const num = (STATE.configSite.whatsapp || '').replace(/\D/g, '');
    return num ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}` : 'index.html#contato';
}

function aplicarConfiguracoes(cfg) {
    const wpLink = whatsappLink('Olá! Vim pelo site e gostaria de um orçamento.');
    const floatWp = document.getElementById('whatsapp-float');
    if (floatWp) floatWp.href = wpLink;

    const redes = cfg.redes_sociais || {};
    document.querySelectorAll('#social-links a').forEach(a => {
        const lbl = (a.getAttribute('aria-label') || '').toLowerCase();
        if (lbl === 'whatsapp') a.href = wpLink;
        else if (redes[lbl]) a.href = redes[lbl];
        else a.hidden = true;
    });

    const hor = Array.isArray(cfg.horario_funcionamento) ? cfg.horario_funcionamento : [];
    const fc = document.getElementById('footer-contato');
    if (fc) fc.innerHTML = `
        ${hor[0] ? `<p><i class="fas fa-clock"></i> ${esc(hor[0].dia)}: ${esc(hor[0].horario)}</p>` : ''}
        ${cfg.telefone ? `<p><i class="fas fa-phone"></i> ${esc(cfg.telefone)}</p>` : ''}
        ${cfg.email ? `<p><i class="fas fa-envelope"></i> ${esc(cfg.email)}</p>` : ''}
        ${cfg.cidade ? `<p><i class="fas fa-map-marker-alt"></i> ${esc(cfg.cidade)}</p>` : ''}`;
}

function atualizarSEO(p) {
    const desc = (p.descricao_simples || p.descricao || 'Produto em acrílico personalizado AcriLife.').slice(0, 160);
    const img = getUrl(listaImagens(p)[0]);
    document.title = `${p.nome} | AcriLife`;
    setMeta('description', desc, 'name');
    setMeta('og:title', `${p.nome} | AcriLife`);
    setMeta('og:description', desc);
    setMeta('og:type', 'product');
    if (img) setMeta('og:image', img);

    // Dados estruturados (Google)
    const ld = {
        '@context': 'https://schema.org', '@type': 'Product',
        name: p.nome, description: desc, sku: p.codigo || String(p.id),
        image: listaImagens(p).map(getUrl), brand: { '@type': 'Brand', name: 'AcriLife' }
    };
    if (!p.sob_consulta && Number(p.preco)) {
        ld.offers = { '@type': 'Offer', priceCurrency: 'BRL', price: Number(p.preco).toFixed(2), availability: 'https://schema.org/InStock' };
    }
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
}

// ==========================================
// RENDERIZAÇÃO DO PRODUTO
// ==========================================
function renderProduto() {
    const p = STATE.produto;
    STATE.imagensUrls = listaImagens(p).map(getUrl);
    const total = STATE.imagensUrls.length;
    const imgPrincipal = STATE.imagensUrls[0] || PLACEHOLDER;

    const miniaturasHtml = total > 1 ? `
        <div class="produto-miniaturas" role="tablist" aria-label="Fotos do produto">
            ${STATE.imagensUrls.map((img, i) => `
                <button type="button" class="produto-miniatura-wrapper ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Foto ${i + 1}">
                    <img src="${esc(img)}" class="produto-miniatura" alt="" loading="lazy">
                </button>`).join('')}
        </div>` : '';

    const setas = total > 1 ? `
        <button type="button" class="galeria-seta galeria-seta--prev" data-dir="-1" aria-label="Foto anterior"><i class="fas fa-chevron-left"></i></button>
        <button type="button" class="galeria-seta galeria-seta--next" data-dir="1" aria-label="Próxima foto"><i class="fas fa-chevron-right"></i></button>
        <span class="galeria-contador" id="galeria-contador">1 / ${total}</span>` : '';

    const ident = p.codigo || p.id;
    const zapLink = whatsappLink(`Olá! Gostaria de um orçamento para o produto: ${p.nome} (Ref: ${ident})\n${location.href}`);
    const cat = STATE.categoria;

    document.getElementById('produto-container').innerHTML = `
        <nav class="breadcrumb" aria-label="Você está em">
            <a href="index.html">Início</a><i class="fas fa-chevron-right"></i>
            ${cat ? `<a href="index.html?categoria=${encodeURIComponent(cat.id)}#galeria">${esc(cat.nome)}</a><i class="fas fa-chevron-right"></i>` : ''}
            <span aria-current="page">${esc(p.nome)}</span>
        </nav>
        <div class="produto-container">
            <div class="produto-imagens">
                <div class="produto-imagens-principal">
                    <img src="${esc(imgPrincipal)}" alt="${esc(p.nome)}" id="produto-img-principal" class="produto-img-principal" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
                    ${setas}
                    <button type="button" class="galeria-zoom" id="galeria-zoom" aria-label="Ampliar foto"><i class="fas fa-expand"></i></button>
                </div>
                ${miniaturasHtml}
            </div>

            <div class="produto-info">
                ${cat ? `<span class="produto-categoria-tag">${esc(cat.nome)}</span>` : ''}
                <h1>${esc(p.nome)}</h1>
                ${p.codigo ? `<div class="produto-codigo"><strong>Código:</strong> ${esc(p.codigo)}</div>` : ''}

                <div class="produto-preco">${precoHTML(p, true)}</div>

                ${p.descricao_simples ? `
                <div class="produto-descricao-simples">
                    <h3>Descrição</h3>
                    <div class="produto-descricao">${formatarDescricao(p.descricao_simples)}</div>
                </div>` : ''}

                <ul class="produto-garantias">
                    <li><i class="fas fa-ruler-combined"></i> Feito sob medida para o seu projeto</li>
                    <li><i class="fas fa-award"></i> Acrílico de primeira linha</li>
                    <li><i class="fas fa-comments"></i> Orçamento rápido e sem compromisso</li>
                </ul>

                <div class="produto-acoes">
                    <a href="${esc(zapLink)}" target="_blank" rel="noopener" class="btn-whatsapp-large">
                        <i class="fab fa-whatsapp"></i> Solicitar Orçamento
                    </a>
                    <button type="button" class="btn-compartilhar" id="btn-compartilhar"><i class="fas fa-share-alt"></i> Compartilhar</button>
                </div>
            </div>

            ${p.descricao ? `
            <div class="produto-descricao-wrapper">
                <h3>Detalhes do Produto</h3>
                <div class="produto-descricao">${formatarDescricao(p.descricao)}</div>
            </div>` : ''}
        </div>`;

    setupGaleria();
}

function mudarImagem(index) {
    const total = STATE.imagensUrls.length;
    if (!total) return;
    STATE.imagemAtual = (index + total) % total;
    const url = STATE.imagensUrls[STATE.imagemAtual];
    const img = document.getElementById('produto-img-principal');
    if (img) { img.classList.add('trocando'); img.src = url; img.onload = () => img.classList.remove('trocando'); }
    document.querySelectorAll('.produto-miniatura-wrapper').forEach((w, i) => w.classList.toggle('active', i === STATE.imagemAtual));
    document.querySelector('.produto-miniatura-wrapper.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    const cont = document.getElementById('galeria-contador');
    if (cont) cont.textContent = `${STATE.imagemAtual + 1} / ${total}`;
    const lb = document.getElementById('lightbox-img');
    if (lb) lb.src = url;
}
window.mudarImagem = mudarImagem;

function setupGaleria() {
    const box = document.querySelector('.produto-imagens');
    box?.addEventListener('click', e => {
        const mini = e.target.closest('.produto-miniatura-wrapper');
        if (mini) return mudarImagem(Number(mini.dataset.index));
        const seta = e.target.closest('.galeria-seta');
        if (seta) return mudarImagem(STATE.imagemAtual + Number(seta.dataset.dir));
        if (e.target.closest('#galeria-zoom') || e.target.id === 'produto-img-principal') abrirLightbox();
    });

    // Swipe no celular
    const principal = document.querySelector('.produto-imagens-principal');
    let x0 = null;
    principal?.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
    principal?.addEventListener('touchend', e => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        if (Math.abs(dx) > 40) mudarImagem(STATE.imagemAtual + (dx < 0 ? 1 : -1));
        x0 = null;
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') mudarImagem(STATE.imagemAtual + 1);
        if (e.key === 'ArrowLeft') mudarImagem(STATE.imagemAtual - 1);
        if (e.key === 'Escape') fecharLightbox();
    });

    document.getElementById('btn-compartilhar')?.addEventListener('click', async () => {
        const dados = { title: STATE.produto.nome, text: `${STATE.produto.nome} — AcriLife`, url: location.href };
        try {
            if (navigator.share) await navigator.share(dados);
            else { await navigator.clipboard.writeText(location.href); avisar('Link copiado!'); }
        } catch { /* cancelado */ }
    });
}

function abrirLightbox() {
    if (!STATE.imagensUrls.length) return;
    let lb = document.getElementById('lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'lightbox';
        lb.className = 'lightbox';
        lb.setAttribute('role', 'dialog');
        lb.setAttribute('aria-modal', 'true');
        lb.innerHTML = `
            <button type="button" class="lightbox-fechar" aria-label="Fechar"><i class="fas fa-times"></i></button>
            ${STATE.imagensUrls.length > 1 ? `
            <button type="button" class="lightbox-seta lightbox-seta--prev" data-dir="-1" aria-label="Foto anterior"><i class="fas fa-chevron-left"></i></button>
            <button type="button" class="lightbox-seta lightbox-seta--next" data-dir="1" aria-label="Próxima foto"><i class="fas fa-chevron-right"></i></button>` : ''}
            <img id="lightbox-img" alt="${esc(STATE.produto.nome)}">`;
        lb.addEventListener('click', e => {
            const seta = e.target.closest('.lightbox-seta');
            if (seta) return mudarImagem(STATE.imagemAtual + Number(seta.dataset.dir));
            if (e.target === lb || e.target.closest('.lightbox-fechar')) fecharLightbox();
        });
        document.body.appendChild(lb);
    }
    document.getElementById('lightbox-img').src = STATE.imagensUrls[STATE.imagemAtual];
    lb.classList.add('active');
    document.body.style.overflow = 'hidden';
    lb.querySelector('.lightbox-fechar').focus();
}

function fecharLightbox() {
    const lb = document.getElementById('lightbox');
    if (!lb || !lb.classList.contains('active')) return;
    lb.classList.remove('active');
    document.body.style.overflow = '';
}

function avisar(msg) {
    const t = document.createElement('div');
    t.className = 'aviso-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
}

// ==========================================
// RELACIONADOS
// ==========================================
function renderRelacionados() {
    const container = document.getElementById('produtos-relacionados');
    const grid = document.getElementById('relacionados-grid');
    if (!STATE.relacionados.length || !container || !grid) return;

    container.style.display = 'block';
    grid.innerHTML = STATE.relacionados.map(p => {
        const img = listaImagens(p)[0];
        return `
            <a href="produto.html?id=${encodeURIComponent(p.id)}" class="relacionado-item">
                <div class="relacionado-imagem-container">
                    <img src="${esc(img ? getUrl(img) : PLACEHOLDER)}" alt="${esc(p.nome)}" class="relacionado-imagem" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
                </div>
                <div class="relacionado-info">
                    <h4>${esc(p.nome)}</h4>
                    <div class="relacionado-preco">${precoHTML(p)}</div>
                </div>
            </a>`;
    }).join('');
}

function showError(msg) {
    document.getElementById('produto-container').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-exclamation-triangle"></i>
            <h3>Ops! Produto não encontrado</h3>
            <p>${esc(msg)}</p>
            <a href="index.html#galeria" class="btn-secondary">Voltar para a Galeria</a>
        </div>`;
}

function setupHamburger() {
    const ham = document.getElementById('hamburger');
    const menu = document.querySelector('.nav-menu');
    if (!ham || !menu) return;
    const fechar = () => { menu.classList.remove('active'); ham.classList.remove('active'); ham.setAttribute('aria-expanded', 'false'); };

    ham.addEventListener('click', () => {
        const aberto = menu.classList.toggle('active');
        ham.classList.toggle('active', aberto);
        ham.setAttribute('aria-expanded', aberto);
    });
    document.querySelectorAll('.nav-menu a').forEach(link => link.addEventListener('click', fechar));
    document.addEventListener('click', e => { if (!menu.contains(e.target) && !ham.contains(e.target)) fechar(); });
}
