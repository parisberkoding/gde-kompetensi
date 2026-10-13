#!/usr/bin/env node
/**
 * ============================================================================
 * uji-ui.js — Uji tampilan frontend myCertif tanpa browser (DOM stub)
 * Jalankan dari akar project:  node _tools/uji-ui.js
 * ============================================================================
 *
 * Berkas ini mengekstrak blok <script> dari Frontend/*.html.txt, menjalankannya
 * di atas tiruan DOM sederhana, lalu memeriksa HTML yang dihasilkan serta
 * perilaku dialog.
 *
 * Yang dibuktikan antara lain:
 *   - kolom "Berlaku Hingga" merender tanggal + "3 Tahun 2 Bulan 4 Hari"
 *   - kolom waktu tidak lagi menampilkan "Thu Oct 08 2026 GMT+0700"
 *   - istilah verifikasi memakai "Perlu Revisi", bukan "Ditolak"
 *   - dialog verifikasi menolak disimpan bila "Perlu Revisi" tanpa catatan
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DIR_FE = path.join(ROOT, 'Frontend');

let lulus = 0, gagal = 0;
const kegagalan = [];
function ok(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log('  \u2713 ' + nama); return true; }
  gagal++; kegagalan.push(nama + (detail ? ' -> ' + detail : ''));
  console.log('  \u2717 ' + nama + (detail ? '  [' + detail + ']' : ''));
  return false;
}
function sama(nama, dapat, harap) {
  return ok(nama, String(dapat) === String(harap),
    'dapat=' + JSON.stringify(dapat) + ' harap=' + JSON.stringify(harap));
}
function head(s) { console.log('\n' + s); }

/** Ambil isi blok <script> (tanpa src) dari sebuah berkas .html.txt. */
function skripDari(namaBerkas) {
  const teks = fs.readFileSync(path.join(DIR_FE, namaBerkas), 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const bagian = [];
  let m;
  while ((m = re.exec(teks)) !== null) {
    const isi = m[1].replace(/<\?[\s\S]*?\?>/g, 'null');
    if (isi.trim()) bagian.push(isi);
  }
  return bagian.join('\n;\n');
}

// ============================================================================
// DOM STUB
// ============================================================================

/**
 * Node tiruan. Cukup untuk: menyimpan innerHTML, mencari anak lewat selector
 * (dimemo per selector), menyimpan & memicu handler event, dan dibuang dari
 * induknya — sehingga perilaku dialog benar-benar bisa diuji, bukan diasumsikan.
 */
function buatNode(id) {
  const node = {
    id: id || '',
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    className: '',
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    _sel: new Map(),
    _handlers: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) {
        if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (on) this._s.add(c); else this._s.delete(c);
      },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(ev, fn) { this._handlers[ev] = fn; },
    removeEventListener(ev) { delete this._handlers[ev]; },
    /** Picu handler yang terpasang (untuk simulasi klik). */
    dispatch(ev) { if (this._handlers[ev]) this._handlers[ev]({ target: this, preventDefault() { } }); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      c.parentNode = null;
      return c;
    },
    setAttribute() { },
    getAttribute() { return null; },
    querySelector(sel) {
      if (!this._sel.has(sel)) this._sel.set(sel, buatNode(id + ' ' + sel));
      return this._sel.get(sel);
    },
    querySelectorAll(sel) { return [this.querySelector(sel)]; },
    closest() { return null; },
    focus() { }, blur() { }, click() { },
    scrollIntoView() { },
    contains() { return false; },
    insertAdjacentHTML() { },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  };
  return node;
}

function buatDokumen() {
  const nodes = new Map();
  const doc = {
    _nodes: nodes,
    body: buatNode('body'),
    documentElement: buatNode('html'),
    readyState: 'complete',
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, buatNode(id));
      return nodes.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return buatNode('<' + tag + '>'); },
    createDocumentFragment() { return buatNode('#fragment'); },
    addEventListener() { }
  };
  /*
   * Meniru perilaku browser: begitu sebuah elemen ber-id ditempelkan ke body,
   * elemen itu bisa ditemukan lewat getElementById — dan hilang lagi setelah
   * dilepas. Tanpa ini, pengujian dialog akan memakai elemen hantu.
   */
  doc.body.appendChild = function (c) {
    c.parentNode = doc.body;
    doc.body.children.push(c);
    if (c.id) nodes.set(c.id, c);
    return c;
  };
  doc.body.removeChild = function (c) {
    doc.body.children = doc.body.children.filter((x) => x !== c);
    c.parentNode = null;
    if (c.id && nodes.get(c.id) === c) nodes.delete(c.id);
    return c;
  };
  return doc;
}

