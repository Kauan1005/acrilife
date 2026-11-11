'use strict';

// ==========================================
// CONFIGURAÇÕES E ESTADO
// ==========================================
const CONFIG = {
    URL: 'https://svirnutlsmybvvuyctak.supabase.co',
    // anon key: pública por design; a proteção real é o RLS no Supabase
    KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2aXJudXRsc215YnZ2dXljdGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTExNjYsImV4cCI6MjA4NjA2NzE2Nn0.zLuvrf78CaQsPYzXf-E5WcTuyaQS3fzcaj8DDFb_e6A',
    BUCKET: 'imagens',
    CACHE_TIME: 3600000, // 1 hora
    CACHE_PREFIX: 'acrilife_v2_'
};

// Somente as colunas que o site usa (menos dados trafegando)
const COLS_PRODUTO = 'id,nome,codigo,categoria_id,preco,sob_consulta,imagens,imagem_principal,descricao_simples,created_at';

const STATE = {
    sb: null,
    produtos: [],
    categorias: [],
    filtroAtivo: 'todos'
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
const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtBRL = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const safeIcon = c => /^[a-z0-9 -]+$/i.test(c || '') ? c : 'fas fa-cube';
const primeiraImagem = p => p.imagem_principal || (Array.isArray(p.imagens) ? p.imagens[0] : null);
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#eef2f7"/><path d="M150 250l40-50 30 35 25-30 55 45z" fill="#c5d0de"/><circle cx="165" cy="160" r="20" fill="#c5d0de"/></svg>');

function precoHTML(p, cls = '') {
    return p.sob_consulta || !Number(p.preco)
        ? `<span class="preco-consulta ${cls}">Sob consulta</span>`
        : `<span class="${cls}">${fmtBRL(p.preco)}</span>`;
}

// ==========================================
// CACHE (stale-while-revalidate)
// ==========================================
const cache = {
    set(k, v) {
        try { localStorage.setItem(CONFIG.CACHE_PREFIX + k, JSON.stringify({ t: Date.now(), v })); } catch { /* storage cheio/bloqueado */ }
    },
    get(k, aceitarVencido = false) {
        try {
            const raw = JSON.parse(localStorage.getItem(CONFIG.CACHE_PREFIX + k));
            if (!raw) return null;
            return (aceitarVencido || Date.now() - raw.t < CONFIG.CACHE_TIME) ? raw.v : null;
        } catch { return null; }
    }
};

async function fetchData(key, queryFn) {
    try {
        const { data, error } = await queryFn(STATE.sb);
        if (error) throw error;
        cache.set(key, data);
        return data;
    } catch (e) {
        console.error(`Erro ao carregar ${key}:`, e);
        return cache.get(key, true);
    }
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('ano-atual').textContent = new Date().getFullYear();
    carregarLogos();
    setupEventos();
    setupHeaderScroll();

    // 1) Render instantâneo a partir do cache (se houver)
    const cCfg = cache.get('config', true), cCats = cache.get('categorias', true), cProds = cache.get('produtos', true);
    if (cCats && cProds) {
        STATE.categorias = cCats; STATE.produtos = cProds;
        aplicarConfiguracoes(cCfg);
        renderizarUI();
    }

    // 2) Busca dados frescos
    if (!window.supabase) { if (!cProds) mostrarErroCarregamento(); return; }
    STATE.sb = window.supabase.createClient(CONFIG.URL, CONFIG.KEY, { auth: { persistSession: false } });

    const [config, cats, prods] = await Promise.all([
        fetchData('config', sb => sb.from('config_site').select('*').eq('id', 'site_config').maybeSingle()),
        fetchData('categorias', sb => sb.from('categorias').select('id,nome,icone,ordem').eq('ativo', true).order('ordem').order('nome')),
        fetchData('produtos', sb => sb.from('produtos').select(COLS_PRODUTO).eq('ativo', true).order('created_at', { ascending: false }))
    ]);

    if (!cats && !prods) { if (!cProds) mostrarErroCarregamento(); return; }

    STATE.categorias = cats || [];
    STATE.produtos = prods || [];
    aplicarConfiguracoes(config);
    renderizarUI();

    // Filtro via URL (?categoria=ID ou /categoria/ID)
    const catUrl = new URLSearchParams(location.search).get('categoria');
    if (catUrl && STATE.categorias.some(c => String(c.id) === catUrl)) filtrar(catUrl, false);
});

function mostrarErroCarregamento() {
    const grid = document.getElementById('galeria-grid');
    if (grid) grid.innerHTML = `<div class="empty-state"><i class="fas fa-wifi"></i><h3>Não foi possível carregar a galeria</h3><p>Verifique sua conexão e tente novamente.</p><button class="btn" onclick="location.reload()">Tentar novamente</button></div>`;
}

