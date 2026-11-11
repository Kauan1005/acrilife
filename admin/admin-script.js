// ============================================
// ADMIN SCRIPT — ACRILIFE
// Versão: Completa, Corrigida e Otimizada
// ============================================

const CONFIG = {
    get SUPABASE_URL()  { return (typeof SUPABASE_CONFIG !== 'undefined') ? SUPABASE_CONFIG.url     : ''; },
    get SUPABASE_KEY()  { return (typeof SUPABASE_CONFIG !== 'undefined') ? SUPABASE_CONFIG.anonKey : ''; },

    USE_SUPABASE:    true,
    CACHE_TIMEOUT:   300000,
    SYNC_INTERVAL:   300000,
    AUTO_SYNC:       true,

    LOGO_BUCKET:     'imagens',
    LOGO_CONFIG_ID:  'site_config',
    LOGO_REFRESH_MS: 60000,

    IMAGEM_PADRAO: { QUALIDADE: 0.85, TIPO: 'image/jpeg', MAX_LADO: 1200 }
};

const STATE = {
    user:          null,
    page:          'dashboard',
    produtos:      [],
    categorias:    [],
    configSite:    null,
    supabase:      null,
    isLoading:     false,
    cache:         new Map(),
    lastUpdate:    null,
    currentModal:  null,
    editingId:     null,
    selectedItems: new Set(),
    filtros:       { busca: '', categoria: '', status: '' }
};

// ============================================
// UTILITÁRIOS DE SEGURANÇA / FORMATAÇÃO
// ============================================
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsArg = (v) => esc(JSON.stringify(String(v ?? '')));           // para onclick="fn(${jsArg(id)})"
const safeIcon = (c) => /^[a-z0-9 -]+$/i.test(c || '') ? c : 'fas fa-box';
const fmtBRL = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#f1f5f9"/><path d="M150 200l40-50 30 35 25-30 55 45z" fill="#cbd5e1"/><circle cx="165" cy="115" r="18" fill="#cbd5e1"/></svg>');
const ON_IMG_ERROR = `this.onerror=null;this.src='${PLACEHOLDER_IMG}'`;
const precoAdmin = (p) => p.sob_consulta ? '<span class="badge badge-soft">Sob consulta</span>' : esc(fmtBRL(p.preco));
const nomeCategoria = (id) => STATE.categorias.find(c => c.id === id)?.nome || 'Sem categoria';
const URL_SITE_PUBLICO = (window.ACRILIFE_SITE_URL || 'https://acrilife.netlify.app');

// ============================================
// CACHE MANAGER
// ============================================
const CacheManager = {
    set(key, data, ttl = CONFIG.CACHE_TIMEOUT) {
        STATE.cache.set(key, { data, timestamp: Date.now(), ttl });
    },
    get(key) {
        const item = STATE.cache.get(key);
        if (!item) return null;
        if (Date.now() - item.timestamp > item.ttl) { STATE.cache.delete(key); return null; }
        return item.data;
    },
    clear()      { STATE.cache.clear(); },
    clearStale() {
        const now = Date.now();
        for (const [k, v] of STATE.cache.entries()) {
            if (now - v.timestamp > v.ttl) STATE.cache.delete(k);
        }
    }
};

// ============================================
// AUTH
// ============================================
async function checkAuth() {
    if (!STATE.supabase) return false;
    try {
        const { data: { session }, error } = await STATE.supabase.auth.getSession();
        if (error || !session) return false;

        STATE.user = window._adminUser || {
            id:    session.user.id,
            email: session.user.email,
            role:  'admin'
        };
        updateUserUI(STATE.user.email);
        return true;
    } catch {
        return false;
    }
}

function updateUserUI(identifier) {
    const label   = identifier || 'Admin';
    const display = label.includes('@') ? label.split('@')[0] : label;
    const a = document.getElementById('admin-username');
    const b = document.getElementById('user-name-short');
    if (a) a.textContent = display;
    if (b) b.textContent = display.substring(0, 2).toUpperCase();
}

function redirectToLogin() {
    if (!window.location.href.includes('login.html')) {
        window.location.replace('login.html');
    }
}

// ============================================
// SUPABASE E LOGO DO BUCKET
// ============================================
function initSupabase() {
    if (!CONFIG.USE_SUPABASE) { updateConnectionStatus(false); return; }
    try {
        STATE.supabase = window._supabaseClient || window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
        updateConnectionStatus(true);
    } catch {
        CONFIG.USE_SUPABASE = false;
        updateConnectionStatus(false);
    }
}

function updateConnectionStatus(ok) {
    ['#connection-status', '#connection-status-display'].forEach(sel => {
        const el = document.querySelector(sel); if (!el) return;
        if (sel === '#connection-status') el.setAttribute('data-status', ok ? 'online' : 'offline');
        const ic = el.querySelector('i');
        const tx = el.querySelector('span');
        if (ic && tx) {
            ic.style.color = ok ? '#10b981' : '#ef4444';
            tx.textContent = ok ? 'Conectado' : 'Offline';
        }
    });
}

async function testarConexaoSupabase() {
    if (!CONFIG.USE_SUPABASE || !STATE.supabase) return false;
    try {
        const { error } = await STATE.supabase.from('categorias').select('count', { count: 'exact', head: true });
        return !error;
    } catch { return false; }
}

async function carregarLogoDoSupabase() {
    if (!CONFIG.USE_SUPABASE || !STATE.supabase) return;
    const baseUrl          = `${CONFIG.SUPABASE_URL}/storage/v1/object/public/${CONFIG.LOGO_BUCKET}/site`;
    const logoPrincipalUrl = `${baseUrl}/AcrilifeLogoCompleta.png`;
    const faviconUrl       = `${baseUrl}/AcrilifeLogo.png`;

    const logoIcon = document.querySelector('.sidebar .logo-icon');
    if (logoIcon) {
        logoIcon.classList.add('has-image');
        logoIcon.innerHTML = `<img src="${logoPrincipalUrl}" alt="Logo Acrilife" style="width:100%;height:100%;object-fit:contain;border-radius:0;display:block;" onerror="this.closest('.logo-icon').classList.remove('has-image');this.parentElement.innerHTML='<i class=\\'fas fa-gem logo-fallback-icon\\'></i>'">`;
    }

    const dynFavicon   = document.getElementById('dynamic-favicon');
    const dynAppleIcon = document.getElementById('dynamic-apple-icon');
    if (dynFavicon)   dynFavicon.href   = faviconUrl;
    if (dynAppleIcon) dynAppleIcon.href = faviconUrl;
}


// ============================================
// DADOS PRINCIPAIS E SYNC
// ============================================
async function loadInitialData() {
    if (STATE.isLoading) return;
    STATE.isLoading = true;
    try {
        STATE.produtos = []; STATE.categorias = []; STATE.configSite = null;
        if (CONFIG.USE_SUPABASE && STATE.supabase) await syncFromSupabase();
        updateCounters();
        loadPage(STATE.page);
        await carregarLogoDoSupabase();
    } catch { showToast('Erro ao carregar dados', 'error'); }
    finally  { STATE.isLoading = false; }
}

async function syncFromSupabase() {
    if (!CONFIG.USE_SUPABASE || !STATE.supabase) return;
    try {
        // Consultas em paralelo (antes eram sequenciais)
        const [cfgRes, catRes, prodRes] = await Promise.all([
            STATE.supabase.from('config_site').select('*').eq('id', CONFIG.LOGO_CONFIG_ID).maybeSingle(),
            STATE.supabase.from('categorias').select('*').order('ordem', { ascending: true }).order('nome', { ascending: true }),
            STATE.supabase.from('produtos').select('*').order('created_at', { ascending: false }).limit(1000)
        ]);
        const erro = cfgRes.error || catRes.error || prodRes.error;
        updateConnectionStatus(!erro);
        if (erro) throw erro;

        const cfg = cfgRes.data, cats = catRes.data, prods = prodRes.data;
        if (cfg) STATE.configSite = cfg;
        if (cats) STATE.categorias = cats;
        if (prods) {
            STATE.produtos = prods.map(p => ({
                ...p,
                imagens: Array.isArray(p.imagens) ? p.imagens : (p.imagens ? [p.imagens] : [])
            }));
        }

        STATE.lastUpdate = new Date().toISOString();
        updateLastUpdate();
        updateCounters();
        // Não re-renderiza se houver modal aberto (evita perder edição em andamento)
        if (!STATE.currentModal && ['produtos', 'dashboard', 'configuracoes', 'integracao', 'categorias'].includes(STATE.page)) loadPage(STATE.page);
        return true;
    } catch (err) {
        console.error('Erro sync:', err);
        showToast('Não foi possível atualizar os dados: ' + (err.message || 'erro de conexão'), 'error');
        return false;
    }
}

async function saveAllData() {
    try {
        STATE.lastUpdate = new Date().toISOString();
        updateLastUpdate();
        updateCounters();
        if (CONFIG.USE_SUPABASE && STATE.supabase && STATE.configSite)
            await STATE.supabase.from('config_site').upsert({ ...STATE.configSite, updated_at: new Date().toISOString() }, { onConflict: 'id' });
        showToast('Dados salvos!', 'success');
    } catch { showToast('Erro ao salvar', 'error'); }
}

function startAutoSync() {
    setInterval(async () => {
        if (CONFIG.USE_SUPABASE && STATE.supabase && !STATE.isLoading) {
            try { await syncFromSupabase(); } catch {}
        }
    }, CONFIG.SYNC_INTERVAL);
}

// ============================================
// NAVEGAÇÃO E PÁGINAS (HTML)
// ============================================
const PAGINAS = ['dashboard', 'produtos', 'categorias', 'configuracoes', 'integracao'];
function navigateTo(page) {
    if (!PAGINAS.includes(page)) page = 'dashboard';
    if (STATE.page === page && document.querySelector('#content-area > :not(.page-loader)')) return;
    STATE.page = page;
    if (location.hash !== '#' + page) history.pushState(null, '', '#' + page);
    STATE.selectedItems.clear();
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === page));
    const t  = { dashboard: 'Dashboard', produtos: 'Produtos', categorias: 'Categorias', configuracoes: 'Configurações', integracao: 'Integração' };
    const pt = document.getElementById('page-title');
    if (pt) pt.textContent = t[page] || 'Painel';
    loadPage(page);
}

