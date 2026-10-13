#!/usr/bin/env node
/**
 * ============================================================================
 * sim.js — Simulator + pengukur biaya akses spreadsheet untuk backend myCertif
 * Jalankan dari akar project:  node _tools/sim.js
 * ============================================================================
 *
 * Latar belakang
 * --------------
 * Google Apps Script tidak bisa dijalankan dari sini, jadi berkas ini menyediakan
 * tiruan (mock) minimal dari SpreadsheetApp, DriveApp, MailApp, PropertiesService,
 * CacheService, Utilities, Session, dan ScriptApp — cukup untuk menjalankan
 * seluruh berkas Backend/*.gs.txt apa adanya.
 *
 * Tiruan ini MENGHITUNG setiap operasi baca/tulis sheet. Karena satu-satunya
 * sumber kelambatan di Apps Script adalah bolak-balik ke Spreadsheet, angka
 * inilah yang dipakai untuk membuktikan perbaikan performa:
 *
 *   - reads      : jumlah panggilan getValues()/getDisplayValues()
 *   - cellsRead  : jumlah sel yang ditarik dari spreadsheet
 *   - writes     : jumlah panggilan tulis (setValue/setValues/appendRow/deleteRow)
 *   - cellsWrote : jumlah sel yang ditulis
 *   - perSheet   : rincian per nama sheet (untuk menemukan pemborosan)
 *
 * Catatan penting: konteks VM dibuat ULANG untuk setiap skenario, persis seperti
 * Apps Script yang memulai eksekusi dari nol. Yang bertahan antar-skenario hanya
 * "spreadsheet" (database) dan CacheService — sama seperti di produksi.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DIR_BE = path.join(ROOT, 'Backend');
const TZ_OFFSET_MS = 7 * 3600 * 1000; // Asia/Jakarta (tanpa DST)

// ============================================================================
// 0. UTILITAS
// ============================================================================

const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Tiruan Utilities.formatDate(date, tz, pattern) untuk pola yang dipakai app. */
function formatDate(date, tz, pattern) {
  const d = new Date(date.getTime() + TZ_OFFSET_MS);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  const h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds();
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const map = {
    yyyy: String(Y), yy: String(Y).slice(-2),
    MMMM: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
      'Agustus', 'September', 'Oktober', 'November', 'Desember'][M],
    MMM: BULAN_SINGKAT[M], MM: p2(M + 1), M: String(M + 1),
    dd: p2(D), d: String(D),
    HH: p2(h), H: String(h), mm: p2(m), ss: p2(s)
  };
  return String(pattern).replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|HH|H|mm|ss/g, (t) => map[t]);
}

// ============================================================================
// 1. DATABASE (SPREADSHEET) TIRUAN
// ============================================================================