// ==========================================
// LOGOS E CONFIGURAÇÕES
// ==========================================
function carregarLogos() {
    const faviconUrl = getUrl('site/AcrilifeLogo.png');
    const logoUrl = getUrl('site/AcrilifeLogoCompleta.png');
    document.querySelectorAll('link[rel*="icon"]').forEach(el => el.href = faviconUrl);

    const wrapper = document.getElementById('logo-imagem-wrapper');
    if (!wrapper) return;
    const img = new Image();
    img.className = 'logo-img';
    img.alt = 'AcriLife';
    img.fetchPriority = 'high';
    img.decoding = 'async';
    img.onload = () => wrapper.classList.add('logo-imagem-wrapper--visivel');
    img.onerror = () => { document.getElementById('logo-fallback')?.classList.add('logo-fallback--visivel'); img.remove(); };
    img.src = logoUrl;
    wrapper.appendChild(img);
}

function aplicarConfiguracoes(cfg) {
    if (!cfg) return;

    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
    const endereco = [cfg.endereco, cfg.cidade].filter(Boolean).join(' — ');
    setText('contato-endereco', endereco);
    setText('contato-telefone', cfg.telefone);
    setText('contato-email', cfg.email);

    // Links clicáveis nos cards de contato
    const telEl = document.getElementById('contato-telefone');
    if (telEl && cfg.telefone) telEl.innerHTML = `<a href="tel:+55${esc(cfg.telefone.replace(/\D/g, ''))}">${esc(cfg.telefone)}</a>`;
    const mailEl = document.getElementById('contato-email');
    if (mailEl && cfg.email) mailEl.innerHTML = `<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>`;
    const endEl = document.getElementById('contato-endereco');
    if (endEl && endereco) endEl.innerHTML = `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}" target="_blank" rel="noopener">${esc(endereco)}</a>`;

    // Hero Banner
    const hero = document.getElementById('hero-banner');
    if (hero && cfg.imagem_oficina && !hero.querySelector('.hero-banner-img')) {
        const img = new Image();
        img.className = 'hero-banner-img';
        img.alt = '';
        img.fetchPriority = 'high';
        img.onload = () => img.classList.add('loaded');
        img.src = getUrl(cfg.imagem_oficina);
        hero.prepend(img);
    }

    // Horários
    const hor = Array.isArray(cfg.horario_funcionamento) ? cfg.horario_funcionamento : [];
    const horEl = document.getElementById('contato-horario');
    if (horEl && hor.length) horEl.innerHTML = hor.map(h => `${esc(h.dia)}: ${esc(h.horario)}`).join('<br>');

    // WhatsApp e redes
    const wpNum = (cfg.whatsapp || '').replace(/\D/g, '');
    const wpLink = wpNum ? `https://wa.me/${wpNum}?text=${encodeURIComponent('Olá! Vim pelo site e gostaria de um orçamento.')}` : '#contato';
    document.querySelectorAll('[data-whatsapp]').forEach(a => { a.href = wpLink; });
    const floatWp = document.getElementById('whatsapp-float');
    if (floatWp) floatWp.href = wpLink;

    const redes = cfg.redes_sociais || {};
    document.querySelectorAll('#social-links a').forEach(a => {
        const lbl = (a.getAttribute('aria-label') || '').toLowerCase();
        if (lbl === 'whatsapp') a.href = wpLink;
        else if (redes[lbl]) a.href = redes[lbl];
        else a.hidden = true;
    });

    const fc = document.getElementById('footer-contato');
    if (fc) fc.innerHTML = `
        ${hor[0] ? `<p><i class="fas fa-clock"></i> ${esc(hor[0].dia)}: ${esc(hor[0].horario)}</p>` : ''}
        ${cfg.telefone ? `<p><i class="fas fa-phone"></i> ${esc(cfg.telefone)}</p>` : ''}
        ${cfg.email ? `<p><i class="fas fa-envelope"></i> ${esc(cfg.email)}</p>` : ''}
        ${cfg.cidade ? `<p><i class="fas fa-map-marker-alt"></i> ${esc(cfg.cidade)}</p>` : ''}`;
}

// ==========================================
// RENDERIZAÇÃO
// ==========================================
function produtosDaCategoria(id) {
    return STATE.produtos.filter(p => String(p.categoria_id) === String(id));
}