function loadPage(page) {
    const ca = document.getElementById('content-area'); if (!ca) return;
    ca.innerHTML = '<div class="page-loader"><div class="loader-spinner"></div><p>Carregando...</p></div>';
    setTimeout(() => {
        try {
            const pages = {
                dashboard:     getDashboardHTML,
                produtos:      getProdutosHTML,
                categorias:    getCategoriasHTML,
                configuracoes: getConfiguracoesHTML,
                integracao:    getIntegracaoHTML
            };
            ca.innerHTML = (pages[page] || getDashboardHTML)();
            if (page === 'produtos')  setTimeout(carregarMidiasNoCarrossel, 300);
            if (page === 'dashboard') setTimeout(carregarMiniaturasRecentes, 300);
        } catch (err) {
            ca.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Erro</h3><p>${err.message}</p></div>`;
        }
    }, 50);
}

function getDashboardHTML() {
    const total     = STATE.produtos.length;
    const ativos    = STATE.produtos.filter(p => p.ativo !== false).length;
    const ocultos   = total - ativos;
    const semImagem = STATE.produtos.filter(p => !(p.imagens?.length || p.imagem_principal)).length;
    const catsVazias = STATE.categorias.filter(c => !STATE.produtos.some(p => p.categoria_id === c.id)).length;
    const rec       = STATE.produtos.slice(0, 6);
    const nome      = _getAdminNomeAtual();
    const hora      = new Date().getHours();
    const saudacao  = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

    const alertas = [];
    if (semImagem) alertas.push(`<button class="alert-item alert-warning" onclick="irParaProdutos('sem-imagem')"><i class="fas fa-image"></i><span><strong>${semImagem}</strong> produto(s) sem foto — eles aparecem sem imagem no site.</span><i class="fas fa-chevron-right"></i></button>`);
    if (ocultos)   alertas.push(`<button class="alert-item alert-info" onclick="irParaProdutos('oculto')"><i class="fas fa-eye-slash"></i><span><strong>${ocultos}</strong> produto(s) oculto(s) do site.</span><i class="fas fa-chevron-right"></i></button>`);
    if (catsVazias) alertas.push(`<button class="alert-item alert-info" onclick="navigateTo('categorias')"><i class="fas fa-tags"></i><span><strong>${catsVazias}</strong> categoria(s) sem produtos (não aparecem no site).</span><i class="fas fa-chevron-right"></i></button>`);

    return `<div class="dashboard">
        <div class="welcome-banner">
            <div>
                <h2>${saudacao}, ${esc(nome)} 👋</h2>
                <p>Gerencie o catálogo do site Acrilife. As alterações aparecem no site na hora.</p>
            </div>
            <div class="welcome-actions">
                <button class="btn btn-light" onclick="abrirModalProduto()"><i class="fas fa-plus"></i> Novo produto</button>
                <a class="btn btn-outline-light" href="${esc(URL_SITE_PUBLICO)}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt"></i> Ver site</a>
            </div>
        </div>

        <div class="stats-grid">
            <button class="stat-card stat-card-primary" onclick="irParaProdutos('')">
                <div class="stat-icon"><i class="fas fa-box"></i></div>
                <h3 class="stat-value">${total}</h3>
                <p class="stat-label">Produtos</p>
            </button>
            <button class="stat-card stat-card-success" onclick="irParaProdutos('ativo')">
                <div class="stat-icon"><i class="fas fa-eye"></i></div>
                <h3 class="stat-value">${ativos}</h3>
                <p class="stat-label">Visíveis no site</p>
            </button>
            <button class="stat-card stat-card-info" onclick="navigateTo('categorias')">
                <div class="stat-icon"><i class="fas fa-tags"></i></div>
                <h3 class="stat-value">${STATE.categorias.length}</h3>
                <p class="stat-label">Categorias</p>
            </button>
            <button class="stat-card stat-card-warning" onclick="irParaProdutos('sem-imagem')">
                <div class="stat-icon"><i class="fas fa-image"></i></div>
                <h3 class="stat-value">${semImagem}</h3>
                <p class="stat-label">Sem foto</p>
            </button>
        </div>

        ${alertas.length ? `<div class="alert-list">${alertas.join('')}</div>` : ''}

        <div class="dashboard-grid">
            <div class="dashboard-card">
                <div class="dashboard-card-header">
                    <h3>Produtos recentes</h3>
                    <button class="btn btn-secondary btn-sm" onclick="navigateTo('produtos')">Ver todos</button>
                </div>
                <div class="dashboard-card-body">
                    ${rec.length ? rec.map(p => {
                        const imgUrl = getPublicImageUrl(p.imagens?.[0] || p.imagem_principal);
                        return `<div class="recent-product-item">
                            <div class="recent-thumb-wrapper">
                                ${imgUrl
                                    ? `<img src="${esc(imgUrl)}" alt="" class="recent-product-img" loading="lazy" onerror="${ON_IMG_ERROR}">`
                                    : `<div class="recent-product-img no-image"><i class="fas fa-image"></i></div>`}
                            </div>
                            <div class="recent-product-info">
                                <div class="recent-product-name">${esc(p.nome)} ${p.ativo === false ? '<span class="badge badge-muted">Oculto</span>' : ''}</div>
                                <div class="recent-product-meta">${esc(nomeCategoria(p.categoria_id))} · ${precoAdmin(p)}</div>
                            </div>
                            <div class="recent-product-actions">
                                <button class="btn-tool" onclick="abrirModalProduto(${jsArg(p.id)})" title="Editar"><i class="fas fa-edit"></i></button>
                            </div>
                        </div>`;
                    }).join('')
                    : '<p class="empty-inline">Nenhum produto cadastrado</p>'}
                </div>
            </div>
            <div class="dashboard-card">
                <div class="dashboard-card-header"><h3>Atalhos</h3></div>
                <div class="dashboard-card-body">
                    <div class="quick-actions-grid">
                        <button class="quick-tile" onclick="abrirModalProduto()"><i class="fas fa-plus-circle"></i><span>Novo produto</span></button>
                        <button class="quick-tile" onclick="abrirModalCategoria()"><i class="fas fa-tag"></i><span>Nova categoria</span></button>
                        <button class="quick-tile" onclick="abrirModalConfigSite()"><i class="fas fa-store"></i><span>Dados da empresa</span></button>
                        <button class="quick-tile" onclick="exportarDados()"><i class="fas fa-download"></i><span>Backup (JSON)</span></button>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function irParaProdutos(status = '') {
    STATE.filtros = { busca: '', categoria: '', status };
    if (STATE.page === 'produtos') loadPage('produtos'); else navigateTo('produtos');
}

function produtosFiltrados() {
    const { busca, categoria, status } = STATE.filtros;
    const t = normalizar(busca);
    return STATE.produtos.filter(p => {
        if (t && !(normalizar(p.nome).includes(t) || normalizar(p.codigo).includes(t) || normalizar(p.descricao_simples).includes(t))) return false;
        if (categoria === '__sem__' ? !!p.categoria_id && STATE.categorias.some(c => c.id === p.categoria_id) : categoria && p.categoria_id !== categoria) return false;
        if (status === 'ativo' && p.ativo === false) return false;
        if (status === 'oculto' && p.ativo !== false) return false;
        if (status === 'sem-imagem' && (p.imagens?.length || p.imagem_principal)) return false;
        return true;
    });
}

function getProdutosHTML() {
    const sel = STATE.selectedItems.size > 0;
    const { busca, categoria, status } = STATE.filtros;
    return `<div class="products-page">
        <div class="products-page-header">
            <h2>Produtos <span class="count-pill">${STATE.produtos.length}</span></h2>
            <div class="header-actions">
                <button class="btn btn-primary" onclick="abrirModalProduto()"><i class="fas fa-plus"></i> Novo produto</button>
            </div>
        </div>
        <div class="toolbar">
            <div class="toolbar-search"><i class="fas fa-search"></i>
                <input type="search" id="filtro-busca" placeholder="Filtrar por nome ou código..." value="${esc(busca)}" oninput="aplicarFiltroProdutos('busca', this.value)">
            </div>
            <select id="filtro-categoria" onchange="aplicarFiltroProdutos('categoria', this.value)">
                <option value="">Todas as categorias</option>
                ${STATE.categorias.map(c => `<option value="${esc(c.id)}" ${categoria === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}
                <option value="__sem__" ${categoria === '__sem__' ? 'selected' : ''}>Sem categoria</option>
            </select>
            <select id="filtro-status" onchange="aplicarFiltroProdutos('status', this.value)">
                <option value="">Todos os status</option>
                <option value="ativo" ${status === 'ativo' ? 'selected' : ''}>Visíveis no site</option>
                <option value="oculto" ${status === 'oculto' ? 'selected' : ''}>Ocultos</option>
                <option value="sem-imagem" ${status === 'sem-imagem' ? 'selected' : ''}>Sem foto</option>
            </select>
        </div>
        <div id="bulk-actions-bar" class="bulk-actions-bar ${sel ? 'active' : ''}">
            <div class="bulk-actions-info"><i class="fas fa-check-circle"></i><span id="selected-count">${STATE.selectedItems.size} item(ns) selecionado(s)</span></div>
            <div class="bulk-actions-buttons">
                <button class="btn btn-secondary btn-sm" onclick="executeBulkAction('mostrar')"><i class="fas fa-eye"></i> Mostrar</button>
                <button class="btn btn-secondary btn-sm" onclick="executeBulkAction('ocultar')"><i class="fas fa-eye-slash"></i> Ocultar</button>
                <button class="btn btn-danger btn-sm" onclick="executeBulkAction('delete')"><i class="fas fa-trash"></i> Excluir</button>
                <button class="btn btn-secondary btn-sm" onclick="toggleSelectAll(false)"><i class="fas fa-times"></i> Limpar</button>
            </div>
        </div>
        <div id="produtos-lista">${getProdutosGridHTML()}</div>
    </div>`;
}

function getProdutosGridHTML() {
    if (!STATE.produtos.length) {
        return '<div class="empty-state"><i class="fas fa-box-open"></i><h3>Nenhum produto ainda</h3><p>Cadastre o primeiro produto para ele aparecer no site.</p><button class="btn btn-primary" onclick="abrirModalProduto()">Adicionar produto</button></div>';
    }
    const lista = produtosFiltrados();
    if (!lista.length) {
        return '<div class="empty-state"><i class="fas fa-filter"></i><h3>Nenhum produto encontrado</h3><p>Ajuste os filtros acima.</p></div>';
    }
    return `<div class="products-grid">${lista.map(p => `
        <div class="product-card ${STATE.selectedItems.has(p.id) ? 'selected' : ''} ${p.ativo === false ? 'is-hidden' : ''}">
            <div class="product-card-header">
                <input type="checkbox" class="item-select-checkbox" aria-label="Selecionar ${esc(p.nome)}" onchange="toggleItemSelection(${jsArg(p.id)}, this.checked)" ${STATE.selectedItems.has(p.id) ? 'checked' : ''}>
                <span class="badge ${p.ativo === false ? 'badge-muted' : 'badge-success'}">${p.ativo === false ? '<i class="fas fa-eye-slash"></i> Oculto' : '<i class="fas fa-eye"></i> No site'}</span>
            </div>
            <div class="product-media-wrapper">${gerarCarrosselMidia(p.imagens, p.nome, p.id)}</div>
            <div class="product-card-body">
                <span class="product-category">${esc(nomeCategoria(p.categoria_id))}</span>
                <h3 class="product-title">${esc(p.nome)}</h3>
                <div class="product-code">Cód.: ${esc(p.codigo || 'N/A')}</div>
                <div class="product-price">${precoAdmin(p)}</div>
                ${p.descricao_simples ? `<div class="product-simple-desc">${esc(p.descricao_simples)}</div>` : ''}
                <div class="product-actions">
                    <button class="btn-tool" onclick="abrirModalProduto(${jsArg(p.id)})" title="Editar"><i class="fas fa-edit"></i></button>
                    <button class="btn-tool" onclick="alternarVisibilidadeProduto(${jsArg(p.id)})" title="${p.ativo === false ? 'Mostrar no site' : 'Ocultar do site'}"><i class="fas ${p.ativo === false ? 'fa-eye' : 'fa-eye-slash'}"></i></button>
                    <button class="btn-tool" onclick="duplicarProduto(${jsArg(p.id)})" title="Duplicar"><i class="fas fa-copy"></i></button>
                    <a class="btn-tool" href="${esc(URL_SITE_PUBLICO)}/produto.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener" title="Ver no site"><i class="fas fa-external-link-alt"></i></a>
                    <button class="btn-tool btn-tool-danger" onclick="excluirProduto(${jsArg(p.id)})" title="Excluir"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>`).join('')}</div>`;
}

let _filtroTimer;
function aplicarFiltroProdutos(campo, valor) {
    STATE.filtros[campo] = valor;
    clearTimeout(_filtroTimer);
    _filtroTimer = setTimeout(() => {
        const el = document.getElementById('produtos-lista');
        if (el) el.innerHTML = getProdutosGridHTML();
    }, campo === 'busca' ? 150 : 0);
}

function getCategoriasHTML() {
    const sel = STATE.selectedItems.size > 0;
    return `<div class="categorias-page">
        <div class="products-page-header">
            <h2>Categorias <span class="count-pill">${STATE.categorias.length}</span></h2>
            <div class="header-actions">
                <button class="btn btn-primary" onclick="abrirModalCategoria()"><i class="fas fa-plus"></i> Nova categoria</button>
            </div>
        </div>
        <p class="page-hint"><i class="fas fa-info-circle"></i> Categorias sem produtos não aparecem no site. A ordem define a sequência dos filtros na galeria.</p>
        <div id="bulk-actions-bar" class="bulk-actions-bar ${sel ? 'active' : ''}">
            <div class="bulk-actions-info"><i class="fas fa-check-circle"></i><span id="selected-count">${STATE.selectedItems.size} item(ns) selecionado(s)</span></div>
            <div class="bulk-actions-buttons">
                <button class="btn btn-danger btn-sm" onclick="executeBulkAction('delete')"><i class="fas fa-trash"></i> Excluir</button>
                <button class="btn btn-secondary btn-sm" onclick="toggleSelectAll(false)"><i class="fas fa-times"></i> Limpar</button>
            </div>
        </div>
        ${STATE.categorias.length
            ? `<div class="category-list">${STATE.categorias.map(c => {
                const qtd = STATE.produtos.filter(p => p.categoria_id === c.id).length;
                return `
                <div class="category-row ${STATE.selectedItems.has(c.id) ? 'selected' : ''}">
                    <input type="checkbox" class="item-select-checkbox" aria-label="Selecionar ${esc(c.nome)}" onchange="toggleItemSelection(${jsArg(c.id)}, this.checked)" ${STATE.selectedItems.has(c.id) ? 'checked' : ''}>
                    <span class="category-icon"><i class="${esc(safeIcon(c.icone))}"></i></span>
                    <div class="category-main">
                        <strong>${esc(c.nome)}</strong>
                        <span>${qtd} produto(s) · ordem ${Number(c.ordem) || 0}${c.ativo === false ? ' · <em>inativa</em>' : ''}${!qtd ? ' · <em>não aparece no site</em>' : ''}</span>
                    </div>
                    <div class="product-actions">
                        <button class="btn-tool" onclick="irParaProdutosCategoria(${jsArg(c.id)})" title="Ver produtos"><i class="fas fa-box"></i></button>
                        <button class="btn-tool" onclick="abrirModalCategoria(${jsArg(c.id)})" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn-tool btn-tool-danger" onclick="excluirCategoria(${jsArg(c.id)})" title="Excluir"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`;
            }).join('')}</div>`
            : '<div class="empty-state"><i class="fas fa-tags"></i><h3>Nenhuma categoria</h3><button class="btn btn-primary" onclick="abrirModalCategoria()">Criar categoria</button></div>'}
    </div>`;
}

function irParaProdutosCategoria(id) {
    STATE.filtros = { busca: '', categoria: id, status: '' };
    navigateTo('produtos');
}

function getConfiguracoesHTML() {
    const c = STATE.configSite || {};
    const hor = Array.isArray(c.horario_funcionamento) ? c.horario_funcionamento : [];
    const redes = c.redes_sociais || {};
    const linha = (icon, label, valor) => `<div class="contact-info-row"><i class="${icon} contact-icon"></i><div><strong>${label}</strong><p>${valor ? esc(valor) : '<span class="text-muted">Não configurado</span>'}</p></div></div>`;
    return `<div class="configuracoes-page">
        <div class="products-page-header">
            <h2>Dados da empresa</h2>
            <div class="header-actions"><button class="btn btn-primary" onclick="abrirModalConfigSite()"><i class="fas fa-edit"></i> Editar</button></div>
        </div>
        <div class="dashboard-grid">
            <div class="dashboard-card">
                <div class="dashboard-card-header"><h3><i class="fas fa-address-card"></i> Contato exibido no site</h3></div>
                <div class="dashboard-card-body">
                    ${linha('fas fa-building', 'Empresa', c.empresa_nome)}
                    ${linha('fas fa-map-marker-alt', 'Endereço', [c.endereco, c.cidade, c.estado].filter(Boolean).join(' — '))}
                    ${linha('fas fa-phone', 'Telefone', c.telefone)}
                    ${linha('fab fa-whatsapp', 'WhatsApp', c.whatsapp)}
                    ${linha('fas fa-envelope', 'E-mail', c.email)}
                </div>
            </div>
            <div class="dashboard-card">
                <div class="dashboard-card-header"><h3><i class="fas fa-clock"></i> Horários e redes</h3></div>
                <div class="dashboard-card-body">
                    <h4 class="mini-title">Horário de funcionamento</h4>
                    ${hor.length ? `<ul class="horario-tabela">${hor.map(h => {
                        const fechado = /fechad/i.test(h.horario || '');
                        return `<li><span>${esc(h.dia)}</span>${fechado ? '<span class="badge badge-muted">Fechado</span>' : `<strong>${esc(h.horario)}</strong>`}</li>`;
                    }).join('')}</ul>` : '<p class="text-muted">Não configurado</p>'}

                    <h4 class="mini-title">Redes sociais</h4>
                    <div class="rede-lista">
                        ${redeChip('instagram', 'fab fa-instagram', 'Instagram', redes.instagram)}
                        ${redeChip('facebook', 'fab fa-facebook-f', 'Facebook', redes.facebook)}
                        ${redeChip('whatsapp', 'fab fa-whatsapp', 'WhatsApp', c.whatsapp ? `https://wa.me/${String(c.whatsapp).replace(/\D/g, '')}` : '')}
                    </div>
                </div>
            </div>
            <div class="dashboard-card">
                <div class="dashboard-card-header"><h3><i class="fas fa-image"></i> Banner da página inicial</h3></div>
                <div class="dashboard-card-body">
                    ${c.imagem_oficina
                        ? `<img src="${esc(getPublicImageUrl(c.imagem_oficina))}" alt="Banner atual" class="banner-preview" onerror="${ON_IMG_ERROR}">`
                        : '<p class="text-muted">Nenhum banner definido.</p>'}
                    <button class="btn btn-secondary btn-sm mt-20" onclick="abrirModalConfigSite('banner')"><i class="fas fa-upload"></i> Trocar banner</button>
                </div>
            </div>
        </div>
    </div>`;
}

// Mostra a rede como "chip": ícone + @perfil legível + botão para abrir (em vez da URL inteira)
function rotuloRede(tipo, url) {
    try {
        const u = new URL(url);
        if (tipo === 'whatsapp') {
            const n = u.pathname.replace(/\D/g, '');
            return n.length >= 12 ? `+${n.slice(0, 2)} (${n.slice(2, 4)}) ${n.slice(4, -4)}-${n.slice(-4)}` : n;
        }
        const partes = u.pathname.split('/').filter(Boolean);
        if (tipo === 'instagram' && partes[0]) return '@' + partes[0];
        if (tipo === 'facebook') return partes[0] === 'share' ? 'Página da empresa' : (partes[0] ? '/' + partes[0] : u.hostname);
        return u.hostname.replace(/^www\./, '');
    } catch { return url; }
}

function redeChip(tipo, icone, nome, url) {
    if (!url) {
        return `<div class="rede-chip rede-chip--vazio"><span class="rede-icone rede-${tipo}"><i class="${icone}"></i></span>
            <div class="rede-texto"><strong>${nome}</strong><span>Não configurado</span></div>
            <button class="btn-tool" onclick="abrirModalConfigSite()" title="Configurar"><i class="fas fa-plus"></i></button></div>`;
    }
    return `<div class="rede-chip"><span class="rede-icone rede-${tipo}"><i class="${icone}"></i></span>
        <div class="rede-texto"><strong>${nome}</strong><span title="${esc(url)}">${esc(rotuloRede(tipo, url))}</span></div>
        <a class="btn-tool" href="${esc(url)}" target="_blank" rel="noopener" title="Abrir ${nome}"><i class="fas fa-external-link-alt"></i></a></div>`;
}

function getIntegracaoHTML() {
    return `<div class="integracao-page">
        <div class="products-page-header"><h2>Integração</h2></div>
        <div class="dashboard-grid">
            <div class="dashboard-card">
                <div class="dashboard-card-header"><h3><i class="fas fa-database"></i> Supabase</h3></div>
                <div class="dashboard-card-body">
                    <p>Status: <span id="integracao-status">${STATE.supabase ? '<span class="badge badge-success">Conectado</span>' : '<span class="badge badge-danger">Desconectado</span>'}</span></p>
                    <p class="text-muted" style="margin-top:8px;font-size:13px;word-break:break-all;">${esc(CONFIG.SUPABASE_URL)}</p>
                    <p class="text-muted" style="margin-top:4px;font-size:13px;">Última sincronização: <span id="integracao-ultima">${STATE.lastUpdate ? new Date(STATE.lastUpdate).toLocaleString('pt-BR') : '—'}</span></p>
                    <div class="mt-20" style="display:flex;gap:10px;flex-wrap:wrap;">
                        <button class="btn btn-primary" onclick="testarConexaoUI()"><i class="fas fa-plug"></i> Testar conexão</button>
                        <button class="btn btn-secondary" onclick="sincronizarUI()"><i class="fas fa-sync-alt"></i> Sincronizar</button>
                    </div>
                </div>
            </div>
            <div class="dashboard-card">
                <div class="dashboard-card-header"><h3><i class="fas fa-shield-alt"></i> Backup</h3></div>
                <div class="dashboard-card-body">
                    <p class="text-muted">Baixe uma cópia de todos os produtos, categorias e configurações em JSON.</p>
                    <button class="btn btn-secondary mt-20" onclick="exportarDados()"><i class="fas fa-download"></i> Exportar backup</button>
                </div>
            </div>
        </div>
    </div>`;
}

async function testarConexaoUI() {
    const ok = await testarConexaoSupabase();
    updateConnectionStatus(ok);
    const el = document.getElementById('integracao-status');
    if (el) el.innerHTML = ok ? '<span class="badge badge-success">Conectado</span>' : '<span class="badge badge-danger">Falhou</span>';
    showToast(ok ? 'Conexão com o Supabase OK' : 'Não foi possível conectar ao Supabase', ok ? 'success' : 'error');
}

async function sincronizarUI() {
    showToast('Sincronizando...', 'info');
    const ok = await syncFromSupabase();
    if (ok) showToast('Dados atualizados', 'success');
}

// ============================================
// CARROSSEL E MINIATURAS
// ============================================
async function carregarMidiasNoCarrossel() {
    for (const img of document.querySelectorAll('img[data-path]')) {
        const p = img.dataset.path;
        if (p && !p.startsWith('http') && !p.startsWith('data:')) {
            try {
                const url = getPublicImageUrl(p);
                if (url) { img.src = url; img.removeAttribute('data-path'); }
            } catch {
                img.src = PLACEHOLDER_IMG;
            }
        }
    }
}

async function carregarMiniaturasRecentes() {
    for (const img of document.querySelectorAll('img[data-thumb-path]')) {
        const p = img.dataset.thumbPath;
        if (p && !p.startsWith('http') && !p.startsWith('data:')) {
            try {
                const url = getPublicImageUrl(p);
                if (url) { img.src = url; img.removeAttribute('data-thumb-path'); }
            } catch {
                img.src = PLACEHOLDER_IMG;
            }
        }
    }
}

function gerarCarrosselMidia(imagens, nome, pid) {
    if (!imagens?.length) {
        return `<div class="media-container media-empty"><img src="${PLACEHOLDER_IMG}" alt="" class="product-media"><span><i class="fas fa-camera"></i> Sem foto</span></div>`;
    }

    if (imagens.length === 1) {
        return `<div class="media-container"><img src="${esc(getPublicImageUrl(imagens[0]))}" alt="${esc(nome)}" class="product-media" loading="lazy" onerror="${ON_IMG_ERROR}"></div>`;
    }

    const id = `carousel-${String(pid || Date.now()).replace(/[^a-z0-9_-]/gi, '')}-${Math.random().toString(36).substring(2, 7)}`;
    return `<div class="media-carousel" id="${id}">
        <div class="carousel-container">
            <div class="carousel-track" style="transform:translateX(0%);">
                ${imagens.map((path, i) => `<div class="carousel-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
                    <img src="${esc(getPublicImageUrl(path))}" alt="${esc(nome)} ${i + 1}" class="product-media" loading="lazy" onerror="${ON_IMG_ERROR}">
                </div>`).join('')}
            </div>
        </div>
        <div class="carousel-indicators">${imagens.map((_, i) => `<button class="carousel-dot ${i === 0 ? 'active' : ''}" aria-label="Foto ${i + 1}" onclick="mudarSlide('${id}', ${i})"></button>`).join('')}</div>
        <button class="carousel-btn carousel-prev" onclick="proximoSlide('${id}', -1)"><i class="fas fa-chevron-left"></i></button>
        <button class="carousel-btn carousel-next" onclick="proximoSlide('${id}', 1)"><i class="fas fa-chevron-right"></i></button>
    </div>`;
}

function proximoSlide(cid, dir) {
    const c = document.getElementById(cid); if (!c) return;
    const slides = c.querySelectorAll('.carousel-slide');
    const dots   = c.querySelectorAll('.carousel-dot');
    const track  = c.querySelector('.carousel-track');
    const active = c.querySelector('.carousel-slide.active');
    if (!active || !slides.length) return;
    const ci = Array.from(slides).indexOf(active);
    const ni = dir === 1 ? (ci + 1) % slides.length : (ci - 1 + slides.length) % slides.length;
    slides.forEach(s => s.classList.remove('active'));
    slides[ni].classList.add('active');
    if (track) track.style.transform = `translateX(-${ni * 100}%)`;
    dots.forEach(d => d.classList.remove('active'));
    if (dots[ni]) dots[ni].classList.add('active');
}

function mudarSlide(cid, index) {
    const c = document.getElementById(cid); if (!c) return;
    const slides = c.querySelectorAll('.carousel-slide');
    const dots   = c.querySelectorAll('.carousel-dot');
    const track  = c.querySelector('.carousel-track');
    if (!slides.length || index < 0 || index >= slides.length) return;
    slides.forEach(s => s.classList.remove('active'));
    slides[index].classList.add('active');
    if (track) track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach(d => d.classList.remove('active'));
    if (dots[index]) dots[index].classList.add('active');
}

// ============================================
// SELEÇÃO EM MASSA
// ============================================
function toggleItemSelection(id, checked) {
    if (checked) STATE.selectedItems.add(id); else STATE.selectedItems.delete(id);
    updateBulkActions();
}

function toggleSelectAll(checked) {
    getCurrentPageItems().forEach(i => checked ? STATE.selectedItems.add(i.id) : STATE.selectedItems.delete(i.id));
    document.querySelectorAll('.item-select-checkbox').forEach(cb => cb.checked = checked);
    updateBulkActions();
}

function getCurrentPageItems() {
    return STATE.page === 'produtos' ? STATE.produtos : STATE.page === 'categorias' ? STATE.categorias : [];
}

function updateBulkActions() {
    const n  = STATE.selectedItems.size;
    const bar = document.getElementById('bulk-actions-bar');
    const el  = document.getElementById('selected-count');
    if (bar) { bar.classList.toggle('active', n > 0); if (el) el.textContent = `${n} item(ns) selecionado(s)`; }
}

async function executeBulkAction(action) {
    const ids = Array.from(STATE.selectedItems);
    if (!ids.length) { showToast('Nenhum item selecionado', 'warning'); return; }
    if (STATE.page === 'produtos'   && action === 'delete') await excluirMultiplosProdutos(ids);
    if (STATE.page === 'produtos'   && (action === 'mostrar' || action === 'ocultar')) await definirVisibilidade(ids, action === 'mostrar');
    if (STATE.page === 'categorias' && action === 'delete') await excluirMultiplasCategorias(ids);
}

// Mostrar/ocultar produtos no site sem excluir
async function definirVisibilidade(ids, ativo) {
    try {
        const { error } = await STATE.supabase.from('produtos')
            .update({ ativo, updated_at: new Date().toISOString() }).in('id', ids);
        if (error) throw error;
        STATE.produtos.forEach(p => { if (ids.includes(p.id)) p.ativo = ativo; });
        STATE.selectedItems.clear();
        loadPage(STATE.page);
        showToast(`${ids.length} produto(s) ${ativo ? 'visível(is) no site' : 'oculto(s) do site'}`, 'success');
    } catch (err) { showToast('Erro: ' + err.message, 'error'); }
}

async function alternarVisibilidadeProduto(id) {
    const p = STATE.produtos.find(x => x.id === id);
    if (p) await definirVisibilidade([id], p.ativo === false);
}

async function duplicarProduto(id) {
    const p = STATE.produtos.find(x => x.id === id);
    if (!p) return;
    if (!confirm(`Duplicar "${p.nome}"? A cópia é criada oculta do site, usando as mesmas fotos.`)) return;
    try {
        const novoId = `prod_${Date.now()}`;
        const codigo = `ACR${Date.now().toString().slice(-6)}`;
        const copia = {
            ...p, id: novoId, codigo, nome: `${p.nome} (cópia)`, ativo: false,
            slug: `${p.slug || 'produto'}-copia-${codigo.toLowerCase()}`,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        const { error } = await STATE.supabase.from('produtos').insert(copia);
        if (error) throw error;
        STATE.produtos.unshift(copia);
        loadPage(STATE.page);
        showToast('Produto duplicado (oculto). Edite e publique quando quiser.', 'success');
    } catch (err) { showToast('Erro ao duplicar: ' + err.message, 'error'); }
}

// ============================================
// UPLOAD DE IMAGEM / REDIMENSIONAMENTO
// ============================================
function getPublicImageUrl(path) {
    if (!path || typeof path !== 'string') return null;
    path = path.trim();
    if (!path) return null;
    if (path.startsWith('data:'))   return path;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/${CONFIG.LOGO_BUCKET}/${path}`;
}

function extrairPathRelativo(val) {
    if (!val || typeof val !== 'string') return '';
    val = val.trim();
    const storageBase = `${CONFIG.SUPABASE_URL}/storage/v1/object/public/${CONFIG.LOGO_BUCKET}/`;
    if (val.startsWith(storageBase)) return val.replace(storageBase, '');
    if (val.startsWith('data:') || val.startsWith('http')) return ''; 
    return val;
}

function redimensionarImagemParaPadrao(file, maxLadoCustom) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas  = document.createElement('canvas');
                let width     = img.width;
                let height    = img.height;
                const maxLado = maxLadoCustom || CONFIG.IMAGEM_PADRAO.MAX_LADO || 1200;

                if (width > height && width > maxLado) {
                    height = Math.round(height * maxLado / width);
                    width  = maxLado;
                } else if (height > maxLado) {
                    width  = Math.round(width * maxLado / height);
                    height = maxLado;
                }

                canvas.width  = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) { reject(new Error('Erro ao processar imagem')); return; }
                    const newFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                        type:         CONFIG.IMAGEM_PADRAO.TIPO || 'image/jpeg',
                        lastModified: Date.now()
                    });
                    newFile.redimensionado = true;
                    resolve(newFile);
                }, CONFIG.IMAGEM_PADRAO.TIPO || 'image/jpeg', CONFIG.IMAGEM_PADRAO.QUALIDADE || 0.85);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}