class Sheet {
  constructor(name, header) {
    this.name = name;
    this.header = (header || []).slice();
    this.rows = []; // array of array
  }
  getLastRow() { return this.header.length ? this.rows.length + 1 : 0; }
  getLastColumn() { return this.header.length; }
  getMaxRows() { return Math.max(this.rows.length + 1, 100); }
  getMaxColumns() { return Math.max(this.header.length, 26); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  setFrozenRows() { return this; }
  setColumnWidths() { return this; }
  setRowHeight() { return this; }
  getFilter() { return null; }
  setTabColor() { return this; }
  getDataRange() { return this._range(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(r, c, nr, nc) {
    if (c === undefined) return this._range(r, 1, 1, 1);           // getRange("A1") / (row)
    if (nr === undefined) return this._range(r, c, 1, 1);
    return this._range(r, c, nr, nc);
  }
  appendRow(arr) {
    ENV.count('write', this.name, 1, arr.length);
    this.rows.push(arr.slice());
  }
  deleteRow(rowIndex) {
    ENV.count('write', this.name, 1, 0);
    this.rows.splice(rowIndex - 2, 1);
  }
  clear() { this.rows = []; }
  _range(row, col, numRows, numCols) { return new Range(this, row, col, numRows, numCols); }
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.s = sheet; this.row = row; this.col = col;
    this.nr = numRows === undefined ? 1 : numRows;
    this.nc = numCols === undefined ? 1 : numCols;
  }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getSheet() { return this.s; }

  getValues() {
    ENV.count('read', this.s.name, 1, this.nr * this.nc);
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const baris = [];
      const rIdx = this.row - 1 + i;
      for (let j = 0; j < this.nc; j++) {
        const cIdx = this.col - 1 + j;
        if (rIdx === 0) baris.push(this.s.header[cIdx] === undefined ? '' : this.s.header[cIdx]);
        else {
          const r = this.s.rows[rIdx - 1];
          const v = r ? r[cIdx] : undefined;
          baris.push(v === undefined ? '' : v);
        }
      }
      out.push(baris);
    }
    return out;
  }

  getDisplayValues() { return this.getValues().map((r) => r.map((v) => String(v === null || v === undefined ? '' : v))); }

  setValues(vals) {
    ENV.count('write', this.s.name, 1, vals.length * (vals[0] ? vals[0].length : 0));
    for (let i = 0; i < vals.length; i++) {
      const rIdx = this.row - 1 + i;
      const src = vals[i];
      if (rIdx === 0) {
        for (let j = 0; j < src.length; j++) this.s.header[this.col - 1 + j] = src[j];
        continue;
      }
      while (this.s.rows.length < rIdx) this.s.rows.push([]);
      const row = this.s.rows[rIdx - 1];
      for (let j = 0; j < src.length; j++) {
        const cIdx = this.col - 1 + j;
        while (row.length <= cIdx) row.push('');
        row[cIdx] = src[j];
      }
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setVerticalAlignment() { return this; }
  createFilter() { return this; }
  setNumberFormat() { return this; }
  setDataValidation() { return this; }
  setNote() { return this; }
  setWrap() { return this; }
  clearContent() { ENV.count('write', this.s.name, 1, this.nr * this.nc); return this; }
  getValue() { return this.getValues()[0][0]; }
}

class Spreadsheet {
  constructor(name) { this.name = name; this.sheets = []; }
  getId() { return 'SIM_SS_ID'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/SIM_SS_ID/edit'; }
  getName() { return this.name; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n, []); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  toast() { }
  getSpreadsheetTimeZone() { return 'Asia/Jakarta'; }
  setSpreadsheetTimeZone() { }
  addEditor() { }
}

// ============================================================================
// 2. PENGHITUNG
// ============================================================================

const ENV = {
  counters: { reads: 0, cellsRead: 0, writes: 0, cellsWrote: 0, opens: 0, perSheet: {} },
  cacheCalls: { hit: 0, miss: 0, put: 0 },
  cacheStore: new Map(),
  cachePersist: true,
  logs: [],
  emails: [],
  reset() {
    this.counters = { reads: 0, cellsRead: 0, writes: 0, cellsWrote: 0, opens: 0, perSheet: {} };
    this.cacheCalls = { hit: 0, miss: 0, put: 0 };
    this.logs = [];
    this.emails = [];
  },
  count(kind, sheet, calls, cells) {
    const c = this.counters;
    if (kind === 'read') { c.reads += calls; c.cellsRead += cells; }
    else { c.writes += calls; c.cellsWrote += cells; }
    const s = (c.perSheet[sheet] = c.perSheet[sheet] || { reads: 0, writes: 0, cellsRead: 0, cellsWrote: 0 });
    if (kind === 'read') { s.reads += calls; s.cellsRead += cells; }
    else { s.writes += calls; s.cellsWrote += cells; }
  }
};

// ============================================================================
// 3. DATABASE CONTOH (seed) — meniru volume produksi
// ============================================================================

const DIVISI = ['Pembangkit', 'Pemeliharaan', 'K3 & Lingkungan', 'Human Capital',
  'Keuangan', 'Operasi', 'Teknik', 'Logistik'];
const DEPAN = ['Ahmad', 'Budi', 'Cahyo', 'Dedi', 'Eko', 'Fajar', 'Gunawan', 'Hadi', 'Indra', 'Joko',
  'Kurnia', 'Lukman', 'Maman', 'Nanda', 'Oki', 'Putra', 'Rizki', 'Slamet', 'Taufik', 'Umar',
  'Vina', 'Wahyu', 'Yudi', 'Zainal', 'Ani', 'Bella', 'Citra', 'Dewi', 'Eka', 'Fitri',
  'Gita', 'Hana', 'Ika', 'Julia', 'Kartika', 'Lestari', 'Maya', 'Nia', 'Oktavia', 'Putri'];
const BELAKANG = ['Pratama', 'Saputra', 'Wijaya', 'Nugroho', 'Hidayat', 'Setiawan', 'Ramadhan',
  'Kusuma', 'Firmansyah', 'Maulana', 'Permana', 'Santoso', 'Hartono', 'Susanto', 'Gunadi'];

const JENIS_SERT = [
  ['Pengawas Operasional Pertama (POP)', 'K3 / Pengawas Operasional', 36],
  ['Pengawas Operasional Madya (POM)', 'K3 / Pengawas Operasional', 36],
  ['Pengawas Operasional Utama (POU)', 'K3 / Pengawas Operasional', 36],
  ['SKKTK Level 2', 'Ketenagalistrikan', 36],
  ['SKKTK Level 3', 'Ketenagalistrikan', 36],
  ['Teknisi K3 Listrik', 'Ketenagalistrikan', 36],
  ['Ahli K3 Listrik', 'Ketenagalistrikan', 36],
  ['Ahli K3 Umum', 'K3', 36],
  ['Ahli K3 Lingkungan Kerja', 'K3', 36],
  ['Ahli Muda K3 Konstruksi', 'K3', 36],
  ['K3 Kimia', 'K3', 36],
  ['CSMS', 'Sistem Manajemen', 36],
  ['CRMP', 'Manajemen Risiko', 60],
  ['Infrared Thermography Level 1', 'Inspeksi', 60],
  ['Operator Boiler Kelas 1', 'Pesawat Uap', 36],
  ['Operator Crane', 'Pesawat Angkat', 36],
  ['Rigger', 'Pesawat Angkat', 36],
  ['Ahli K3 Kebakaran', 'K3', 36],
  ['Petugas K3 Kebakaran', 'K3', 36],
  ['First Aid', 'K3', 36]
];

const CONFIG_SEED = [
  ['status_peringatan_hari', '270'], ['status_perhatian_hari', '180'],
  ['status_segera_hari', '90'], ['status_mendesak_hari', '60'], ['status_merah_hari', '30'],
  ['masa_berlaku_default_bulan', '36'],
  ['masa_berlaku_5_tahun_kata_kunci', 'CRMP,Infrared Thermography,CSRS'],
  ['auth_session_jam', '10'], ['login_wajib_password', 'FALSE'], ['auto_login_email', 'TRUE'],
  ['auto_login_email_pribadi', 'FALSE'], ['password_wajib_ganti_default', 'FALSE'],
  ['username_prefix_duplikat', 'TRUE'], ['login_max_percobaan', '5'], ['login_lock_menit', '15'],
  ['reminder_enabled', 'TRUE'], ['reminder_hari_kirim', '1'], ['reminder_level_bulan', '9,6,3,2,1,0'],
  ['reminder_ke_karyawan', 'TRUE'], ['reminder_ke_hc', 'TRUE'], ['reminder_ke_atasan', 'TRUE'],
  ['reminder_extra_emails', ''], ['reminder_max_email_per_jalan', '90'],
  ['reminder_ulang_kadaluarsa_hari', '7'], ['email_pengirim', ''], ['email_subject_prefix', '[myCertif]'],
  ['email_footer', 'Email otomatis dari myCertif Unit Patuha. Mohon tidak membalas email ini.'], ['dashboard_prioritas_limit', '8'],
  ['tabel_baris_per_halaman', '25'], ['export_max_baris', '5000'], ['drive_folder_id', ''],
  ['drive_folder_export_id', ''], ['superadmin_email', 'superadmin@gde.co.id'],
  ['hc_email', 'hc@gde.co.id'], ['divisi_options', DIVISI.join(',')],
  ['bootstrap_auto_seed', 'TRUE'], ['bootstrap_version', 'v1.3.0'], ['bootstrap_done_at', '2025-01-01 00:00:00'],
  ['zona_waktu', 'Asia/Jakarta'], ['unit_default', 'Patuha'], ['app_name', 'myCertif']
];

/** Skema LAMA (sebelum migrasi) — dipakai untuk menguji migrateSchemaV2_(). */
const SCHEMAS_SIM_LAMA = {
  'Config': ['Key', 'Value'],
  'Master_User': ['Employee_code', 'Nama_Lengkap', 'Username', 'Password', 'Role', 'Email_Perusahaan',
    'Email_Pribadi', 'Nama_Depan', 'Divisi', 'Jabatan', 'Lokasi_Kerja', 'No_HP', 'Email_Atasan',
    'Status', 'Must_Change_Password', 'Login_Terakhir', 'Gagal_Login', 'Terkunci_Sampai',
    'Created_At', 'Updated_At', 'Created_By'],
  'Master_File': ['Doc_id', 'Employee_id', 'Nama_Sertifikasi', 'Start_pelaksanaan', 'End_pelaksanaan',
    'Tanggal_sertifikasi', 'Tanggal_waktu_perpanjangan', 'Expired_at', 'Sisa_masa_berlaku_day',
    'Sisa_masa_berlaku_by_month', 'Status', 'Link_file', 'File_id', 'File_name', 'Mime_type',
    'Ukuran_file', 'Masa_berlaku_bulan', 'Kategori', 'Penerbit', 'No_sertifikat', 'Status_Verifikasi',
    'Catatan', 'Verified_By', 'Verified_At', 'Created_At', 'Updated_At', 'Created_By'],
  'Master_Sertifikasi': ['Cert_id', 'Nama_Sertifikasi', 'Kategori', 'Masa_berlaku_bulan',
    'Penerbit', 'Aktif', 'Jumlah_pemegang', 'Created_At', 'Updated_At'],
  'Session_Token': ['Token', 'Employee_code', 'Username', 'Role', 'Valid_Until', 'Status',
    'User_Agent', 'Email_Google', 'Created_At', 'Invalidated_At'],
  'T_Notifikasi': ['Notif_id', 'Employee_code', 'Doc_id', 'Level', 'Status_key', 'Judul', 'Pesan',
    'Is_Read', 'Read_At', 'Created_At'],
  'T_Email_Log': ['Log_id', 'Periode_key', 'Doc_id', 'Employee_code', 'Level', 'Penerima', 'Cc',
    'Subject', 'Status', 'Error', 'Sent_At'],
  'T_Audit_Trail': ['Audit_id', 'Actor_code', 'Actor_username', 'Actor_role', 'Aksi', 'Ref_type',
    'Ref_id', 'Detail', 'At']
};

/** Skema BARU — harus sama dengan SCHEMAS di Backend/Kode.gs. */
const SCHEMAS_SIM = {
  'Config': ['Key', 'Value'],
  'Master_User': ['Employee_code', 'Nama_Lengkap', 'Username', 'Password', 'Role', 'Working_Location',
    'Email_Perusahaan', 'Email_Pribadi', 'Nama_Depan', 'Divisi', 'Jabatan', 'No_HP', 'Email_Atasan',
    'Status', 'Must_Change_Password', 'Login_Terakhir', 'Gagal_Login', 'Terkunci_Sampai',
    'Created_At', 'Updated_At', 'Created_By'],
  'T_Sertifikasi': ['Cert_Id', 'Employee_Code', 'No_Sertifikat', 'Nama_Sertifikasi',
    'Start_Pelaksanaan', 'End_Pelaksanaan', 'Tanggal_Sertifikasi', 'Penyelenggara', 'Expired_at',
    'Recom_Update', 'Sisa_masa_berlaku_day', 'Sisa_masa_berlaku_by_month', 'Status',
    'Masa_berlaku_bulan', 'Tanggal_waktu_perpanjangan', 'Link_file', 'File_id', 'File_name',
    'Mime_type', 'Ukuran_file', 'Status_Verifikasi', 'Catatan', 'Verified_By', 'Verified_At',
    'Created_At', 'Updated_At', 'Created_By'],
  'Session_Token': ['Token', 'Employee_code', 'Username', 'Role', 'Valid_Until', 'Status',
    'User_Agent', 'Email_Google', 'Created_At', 'Invalidated_At'],
  'T_Notifikasi': ['Notif_id', 'Employee_code', 'Cert_Id', 'Level', 'Status_key', 'Judul', 'Pesan',
    'Is_Read', 'Read_At', 'Created_At'],
  'T_Email_Log': ['Log_id', 'Periode_key', 'Cert_Id', 'Employee_code', 'Level', 'Penerima', 'Cc',
    'Subject', 'Status', 'Error', 'Sent_At'],
  'T_Audit_Trail': ['Audit_id', 'Actor_code', 'Actor_username', 'Actor_role', 'Aksi', 'Ref_type',
    'Ref_id', 'Detail', 'At']
};

/**
 * Bangun spreadsheet contoh dengan volume menyerupai produksi.
 * @param {Object=} opsi { users, files, notif, seed, skema: 'baru'|'lama' }
 */
function buatDatabase(opsi) {
  const o = opsi || {};
  const nUser = o.users || 220;
  const nFile = o.files || 260;
  const nNotif = o.notif || 140;
  const lama = o.skema === 'lama';
  const skema = lama ? SCHEMAS_SIM_LAMA : SCHEMAS_SIM;

  const ss = new Spreadsheet('MYCERTIF_DB');

  // opsi.kosong = spreadsheet benar-benar baru (tanpa sheet) untuk menguji
  // kickstart dari nol.
  if (o.kosong) {
    Object.keys(skema).forEach((n) => ss.insertSheet(n + '_PLACEHOLDER_').name = n + '_PLACEHOLDER_');
    ss.sheets = [];
    return { ss, token: '', kodeUser: [], hc: '', kredensial: [], skemaLama: lama, kosong: true };
  }

  Object.keys(skema).forEach((n) => ss.insertSheet(n).header = skema[n].slice());

  const cfg = ss.getSheetByName('Config');
  CONFIG_SEED.forEach((r) => cfg.rows.push(r.slice()));

  const shUser = ss.getSheetByName('Master_User');
  const shFile = ss.getSheetByName(lama ? 'Master_File' : 'T_Sertifikasi');
  const shSesi = ss.getSheetByName('Session_Token');
  const shNotif = ss.getSheetByName('T_Notifikasi');

  // ---- jenis sertifikasi (hanya pada skema lama) ----
  if (lama) {
    const shJenis = ss.getSheetByName('Master_Sertifikasi');
    JENIS_SERT.forEach((j, i) => shJenis.rows.push([
      'CERT-' + String(i + 1).padStart(4, '0'), j[0], j[1], j[2],
      'Lembaga ' + (i + 1), 'TRUE', 0, '2025-01-01 00:00:00', '2025-01-01 00:00:00'
    ]));
  }

  // ---- user ----
  const rand = mulberry32(o.seed || 20250101);
  const dipakai = {};
  const kodeUser = [];
  const kredensial = [];
  for (let i = 0; i < nUser; i++) {
    const depan = DEPAN[Math.floor(rand() * DEPAN.length)];
    const belakang = BELAKANG[Math.floor(rand() * BELAKANG.length)];
    const nama = depan + ' ' + belakang;
    let uname = depan.toLowerCase();
    if (dipakai[uname]) { dipakai[uname]++; uname = uname + dipakai[uname]; } else dipakai[uname] = 1;
    const kode = String(4100000 + i * 37) + '-C';
    kodeUser.push(kode);
    kredensial.push({ kode: kode, username: uname });
    const role = i === 0 ? 'SA' : (i === 1 ? 'HC' : 'EMP');
    const divisi = DIVISI[Math.floor(rand() * DIVISI.length)];
    const lokasi = 'Patuha' + (i % 3 ? '' : ' Site ' + (i % 5));
    if (lama) {
      shUser.rows.push([
        kode, nama, uname, kode, role,
        uname + '@gde.co.id', uname + '.pribadi@gmail.com', depan.toLowerCase(),
        divisi, 'Staf', lokasi, '0812' + (10000000 + i),
        'atasan' + (i % 20) + '@gde.co.id', 'ACTIVE', 'FALSE', '', '0', '',
        '2025-01-01 00:00:00', '2025-01-01 00:00:00', 'SYSTEM'
      ]);
    } else {
      // urutan: 6 kolom inti lalu pendukung
      shUser.rows.push([
        kode, nama, uname, kode, role, lokasi,
        uname + '@gde.co.id', uname + '.pribadi@gmail.com', depan.toLowerCase(),
        divisi, 'Staf', '0812' + (10000000 + i),
        'atasan' + (i % 20) + '@gde.co.id', 'ACTIVE', 'FALSE', '', '0', '',
        '2025-01-01 00:00:00', '2025-01-01 00:00:00', 'SYSTEM'
      ]);
    }
  }

  // ---- sesi aktif untuk user HC (index 1) ----
  const hc = kodeUser[1];
  const token = 'SIMTOKENHC0001';
  shSesi.rows.push([token, hc, 'hc', 'HC',
    formatDate(new Date(Date.now() + 5 * 3600000), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'),
    'ACTIVE', '', 'hc@gde.co.id', formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'), '']);

  // ---- data sertifikasi ----
  const hariIni = new Date();
  const hariIniMid = new Date(hariIni.getFullYear(), hariIni.getMonth(), hariIni.getDate());
  for (let i = 0; i < nFile; i++) {
    const jenis = JENIS_SERT[Math.floor(rand() * JENIS_SERT.length)];
    const pemilik = kodeUser[Math.floor(rand() * kodeUser.length)];
    // sebaran sisa hari: sebagian besar aman, sebagian kritis
    const geserHari = Math.floor(rand() * 1400) - 220; // -220 .. +1180
    const exp = new Date(hariIniMid.getFullYear(), hariIniMid.getMonth(), hariIniMid.getDate() + geserHari);
    const expStr = formatDate(exp, 'Asia/Jakarta', 'yyyy-MM-dd');
    const end = new Date(exp.getFullYear() - 3, exp.getMonth(), exp.getDate());
    const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());
    const sisaHari = Math.round((exp - hariIniMid) / 86400000);
    const status = sisaHari < 0 ? 'KADALUARSA'
      : sisaHari <= 60 ? 'MENDEKATI_KADALUARSA'
        : sisaHari <= 90 ? 'SEGERA_PERPANJANG'
          : sisaHari <= 180 ? 'PERLU_PERHATIAN'
            : sisaHari <= 270 ? 'PERINGATAN' : 'MASIH_BERLAKU';
    const bulanKe = String((i % 12) + 1).padStart(2, '0');
    const certId = 'DOC-2025' + bulanKe + '-' + String(1000 + i);
    const noSert = 'CERT/' + (1000 + i);
    const recom = formatDate(new Date(exp.getFullYear(), exp.getMonth() - 3, exp.getDate()), 'Asia/Jakarta', 'yyyy-MM-dd');
    if (lama) {
      shFile.rows.push([
        certId, pemilik, jenis[0],
        formatDate(start, 'Asia/Jakarta', 'yyyy-MM-dd'),
        formatDate(end, 'Asia/Jakarta', 'yyyy-MM-dd'),
        formatDate(start, 'Asia/Jakarta', 'yyyy-MM-dd'),
        '', expStr, sisaHari, Math.round((sisaHari / 30) * 10) / 10, status,
        '', i % 3 === 0 ? 'FILEID' + i : '', i % 3 === 0 ? 'A7K2QX_' + pemilik + '_' + jenis[0] + '.pdf' : '',
        i % 3 === 0 ? 'application/pdf' : '', i % 3 === 0 ? 250000 : 0,
        jenis[2], jenis[1], 'Lembaga ' + (i % 10), noSert,
        i % 7 === 0 ? 'PENDING' : 'VERIFIED', '', i % 7 === 0 ? '' : 'HC',
        i % 7 === 0 ? '' : '2025-01-02 00:00:00', '2025-01-01 00:00:00',
        '2025-01-01 00:00:00', 'SYSTEM'
      ]);
    } else {
      shFile.rows.push([
        certId, pemilik, noSert, jenis[0],
        formatDate(start, 'Asia/Jakarta', 'yyyy-MM-dd'),
        formatDate(end, 'Asia/Jakarta', 'yyyy-MM-dd'),
        formatDate(start, 'Asia/Jakarta', 'yyyy-MM-dd'),
        'Lembaga ' + (i % 10), expStr, recom,
        sisaHari, Math.round((sisaHari / 30) * 10) / 10, status,
        jenis[2], '',
        '', i % 3 === 0 ? 'FILEID' + i : '', i % 3 === 0 ? 'A7K2QX_' + pemilik + '_' + jenis[0] + '.pdf' : '',
        i % 3 === 0 ? 'application/pdf' : '', i % 3 === 0 ? 250000 : 0,
        i % 7 === 0 ? 'PENDING' : 'VERIFIED', '', i % 7 === 0 ? '' : 'HC',
        i % 7 === 0 ? '' : '2025-01-02 00:00:00', '2025-01-01 00:00:00',
        '2025-01-01 00:00:00', 'SYSTEM'
      ]);
    }
  }

  // ---- notifikasi ----
  const kolomCert = lama ? 'Doc_id' : 'Cert_Id';
  for (let i = 0; i < nNotif; i++) {
    shNotif.rows.push([
      'NTF-' + String(2000 + i), kodeUser[Math.floor(rand() * kodeUser.length)],
      'DOC-2025' + String((i % 12) + 1).padStart(2, '0') + '-' + String(1000 + i),
      'H30', 'SEGERA_PERPANJANG', 'Pengingat', 'Segera perpanjang sertifikasi',
      i % 3 === 0 ? 'FALSE' : 'TRUE', '', '2025-01-01 00:00:00'
    ]);
  }
  // pastikan header kolom Cert_Id/Doc_id pada notifikasi sesuai skema
  const idxNotif = shNotif.header.indexOf(kolomCert);
  if (idxNotif !== shNotif.header.indexOf(lama ? 'Doc_id' : 'Cert_Id')) { /* no-op, header sudah benar */ }

  return { ss, token, kodeUser, hc, kredensial, skemaLama: lama };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// 4. KONTEKS MOCK UNTUK SATU EKSEKUSI
// ============================================================================

function loadBackend(db, opts) {
  const o = opts || {};
  const props = o.props || new Map();
  const cache = o.cache || ENV.cacheStore;

  const scriptCache = {
    get(k) {
      if (cache.has(k)) { ENV.cacheCalls.hit++; return cache.get(k); }
      ENV.cacheCalls.miss++; return null;
    },
    getAll(keys) {
      const out = {};
      keys.forEach((k) => { if (cache.has(k)) { out[k] = cache.get(k); ENV.cacheCalls.hit++; } else ENV.cacheCalls.miss++; });
      return out;
    },
    put(k, v) { ENV.cacheCalls.put++; cache.set(k, String(v)); },
    putAll(obj) { ENV.cacheCalls.put++; Object.keys(obj).forEach((k) => cache.set(k, String(obj[k]))); },
    remove(k) { cache.delete(k); },
    removeAll(keys) { (keys || [...cache.keys()]).forEach((k) => cache.delete(k)); }
  };

  const sandbox = {
    console,
    SpreadsheetApp: {
      openById() { ENV.counters.opens++; return db; },
      getActiveSpreadsheet() { return db; },
      create() { return db; },
      flush() { },
      getUi() { throw new Error('UI tidak tersedia di simulator'); }
    },
    DriveApp: {
      getFolderById() { return folderMock(); },
      getFoldersByName() { return { hasNext: () => false, next: () => folderMock() }; },
      createFolder() { return folderMock(); },
      getFileById() { return fileMock(); }
    },
    MailApp: {
      sendEmail(a, b, c, d) {
        // dua bentuk pemanggilan: (options) atau (to, subject, body, options)
        if (a && typeof a === 'object') { ENV.emails.push(Object.assign({}, a)); return; }
        const o = d || {};
        ENV.emails.push({
          to: a, subject: b, body: c,
          cc: o.cc || '',
          // htmlBody ikut disimpan supaya uji bisa memeriksa isi email HTML
          htmlBody: o.htmlBody || '',
          name: o.name || '', from: o.from || '', replyTo: o.replyTo || ''
        });
      },
      getRemainingDailyQuota() { return 1500; }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty: (k) => (props.has(k) ? props.get(k) : null),
          setProperty: (k, v) => { props.set(k, String(v)); },
          deleteProperty: (k) => { props.delete(k); },
          getProperties: () => Object.fromEntries(props)
        };
      }
    },
    CacheService: { getScriptCache: () => scriptCache, getUserCache: () => scriptCache },
    Utilities: {
      formatDate,
      getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
      base64Decode: (s) => Buffer.from(String(s), 'base64'),
      newBlob: (data, mime, name) => ({ getDataAsString: () => String(data), getName: () => name, getContentType: () => mime }),
      computeDigest: () => [1, 2, 3],
      DigestAlgorithm: { MD5: 'MD5', SHA_256: 'SHA_256' },
      sleep: () => { }
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Jakarta',
      getActiveUser: () => ({ getEmail: () => o.activeEmail || 'hc@gde.co.id' }),
      getEffectiveUser: () => ({ getEmail: () => 'deployer@gde.co.id' })
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/SIM/exec' }),
      newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => ({ getUniqueId: () => 'TRG1' }) }) }) }) }),
      getProjectTriggers: () => [],
      deleteTrigger: () => { },
      getOAuthToken: () => 'SIM_OAUTH'
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => htmlOut(), bootstrap: '' }),
      createHtmlOutputFromFile: () => htmlOut(),
      createHtmlOutput: () => htmlOut(),
      SandboxMode: { IFRAME: 'IFRAME' },
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }
    },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getBlob: () => ({}), getContentText: () => '' }) },
    Logger: { log: (m) => ENV.logs.push(String(m)) },
    Exception: class extends Error { }
  };
  function folderMock() {
    return {
      getId: () => 'FOLDER_SIM', getName: () => 'myCertif_Lampiran', getUrl: () => 'https://drive.google.com/x',
      createFile: () => fileMock(), getFiles: () => ({ hasNext: () => false, next: () => null }),
      createFolder: () => folderMock(), getFoldersByName: () => ({ hasNext: () => false, next: () => null }),
      getFolders: () => ({ hasNext: () => false, next: () => null })
    };
  }
  function fileMock() {
    return {
      getId: () => 'FILE_SIM', getName: () => 'f.pdf', getUrl: () => 'https://drive.google.com/f',
      setTrashed: () => { }, getSize: () => 1000, setDescription: () => { },
      getBlob: () => ({ getBytes: () => [] }), makeCopy: () => fileMock(), moveTo: () => { }
    };
  }
  function htmlOut() {
    const o2 = {
      getContent: () => '<html></html>', setTitle: () => o2, setSandboxMode: () => o2,
      setXFrameOptionsMode: () => o2, addMetaTag: () => o2, getTitle: () => ''
    };
    return o2;
  }

  // Date dari realm host dipakai bersama supaya `x instanceof Date` di kode
  // backend berperilaku sama seperti di Apps Script (satu lingkup global).
  // Tanpa ini, Date buatan host tidak dikenali sebagai Date oleh kode di dalam VM.
  sandbox.Date = Date;

  const ctx = vm.createContext(sandbox);
  const berkas = fs.readdirSync(DIR_BE).filter((f) => f.endsWith('.gs.txt')).sort();
  // Urutan tidak penting (Apps Script menggabung semua berkas dalam satu lingkup),
  // tetapi diurutkan agar hasil deterministik.
  berkas.forEach((f) => {
    const kode = fs.readFileSync(path.join(DIR_BE, f), 'utf8');
    try {
      vm.runInContext(kode, ctx, { filename: 'Backend/' + f });
    } catch (e) {
      throw new Error('Gagal memuat Backend/' + f + ': ' + e.message);
    }
  });
  return { ctx, props, cache: scriptCache };
}

