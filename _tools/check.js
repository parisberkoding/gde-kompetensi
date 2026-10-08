#!/usr/bin/env node
/**
 * ============================================================================
 * check.js — Pemeriksa konsistensi project SIAGA Sertifikasi
 * Jalankan dari akar project:  node _tools/check.js
 * ============================================================================
 *
 * Yang diperiksa:
 *   1.  Kelengkapan berkas wajib.
 *   2.  Duplikasi nama fungsi di Backend/*.gs.txt.
 *   3.  Setiap panggilan SIAGA.api('apiXxx', ...) di Frontend punya
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
log(' SIAGA Sertifikasi — consistency check');
log('================================================================');
log(`Backend  (.gs.txt)   : ${gsFiles.length} berkas`);
log(`Frontend (.html.txt) : ${htmlFiles.length} berkas`);

/* ---------------------------------------------------------------- 1. berkas */
head('[1] Kelengkapan berkas wajib');
const wajibFE = [
  'Index.html.txt', 'Login.html.txt', 'Stylesheet.html.txt', 'Javascript.html.txt',
  'Dashboard.html.txt', 'DataSertifikasi.html.txt', 'Register.html.txt',
  'ProfilPekerja.html.txt', 'ProfilUser.html.txt', 'KeamananAkun.html.txt',
  'Notifikasi.html.txt', 'MasterUser.html.txt', 'MasterSertifikasi.html.txt',
  'Pengaturan.html.txt'
];
const wajibBE = ['Kode.gs.txt', 'subprocess.gs.txt'];

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

/* ------------------------------------------------------ 3. panggilan apiXxx */
head('[3] Panggilan SIAGA.api() di Frontend vs implementasi Backend');
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
  // cocok untuk SIAGA.api('apiX') maupun api('apiX') di dalam modul SIAGA
  const re = /(?:SIAGA\.)?\bapi\(\s*'([A-Za-z0-9_]+)'/g;
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
  // hanya dipakai halaman tanpa login / dibungkus SIAGA.login & SIAGA.logout
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
  if (f.nama === 'Javascript.html.txt') return; // modul SIAGA, memakai IIFE
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
head('[11] Kontrak frontend: SIAGA.*, kelas CSS, dan ikon');

const jsMod = htmlFiles.find((f) => f.nama === 'Javascript.html.txt');
if (jsMod) {
  // --- nama yang diekspor modul SIAGA ---
  const potong = jsMod.teks.lastIndexOf('return {');
  const blokEkspor = potong === -1 ? '' : jsMod.teks.slice(potong);
  const namaEkspor = new Set();
  const reEkspor = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let me;
  while ((me = reEkspor.exec(blokEkspor)) !== null) namaEkspor.add(me[1]);

  const manual = new Set(['APP', 'state', 'VIEWS', 'ATURAN_BERKAS', 'BULAN', 'BULAN_SINGKAT', 'HARI']);

  // --- nama yang dipakai view ---
  const dipakaiSIAGA = new Map();
  htmlFiles.forEach((f) => {
    if (f.nama === 'Javascript.html.txt') return;
    const re = /\bSIAGA\.([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(f.teks)) !== null) {
      if (!dipakaiSIAGA.has(m[1])) dipakaiSIAGA.set(m[1], new Set());
      dipakaiSIAGA.get(m[1]).add(f.nama);
    }
  });

  let hilang = 0;
  [...dipakaiSIAGA.keys()].sort().forEach((n) => {
    if (namaEkspor.has(n) || manual.has(n)) return;
    hilang++;
    fail(`SIAGA.${n} dipakai di ${[...dipakaiSIAGA.get(n)].join(', ')} tetapi tidak diekspor Javascript.html.txt`);
  });
  if (!hilang) ok(`semua ${dipakaiSIAGA.size} anggota SIAGA.* yang dipakai view tersedia`);

  // --- kelas CSS statis gde-*/siaga-* ---
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
          if (!/^(gde|siaga)-[a-z0-9-]+$/.test(c)) return;
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
      ok('semua kelas gde-*/siaga-* yang dipakai view tersedia di Stylesheet');
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

/* ------------------------------------------------------------------ ringkas */
log('\n================================================================');
if (problems === 0 && warnings === 0) log(' HASIL: bersih — tidak ada temuan.');
else if (problems === 0) log(` HASIL: ${warnings} peringatan, 0 masalah.`);
else log(` HASIL: ${problems} masalah, ${warnings} peringatan.`);
log('================================================================');

process.exit(problems > 0 ? 1 : 0);