async function uploadImagemParaStorage(file, produtoId) {
    if (!CONFIG.USE_SUPABASE || !STATE.supabase) throw new Error('Supabase não disponível');
    if (!file || !(file instanceof File)) throw new Error('Arquivo inválido');
    if (!file.type.startsWith('image/')) throw new Error('Arquivo não é uma imagem válida');

    let arq = file;
    if (!file.redimensionado) {
        arq = await redimensionarImagemParaPadrao(file);
    }

    if (arq.size > 10 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 10MB)');

    const randomStr = Math.random().toString(36).substring(2, 10);
    const filePath  = `produtos/${produtoId}/${Date.now()}_${randomStr}.jpg`;

    const { error } = await STATE.supabase.storage
        .from(CONFIG.LOGO_BUCKET)
        .upload(filePath, arq, {
            cacheControl: '3600',
            upsert:       false,
            contentType:  arq.type
        });

    if (error) throw error;
    return filePath; 
}

async function uploadMultiplasImagens(produtoId) {
    if (!produtoId) {
        showToast('ID do produto necessário para upload', 'error');
        return [];
    }

    const items      = [...document.querySelectorAll('.imagem-item')].filter(i => i._arquivo);
    const novosPaths = [];

    await Promise.all(items.map(async (item) => {
        {
            try {
                const path = await uploadImagemParaStorage(item._arquivo, produtoId);
                item.dataset.pathSalvo = path;
                novosPaths.push(path);
                item._arquivo                           = null;
                item.dataset.hasFile                    = 'false';
                const pi                                = item.querySelector('.imagem-path-input');
                if (pi) pi.value                        = path;
                const info                              = item.querySelector('.file-info');
                if (info) info.style.display            = 'none';
            } catch (err) {
                console.error('Erro no upload:', err);
                showToast(`Falha ao enviar: ${item._arquivo?.name || 'arquivo'} — ${err.message}`, 'error');
            }
        }
    }));
    return novosPaths;
}