// ============================================================================
// 5. SKENARIO
// ============================================================================

function ambilHasil(res) {
  if (!res) return '(null)';
  if (res.ok) return 'ok';
  return 'ERROR: ' + res.error;
}

function jalankanSkenario(nama, db, opsi, fn) {
  const lingkungan = loadBackend(db, opsi);
  ENV.reset();
  ENV.cacheStore = opsi.cache || ENV.cacheStore;
  let hasil, galat = null;
  const t0 = Date.now();
  try {
    hasil = fn(lingkungan.ctx, opsi);
  } catch (e) {
    galat = e;
    hasil = null;
  }
  const ms = Date.now() - t0;
  const c = ENV.counters;
  return {
    nama, ms, hasil, galat,
    reads: c.reads, cellsRead: c.cellsRead, writes: c.writes, cellsWrote: c.cellsWrote,
    opens: c.opens, perSheet: c.perSheet,
    cache: Object.assign({}, ENV.cacheCalls),
    ringkas: galat ? 'EXCEPTION: ' + galat.message : ambilHasil(hasil)
  };
}

function tampilkan(hasil) {
  const c = ENV.counters;
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + '─'.repeat(78));
  console.log('SKENARIO: ' + hasil.nama);
  console.log('─'.repeat(78));
  console.log('  hasil        : ' + hasil.ringkas);
  if (hasil.galat) console.log('  stack        : ' + String(hasil.galat.stack).split('\n').slice(1, 3).join('\n                 '));
  console.log('  baca sheet   : ' + hasil.reads + ' panggilan / ' + hasil.cellsRead.toLocaleString('id-ID') + ' sel');
  console.log('  tulis sheet  : ' + hasil.writes + ' panggilan / ' + hasil.cellsWrote.toLocaleString('id-ID') + ' sel');
  console.log('  buka SS      : ' + hasil.opens);
  console.log('  cache        : hit=' + hasil.cache.hit + ' miss=' + hasil.cache.miss + ' put=' + hasil.cache.put);
  const rincian = Object.keys(hasil.perSheet)
    .sort((a, b) => hasil.perSheet[b].reads - hasil.perSheet[a].reads)
    .map((k) => k + '=' + hasil.perSheet[k].reads + 'r/' + hasil.perSheet[k].writes + 'w')
    .join('  ');
  console.log('  per sheet    : ' + rincian);
  return hasil;
}

