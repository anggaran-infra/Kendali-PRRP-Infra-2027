// =========================================
// KENDALI PRRP — PENGATURAN KONEKSI SUPABASE
// =========================================
// Ambil dua nilai berikut di Supabase: Project Settings → API
// (atau Data API / API Keys):
//   supabaseUrl      → Project URL,      contoh https://abcdefgh.supabase.co
//   supabaseAnonKey  → anon public key   (kunci publik, aman ditaruh di sini)
//
// JANGAN menaruh service_role key / secret key di berkas ini.

window.PRRP_CONFIG = {
  supabaseUrl: 'https://tzpxvcsnslmjbcrbfmgq.supabase.co',
  supabaseAnonKey: 'sb_publishable_-a1rYfIPm0yUlFwP0LyJ8w_zcbw0MBG',

  // User ID dipetakan menjadi email <userid>@<loginDomain> di Supabase Auth.
  // Harus sama dengan PRRP_DOMAIN_LOGIN pada Edge Function (bawaan prrp.local).
  loginDomain: 'prrp.local',

  // Opsional: alamat gambar latar (https://...). Kosongkan bila tidak dipakai.
  backgroundUrl: ''
};