async function removerMultiplasImagensDoStorage(paths, idsIgnorados = []) {
    if (!CONFIG.USE_SUPABASE || !STATE.supabase || !paths?.length) return false;
    // Não apaga arquivos ainda usados por outro produto (ex.: produtos duplicados)
    const emUso = new Set(STATE.produtos
        .filter(p => !idsIgnorados.includes(p.id))
        .flatMap(p => (p.imagens || []).map(extrairPathRelativo)));
    const pathsValidos = [...new Set(paths.map(p => extrairPathRelativo(p)))]
        .filter(p => p && p.startsWith('produtos/') && !emUso.has(p));
    if (!pathsValidos.length) return true;
    try {
        const { error } = await STATE.supabase.storage.from(CONFIG.LOGO_BUCKET).remove(pathsValidos);
        if (error) console.error('Erro ao remover imagens:', error);
        return !error;
    } catch (err) {
        console.error('Falha no storage:', err);
        return false;
    }
}

// Editor de fotos: grade de miniaturas, 1ª = principal, reordenar, remover,
// adicionar várias de uma vez (botão ou arrastar e soltar). Upload só ao salvar.
const MAX_IMG_BYTES = 10 * 1024 * 1024;

function atualizarBadgesImagens() {
    const items = document.querySelectorAll('#imagens-container .imagem-item');
    items.forEach((it, i) => {
        it.classList.toggle('is-principal', i === 0);
        const b = it.querySelector('.imagem-badge');
        if (b) b.textContent = i === 0 ? 'Principal' : String(i + 1);
    });
    const vazio = document.getElementById('imagens-vazio');
    if (vazio) vazio.hidden = items.length > 0;
}