// ============================================================================
// 6. MAIN
// ============================================================================

function main() {
  const arg = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : '';
  const seed = buatDatabase({ users: 220, files: 260, notif: 140 });
  const db = seed.ss;
  const token = seed.token;
  const hc = seed.hc;
  const kodeTarget = seed.kodeUser[5];

  const skenario = [
    ['apiGetSession', (ctx) => ctx.apiGetSession(token)],
    ['apiGetMeta', (ctx) => ctx.apiGetMeta(token)],
    ['apiGetDashboard', (ctx) => ctx.apiGetDashboard(token, {})],
    ['apiListFiles (hal.1)', (ctx) => ctx.apiListFiles(token, { page: 1, per_page: 25 })],
    ['apiListFiles (cari)', (ctx) => ctx.apiListFiles(token, { q: 'listrik', page: 1, per_page: 25 })],
    ['apiListEmployees', (ctx) => ctx.apiListEmployees(token, {})],
    ['apiGetEmployeeProfile', (ctx) => ctx.apiGetEmployeeProfile(token, kodeTarget)],
    ['apiGetRingkasanHeader', (ctx) => ctx.apiGetRingkasanHeader(token)],
    ['apiLogin (2 user)', (ctx) => {
      const a = ctx.apiLogin(seed.kredensial[10].username, seed.kredensial[10].kode);
      const b = ctx.apiLogin(seed.kredensial[11].kode, seed.kredensial[11].kode);
      return { ok: a.ok && b.ok };
    }],
    ['jalankanReminder_', (ctx) => ctx.jalankanReminder_(false)]
  ];

  console.log('='.repeat(78));
  console.log(' myCertif — pengukuran biaya akses spreadsheet (simulator)');
  console.log('='.repeat(78));
  console.log(' Volume contoh: ' + seed.ss.getSheetByName('Master_User').rows.length + ' user, '
    + seed.ss.getSheetByName('T_Sertifikasi').rows.length + ' sertifikasi, '
    + seed.ss.getSheetByName('T_Notifikasi').rows.length + ' notifikasi, '
    + seed.ss.getSheetByName('Config').rows.length + ' config');

  const hasilSemua = [];
  skenario.forEach(([nama, fn]) => {
    if (arg && nama.toLowerCase().indexOf(arg.toLowerCase()) === -1) return;
    const h = jalankanSkenario(nama, db, { token, cache: ENV.cacheStore }, fn);
    if (arg) tampilkan(h);
    hasilSemua.push(h);
  });

  const totalReads = hasilSemua.reduce((a, b) => a + b.reads, 0);
  const totalCells = hasilSemua.reduce((a, b) => a + b.cellsRead, 0);
  const totalWrites = hasilSemua.reduce((a, b) => a + b.writes, 0);

  console.log('\n' + '='.repeat(78));
  console.log(' RINGKASAN  (kolom "baca" = panggilan getValues, "sel" = jumlah sel)');
  console.log('='.repeat(78));
  console.log(' ' + 'SKENARIO'.padEnd(26) + 'BACA'.padStart(7) + 'SEL'.padStart(12) + 'TULIS'.padStart(7) + '  HASIL');
  console.log(' ' + '-'.repeat(74));
  hasilSemua.forEach((h) => {
    console.log(' ' + h.nama.padEnd(26) + String(h.reads).padStart(7)
      + h.cellsRead.toLocaleString('id-ID').padStart(12)
      + String(h.writes).padStart(7) + '  ' + h.ringkas);
  });
  console.log(' ' + '-'.repeat(74));
  console.log(' ' + 'TOTAL'.padEnd(26) + String(totalReads).padStart(7)
    + totalCells.toLocaleString('id-ID').padStart(12) + String(totalWrites).padStart(7));
  console.log('='.repeat(78));

  // mesin pembanding bila diminta
  const outFile = path.join(__dirname, 'sim-baseline.json');
  if (process.argv.includes('--simpan')) {
    fs.writeFileSync(outFile, JSON.stringify({
      pada: new Date().toISOString(),
      volume: { users: 220, files: 260, notif: 140 },
      skenario: hasilSemua.map((h) => ({ nama: h.nama, reads: h.reads, cellsRead: h.cellsRead, writes: h.writes, ringkas: h.ringkas }))
    }, null, 2));
    console.log(' Baseline disimpan ke _tools/sim-baseline.json');
  }
  if (process.argv.includes('--banding')) {
    if (!fs.existsSync(outFile)) { console.log(' ! Belum ada baseline. Jalankan: node _tools/sim.js --simpan'); return; }
    const base = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    console.log('\n' + '='.repeat(78));
    console.log(' PERBANDINGAN vs baseline ' + base.pada);
    console.log('='.repeat(78));
    console.log(' ' + 'SKENARIO'.padEnd(26) + 'SEBELUM'.padStart(9) + 'SESUDAH'.padStart(9) + 'EFISIENSI'.padStart(11));
    console.log(' ' + '-'.repeat(74));
    hasilSemua.forEach((h) => {
      const b = base.skenario.find((x) => x.nama === h.nama);
      if (!b) return;
      const rasio = h.reads === 0 ? (b.reads === 0 ? '1x' : '∞') : (b.reads / h.reads).toFixed(1) + 'x';
      console.log(' ' + h.nama.padEnd(26) + String(b.reads).padStart(9) + String(h.reads).padStart(9) + rasio.padStart(11));
    });
    console.log('='.repeat(78));
  }
}

if (require.main === module) main();

module.exports = { buatDatabase, loadBackend, jalankanSkenario, ENV, formatDate, SCHEMAS_SIM, SCHEMAS_SIM_LAMA };
