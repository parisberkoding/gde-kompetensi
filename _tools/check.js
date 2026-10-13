#!/usr/bin/env node
/**
 * ============================================================================
 * check.js — Pemeriksa konsistensi project myCertif
 * Jalankan dari akar project:  node _tools/check.js
 * ============================================================================
 *
 * Yang diperiksa:
 *   1.  Kelengkapan berkas wajib.
 *   2.  Duplikasi nama fungsi di Backend/*.gs.txt.
 *   3.  Setiap panggilan MyCertif.api('apiXxx', ...) di Frontend punya
 *       implementasi function apiXxx() di Backend.
 *   4.  Setiap fungsi apiXxx di Backend dipakai frontend (peringatan saja).
 *   5.  Setiap view di Frontend/Javascript.html.txt punya berkas .html.txt,
 *       dan fungsi init yang didefinisikan di dalam berkas itu.
 *   6.  Setiap include('X') di Frontend punya berkas X.html.txt.
 *   7.  Sintaks JavaScript: seluruh berkas .gs.txt + isi <script> tiap .html.txt.
 *   8.  Aturan internal: status key, ambang, badge tone CSS tersedia.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DIR_FE = path.join(ROOT, 'Frontend');
const DIR_BE = path.join(ROOT, 'Backend');

let problems = 0;
let warnings = 0;

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const fail = (s) => { problems++; console.log('  \u2717 ' + s); };
const warn = (s) => { warnings++; console.log('  ! ' + s); };
const head = (s) => console.log('\n' + s);

function baca(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => ({ nama: f, path: path.join(dir, f), teks: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

const gsFiles = baca(DIR_BE, '.gs.txt');
const htmlFiles = baca(DIR_FE, '.html.txt');

log('================================================================');
log(' myCertif — consistency check');
log('================================================================');
log(`Backend  (.gs.txt)   : ${gsFiles.length} berkas`);
log(`Frontend (.html.txt) : ${htmlFiles.length} berkas`);

/* ---------------------------------------------------------------- 1. berkas */
head('[1] Kelengkapan berkas wajib');
const wajibFE = [
  'Index.html.txt', 'Login.html.txt', 'Stylesheet.html.txt', 'Javascript.html.txt',
  'Dashboard.html.txt', 'DataSertifikasi.html.txt', 'Register.html.txt',
  'ProfilPekerja.html.txt', 'ProfilUser.html.txt', 'KeamananAkun.html.txt',
  'Notifikasi.html.txt', 'MasterUser.html.txt',
  'Import.html.txt',
  'Pengaturan.html.txt'
];
const wajibBE = ['Kode.gs.txt', 'Session.gs.txt', 'Importer.gs.txt', 'subprocess.gs.txt'];

const adaFE = htmlFiles.map((f) => f.nama);
const adaBE = gsFiles.map((f) => f.nama);

wajibFE.forEach((f) => { if (adaFE.indexOf(f) === -1) fail('Frontend/' + f + ' tidak ada'); });
wajibBE.forEach((f) => { if (adaBE.indexOf(f) === -1) fail('Backend/' + f + ' tidak ada'); });
if (!problems) ok('semua berkas wajib tersedia');

/* ------------------------------------------------------------- 2. duplikasi */
head('[2] Duplikasi nama fungsi di Backend');
const fnMap = {};
const reFn = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
gsFiles.forEach((f) => {
  let m;
  reFn.lastIndex = 0;
  while ((m = reFn.exec(f.teks)) !== null) {
    const n = m[1];
    (fnMap[n] = fnMap[n] || []).push(f.nama);
  }
});
let dup = 0;
Object.keys(fnMap).sort().forEach((n) => {
  const pemilik = [...new Set(fnMap[n])];
  if (pemilik.length > 1) { dup++; fail(`function ${n}() didefinisikan di: ${pemilik.join(', ')}`); }
});
if (!dup) ok(`tidak ada duplikasi (${Object.keys(fnMap).length} fungsi unik)`);

