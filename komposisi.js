window.pasangKomposisiPRRP = async function (page, token, admin, stats) {
  const panel = document.createElement('section');
  panel.id = 'komposisi-prrp';
  panel.innerHTML = `
    <header><h3 class="fa-title">Komposisi Anggaran PRRP</h3><small>Dalam ribuan rupiah</small></header>
    <div class="fa-scroll" tabindex="0"><table aria-label="Komposisi anggaran PRRP">
      <thead><tr><th scope="col">Kelompok Belanja</th><th scope="col">Pagu</th><th scope="col">Realisasi FA</th><th scope="col">Sisa menurut FA</th><th scope="col">% Realisasi FA</th></tr></thead>
      <tbody><tr><th scope="row">Perjalanan Dinas (524)</th></tr><tr><th scope="row">Non-Perjalanan Dinas (Non-524)</th></tr></tbody>
      <tfoot><tr><th scope="row">Total PRRP</th></tr></tfoot>
    </table></div>
    <footer><small role="status">Memuat laporan…</small></footer>`;
  const first = page.querySelector('[aria-labelledby="tblRingkasan"]');
  if (first) first.before(panel); else page.append(panel);
  const msg = panel.querySelector('[role=status]');
  const call = (method, ...args) => new Promise((ok, fail) => {
    window.prrpRequest(method, args.length > 1 ? args[1] : args[0]).then(ok, fail);
  });
  const fmt = n => (n / 1000).toLocaleString('id-ID', {maximumFractionDigits: 3});
  let current;
  function show(data) {
    current = data;
    const realAda = Number.isSafeInteger(data?.real524) && Number.isSafeInteger(data?.realNon524);
    const angka = [
      [data?.perjalanan, realAda ? data.real524 : null],
      [data?.lainnya, realAda ? data.realNon524 : null],
      [data ? data.perjalanan + data.lainnya : stats?.total.budget, realAda ? data.real524 + data.realNon524 : null]
    ];
    panel.querySelector('table').querySelectorAll('tbody tr, tfoot tr').forEach((row,i)=>{
      while(row.cells.length>1) row.deleteCell(1);
      const [pagu,real]=angka[i];
      const nilai=[pagu==null?'—':fmt(pagu),real==null?'—':fmt(real),
        real==null?'—':fmt(pagu-real),real==null||!pagu?'—':
        (real/pagu).toLocaleString('id-ID',{style:'percent',maximumFractionDigits:2})];
      nilai.forEach(v=>row.insertCell().textContent=v);
    });
    msg.textContent=!data?'Menunggu laporan FA Detail 8179.PEA TA 2027.':
      'Periode '+data.bulan+'/2027'+(realAda?' · Realisasi kumulatif':' · Unggah ulang PDF untuk melengkapi realisasi.');
  }
  show(null);
  msg.textContent='Memuat laporan…';
  try { show(await call('bacaKomposisiPRRP',token)); }
  catch(e) { msg.textContent=e.message; return; }
  if (!admin || !panel.isConnected) return;
  const footer = panel.querySelector('footer');
  const controls = document.createElement('div');
  controls.className = 'fa-actions';
  controls.innerHTML = `
    <label>Pilih laporan FA Detail<input type="file" accept="application/pdf,.pdf"></label>
    <span class="file-info" aria-live="polite"></span>
    <button type="button" class="btn btn-primary" hidden>Unggah</button>
    <button type="button" class="btn btn-secondary" hidden>Batal</button>`;
  footer.append(controls);
  const input = controls.querySelector('input');
  const [upload, cancel] = controls.querySelectorAll('button');
  const info = controls.querySelector('.file-info');
  function resetChoice() {
    input.value = '';
    info.textContent = '';
    upload.hidden = cancel.hidden = true;
  }
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return resetChoice();
    info.textContent = file.name + ' · ' + Math.ceil(file.size / 1024).toLocaleString('id-ID') + ' KB';
    upload.hidden = cancel.hidden = false;
    msg.textContent = 'Periksa berkas, lalu pilih Unggah atau Batal.';
  };
  cancel.onclick = () => {
    resetChoice();
    show(current);
  };
  upload.onclick = async () => {
    const file = input.files[0];
    if (!file || upload.disabled) return;
    upload.disabled = cancel.disabled = input.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    try {
      if(file.size>10*1024*1024) throw Error('Ukuran PDF maksimal 10 MB.');
      msg.textContent='Memeriksa laporan…';
      const lib=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      const doc=await lib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
      const pages=[];
      try {
        for(let n=1;n<=doc.numPages;n++){
          const p=await doc.getPage(n), v=p.getViewport({scale:1}), tc=await p.getTextContent();
          const lines=[];
          for(const it of tc.items){
            if(!it.str || !it.str.trim()) continue;
            const [x,y]=v.convertToViewportPoint(it.transform[4],it.transform[5]);
            let line=lines.find(l=>Math.abs(l.y-y)<2.6);
            if(!line){line={y:y,cells:[]};lines.push(line);}
            line.cells.push({x:x,end:x+it.width,t:it.str.trim()});
          }
          pages.push(lines.sort((a,b)=>a.y-b.y).map(l=>l.cells.sort((a,b)=>a.x-b.x)));
        }
      } finally { await doc.destroy(); }
      const text = pages.flatMap(page => page.map(row => row.map(cell => cell.t).join(' '))).join('\n');
      if (!text.trim()) throw Error('Isi PDF tidak terbaca. Pilih PDF laporan asli.');
      if (!/\b8179\s*\.\s*PEA\b/i.test(text)) throw Error('Dokumen tidak dapat diproses. Kode 8179.PEA tidak ditemukan dalam berkas.');
      const parsed=bacaAkunFA(pages);
      msg.textContent = 'Memvalidasi berkas di server…';
      const pdf=await new Promise((ok,fail)=>{const reader=new FileReader();reader.onerror=()=>fail(Error('PDF gagal dibaca.'));reader.onload=()=>ok(reader.result.split(',')[1]);reader.readAsDataURL(file);});
      show(await call('simpanKomposisiPRRP',token,{...parsed,pdf:pdf,sebelum:current?current.hash:''}));
      msg.textContent = 'Laporan berhasil diproses. ' + msg.textContent;
    } catch(e){msg.textContent=e.message || String(e);}
    finally {
      resetChoice();
      upload.disabled = cancel.disabled = input.disabled = false;
      panel.removeAttribute('aria-busy');
    }
  };
};