function addCampoImagem(path = '', arquivo = null) {
    const container = document.getElementById('imagens-container');
    if (!container) return;

    // Sem argumentos (botão antigo "Adicionar Imagem"): abre o seletor de arquivos
    if (!path && !arquivo) { document.getElementById('imagens-file-multi')?.click(); return; }

    const pathRelativo = extrairPathRelativo(path);
    const div = document.createElement('div');
    div.className = 'imagem-item';
    div.dataset.hasFile = arquivo ? 'true' : 'false';
    div.dataset.pathSalvo = arquivo ? '' : pathRelativo;
    div.innerHTML = `
        <img class="imagem-preview" alt="" src="${esc(arquivo ? PLACEHOLDER_IMG : (getPublicImageUrl(pathRelativo || path) || PLACEHOLDER_IMG))}" onerror="${ON_IMG_ERROR}">
        <span class="imagem-badge"></span>
        ${arquivo ? '<span class="imagem-pendente" title="Será enviada ao salvar"><i class="fas fa-cloud-upload-alt"></i></span>' : ''}
        <div class="imagem-acoes">
            <button type="button" class="btn-img" data-acao="esq" title="Mover para a esquerda"><i class="fas fa-arrow-left"></i></button>
            <button type="button" class="btn-img" data-acao="principal" title="Tornar principal"><i class="fas fa-star"></i></button>
            <button type="button" class="btn-img" data-acao="dir" title="Mover para a direita"><i class="fas fa-arrow-right"></i></button>
            <button type="button" class="btn-img btn-img-danger" data-acao="remover" title="Remover"><i class="fas fa-trash"></i></button>
        </div>
        <input type="hidden" class="imagem-path-input" value="${esc(pathRelativo)}">`;

    if (arquivo) {
        div._arquivo = arquivo;
        const r = new FileReader();
        r.onload = ev => { div.querySelector('.imagem-preview').src = ev.target.result; };
        r.readAsDataURL(arquivo);
    }

    div.addEventListener('click', e => {
        const b = e.target.closest('.btn-img'); if (!b) return;
        const acao = b.dataset.acao;
        if (acao === 'remover') { div._arquivo = null; div.remove(); }
        if (acao === 'principal') container.prepend(div);
        if (acao === 'esq' && div.previousElementSibling) container.insertBefore(div, div.previousElementSibling);
        if (acao === 'dir' && div.nextElementSibling) container.insertBefore(div.nextElementSibling, div);
        atualizarBadgesImagens();
    });

    container.appendChild(div);
    atualizarBadgesImagens();
    return div;
}

function adicionarArquivosImagem(files) {
    let ignorados = 0;
    [...(files || [])].forEach(f => {
        if (!f.type.startsWith('image/') || f.size > MAX_IMG_BYTES) { ignorados++; return; }
        addCampoImagem('', f);
    });
    if (ignorados) showToast(`${ignorados} arquivo(s) ignorado(s): use imagens de até 10MB.`, 'warning');
}

function setupUploadImagens() {
    const input = document.getElementById('imagens-file-multi');
    const zona  = document.getElementById('imagens-dropzone');
    input?.addEventListener('change', () => { adicionarArquivosImagem(input.files); input.value = ''; });
    if (!zona) return;
    zona.addEventListener('click', () => input?.click());
    zona.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input?.click(); } });
    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove('dragover'); }));
    zona.addEventListener('drop', e => adicionarArquivosImagem(e.dataTransfer.files));
}

// ============================================
// PRODUTOS: CADASTRO E SOB CONSULTA
// ============================================
function togglePrecoInput() {
    const isConsultar = document.getElementById('produto-sob-consulta')?.checked;
    const inputPreco  = document.getElementById('produto-preco');
    if (inputPreco) {
        inputPreco.disabled = isConsultar;
        if (isConsultar) inputPreco.value = '';
    }
}

function abrirModalProduto(produtoId = null) {
    STATE.editingId = produtoId;
    const modal = document.getElementById('modal-produto');
    const title = document.getElementById('modal-produto-title');
    if (!modal || !title) return;

    title.textContent = produtoId ? 'Editar Produto' : 'Novo Produto';
    document.getElementById('form-produto')?.reset();

    const ic = document.getElementById('imagens-container');
    if (ic) ic.innerHTML = '';

    const cs = document.getElementById('categoria-produto');
    if (cs) {
        cs.innerHTML = '<option value="">Sem categoria</option>' +
            STATE.categorias.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
    }

    if (produtoId) {
        const p = STATE.produtos.find(x => x.id === produtoId);
        if (p) {
            document.getElementById('produto-id').value                = p.id;
            document.getElementById('produto-nome').value              = p.nome || '';
            document.getElementById('produto-codigo').value            = p.codigo || '';
            document.getElementById('produto-descricao-simples').value = p.descricao_simples || '';
            document.getElementById('produto-descricao').value         = p.descricao || '';
            if (cs) cs.value = p.categoria_id || '';

            const checkConsulta = document.getElementById('produto-sob-consulta');
            if (checkConsulta) checkConsulta.checked = !!p.sob_consulta;
            document.getElementById('produto-preco').value = p.sob_consulta ? '' : (p.preco || '');
            togglePrecoInput();

            const ativoEl = document.getElementById('produto-ativo');
            if (ativoEl) ativoEl.checked = p.ativo !== false;
            (p.imagens || []).forEach(img => { if (img) addCampoImagem(img); });
        }
    } else {
        document.getElementById('produto-id').value = '';
        document.getElementById('produto-codigo').value = `ACR${Date.now().toString().slice(-6)}`;

        const checkConsulta = document.getElementById('produto-sob-consulta');
        if (checkConsulta) checkConsulta.checked = false;
        togglePrecoInput();
        const ativoEl = document.getElementById('produto-ativo');
        if (ativoEl) ativoEl.checked = true;
    }
    atualizarBadgesImagens();
    openModal('modal-produto');
    setTimeout(() => document.getElementById('produto-nome')?.focus(), 100);
}

let _salvandoProduto = false;
async function salvarProduto() {
    if (_salvandoProduto) return;            // evita duplo clique / envio duplicado
    const btnSalvar = document.querySelector('button[form="form-produto"]');
    const btnHTML   = btnSalvar?.innerHTML;
    try {
        const nome   = document.getElementById('produto-nome')?.value?.trim();
        const codigo = document.getElementById('produto-codigo')?.value?.trim();
        if (!nome)   { document.getElementById('produto-nome')?.focus();   throw new Error('Nome do produto é obrigatório'); }
        if (!codigo) { document.getElementById('produto-codigo')?.focus(); throw new Error('Código do produto é obrigatório'); }

        const isEditing = !!STATE.editingId;
        const produtoId = isEditing
            ? (document.getElementById('produto-id')?.value || STATE.editingId)
            : `prod_${Date.now()}`;

        // Código precisa ser único (é a referência enviada no WhatsApp)
        const codigoDuplicado = STATE.produtos.find(p => p.id !== produtoId && (p.codigo || '').toLowerCase() === codigo.toLowerCase());
        if (codigoDuplicado) throw new Error(`O código "${codigo}" já é usado por "${codigoDuplicado.nome}"`);

        const sobConsulta = document.getElementById('produto-sob-consulta')?.checked || false;
        const precoNum    = parseFloat(String(document.getElementById('produto-preco')?.value || '0').replace(',', '.')) || 0;
        if (!sobConsulta && precoNum < 0) throw new Error('Preço inválido');

        _salvandoProduto = true;
        if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'; }

        const items = [...document.querySelectorAll('.imagem-item')];
        if (items.some(i => i._arquivo)) {
            showToast('Enviando imagens...', 'info');
            await uploadMultiplasImagens(produtoId);
        }
        // Mantém a ordem exibida no formulário (a 1ª imagem é a principal)
        const imagens = items
            .filter(i => !i._arquivo)
            .map(i => i.dataset.pathSalvo || extrairPathRelativo(i.querySelector('.imagem-path-input')?.value?.trim() || ''))
            .filter(Boolean);

        const slugTexto = normalizar(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const anterior  = isEditing ? STATE.produtos.find(p => p.id === produtoId) : null;

        const pd = {
            id:                produtoId,
            nome,
            codigo,
            slug:              `${slugTexto}-${codigo.toLowerCase()}`,
            categoria_id:      document.getElementById('categoria-produto')?.value || null,
            preco:             sobConsulta ? 0 : precoNum,
            sob_consulta:      sobConsulta,
            descricao_simples: document.getElementById('produto-descricao-simples')?.value?.trim() || '',
            descricao:         document.getElementById('produto-descricao')?.value?.trim() || '',
            imagens,
            imagem_principal:  imagens[0] || null,
            ativo:             document.getElementById('produto-ativo')?.checked ?? true,
            updated_at:        new Date().toISOString(),
            created_at:        anterior?.created_at || new Date().toISOString()
        };

        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            const { error } = await STATE.supabase.from('produtos').upsert(pd, { onConflict: 'id' });
            if (error) throw new Error(error.message);
        }

        // Fotos removidas na edição: apaga do storage (antes ficavam órfãs)
        const removidas = (anterior?.imagens || []).map(extrairPathRelativo).filter(p => p && !imagens.includes(p));

        if (anterior) {
            const idx = STATE.produtos.findIndex(p => p.id === produtoId);
            STATE.produtos[idx] = pd;
        } else {
            STATE.produtos.unshift(pd);
        }
        if (removidas.length) removerMultiplasImagensDoStorage(removidas);

        CacheManager.set('produtos', STATE.produtos);
        closeModal('modal-produto');
        updateCounters();
        loadPage(STATE.page);
        showToast(`Produto ${isEditing ? 'atualizado' : 'criado'} com sucesso!`, 'success');
    } catch (err) {
        showToast('Erro: ' + err.message, 'error');
        console.error('salvarProduto:', err);
    } finally {
        _salvandoProduto = false;
        if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.innerHTML = btnHTML; }
    }
}

async function excluirProduto(id) {
    if (!confirm('Excluir este produto? Esta ação não pode ser desfeita.')) return;
    try {
        const p = STATE.produtos.find(x => x.id === id);
        if (!p) throw new Error('Produto não encontrado');

        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            const { error } = await STATE.supabase.from('produtos').delete().eq('id', id);
            if (error) throw new Error(error.message);
        }
        if (p.imagens?.length) {
            await removerMultiplasImagensDoStorage(p.imagens.filter(Boolean), [id]);
        }

        STATE.produtos = STATE.produtos.filter(x => x.id !== id);
        updateCounters();
        loadPage(STATE.page);
        showToast('✅ Produto excluído!', 'success');
    } catch (err) { showToast('Erro: ' + err.message, 'error'); }
}