function renderizarUI() {
    // Só exibe categorias que têm produtos
    const catsVisiveis = STATE.categorias.filter(c => produtosDaCategoria(c.id).length);

    const catFiltros = document.getElementById('categorias-filtros');
    if (catFiltros) {
        catFiltros.innerHTML = `<button class="filtro-btn ${STATE.filtroAtivo === 'todos' ? 'active' : ''}" data-categoria="todos" aria-pressed="${STATE.filtroAtivo === 'todos'}">Todos <span class="filtro-count">${STATE.produtos.length}</span></button>` +
            catsVisiveis.map(c => {
                const ativo = String(STATE.filtroAtivo) === String(c.id);
                return `<button class="filtro-btn ${ativo ? 'active' : ''}" data-categoria="${esc(c.id)}" aria-pressed="${ativo}">${esc(c.nome)} <span class="filtro-count">${produtosDaCategoria(c.id).length}</span></button>`;
            }).join('');
    }

    const footerCats = document.getElementById('footer-categorias');
    if (footerCats) {
        footerCats.innerHTML = catsVisiveis.slice(0, 6).map(c => `<li><a href="#galeria" data-filtrar="${esc(c.id)}">${esc(c.nome)}</a></li>`).join('') || '<li>—</li>';
    }

    // Cards de categoria com foto de capa
    const gridProds = document.getElementById('produtos-grid');
    if (gridProds) {
        gridProds.innerHTML = catsVisiveis.map(c => {
            const prods = produtosDaCategoria(c.id);
            const capa = prods.map(primeiraImagem).find(Boolean);
            return `
            <button type="button" class="categoria-card" data-filtrar="${esc(c.id)}">
                <span class="categoria-capa">
                    ${capa ? `<img src="${esc(getUrl(capa))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
                    <span class="categoria-icone"><i class="${esc(safeIcon(c.icone))}"></i></span>
                </span>
                <span class="categoria-info">
                    <span class="categoria-nome">${esc(c.nome)}</span>
                    <span class="categoria-qtd">${prods.length} ${prods.length === 1 ? 'produto' : 'produtos'} <i class="fas fa-arrow-right"></i></span>
                </span>
            </button>`;
        }).join('') || '<div class="empty-state"><h3>Em breve novos produtos</h3></div>';
    }

    renderizarGaleria();
}

function renderizarGaleria() {
    const grid = document.getElementById('galeria-grid');
    if (!grid) return;

    const filtrados = STATE.filtroAtivo === 'todos'
        ? STATE.produtos
        : produtosDaCategoria(STATE.filtroAtivo);

    if (!filtrados.length) {
        grid.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><h3>Nenhum produto nesta categoria</h3></div>';
        return;
    }

    grid.innerHTML = filtrados.map((p, i) => {
        const img = primeiraImagem(p);
        const cat = STATE.categorias.find(c => String(c.id) === String(p.categoria_id))?.nome || 'Produto';
        const qtdFotos = Array.isArray(p.imagens) ? p.imagens.length : 0;
        return `
            <a class="galeria-item" href="produto.html?id=${encodeURIComponent(p.id)}" style="--i:${Math.min(i, 12)}">
                <div class="galeria-imagem-container">
                    <img src="${esc(img ? getUrl(img) : PLACEHOLDER)}" alt="${esc(p.nome)}" class="galeria-imagem-padrao" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
                    ${qtdFotos > 1 ? `<span class="galeria-fotos"><i class="fas fa-images"></i> ${qtdFotos}</span>` : ''}
                    <span class="galeria-ver">Ver detalhes <i class="fas fa-arrow-right"></i></span>
                </div>
                <div class="galeria-info">
                    <span class="galeria-categoria">${esc(cat)}</span>
                    <h3>${esc(p.nome)}</h3>
                    ${p.descricao_simples ? `<p class="galeria-desc">${esc(p.descricao_simples)}</p>` : ''}
                    <div class="galeria-preco">${precoHTML(p)}</div>
                </div>
            </a>`;
    }).join('');
}

function filtrar(id, rolar = true) {
    STATE.filtroAtivo = String(id);
    document.querySelectorAll('.filtro-btn').forEach(b => {
        const ativo = b.dataset.categoria === STATE.filtroAtivo;
        b.classList.toggle('active', ativo);
        b.setAttribute('aria-pressed', ativo);
    });
    renderizarGaleria();
    if (rolar) document.getElementById('galeria')?.scrollIntoView({ behavior: 'smooth' });
}
window.filtrar = filtrar;

// ==========================================
// EVENTOS GERAIS E BUSCA
// ==========================================
function setupHeaderScroll() {
    const header = document.querySelector('header');
    let ticking = false;
    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            header?.classList.toggle('scrolled', window.scrollY > 40);
            // Barra de progresso da leitura na base do header
            const max = document.documentElement.scrollHeight - window.innerHeight;
            header?.style.setProperty('--progresso', max > 0 ? (window.scrollY / max).toFixed(4) : 0);
            ticking = false;
        });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Destaca o link da seção visível
    const links = [...document.querySelectorAll('.nav-menu a[href^="#"]')];
    if (!('IntersectionObserver' in window) || !links.length) return;
    const obs = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id));
        });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('section[id]').forEach(s => obs.observe(s));
}

function setupEventos() {
    // Menu Mobile
    const ham = document.getElementById('hamburger'), menu = document.querySelector('.nav-menu');
    const fecharMenu = () => { menu?.classList.remove('active'); ham?.classList.remove('active'); ham?.setAttribute('aria-expanded', 'false'); };
    ham?.addEventListener('click', () => {
        const aberto = menu.classList.toggle('active');
        ham.classList.toggle('active', aberto);
        ham.setAttribute('aria-expanded', aberto);
    });
    document.querySelectorAll('.nav-menu a').forEach(l => l.addEventListener('click', fecharMenu));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharMenu(); });

    // Filtros e atalhos de categoria (delegação)
    document.addEventListener('click', e => {
        const f = e.target.closest('.filtro-btn');
        if (f) return filtrar(f.dataset.categoria, false);
        const atalho = e.target.closest('[data-filtrar]');
        if (atalho) { e.preventDefault(); filtrar(atalho.dataset.filtrar); }
    });

    window.addEventListener('resize', () => posicionarBarraMobile());

    setupBusca('search-input', 'search-btn', 'search-results');
    setupBusca('mobile-search-input', 'mobile-search-btn', 'mobile-search-results', 'mobile-search-toggle', 'mobile-search-bar');
}

function posicionarBarraMobile() {
    const bar = document.getElementById('mobile-search-bar');
    const res = document.getElementById('mobile-search-results');
    if (!bar || !bar.classList.contains('active')) return;
    const alturaHeader = document.querySelector('.navbar').getBoundingClientRect().bottom;
    bar.style.top = alturaHeader + 'px';
    if (res) res.style.top = (alturaHeader + bar.offsetHeight) + 'px';
}

function buscarProdutos(termo) {
    const t = normalizar(termo);
    return STATE.produtos
        .map(p => {
            const nome = normalizar(p.nome);
            const cat = normalizar(STATE.categorias.find(c => String(c.id) === String(p.categoria_id))?.nome);
            let score = 0;
            if (nome.startsWith(t)) score += 3;
            else if (nome.includes(t)) score += 2;
            if (normalizar(p.codigo) === t) score += 3;
            if (cat.includes(t)) score += 1;
            if (normalizar(p.descricao_simples).includes(t)) score += 1;
            return { p, score };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(x => x.p);
}

function setupBusca(inputId, btnId, resId, toggleId = null, barId = null) {
    const input = document.getElementById(inputId);
    const res = document.getElementById(resId);
    const btn = document.getElementById(btnId);
    const tog = toggleId && document.getElementById(toggleId);
    const bar = barId && document.getElementById(barId);
    if (!input || !res) return;

    let achados = [];

    if (tog && bar) {
        tog.addEventListener('click', () => {
            if (bar.classList.toggle('active')) {
                posicionarBarraMobile();
                setTimeout(() => input.focus(), 50);
            } else {
                res.classList.remove('active');
                input.value = '';
            }
            tog.setAttribute('aria-expanded', bar.classList.contains('active'));
        });
    }

    const abrir = p => { if (p) window.location.href = `produto.html?id=${encodeURIComponent(p.id)}`; };

    const buscar = () => {
        const v = input.value.trim();
        if (v.length < 2) { res.classList.remove('active'); return; }
        achados = buscarProdutos(v).slice(0, 6);
        res.innerHTML = achados.length
            ? achados.map(p => {
                const img = primeiraImagem(p);
                const cat = STATE.categorias.find(c => String(c.id) === String(p.categoria_id))?.nome || '';
                return `
                <a class="search-result-item" href="produto.html?id=${encodeURIComponent(p.id)}">
                    <img src="${esc(img ? getUrl(img) : PLACEHOLDER)}" alt="" loading="lazy">
                    <span><span class="search-result-title">${esc(p.nome)}</span><span class="search-result-cat">${esc(cat)}</span></span>
                </a>`;
            }).join('')
            : `<div class="search-result-item search-result-vazio">Nada encontrado para “${esc(v)}”</div>`;
        res.classList.add('active');
        posicionarBarraMobile();
    };

    let t;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 120); });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); abrir(achados[0]); }
        if (e.key === 'Escape') { res.classList.remove('active'); input.blur(); }
    });
    btn?.addEventListener('click', e => { e.preventDefault(); if (achados[0]) abrir(achados[0]); else { buscar(); input.focus(); } });

    document.addEventListener('click', e => {
        const dentro = [input, res, tog, bar, btn].some(el => el && el.contains(e.target));
        if (!dentro) {
            res.classList.remove('active');
            if (bar) { bar.classList.remove('active'); input.value = ''; }
        }
    });
}