function bacaAkunFA(pages) {
  const months='januari februari maret april mei juni juli agustus september oktober november desember'.split(' ');
  const akun=[];
  let kegiatan='', aktif=false, subtotal=null, realSubtotal=null,bulan=0;
  for(const lines of pages){
    const texts=lines.map(c=>c.map(i=>i.t).join(' '));
    const header=texts.join(' ');
    if(!/LAPORAN KETERSEDIAAN DANA DETAIL TA\s+2027\b/i.test(header)) throw Error('Gunakan Laporan Ketersediaan Dana Detail TA 2027.');
    const period=header.match(/Periode\s+([a-z]+)\s+2027/i);
    const m=period && months.indexOf(period[1].toLowerCase())+1;
    if(!m || (bulan && bulan!==m)) throw Error('Periode laporan tidak konsisten.');
    bulan=m;
    const h=lines.find(c=>/Pagu Revisi/.test(c.map(i=>i.t).join(' ')) && /Lock Pagu/.test(c.map(i=>i.t).join(' ')));
    if(!h) throw Error('Kolom Pagu Revisi tidak terbaca.');
    const i=h.findIndex(c=>/Pagu/.test(c.t)), j=h.findIndex(c=>/Lock/.test(c.t));
    if(i<0||j<=i) throw Error('Posisi kolom pagu tidak terbaca.');
    const left=h[i].x-(h[j].x-h[i].x)*0.6,right=h[j].x-3;
    const head=lines.find(c=>/s\.d\.\s*Periode/i.test(c.map(i=>i.t).join(' ')));
    const sd=head?.find(c=>/^s\.d\./i.test(c.t)), pct=head?.find(c=>c.t==='%');
    if(!sd || !pct || pct.x<=sd.x) throw Error('Kolom realisasi s.d. Periode tidak terbaca.');
    function kumulatif(cells){
      const nums=cells.filter(c=>c.end>sd.x && c.end<pct.x && /^-?(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(c.t));
      if(nums.length!==1) throw Error('Nilai realisasi kumulatif tidak terbaca.');
      return Number(nums[0].t.replace(/[.,]/g,''));
    }
    for(const cells of lines){
      const start=cells[0].t, code=start.split(/\s/)[0];
      if (/^[A-Z]{2}\.\d{4}$/.test(code)){ kegiatan=code.slice(-4);aktif=false; }
      else if (/^[A-Z]{2}$/.test(code)){kegiatan='';aktif=false;}
      const combined=/^\d{4}\.[A-Z]{3}$/.test(code);
      if(combined || /^[A-Z]{3}$/.test(code)){
        if (combined) kegiatan=code.slice(0,4);
        aktif=combined ? code==='8179.PEA' : kegiatan==='8179' && code==='PEA';
        if(!aktif) continue;
        if(subtotal!==null) throw Error('Subtotal 8179.PEA muncul lebih dari sekali.');
        subtotal=amount(cells); realSubtotal=kumulatif(cells);
      } else if(aktif && /^5\d{5}$/.test(code)) akun.push({kode:code,pagu:amount(cells),real:kumulatif(cells)});
    }
    function amount(cells){
      const numbers=cells.filter(c=>c.x>=left && c.x<right && /^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(c.t));
      if(numbers.length!==1) throw Error('Ada baris akun atau subtotal dengan pagu yang tidak terbaca.');
      return Number(numbers[0].t.replace(/[.,]/g,''));
    }
  }
  if(subtotal===null) throw Error('Dokumen tidak dapat diproses. Kode 8179.PEA tidak ditemukan dalam berkas.');
  if(!akun.length || subtotal!==5600000000 || akun.reduce((n,r)=>n+r.pagu,0)!==subtotal)
    throw Error('Jumlah akun belum cocok dengan subtotal dan pagu PRRP Rp5.600.000.000.');
  if(akun.reduce((n,r)=>n+r.real,0)!==realSubtotal) throw Error('Realisasi akun tidak cocok dengan subtotal 8179.PEA.');
  return {realSubtotal:realSubtotal,tahun:2027,kode:'8179.PEA',bulan:bulan,subtotal:subtotal,akun:akun};
}
