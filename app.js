// =====================================================================
// KENDALI PRRP — APLIKASI (VERSI SUPABASE)
// Monitoring Percepatan Rehabilitasi dan Rekonstruksi Pascabencana TA 2027
// =====================================================================
//
// Halaman ini berjalan sepenuhnya di browser dan terhubung ke Supabase:
//   • Login        : Supabase Auth (User ID dipetakan ke <userid>@loginDomain)
//   • Data         : fungsi database api_* (lihat supabase/skema.sql)
//   • PDF          : Supabase Storage, bucket privat "dokumen"
//   • Kelola akun  : Edge Function "kelola-pengguna"
// Pengaturan koneksi ada di config.js.
// =====================================================================

(function () {
  'use strict';

  // =========================================
  // REFERENSI
  // =========================================

  const DARING = 'Daring/Tanpa Lokasi Fisik';
  const PETA = window.PETA_SUMATERA || null;
  const REF = window.REFERENSI_PRRP && window.REFERENSI_PRRP.wilayah ? window.REFERENSI_PRRP : null;
  const STATUSES = ['Pending', 'SPP/SPM', 'SP2D'];

  // Akrual (dasar realisasi) = SP2D + SPP/SPM, sesuai pencatatan akrual
  // di SAKTI. Pending belum termasuk akrual, tetapi dipantau karena akan
  // menggunakan pagu.
  const REALISASI_STATUSES = ['SP2D', 'SPP/SPM'];

  const STATUS_INFO = {
    SP2D: { label: 'SP2D', cls: 'sp2d', desc: 'Dana sudah cair (SP2D terbit). Termasuk akrual.' },
    'SPP/SPM': { label: 'SPP/SPM', cls: 'spm', desc: 'SPP/SPM sudah diinput di SAKTI, SP2D belum terbit. Termasuk akrual.' },
    Pending: { label: 'Pending', cls: 'pending', desc: 'Berkas masih dilengkapi, belum diinput di SAKTI. Belum termasuk akrual; perlu diperhatikan.' }
  };

  const CATS = [
    { key: 'ACEH', label: 'Aceh', prov: 'Aceh', code: '11', color: 'var(--aceh)', css: 'aceh' },
    { key: 'SUMUT', label: 'Sumatera Utara', prov: 'Sumatera Utara', code: '12', color: 'var(--sumut)', css: 'sumut' },
    { key: 'SUMBAR', label: 'Sumatera Barat', prov: 'Sumatera Barat', code: '13', color: 'var(--sumbar)', css: 'sumbar' },
    { key: 'LAINNYA', label: 'Lokasi Lainnya (Koordinasi PRRP)', color: 'var(--lainnya)' },
    { key: 'DARING', label: 'Daring/Tanpa Lokasi Fisik', color: '#b7c2cd', optional: true },
    { key: 'BELUM', label: 'Belum Teridentifikasi', color: '#d8a23a', optional: true }
  ];

  const CAT = {};
  CATS.forEach(c => { CAT[c.key] = c; });

  // Batas hari sebelum transaksi diberi peringatan tindak lanjut.
  const STALE_DAYS = { Pending: 10, 'SPP/SPM': 7 };

  const UNIT_DEFAULT = [
    { code: 'D1', name: '[Dep 1] Penyediaan Lahan dan Penataan Ruang', budget: 1200000000 },
    { code: 'D2', name: '[Dep 2] Perhubungan/Konektivitas', budget: 600000000 },
    { code: 'D3', name: '[Dep 3] Infrastruktur', budget: 1200000000 },
    { code: 'D4', name: '[Dep 4] Perumahan dan Pemukiman', budget: 1200000000 },
    { code: 'Setmenko', name: '[Setmenko] Kolaborasi Rintisan', budget: 1400000000 }
  ];

  const ACTIVITIES = [
    'Penambahan transaksi', 'Perubahan nominal', 'Perubahan unit kerja',
    'Perubahan lokasi', 'Perubahan status', 'Pengunggahan dokumen',
    'Penggantian dokumen', 'Pembatalan transaksi',
    'Perubahan data transaksi', 'Penyesuaian alokasi pagu',
    'Pengelolaan pengguna'
  ];

  // Peran pengguna aplikasi. Hak akses juga diperiksa di server.
  const ROLE_INFO = {
    Admin: 'Semua fitur, termasuk Kelola Pengguna dan penyesuaian alokasi pagu.',
    Operator: 'Menambah dan mengubah transaksi, mengubah status, mengunggah PDF, dan membatalkan transaksi.',
    Pimpinan: 'Hanya melihat Ringkasan, Penggunaan Dana, dan Riwayat Transaksi.'
  };
  const ROLES = Object.keys(ROLE_INFO);

  // Indeks wilayah: nama provinsi → { code, kab: { nama → kode } }
  const PROV = {};

  function buildProv() {
    REF.wilayah.forEach(p => {
      const kab = {};
      p[2].forEach(k => { kab[k[1]] = k[0]; });
      PROV[p[1]] = { code: p[0], name: p[1], list: p[2].map(k => k[1]), kab: kab };
    });
  }

  const ICON = {
    ringkasan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    dana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19"/><path d="M6.5 15h4"/><path d="M5 6V4.5h14V6"/></svg>',
    riwayat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8l-5-5Z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15l3-3 3 3"/></svg>',
    cancel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/><path d="m15 8 2 2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
    scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h13l-3-3"/><path d="M17 17H4l3 3"/></svg>'
  };

  // =========================================
  // STATUS APLIKASI
  // =========================================

  const state = {
    page: 'ringkasan',
    token: '',
    user: null,
    users: [],
    usersLoaded: false,
    usersLoading: false,
    pagu: [],
    paguTotal: 5600000000,
    entries: [],
    loaded: false,
    loading: false,
    loadError: '',
    history: [],
    historyLoaded: false,
    historyLoading: false,
    historyLimit: 100,
    indicator: 'realisasi',
    level: 'kab',
    selected: null,
    expanded: {},
    filters: { q: '', unit: '', lokasi: '', status: '', from: '', to: '' },
    hfilters: { q: '', from: '', to: '', unit: '', user: '', activity: '' },
    modal: null
  };

  let previewUrl = '';
  let noticeTimer = null;

  // =========================================
  // UTILITAS
  // =========================================

  const rupiah = value => {
    const n = Math.round(Number(value) || 0);
    return (n < 0 ? '−Rp' : 'Rp') + Math.abs(n).toLocaleString('id-ID');
  };

  const percent = value =>
    (isFinite(value) ? value : 0).toLocaleString('id-ID', {
      minimumFractionDigits: 0, maximumFractionDigits: 2
    }) + '%';

  const integer = value => Number(value || 0).toLocaleString('id-ID');

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function dateLabel(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return esc(value || '—');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function timeLabel(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value || ''));
    if (!m) return esc(value || '—');
    const d = dateLabel(value);
    return m[4] ? d + ', ' + m[4] + '.' + m[5] : d;
  }

  // =========================================
  // SAMBUNGAN KE SUPABASE
  // =========================================

  const CFG = window.PRRP_CONFIG || {};
  const BUCKET = 'dokumen';
  const LOGIN_DOMAIN = String(CFG.loginDomain || 'prrp.local').trim().toLowerCase();
  const CONFIG_READY = !!(window.supabase && CFG.supabaseUrl && CFG.supabaseAnonKey &&
    !/ISI_|GANTI/i.test(CFG.supabaseUrl + ' ' + CFG.supabaseAnonKey));

  // Sesi login disimpan di sessionStorage: berakhir saat tab atau browser
  // ditutup. Bila browser memblokir penyimpanan, sesi disimpan di memori.
  const authStorage = (() => {
    try {
      sessionStorage.setItem('__prrp', '1');
      sessionStorage.removeItem('__prrp');
      return sessionStorage;
    } catch (ignore) {
      const memory = {};
      return {
        getItem: key => (key in memory ? memory[key] : null),
        setItem: (key, value) => { memory[key] = String(value); },
        removeItem: key => { delete memory[key]; }
      };
    }
  })();

  const sb = CONFIG_READY
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: {
        storage: authStorage,
        storageKey: 'kendali-prrp-auth',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
    : null;

  // Nama permintaan di aplikasi → fungsi database (RPC).
  const RPC = {
    listHistory: 'api_riwayat',
    updateEntry: 'api_ubah',
    updateStatus: 'api_ubah_status',
    deleteEntry: 'api_batalkan',
    adjustPagu: 'api_sesuaikan_pagu',
    listUsers: 'api_daftar_pengguna',
    setUserActive: 'api_aktif_pengguna'
  };

  function dbError(error) {
    const text = String((error && (error.message || error.error_description || error.msg)) || 'Terjadi kesalahan.');
    const code = String((error && error.code) || '');
    if (/JWT expired|invalid JWT|jwt malformed|not authenticated|permission denied for function/i.test(text) || /^PGRST30/.test(code)) {
      return new Error('Sesi berakhir. Silakan masuk kembali.');
    }
    if (/Failed to fetch|NetworkError|Load failed|Failed to send/i.test(text)) {
      return new Error('Tidak dapat terhubung ke server. Periksa koneksi internet, lalu coba lagi.');
    }
    return new Error(text);
  }

  async function rpc(fn, argument) {
    const { data, error } = await sb.rpc(fn, argument === undefined || argument === null ? {} : { p: argument });
    if (error) throw dbError(error);
    return data;
  }

  // Menambah pengguna dan mengatur ulang password (Edge Function).
  async function kelolaPengguna(body) {
    const { data, error } = await sb.functions.invoke('kelola-pengguna', { body });
    if (error) {
      let text = error.message || '';
      try {
        const detail = await error.context.json();
        text = detail.error || detail.message || detail.msg || text;
      } catch (ignore) {}
      if (/Failed to send|not found|404/i.test(text)) {
        text = 'Edge Function kelola-pengguna belum terpasang atau tidak dapat dihubungi.';
      }
      throw dbError({ message: text });
    }
    if (!data || data.ok === false) throw new Error((data && data.error) || 'Permintaan gagal.');
    return data;
  }

  // ---------- PDF di Supabase Storage ----------

  async function sha256Base64(buffer) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
    let binary = '';
    digest.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function newUuid() {
    if (window.crypto.randomUUID) return window.crypto.randomUUID();
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  async function preparePdf(file) {
    const buffer = await file.arrayBuffer();
    const head = String.fromCharCode.apply(null, new Uint8Array(buffer.slice(0, 5)));
    if (head !== '%PDF-' || buffer.byteLength > 20 * 1024 * 1024) {
      throw new Error('Berkas harus berupa PDF, maksimal 20 MB.');
    }
    return { buffer, name: file.name, hash: await sha256Base64(buffer) };
  }

  async function uploadPdf(pdf) {
    const key = 'transaksi/' + new Date().getFullYear() + '/' + newUuid() + '.pdf';
    const { error } = await sb.storage.from(BUCKET).upload(key,
      new Blob([pdf.buffer], { type: 'application/pdf' }),
      { contentType: 'application/pdf', upsert: false });
    if (error) throw dbError({ message: 'PDF tidak dapat diunggah: ' + error.message });
    return { key, name: pdf.name, hash: pdf.hash };
  }

  // Transaksi baru: periksa dulu (termasuk PDF ganda), unggah PDF, lalu simpan.
  async function addEntry(argument) {
    const data = Object.assign({}, argument);
    const file = data.file;
    delete data.file;
    if (!file) return rpc('api_tambah', data);

    const pdf = await preparePdf(file);
    await rpc('api_tambah', Object.assign({}, data, { periksa: true, file: { hash: pdf.hash } }));
    const uploaded = await uploadPdf(pdf);
    return rpc('api_tambah', Object.assign({}, data, { file: uploaded }));
  }

  async function replacePdf(argument) {
    const pdf = await preparePdf(argument.file);
    await rpc('api_cek_pdf', { id: argument.id, hash: pdf.hash });
    const uploaded = await uploadPdf(pdf);
    return rpc('api_ganti_pdf', { id: argument.id, file: uploaded });
  }

  // Tautan PDF privat berlaku 12 jam; dibuat ulang setiap data dimuat.
  async function attachFileUrls(data) {
    const entries = (data && data.entries) || [];
    const keys = entries.filter(e => e.fileSource === 'storage' && e.fileKey).map(e => e.fileKey);
    if (!keys.length) return data;

    const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrls(keys, 12 * 60 * 60);
    if (error || !signed) return data;

    const urls = {};
    signed.forEach(item => { if (item && !item.error && item.signedUrl) urls[item.path] = item.signedUrl; });
    entries.forEach(e => { if (e.fileSource === 'storage') e.fileUrl = urls[e.fileKey] || ''; });
    return data;
  }

  // ---------- Masuk ----------

  async function signIn(argument) {
    const id = String(argument.userId || '').trim().toLowerCase();
    const email = id.includes('@') ? id : id + '@' + LOGIN_DOMAIN;
    const { error } = await sb.auth.signInWithPassword({ email, password: argument.password });

    if (error) {
      const text = String(error.message || '');
      if (/invalid login credentials|invalid (email|password)|invalid_credentials/i.test(text + ' ' + (error.code || ''))) {
        throw new Error('User ID atau password salah.');
      }
      if (/rate limit|too many/i.test(text)) {
        throw new Error('Terlalu banyak percobaan masuk. Coba lagi beberapa menit lagi atau hubungi Admin.');
      }
      if (/banned/i.test(text)) throw new Error('Akun ' + id + ' dinonaktifkan. Hubungi Admin.');
      throw dbError(error);
    }

    try {
      const data = await rpc('api_data');
      return { token: 'supabase', user: data.user };
    } catch (problem) {
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      throw problem;
    }
  }

  async function call(name, argument) {
    if (!sb) throw new Error('Aplikasi belum dihubungkan ke Supabase. Isi berkas config.js.');

    switch (name) {
      case 'login': return signIn(argument);
      case 'logout': await sb.auth.signOut({ scope: 'local' }); return { ok: true };
      case 'getAppData': return attachFileUrls(await rpc('api_data'));
      case 'addEntry': return addEntry(argument);
      case 'replacePdf': return replacePdf(argument);
      case 'saveUser':
        return argument && argument.baru
          ? kelolaPengguna(Object.assign({ aksi: 'tambah' }, argument))
          : rpc('api_simpan_pengguna', argument);
      case 'resetPassword': return kelolaPengguna(Object.assign({ aksi: 'reset_password' }, argument));
      case 'getBackground': return CFG.backgroundUrl || '';
      default:
        if (RPC[name]) return rpc(RPC[name], argument);
        throw new Error('Permintaan tidak dikenal.');
    }
  }

  // Permintaan yang boleh dilakukan tanpa sesi.
  const PUBLIC_CALLS = ['login', 'logout', 'getBackground'];
  const SESSION_ERROR = /Sesi berakhir|dinonaktifkan|belum terdaftar/;

  function server(name, argument) {
    return call(name, argument).catch(raw => {
      const error = raw instanceof Error ? raw : new Error(String(raw));
      if (!PUBLIC_CALLS.includes(name) && SESSION_ERROR.test(errorText(error))) {
        sessionExpired(errorText(error));
      }
      throw error;
    });
  }

  // ---------- Sesi masuk ----------

  // Data pengguna disimpan sementara agar menu langsung sesuai peran saat
  // halaman dimuat ulang. Token login dikelola oleh Supabase.
  const SESSION_KEY = 'kendaliPrrpPengguna';

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: state.user }));
    } catch (ignore) {}
  }

  async function readSession() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return null;

    let user = null;
    try {
      user = (JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null') || {}).user || null;
    } catch (ignore) {}

    return { token: 'supabase', user };
  }

  function clearSession() {
    state.token = '';
    try { sessionStorage.removeItem(SESSION_KEY); } catch (ignore) {}
    if (sb) sb.auth.signOut({ scope: 'local' }).catch(() => {});
  }

  const role = () => (state.user && state.user.peran) || '';
  const canEdit = () => role() === 'Admin' || role() === 'Operator';
  const isAdmin = () => role() === 'Admin';

  function errorText(error) {
    const text = (error && error.message) || String(error || 'Terjadi kesalahan.');
    return text.replace(/^(?:\s*(?:ScriptError|Exception|Error):\s*)+/, '');
  }

  function notify(message, type) {
    const box = document.getElementById('notice');
    if (!box) return;
    clearTimeout(noticeTimer);
    box.className = 'notice' + (type ? ' ' + type : '');
    box.innerHTML = '<div>' + message + '</div>' +
      '<button type="button" aria-label="Tutup pemberitahuan">Tutup</button>';
    box.hidden = false;
    box.querySelector('button').addEventListener('click', () => { box.hidden = true; });
    if (!type) noticeTimer = setTimeout(() => { box.hidden = true; }, 7000);
  }

  function units() {
    return state.pagu.length ? state.pagu : UNIT_DEFAULT;
  }

  function unitName(code) {
    const unit = units().find(u => u.code === code);
    return unit ? unit.name : (code || '—');
  }

  // "[Dep 1] Penyediaan Lahan" → kode tebal, keterangan biasa dan lebih kecil.
  function unitHtml(name) {
    const m = /^\s*(\[[^\]]+\])\s*(.*)$/.exec(String(name || ''));
    if (!m) return `<strong>${esc(name)}</strong>`;
    return `<strong>${esc(m[1])}</strong>${m[2] ? ` <span class="unit-desc">${esc(m[2])}</span>` : ''}`;
  }

  function digits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  const DRIVE_FILE = 'https://drive.google.com/file/d/';
  const driveUrl = id => DRIVE_FILE + encodeURIComponent(id) + '/view';

  // PDF baru tersimpan di Supabase Storage (tautan bertanda tangan);
  // PDF lama dari Google Drive tetap memakai tautan Drive.
  const fileUrl = e => e.fileSource === 'storage' ? (e.fileUrl || '#') : driveUrl(e.fileKey);

  // =========================================
  // PERHITUNGAN
  // =========================================

  function category(entry) {
    if (!entry.provinsi) return 'BELUM';
    if (entry.provinsi === DARING) return 'DARING';
    if (entry.provinsi === 'Aceh') return 'ACEH';
    if (entry.provinsi === 'Sumatera Utara') return 'SUMUT';
    if (entry.provinsi === 'Sumatera Barat') return 'SUMBAR';
    return 'LAINNYA';
  }

  const activityKey = entry => entry.kegiatanId || ('TRX-' + entry.id);
  const realisasi = entry => REALISASI_STATUSES.includes(entry.status) ? Number(entry.amount) || 0 : 0;
  const pending = entry => entry.status === 'Pending' ? Number(entry.amount) || 0 : 0;

  function locationText(entry) {
    if (!entry.provinsi) return 'Belum teridentifikasi';
    if (entry.provinsi === DARING) return DARING;
    return entry.kabkota + ', ' + entry.provinsi;
  }

  // Lama transaksi berada pada status saat ini (hari kalender).
  function daysInStatus(entry) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(entry.statusSince || ''));
    if (!m) return null;
    const since = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today - since) / 86400000));
  }

  // Peringatan: Pending 10 hari belum diproses, SPP/SPM 7 hari belum SP2D.
  function staleInfo(entry) {
    const limit = STALE_DAYS[entry.status];
    if (!limit) return null;
    const days = daysInStatus(entry);
    if (days === null || days < limit) return null;
    return {
      days,
      text: entry.status === 'Pending'
        ? `Pending ${days} hari, belum diproses`
        : `SPP/SPM ${days} hari, belum SP2D`
    };
  }

  function staleSummary() {
    const list = state.entries.filter(e => staleInfo(e));
    return {
      total: list.length,
      pending: list.filter(e => e.status === 'Pending').length,
      spm: list.filter(e => e.status === 'SPP/SPM').length
    };
  }

  function staleAlert(withLink) {
    if (!state.loaded) return '';
    const s = staleSummary();
    if (!s.total) return '';
    const parts = [];
    if (s.pending) parts.push(`${s.pending} transaksi Pending sudah ${STALE_DAYS.Pending} hari atau lebih belum diproses`);
    if (s.spm) parts.push(`${s.spm} transaksi SPP/SPM sudah ${STALE_DAYS['SPP/SPM']} hari atau lebih belum SP2D`);
    return `
      <div class="alert-bar" role="alert">
        <div><strong>Perlu tindak lanjut:</strong> ${parts.join('; ')}.</div>
        <button type="button" class="btn btn-secondary" data-show-stale>${withLink ? 'Lihat transaksi' : 'Tampilkan'}</button>
      </div>`;
  }

  function showStale() {
    state.filters = { q: '', unit: '', lokasi: '', status: '!', from: '', to: '' };
    state.page = 'dana';
    renderPage();
    const area = document.getElementById('trxArea');
    if (area) area.scrollIntoView({ block: 'start' });
  }

  function renderNavBadge() {
    const button = document.querySelector('[data-page="dana"]');
    if (!button) return;
    let badge = button.querySelector('.nav-badge');
    const n = state.loaded ? staleSummary().total : 0;
    if (!n) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      button.appendChild(badge);
    }
    badge.textContent = n;
    badge.title = n + ' transaksi perlu tindak lanjut';
  }

  function unitStats() {
    const stats = {};
    units().forEach(u => {
      stats[u.code] = { code: u.code, name: u.name, budget: u.budget, SP2D: 0, 'SPP/SPM': 0, Pending: 0 };
    });

    state.entries.forEach(entry => {
      const s = stats[entry.unit];
      if (s && STATUSES.includes(entry.status)) s[entry.status] += Number(entry.amount) || 0;
    });

    const list = units().map(u => {
      const s = stats[u.code];
      s.real = s.SP2D + s['SPP/SPM'];
      return s;
    });
    const total = list.reduce((t, s) => {
      t.budget += s.budget; t.SP2D += s.SP2D; t['SPP/SPM'] += s['SPP/SPM']; t.Pending += s.Pending; t.real += s.real;
      return t;
    }, { budget: 0, SP2D: 0, 'SPP/SPM': 0, Pending: 0, real: 0 });

    return { list, total, map: stats };
  }

  function emptyNode() {
    return { acts: new Set(), real: 0, children: {} };
  }

  function locationStats() {
    const cats = {};
    CATS.forEach(c => { cats[c.key] = emptyNode(); });
    const points = {};
    const all = new Set();
    let totalReal = 0;

    state.entries.forEach(entry => {
      const key = category(entry);
      const act = activityKey(entry);
      const real = realisasi(entry);
      const node = cats[key];

      all.add(act);
      totalReal += real;
      node.acts.add(act);
      node.real += real;

      if (key === 'BELUM' || key === 'DARING') return;

      const prov = node.children[entry.provinsi] = node.children[entry.provinsi] || emptyNode();
      prov.acts.add(act);
      prov.real += real;

      const kab = prov.children[entry.kabkota] = prov.children[entry.kabkota] || emptyNode();
      kab.acts.add(act);
      kab.real += real;

      const info = PROV[entry.provinsi];
      const kabCode = info && info.kab[entry.kabkota];
      const coord = kabCode && REF.koordinat[kabCode];

      if (['ACEH', 'SUMUT', 'SUMBAR'].includes(key) && coord) {
        const p = points[kabCode] = points[kabCode] || {
          code: kabCode, name: entry.kabkota, prov: entry.provinsi, cat: key,
          lat: coord[0], lng: coord[1], acts: new Set(), real: 0
        };
        p.acts.add(act);
        p.real += real;
      }
    });

    const sumActs = CATS.reduce((sum, c) => sum + cats[c.key].acts.size, 0);
    return { cats, points, totalActs: all.size, totalReal, consistent: sumActs === all.size };
  }

  function kegiatanList() {
    const map = {};
    state.entries.forEach(entry => {
      if (!entry.kegiatanId) return;
      const k = map[entry.kegiatanId] = map[entry.kegiatanId] || {
        id: entry.kegiatanId, note: entry.note, provinsi: entry.provinsi,
        kabkota: entry.kabkota, entries: []
      };
      k.entries.push(entry);
    });
    return Object.keys(map).sort().reverse().map(k => map[k]);
  }

  // =========================================
  // KERANGKA
  // =========================================

  const PAGES = [
    { id: 'ringkasan', label: 'Ringkasan', icon: ICON.ringkasan,
      desc: 'Kondisi akrual anggaran per unit kerja dan sebaran lokasi pelaksanaan kegiatan.' },
    { id: 'dana', label: 'Penggunaan Dana', icon: ICON.dana,
      desc: 'Pengelolaan pagu pengendalian internal dan transaksi penggunaan anggaran PRRP.' },
    { id: 'riwayat', label: 'Riwayat Transaksi', icon: ICON.riwayat,
      desc: 'Catatan seluruh perubahan data transaksi untuk keperluan audit.' },
    { id: 'pengguna', label: 'Kelola Pengguna', icon: ICON.users, admin: true,
      desc: 'Akun yang dapat masuk ke aplikasi beserta perannya. Hanya dapat diakses Admin.' }
  ];

  const visiblePages = () => PAGES.filter(p => !p.admin || isAdmin());

  function renderShell() {
    document.getElementById('root').innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true">PR</div>
            <div>
              <div class="brand-name">Kendali PRRP</div>
              <div class="brand-sub">Tahun Anggaran 2027</div>
            </div>
          </div>
          <nav class="nav" aria-label="Menu utama">
            ${visiblePages().map(p => `
              <button type="button" data-page="${p.id}">${p.icon}<span>${p.label}</span></button>
            `).join('')}
          </nav>
          <div class="sidebar-foot" id="userBox"></div>
        </aside>

        <main>
          <header class="app-header">
            <div class="app-org">Kementerian Koordinator Bidang Infrastruktur dan Pembangunan Kewilayahan</div>
            <h1>MONITORING PERCEPATAN REHABILITASI DAN REKONSTRUKSI PASCABENCANA TA 2027</h1>
            <p class="subtitle">Pemantauan alokasi, realisasi, dan sisa anggaran PRRP.</p>
          </header>

          <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>

          <div id="page"></div>

          <footer class="app-foot">
            Dashboard monitoring internal Kementerian Koordinator Bidang Infrastruktur dan Pembangunan Kewilayahan.
          </footer>
        </main>
      </div>
      <div id="modalRoot"></div>
    `;

    document.querySelectorAll('[data-page]').forEach(button => {
      button.addEventListener('click', () => {
        state.page = button.dataset.page;
        state.selected = null;
        renderPage();
        window.scrollTo(0, 0);
      });
    });

    renderUserBox();
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.modal && !state.modal.busy) closeModal();
  });

  function renderUserBox() {
    const box = document.getElementById('userBox');
    if (!box || !state.user) return;
    box.innerHTML = `
      <div class="user-label">Masuk sebagai</div>
      <div class="user-name">${esc(state.user.nama || state.user.userId)}</div>
      <div class="user-meta">${esc(state.user.userId)} · <span class="role-tag">${esc(state.user.peran)}</span></div>
      <button type="button" class="btn btn-ghost btn-logout" id="logoutBtn">${ICON.logout}Keluar</button>`;
    box.querySelector('#logoutBtn').addEventListener('click', signOut);
  }

  function renderPage() {
    const container = document.getElementById('page');
    if (!container) return;

    if (!visiblePages().some(p => p.id === state.page)) state.page = 'ringkasan';
    const page = PAGES.find(p => p.id === state.page);

    document.querySelectorAll('[data-page]').forEach(button => {
      const active = button.dataset.page === state.page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    const intro = `
      <div class="page-intro">
        <h2>${page.label}</h2>
        <p>${page.desc}</p>
      </div>`;

    if (state.page === 'ringkasan') container.innerHTML = intro + staleAlert(true) + pageRingkasan();
    if (state.page === 'dana') container.innerHTML = intro + staleAlert(false) + pageDana();
    if (state.page === 'riwayat') container.innerHTML = intro + pageRiwayat();
    if (state.page === 'pengguna') container.innerHTML = intro + pagePengguna();

    container.querySelectorAll('[data-show-stale]').forEach(b => b.addEventListener('click', showStale));
    renderNavBadge();

    if (state.page === 'ringkasan') bindRingkasan();
    if (state.page === 'dana') bindDana();
    if (state.page === 'riwayat') bindRiwayat();
    if (state.page === 'pengguna') bindPengguna();
  }

  function loadingRow(cols) {
    return `<tr>${Array.from({ length: cols }, () => '<td><span class="skeleton"></span></td>').join('')}</tr>`;
  }

  function progressCell(value) {
    const over = value > 100;
    return `
      <div class="progress-cell">
        <div class="bar${over ? ' over' : ''}" role="img" aria-label="Progres ${percent(value)}">
          <span style="width:${Math.max(0, Math.min(100, value))}%"></span>
        </div>
        <span class="progress-value">${percent(value)}</span>
      </div>`;
  }

  // =========================================
  // MENU RINGKASAN
  // =========================================

  // Rupiah ringkas untuk infografis: Rp5,6 M / Rp912 jt.
  function rupiahShort(value) {
    const n = Number(value) || 0;
    const fmt = (v, d) => v.toLocaleString('id-ID', { maximumFractionDigits: d });
    if (Math.abs(n) >= 1e12) return 'Rp' + fmt(n / 1e12, 2) + ' T';
    if (Math.abs(n) >= 1e9) return 'Rp' + fmt(n / 1e9, 2) + ' M';
    if (Math.abs(n) >= 1e6) return 'Rp' + fmt(n / 1e6, 1) + ' jt';
    return rupiah(n);
  }

  // Lebar segmen batang komposisi (persen dari pagu, tidak melebihi 100).
  function segments(s) {
    const budget = s.budget || 1;
    let left = 100;
    const take = v => {
      const w = Math.max(0, Math.min(left, v / budget * 100));
      left -= w;
      return w;
    };
    const sp2d = take(s.SP2D);
    const spm = take(s['SPP/SPM']);
    const pend = take(s.Pending);
    return { sp2d, spm, pend, rest: left };
  }

  function compositionBar(s, tall) {
    const w = segments(s);
    const seg = (cls, width, title) => width > 0
      ? `<span class="seg ${cls}" style="width:${width.toFixed(2)}%" title="${esc(title)}"></span>` : '';
    return `
      <div class="comp-bar${tall ? ' tall' : ''}" role="img"
        aria-label="SP2D ${rupiah(s.SP2D)}, SPP/SPM ${rupiah(s['SPP/SPM'])}, Pending ${rupiah(s.Pending)}, pagu ${rupiah(s.budget)}">
        ${seg('sp2d', w.sp2d, 'SP2D ' + rupiah(s.SP2D))}
        ${seg('spm', w.spm, 'SPP/SPM ' + rupiah(s['SPP/SPM']))}
        ${seg('pend', w.pend, 'Pending ' + rupiah(s.Pending))}
      </div>`;
  }

  function gauge(pct) {
    const r = 54;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, pct));
    return `
      <svg class="gauge" viewBox="0 0 140 140" role="img" aria-label="Akrual ${percent(pct)} dari pagu">
        <circle cx="70" cy="70" r="${r}" class="gauge-track"></circle>
        <circle cx="70" cy="70" r="${r}" class="gauge-fill${pct > 100 ? ' over' : ''}"
          stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 70 70)"></circle>
        <text x="70" y="68" text-anchor="middle" class="gauge-value">${percent(pct)}</text>
        <text x="70" y="90" text-anchor="middle" class="gauge-label">dari pagu</text>
      </svg>`;
  }

  function heroPanel(stats) {
    const t = stats.total;
    const pct = t.budget ? t.real / t.budget * 100 : 0;
    const legend = [
      ['sp2d', 'SP2D', t.SP2D],
      ['spm', 'SPP/SPM', t['SPP/SPM']],
      ['pend', 'Pending (perhatian)', t.Pending],
      ['rest', 'Sisa setelah Pending', Math.max(0, t.budget - t.real - t.Pending)]
    ];

    return `
      <section class="hero-info" aria-labelledby="ttlHero">
        <div class="hero-main">
          ${gauge(pct)}
          <div>
            <div class="hero-eyebrow" id="ttlHero">Akrual PRRP TA 2027</div>
            <div class="hero-value">${rupiahShort(t.real)}</div>
            <div class="hero-sub">dari pagu ${rupiahShort(t.budget)} · SP2D + SPP/SPM</div>
          </div>
        </div>
        <div class="hero-stats">
          <div class="hero-stat">
            <span class="label">Pagu</span>
            <span class="value">${rupiahShort(t.budget)}</span>
            <span class="full">${rupiah(t.budget)}</span>
          </div>
          <div class="hero-stat">
            <span class="label">Sisa pagu</span>
            <span class="value">${rupiahShort(t.budget - t.real)}</span>
            <span class="full">${rupiah(t.budget - t.real)}</span>
          </div>
          <div class="hero-stat warn">
            <span class="label">Pending</span>
            <span class="value">${rupiahShort(t.Pending)}</span>
            <span class="full">Perlu perhatian · ${rupiah(t.Pending)}</span>
          </div>
        </div>
        <div class="hero-comp">
          ${compositionBar(t, true)}
          <ul class="comp-legend">
            ${legend.map(l => `
              <li><span class="key ${l[0]}"></span>${l[1]} <strong>${rupiahShort(l[2])}</strong></li>`).join('')}
          </ul>
        </div>
      </section>`;
  }

  function unitBars(stats) {
    if (!state.loaded) {
      return `<div class="panel-body"><span class="skeleton"></span></div>`;
    }

    return `
      <div class="unit-bars">
        ${stats.list.map(s => {
          const pct = s.budget ? s.real / s.budget * 100 : 0;
          return `
            <div class="unit-row">
              <div class="unit-name">${unitHtml(s.name)}
                <span class="unit-pagu">Pagu ${rupiah(s.budget)}</span>
              </div>
              <div class="unit-chart">
                ${compositionBar(s)}
                <div class="unit-meta">
                  <span>SP2D ${rupiahShort(s.SP2D)}</span>
                  <span>SPP/SPM ${rupiahShort(s['SPP/SPM'])}</span>
                  ${s.Pending ? `<span class="warn-text">Pending ${rupiahShort(s.Pending)}</span>` : ''}
                </div>
              </div>
              <div class="unit-figures">
                <span class="unit-pct${pct > 100 ? ' over' : ''}">${percent(pct)}</span>
                <span class="unit-real">${rupiah(s.real)}</span>
                <span class="unit-sisa">Sisa ${rupiah(s.budget - s.real)}</span>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  function pageRingkasan() {
    if (state.loadError && !state.loaded) return loadErrorPanel();

    const stats = unitStats();

    return `
      ${state.loaded ? heroPanel(stats) : '<section class="hero-info"><span class="skeleton"></span></section>'}

      <section class="panel" aria-labelledby="tblRingkasan">
        <div class="panel-head">
          <div>
            <h3 id="tblRingkasan">Akrual Anggaran per Unit Kerja</h3>
          </div>
          <ul class="comp-legend compact">
            <li><span class="key sp2d"></span>SP2D</li>
            <li><span class="key spm"></span>SPP/SPM</li>
            <li><span class="key pend"></span>Pending</li>
            <li><span class="key rest"></span>Sisa</li>
          </ul>
        </div>
        ${unitBars(stats)}
      </section>

      <section class="panel" aria-labelledby="ttlSebaran">
        <div class="panel-head">
          <div>
            <h3 id="ttlSebaran">Sebaran Lokasi Kegiatan</h3>
            <p class="note">
            Sebaran kegiatan PRRP di Aceh, Sumatera Utara, dan Sumatera Barat.
            </p>
          </div>
        </div>
        <div id="mapArea">${state.loaded ? mapArea() : '<div class="panel-body"><span class="skeleton"></span></div>'}</div>
        <div class="panel-head" style="padding-top:8px">
          <div>
            <h3 id="ttlRekap">Rekapitulasi Lokasi</h3>
            <p class="note">
            </p>
          </div>
        </div>
        <div class="tablewrap" id="rekapArea">${state.loaded ? rekapTable() : ''}</div>
      </section>

      <section class="panel" aria-labelledby="ttlFokus">
        <div class="panel-head">
          <div>
            <h3 id="ttlFokus">Fokus Pelaksanaan Kegiatan</h3>
            <p class="note">Perbandingan wilayah pelaksanaan, diurutkan dari nilai terbesar.</p>
          </div>
          <div class="actions">
            <div class="segmented" role="group" aria-label="Tingkat wilayah">
              <button type="button" data-level="kab" aria-pressed="${state.level === 'kab'}">Kabupaten/Kota</button>
              <button type="button" data-level="prov" aria-pressed="${state.level === 'prov'}">Provinsi</button>
            </div>
            <div class="segmented" role="group" aria-label="Indikator">
              <button type="button" data-indicator="realisasi" aria-pressed="${state.indicator === 'realisasi'}">Nilai akrual</button>
              <button type="button" data-indicator="kegiatan" aria-pressed="${state.indicator === 'kegiatan'}">Jumlah kegiatan</button>
            </div>
          </div>
        </div>
        <div id="fokusArea">${state.loaded ? fokusChart() : ''}</div>
        <p class="note chart-note">
          Nilai akrual menunjukkan fokus penggunaan anggaran, bukan ukuran dampak bencana atau keberhasilan
          rehabilitasi dan rekonstruksi.<br>
          Kegiatan daring dan transaksi yang lokasinya belum teridentifikasi tidak ditampilkan pada grafik ini.
        </p>
      </section>
    `;
  }

  function loadErrorPanel() {
    return `
      <section class="panel">
        <div class="empty">
          <h3>Data belum dapat dimuat</h3>
          <p>${esc(state.loadError)}</p>
          <p><button type="button" class="btn btn-secondary" id="retryLoad">${ICON.reload}Coba lagi</button></p>
        </div>
      </section>`;
  }

  function mapArea() {
    const loc = locationStats();
    const points = Object.values(loc.points).sort((a, b) => b.acts.size - a.acts.size);
    const proj = PETA ? PETA.proj : { lng0: 94.8, lat1: 6.3, k: 60 };
    const xy = (lat, lng) => [(lng - proj.lng0) * proj.k, (proj.lat1 - lat) * proj.k];
    const vb = PETA ? PETA.viewBox : [0, 0, 700, 750];

    const cls = { '11': 'aceh', '12': 'sumut', '13': 'sumbar' };
    const provPaths = PETA ? PETA.provinsi.map(p =>
      `<path class="prov ${cls[p.kode] || 'other'}" d="${p.d}"><title>${esc(p.nama)}</title></path>`
    ).join('') : '';

    const labels = [
      ['Aceh', 3.3, 96.95, 'end'],
      ['Sumatera Utara', 3.95, 99.7, 'start'],
      ['Sumatera Barat', -0.72, 99.85, 'end']
    ].map(l => {
      const p = xy(l[1], l[2]);
      return `<text class="prov-label" x="${p[0].toFixed(1)}" y="${p[1].toFixed(1)}" text-anchor="${l[3]}">${l[0]}</text>`;
    }).join('');

    const markers = points.map(pt => {
      const p = xy(pt.lat, pt.lng);
      const n = pt.acts.size;
      const r = Math.min(20, 10 + Math.sqrt(n) * 2.6);
      const label = `${pt.name}, ${pt.prov}: ${n} kegiatan, akrual ${rupiah(pt.real)}`;
      return `
        <g class="marker${state.selected === pt.code ? ' selected' : ''}" data-marker="${pt.code}"
           tabindex="0" role="button" aria-label="${esc(label)}" transform="translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})">
          <circle class="ring" r="${(r + 5).toFixed(1)}"></circle>
          <circle class="dot" r="${r.toFixed(1)}"></circle>
          <text text-anchor="middle" dy="4.5">${n}</text>
        </g>`;
    }).join('');

    let pop = '';
    const sel = state.selected && loc.points[state.selected];

    if (sel) {
      const p = xy(sel.lat, sel.lng);
      const left = Math.min(80, Math.max(20, p[0] / vb[2] * 100));
      const top = p[1] / vb[3] * 100;
      pop = `
        <div class="map-pop" style="left:${left}%;top:${top}%">
          <strong>${esc(sel.name)}</strong>
          <span class="muted">${esc(sel.prov)}</span>
          <dl>
            <dt>Jumlah kegiatan</dt><dd>${integer(sel.acts.size)}</dd>
            <dt>Akrual</dt><dd>${rupiah(sel.real)}</dd>
          </dl>
        </div>`;
    }

    const mapped = ['ACEH', 'SUMUT', 'SUMBAR'];
    const legend = mapped.map(key => {
      const c = CAT[key];
      const n = loc.cats[key];
      return `
        <li>
          <span class="swatch" style="background:${c.color}"></span>
          <span>${c.label}</span>
          <span class="count">${integer(n.acts.size)} kegiatan</span>
        </li>`;
    }).join('') + `
        <li>
          <span class="swatch" style="background:var(--land);border:1px solid var(--border-strong)"></span>
          <span>Provinsi lain</span>
          <span class="count muted">tidak ditandai</span>
        </li>`;

    const lainnya = loc.cats.LAINNYA;
    const detail = `
        <div class="detail-box note">
          ${sel ? 'Pilih titik yang sama atau area kosong pada peta untuk menutup keterangan lokasi.'
            : 'Pilih titik pada peta untuk melihat nama lokasi, jumlah kegiatan, dan akrual anggaran. Angka pada titik menunjukkan jumlah kegiatan.'}
        </div>`;

    return `
      <div class="map-layout">
        <div class="map-frame" id="mapFrame">
          <svg viewBox="${vb.join(' ')}" role="img" aria-label="Peta Pulau Sumatera dengan titik lokasi kegiatan PRRP">
            <g>${provPaths}</g>
            <g>${labels}</g>
            <g>${markers}</g>
          </svg>
          ${pop}
          ${points.length ? '' : '<div class="map-empty">Belum ada kegiatan tercatat di Aceh, Sumatera Utara, atau Sumatera Barat.</div>'}
        </div>
        <div>
          <div class="side-title">Keterangan</div>
          <ul class="legend">${legend}</ul>
          ${detail}
          <div class="detail-box">
            <div class="side-title" style="margin:0">Lokasi Lainnya (Koordinasi PRRP)</div>
            <p class="note">Kegiatan koordinasi, sinkronisasi, pengendalian, dan monitoring di Jakarta atau provinsi lain. Tidak ditampilkan pada peta.</p>
            <dl>
              <dt>Jumlah kegiatan</dt><dd>${integer(lainnya.acts.size)}</dd>
              <dt>Akrual</dt><dd>${rupiah(lainnya.real)}</dd>
            </dl>
          </div>
        </div>
      </div>`;
  }

  function rekapTable() {
    const loc = locationStats();
    const rows = [];

    CATS.forEach(c => {
      const node = loc.cats[c.key];
      if (c.optional && !node.acts.size && !node.real) return;

      const provs = Object.keys(node.children).sort((a, b) =>
        node.children[b].real - node.children[a].real || a.localeCompare(b));
      const expandable = provs.length > 0;
      const open = !!state.expanded[c.key];

      rows.push(`
        <tr>
          <td>
            ${expandable ? `
              <button type="button" class="expander" data-expand="${c.key}" aria-expanded="${open}">
                ${ICON.chevron}<span class="dot-cat" style="background:${c.color}"></span>${esc(c.label)}
              </button>` : `<strong><span class="dot-cat" style="background:${c.color}"></span>${esc(c.label)}</strong>`}
          </td>
          <td class="num">${integer(node.acts.size)}</td>
          <td class="num money">${rupiah(node.real)}</td>
        </tr>`);

      if (!open) return;

      const single = provs.length === 1 && c.prov;

      provs.forEach(name => {
        const prov = node.children[name];
        const kabs = Object.keys(prov.children).sort((a, b) =>
          prov.children[b].real - prov.children[a].real || a.localeCompare(b));

        if (!single) {
          rows.push(`
            <tr class="child">
              <td><strong>${esc(name)}</strong></td>
              <td class="num">${integer(prov.acts.size)}</td>
              <td class="num money">${rupiah(prov.real)}</td>
            </tr>`);
        }

        kabs.forEach(kab => {
          const k = prov.children[kab];
          rows.push(`
            <tr class="child${single ? '' : ' grand'}">
              <td>${esc(kab)}</td>
              <td class="num">${integer(k.acts.size)}</td>
              <td class="num money">${rupiah(k.real)}</td>
            </tr>`);
        });
      });
    });

    return `
      <table>
        <thead>
          <tr>
            <th scope="col">Lokasi Pelaksanaan</th>
            <th scope="col" class="num">Jumlah Kegiatan</th>
            <th scope="col" class="num">Akrual</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td class="num">${integer(loc.totalActs)}</td>
            <td class="num money">${rupiah(loc.totalReal)}</td>
          </tr>
        </tfoot>
      </table>
      ${loc.consistent ? '' : `
        <div class="table-foot">
          Terdapat kegiatan yang transaksinya tercatat pada lebih dari satu lokasi. Samakan lokasinya melalui menu
          Penggunaan Dana agar jumlah kegiatan per lokasi tidak terhitung ganda.
        </div>`}`;
  }

  function fokusChart() {
    const loc = locationStats();
    const items = [];

    ['ACEH', 'SUMUT', 'SUMBAR', 'LAINNYA'].forEach(key => {
      const node = loc.cats[key];
      Object.keys(node.children).forEach(provName => {
        const prov = node.children[provName];
        if (state.level === 'prov') {
          items.push({ name: provName, sub: CAT[key].label, cat: key, acts: prov.acts.size, real: prov.real });
        } else {
          Object.keys(prov.children).forEach(kabName => {
            const kab = prov.children[kabName];
            items.push({ name: kabName, sub: provName, cat: key, acts: kab.acts.size, real: kab.real });
          });
        }
      });
    });

    const value = item => state.indicator === 'realisasi' ? item.real : item.acts;
    const list = items.filter(i => value(i) > 0)
      .sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name));

    if (!list.length) {
      return `
        <div class="empty">
          <h3>Belum ada data untuk dibandingkan</h3>
          <p>${state.indicator === 'realisasi'
            ? 'Grafik akan terisi setelah terdapat akrual (SP2D atau SPP/SPM) dengan lokasi pelaksanaan yang valid.'
            : 'Grafik akan terisi setelah terdapat kegiatan dengan lokasi pelaksanaan yang valid.'}</p>
        </div>`;
    }

    const top = list.slice(0, 10);
    const max = value(top[0]) || 1;
    const rest = list.length - top.length;

    return `
      <div class="hbars" role="list">
        ${top.map(item => `
          <div class="hbar" role="listitem">
            <div class="label">${esc(item.name)}<small>${esc(item.sub)}</small></div>
            <div class="track" aria-hidden="true">
              <div class="fill" style="width:${(value(item) / max * 100).toFixed(2)}%;background:${CAT[item.cat].color}"></div>
            </div>
            <div class="value">${state.indicator === 'realisasi' ? rupiah(item.real) : integer(item.acts) + ' kegiatan'}</div>
          </div>`).join('')}
      </div>
      ${rest > 0 ? `<p class="note chart-note" style="padding-bottom:0">Ditampilkan 10 wilayah teratas dari ${list.length} wilayah.</p>` : ''}`;
  }

  function bindRingkasan() {
    const retry = document.getElementById('retryLoad');
    if (retry) retry.addEventListener('click', loadData);
    bindMap();

    const rekap = document.getElementById('rekapArea');
    if (rekap) {
      rekap.addEventListener('click', event => {
        const button = event.target.closest('[data-expand]');
        if (!button) return;
        const key = button.dataset.expand;
        state.expanded[key] = !state.expanded[key];
        rekap.innerHTML = rekapTable();
        const again = rekap.querySelector(`[data-expand="${key}"]`);
        if (again) again.focus();
      });
    }

    document.querySelectorAll('[data-indicator]').forEach(button => {
      button.addEventListener('click', () => {
        state.indicator = button.dataset.indicator;
        document.querySelectorAll('[data-indicator]').forEach(b =>
          b.setAttribute('aria-pressed', String(b.dataset.indicator === state.indicator)));
        document.getElementById('fokusArea').innerHTML = fokusChart();
      });
    });

    document.querySelectorAll('[data-level]').forEach(button => {
      button.addEventListener('click', () => {
        state.level = button.dataset.level;
        document.querySelectorAll('[data-level]').forEach(b =>
          b.setAttribute('aria-pressed', String(b.dataset.level === state.level)));
        document.getElementById('fokusArea').innerHTML = fokusChart();
      });
    });
  }

  function bindMap() {
    const area = document.getElementById('mapArea');
    const frame = document.getElementById('mapFrame');
    if (!area || !frame) return;

    function select(code) {
      state.selected = state.selected === code ? null : code;
      area.innerHTML = mapArea();
      bindMap();
      const marker = state.selected && document.querySelector(`[data-marker="${state.selected}"]`);
      if (marker) marker.focus();
    }

    frame.addEventListener('click', event => {
      const marker = event.target.closest('[data-marker]');
      if (marker) select(marker.dataset.marker);
      else if (state.selected) select(state.selected);
    });

    frame.addEventListener('keydown', event => {
      const marker = event.target.closest('[data-marker]');
      if (marker && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        select(marker.dataset.marker);
      }
    });
  }

  // =========================================
  // MENU PENGGUNAAN DANA
  // =========================================

  function pageDana() {
    if (state.loadError && !state.loaded) return loadErrorPanel();

    const stats = unitStats();
    const admin = isAdmin();
    const editable = canEdit();

    const paguRows = !state.loaded
      ? loadingRow(6) + loadingRow(6) + loadingRow(6)
      : stats.list.map(s => {
        const pct = s.budget ? s.real / s.budget * 100 : 0;
        let flag = '';
        if (s.real > s.budget) flag = '<span class="badge warn">Akrual melebihi pagu</span>';
        else if (s.real + s.Pending > s.budget) flag = `<span class="badge warn" title="Akrual + Pending: ${rupiah(s.real + s.Pending)}">Pending melampaui sisa pagu</span>`;
        return `
          <tr>
            <td>${unitHtml(s.name)}${flag ? '<span class="sub">' + flag + '</span>' : ''}</td>
            <td class="num money">${rupiah(s.budget)}</td>
            <td class="num money">${rupiah(s.real)}</td>
            <td class="num money">${rupiah(s.budget - s.real)}</td>
            <td class="num money">${s.Pending ? rupiah(s.Pending) : '—'}</td>
            <td>${progressCell(pct)}</td>
          </tr>`;
      }).join('');

    const t = stats.total;

    const akrualTotal = state.entries.reduce((sum, e) => sum + realisasi(e), 0);
    const akrualCount = state.entries.filter(e => realisasi(e)).length;
    const statusStrip = `
        <div class="strip-total">
          <span class="badge akrual">Akrual</span>
          <span class="amount">${state.loaded ? rupiah(akrualTotal) : '<span class="skeleton"></span>'}</span>
          <span class="note">${integer(akrualCount)} transaksi · SP2D + SPP/SPM, sesuai pencatatan akrual di SAKTI.</span>
        </div>` + STATUSES.slice().reverse().map(status => {
      const info = STATUS_INFO[status];
      const list = state.entries.filter(e => e.status === status);
      const amount = list.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      return `
        <div>
          <span class="badge ${info.cls}">${info.label}</span>
          <span class="amount">${state.loaded ? rupiah(amount) : '<span class="skeleton"></span>'}</span>
          <span class="note">${integer(list.length)} transaksi · ${info.desc}</span>
        </div>`;
    }).join('');

    const provsInData = Array.from(new Set(state.entries
      .map(e => e.provinsi).filter(p => p && p !== DARING))).sort();

    return `
      <section class="panel" aria-labelledby="ttlPagu">
        <div class="panel-head">
          <div>
            <h3 id="ttlPagu">Pagu Anggaran per Unit Kerja</h3>
            <p class="note">
            </p>
          </div>
          ${admin ? `<div class="actions"><button type="button" class="btn btn-secondary" id="openPagu">${ICON.scale}Penyesuaian alokasi</button></div>` : ''}
        </div>
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Unit Kerja</th>
                <th scope="col" class="num">Pagu Anggaran</th>
                <th scope="col" class="num">Akrual<span class="th-sub">SP2D + SPP/SPM</span></th>
                <th scope="col" class="num">Sisa Pagu</th>
                <th scope="col" class="num">Pending<span class="th-sub">Perhatian</span></th>
                <th scope="col">Persentase Akrual</th>
              </tr>
            </thead>
            <tbody>${paguRows}</tbody>
            ${state.loaded ? `
            <tfoot>
              <tr>
                <td>Total</td>
                <td class="num money">${rupiah(t.budget)}</td>
                <td class="num money">${rupiah(t.real)}</td>
                <td class="num money">${rupiah(t.budget - t.real)}</td>
                <td class="num money">${t.Pending ? rupiah(t.Pending) : '—'}</td>
                <td>${progressCell(t.budget ? t.real / t.budget * 100 : 0)}</td>
              </tr>
            </tfoot>` : ''}
          </table>
        </div>
      </section>

      <section class="panel" aria-labelledby="ttlDaftar">
        <div class="panel-head">
          <div>
            <h3 id="ttlDaftar">Daftar Penggunaan Dana</h3> <br>
            <p class="note">Status bersifat bertahap dan saling eksklusif. Satu transaksi hanya berada pada satu status. <br>
            Akrual = SP2D + SPP/SPM ; Pending belum termasuk akrual.</p>
          </div>
          <div class="actions">
            ${editable ? `<button type="button" class="btn btn-primary" id="openAdd">${ICON.plus}Tambah transaksi</button>` : ''}
            <button type="button" class="btn btn-secondary" id="reload">${ICON.reload}Muat ulang</button>
            <button type="button" class="btn btn-secondary" id="exportCsv">${ICON.download}Ekspor CSV</button>
          </div>
        </div>

        <div class="status-strip">${statusStrip}</div>

        <div class="filters" role="search">
          <input id="fSearch" type="search" aria-label="Cari transaksi"
            placeholder="Cari uraian, referensi, lokasi, atau kode kegiatan" value="${esc(state.filters.q)}">
          <select id="fUnit" aria-label="Filter unit kerja">
            <option value="">Semua unit kerja</option>
            ${units().map(u => `<option value="${u.code}"${state.filters.unit === u.code ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
          </select>
          <select id="fLokasi" aria-label="Filter lokasi">
            <option value="">Semua lokasi</option>
            <optgroup label="Kategori lokasi">
              ${CATS.map(c => `<option value="C:${c.key}"${state.filters.lokasi === 'C:' + c.key ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
            </optgroup>
            ${provsInData.length ? `
            <optgroup label="Provinsi tercatat">
              ${provsInData.map(p => `<option value="P:${esc(p)}"${state.filters.lokasi === 'P:' + p ? ' selected' : ''}>${esc(p)}</option>`).join('')}
            </optgroup>` : ''}
          </select>
          <select id="fStatus" aria-label="Filter status">
            <option value="">Semua status</option>
            ${STATUSES.slice().reverse().map(s => `<option value="${s}"${state.filters.status === s ? ' selected' : ''}>${STATUS_INFO[s].label}</option>`).join('')}
            <option value="-"${state.filters.status === '-' ? ' selected' : ''}>Belum ditentukan</option>
            <option value="!"${state.filters.status === '!' ? ' selected' : ''}>Perlu tindak lanjut</option>
          </select>
          <div class="filter-period">
            <span>Periode</span>
            <input id="fFrom" type="date" aria-label="Periode dari tanggal" value="${esc(state.filters.from)}">
            <span>s.d.</span>
            <input id="fTo" type="date" aria-label="Periode sampai tanggal" value="${esc(state.filters.to)}">
          </div>
          <div class="filter-extra">
            <button type="button" class="btn btn-ghost" id="fReset">Hapus filter</button>
            <span class="note" id="fCount"></span>
          </div>
        </div>

        <div id="trxArea"></div>
      </section>
    `;
  }

  function filteredEntries() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();

    return state.entries.filter(e => {
      if (f.unit && e.unit !== f.unit) return false;
      if (f.status === '-' && STATUSES.includes(e.status)) return false;
      if (f.status === '!' && !staleInfo(e)) return false;
      if (f.status && f.status !== '-' && f.status !== '!' && e.status !== f.status) return false;
      if (f.lokasi.startsWith('C:') && category(e) !== f.lokasi.slice(2)) return false;
      if (f.lokasi.startsWith('P:') && e.provinsi !== f.lokasi.slice(2)) return false;
      if (f.from && String(e.date) < f.from) return false;
      if (f.to && String(e.date) > f.to) return false;

      if (q) {
        const text = [e.note, e.ref, e.kegiatanId, locationText(e), unitName(e.unit), '#' + e.id]
          .join(' ').toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    }).sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id));
  }

  function renderTrxTable() {
    const area = document.getElementById('trxArea');
    if (!area) return;

    if (!state.loaded) {
      area.innerHTML = `<div class="tablewrap"><table><tbody>${loadingRow(8)}${loadingRow(8)}</tbody></table></div>`;
      return;
    }

    const rows = filteredEntries();
    const editable = canEdit();
    const total = rows.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const count = document.getElementById('fCount');
    if (count) count.textContent = `${integer(rows.length)} dari ${integer(state.entries.length)} transaksi`;

    if (!rows.length) {
      area.innerHTML = `
        <div class="empty" style="border-top:1px solid var(--border)">
          <h3>${state.entries.length ? 'Tidak ada transaksi yang sesuai' : 'Belum ada transaksi'}</h3>
          <p>${state.entries.length ? 'Ubah kata kunci atau filter pencarian.' : canEdit() ? 'Gunakan tombol Tambah transaksi untuk mencatat penggunaan dana.' : 'Transaksi akan tampil setelah dicatat oleh Operator atau Admin.'}</p>
        </div>`;
      return;
    }

    area.innerHTML = `
      <div class="tablewrap">
        <table class="wide">
          <thead>
            <tr>
              <th scope="col">Tanggal kegiatan</th>
              <th scope="col">Unit kerja</th>
              <th scope="col">Uraian kegiatan</th>
              <th scope="col">Lokasi pelaksanaan</th>
              <th scope="col" class="num">Nilai transaksi</th>
              <th scope="col">Status</th>
              <th scope="col">Referensi dokumen</th>
              ${editable ? '<th scope="col">Aksi</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${rows.map(e => {
              const cat = category(e);
              const loc = cat === 'BELUM'
                ? '<span class="loc-unknown">Belum teridentifikasi</span><span class="sub">Lengkapi melalui Edit</span>'
                : cat === 'DARING'
                  ? esc(DARING)
                  : `${esc(e.kabkota)}<span class="sub">${esc(e.provinsi)}</span>`;
              const statusCls = STATUS_INFO[e.status] ? STATUS_INFO[e.status].cls : '';
              return `
                <tr>
                  <td style="white-space:nowrap">${dateLabel(e.date)}</td>
                  <td style="min-width:220px">${unitHtml(unitName(e.unit))}</td>
                  <td class="wrap">${esc(e.note)}<span class="sub">${esc(e.kegiatanId || 'Tanpa kode kegiatan')} · Transaksi #${Number(e.id)}</span></td>
                  <td style="min-width:200px">${loc}</td>
                  <td class="num money">${rupiah(e.amount)}</td>
                  <td>
                    ${editable ? `
                    <select class="status-select ${statusCls}" data-status-id="${Number(e.id)}" aria-label="Ubah status transaksi #${Number(e.id)}">
                      ${STATUSES.includes(e.status) ? '' : '<option value="" selected disabled>Belum ditentukan</option>'}
                      ${STATUSES.slice().reverse().map(s => `<option value="${s}"${e.status === s ? ' selected' : ''}>${STATUS_INFO[s].label}</option>`).join('')}
                    </select>` : `<span class="badge ${statusCls}">${esc(STATUS_INFO[e.status] ? STATUS_INFO[e.status].label : 'Belum ditentukan')}</span>`}
                    ${staleInfo(e) ? `<span class="sub"><span class="badge warn">${esc(staleInfo(e).text)}</span></span>` : ''}
                  </td>
                  <td class="ref">
                    ${esc(e.ref || '—')}
                    ${e.fileKey
                      ? `<span class="sub"><a href="${esc(fileUrl(e))}" target="_blank" rel="noopener noreferrer">Lihat dokumen</a></span>`
                      : '<span class="sub">Tanpa PDF</span>'}
                  </td>
                  ${editable ? `<td>
                    <div class="row-actions">
                      <button type="button" class="btn btn-ghost" data-action="edit" data-id="${Number(e.id)}" title="Edit transaksi">${ICON.edit}Edit</button>
                      <button type="button" class="btn btn-ghost" data-action="pdf" data-id="${Number(e.id)}" title="${e.fileKey ? 'Ganti PDF' : 'Unggah PDF'}">${ICON.file}${e.fileKey ? 'Ganti PDF' : 'Unggah PDF'}</button>
                      <button type="button" class="btn btn-ghost btn-danger-ghost" data-action="cancel" data-id="${Number(e.id)}" title="Batalkan transaksi">${ICON.cancel}Batalkan</button>
                    </div>
                  </td>` : ''}
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-foot">
        Total nilai transaksi yang ditampilkan: <strong class="num">${rupiah(total)}</strong>
        (seluruh status). Akrual (SP2D + SPP/SPM): <strong class="num">${rupiah(rows.reduce((s, e) => s + realisasi(e), 0))}</strong>.
        Pending: <strong class="num">${rupiah(rows.reduce((s, e) => s + pending(e), 0))}</strong>.
      </div>`;
  }

  function bindDana() {
    const retry = document.getElementById('retryLoad');
    if (retry) { retry.addEventListener('click', loadData); return; }

    renderTrxTable();

    const f = state.filters;
    const on = (id, event, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, fn);
    };

    on('fSearch', 'input', e => { f.q = e.target.value; renderTrxTable(); });
    on('fUnit', 'change', e => { f.unit = e.target.value; renderTrxTable(); });
    on('fLokasi', 'change', e => { f.lokasi = e.target.value; renderTrxTable(); });
    on('fStatus', 'change', e => { f.status = e.target.value; renderTrxTable(); });
    on('fFrom', 'change', e => { f.from = e.target.value; renderTrxTable(); });
    on('fTo', 'change', e => { f.to = e.target.value; renderTrxTable(); });
    on('fReset', 'click', () => {
      state.filters = { q: '', unit: '', lokasi: '', status: '', from: '', to: '' };
      renderPage();
    });

    on('openAdd', 'click', () => openEntryModal(null));
    on('openPagu', 'click', openPaguModal);
    on('reload', 'click', loadData);
    on('exportCsv', 'click', exportEntries);

    const area = document.getElementById('trxArea');

    area.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (!button || !canEdit()) return;
      const entry = state.entries.find(e => Number(e.id) === Number(button.dataset.id));
      if (!entry) return;
      if (button.dataset.action === 'edit') openEntryModal(entry);
      if (button.dataset.action === 'pdf') openPdfModal(entry);
      if (button.dataset.action === 'cancel') openCancelModal(entry);
    });

    area.addEventListener('change', async event => {
      const select = event.target.closest('[data-status-id]');
      if (!select || !canEdit()) return;

      const id = Number(select.dataset.statusId);
      const entry = state.entries.find(e => Number(e.id) === id);
      const status = select.value;
      if (!entry) return;

      const guard = paguGuard(entry.unit, Number(entry.amount), status, entry.id);
      if (guard.error) {
        notify(esc(guard.error), 'error');
        renderTrxTable();
        return;
      }

      select.disabled = true;

      try {
        const result = await server('updateStatus', { id, status });
        await loadData(true);
        const warn = (result && result.warnings) || [];
        notify(`Status transaksi #${id} diubah menjadi ${esc(STATUS_INFO[status].label)}.` +
          (warn.length ? '<br>' + warn.map(esc).join('<br>') : ''), warn.length ? 'warn' : '');
      } catch (error) {
        renderTrxTable();
        notify(esc(errorText(error)), 'error');
      }
    });
  }

  // Pemeriksaan pagu di antarmuka; server tetap memeriksa ulang.
  function paguGuard(unit, amount, status, selfId) {
    const u = units().find(x => x.code === unit);
    if (!u) return { budget: 0, real: 0, pending: 0, available: 0 };

    let real = 0;
    let pend = 0;

    state.entries.forEach(e => {
      if (e.unit !== unit || Number(e.id) === Number(selfId)) return;
      real += realisasi(e);
      pend += pending(e);
    });

    const result = { budget: u.budget, real, pending: pend, available: u.budget - real };
    const counts = REALISASI_STATUSES.includes(status);

    if (counts && amount > 0 && real + amount > u.budget) {
      result.error = `Akrual ${u.name} (SP2D + SPP/SPM) akan menjadi ${rupiah(real + amount)}, melebihi pagu ${rupiah(u.budget)}. ` +
        'Transaksi tidak dapat diproses sebelum ada penyesuaian alokasi yang sah.';
    } else if (amount > 0 && real + pend + amount > u.budget) {
      result.warning = `Perhatian: akrual dan Pending ${u.name} akan menjadi ${rupiah(real + pend + amount)}, melampaui pagu ${rupiah(u.budget)}.`;
    }

    return result;
  }

  // =========================================
  // MODAL
  // =========================================

  function openModal(html, options) {
    closeModal();
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="overlay" id="overlay">
        <section class="modal${options && options.small ? ' small' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
          ${html}
        </section>
      </div>`;

    state.modal = { busy: false, returnFocus: document.activeElement };

    root.querySelector('#overlay').addEventListener('mousedown', event => {
      if (event.target.id === 'overlay' && !state.modal.busy) closeModal();
    });

    root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
      if (!state.modal || !state.modal.busy) closeModal();
    }));

    const first = root.querySelector('input:not([type=hidden]):not(:disabled), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);

    document.body.style.overflow = 'hidden';
    return root;
  }

  function closeModal() {
    const root = document.getElementById('modalRoot');
    if (root) root.innerHTML = '';
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ''; }
    document.body.style.overflow = '';
    const focus = state.modal && state.modal.returnFocus;
    state.modal = null;
    if (focus && document.contains(focus)) focus.focus();
  }

  function setBusy(root, busy, label) {
    if (state.modal) state.modal.busy = busy;
    root.querySelectorAll('button, input, select, textarea').forEach(el => {
      if (busy) { el.dataset.wasDisabled = el.disabled ? '1' : ''; el.disabled = true; }
      else { el.disabled = el.dataset.wasDisabled === '1'; }
    });
    const submit = root.querySelector('[data-submit]');
    if (submit) {
      if (busy) { submit.dataset.label = submit.textContent; submit.textContent = label || 'Menyimpan…'; }
      else if (submit.dataset.label) submit.textContent = submit.dataset.label;
    }
  }

  function showFormError(root, message) {
    const box = root.querySelector('#formError');
    box.textContent = message;
    box.hidden = !message;
    if (message) box.scrollIntoView({ block: 'nearest' });
  }

  function modalHead(title, desc) {
    return `
      <div class="modal-head">
        <div>
          <h3 id="modalTitle">${title}</h3>
          ${desc ? `<p>${desc}</p>` : ''}
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Tutup">${ICON.close}</button>
      </div>`;
  }

  function pdfField(required) {
    return `
      <label class="field">
        <span>Dokumen PDF${required ? '' : ' — opsional'} (maksimal 20 MB)</span>
        <input type="file" id="pdfFile" accept=".pdf,application/pdf"${required ? ' required' : ''}>
        <span class="hint">Nominal dan uraian belum dibaca otomatis dari PDF; isi rincian berdasarkan dokumen.</span>
      </label>
      <iframe id="pdfPreview" class="preview" title="Pratinjau PDF" hidden></iframe>`;
  }

  function bindPdfPreview(root) {
    const input = root.querySelector('#pdfFile');
    const frame = root.querySelector('#pdfPreview');
    if (!input) return;

    input.addEventListener('change', () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
      frame.hidden = true;
      frame.removeAttribute('src');

      const file = input.files[0];
      if (file && /\.pdf$/i.test(file.name)) {
        previewUrl = URL.createObjectURL(file);
        frame.src = previewUrl;
        frame.hidden = false;
      }
    });
  }

  function checkFile(file) {
    if (!file) return '';
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return 'Berkas harus berupa PDF.';
    if (file.size > 20 * 1024 * 1024) return 'Ukuran PDF maksimal 20 MB.';
    return '';
  }

  // ---------- Tambah / edit transaksi ----------

  function provinceOptions(selected) {
    const affected = ['Aceh', 'Sumatera Utara', 'Sumatera Barat'];
    const others = REF.wilayah.map(p => p[1]).filter(n => !affected.includes(n));
    const opt = name => `<option value="${esc(name)}"${selected === name ? ' selected' : ''}>${esc(name)}</option>`;
    return `
      <option value="">Pilih provinsi</option>
      <optgroup label="Provinsi terdampak">${affected.map(opt).join('')}</optgroup>
      <optgroup label="Provinsi lainnya (Koordinasi PRRP)">${others.map(opt).join('')}</optgroup>
      <optgroup label="Tanpa lokasi fisik">${opt(DARING)}</optgroup>`;
  }

  function kabOptions(provinsi, selected) {
    if (!provinsi) return '<option value="">Pilih provinsi terlebih dahulu</option>';
    if (provinsi === DARING) return '<option value="">Tidak diperlukan</option>';
    const info = PROV[provinsi];
    if (!info) return '<option value="">Provinsi tidak dikenal</option>';
    return '<option value="">Pilih kabupaten/kota</option>' + info.list.map(name =>
      `<option value="${esc(name)}"${selected === name ? ' selected' : ''}>${esc(name)}</option>`).join('');
  }

  function categoryHint(provinsi) {
    if (!provinsi) return '';
    const key = category({ provinsi });
    return 'Kategori lokasi: ' + CAT[key].label + '.';
  }

  function openEntryModal(entry) {
    const editing = !!entry;
    const v = entry || {
      unit: units()[0].code, date: '', amount: '', note: '', ref: '',
      status: 'Pending', provinsi: '', kabkota: '', kegiatanId: ''
    };

    const kegiatan = kegiatanList();
    const ownKegiatan = editing && v.kegiatanId;

    const html = `
      ${modalHead(editing ? `Edit transaksi #${Number(entry.id)}` : 'Tambah transaksi',
        editing ? 'Perubahan nilai, status, unit kerja, dan lokasi dicatat pada Riwayat Transaksi.'
          : 'Satu transaksi mencatat satu penggunaan dana. Lampirkan PDF atau isi nomor referensi agar dapat ditelusuri.')}
      <form id="entryForm" novalidate>
        <div class="modal-body">
          ${editing ? `
            <div class="doc-current">
              Dokumen: ${entry.fileKey
                ? `<a href="${esc(fileUrl(entry))}" target="_blank" rel="noopener noreferrer">${esc(entry.fileName || 'Lihat PDF')}</a>`
                : 'belum ada PDF'} · gunakan tombol ${entry.fileKey ? 'Ganti PDF' : 'Unggah PDF'} pada daftar untuk mengelola dokumen.
            </div>` : pdfField(false)}

          <div class="formrow">
            <label class="field">
              <span>Unit kerja</span>
              <select name="unit" required>
                ${units().map(u => `<option value="${u.code}"${v.unit === u.code ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
              </select>
              <span class="hint" id="paguHint"></span>
            </label>
            <label class="field">
              <span>Tanggal kegiatan</span>
              <input type="date" name="date" required value="${esc(v.date)}">
            </label>
          </div>

          <label class="field">
            <span>Uraian kegiatan</span>
            <textarea name="note" maxlength="500" required>${esc(v.note)}</textarea>
          </label>

          <label class="field">
            <span>Kegiatan</span>
            <select name="kegiatanId">
              <option value="">Kegiatan baru (kode dibuat otomatis)</option>
              ${kegiatan.map(k => `
                <option value="${esc(k.id)}"${v.kegiatanId === k.id ? ' selected' : ''}>
                  ${esc(k.id)} · ${esc(String(k.note).slice(0, 60))}${String(k.note).length > 60 ? '…' : ''} · ${esc(locationText(k))}
                </option>`).join('')}
            </select>
            <span class="hint">Pilih kegiatan yang sama bila satu kegiatan memiliki beberapa transaksi, misalnya honorarium dan perjalanan dinas.</span>
          </label>

          <div class="formrow">
            <label class="field">
              <span>Provinsi pelaksanaan</span>
              <select name="provinsi" required>${provinceOptions(v.provinsi)}</select>
              <span class="hint" id="catHint">${categoryHint(v.provinsi)}</span>
            </label>
            <label class="field">
              <span>Kabupaten/Kota pelaksanaan</span>
              <select name="kabkota" required>${kabOptions(v.provinsi, v.kabkota)}</select>
              <span class="hint" id="kegHint"></span>
            </label>
          </div>

          <label class="check" id="applyBox" hidden>
            <input type="checkbox" name="applyToActivity">
            <span id="applyText"></span>
          </label>

          <div class="formrow">
            <label class="field">
              <span>Nilai transaksi (Rp)</span>
              <input type="text" name="amount" inputmode="numeric" autocomplete="off" required
                placeholder="Contoh: 15.000.000" value="${v.amount ? integer(v.amount) : ''}">
            </label>
            <label class="field">
              <span>Status</span>
              <select name="status" required>
                ${STATUSES.includes(v.status) ? '' : '<option value="" selected disabled>Pilih status</option>'}
                ${STATUSES.map(s => `<option value="${s}"${v.status === s ? ' selected' : ''}>${STATUS_INFO[s].label}</option>`).join('')}
              </select>
              <span class="hint" id="statusHint"></span>
            </label>
          </div>

          <label class="field">
            <span>Nomor dokumen / referensi${editing ? '' : ' (wajib jika tanpa PDF)'}</span>
            <input name="ref" maxlength="200" value="${esc(v.ref)}" placeholder="Contoh: nomor SPM, SP2D, atau nota dinas">
          </label>

          <div id="formError" class="inline-error" role="alert" hidden></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>Batal</button>
          <button type="submit" class="btn btn-primary" data-submit>${editing ? 'Simpan perubahan' : 'Simpan transaksi'}</button>
        </div>
      </form>`;

    const root = openModal(html);
    const form = root.querySelector('#entryForm');
    const el = name => form.elements[name];
    bindPdfPreview(root);

    function siblingsOf(id) {
      return state.entries.filter(e => e.kegiatanId === id && (!editing || Number(e.id) !== Number(entry.id)));
    }

    function syncKegiatan() {
      const id = el('kegiatanId').value;
      const hint = root.querySelector('#kegHint');
      const lockLocation = id && !(editing && id === ownKegiatan);

      if (lockLocation) {
        const k = kegiatan.find(x => x.id === id);
        if (k) {
          el('provinsi').value = k.provinsi;
          el('kabkota').innerHTML = kabOptions(k.provinsi, k.kabkota);
          root.querySelector('#catHint').textContent = categoryHint(k.provinsi);
        }
        hint.textContent = 'Lokasi mengikuti kegiatan ' + id + '.';
      } else {
        hint.textContent = '';
      }

      el('provinsi').disabled = !!lockLocation;
      el('kabkota').disabled = !!lockLocation || !el('provinsi').value || el('provinsi').value === DARING;
      syncApply();
    }

    function syncApply() {
      const box = root.querySelector('#applyBox');
      const id = el('kegiatanId').value;
      if (!editing || !id || id !== ownKegiatan) { box.hidden = true; return; }

      const others = siblingsOf(id);
      const changed = el('provinsi').value !== entry.provinsi || el('kabkota').value !== entry.kabkota;

      box.hidden = !(others.length && changed);
      root.querySelector('#applyText').textContent =
        `Terapkan lokasi baru ke ${others.length} transaksi lain dalam kegiatan ${id}. ` +
        'Satu kegiatan hanya memiliki satu lokasi pelaksanaan.';
    }

    function syncPagu() {
      const amount = Number(digits(el('amount').value));
      const g = paguGuard(el('unit').value, amount, el('status').value, editing ? entry.id : null);
      const hint = root.querySelector('#paguHint');
      hint.className = 'hint' + (g.error ? ' warn' : '');
      hint.textContent = g.error || g.warning || `Sisa pagu ${unitName(el('unit').value)}: ${rupiah(g.available)}.`;
      const s = el('status').value;
      root.querySelector('#statusHint').textContent = STATUS_INFO[s] ? STATUS_INFO[s].desc : '';
      return g;
    }

    el('provinsi').addEventListener('change', () => {
      const p = el('provinsi').value;
      el('kabkota').innerHTML = kabOptions(p, '');
      el('kabkota').disabled = !p || p === DARING;
      root.querySelector('#catHint').textContent = categoryHint(p);
      syncApply();
    });

    el('kabkota').addEventListener('change', syncApply);
    el('kegiatanId').addEventListener('change', syncKegiatan);
    el('unit').addEventListener('change', syncPagu);
    el('status').addEventListener('change', syncPagu);

    el('amount').addEventListener('input', () => {
      const raw = digits(el('amount').value).replace(/^0+/, '').slice(0, 15);
      el('amount').value = raw ? Number(raw).toLocaleString('id-ID') : '';
      syncPagu();
    });

    syncKegiatan();
    syncPagu();

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (state.modal && state.modal.busy) return;

      const file = root.querySelector('#pdfFile') && root.querySelector('#pdfFile').files[0];
      const data = {
        unit: el('unit').value,
        date: el('date').value,
        amount: Number(digits(el('amount').value)),
        note: el('note').value.trim(),
        ref: el('ref').value.trim(),
        status: el('status').value,
        kegiatanId: el('kegiatanId').value,
        provinsi: el('provinsi').value,
        kabkota: el('provinsi').value === DARING ? '' : el('kabkota').value
      };

      const problems = [];
      if (!data.unit) problems.push('Pilih unit kerja.');
      if (!data.date) problems.push('Isi tanggal kegiatan.');
      if (!data.note) problems.push('Isi uraian kegiatan.');
      if (!data.provinsi) problems.push('Pilih provinsi pelaksanaan.');
      if (data.provinsi && data.provinsi !== DARING && !data.kabkota) problems.push('Pilih kabupaten/kota pelaksanaan.');
      if (!(data.amount > 0)) problems.push('Nilai transaksi harus lebih besar dari nol.');
      if (!STATUSES.includes(data.status)) problems.push('Pilih status transaksi.');
      if (!editing && !file && !data.ref) problems.push('Isi nomor dokumen/referensi atau lampirkan PDF.');
      const fileProblem = checkFile(file);
      if (fileProblem) problems.push(fileProblem);

      const guard = syncPagu();
      if (guard.error) problems.push(guard.error);

      const applyBox = root.querySelector('#applyBox');
      const apply = !applyBox.hidden && form.elements.applyToActivity.checked;
      if (!applyBox.hidden && !apply) {
        problems.push('Centang pilihan untuk menerapkan lokasi baru ke seluruh transaksi dalam kegiatan ini.');
      }

      if (problems.length) {
        showFormError(root, problems.join(' '));
        return;
      }

      showFormError(root, '');
      setBusy(root, true, file ? 'Mengunggah dan menyimpan…' : 'Menyimpan…');

      try {
        let result;
        if (editing) {
          result = await server('updateEntry', Object.assign({ id: entry.id, applyToActivity: apply }, data));
        } else {
          if (file) data.file = file;
          result = await server('addEntry', data);
        }

        state.modal.busy = false;
        closeModal();
        await loadData(true);

        const warn = (result && result.warnings) || [];
        const message = editing
          ? (result && result.changed ? `Perubahan transaksi #${Number(entry.id)} tersimpan.` : 'Tidak ada perubahan yang perlu disimpan.')
          : `Transaksi #${result.id} tersimpan pada kegiatan ${esc(result.kegiatanId)}.`;
        notify(message + (warn.length ? '<br>' + warn.map(esc).join('<br>') : ''), warn.length ? 'warn' : '');
      } catch (error) {
        setBusy(root, false);
        syncKegiatan();
        showFormError(root, errorText(error));
      }
    });
  }

  // ---------- Unggah / ganti PDF ----------

  function openPdfModal(entry) {
    const replacing = !!entry.fileKey;
    const html = `
      ${modalHead(replacing ? `Ganti dokumen transaksi #${Number(entry.id)}` : `Unggah dokumen transaksi #${Number(entry.id)}`,
        esc(entry.note))}
      <form id="pdfForm" novalidate>
        <div class="modal-body">
          ${replacing ? `<div class="doc-current">Dokumen saat ini: <a href="${esc(fileUrl(entry))}" target="_blank" rel="noopener noreferrer">${esc(entry.fileName || 'Lihat PDF')}</a>. Dokumen lama tetap tersimpan dan penggantian tercatat di riwayat.</div>` : ''}
          ${pdfField(true)}
          <div id="formError" class="inline-error" role="alert" hidden></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>Batal</button>
          <button type="submit" class="btn btn-primary" data-submit>${replacing ? 'Ganti dokumen' : 'Unggah dokumen'}</button>
        </div>
      </form>`;

    const root = openModal(html, { small: true });
    bindPdfPreview(root);

    root.querySelector('#pdfForm').addEventListener('submit', async event => {
      event.preventDefault();
      const file = root.querySelector('#pdfFile').files[0];
      const problem = !file ? 'Pilih berkas PDF.' : checkFile(file);
      if (problem) { showFormError(root, problem); return; }

      showFormError(root, '');
      setBusy(root, true, 'Mengunggah…');

      try {
        await server('replacePdf', { id: entry.id, file });
        state.modal.busy = false;
        closeModal();
        await loadData(true);
        notify(`Dokumen transaksi #${Number(entry.id)} berhasil ${replacing ? 'diganti' : 'diunggah'}.`);
      } catch (error) {
        setBusy(root, false);
        showFormError(root, errorText(error));
      }
    });
  }

  // ---------- Pembatalan ----------

  function openCancelModal(entry) {
    const html = `
      ${modalHead(`Batalkan transaksi #${Number(entry.id)}`,
        'Transaksi dipindahkan ke arsip, tidak dihapus permanen. PDF tetap tersimpan.')}
      <form id="cancelForm" novalidate>
        <div class="modal-body">
          <div class="doc-current">
            <strong>${esc(entry.note)}</strong><br>
            ${esc(unitName(entry.unit))} · ${rupiah(entry.amount)} · ${esc(STATUS_INFO[entry.status] ? STATUS_INFO[entry.status].label : 'Belum ditentukan')}
          </div>
          <label class="field">
            <span>Alasan pembatalan</span>
            <textarea name="alasan" maxlength="300" required placeholder="Contoh: input ganda, kegiatan dibatalkan"></textarea>
          </label>
          <div id="formError" class="inline-error" role="alert" hidden></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>Kembali</button>
          <button type="submit" class="btn btn-danger" data-submit>Batalkan dan arsipkan</button>
        </div>
      </form>`;

    const root = openModal(html, { small: true });

    root.querySelector('#cancelForm').addEventListener('submit', async event => {
      event.preventDefault();
      const alasan = event.target.elements.alasan.value.trim();
      if (!alasan) { showFormError(root, 'Isi alasan pembatalan untuk keperluan audit.'); return; }

      setBusy(root, true, 'Memproses…');

      try {
        await server('deleteEntry', { id: entry.id, alasan });
        state.modal.busy = false;
        closeModal();
        await loadData(true);
        notify(`Transaksi #${Number(entry.id)} dibatalkan dan dipindahkan ke arsip.`);
      } catch (error) {
        setBusy(root, false);
        showFormError(root, errorText(error));
      }
    });
  }

  // ---------- Penyesuaian alokasi (Admin) ----------

  function openPaguModal() {
    const stats = unitStats();
    const html = `
      ${modalHead('Penyesuaian alokasi pagu',
        `Memindahkan alokasi antarunit kerja. Total pagu pengendalian tetap ${rupiah(state.paguTotal)} dan perubahan tercatat di riwayat.`)}
      <form id="paguForm" novalidate>
        <div class="modal-body">
          <div class="formrow">
            <label class="field">
              <span>Dari unit kerja</span>
              <select name="from">${stats.list.map(s => `<option value="${s.code}">${esc(s.name)}</option>`).join('')}</select>
              <span class="hint" id="fromHint"></span>
            </label>
            <label class="field">
              <span>Ke unit kerja</span>
              <select name="to">${stats.list.map((s, i) => `<option value="${s.code}"${i === 1 ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
              <span class="hint" id="toHint"></span>
            </label>
          </div>
          <label class="field">
            <span>Nilai penyesuaian (Rp)</span>
            <input type="text" name="amount" inputmode="numeric" autocomplete="off" placeholder="Contoh: 100.000.000">
          </label>
          <label class="field">
            <span>Dasar penyesuaian</span>
            <input name="dasar" maxlength="300" placeholder="Nomor nota dinas/surat persetujuan">
          </label>
          <div id="formError" class="inline-error" role="alert" hidden></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>Batal</button>
          <button type="submit" class="btn btn-primary" data-submit>Simpan penyesuaian</button>
        </div>
      </form>`;

    const root = openModal(html, { small: true });
    const form = root.querySelector('#paguForm');

    function hints() {
      const from = stats.map[form.elements.from.value];
      const to = stats.map[form.elements.to.value];
      root.querySelector('#fromHint').textContent = `Pagu ${rupiah(from.budget)} · minimal ${rupiah(from.real)} (akrual)`;
      root.querySelector('#toHint').textContent = `Pagu ${rupiah(to.budget)}`;
    }

    form.elements.from.addEventListener('change', hints);
    form.elements.to.addEventListener('change', hints);
    form.elements.amount.addEventListener('input', () => {
      const raw = digits(form.elements.amount.value).replace(/^0+/, '').slice(0, 15);
      form.elements.amount.value = raw ? Number(raw).toLocaleString('id-ID') : '';
    });
    hints();

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = {
        from: form.elements.from.value,
        to: form.elements.to.value,
        amount: Number(digits(form.elements.amount.value)),
        dasar: form.elements.dasar.value.trim()
      };

      const from = stats.map[data.from];
      let problem = '';
      if (data.from === data.to) problem = 'Pilih unit asal dan tujuan yang berbeda.';
      else if (!(data.amount > 0)) problem = 'Isi nilai penyesuaian.';
      else if (from.budget - data.amount < from.real) problem = `Pagu ${from.name} tidak boleh lebih kecil dari akrualnya (${rupiah(from.real)}).`;
      else if (!data.dasar) problem = 'Isi dasar penyesuaian.';
      if (problem) { showFormError(root, problem); return; }

      setBusy(root, true);

      try {
        await server('adjustPagu', data);
        state.modal.busy = false;
        closeModal();
        await loadData(true);
        notify('Penyesuaian alokasi pagu tersimpan.');
      } catch (error) {
        setBusy(root, false);
        showFormError(root, errorText(error));
      }
    });
  }

  // =========================================
  // MENU RIWAYAT TRANSAKSI
  // =========================================

  function pageRiwayat() {
    const users = Array.from(new Set(state.history.map(h => h.user).filter(Boolean))).sort();
    const h = state.hfilters;

    return `
      <section class="panel" aria-labelledby="ttlRiwayat">
        <div class="panel-head">
          <div>
            <h3 id="ttlRiwayat">Log Aktivitas</h3>
            <p class="note">Penambahan, perubahan nominal, unit kerja, lokasi, status, dokumen, pembatalan transaksi, dan penyesuaian alokasi pagu.</p>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-secondary" id="hReload">${ICON.reload}Muat ulang</button>
            <button type="button" class="btn btn-secondary" id="hExport">${ICON.download}Ekspor CSV</button>
          </div>
        </div>

        <div class="filters history" role="search">
          <input id="hSearch" type="search" aria-label="Cari riwayat" placeholder="Cari referensi, nomor transaksi, atau perubahan" value="${esc(h.q)}">
          <select id="hUnit" aria-label="Filter unit kerja">
            <option value="">Semua unit kerja</option>
            ${units().map(u => `<option${h.unit === u.name ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}
          </select>
          <select id="hUser" aria-label="Filter pengguna">
            <option value="">Semua pengguna</option>
            ${users.map(u => `<option${h.user === u ? ' selected' : ''}>${esc(u)}</option>`).join('')}
          </select>
          <select id="hActivity" aria-label="Filter jenis aktivitas">
            <option value="">Semua aktivitas</option>
            ${ACTIVITIES.map(a => `<option${h.activity === a ? ' selected' : ''}>${esc(a)}</option>`).join('')}
          </select>
          <div class="filter-period">
            <span>Tanggal</span>
            <input id="hFrom" type="date" aria-label="Dari tanggal" value="${esc(h.from)}">
            <span>s.d.</span>
            <input id="hTo" type="date" aria-label="Sampai tanggal" value="${esc(h.to)}">
          </div>
          <div class="filter-extra">
            <button type="button" class="btn btn-ghost" id="hReset">Hapus filter</button>
            <span class="note" id="hCount"></span>
          </div>
        </div>

        <div id="historyArea"></div>
      </section>`;
  }

  function filteredHistory() {
    const h = state.hfilters;
    const q = h.q.trim().toLowerCase();

    return state.history.filter(r => {
      const day = String(r.time || '').slice(0, 10);
      if (h.from && day < h.from) return false;
      if (h.to && day > h.to) return false;
      if (h.unit && !String(r.unit).includes(h.unit)) return false;
      if (h.user && r.user !== h.user) return false;
      if (h.activity && r.activity !== h.activity) return false;
      if (q) {
        const text = [r.ref, r.field, r.before, r.after, r.unit, r.activity, r.id ? '#' + r.id : ''].join(' ').toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => String(b.time).localeCompare(String(a.time)) || Number(b.seq || 0) - Number(a.seq || 0));
  }

  function renderHistoryTable() {
    const area = document.getElementById('historyArea');
    if (!area) return;

    if (!state.historyLoaded) {
      area.innerHTML = state.historyLoading
        ? `<div class="tablewrap"><table><tbody>${loadingRow(6)}${loadingRow(6)}${loadingRow(6)}</tbody></table></div>`
        : '<div class="empty"><h3>Riwayat belum dimuat</h3><p>Gunakan tombol Muat ulang.</p></div>';
      return;
    }

    const rows = filteredHistory();
    const count = document.getElementById('hCount');
    if (count) count.textContent = `${integer(rows.length)} dari ${integer(state.history.length)} catatan`;

    if (!rows.length) {
      area.innerHTML = `
        <div class="empty" style="border-top:1px solid var(--border)">
          <h3>${state.history.length ? 'Tidak ada catatan yang sesuai' : 'Belum ada aktivitas tercatat'}</h3>
          <p>${state.history.length ? 'Ubah kata kunci atau filter.' : 'Aktivitas akan tercatat otomatis setiap kali transaksi ditambah atau diubah.'}</p>
        </div>`;
      return;
    }

    const shown = rows.slice(0, state.historyLimit);

    area.innerHTML = `
      <div class="tablewrap">
        <table class="hist">
          <thead>
            <tr>
              <th scope="col">Waktu</th>
              <th scope="col">Unit Kerja</th>
              <th scope="col">Referensi</th>
              <th scope="col">Aktivitas</th>
              <th scope="col">Perubahan</th>
              <th scope="col">Pengguna</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(r => `
              <tr>
                <td style="white-space:nowrap">${timeLabel(r.time)}</td>
                <td style="white-space:nowrap">${esc(r.unit || '—')}</td>
                <td class="ref">${esc(r.ref || '—')}${r.id ? `<span class="sub">Transaksi #${Number(r.id)}</span>` : ''}</td>
                <td><span class="activity">${esc(r.activity)}</span></td>
                <td class="wrap">
                  <div class="change">
                    ${r.field ? `<span class="field-name">${esc(r.field)}</span>` : ''}
                    ${r.before && r.after
                      ? `<span class="before">${esc(r.before)}</span><span class="arrow" aria-label="menjadi">→</span><span class="after">${esc(r.after)}</span>`
                      : esc(r.after || r.before || '')}
                  </div>
                </td>
                <td style="overflow-wrap:anywhere;min-width:180px">${esc(r.user)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${rows.length > shown.length ? `
        <div class="table-foot" style="text-align:center">
          <button type="button" class="btn btn-secondary" id="hMore">Tampilkan ${Math.min(100, rows.length - shown.length)} catatan berikutnya</button>
        </div>` : ''}`;

    const more = document.getElementById('hMore');
    if (more) more.addEventListener('click', () => { state.historyLimit += 100; renderHistoryTable(); });
  }

  function bindRiwayat() {
    renderHistoryTable();
    if (!state.historyLoaded && !state.historyLoading) loadHistory();

    const h = state.hfilters;
    const on = (id, event, fn) => document.getElementById(id).addEventListener(event, fn);
    const refresh = () => { state.historyLimit = 100; renderHistoryTable(); };

    on('hSearch', 'input', e => { h.q = e.target.value; refresh(); });
    on('hUnit', 'change', e => { h.unit = e.target.value; refresh(); });
    on('hUser', 'change', e => { h.user = e.target.value; refresh(); });
    on('hActivity', 'change', e => { h.activity = e.target.value; refresh(); });
    on('hFrom', 'change', e => { h.from = e.target.value; refresh(); });
    on('hTo', 'change', e => { h.to = e.target.value; refresh(); });
    on('hReset', 'click', () => {
      state.hfilters = { q: '', from: '', to: '', unit: '', user: '', activity: '' };
      renderPage();
    });
    on('hReload', 'click', loadHistory);
    on('hExport', 'click', exportHistory);
  }

  async function loadHistory() {
    state.historyLoading = true;
    renderHistoryTable();
    const button = document.getElementById('hReload');
    if (button) button.disabled = true;

    try {
      state.history = await server('listHistory') || [];
      state.historyLoaded = true;
    } catch (error) {
      notify(esc(errorText(error)), 'error');
    } finally {
      state.historyLoading = false;
      if (state.page === 'riwayat') renderPage();
    }
  }

  // =========================================
  // MENU KELOLA PENGGUNA (ADMIN)
  // =========================================

  function pagePengguna() {
    return `
      <section class="panel" aria-labelledby="ttlPengguna">
        <div class="panel-head">
          <div>
            <h3 id="ttlPengguna">Daftar Pengguna</h3>
            <p class="note">User ID dan password ditentukan oleh Admin. Password tersimpan tersandi dan tidak dapat dilihat kembali; gunakan Atur ulang password bila pengguna lupa.</p>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-primary" id="uAdd">${ICON.plus}Tambah pengguna</button>
            <button type="button" class="btn btn-secondary" id="uReload">${ICON.reload}Muat ulang</button>
          </div>
        </div>
        <div id="usersArea"></div>
      </section>

      <section class="panel" aria-labelledby="ttlPeran">
        <div class="panel-head">
          <div><h3 id="ttlPeran">Hak Akses per Peran</h3></div>
        </div>
        <div class="role-grid">
          ${ROLES.map(r => `
            <div class="role-card">
              <span class="role-tag">${esc(r)}</span>
              <p>${esc(ROLE_INFO[r])}</p>
            </div>`).join('')}
        </div>
      </section>`;
  }

  function renderUsersTable() {
    const area = document.getElementById('usersArea');
    if (!area) return;

    if (!state.usersLoaded) {
      area.innerHTML = state.usersLoading
        ? `<div class="tablewrap"><table><tbody>${loadingRow(6)}${loadingRow(6)}</tbody></table></div>`
        : '<div class="empty"><h3>Daftar pengguna belum dimuat</h3><p>Gunakan tombol Muat ulang.</p></div>';
      return;
    }

    const me = state.user ? state.user.userId : '';
    const order = { Admin: 0, Operator: 1, Pimpinan: 2 };
    const rows = state.users.slice().sort((a, b) =>
      Number(b.aktif) - Number(a.aktif) || order[a.peran] - order[b.peran] || a.userId.localeCompare(b.userId));

    area.innerHTML = `
      <div class="tablewrap">
        <table class="users">
          <thead>
            <tr>
              <th scope="col">User ID</th>
              <th scope="col">Nama</th>
              <th scope="col">Peran</th>
              <th scope="col">Status</th>
              <th scope="col">Masuk terakhir</th>
              <th scope="col">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(u => `
              <tr class="${u.aktif ? '' : 'inactive'}">
                <td><strong>${esc(u.userId)}</strong>${u.userId === me ? '<span class="sub">Akun Anda</span>' : ''}</td>
                <td>${esc(u.nama)}</td>
                <td><span class="role-tag">${esc(u.peran)}</span></td>
                <td>${u.aktif ? '<span class="badge sp2d">Aktif</span>' : '<span class="badge">Nonaktif</span>'}</td>
                <td style="white-space:nowrap">${u.masukTerakhir ? timeLabel(u.masukTerakhir) : '<span class="muted">Belum pernah</span>'}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-ghost" data-uact="edit" data-uid="${esc(u.userId)}">${ICON.edit}Ubah</button>
                    <button type="button" class="btn btn-ghost" data-uact="reset" data-uid="${esc(u.userId)}">${ICON.key}Atur ulang password</button>
                    ${u.userId === me ? '' : `<button type="button" class="btn btn-ghost${u.aktif ? ' btn-danger-ghost' : ''}" data-uact="toggle" data-uid="${esc(u.userId)}">${ICON.power}${u.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>`}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-foot">${integer(state.users.filter(u => u.aktif).length)} akun aktif dari ${integer(state.users.length)} akun.</div>`;
  }

  function bindPengguna() {
    renderUsersTable();
    if (!state.usersLoaded && !state.usersLoading) loadUsers();

    document.getElementById('uAdd').addEventListener('click', () => openUserModal(null));
    document.getElementById('uReload').addEventListener('click', loadUsers);
    document.getElementById('usersArea').addEventListener('click', event => {
      const button = event.target.closest('[data-uact]');
      if (!button) return;
      const user = state.users.find(u => u.userId === button.dataset.uid);
      if (!user) return;
      if (button.dataset.uact === 'edit') openUserModal(user);
      if (button.dataset.uact === 'reset') openResetModal(user);
      if (button.dataset.uact === 'toggle') openToggleUserModal(user);
    });
  }

  async function loadUsers() {
    state.usersLoading = true;
    renderUsersTable();
    try {
      state.users = await server('listUsers') || [];
      state.usersLoaded = true;
    } catch (error) {
      notify(esc(errorText(error)), 'error');
    } finally {
      state.usersLoading = false;
      renderUsersTable();
    }
  }

  // Password acak 12 karakter, tanpa huruf yang mudah tertukar.
  function randomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    let text = Array.from(bytes, b => chars[b % chars.length]).join('');
    if (!/\d/.test(text)) text = text.slice(0, 11) + '8';
    if (!/[A-Za-z]/.test(text)) text = 'P' + text.slice(1);
    return text;
  }

  function passwordProblem(value) {
    if (value.length < 8 || value.length > 72) return 'Password minimal 8 karakter (maksimal 72).';
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password harus berisi huruf dan angka.';
    return '';
  }

  function passwordField(label) {
    return `
      <label class="field">
        <span>${label}</span>
        <div class="pw-row">
          <input type="text" name="password" autocomplete="new-password" spellcheck="false" maxlength="72" placeholder="Minimal 8 karakter, huruf dan angka">
          <button type="button" class="btn btn-secondary" data-gen>Buat acak</button>
        </div>
        <span class="hint">Catat password ini dan sampaikan langsung kepada pengguna. Password tidak dapat dilihat kembali setelah disimpan.</span>
      </label>`;
  }

  function bindPasswordField(root) {
    const gen = root.querySelector('[data-gen]');
    if (gen) gen.addEventListener('click', () => {
      const input = root.querySelector('input[name="password"]');
      input.value = randomPassword();
      input.focus();
      input.select();
    });
  }

  function roleOptions(selected) {
    return ROLES.map(r => `<option value="${r}"${selected === r ? ' selected' : ''}>${r}</option>`).join('');
  }

  function openUserModal(user) {
    const editing = !!user;
    const self = editing && state.user && user.userId === state.user.userId;
    const html = `
      ${modalHead(editing ? `Ubah pengguna ${esc(user.userId)}` : 'Tambah pengguna',
        editing ? 'Perubahan peran berlaku segera; pengguna perlu masuk kembali.' : 'Akun baru langsung aktif dan dapat digunakan untuk masuk.')}
      <form id="userForm" novalidate>
        <div class="modal-body">
          <label class="field">
            <span>User ID</span>
            <input name="userId" maxlength="32" autocomplete="off" spellcheck="false" value="${editing ? esc(user.userId) : ''}"${editing ? ' disabled' : ''} placeholder="Contoh: operator.d1">
            ${editing ? '<span class="hint">User ID tidak dapat diubah.</span>' : '<span class="hint">3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.</span>'}
          </label>
          <label class="field">
            <span>Nama pengguna</span>
            <input name="nama" maxlength="100" value="${editing ? esc(user.nama) : ''}" placeholder="Nama lengkap atau jabatan">
          </label>
          <label class="field">
            <span>Peran</span>
            <select name="peran"${self ? ' disabled' : ''}>${roleOptions(editing ? user.peran : 'Operator')}</select>
            <span class="hint" id="roleHint"></span>
          </label>
          ${editing ? '' : passwordField('Password awal')}
          <div id="formError" class="inline-error" role="alert" hidden></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>Batal</button>
          <button type="submit" class="btn btn-primary" data-submit>${editing ? 'Simpan perubahan' : 'Tambah pengguna'}</button>
        </div>
      </form>`;

    const root = openModal(html, { small: true });
    const form = root.querySelector('#userForm');
    const hint = () => {
      root.querySelector('#roleHint').textContent = self
        ? 'Peran akun sendiri tidak dapat diubah.'
        : ROLE_INFO[form.elements.peran.value];
    };
    form.elements.peran.addEventListener('change', hint);
    hint();
    bindPasswordField(root);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = {
        baru: !editing,
        userId: editing ? user.userId : form.elements.userId.value.trim().toLowerCase(),
        nama: form.elements.nama.value.trim(),
        peran: self ? user.peran : form.elements.peran.value
      };

      let problem = '';
      if (!editing && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(data.userId)) problem = 'User ID 3–32 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.';
      else if (!editing && state.users.some(u => u.userId === data.userId)) problem = `User ID ${data.userId} sudah digunakan.`;
      else if (!data.nama) problem = 'Isi nama pengguna.';
      if (!problem && !editing) {
        data.password = form.elements.password.value;
        problem = passwordProblem(data.password);
      }
      if (problem) { showFormError(root, problem); return; }

      setBusy(root, true);

      try {
        await server('saveUser', data);
        state.modal.busy = false;
        closeModal();
        await loadUsers();
        notify(editing ? `Data pengguna ${esc(data.userId)} diperbarui.` : `Pengguna ${esc(data.userId)} ditambahkan sebagai ${esc(data.peran)}.`);
      } catch (error) {
        setBusy(root, false);
        showFormError(root, errorText(error));
      }
    });
  }

  function openResetModal(user) {
    const html = `
      ${modalHead(`Atur ulang password ${esc(user.userId)}`,
        'Password lama tidak berlaku lagi dan sesi pengguna yang sedang masuk akan diakhiri.')}
      <form id="resetForm" novalidate>
        <div class="modal-body">
          ${passwordField('Password baru')}
          <div id="formError" class="inline-error" role="alert" hidden></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>Batal</button>
          <button type="submit" class="btn btn-primary" data-submit>Simpan password</button>
        </div>
      </form>`;

    const root = openModal(html, { small: true });
    const form = root.querySelector('#resetForm');
    bindPasswordField(root);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const password = form.elements.password.value;
      const problem = passwordProblem(password);
      if (problem) { showFormError(root, problem); return; }

      setBusy(root, true);

      try {
        await server('resetPassword', { userId: user.userId, password });
        const self = state.user && user.userId === state.user.userId;
        state.modal.busy = false;
        closeModal();
        if (self) {
          clearSession();
          renderLogin('Password akun Anda telah diubah. Silakan masuk dengan password baru.');
          return;
        }
        await loadUsers();
        notify(`Password ${esc(user.userId)} telah diatur ulang. Sampaikan password baru kepada pengguna.`);
      } catch (error) {
        setBusy(root, false);
        showFormError(root, errorText(error));
      }
    });
  }

  function openToggleUserModal(user) {
    const activate = !user.aktif;
    const html = `
      ${modalHead(`${activate ? 'Aktifkan' : 'Nonaktifkan'} akun ${esc(user.userId)}`,
        activate ? 'Pengguna dapat kembali masuk dengan password terakhirnya.' : 'Pengguna tidak dapat masuk dan sesi yang sedang berjalan diakhiri. Riwayat aktivitasnya tetap tersimpan.')}
      <form id="toggleForm" novalidate>
        <div class="modal-body">
          <div class="doc-current">
            <strong>${esc(user.nama)}</strong><br>${esc(user.userId)} · ${esc(user.peran)}
          </div>
          <div id="formError" class="inline-error" role="alert" hidden></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-close>Kembali</button>
          <button type="submit" class="btn ${activate ? 'btn-primary' : 'btn-danger'}" data-submit>${activate ? 'Aktifkan akun' : 'Nonaktifkan akun'}</button>
        </div>
      </form>`;

    const root = openModal(html, { small: true });

    root.querySelector('#toggleForm').addEventListener('submit', async event => {
      event.preventDefault();
      setBusy(root, true, 'Memproses…');
      try {
        await server('setUserActive', { userId: user.userId, aktif: activate });
        state.modal.busy = false;
        closeModal();
        await loadUsers();
        notify(`Akun ${esc(user.userId)} ${activate ? 'diaktifkan' : 'dinonaktifkan'}.`);
      } catch (error) {
        setBusy(root, false);
        showFormError(root, errorText(error));
      }
    });
  }

  // =========================================
  // DATA DAN EKSPOR
  // =========================================

  async function loadData(silent) {
    state.loading = true;
    const button = document.getElementById('reload');
    if (button) button.disabled = true;

    try {
      const data = await server('getAppData');
      const roleChanged = !state.user || state.user.peran !== data.user.peran;
      state.user = data.user;
      saveSession();
      if (roleChanged) renderShell();
      state.pagu = data.pagu || [];
      state.paguTotal = data.paguTotal || state.paguTotal;
      state.entries = (data.entries || []).map(e => Object.assign({}, e, {
        id: Number(e.id), amount: Number(e.amount) || 0
      }));
      state.loaded = true;
      state.loadError = '';
      state.historyLoaded = false;
      if (!silent) {
        const box = document.getElementById('notice');
        if (box && !box.classList.contains('warn')) box.hidden = true;
      }
      renderUserBox();
    } catch (error) {
      state.loadError = errorText(error);
      notify(esc(state.loadError), 'error');
    } finally {
      state.loading = false;
      if (!state.modal) renderPage();
      else if (state.page === 'dana') renderTrxTable();
      renderNavBadge();
    }
  }

  function csvCell(value) {
    let text = String(value == null ? '' : value);
    if (/^[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function download(name, rows) {
    const content = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function exportEntries() {
    download('Penggunaan_Dana_PRRP_' + stamp() + '.csv', [
      ['ID transaksi', 'Kode kegiatan', 'Tanggal kegiatan', 'Unit kerja', 'Uraian kegiatan',
        'Provinsi pelaksanaan', 'Kabupaten/Kota pelaksanaan', 'Kategori lokasi', 'Nilai transaksi',
        'Status', 'Lama di status (hari)', 'Perlu tindak lanjut', 'Referensi dokumen', 'Nama berkas', 'Tautan dokumen'],
      ...filteredEntries().map(e => [
        e.id, e.kegiatanId, e.date, unitName(e.unit), e.note,
        e.provinsi, e.kabkota, CAT[category(e)].label, e.amount,
        STATUS_INFO[e.status] ? STATUS_INFO[e.status].label : 'Belum ditentukan',
        daysInStatus(e) === null ? '' : daysInStatus(e),
        staleInfo(e) ? staleInfo(e).text : '',
        e.ref, e.fileName,
        e.fileKey ? fileUrl(e) : ''
      ])
    ]);
  }

  function exportHistory() {
    if (!state.historyLoaded) { notify('Riwayat belum dimuat.', 'error'); return; }
    download('Riwayat_Transaksi_PRRP_' + stamp() + '.csv', [
      ['Waktu', 'ID transaksi', 'Unit kerja', 'Referensi', 'Aktivitas', 'Perubahan', 'Nilai sebelum', 'Nilai sesudah', 'Pengguna'],
      ...filteredHistory().map(r => [r.time, r.id, r.unit, r.ref, r.activity, r.field, r.before, r.after, r.user])
    ]);
  }

  // =========================================
  // MULAI
  // =========================================

  // =========================================
  // MASUK DAN KELUAR
  // =========================================

  function resetState() {
    Object.assign(state, {
      page: 'ringkasan', user: null, users: [], usersLoaded: false, usersLoading: false,
      pagu: [], entries: [], loaded: false, loading: false, loadError: '',
      history: [], historyLoaded: false, historyLoading: false, historyLimit: 100,
      selected: null, expanded: {},
      filters: { q: '', unit: '', lokasi: '', status: '', from: '', to: '' },
      hfilters: { q: '', from: '', to: '', unit: '', user: '', activity: '' }
    });
  }

  function renderLogin(message) {
    closeModal();
    resetState();
    document.body.classList.add('login-mode');

    document.getElementById('root').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <div class="login-brand">
            <div class="brand-mark" aria-hidden="true">PR</div>
            <div>
              <div class="brand-name">Kendali PRRP</div>
              <div class="brand-sub">Tahun Anggaran 2027</div>
            </div>
          </div>
          <div class="app-org">Kementerian Koordinator Bidang Infrastruktur dan Pembangunan Kewilayahan</div>
          <h1 class="login-title">MONITORING PERCEPATAN REHABILITASI DAN REKONSTRUKSI PASCABENCANA TA 2027</h1>

          <form id="loginForm" novalidate>
            <h2>Masuk</h2>
            ${message ? `<div class="login-info" role="status">${esc(message)}</div>` : ''}
            <label class="field">
              <span>User ID</span>
              <input name="userId" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" required>
            </label>
            <label class="field">
              <span>Password</span>
              <div class="pw-row">
                <input name="password" type="password" autocomplete="current-password" maxlength="72" required>
                <button type="button" class="btn btn-secondary pw-toggle" id="pwToggle" aria-label="Tampilkan password" aria-pressed="false">${ICON.eye}</button>
              </div>
            </label>
            <div id="formError" class="inline-error" role="alert" hidden></div>
            <button type="submit" class="btn btn-primary login-submit" data-submit>Masuk</button>
            <p class="note login-help">Akun dibuat oleh Admin aplikasi. Hubungi Admin bila belum memiliki akun atau lupa password.</p>
          </form>
        </div>
        <div class="login-foot">Dashboard monitoring internal Kementerian Koordinator Bidang Infrastruktur dan Pembangunan Kewilayahan.</div>
      </div>`;

    const form = document.getElementById('loginForm');
    const toggle = document.getElementById('pwToggle');

    toggle.addEventListener('click', () => {
      const show = form.elements.password.type === 'password';
      form.elements.password.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
    });

    setTimeout(() => form.elements.userId.focus(), 30);

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const userId = form.elements.userId.value.trim().toLowerCase();
      const password = form.elements.password.value;
      const box = form.querySelector('#formError');
      const show = text => { box.textContent = text; box.hidden = !text; };

      if (!userId || !password) { show('Isi User ID dan password.'); return; }
      show('');

      const submit = form.querySelector('[data-submit]');
      submit.disabled = true;
      submit.textContent = 'Memeriksa…';

      try {
        const result = await server('login', { userId, password });
        state.token = result.token;
        state.user = result.user;
        saveSession();
        enterApp();
      } catch (error) {
        submit.disabled = false;
        submit.textContent = 'Masuk';
        show(errorText(error));
        form.elements.password.value = '';
        form.elements.password.focus();
      }
    });
  }

  function enterApp() {
    document.body.classList.remove('login-mode');
    renderShell();
    renderPage();
    loadData();
    loadBackground();
  }

  function signOut() {
    clearSession();
    renderLogin('Anda telah keluar.');
  }

  let expiredShown = false;

  function sessionExpired(message) {
    if (expiredShown || !state.token) return;
    expiredShown = true;
    clearSession();
    renderLogin(/dinonaktifkan|belum terdaftar/.test(message || '')
      ? message : 'Sesi berakhir. Silakan masuk kembali.');
    setTimeout(() => { expiredShown = false; }, 500);
  }

  function loadBackground() {
    server('getBackground')
      .then(url => {
        if (url) document.body.style.backgroundImage = 'url("' + url + '")';
      })
      .catch(() => {
        // Aplikasi tetap berjalan dengan latar warna polos.
      });
  }

  // =========================================
  // MULAI
  // =========================================

  function renderSetupNeeded(message) {
    document.getElementById('root').innerHTML = `
      <div class="login-page">
        <div class="login-card">
          <h2>${esc(message ? 'Aplikasi tidak dapat dimuat' : 'Konfigurasi belum lengkap')}</h2>
          <p class="note">${esc(message || 'Isi alamat proyek (supabaseUrl) dan kunci publik (supabaseAnonKey) Supabase pada berkas config.js, lalu muat ulang halaman ini.')}</p>
        </div>
      </div>`;
  }

  async function start() {
    if (!REF || !REF.wilayah) {
      renderSetupNeeded('Data wilayah (wilayah.js) tidak termuat. Pastikan berkas wilayah.js ada di folder yang sama dengan index.html.');
      return;
    }

    buildProv();

    if (!window.supabase) {
      renderSetupNeeded('Pustaka Supabase tidak termuat. Periksa koneksi internet, lalu muat ulang halaman.');
      return;
    }

    if (!sb) { renderSetupNeeded(''); return; }

    // Sesi yang tidak dapat diperpanjang (misalnya password diatur ulang).
    sb.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' && state.token) sessionExpired();
    });

    const saved = await readSession();

    if (saved) {
      state.token = saved.token;
      state.user = saved.user;
      enterApp();
    } else {
      renderLogin('');
    }
  }

  start();
})();