async function excluirMultiplosProdutos(ids) {
    if (!ids?.length) return;
    if (!confirm(`Excluir ${ids.length} produto(s) e suas fotos? Esta ação não pode ser desfeita.`)) return;
    try {
        const toDelete = STATE.produtos.filter(p => ids.includes(p.id));
        const imgs     = toDelete.flatMap(p => p.imagens?.filter(Boolean) || []);

        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            const { error } = await STATE.supabase.from('produtos').delete().in('id', ids);
            if (error) throw new Error(error.message);
        }
        if (imgs.length) await removerMultiplasImagensDoStorage(imgs, ids);

        STATE.produtos = STATE.produtos.filter(p => !ids.includes(p.id));
        STATE.selectedItems.clear();
        updateCounters();
        loadPage(STATE.page);
        showToast(`✅ ${ids.length} produto(s) excluído(s)!`, 'success');
    } catch (err) { showToast('Erro: ' + err.message, 'error'); }
}

// ============================================
// CATEGORIAS E CONFIG SITE
// ============================================
function abrirModalCategoria(id = null) {
    STATE.editingId = id;
    const modal = document.getElementById('modal-categoria');
    const title = document.getElementById('modal-categoria-title');
    if (!modal || !title) return;
    title.textContent = id ? 'Editar Categoria' : 'Nova Categoria';
    document.getElementById('form-categoria')?.reset();

    if (id) {
        const c = STATE.categorias.find(x => x.id === id);
        if (c) {
            document.getElementById('categoria-id').value    = c.id;
            document.getElementById('categoria-nome').value  = c.nome   || '';
            document.getElementById('categoria-icone').value = c.icone  || 'fas fa-box';
            const ord = document.getElementById('categoria-ordem'); if (ord) ord.value = Number(c.ordem) || 0;
            const at  = document.getElementById('categoria-ativo'); if (at) at.checked = c.ativo !== false;
        }
    } else {
        document.getElementById('categoria-id').value = '';
        const ord = document.getElementById('categoria-ordem'); if (ord) ord.value = STATE.categorias.length;
        const at  = document.getElementById('categoria-ativo'); if (at) at.checked = true;
    }
    atualizarPreviewIcone();
    openModal('modal-categoria');
    setTimeout(() => document.getElementById('categoria-nome')?.focus(), 100);
}

async function salvarCategoria() {
    try {
        const isEditing = !!STATE.editingId;
        const catId     = isEditing ? STATE.editingId : 'cat_' + Date.now();
        const nome      = document.getElementById('categoria-nome').value.trim();
        const icone     = document.getElementById('categoria-icone').value.trim() || 'fas fa-box';
        if (!nome) throw new Error('Nome é obrigatório');

        if (STATE.categorias.some(c => c.id !== catId && normalizar(c.nome) === normalizar(nome)))
            throw new Error('Já existe uma categoria com esse nome');

        const now   = new Date().toISOString();
        const ordem = parseInt(document.getElementById('categoria-ordem')?.value, 10) || 0;
        const ativo = document.getElementById('categoria-ativo')?.checked ?? true;
        const slug  = normalizar(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const d     = { id: catId, nome, slug, icone: safeIcon(icone), ordem, ativo, updated_at: now };
        const idx   = STATE.categorias.findIndex(c => c.id === catId);
        if (idx < 0) d.created_at = now;

        // Grava primeiro no banco; só atualiza a tela se deu certo
        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            const { error } = await STATE.supabase.from('categorias').upsert(d, { onConflict: 'id' });
            if (error) throw new Error(error.message);
        }
        if (idx >= 0) STATE.categorias[idx] = { ...STATE.categorias[idx], ...d };
        else STATE.categorias.push(d);
        STATE.categorias.sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || a.nome.localeCompare(b.nome));

        closeModal('modal-categoria');
        loadPage(STATE.page);
        showToast(`Categoria ${isEditing ? 'atualizada' : 'criada'}!`, 'success');
    } catch (err) { showToast('Erro: ' + err.message, 'error'); }
}

async function excluirCategoria(id) {
    if (STATE.produtos.some(p => p.categoria_id === id)) {
        alert('Não é possível excluir: existem produtos nesta categoria.');
        return;
    }
    if (!confirm('Excluir esta categoria?')) return;
    try {
        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            const { error } = await STATE.supabase.from('categorias').delete().eq('id', id);
            if (error) throw new Error(error.message);
        }
        STATE.categorias = STATE.categorias.filter(c => c.id !== id);
        loadPage(STATE.page);
        showToast('✅ Categoria excluída!', 'success');
    } catch (err) { showToast('Erro: ' + err.message, 'error'); }
}

// NOVA FUNÇÃO: Excluir múltiplas categorias de uma vez
async function excluirMultiplasCategorias(ids) {
    if (!ids?.length) return;

    const categoriasComProdutos = STATE.produtos
        .filter(p => ids.includes(p.categoria_id))
        .map(p => p.categoria_id);
    
    const idsSegurosParaExcluir = ids.filter(id => !categoriasComProdutos.includes(id));

    if (idsSegurosParaExcluir.length !== ids.length) {
        const ignoradas = ids.length - idsSegurosParaExcluir.length;
        alert(`${ignoradas} categoria(s) não pode(m) ser excluída(s) pois possui(m) produtos vinculados.`);
        if (idsSegurosParaExcluir.length === 0) return; 
    }

    if (!confirm(`Deseja realmente excluir ${idsSegurosParaExcluir.length} categoria(s)?`)) return;

    try {
        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            const { error } = await STATE.supabase.from('categorias').delete().in('id', idsSegurosParaExcluir);
            if (error) throw new Error(error.message);
        }

        STATE.categorias = STATE.categorias.filter(c => !idsSegurosParaExcluir.includes(c.id));
        STATE.selectedItems.clear();
        loadPage(STATE.page);
        showToast(`✅ ${idsSegurosParaExcluir.length} categoria(s) excluída(s)!`, 'success');
    } catch (err) { 
        showToast('Erro: ' + err.message, 'error'); 
    }
}

function abrirModalConfigSite(foco) {
    const modal = document.getElementById('modal-config-site'); if (!modal) return;
    document.getElementById('user-dropdown')?.classList.remove('active');
    const c   = STATE.configSite || obterConfigSite();
    const map = {
        'config-empresa-nome': 'empresa_nome',
        'config-email':        'email',
        'config-telefone':     'telefone',
        'config-whatsapp':     'whatsapp',
        'config-endereco':     'endereco',
        'config-cidade':       'cidade',
        'config-estado':       'estado',
        'config-cep':          'cep'
    };
    Object.entries(map).forEach(([elId, key]) => { const el = document.getElementById(elId); if (el) el.value = c[key] || ''; });
    const redes = c.redes_sociais || {};
    document.getElementById('config-instagram').value = redes.instagram || '';
    document.getElementById('config-facebook').value  = redes.facebook  || '';

    const lista = document.getElementById('config-horarios-lista');
    lista.innerHTML = '';
    const hor = Array.isArray(c.horario_funcionamento) && c.horario_funcionamento.length
        ? c.horario_funcionamento
        : [{ dia: 'Seg a Sex', horario: '08:00 às 18:00' }];
    hor.forEach(h => addLinhaHorario(h.dia, h.horario));

    const prev = document.getElementById('config-banner-preview');
    if (prev) prev.src = c.imagem_oficina ? getPublicImageUrl(c.imagem_oficina) : PLACEHOLDER_IMG;
    STATE._bannerArquivo = null;
    const bannerInput = document.getElementById('config-banner-file'); if (bannerInput) bannerInput.value = '';

    openModal('modal-config-site');
    if (foco === 'banner') setTimeout(() => document.getElementById('config-banner-group')?.scrollIntoView({ behavior: 'smooth' }), 150);
}

