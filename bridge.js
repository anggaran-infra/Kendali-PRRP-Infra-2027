/* Koneksi tunggal browser ke Supabase. Tidak menaruh service_role di sini. */
(() => {
  'use strict';
  const cfg = window.PRRP_CONFIG;
  if (!cfg || !/^https:\/\//.test(cfg.url) || !cfg.publishableKey || !window.supabase) {
    document.getElementById('root').textContent = 'Konfigurasi Supabase belum siap. Isi public/config.js.';
    throw Error('Missing Supabase configuration');
  }
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  window.PRRP_AUTH = client;
  window.prrpRequest = async function (name, arg) {
    if (name === 'getReferensi') return window.REFERENSI_PRRP;
    if (name === 'login') {
      const userId = String(arg?.userId || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(userId)) throw Error('User ID tidak valid.');
      const {data,error} = await client.auth.signInWithPassword({email:userId+'@'+cfg.loginDomain,password:arg.password});
      if (error) throw Error('User ID atau password tidak sesuai.');
      try {
        const profile = await invoke('whoami',null,data.session.access_token);
        return {token:data.session.access_token,user:profile};
      } catch(e) {await client.auth.signOut();throw e;}
    }
    if (name === 'logout') {await client.auth.signOut();return {ok:true};}
    const {data:sessionInfo} = await client.auth.getSession();
    const token = sessionInfo?.session?.access_token;
    if (!token) throw Error('Sesi berakhir. Silakan masuk kembali.');
    return invoke(name,arg,token);
  };
  async function invoke(name,arg,token) {
    const response = await fetch(cfg.url.replace(/\/$/,'')+'/functions/v1/'+(cfg.functionName||'prrp-api'),{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token,'apikey':cfg.publishableKey},
      body:JSON.stringify({name,arg})
    });
    const result = await response.json().catch(()=>({error:'Server mengembalikan respons tidak valid.'}));
    if (!response.ok) throw Error(result.error || 'Permintaan gagal ('+response.status+').');
    return result.data;
  }
  // Restore a current access token on page reload instead of the expired cached JWT.
  window.PRRP_BOOT = async function () {
    const response=await fetch('./referensi.json');
    if (!response.ok) throw Error('Data wilayah tidak dapat dimuat.');
    window.REFERENSI_PRRP=await response.json();
    const {data} = await client.auth.getSession();
    if (data?.session) {
      // Legacy state in app.js reads this key on startup.
      const existing=JSON.parse(sessionStorage.getItem('kendaliPrrpSesi')||'null');
      if (existing) {
        existing.token=data.session.access_token;
        try {existing.user=await invoke('whoami',null,data.session.access_token);sessionStorage.setItem('kendaliPrrpSesi',JSON.stringify(existing));}
        catch (_) {sessionStorage.removeItem('kendaliPrrpSesi');await client.auth.signOut();}
      }
    } else {sessionStorage.removeItem('kendaliPrrpSesi');}
  };
  // Private PDF links must be signed server-side; no public Storage access.
  document.addEventListener('click', async e => {
    const link=e.target.closest?.('a[href^="#pdf/"]');
    if (!link) return;
    e.preventDefault();
    const popup=window.open('about:blank','_blank');
    try {const url=await window.prrpRequest('pdfUrl',{key:decodeURIComponent(link.getAttribute('href').slice(5))});
      if(popup) popup.location.href=url;else window.location.href=url;
    } catch(err) {if(popup) popup.close();alert(err.message);}
  });
})();
