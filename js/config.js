/*
 * Konfigurasi aplikasi.
 *
 * Cara pakai:
 * 1. Buat project gratis di https://supabase.com
 * 2. Jalankan isi supabase/schema.sql di SQL Editor
 * 3. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di bawah
 *
 * Anon key AMAN ditaruh di frontend selama Row Level Security (RLS) aktif.
 * JANGAN PERNAH memakai service_role key di file ini.
 *
 * Alternatif tanpa edit file: buka situs, klik "Panduan Setup",
 * lalu tempel URL + anon key. Nilai akan disimpan di localStorage browser.
 */
(function () {
  var defaults = {
    SUPABASE_URL: "https://cntuzjthzvmwuoulqjkt.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_XiMobgI3lQWTPmyP-va8QA_hyrBRm7p",
    APP_NAME: "Efektivitas Bulanan"
  };

  var saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("efb_config") || "{}");
  } catch (e) {
    saved = {};
  }

  var cfg = Object.assign({}, defaults, saved);

  cfg.hasSupabase = Boolean(
    cfg.SUPABASE_URL &&
      cfg.SUPABASE_ANON_KEY &&
      /^https?:\/\//i.test(cfg.SUPABASE_URL) &&
      !/YOUR-|xxxx|example/i.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)
  );

  window.APP_CONFIG = cfg;
})();