function addLinhaHorario(dia = '', horario = '') {
    const lista = document.getElementById('config-horarios-lista'); if (!lista) return;
    const row = document.createElement('div');
    row.className = 'horario-row';
    row.innerHTML = `
        <input type="text" class="horario-dia" placeholder="Ex: Seg a Sex" value="${esc(dia)}" aria-label="Dias">
        <input type="text" class="horario-hora" placeholder="Ex: 08:00 às 18:00" value="${esc(horario)}" aria-label="Horário">
        <button type="button" class="btn-tool btn-tool-danger" title="Remover" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
    lista.appendChild(row);
}

function selecionarBanner(input) {
    const f = input.files?.[0]; if (!f) return;
    if (!f.type.startsWith('image/') || f.size > MAX_IMG_BYTES) { showToast('Use uma imagem de até 10MB', 'warning'); input.value = ''; return; }
    STATE._bannerArquivo = f;
    const r = new FileReader();
    r.onload = ev => { document.getElementById('config-banner-preview').src = ev.target.result; };
    r.readAsDataURL(f);
}

async function salvarConfigSite() {
    const btn  = document.querySelector('button[form="form-config-site"]');
    const html = btn?.innerHTML;
    try {
        const email = document.getElementById('config-email').value.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido');
        let whatsapp = document.getElementById('config-whatsapp').value.replace(/\D/g, '');
        if (whatsapp && whatsapp.length < 10) throw new Error('WhatsApp deve ter DDD + número (ex: 11 99999-9999)');
        if (whatsapp && whatsapp.length <= 11) whatsapp = '55' + whatsapp;   // adiciona código do Brasil
        const urlOk = (u) => !u || /^https?:\/\//i.test(u);
        const instagram = document.getElementById('config-instagram').value.trim();
        const facebook  = document.getElementById('config-facebook').value.trim();
        if (!urlOk(instagram) || !urlOk(facebook)) throw new Error('Links das redes devem começar com https://');

        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...'; }

        const horarios = [...document.querySelectorAll('#config-horarios-lista .horario-row')]
            .map(r => ({ dia: r.querySelector('.horario-dia').value.trim(), horario: r.querySelector('.horario-hora').value.trim() }))
            .filter(h => h.dia || h.horario);

        const d = {
            empresa_nome:          document.getElementById('config-empresa-nome').value.trim(),
            email,
            telefone:              document.getElementById('config-telefone').value.trim(),
            whatsapp,
            endereco:              document.getElementById('config-endereco').value.trim(),
            cidade:                document.getElementById('config-cidade').value.trim(),
            estado:                document.getElementById('config-estado').value.trim(),
            cep:                   document.getElementById('config-cep').value.trim(),
            horario_funcionamento: horarios,
            redes_sociais:         { ...(STATE.configSite?.redes_sociais || {}), instagram, facebook },
            updated_at:            new Date().toISOString()
        };

        // Novo banner da página inicial
        const bannerAntigo = STATE.configSite?.imagem_oficina;
        if (STATE._bannerArquivo) {
            const arq  = await redimensionarImagemParaPadrao(STATE._bannerArquivo, 2000);
            const path = `site/oficina_${Date.now()}.jpg`;
            const { error: upErr } = await STATE.supabase.storage.from(CONFIG.LOGO_BUCKET)
                .upload(path, arq, { cacheControl: '31536000', upsert: false, contentType: arq.type });
            if (upErr) throw new Error('Falha ao enviar banner: ' + upErr.message);
            d.imagem_oficina = path;
        }

        const novo = { id: CONFIG.LOGO_CONFIG_ID, ...STATE.configSite, ...d };
        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            const { error } = await STATE.supabase.from('config_site').upsert(novo, { onConflict: 'id' });
            if (error) throw new Error(error.message);
        }
        STATE.configSite = novo;
        if (d.imagem_oficina && bannerAntigo && bannerAntigo !== d.imagem_oficina && bannerAntigo.startsWith('site/oficina_')) {
            STATE.supabase.storage.from(CONFIG.LOGO_BUCKET).remove([bannerAntigo]).catch(() => {});
        }
        STATE._bannerArquivo = null;
        closeModal('modal-config-site');
        if (STATE.page === 'configuracoes') loadPage('configuracoes');
        showToast('Configurações salvas! Já estão no site.', 'success');
    } catch (err) {
        showToast('Erro: ' + err.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = html; }
    }
}

function atualizarPreviewIcone() {
    const v  = document.getElementById('categoria-icone')?.value?.trim();
    const el = document.getElementById('categoria-icone-preview');
    if (el) el.innerHTML = `<i class="${esc(safeIcon(v))}"></i>`;
}

function escolherIcone(classe) {
    const inp = document.getElementById('categoria-icone');
    if (inp) { inp.value = classe; atualizarPreviewIcone(); }
}

function obterConfigSite() {
    return { empresa_nome: 'Acrilife', email: '', telefone: '', whatsapp: '', endereco: '', cidade: '', estado: '', cep: '' };
}

// ============================================
// EVENTOS PRINCIPAIS, DROPDOWN E PESQUISA
// ============================================
function initUI() {
    updateSessionTime(); setInterval(updateSessionTime, 60000);
    updateMemoryUsage(); setInterval(updateMemoryUsage, 30000);
}
function updateSessionTime() { const el = document.getElementById('session-time'); if (el) el.textContent = new Date().toLocaleTimeString('pt-BR'); }
function updateCounters()    { const el = document.getElementById('produtos-count'); if (el) el.textContent = STATE.produtos.length; }
function updateLastUpdate() {
    const el = document.getElementById('last-update');
    if (el && STATE.lastUpdate) {
        const d = Math.floor((new Date() - new Date(STATE.lastUpdate)) / 60000);
        el.textContent = d < 1 ? 'Agora mesmo' : d < 60 ? `Há ${d} min` : new Date(STATE.lastUpdate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
}
function updateMemoryUsage() {
    if (performance?.memory) {
        const el = document.getElementById('memory-usage');
        if (el) el.textContent = `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB`;
    }
}

function setupCoreEvents() {
    const mt = document.getElementById('menu-toggle');
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');

    if (mt) mt.addEventListener('click', () => {
        sb.classList.toggle('collapsed');
        if (window.innerWidth <= 768) { sb.classList.toggle('active'); ov.classList.toggle('active'); }
    });
    if (ov) ov.addEventListener('click', () => { sb.classList.remove('active'); ov.classList.remove('active'); });

    document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', function(e) {
        e.preventDefault();
        navigateTo(this.dataset.page);
        if (window.innerWidth <= 768) { sb.classList.remove('active'); ov.classList.remove('active'); }
    }));

    const bs = document.getElementById('btn-sync');
    if (bs) bs.addEventListener('click', async () => {
        showToast('Sincronizando...', 'info');
        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            await syncFromSupabase();
            showToast('Sincronização completa', 'success');
        }
    });

    const userMenuBtn  = document.getElementById('user-menu-button');
    const userDropdown = document.getElementById('user-dropdown');
    if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = userDropdown.classList.toggle('active');
            userMenuBtn.setAttribute('aria-expanded', isOpen.toString());
        });
        document.addEventListener('click', (e) => {
            if (!userMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
                userDropdown.classList.remove('active');
                userMenuBtn.setAttribute('aria-expanded', 'false');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && userDropdown.classList.contains('active')) {
                userDropdown.classList.remove('active');
                userMenuBtn.setAttribute('aria-expanded', 'false');
                userMenuBtn.focus();
            }
        });
    }

    const searchInput = document.getElementById('global-search');
    const searchBtn   = document.querySelector('.search-btn');

    const executarBusca = () => {
        const val = searchInput?.value?.trim();
        if (val && val.length >= 2) performSearch(val);
    };

    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); executarBusca(); }
        });
    }
    if (searchBtn) {
        searchBtn.addEventListener('click', (e) => { e.preventDefault(); executarBusca(); });
    }

    setupModals();
}

function setupModals() {
    document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', function(e) {
        if (e.target === this) closeModal(this.id);
    }));
    document.querySelectorAll('.modal-close, [data-dismiss="modal"]').forEach(btn => btn.addEventListener('click', function() {
        const m = this.closest('.modal'); if (m) closeModal(m.id);
    }));

    const fp = document.getElementById('form-produto');
    if (fp) fp.addEventListener('submit', e => { e.preventDefault(); salvarProduto(); });

    const fc = document.getElementById('form-categoria');
    if (fc) fc.addEventListener('submit', e => { e.preventDefault(); salvarCategoria(); });

    const fcs = document.getElementById('form-config-site');
    if (fcs) fcs.addEventListener('submit', e => { e.preventDefault(); salvarConfigSite(); });
}

function openModal(id) {
    const m = document.getElementById(id);
    if (m) { STATE.currentModal = id; m.classList.add('active'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.remove('active'); document.body.style.overflow = ''; STATE.currentModal = null; STATE.editingId = null; }
}

function showToast(message, type = 'info') {
    const c = document.getElementById('toast-container'); if (!c) return;
    const icons = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };
    const t     = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    t.innerHTML = `<div class="toast-icon"><i class="fas fa-${icons[type] || icons.info}"></i></div><div class="toast-content">${esc(message)}</div><button class="toast-close" aria-label="Fechar" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>`;
    c.appendChild(t);
    while (c.children.length > 4) c.firstElementChild.remove();
    const dur = type === 'error' ? 6000 : 3000;
    setTimeout(() => t.classList.add('hiding'), dur);
    setTimeout(() => t.remove(), dur + 300);
}

function performSearch(q) {
    const termo = q.toLowerCase().trim();
    if (!termo) return;

    let resultado = STATE.produtos.find(p => p.codigo?.toLowerCase() === termo);
    if (!resultado) resultado = STATE.produtos.find(p => p.nome?.toLowerCase() === termo);
    if (!resultado) resultado = STATE.produtos.find(p =>
        p.codigo?.toLowerCase().includes(termo) || p.nome?.toLowerCase().includes(termo)
    );

    if (resultado) {
        navigateTo('produtos');
        const input = document.getElementById('global-search');
        if (input) input.value = '';
        setTimeout(() => {
            abrirModalProduto(resultado.id);
            showToast(`Produto encontrado: ${resultado.nome}`, 'success');
        }, 200);
    } else {
        showToast(`Nenhum produto encontrado: "${q}"`, 'warning');
    }
}

// ============================================
// MÓDULO PERFIL E LOGOUT
// ============================================
const RESET_COOLDOWN_MS   = 60_000;
const RESET_LAST_SENT_KEY = 'acrilife_reset_last_sent';
const NOME_REGEX          = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9 _'\\-]{2,40}$/;

function _getAdminEmail()    { const email = STATE?.user?.email || window._adminUser?.email || null; if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null; return email.trim().toLowerCase(); }
function _getAdminNomeAtual() { return STATE?.user?.nome || STATE?.user?.email?.split('@')[0] || 'Admin'; }
function _setBtnLoading(btn, loading, loadingText, defaultHTML) {
    if (!btn) return;
    btn.disabled  = loading;
    btn.innerHTML = loading ? `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${loadingText}` : defaultHTML;
}
function _showEl(id, visible) {
    const el = document.getElementById(id); if (!el) return;
    if (visible) { el.removeAttribute('hidden'); el.style.display = ''; }
    else { el.setAttribute('hidden', ''); }
}

function abrirModalPerfil() {
    const dd = document.getElementById('user-dropdown');
    if (dd) { dd.classList.remove('active'); document.getElementById('user-menu-button')?.setAttribute('aria-expanded', 'false'); }
    switchPerfilTab('nome');
    const nomeAtual  = _getAdminNomeAtual();
    const inputAtual = document.getElementById('perfil-nome-atual');
    const inputNovo  = document.getElementById('perfil-novo-nome');
    const avatarEl   = document.getElementById('perfil-avatar-display');
    if (inputAtual) inputAtual.value = nomeAtual;
    if (inputNovo)  inputNovo.value  = '';
    if (avatarEl)   avatarEl.textContent = nomeAtual.substring(0, 2).toUpperCase();
    _atualizarEmailDisplay();
    _resetSenhaStep();
    openModal('modal-perfil');
}

function switchPerfilTab(tab) {
    document.querySelectorAll('.perfil-tab').forEach(t => {
        const active = t.id === `tab-btn-${tab}`;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active.toString());
    });
    document.querySelectorAll('.perfil-tab-content').forEach(p => {
        const active = p.id === `perfil-tab-${tab}`;
        p.classList.toggle('active', active);
        active ? p.removeAttribute('hidden') : p.setAttribute('hidden', '');
    });
    if (tab === 'senha') _atualizarEmailDisplay();
}

function _atualizarEmailDisplay() {
    const email = _getAdminEmail();
    const el    = document.getElementById('senha-email-display');
    if (!el) return;
    el.textContent = email || 'E-mail da conta não encontrado';
    el.style.color = email ? '' : 'var(--danger-color, #ef4444)';
}

function _resetSenhaStep() {
    _showEl('senha-step-solicitar', true);
    _showEl('senha-step-aguardando', true);
    _showEl('senha-step-sucesso', false);
    ['senha-atual-input', 'senha-nova-input', 'senha-confirmar-input'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    avaliarForcaSenha('');
    _showEl('senha-cooldown-msg', false);
}

function voltarParaSolicitar() {
    _showEl('senha-step-aguardando', false);
    _showEl('senha-step-solicitar', true);
}

async function salvarNomePerfil(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('perfil-novo-nome');
    const btn   = document.getElementById('btn-salvar-nome');
    if (!input) return;
    const novoNome = input.value.trim();
    if (!novoNome) { showToast('Informe o novo nome de exibição.', 'warning'); input.focus(); return; }
    if (!NOME_REGEX.test(novoNome)) { showToast('Nome inválido. Use letras, números e espaços (2-40 chars).', 'warning'); input.focus(); return; }
    if (novoNome === _getAdminNomeAtual()) { showToast('O nome informado é igual ao atual.', 'info'); return; }
    _setBtnLoading(btn, true, 'Salvando...', '<i class="fas fa-save" aria-hidden="true"></i> <span>Salvar Nome</span>');
    try {
        if (CONFIG.USE_SUPABASE && STATE.supabase) {
            // Nome fica no próprio usuário (Supabase Auth → user_metadata); não precisa de coluna no banco
            const { error } = await STATE.supabase.auth.updateUser({ data: { display_name: novoNome } });
            if (error) throw new Error(error.message);
            if (STATE.user) STATE.user.nome = novoNome;
            if (window._adminUser) window._adminUser.nome = novoNome;
        }
        updateUserUI(novoNome);
        if (STATE.page === 'dashboard') loadPage('dashboard');   // atualiza a saudação
        const inputAtual = document.getElementById('perfil-nome-atual');
        const avatarEl   = document.getElementById('perfil-avatar-display');
        if (inputAtual) inputAtual.value = novoNome;
        if (avatarEl)   avatarEl.textContent = novoNome.substring(0, 2).toUpperCase();
        input.value = '';
        showToast('✅ Nome atualizado com sucesso!', 'success');
    } catch (err) {
        showToast('Erro ao salvar nome: ' + err.message, 'error');
    } finally {
        _setBtnLoading(btn, false, '', '<i class="fas fa-save" aria-hidden="true"></i> <span>Salvar Nome</span>');
    }
}

async function solicitarResetSenha() {
    const btn = document.getElementById('btn-solicitar-reset');
    if (!CONFIG.USE_SUPABASE || !STATE.supabase) { showToast('Supabase não disponível.', 'error'); return; }
    const email = _getAdminEmail();
    if (!email) { showToast('E-mail de recuperação não configurado.', 'error'); return; }
    const lastSent  = parseInt(sessionStorage.getItem(RESET_LAST_SENT_KEY) || '0', 10);
    const elapsed   = Date.now() - lastSent;
    const remaining = Math.ceil((RESET_COOLDOWN_MS - elapsed) / 1000);
    if (elapsed < RESET_COOLDOWN_MS) {
        const msgEl = document.getElementById('senha-cooldown-msg');
        if (msgEl) {
            msgEl.innerHTML = `<i class="fas fa-clock"></i> Aguarde ${remaining}s antes de reenviar.`;
            msgEl.removeAttribute('hidden');
            _iniciarCountdownCooldown(remaining, msgEl);
        }
        return;
    }
    _setBtnLoading(btn, true, 'Enviando...', '<i class="fas fa-paper-plane" aria-hidden="true"></i> <span>Enviar Link de Verificação</span>');
    try {
        const redirectTo = new URL('reset-password.html', window.location.href).href;
        const { error }  = await STATE.supabase.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw new Error(error.message);
        sessionStorage.setItem(RESET_LAST_SENT_KEY, Date.now().toString());
        showToast(`Link de redefinição enviado para ${email}. Abra o e-mail para criar a nova senha.`, 'success');
    } catch (err) {
        showToast('Erro ao enviar e-mail: ' + err.message, 'error');
    } finally {
        _setBtnLoading(btn, false, '', '<i class="fas fa-paper-plane" aria-hidden="true"></i> <span>Enviar Link de Verificação</span>');
    }
}

function _iniciarCountdownCooldown(seconds, msgEl) {
    let rem = seconds;
    const iv = setInterval(() => {
        rem--;
        if (rem <= 0) { clearInterval(iv); msgEl.setAttribute('hidden', ''); return; }
        msgEl.innerHTML = `<i class="fas fa-clock"></i> Aguarde ${rem}s antes de reenviar.`;
    }, 1000);
}

async function confirmarNovaSenha(e) {
    if (e) e.preventDefault();
    const atual       = document.getElementById('senha-atual-input')?.value || '';
    const novaSenha   = document.getElementById('senha-nova-input')?.value || '';
    const confirmar   = document.getElementById('senha-confirmar-input')?.value || '';
    const btn         = document.getElementById('btn-confirmar-senha');
    const email       = _getAdminEmail();
    const btnHTML     = '<i class="fas fa-check-circle" aria-hidden="true"></i> <span>Alterar senha</span>';

    if (!atual)     { showToast('Informe sua senha atual.', 'warning'); document.getElementById('senha-atual-input')?.focus(); return; }
    if (!novaSenha) { showToast('Informe a nova senha.', 'warning'); return; }
    const forca = _calcularForcaSenha(novaSenha);
    if (forca.score < 3) { showToast('Senha muito fraca. ' + forca.feedback, 'warning'); return; }
    if (novaSenha !== confirmar) { showToast('As senhas não coincidem.', 'warning'); return; }
    if (novaSenha === atual) { showToast('A nova senha deve ser diferente da atual.', 'warning'); return; }
    if (!STATE.supabase || !email) { showToast('Sessão inválida. Entre novamente.', 'error'); return; }

    _setBtnLoading(btn, true, 'Verificando...', btnHTML);
    try {
        const { error: authErr } = await STATE.supabase.auth.signInWithPassword({ email, password: atual });
        if (authErr) throw new Error('Senha atual incorreta.');
        const { error: updErr } = await STATE.supabase.auth.updateUser({ password: novaSenha });
        if (updErr) throw new Error('Erro ao atualizar senha: ' + updErr.message);
        _showEl('senha-step-aguardando', false);
        _showEl('senha-step-sucesso', true);
        showToast('Senha alterada! Entre novamente com a nova senha.', 'success');
        setTimeout(() => { if (typeof confirmLogout === 'function') confirmLogout(); }, 3000);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        _setBtnLoading(btn, false, '', btnHTML);
    }
}

function _calcularForcaSenha(senha) {
    let score = 0;
    const checks = {
        length: senha.length >= 8,
        mixed:  /[a-z]/.test(senha) && /[A-Z]/.test(senha),
        number: /\d/.test(senha),
        symbol: /[^A-Za-z0-9]/.test(senha)
    };
    if (checks.length) score++;
    if (checks.mixed)  score++;
    if (checks.number) score++;
    if (checks.symbol) score++;
    const labels   = ['', 'Fraca', 'Regular', 'Boa', 'Forte'];
    const feedback = score < 4 ? 'Inclua: ' + [
        !checks.length ? '8+ caracteres'          : null,
        !checks.mixed  ? 'maiúsculas/minúsculas'  : null,
        !checks.number ? 'números'                : null,
        !checks.symbol ? 'símbolos'               : null
    ].filter(Boolean).join(', ') : '';
    return { score, label: labels[score] || '', feedback };
}

function avaliarForcaSenha(valor) {
    const fill    = document.getElementById('senha-forca-fill');
    const label   = document.getElementById('senha-forca-label');
    const wrapper = document.getElementById('senha-forca-wrapper');
    if (!fill || !label || !wrapper) return;
    if (!valor) {
        fill.removeAttribute('data-level');
        fill.style.width = '0%';
        label.textContent = '';
        wrapper.setAttribute('aria-hidden', 'true');
        return;
    }
    const { score, label: levelLabel } = _calcularForcaSenha(valor);
    fill.setAttribute('data-level', score.toString());
    label.textContent = levelLabel;
    wrapper.setAttribute('aria-hidden', 'false');
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId); if (!input) return;
    const isHidden  = input.type === 'password';
    input.type      = isHidden ? 'text' : 'password';
    const icon = btn?.querySelector('i');
    if (icon) icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
}

function abrirModalLogout()        { openModal('modal-logout'); }
function confirmarLogoutAction()   { closeModal('modal-logout'); if (typeof confirmLogout === 'function') confirmLogout(); }

function exportarDados() {
    try {
        const dados = { produtos: STATE.produtos, categorias: STATE.categorias, config: STATE.configSite };
        const blob  = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
        const url   = URL.createObjectURL(blob);
        const a     = document.createElement('a');
        a.href      = url;
        a.download  = `backup_acrilife_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Dados exportados!', 'success');
    } catch { showToast('Erro ao exportar', 'error'); }
}