/* --------------------------- 2b. panggilan ke helper yang tidak terdefinisi */
head('[2b] Helper ber-akhiran "_" yang dipanggil tetapi tidak terdefinisi');
/*
 * Menangkap kasus "satu berkas diperbarui, berkas lain belum" — gejalanya di
 * Apps Script berupa error seperti "verifyPassword_ is not defined".
 * Komentar dibuang lebih dulu supaya kalimat dokumentasi tidak ikut terbaca.
 */
const beTanpaKomentar = gsFiles.map((f) => f.teks
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
).join('\n');

const definedFns = new Set(Object.keys(fnMap));
const dipanggil = new Set();
const reCall = /\b([A-Za-z][A-Za-z0-9_$]*_)\s*\(/g;
let mc;
while ((mc = reCall.exec(beTanpaKomentar)) !== null) dipanggil.add(mc[1]);

const yatim = [...dipanggil].filter((n) => !definedFns.has(n)).sort();
if (yatim.length) {
  yatim.forEach((n) => fail(`${n}() dipanggil tetapi tidak ada definisinya di Backend (berkas belum sinkron?)`));
} else {
  ok(`semua ${dipanggil.size} helper ber-akhiran "_" terdefinisi`);
}

/* ------------------------------------------------------ 3. panggilan apiXxx */
head('[3] Panggilan MyCertif.api() di Frontend vs implementasi Backend');
const backendTeks = gsFiles.map((f) => f.teks).join('\n');
const reApiBackend = /^function\s+(api[A-Za-z0-9_]+)\s*\(/gm;
const apiBackend = new Set();
let mB;
while ((mB = reApiBackend.exec(backendTeks)) !== null) {
  // fungsi internal berakhiran "_" (mis. apiGuard_) bukan endpoint publik
  if (/_$/.test(mB[1])) continue;
  apiBackend.add(mB[1]);
}

const apiDipakai = new Map(); // nama -> [berkas]
htmlFiles.forEach((f) => {
  // cocok untuk MyCertif.api('apiX') maupun api('apiX') di dalam modul MyCertif
  const re = /(?:myCertif\.)?\bapi\(\s*'([A-Za-z0-9_]+)'/g;
  let m;
  while ((m = re.exec(f.teks)) !== null) {
    if (!apiDipakai.has(m[1])) apiDipakai.set(m[1], new Set());
    apiDipakai.get(m[1]).add(f.nama);
  }
});

let apiHilang = 0;
[...apiDipakai.keys()].sort().forEach((n) => {
  if (!apiBackend.has(n)) { apiHilang++; fail(`${n}() dipanggil di ${[...apiDipakai.get(n)].join(', ')} tetapi TIDAK ada di Backend`); }
});
if (!apiHilang) ok(`semua ${apiDipakai.size} endpoint yang dipanggil frontend tersedia di Backend`);

/* ------------------------------------------- 4. endpoint backend tak dipakai */
head('[4] Endpoint Backend yang tidak dipanggil frontend (peringatan)');
const diabaikan = new Set([
  // helper pembungkus, bukan endpoint
  'apiSuccess', 'apiError', 'apiGuard_',
  // hanya dipakai halaman tanpa login / dibungkus MyCertif.login & MyCertif.logout
  'apiGetBootstrapStatus', 'apiGetExecUrl', 'apiLogin', 'apiLogout',
  // alias internal
  'apiUpdateMyProfile'
]);
let takDipakai = 0;
[...apiBackend].sort().forEach((n) => {
  if (diabaikan.has(n)) return;
  if (!apiDipakai.has(n)) { takDipakai++; warn(`${n}() tidak dipanggil frontend`); }
});
if (!takDipakai) ok('semua endpoint backend dipakai frontend');

/* ------------------------------------------------------ 5. view & init fn */
head('[5] Daftar view, berkas, dan fungsi init');
const jsFe = htmlFiles.find((f) => f.nama === 'Javascript.html.txt');
if (!jsFe) {
  fail('Frontend/Javascript.html.txt tidak ditemukan — tidak bisa memeriksa view');
} else {
  const reView = /(\w+):\s*\{\s*file:\s*'([A-Za-z0-9_]+)',\s*init:\s*'([A-Za-z0-9_]+)'/g;
  let mv;
  let jumlah = 0;
  const namaFileView = new Set();
  while ((mv = reView.exec(jsFe.teks)) !== null) {
    jumlah++;
    const [, key, file, init] = mv;
    namaFileView.add(file + '.html.txt');
    const berkas = htmlFiles.find((f) => f.nama === file + '.html.txt');
    if (!berkas) { fail(`view "${key}" menunjuk berkas ${file}.html.txt yang tidak ada`); continue; }
    const reInit = new RegExp('function\\s+' + init + '\\s*\\(');
    if (!reInit.test(berkas.teks)) {
      fail(`view "${key}": fungsi ${init}() tidak ditemukan di ${file}.html.txt`);
    }
  }
  if (!jumlah) fail('tidak ada view terdeteksi di Javascript.html.txt');
  else ok(`${jumlah} view terdaftar dan semuanya punya fungsi init`);

  /* berkas view yatim (ada berkas tapi tak terdaftar) */
  const khusus = new Set(['Index.html.txt', 'Login.html.txt', 'Stylesheet.html.txt', 'Javascript.html.txt']);
  htmlFiles.forEach((f) => {
    if (khusus.has(f.nama)) return;
    if (!namaFileView.has(f.nama)) warn(`Frontend/${f.nama} ada tetapi tidak terdaftar sebagai view`);
  });
}

/* ------------------------------------------------------------- 6. include() */
head('[6] Rujukan include() di Frontend');
const reInc = /include\(\s*'([A-Za-z0-9_]+)'\s*\)/g;
let incJumlah = 0;
htmlFiles.forEach((f) => {
  let mi;
  reInc.lastIndex = 0;
  while ((mi = reInc.exec(f.teks)) !== null) {
    incJumlah++;
    const target = mi[1] + '.html.txt';
    if (!fs.existsSync(path.join(DIR_FE, target))) {
      fail(`${f.nama}: include('${mi[1]}') -> Frontend/${target} tidak ada`);
    }
  }
});
if (incJumlah) ok(`${incJumlah} rujukan include() valid`);

/* -------------------------------------------------------------- 7. sintaks */
head('[7] Pemeriksaan sintaks JavaScript');

function cekSintaks(kode, label) {
  try {
    new vm.Script(kode, { filename: label });
    return true;
  } catch (e) {
    fail(`${label}: ${e.message}`);
    return false;
  }
}

gsFiles.forEach((f) => cekSintaks(f.teks, 'Backend/' + f.nama));

let skripDiperiksa = 0;
htmlFiles.forEach((f) => {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let ms;
  let i = 0;
  while ((ms = re.exec(f.teks)) !== null) {
    i++;
    // Scriptlet Apps Script (<?!= ... ?> / <? ... ?>) diganti penanda netral
    // supaya berkas .html.txt bisa diperiksa sebagai JavaScript biasa.
    const isi = ms[1].replace(/<\?[\s\S]*?\?>/g, 'null');
    if (!isi.trim()) continue;
    skripDiperiksa++;
    cekSintaks(isi, `Frontend/${f.nama} <script#${i}>`);
  }
});
ok(`${gsFiles.length} berkas .gs + ${skripDiperiksa} blok <script> diperiksa`);

/* ------------------------------------------------- 8. aturan internal status */
head('[8] Aturan internal: status, ambang, dan kelas CSS badge');
const kodeGs = gsFiles.find((f) => f.nama === 'Kode.gs.txt');
const styleFe = htmlFiles.find((f) => f.nama === 'Stylesheet.html.txt');

if (kodeGs) {
  const toneBackend = new Set();
  const reTone = /tone:\s*'([a-z]+)'/g;
  let mt;
  while ((mt = reTone.exec(kodeGs.teks)) !== null) toneBackend.add(mt[1]);

  if (!toneBackend.size) fail('tidak ada definisi tone pada STATUS_DEFS');
  else ok(`tone status terdefinisi: ${[...toneBackend].join(', ')}`);

  if (styleFe) {
    toneBackend.forEach((t) => {
      if (!new RegExp('\\.gde-status--' + t + '\\b').test(styleFe.teks)) {
        fail(`tone "${t}" dipakai backend tetapi kelas .gde-status--${t} tidak ada di Stylesheet`);
      }
      if (!new RegExp('\\.gde-dot--' + t + '\\b').test(styleFe.teks)) {
        warn(`kelas .gde-dot--${t} tidak ada (dipakai legenda dashboard)`);
      }
    });
  }

  const wajibStatus = ['KADALUARSA', 'MENDEKATI_KADALUARSA', 'SEGERA_PERPANJANG',
    'PERLU_PERHATIAN', 'PERINGATAN', 'MASIH_BERLAKU'];
  wajibStatus.forEach((s) => {
    if (kodeGs.teks.indexOf("'" + s + "'") === -1) fail(`status ${s} tidak ada di Kode.gs`);
  });
  ok('enam tingkat status lengkap');

  if (!/function\s+apiGuard_\s*\(/.test(backendTeks)) fail('apiGuard_() tidak ditemukan di Backend');

  /* ----- kebijakan password: plaintext, pencocokan langsung ----- */
  // Literal string & penjaga `typeof X` dibuang dulu, karena keduanya memang
  // menyebut nama fungsi lama secara sah (mis. di berkasBackendHilang_()).
  const beBersih = backendTeks
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/typeof\s+[A-Za-z0-9_$]+/g, 'typeof _');

  const sisaHash = ['hashPassword_', 'verifyPassword_', 'isHashed_', 'password_salt', 'computeDigest']
    .filter((n) => beBersih.indexOf(n) !== -1);
  if (sisaHash.length) {
    fail(`kebijakan password dilanggar — masih ada: ${sisaHash.join(', ')} (password harus plaintext + pencocokan langsung)`);
  } else if (!/function\s+passwordCocok_\s*\(/.test(backendTeks)) {
    fail('passwordCocok_() tidak ditemukan (pencocokan password langsung)');
  } else {
    ok('password tanpa hash + pencocokan langsung (passwordCocok_)');
  }

  /* ----- login berbasis Employee Code ----- */
  if (!/function\s+apiLogin\s*\(\s*identitas/.test(backendTeks)) {
    warn('apiLogin() tidak memakai parameter pertama bernama "identitas" (Employee Code)');
  } else {
    ok('login memakai Employee Code (apiLogin("identitas", password opsional))');
  }
  if (!/function\s+apiGetSessionAuto\s*\(/.test(backendTeks)) {
    fail('apiGetSessionAuto() tidak ada — sesi akan mudah hilang saat refresh');
  } else {
    ok('login otomatis via email Google tersedia (apiGetSessionAuto)');
  }

  /* ----- penanda berkas backend ----- */
  ['MARKER_KODE_', 'MARKER_SESSION_', 'MARKER_IMPORT_', 'MARKER_SUBPROCESS_'].forEach((m) => {
    if (backendTeks.indexOf('var ' + m) === -1) fail(`penanda berkas ${m} tidak ditemukan`);
  });
  if (backendTeks.indexOf('function berkasBackendHilang_') === -1) {
    fail('berkasBackendHilang_() tidak ada — aplikasi tidak bisa mendeteksi berkas yang belum sinkron');
  } else {
    ok('penanda versi tiap berkas + deteksi berkas belum sinkron tersedia');
  }

  if (backendTeks.indexOf('tanpaPassword_') === -1) {
    warn('tanpaPassword_() belum dipakai — pastikan password tidak masuk T_Audit_Trail');
  } else {
    ok('password tidak ditulis ke audit trail (tanpaPassword_)');
  }
}

/* ------------------------------------------------------------- 9. kolom DB */
head('[9] Kolom skema yang dirujuk vs SCHEMAS');
if (kodeGs) {
  const mSkema = kodeGs.teks.match(/var SCHEMAS = \{([\s\S]*?)\n\};/);
  if (!mSkema) {
    fail('blok SCHEMAS tidak ditemukan di Kode.gs');
  } else {
    const sheetDikenal = new Set();
    const reSheet = /'([A-Za-z_]+)':\s*\[/g;
    let msh;
    while ((msh = reSheet.exec(mSkema[1])) !== null) sheetDikenal.add(msh[1]);
    ok(`skema terdaftar: ${[...sheetDikenal].join(', ')}`);

    const reGetSheet = /(?:getSheet_|appendObject_|sheetToObjects_|findRowByCol_|deleteRowByCol_|forceTextColumns_|styleHeader_|updateRowByCol_|rowToObject_|rowArrBySchema_|ensureColumns_)\(\s*'([A-Za-z_]+)'/g;
    const dipakai = new Set();
    let mg;
    while ((mg = reGetSheet.exec(backendTeks)) !== null) dipakai.add(mg[1]);
    dipakai.forEach((s) => {
      if (!sheetDikenal.has(s)) fail(`sheet "${s}" dipakai di kode tetapi tidak ada di SCHEMAS`);
    });
  }
}

/* ------------------------------------ 10. tumbukan nama fungsi antar view */
head('[10] Tumbukan nama fungsi global antar berkas Frontend');
/*
 * Semua <script> view berjalan di lingkup global yang sama (window), jadi dua
 * view yang mendefinisikan fungsi bernama sama akan saling menimpa.
 */
const fnFrontend = {};
htmlFiles.forEach((f) => {
  if (f.nama === 'Javascript.html.txt') return; // modul MyCertif, memakai IIFE
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let ms;
  while ((ms = re.exec(f.teks)) !== null) {
    const isi = ms[1].replace(/<\?[\s\S]*?\?>/g, 'null');
    const reF = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
    let mf;
    while ((mf = reF.exec(isi)) !== null) {
      (fnFrontend[mf[1]] = fnFrontend[mf[1]] || new Set()).add(f.nama);
    }
  }
});
let tumbukan = 0;
Object.keys(fnFrontend).sort().forEach((n) => {
  const pemilik = [...fnFrontend[n]];
  if (pemilik.length > 1) { tumbukan++; fail(`function ${n}() didefinisikan di: ${pemilik.join(', ')}`); }
});
if (!tumbukan) ok(`tidak ada tumbukan (${Object.keys(fnFrontend).length} fungsi view unik)`);

/* Fungsi init view wajib ada dan namanya sesuai pendaftaran di VIEWS */
if (jsFe) {
  const reInit = /init:\s*'([A-Za-z0-9_]+)'/g;
  let mi2;
  const initDideklarasikan = new Set(Object.keys(fnFrontend));
  while ((mi2 = reInit.exec(jsFe.teks)) !== null) {
    if (!initDideklarasikan.has(mi2[1])) fail(`fungsi init ${mi2[1]}() tidak terdefinisi di berkas view mana pun`);
  }
}

/* ------------------------------------------------- 11. kontrak frontend */
head('[11] Kontrak frontend: MyCertif.*, kelas CSS, dan ikon');

const jsMod = htmlFiles.find((f) => f.nama === 'Javascript.html.txt');
if (jsMod) {
  // --- nama yang diekspor modul MyCertif ---
  const potong = jsMod.teks.lastIndexOf('return {');
  const blokEkspor = potong === -1 ? '' : jsMod.teks.slice(potong);
  const namaEkspor = new Set();
  const reEkspor = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let me;
  while ((me = reEkspor.exec(blokEkspor)) !== null) namaEkspor.add(me[1]);

  const manual = new Set(['APP', 'state', 'VIEWS', 'ATURAN_BERKAS', 'BULAN', 'BULAN_SINGKAT', 'HARI']);

  // --- nama yang dipakai view ---
  const dipakaiMyCertif = new Map();
  htmlFiles.forEach((f) => {
    if (f.nama === 'Javascript.html.txt') return;
    const re = /\bMyCertif\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(f.teks)) !== null) {
      if (!dipakaiMyCertif.has(m[1])) dipakaiMyCertif.set(m[1], new Set());
      dipakaiMyCertif.get(m[1]).add(f.nama);
    }
  });

  let hilang = 0;
  [...dipakaiMyCertif.keys()].sort().forEach((n) => {
    if (namaEkspor.has(n) || manual.has(n)) return;
    hilang++;
    fail(`MyCertif.${n} dipakai di ${[...dipakaiMyCertif.get(n)].join(', ')} tetapi tidak diekspor Javascript.html.txt`);
  });
  if (!hilang) ok(`semua ${dipakaiMyCertif.size} anggota MyCertif.* yang dipakai view tersedia`);

  /* --- pemanggilan fungsi myCertif TANPA prefix "MyCertif." ---
   * Fungsi di dalam modul MyCertif hidup di lingkup IIFE, jadi view TIDAK bisa
   * memanggilnya sebagai fungsi global. Kesalahan seperti `perbaruiBadgeMendesak()`
   * (seharusnya `MyCertif.perbaruiBadgeMendesak()`) baru ketahuan sebagai
   * ReferenceError saat halaman dipakai. Pemeriksaan ini menangkapnya lebih awal.
   */
  // Fungsi yang dideklarasikan di dalam view boleh punya indentasi, jadi
  // pemeriksaan "tanpa prefix" memakai pola yang tidak terikat awal baris.
  const namaLokalView = new Set(Object.keys(fnFrontend));
  htmlFiles.forEach((f) => {
    if (f.nama === 'Javascript.html.txt' || f.nama === 'Stylesheet.html.txt') return;
    const reS = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let mss;
    while ((mss = reS.exec(f.teks)) !== null) {
      const isi = mss[1].replace(/<\?[\s\S]*?\?>/g, 'null');
      const reFn = /function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
      let mf;
      while ((mf = reFn.exec(isi)) !== null) namaLokalView.add(mf[1]);
      // var nama = function (...) { ... }  /  nama: function (...) { ... }
      const reVar = /(?:^|[\s,{])([A-Za-z_$][A-Za-z0-9_$]*)\s*[:=]\s*function\s*\(/g;
      let mv;
      while ((mv = reVar.exec(isi)) !== null) namaLokalView.add(mv[1]);
    }
  });
  const bawaan = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'new',
    'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'Math', 'JSON', 'RegExp',
    'Error', 'Promise', 'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'encodeURIComponent', 'decodeURIComponent', 'require'
  ]);
  const tanpaPrefix = new Map();
  htmlFiles.forEach((f) => {
    if (f.nama === 'Javascript.html.txt' || f.nama === 'Stylesheet.html.txt') return;
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let ms;
    while ((ms = re.exec(f.teks)) !== null) {
      const isi = ms[1].replace(/<\?[\s\S]*?\?>/g, 'null');
      // buang komentar agar contoh di dokumentasi tidak ikut terbaca
      const bersih = isi.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
      // Identifier yang TIDAK didahului "." / "$" / ":" — supaya MyCertif.qsa(...)
      // atau { kunci: nilai(...) } tidak ikut dianggap pemanggilan tanpa prefix.
      const reCall = /(?<![\w.$:])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
      let mc;
      while ((mc = reCall.exec(bersih)) !== null) {
        const n = mc[1];
        if (bawaan.has(n) || namaLokalView.has(n)) continue;
        if (!namaEkspor.has(n) && !manual.has(n)) continue;
        // lewati deklarasi "function nama(" dan metode objek "nama: function ("
        const sebelum = bersih.slice(Math.max(0, mc.index - 12), mc.index);
        if (/\bfunction\s+$/.test(sebelum)) continue;
        if (!tanpaPrefix.has(n)) tanpaPrefix.set(n, new Set());
        tanpaPrefix.get(n).add(f.nama);
      }
    }
  });
  if (tanpaPrefix.size) {
    [...tanpaPrefix.keys()].sort().forEach((n) => {
      fail(`${n}() dipanggil di ${[...tanpaPrefix.get(n)].join(', ')} tanpa prefix — `
        + `tulis MyCertif.${n}() karena fungsi itu ada di dalam modul MyCertif (lingkup IIFE)`);
    });
  } else {
    ok('tidak ada pemanggilan fungsi myCertif tanpa prefix "MyCertif."');
  }

  // --- kelas CSS statis gde-*/mycertif-* ---
  if (styleFe) {
    const kelasCss = new Set();
    const reKelas = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let mk;
    while ((mk = reKelas.exec(styleFe.teks)) !== null) kelasCss.add(mk[1]);

    const kelasHilang = new Map();
    htmlFiles.forEach((f) => {
      if (f.nama === 'Stylesheet.html.txt') return;
      const re = /class="([^"]*)"/g;
      let mc;
      while ((mc = re.exec(f.teks)) !== null) {
        mc[1].split(/\s+/).forEach((c) => {
          if (!/^(gde|myCertif)-[a-z0-9-]+$/.test(c)) return;
          if (kelasCss.has(c)) return;
          if (!kelasHilang.has(c)) kelasHilang.set(c, new Set());
          kelasHilang.get(c).add(f.nama);
        });
      }
    });
    if (kelasHilang.size) {
      [...kelasHilang.keys()].sort().forEach((c) => {
        warn(`kelas .${c} dipakai di ${[...kelasHilang.get(c)].join(', ')} tetapi tidak ada di Stylesheet`);
      });
    } else {
      ok('semua kelas gde-*/mycertif-* yang dipakai view tersedia di Stylesheet');
    }

    // --- ikon Bootstrap Icons ---
    const ikonCss = path.join(ROOT, 'gde-ui-templates', 'icons', 'bootstrap-icons.css');
    if (fs.existsSync(ikonCss)) {
      const teksIkon = fs.readFileSync(ikonCss, 'utf8');
      const ikonAda = new Set();
      const reIkon = /\.(bi-[a-z0-9-]+)::?before/g;
      let mi3;
      while ((mi3 = reIkon.exec(teksIkon)) !== null) ikonAda.add(mi3[1]);

      const ikonHilang = new Map();
      htmlFiles.forEach((f) => {
        const re = /\bbi-[a-z0-9-]+/g;
        let mn;
        while ((mn = re.exec(f.teks)) !== null) {
          if (ikonAda.has(mn[0])) continue;
          if (!ikonHilang.has(mn[0])) ikonHilang.set(mn[0], new Set());
          ikonHilang.get(mn[0]).add(f.nama);
        }
      });
      if (ikonHilang.size) {
        [...ikonHilang.keys()].sort().forEach((k) => {
          fail(`ikon ${k} tidak ada di bootstrap-icons (dipakai ${[...ikonHilang.get(k)].join(', ')})`);
        });
      } else {
        ok('semua ikon bi-* yang dipakai tersedia di pustaka Bootstrap Icons');
      }
    }
  }
}

/* ------------------------------------------------- 12. konsistensi merek */
head('[12] Konsistensi nama aplikasi (myCertif)');

{
  const semuaTeks = gsFiles.concat(htmlFiles).map((f) => ({ nama: f.nama, teks: f.teks }));
  const kodeGs = gsFiles.find((f) => f.nama === 'Kode.gs.txt');

  if (kodeGs) {
    const mNama = kodeGs.teks.match(/var APP_NAME = '([^']+)'/);
    ok("APP_NAME = 'myCertif'", !!mNama && mNama[1] === 'myCertif',
      mNama ? mNama[1] : 'tidak ditemukan');

    const mApp = kodeGs.teks.match(/'app_name':\s*([^,\n]+)/);
    ok("Config default app_name memakai APP_NAME", !!mApp && mApp[1].indexOf('APP_NAME') !== -1,
      mApp ? mApp[1] : 'tidak ditemukan');

    ok('subjek email default memakai myCertif',
      /'email_subject_prefix': '[^']*myCertif[^']*'/.test(kodeGs.teks));
    ok('catatan kaki email memakai myCertif',
      /'email_footer': '[^']*myCertif[^']*'/.test(kodeGs.teks));
    ok('folder Drive default memakai myCertif',
      kodeGs.teks.indexOf("'myCertif_Lampiran'") !== -1);
    ok('menu spreadsheet memakai myCertif',
      kodeGs.teks.indexOf("createMenu('myCertif')") !== -1);
  }

  /*
   * Nama lama hanya boleh muncul pada baris yang jelas-jelas menangani
   * kompatibilitas data lama. Kalau muncul di tempat lain, berarti ada sisa
   * penggantian nama yang terlewat.
   */
  const penandaLama = /(LAMA|kompatibilitas|masih bernama)/;
  const sisa = [];
  semuaTeks.forEach((f) => {
    f.teks.split('\n').forEach((baris, i) => {
      if (!/SIAGA/i.test(baris)) return;
      if (penandaLama.test(baris)) return;
      sisa.push(f.nama + ':' + (i + 1) + ' — ' + baris.trim().slice(0, 70));
    });
  });
  if (sisa.length) {
    sisa.slice(0, 8).forEach((s) => fail('nama lama masih tersisa -> ' + s));
    if (sisa.length > 8) fail('...dan ' + (sisa.length - 8) + ' baris lain');
  } else {
    ok('tidak ada sisa nama lama di luar baris kompatibilitas');
  }

  /* namespace & awalan kelas sudah berganti nama */
  const jsFe2 = htmlFiles.find((f) => f.nama === 'Javascript.html.txt');
  if (jsFe2) {
    ok('namespace JavaScript MyCertif terdefinisi',
      /var MyCertif = \(function/.test(jsFe2.teks));
    ok('tidak ada lagi var SIAGA = ', jsFe2.teks.indexOf('var SIAGA =') === -1);
  }
  if (styleFe) {
    ok('kelas CSS memakai awalan mycertif-', styleFe.teks.indexOf('.mycertif-') !== -1);
    ok('tidak ada lagi kelas .siaga-', styleFe.teks.indexOf('.siaga-') === -1);
  }

  /* kompatibilitas instalasi lama */
  if (kodeGs && jsFe2) {
    ok('penanda bootstrap lama masih dibaca',
      kodeGs.teks.indexOf("BOOTSTRAP_PROP_LAMA_ = 'SIAGA_BOOTSTRAP'") !== -1);
    ok('kunci token lama masih dibaca',
      jsFe2.teks.indexOf("TOKEN_KEY_LAMA = 'siaga.token'") !== -1);
  }
}

/* ------------------------------------------------------------------ ringkas */
log('\n================================================================');
if (problems === 0 && warnings === 0) log(' HASIL: bersih — tidak ada temuan.');
else if (problems === 0) log(` HASIL: ${warnings} peringatan, 0 masalah.`);
else log(` HASIL: ${problems} masalah, ${warnings} peringatan.`);
log('================================================================');

process.exit(problems > 0 ? 1 : 0);