// ============================================================================
// LINGKUNGAN
// ============================================================================

const dokumen = buatDokumen();
const sandbox = {
  console,
  document: dokumen,
  window: { addEventListener() { }, location: { hash: '', href: '' } },
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, RegExp, Error, Number, String, Boolean, Array, Object,
  Promise, isNaN, parseInt, parseFloat,
  google: {
    script: {
      run: {
        withSuccessHandler() { return this; },
        withFailureHandler() { return this; }
      }
    }
  }
};

const ctx = vm.createContext(sandbox);
vm.runInContext(skripDari('Javascript.html.txt'), ctx, { filename: 'Javascript.html.txt' });

/** Tunggu microtask + timer supaya Promise yang selesai sempat jalan. */
const tunggu = () => new Promise((r) => setTimeout(r, 0));

// ============================================================================

async function main() {
  console.log('='.repeat(78));
  console.log(' myCertif — uji tampilan frontend (DOM stub, tanpa browser)');
  console.log('='.repeat(78));

  head('1. Modul MyCertif termuat');
  ok('namespace MyCertif tersedia sebagai global',
    typeof ctx.MyCertif === 'object' && ctx.MyCertif !== null);
  ok('MyCertif.masaBerlakuTeks terdaftar', typeof ctx.MyCertif.masaBerlakuTeks === 'function');
  ok('MyCertif.durasiDariHari terdaftar', typeof ctx.MyCertif.durasiDariHari === 'function');
  ok('MyCertif.verifikasiBadge terdaftar', typeof ctx.MyCertif.verifikasiBadge === 'function');
  ok('MyCertif.dialogForm terdaftar', typeof ctx.MyCertif.dialogForm === 'function');

  head('2. Format teks masa berlaku');
  {
    const S = ctx.MyCertif;
    sama('memakai sisa_teks dari backend apa adanya',
      S.masaBerlakuTeks({ sisa_teks: '3 Tahun 2 Bulan 4 Hari', sisa_hari: 1169 }),
      '3 Tahun 2 Bulan 4 Hari');
    sama('durasiKalender sama persis dengan backend (3 Th 2 Bl 4 Hr)',
      S.durasiKalender('2029-03-19', '2026-01-15'), '3 Tahun 2 Bulan 4 Hari');
    sama('cadangan dari expired_at memakai kalender',
      S.masaBerlakuTeks({ sisa_teks: '', expired_at: '2029-03-19', sisa_hari: 1169 }),
      S.durasiKalender('2029-03-19'));
    sama('cadangan terakhir dari sisa_hari bila expired_at tidak ada',
      S.masaBerlakuTeks({ sisa_teks: '', expired_at: '', sisa_hari: 0 }), '0 Hari');
    sama('masa berlaku kosong -> tanda hubung', S.masaBerlakuTeks({ sisa_teks: '', sisa_hari: null }), '—');
    sama('objek kosong -> tanda hubung', S.masaBerlakuTeks(null), '—');
    sama('kedaluwarsa ditandai', S.masaBerlakuTeks({ sisa_teks: 'Lewat 1 Bulan 5 Hari', sisa_hari: -35 }),
      'Lewat 1 Bulan 5 Hari');
    sama('durasiDariHari 1095 hari = tepat 3 tahun', S.durasiDariHari(1095), '3 Tahun');
    sama('durasiDariHari 30 hari', S.durasiDariHari(30), '1 Bulan');
    sama('durasiDariHari 5 hari', S.durasiDariHari(5), '5 Hari');
    sama('durasiDariHari negatif', S.durasiDariHari(-40), 'Lewat 1 Bulan 10 Hari');
  }

  head('3. Format waktu (perbaikan "Thu Oct 08 2026 GMT+0700")');
  {
    const S = ctx.MyCertif;
    sama('waktuIndo memformat waktu ISO-like', S.waktuIndo('2026-10-08 15:20:32'), '8 Oktober 2026, 15:20');
    sama('waktuIndo tetap bisa membaca string Date mentah',
      S.waktuIndo('Thu Oct 08 2026 15:20:32 GMT+0700 (Waktu Indonesia Barat)'),
      '8 Oktober 2026, 15:20');
    sama('waktuIndo kosong -> tanda hubung', S.waktuIndo(''), '—');
    ok('tidak lagi mengandung "GMT"', S.waktuIndo('2026-10-08 15:20:32').indexOf('GMT') === -1);
    ok('toDateTime mempertahankan jam (berbeda dari toDate)',
      S.toDateTime('2026-10-08 15:20:32').getHours() === 15,
      String(S.toDateTime('2026-10-08 15:20:32')));
    ok('toDate tetap memotong ke tengah malam (memang untuk kolom tanggal)',
      S.toDate('2026-10-08 15:20:32').getHours() === 0);
    sama('waktuLalu memakai jam, bukan tengah malam',
      S.waktuLalu(new Date(Date.now() - 2 * 3600000)), '2 jam lalu');
  }

  head('4. Istilah verifikasi: "Perlu Revisi", bukan "Ditolak"');
  {
    const S = ctx.MyCertif;
    S.state.meta = {
      verifikasi_defs: [
        { key: 'PENDING', label: 'Menunggu Verifikasi', short: 'Menunggu', tone: 'yellow', icon: 'bi-hourglass-split', ket: 'menunggu' },
        { key: 'VERIFIED', label: 'Terverifikasi', short: 'Terverifikasi', tone: 'green', icon: 'bi-patch-check-fill', ket: 'benar' },
        { key: 'REVISI', label: 'Perlu Revisi', short: 'Perlu Revisi', tone: 'red', icon: 'bi-arrow-counterclockwise', ket: 'perbaiki' }
      ],
      statuses: [{ key: 'MASIH_BERLAKU', label: 'Masih Berlaku', tone: 'green', icon: 'bi-check' }],
      divisi_options: ['Pemeliharaan', 'Operasi']
    };

    sama('label REVISI', S.verifikasiLabel('REVISI'), 'Perlu Revisi');
    sama('label PENDING', S.verifikasiLabel('PENDING'), 'Menunggu Verifikasi');
    sama('istilah lama REJECTED dipetakan ke Perlu Revisi', S.verifikasiLabel('REJECTED'), 'Perlu Revisi');
    sama('istilah lama Ditolak dipetakan ke Perlu Revisi', S.verifikasiLabel('Ditolak'), 'Perlu Revisi');

    const b = S.verifikasiBadge('REVISI');
    ok('badge revisi memuat "Perlu Revisi"', b.indexOf('Perlu Revisi') !== -1, b);
    ok('badge TIDAK memuat kata "Ditolak"', b.indexOf('Ditolak') === -1, b);
    ok('badge memakai kelas merah', b.indexOf('gde-badge--red') !== -1, b);
    ok('badge terverifikasi memakai kelas hijau',
      S.verifikasiBadge('VERIFIED').indexOf('gde-badge--solid') !== -1,
      S.verifikasiBadge('VERIFIED'));
    ok('badge menunggu memakai kelas kuning',
      S.verifikasiBadge('PENDING').indexOf('gde-badge--yellow') !== -1);
  }

  head('5. Kolom "Berlaku Hingga" pada tabel Data Sertifikasi');
  {
    ctx.MyCertif.state.user = { employee_code: '4100000-C', role: 'HC', username: 'hc' };

    vm.runInContext(skripDari('DataSertifikasi.html.txt'), ctx, { filename: 'DataSertifikasi.html.txt' });
    ok('renderDsTabel tersedia', typeof ctx.renderDsTabel === 'function');

    const d = {
      page: 1, per_page: 25, total: 2, pages: 1,
      status_defs: [
        { key: 'MASIH_BERLAKU', label: 'Masih Berlaku', tone: 'green', icon: 'bi-check-circle-fill' },
        { key: 'SEGERA_PERPANJANG', label: 'Segera Perpanjang', tone: 'red', icon: 'bi-exclamation-triangle-fill' }
      ],
      rows: [
        {
          doc_id: 'DOC-202601-0001', employee_id: '4100000-C', nama_pemegang: 'Budi Santoso',
          divisi: 'Pemeliharaan', jabatan: 'Staf', nama_sertifikasi: 'Pengawas Operasional Pertama (POP)',
          penyelenggara: 'Lembaga K3', no_sertifikat: 'CERT/1',
          expired_at: '2029-03-19', recom_update: '2028-12-19',
          sisa_hari: 1000, sisa_bulan: 33.3, sisa_teks: '2 Tahun 8 Bulan 22 Hari',
          status: 'MASIH_BERLAKU', status_label: 'Masih Berlaku', status_tone: 'green',
          status_icon: 'bi-check-circle-fill', prioritas: 6,
          status_verifikasi: 'REVISI', file_id: '', file_name: '', file_icon: 'bi-file-earmark',
          view_url: ''
        },
        {
          doc_id: 'DOC-202601-0002', employee_id: '4100000-C', nama_pemegang: 'Budi Santoso',
          divisi: 'Pemeliharaan', jabatan: 'Staf', nama_sertifikasi: 'Ahli K3 Listrik',
          penyelenggara: 'Lembaga Listrik', no_sertifikat: 'CERT/2',
          expired_at: '2026-05-17', recom_update: '2026-02-17',
          sisa_hari: 30, sisa_bulan: 1, sisa_teks: '1 Bulan',
          status: 'SEGERA_PERPANJANG', status_label: 'Segera Perpanjang', status_tone: 'red',
          status_icon: 'bi-exclamation-triangle-fill', prioritas: 3,
          status_verifikasi: 'PENDING', file_id: 'F1', file_name: 'lampiran.pdf',
          file_icon: 'bi-file-pdf', view_url: 'https://drive.google.com/file/d/F1/view'
        }
      ]
    };

    ctx.renderDsTabel(d);
    const html = dokumen.getElementById('dsTabel').innerHTML;

    ok('judul kolom "Berlaku Hingga" muncul', html.indexOf('Berlaku Hingga') !== -1);
    ok('judul kolom lama "Sisa masa berlaku" sudah tidak ada', html.indexOf('Sisa masa berlaku') === -1);
    ok('judul kolom lama "Berakhir" sudah tidak ada', html.indexOf('>Berakhir<') === -1);
    ok('tanggal kedaluwarsa dirender', html.indexOf('19 Mar 29') !== -1,
      html.slice(html.indexOf('mycertif-berlaku'), html.indexOf('mycertif-berlaku') + 160));
    ok('teks durasi berjenjang dirender sebagai <small>',
      html.indexOf('<small style="color:#') !== -1 && html.indexOf('2 Tahun 8 Bulan 22 Hari') !== -1);
    ok('penyelenggara dipakai, bukan kategori',
      html.indexOf('Lembaga K3') !== -1 && html.indexOf('Tanpa kategori') === -1);
    ok('badge Perlu Revisi tampil di tabel', html.indexOf('Perlu Revisi') !== -1);
    ok('tidak ada badge "Ditolak" di tabel', html.indexOf('Ditolak') === -1);
    ok('badge Menunggu tampil', html.indexOf('Menunggu') !== -1);
    ok('kolom Recom. Update tidak ditampilkan di tabel (ada di detail)',
      html.indexOf('Recom. Update') === -1);

    /* tombol kirim notifikasi: hanya untuk HC/SA */
    ok('HC melihat tombol Kirim notifikasi', html.indexOf('data-aksi="notify"') !== -1);
    ok('tombol notifikasi berjudul jelas',
      html.indexOf('title="Kirim notifikasi ke pemilik"') !== -1);
    ok('tombol notifikasi memakai ikon kirim', html.indexOf('bi-send') !== -1);
    ok('fungsi bukaKirimNotifikasi tersedia', typeof ctx.bukaKirimNotifikasi === 'function');

    /* sebagai karyawan: tombol verifikasi & notifikasi tidak muncul */
    ctx.MyCertif.state.user = { employee_code: '4100000-C', role: 'EMP', username: 'budi' };
    ctx.renderDsTabel(d);
    const htmlEmp = dokumen.getElementById('dsTabel').innerHTML;
    ok('karyawan TIDAK melihat tombol notifikasi',
      htmlEmp.indexOf('data-aksi="notify"') === -1);
    ok('karyawan TIDAK melihat tombol verifikasi',
      htmlEmp.indexOf('data-aksi="verifikasi"') === -1);
    ok('karyawan tetap melihat tombol detail',
      htmlEmp.indexOf('data-aksi="detail"') !== -1);
    ctx.MyCertif.state.user = { employee_code: '4100000-C', role: 'HC', username: 'hc' };
    ctx.renderDsTabel(d);

    ctx.renderDsKerangka();
    const kerangka = dokumen.getElementById('dsRoot').innerHTML;
    ok('filter Kategori sudah tidak ada',
      kerangka.indexOf('dsKategori') === -1 && kerangka.indexOf('Semua kategori') === -1);
    ok('filter verifikasi memuat "Perlu Revisi"', kerangka.indexOf('Perlu Revisi') !== -1);
    ok('filter verifikasi TIDAK memuat "Ditolak"', kerangka.indexOf('Ditolak') === -1);
    ok('filter Divisi tetap ada', kerangka.indexOf('dsDivisi') !== -1);
  }

  head('5b. Karyawan melihat catatan revisi di riwayat inputnya');
  {
    vm.runInContext(skripDari('Register.html.txt'), ctx, { filename: 'Register.html.txt' });
    ok('regBarisRiwayat tersedia', typeof ctx.regBarisRiwayat === 'function');

    const barisRevisi = ctx.regBarisRiwayat({
      doc_id: 'DOC-1', employee_id: '4100000-C', nama_sertifikasi: 'DATA ANALYST',
      penyelenggara: 'LSP INFORMATIKA', no_sertifikat: 'DA/1',
      expired_at: '2027-03-02', sisa_hari: 200, sisa_bulan: 6.6,
      status: 'MASIH_BERLAKU', status_label: 'Masih Berlaku', status_tone: 'green',
      status_icon: 'bi-check', status_verifikasi: 'REVISI',
      catatan: 'Lampiran tidak terbaca, mohon unggah ulang halaman 2.',
      file_id: '', file_name: ''
    }, false);

    ok('baris menampilkan badge Perlu Revisi', barisRevisi.indexOf('Perlu Revisi') !== -1);
    ok('catatan HC tampil di baris riwayat',
      barisRevisi.indexOf('Lampiran tidak terbaca') !== -1,
      barisRevisi.slice(0, 400));
    ok('tidak ada kata "Ditolak"', barisRevisi.indexOf('Ditolak') === -1);

    const barisPending = ctx.regBarisRiwayat({
      doc_id: 'DOC-2', employee_id: '4100000-C', nama_sertifikasi: 'POP',
      penyelenggara: 'LSP', no_sertifikat: 'P/1', expired_at: '2027-03-02',
      sisa_hari: 200, sisa_bulan: 6.6, status: 'MASIH_BERLAKU',
      status_label: 'Masih Berlaku', status_tone: 'green', status_icon: 'bi-check',
      status_verifikasi: 'PENDING', catatan: '', file_id: '', file_name: ''
    }, false);
    ok('baris menunggu tidak menampilkan catatan',
      barisPending.indexOf('mycertif-inline-note') === -1 || barisPending.indexOf('arrow-counterclockwise') === -1,
      barisPending.slice(0, 300));
  }

  head('5c. Pengaturan: pilihan prioritas email penerima');
  {
    vm.runInContext(skripDari('Pengaturan.html.txt'), ctx, { filename: 'Pengaturan.html.txt' });
    ok('pilihanField tersedia', typeof ctx.pilihanField === 'function');

    const html = ctx.pilihanField('setEmailUtama', 'reminder_email_utama', 'Alamat yang diutamakan',
      [{ value: 'PRIBADI', label: 'Email Pribadi' }, { value: 'PERUSAHAAN', label: 'Email Perusahaan' }],
      'PERUSAHAAN', 'hint');

    ok('render sebagai <select> dengan name Config', html.indexOf('name="reminder_email_utama"') !== -1);
    ok('memuat kedua pilihan',
      html.indexOf('Email Pribadi') !== -1 && html.indexOf('Email Perusahaan') !== -1);
    ok('menandai nilai yang sedang aktif (PERUSAHAAN)',
      /value="PERUSAHAAN" selected/.test(html), html);
    ok('nilai lain tidak ikut terpilih', !/value="PRIBADI" selected/.test(html));
    ok('menampilkan keterangan', html.indexOf('hint') !== -1);

    const html2 = ctx.pilihanField('x', 'y', 'Z',
      [{ value: 'PRIBADI', label: 'P' }], 'PRIBADI', 'h');
    ok('default terpilih sesuai nilai', /value="PRIBADI" selected/.test(html2), html2);
  }

  head('6. Dialog verifikasi: "Perlu Revisi" wajib pakai catatan');
  {
    const S = ctx.MyCertif;
    const bukaDialog = (opsi) => S.dialogForm(opsi);

    // ---- 6a. Revisi tanpa catatan -> ditolak, dialog tetap terbuka
    let hasil = 'BELUM';
    const p1 = bukaDialog({
      judul: 'Pemeriksaan', labelOk: 'Simpan',
      fields: [
        { name: 'keputusan', label: 'Hasil', tipe: 'select', nilai: 'VERIFIED', wajib: true },
        { name: 'catatan', label: 'Catatan', tipe: 'textarea', nilai: '' }
      ],
      validasi: function (v) {
        if (v.keputusan === 'REVISI' && !v.catatan) return 'Catatan wajib diisi.';
        return '';
      }
    }).then(function (v) { hasil = v; });

    const dlg = dokumen.getElementById('mycertifFormDialog');
    ok('dialog terbuka di DOM', !!dlg && !!dlg.parentNode);
    dokumen.getElementById('mycertifFormDialog_keputusan').value = 'REVISI';
    dokumen.getElementById('mycertifFormDialog_catatan').value = '';
    dlg.querySelector('[data-ok]').dispatch('click');
    await tunggu();

    sama('belum resolve saat validasi gagal', hasil, 'BELUM');
    ok('dialog masih terbuka saat validasi gagal', !!dlg.parentNode);
    ok('pesan galat ditampilkan',
      dlg.querySelector('[data-galat]').textContent.indexOf('Catatan wajib') !== -1,
      dlg.querySelector('[data-galat]').textContent);

    // ---- 6b. isi catatan -> tersimpan & dialog tertutup
    dokumen.getElementById('mycertifFormDialog_catatan').value = 'Lampiran tidak terbaca.';
    dlg.querySelector('[data-ok]').dispatch('click');
    await tunggu();
    await p1;

    ok('dialog tertutup setelah valid', !dlg.parentNode);
    sama('keputusan terkirim', hasil && hasil.keputusan, 'REVISI');
    sama('catatan terkirim', hasil && hasil.catatan, 'Lampiran tidak terbaca.');

    // ---- 6c. tombol batal -> resolve null
    let hasil2 = 'BELUM';
    const p2 = bukaDialog({
      judul: 'Uji batal',
      fields: [{ name: 'x', label: 'X', tipe: 'text', nilai: '' }]
    }).then(function (v) { hasil2 = v; });
    const dlg2 = dokumen.getElementById('mycertifFormDialog');
    dlg2.querySelector('[data-batal]').dispatch('click');
    await tunggu();
    await p2;
    sama('batal menghasilkan null', hasil2, null);
    ok('dialog batal tertutup', !dlg2.parentNode);

    // ---- 6d. field wajib kosong -> tidak tersimpan
    let hasil3 = 'BELUM';
    const p3 = bukaDialog({
      judul: 'Uji wajib',
      fields: [{ name: 'nama', label: 'Nama', tipe: 'text', nilai: '', wajib: true }]
    }).then(function (v) { hasil3 = v; });
    const dlg3 = dokumen.getElementById('mycertifFormDialog');
    dlg3.querySelector('[data-ok]').dispatch('click');
    await tunggu();
    sama('field wajib kosong tidak menyimpan', hasil3, 'BELUM');
    ok('pesan wajib diisi tampil',
      dlg3.querySelector('[data-galat]').textContent.indexOf('Wajib diisi') !== -1,
      dlg3.querySelector('[data-galat]').textContent);
    dlg3.querySelector('[data-batal]').dispatch('click');
    await tunggu();
    await p3;
  }

  /* -------------------------------------------------------------- ringkas */
  console.log('\n' + '='.repeat(78));
  console.log(' HASIL UJI UI: ' + lulus + ' lulus, ' + gagal + ' gagal');
  if (gagal) {
    console.log(' Kegagalan:');
    kegagalan.forEach((k) => console.log('   - ' + k));
  }
  console.log('='.repeat(78));
  process.exit(gagal ? 1 : 0);
}

main().catch(function (e) {
  console.error('\nUJI UI GAGAL DIJALANKAN: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