// ============================================
// INICIALIZAÇÃO E EXPORTS GLOBAIS
// ============================================
document.addEventListener('DOMContentLoaded', async function() {
    if (typeof guardAdminPage === 'function') { const ok = await guardAdminPage(); if (!ok) return; }
    initSupabase();
    STATE.user = window._adminUser || null;
    STATE.supabase?.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') window.location.replace('login.html');
    });
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.style.colorScheme = 'light';
    document.body.setAttribute('data-theme', 'light');

    setTimeout(async () => {
        if (CONFIG.USE_SUPABASE && STATE.supabase) updateConnectionStatus(await testarConexaoSupabase());
    }, 500);

    setupCoreEvents();
    setupUploadImagens();
    // Abre na página indicada pela URL (#produtos, #categorias...) e reage ao voltar/avançar
    const hashInicial = location.hash.slice(1);
    if (PAGINAS.includes(hashInicial) && hashInicial !== 'dashboard') {
        STATE.page = '';
        navigateTo(hashInicial);
    }
    window.addEventListener('hashchange', () => navigateTo(location.hash.slice(1)));
    document.getElementById('categoria-icone')?.addEventListener('input', atualizarPreviewIcone);
    const ano = document.getElementById('footer-ano'); if (ano) ano.textContent = new Date().getFullYear();
    const linkSite = document.getElementById('link-ver-site'); if (linkSite) linkSite.href = URL_SITE_PUBLICO;
    loadInitialData().then(() => updateUserUI(_getAdminNomeAtual()));
    initUI();

    if (CONFIG.AUTO_SYNC && CONFIG.USE_SUPABASE) startAutoSync();

    setTimeout(() => {
        const fpn = document.getElementById('form-perfil-nome'); if (fpn) fpn.addEventListener('submit', salvarNomePerfil);
        const fns = document.getElementById('form-nova-senha');  if (fns) fns.addEventListener('submit', confirmarNovaSenha);
    }, 150);
});

// EXPORTS GLOBAIS
window.navigateTo                       = navigateTo;
window.abrirModalProduto                = abrirModalProduto;
window.abrirModalCategoria              = abrirModalCategoria;
window.abrirModalConfigSite             = abrirModalConfigSite;
window.editarProduto                    = abrirModalProduto;
window.editarCategoria                  = abrirModalCategoria;
window.excluirProduto                   = excluirProduto;
window.excluirCategoria                 = excluirCategoria;
window.excluirMultiplasCategorias       = excluirMultiplasCategorias;
window.saveAllData                      = saveAllData;
window.loadPage                         = loadPage;
window.addCampoImagem                   = addCampoImagem;
window.performSearch                    = performSearch;
window.salvarConfigSite                 = salvarConfigSite;
window.obterConfigSite                  = obterConfigSite;
window.testarConexaoSupabase            = testarConexaoSupabase;
window.syncFromSupabase                 = syncFromSupabase;
window.salvarProduto                    = salvarProduto;
window.salvarCategoria                  = salvarCategoria;
window.uploadImagemParaStorage          = uploadImagemParaStorage;
window.getPublicImageUrl                = getPublicImageUrl;
window.uploadMultiplasImagens           = uploadMultiplasImagens;
window.toggleItemSelection              = toggleItemSelection;
window.toggleSelectAll                  = toggleSelectAll;
window.executeBulkAction                = executeBulkAction;
window.proximoSlide                     = proximoSlide;
window.mudarSlide                       = mudarSlide;
window.carregarMidiasNoCarrossel        = carregarMidiasNoCarrossel;
window.carregarMiniaturasRecentes       = carregarMiniaturasRecentes;
window.redimensionarImagemParaPadrao    = redimensionarImagemParaPadrao;
window.abrirModalPerfil                 = abrirModalPerfil;
window.switchPerfilTab                  = switchPerfilTab;
window.salvarNomePerfil                 = salvarNomePerfil;
window.solicitarResetSenha              = solicitarResetSenha;
window.confirmarNovaSenha               = confirmarNovaSenha;
window.voltarParaSolicitar              = voltarParaSolicitar;
window.avaliarForcaSenha                = avaliarForcaSenha;
window.togglePasswordVisibility         = togglePasswordVisibility;
window.togglePrecoInput                 = togglePrecoInput;
window.abrirModalLogout                 = abrirModalLogout;
window.confirmarLogoutAction            = confirmarLogoutAction;
window.exportarDados                    = exportarDados;
window.removerMultiplasImagensDoStorage = removerMultiplasImagensDoStorage;
window.extrairPathRelativo              = extrairPathRelativo;
window.irParaProdutos                   = irParaProdutos;
window.irParaProdutosCategoria          = irParaProdutosCategoria;
window.aplicarFiltroProdutos            = aplicarFiltroProdutos;
window.alternarVisibilidadeProduto      = alternarVisibilidadeProduto;
window.duplicarProduto                  = duplicarProduto;
window.testarConexaoUI                  = testarConexaoUI;
window.sincronizarUI                    = sincronizarUI;
window.addLinhaHorario                  = addLinhaHorario;
window.selecionarBanner                 = selecionarBanner;
window.escolherIcone                    = escolherIcone;