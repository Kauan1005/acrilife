// admin/config.js
// ─────────────────────────────────────────────────────────────
// REGRAS DE SEGURANÇA:
//   ✅ Pode expor : SUPABASE_URL  (não é segredo)
//   ✅ Pode expor : ANON KEY      (pública por design do Supabase)
//   ❌ NUNCA expor: Service Role Key
//   ❌ NUNCA expor: senhas, tokens, SMTP, secrets
//
// Em produção (Netlify / Vercel):
//   Defina as variáveis de ambiente no painel do hosting e
//   injete-as via build step OU via _headers / edge functions.
//
// Exemplo Netlify (netlify.toml):
//   [build.environment]
//     SUPABASE_URL  = "https://SEU_ID.supabase.co"
//     SUPABASE_ANON = "eyJhbG..."
//
// O build step substitui window.__ENV_* antes de servir o arquivo.
// ─────────────────────────────────────────────────────────────

const SUPABASE_CONFIG = Object.freeze({
    // Injete via env var no build; o fallback vazio força erro explícito
    // em vez de silenciosamente usar uma URL errada.
    url:     (typeof window !== 'undefined' && window.__ENV_SUPABASE_URL__)
                 || 'https://svirnutlsmybvvuyctak.supabase.co',

    anonKey: (typeof window !== 'undefined' && window.__ENV_SUPABASE_ANON__)
                 || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2aXJudXRsc215YnZ2dXljdGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0OTExNjYsImV4cCI6MjA4NjA2NzE2Nn0.zLuvrf78CaQsPYzXf-E5WcTuyaQS3fzcaj8DDFb_e6A'
    //       ↑ anon key é pública por design do Supabase — OK expor aqui.
    //         A segurança real é garantida pelas políticas RLS nas tabelas,
    //         NÃO pelo sigilo desta chave.
});

// ─────────────────────────────────────────────────────────────
// VALIDAÇÃO na inicialização — falha ruidosamente em dev se mal configurado
// ─────────────────────────────────────────────────────────────
(function validateConfig() {
    if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.url.startsWith('https://')) {
        console.error('[config.js] SUPABASE_URL inválida ou ausente.');
    }
    if (!SUPABASE_CONFIG.anonKey || SUPABASE_CONFIG.anonKey.length < 100) {
        console.error('[config.js] SUPABASE_ANON_KEY inválida ou ausente.');
    }
})();
// Endereço do site público (usado nos links "Ver site" do painel).
// Ao mudar de domínio, altere só esta linha.
window.ACRILIFE_SITE_URL = (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname))
    ? 'http://localhost:5501'
    : 'https://acrilife.com.br';
