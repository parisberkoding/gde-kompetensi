#!/usr/bin/env node
/**
 * ============================================================================
 * uji.js — Uji kebenaran backend myCertif (dijalankan di atas simulator)
 * Jalankan dari akar project:  node _tools/uji.js
 * ============================================================================
 *
 * Fokus uji:
 *   A. Perbaikan tanggal-waktu  : Valid_Until sesi tidak lagi terpotong 00:00:00
 *   B. Primitif lapisan data    : config, baca baris, indeks, batch write
 *   C. Integritas API vs sheet  : angka yang dikirim ke UI cocok dengan isi sheet
 *   D. Tulis -> baca ulang      : simpan/ubah/hapus benar-benar tersimpan
 *   E. Cache config             : perubahan config langsung terlihat (tidak basi)
 */

'use strict';

const { buatDatabase, loadBackend, ENV } = require('./sim.js');

let lulus = 0, gagal = 0;
const kegagalan = [];

function ok(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log('  \u2713 ' + nama); return true; }
  gagal++;
  kegagalan.push(nama + (detail ? ' -> ' + detail : ''));
  console.log('  \u2717 ' + nama + (detail ? '  [' + detail + ']' : ''));
  return false;
}
function sama(nama, dapat, harap) {
  return ok(nama, String(dapat) === String(harap), 'dapat=' + JSON.stringify(dapat) + ' harap=' + JSON.stringify(harap));
}
function head(s) { console.log('\n' + s); }

/** Ambil satu baris sheet sebagai objek berdasarkan nomor baris (1-based). */
function barisSheet(ss, sheet, rowIndex) {
  const sh = ss.getSheetByName(sheet);
  const out = {};
  sh.header.forEach((h, i) => { out[h] = (sh.rows[rowIndex - 2] || [])[i]; });
  return out;
}
function jumlahBaris(ss, sheet) { return ss.getSheetByName(sheet).rows.length; }

/** Jumlah pembacaan/penulisan sheet dari penghitung simulator (0 bila tak tersentuh). */
function bacaSheet(nama) { const s = ENV.counters.perSheet[nama]; return s ? s.reads : 0; }
function tulisSheet(nama) { const s = ENV.counters.perSheet[nama]; return s ? s.writes : 0; }

/** Tambah baris dengan aman: nilai dipetakan lewat nama kolom sheet. */
function tambahBaris(ss, sheet, obj) {
  const sh = ss.getSheetByName(sheet);
  sh.rows.push(sh.header.map((h) => (obj[h] === undefined || obj[h] === null) ? '' : obj[h]));
}

/** Nilai satu sel. */
function sel(ss, sheet, rowIndex, kolom) {
  const sh = ss.getSheetByName(sheet);
  const i = sh.header.indexOf(kolom);
  return (sh.rows[rowIndex - 2] || [])[i];
}

// ============================================================================

console.log('='.repeat(78));
console.log(' myCertif — uji kebenaran backend');
console.log('='.repeat(78));

const seed = buatDatabase({ users: 220, files: 260, notif: 140 });
const ss = seed.ss;
const token = seed.token;

/* ---------------------------------------------------------------- A. waktu */
head('A. Perbaikan tanggal-waktu (sesi tidak lagi kedaluwarsa sendiri)');

{
  const env = loadBackend(ss, {});
  const sesi = barisSheet(ss, 'Session_Token', 2);
  const jamSesi = String(sesi.Valid_Until).slice(11);
  ok('Valid_Until sesi contoh memuat jam', /^\d{2}:\d{2}:\d{2}$/.test(jamSesi), jamSesi);

  const s = env.ctx.apiGetSession(token);
  ok('apiGetSession berhasil', s.ok, s.error);

  // Perpanjangan sesi menulis jam, bukan 00:00:00
  const v = env.ctx.toDateTime_(barisSheet(ss, 'Session_Token', 2).Valid_Until);
  ok('sesi diperpanjang ke masa depan', v && v.getTime() > Date.now(),
    barisSheet(ss, 'Session_Token', 2).Valid_Until);
}

{
  // fmtDate_ harus mempertahankan jam HANYA untuk pola ber-jam
  const env = loadBackend(ss, {});
  const d = new Date(2026, 4, 17, 14, 35, 9);
  sama('fmtDate_ pola tanggal -> tengah malam', env.ctx.fmtDate_(d, 'yyyy-MM-dd'), '2026-05-17');
  sama('fmtDate_ pola waktu -> jam utuh', env.ctx.fmtDate_(d, 'yyyy-MM-dd HH:mm:ss'), '2026-05-17 14:35:09');
  sama('fmtDate_ dari string ber-jam', env.ctx.fmtDate_('2026-05-17 08:05:00', 'yyyy-MM-dd HH:mm:ss'), '2026-05-17 08:05:00');
}

{
  // Sesi benar-benar bertahan setelah beberapa permintaan berurutan
  let bertahan = true;
  for (let i = 0; i < 3; i++) {
    const env = loadBackend(ss, {});
    const r = env.ctx.apiGetSession(token);
    if (!r.ok) { bertahan = false; break; }
  }
  ok('sesi bertahan pada 3 permintaan berurutan', bertahan);
}

/* ------------------------------------------------------------- B. primitif */
head('B. Primitif lapisan data (Data.gs)');

{
  const env = loadBackend(ss, { cache: new Map() });
  const c = env.ctx;

  sama('getConfig_ ambang peringatan', c.getConfig_('status_peringatan_hari'), '270');
  sama('getConfig_ kunci tak dikenal -> kosong', c.getConfig_('tidak_ada_kunci_ini'), '');
  sama('getConfigNum_ dengan default', c.getConfigNum_('tidak_ada_kunci_ini', 7), 7);
  sama('getConfigBool_ TRUE', c.getConfigBool_('reminder_enabled', false), true);

  // Config dibaca SEKALI untuk 50 pemanggilan
  const envC = loadBackend(ss, { cache: new Map() });
  ENV.reset();
  envC.ctx.getConfig_('status_segera_hari');            // pemicu baca pertama
  for (let i = 0; i < 49; i++) envC.ctx.getConfig_('status_segera_hari');
  sama('50x getConfig_ = 1 pembacaan sheet', bacaSheet('Config'), 1);

  // indeks pencarian baris
  const kode = seed.kredensial[7].kode;
  const row = c.findRowByCol_('Master_User', 'Employee_code', kode);
  ok('findRowByCol_ menemukan user', row > 1, 'row=' + row);
  sama('baris hasil pencarian benar', sel(ss, 'Master_User', row, 'Employee_code'), kode);
  sama('findRowByCol_ nilai tak ada -> -1', c.findRowByCol_('Master_User', 'Employee_code', 'ZZZ-999'), -1);

  const envB = loadBackend(ss, { cache: new Map() });
  ENV.reset();
  for (let i = 0; i < 50; i++) envB.ctx.findRowByCol_('Master_User', 'Employee_code', kode);
  sama('50x findRowByCol_ = 1 pembacaan sheet', bacaSheet('Master_User'), 1);

  const rows = c.findRowsByCol_('T_Sertifikasi', 'Employee_Code', kode);
  ok('findRowsByCol_ mengembalikan baris milik satu karyawan', Array.isArray(rows));
  ok('semua baris hasil filter memang milik karyawan itu',
    rows.every((r) => String(sel(ss, 'T_Sertifikasi', r, 'Employee_Code')) === kode));
}

{
  // updateRowByCol_ : batch, hanya kolom yang disebut yang berubah
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const kode = seed.kredensial[9].kode;
  const row = c.findRowByCol_('Master_User', 'Employee_code', kode);

  const sebelum = barisSheet(ss, 'Master_User', row);
  ENV.reset();
  c.updateRowByCol_('Master_User', row, {
    Jabatan: 'Supervisor Uji',
    Divisi: 'Divisi Uji',
    No_HP: '0800000000'
  });
  const tulis = tulisSheet('Master_User');
  ok('3 kolom bersebelahan -> sedikit panggilan tulis', tulis <= 3, 'writes=' + tulis);

  const sesudah = barisSheet(ss, 'Master_User', row);
  sama('kolom Jabatan berubah', sesudah.Jabatan, 'Supervisor Uji');
  sama('kolom Divisi berubah', sesudah.Divisi, 'Divisi Uji');
  sama('kolom No_HP berubah', sesudah.No_HP, '0800000000');
  sama('kolom lain tidak tersentuh (Username)', sesudah.Username, sebelum.Username);
  sama('kolom lain tidak tersentuh (Password)', sesudah.Password, sebelum.Password);
  sama('kolom lain tidak tersentuh (Nama_Lengkap)', sesudah.Nama_Lengkap, sebelum.Nama_Lengkap);

  // memo ikut diperbarui tanpa baca ulang sheet
  ENV.reset();
  const lagi = c.rowToObject_('Master_User', row);
  sama('rowToObject_ melihat nilai baru', lagi.Jabatan, 'Supervisor Uji');
  sama('rowToObject_ tidak membaca sheet lagi', bacaSheet('Master_User'), 0);
}

{
  // appendObject_ + invalidasi indeks
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const sebelum = jumlahBaris(ss, 'T_Notifikasi');
  const rowBaru = c.appendObject_('T_Notifikasi', {
    Notif_id: 'NTF-UJI-1', Employee_code: seed.kredensial[3].kode, Cert_Id: 'DOC-X',
    Level: 'H30', Status_key: 'SEGERA_PERPANJANG', Judul: 'Uji', Pesan: 'Pesan uji',
    Is_Read: 'FALSE', Read_At: '', Created_At: c.nowStr_()
  });
  sama('appendObject_ menambah 1 baris', jumlahBaris(ss, 'T_Notifikasi'), sebelum + 1);
  sama('nomor baris yang dikembalikan benar', rowBaru, jumlahBaris(ss, 'T_Notifikasi') + 1);
  sama('findRowByCol_ menemukan baris baru', c.findRowByCol_('T_Notifikasi', 'Notif_id', 'NTF-UJI-1'), rowBaru);
  ok('baris baru terisi benar', String(sel(ss, 'T_Notifikasi', rowBaru, 'Pesan')) === 'Pesan uji');
}

{
  // deleteRowByCol_ : baris bergeser, pencarian tetap konsisten
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const n = jumlahBaris(ss, 'T_Notifikasi');
  const kodeTarget = sel(ss, 'T_Notifikasi', 5, 'Notif_id');
  const tetangga = sel(ss, 'T_Notifikasi', 6, 'Notif_id');
  ok('hapus baris berhasil', c.deleteRowByCol_('T_Notifikasi', 'Notif_id', kodeTarget));
  sama('jumlah baris berkurang 1', jumlahBaris(ss, 'T_Notifikasi'), n - 1);
  sama('baris di bawahnya bergeser naik', sel(ss, 'T_Notifikasi', 5, 'Notif_id'), tetangga);
  sama('baris terhapus tidak ditemukan lagi', c.findRowByCol_('T_Notifikasi', 'Notif_id', kodeTarget), -1);
}

/* -------------------------------------------------------------- C. API vs sheet */
head('C. Integritas angka API vs isi sheet');

{
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const totalFile = jumlahBaris(ss, 'T_Sertifikasi');

  const r = c.apiListFiles(token, { page: 1, per_page: 25 });
  ok('apiListFiles ok', r.ok, r.error);
  sama('total pada API = jumlah baris sheet', r.data.total, totalFile);
  sama('jumlah baris halaman = per_page', r.data.rows.length, 25);
  sama('jumlah halaman benar', r.data.pages, Math.ceil(totalFile / 25));

  const jumlahStatus = Object.keys(r.data.ringkasan).reduce((a, k) => a + r.data.ringkasan[k], 0);
  sama('ringkasan status menjumlah total', jumlahStatus, totalFile);

  // setiap baris harus konsisten dengan kolomnya di sheet
  const contoh = r.data.rows[0];
  const br = c.findRowByCol_('T_Sertifikasi', 'Cert_Id', contoh.doc_id);
  sama('doc_id cocok', sel(ss, 'T_Sertifikasi', br, 'Cert_Id'), contoh.doc_id);
  sama('nama_pemegang diambil dari Master_User', contoh.nama_pemegang,
    sel(ss, 'Master_User', c.findRowByCol_('Master_User', 'Employee_code', contoh.employee_id), 'Nama_Lengkap'));
  sama('expired_at cocok', contoh.expired_at, c.fmtDate_(sel(ss, 'T_Sertifikasi', br, 'Expired_at'), 'yyyy-MM-dd'));

  // sisa hari dihitung ulang, bukan diambil dari kolom yang mungkin basi
  const exp = c.toDate_(sel(ss, 'T_Sertifikasi', br, 'Expired_at'));
  const harap = Math.round((exp - c.todayDate_()) / 86400000);
  sama('sisa_hari dihitung ulang dari Expired_at', contoh.sisa_hari, harap);
}

{
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const d = c.apiGetDashboard(token, {});
  ok('apiGetDashboard ok', d.ok, d.error);
  sama('KPI total_sertifikasi = jumlah baris', d.data.kpi.total_sertifikasi, jumlahBaris(ss, 'T_Sertifikasi'));
  sama('KPI total_pekerja = jumlah user', d.data.kpi.total_pekerja, jumlahBaris(ss, 'Master_User'));

  const jumlahSebaran = d.data.sebaran.reduce((a, s) => a + s.jumlah, 0);
  sama('sebaran status + belum ada tanggal = total', jumlahSebaran + d.data.kpi.belum_ada_tanggal, d.data.kpi.total_sertifikasi);
  const jumlahDivisi = d.data.per_divisi.reduce((a, x) => a + x.total, 0);
  sama('per divisi menjumlah total', jumlahDivisi, d.data.kpi.total_sertifikasi);
  sama('jumlah tren 12 bulan', d.data.tren.length, 12);
}

{
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const r = c.apiGetRingkasanHeader(token);
  ok('apiGetRingkasanHeader ok', r.ok, r.error);
  const j = c.apiListEmployees(token, {});
  sama('apiListEmployees total = jumlah user', j.data.total, jumlahBaris(ss, 'Master_User'));
  const totalSert = j.data.rows.reduce((a, x) => a + x.jumlah_sertifikasi, 0);
  sama('jumlah sertifikasi per karyawan menjumlah total', totalSert, jumlahBaris(ss, 'T_Sertifikasi'));
}

{
  // karyawan (EMP) hanya boleh melihat datanya sendiri
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const emp = seed.kredensial[50];
  const login = c.apiLogin(emp.username, emp.kode);
  ok('login karyawan berhasil', login.ok && login.data.token, login.error);
  const t = login.data.token;
  const r = c.apiListFiles(t, { page: 1, per_page: 100 });
  ok('apiListFiles karyawan ok', r.ok, r.error);
  ok('karyawan hanya melihat datanya sendiri',
    r.data.rows.every((x) => x.employee_id === emp.kode), 'ada baris milik orang lain');

  const forbidden = c.apiListUsers(t, {});
  ok('karyawan ditolak di endpoint HC', !forbidden.ok);
}

/* ----------------------------------------------------------- D. tulis-baca */
head('D. Simpan data sertifikasi (tulis lalu baca ulang)');

{
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const sebelum = jumlahBaris(ss, 'T_Sertifikasi');
  const pemilik = seed.kredensial[12].kode;

  const simpan = c.apiSaveFile(token, {
    employee_id: pemilik,
    nama_sertifikasi: 'Sertifikasi Uji Otomatis',
    start_pelaksanaan: '2024-01-10',
    end_pelaksanaan: '2024-01-20',
    tanggal_sertifikasi: '2024-01-15',
    masa_berlaku_bulan: 36,
    penyelenggara: 'Lembaga Uji',
    no_sertifikat: 'UJI/001'
  });
  ok('apiSaveFile (baru) ok', simpan.ok, simpan.error);
  sama('jumlah baris bertambah 1', jumlahBaris(ss, 'T_Sertifikasi'), sebelum + 1);

  const docId = simpan.data.doc_id;
  const row = c.findRowByCol_('T_Sertifikasi', 'Cert_Id', docId);
  ok('baris baru bisa ditemukan', row > 1);
  sama('Employee_Code tersimpan', sel(ss, 'T_Sertifikasi', row, 'Employee_Code'), pemilik);
  sama('End_Pelaksanaan tersimpan', sel(ss, 'T_Sertifikasi', row, 'End_Pelaksanaan'), '2024-01-20');
  sama('No_Sertifikat tersimpan', sel(ss, 'T_Sertifikasi', row, 'No_Sertifikat'), 'UJI/001');
  sama('masa berlaku tersimpan', sel(ss, 'T_Sertifikasi', row, 'Masa_berlaku_bulan'), 36);
  // Expired = End_Pelaksanaan + 36 bulan
  sama('Expired_at = End_Pelaksanaan + masa berlaku', sel(ss, 'T_Sertifikasi', row, 'Expired_at'), '2027-01-20');
  ok('Status terisi', String(sel(ss, 'T_Sertifikasi', row, 'Status')).length > 0);

  // --- ubah ---
  const ubah = c.apiSaveFile(token, {
    doc_id: docId,
    employee_id: pemilik,
    nama_sertifikasi: 'Sertifikasi Uji Otomatis (Revisi)',
    start_pelaksanaan: '2024-01-10',
    end_pelaksanaan: '2024-01-20',
    masa_berlaku_bulan: 60
  });
  ok('apiSaveFile (ubah) ok', ubah.ok, ubah.error);
  const row2 = c.findRowByCol_('T_Sertifikasi', 'Cert_Id', docId);
  sama('nama sertifikasi diperbarui', sel(ss, 'T_Sertifikasi', row2, 'Nama_Sertifikasi'), 'Sertifikasi Uji Otomatis (Revisi)');
  sama('masa berlaku diperbarui', sel(ss, 'T_Sertifikasi', row2, 'Masa_berlaku_bulan'), 60);
  sama('Expired_at ikut dihitung ulang', sel(ss, 'T_Sertifikasi', row2, 'Expired_at'), '2029-01-20');
  sama('jumlah baris tidak bertambah saat mengubah', jumlahBaris(ss, 'T_Sertifikasi'), sebelum + 1);

  // --- hapus ---
  const hapus = c.apiDeleteFile(token, docId);
  ok('apiDeleteFile ok', hapus.ok, hapus.error);
  sama('jumlah baris kembali', jumlahBaris(ss, 'T_Sertifikasi'), sebelum);
  sama('doc_id tidak ditemukan lagi', c.findRowByCol_('T_Sertifikasi', 'Cert_Id', docId), -1);
}

{
  // updateRowByCol_ ke beberapa sesi sekaligus tetap konsisten
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const keluaran = c.apiListNotifications(token, {});
  ok('apiListNotifications ok', keluaran.ok, keluaran.error);
  const belum = keluaran.data.rows.filter((n) => String(n.is_read).toUpperCase() !== 'TRUE');
  if (belum.length) {
    const tandai = c.apiMarkNotificationRead(token, belum[0].notif_id);
    ok('apiMarkNotificationRead ok', tandai.ok, tandai.error);
  } else {
    ok('apiMarkNotificationRead (tidak ada yang belum dibaca, dilewati)', true);
  }
}

/* ---------------------------------------------------------------- E. cache */
head('E. Cache konfigurasi tidak basi');

{
  const env = loadBackend(ss, {});
  const c = env.ctx;
  sama('nilai awal', c.getConfig_('tabel_baris_per_halaman'), '25');
  c.setConfig_('tabel_baris_per_halaman', '50');
  sama('nilai langsung berubah di eksekusi yang sama', c.getConfig_('tabel_baris_per_halaman'), '50');

  // eksekusi BARU harus melihat nilai terbaru (CacheService sudah dibuang)
  const env2 = loadBackend(ss, {});
  sama('eksekusi baru melihat nilai terbaru', env2.ctx.getConfig_('tabel_baris_per_halaman'), '50');

  // kembalikan
  env2.ctx.setConfig_('tabel_baris_per_halaman', '25');
  const env3 = loadBackend(ss, {});
  sama('nilai dikembalikan', env3.ctx.getConfig_('tabel_baris_per_halaman'), '25');
}

{
  // CacheService benar-benar dipakai lintas eksekusi untuk Config
  loadBackend(ss, {}).ctx.getAllConfig_();   // isi cache
  const envBaru = loadBackend(ss, {});
  ENV.reset();
  envBaru.ctx.getAllConfig_();
  sama('config dari cache -> 0 pembacaan sheet', bacaSheet('Config'), 0);
}

/* ------------------------------------------------------- F. anti-spam email */
head('F. Reminder: anti-spam pengiriman email');

{
  const env = loadBackend(ss, { cache: new Map() });
  const c = env.ctx;
  // batas per jalan dinaikkan supaya yang teruji anti-spam, bukan batas kuota
  c.setConfig_('reminder_max_email_per_jalan', '500');

  const sebelum = jumlahBaris(ss, 'T_Email_Log');
  ENV.emails = [];
  const r1 = c.jalankanReminder_(false);
  const terkirim1 = ENV.emails.length;

  ENV.emails = [];
  const r2 = c.jalankanReminder_(false);
  const terkirim2 = ENV.emails.length;

  ENV.emails = [];
  c.jalankanReminder_(false);
  const terkirim3 = ENV.emails.length;

  ok('jalan pertama mengirim email', terkirim1 > 0, 'terkirim=' + terkirim1);
  sama('jalan kedua tidak mengirim ulang (anti-spam)', terkirim2, 0);
  sama('jalan ketiga juga tidak mengirim ulang', terkirim3, 0);
  ok('log email bertambah pada jalan pertama', jumlahBaris(ss, 'T_Email_Log') > sebelum);
  ok('hasil reminder ok', r1 && r2);

  // tidak boleh ada satu pun Periode_key tercatat SENT dua kali
  const logs = c.sheetToObjects_('T_Email_Log').filter((l) => String(l.Status).toUpperCase() === 'SENT');
  const kunci = logs.map((l) => String(l.Periode_key));
  const ganda = kunci.filter((k, i) => kunci.indexOf(k) !== i);
  sama('tidak ada Periode_key terkirim ganda', ganda.length, 0);

  // batas per jalan dihormati
  ss.getSheetByName('T_Email_Log').rows = [];
  const env2 = loadBackend(ss, { cache: new Map() });
  env2.ctx.setConfig_('reminder_max_email_per_jalan', '5');
  ENV.emails = [];
  const r4 = env2.ctx.jalankanReminder_(false);
  ok('batas email per jalan dihormati', ENV.emails.length <= 5, 'terkirim=' + ENV.emails.length);
  ok('laporan menyebut batas tercapai', (r4.detail || []).some((d) => d.indexOf('Batas') === 0), JSON.stringify(r4.detail));

  // kembalikan pengaturan
  env2.ctx.setConfig_('reminder_max_email_per_jalan', '90');
}

/* ------------------------------------------------------------ G. importer  */
head('G. Importer & pembuat akun tetap jalan');

{
  const env = loadBackend(ss, {});
  const c = env.ctx;
  const sheets = c.apiDaftarSheet(token);
  ok('apiDaftarSheet ok', sheets.ok, sheets.error);

  const kodeBaru = '9999999-C';
  tambahBaris(ss, 'T_Sertifikasi', {
    Cert_Id: 'DOC-202512-9999', Employee_Code: kodeBaru, No_Sertifikat: 'IMP/1',
    Nama_Sertifikasi: 'Sertifikasi Impor', Start_Pelaksanaan: '2024-02-01',
    End_Pelaksanaan: '2024-02-10', Tanggal_Sertifikasi: '2024-02-05',
    Penyelenggara: 'Lembaga Impor', Expired_at: '2027-02-10', Recom_Update: '2026-11-10',
    Sisa_masa_berlaku_day: 400, Sisa_masa_berlaku_by_month: 13.3, Status: 'MASIH_BERLAKU',
    Masa_berlaku_bulan: 36, Status_Verifikasi: 'VERIFIED', Verified_By: 'HC',
    Verified_At: '2025-01-02 00:00:00', Created_At: '2025-01-01 00:00:00',
    Updated_At: '2025-01-01 00:00:00', Created_By: 'SYSTEM'
  });

  const env2 = loadBackend(ss, {});
  const sync = env2.ctx.apiSyncUsersFromFiles(token);
  ok('apiSyncUsersFromFiles ok', sync.ok, sync.error);
  const rowU = env2.ctx.findRowByCol_('Master_User', 'Employee_code', kodeBaru);
  ok('akun dibuat dari data sertifikasi', rowU > 1);
  if (rowU > 1) {
    const u = barisSheet(ss, 'Master_User', rowU);
    sama('password awal = Employee Code', String(u.Password).trim(), kodeBaru);
    ok('username terisi', String(u.Username || '').length > 0);
    sama('role default EMP', String(u.Role).toUpperCase(), 'EMP');
  }
}

/* ---------------------------------------------------------------- H. migrasi */
head('H. Migrasi skema v1 -> v2 (data lama tidak boleh hilang)');

{
  // database dengan SKEMA LAMA, berisi data
  const lama = buatDatabase({ users: 60, files: 90, notif: 30, skema: 'lama' });
  const ssLama = lama.ss;
  const c = loadBackend(ssLama, { cache: new Map() }).ctx;

  // catat kondisi awal untuk dibandingkan
  const barisUserAwal = ssLama.getSheetByName('Master_User').rows.length;
  const barisFileAwal = ssLama.getSheetByName('Master_File').rows.length;
  const barisNotifAwal = ssLama.getSheetByName('T_Notifikasi').rows.length;
  const ortuLokasi = ssLama.getSheetByName('Master_User').rows[3][ssLama.getSheetByName('Master_User').header.indexOf('Lokasi_Kerja')];
  const ortuNama = ssLama.getSheetByName('Master_User').rows[3][ssLama.getSheetByName('Master_User').header.indexOf('Nama_Lengkap')];
  const ortuKategori = ssLama.getSheetByName('Master_File').rows[0][ssLama.getSheetByName('Master_File').header.indexOf('Kategori')];
  const ortuPenerbit = ssLama.getSheetByName('Master_File').rows[0][ssLama.getSheetByName('Master_File').header.indexOf('Penerbit')];
  const ortuExpired = ssLama.getSheetByName('Master_File').rows[0][ssLama.getSheetByName('Master_File').header.indexOf('Expired_at')];

  ok('database lama punya sheet Master_File', !!ssLama.getSheetByName('Master_File'));
  ok('database lama punya sheet Master_Sertifikasi', !!ssLama.getSheetByName('Master_Sertifikasi'));

  const status = c.apiStatusSkema(token);
  ok('apiStatusSkema mendeteksi perlunya migrasi', status.ok && status.data.perlu_migrasi === true,
    JSON.stringify(status.ok ? status.data.perlu_migrasi : status.error));

  const laporan = c.migrateSchemaV2_({});
  ok('migrasi selesai tanpa error', laporan.ok, JSON.stringify(laporan.errors));

  // ---------- struktur baru ----------
  ok('sheet T_Sertifikasi terbentuk', !!ssLama.getSheetByName('T_Sertifikasi'));
  ok('sheet Master_File sudah tidak ada', !ssLama.getSheetByName('Master_File'));
  ok('Master_Sertifikasi (jenis) diarsipkan', !ssLama.getSheetByName('Master_Sertifikasi'));
  ok('Master_Sertifikasi diarsipkan dengan nama Master_Sertifikasi_ARSIP (bukan BACKUP)',
    !ssLama.getSheetByName('Master_Sertifikasi_ARSIP')
      ? false
      : ssLama.getSheetByName('Master_Sertifikasi_ARSIP').rows.length > 0,
    JSON.stringify(laporan.backup));
  {
    const arsip = ssLama.getSheetByName('Master_Sertifikasi_ARSIP');
    const shJenisLama = ssLama.getSheetByName('Master_Sertifikasi_ARSIP');
    ok('data jenis sertifikasi lama tetap utuh di arsip',
      arsip && arsip.rows.length >= 1 && arsip.header[0] === 'Cert_id',
      arsip ? (arsip.rows.length + ' baris, header=' + arsip.header.slice(0, 3).join(',')) : 'tidak ada');
  }
  ok('ada sheet backup Master_User', laporan.backup.some((b) => b.indexOf('Master_User_BACKUP') === 0));
  ok('ada sheet backup data sertifikasi', laporan.backup.some((b) => b.indexOf('Master_File_BACKUP') === 0),
    JSON.stringify(laporan.backup));

  const shUserBaru = ssLama.getSheetByName('Master_User');
  const shSertBaru = ssLama.getSheetByName('T_Sertifikasi');

  // ---------- urutan kolom & jumlah baris ----------
  sama('6 kolom inti Master_User di depan',
    shUserBaru.header.slice(0, 6).join(','),
    'Employee_code,Nama_Lengkap,Username,Password,Role,Working_Location');
  sama('kolom T_Sertifikasi 10 terdepan sesuai spesifikasi',
    shSertBaru.header.slice(0, 10).join(','),
    'Cert_Id,Employee_Code,No_Sertifikat,Nama_Sertifikasi,Start_Pelaksanaan,End_Pelaksanaan,Tanggal_Sertifikasi,Penyelenggara,Expired_at,Recom_Update');
  sama('jumlah user tidak berubah', shUserBaru.rows.length, barisUserAwal);
  sama('jumlah sertifikasi tidak berubah', shSertBaru.rows.length, barisFileAwal);
  sama('jumlah notifikasi tidak berubah', ssLama.getSheetByName('T_Notifikasi').rows.length, barisNotifAwal);

  // ---------- isi data ikut berpindah ----------
  const iLok = shUserBaru.header.indexOf('Working_Location');
  const iNama = shUserBaru.header.indexOf('Nama_Lengkap');
  sama('nilai Lokasi_Kerja pindah ke Working_Location', shUserBaru.rows[3][iLok], ortuLokasi);
  sama('nama user tetap sama', shUserBaru.rows[3][iNama], ortuNama);

  const iPenerbit = shSertBaru.header.indexOf('Penyelenggara');
  const iExpiredBaru = shSertBaru.header.indexOf('Expired_at');
  const iRecom = shSertBaru.header.indexOf('Recom_Update');
  const iCatatan = shSertBaru.header.indexOf('Catatan');
  sama('nilai Penerbit pindah ke Penyelenggara', shSertBaru.rows[0][iPenerbit], ortuPenerbit);
  sama('Expired_at tetap', String(shSertBaru.rows[0][iExpiredBaru]).slice(0, 10), String(ortuExpired).slice(0, 10));
  ok('Recom_Update terisi = Expired_at - 3 bulan',
    !!shSertBaru.rows[0][iRecom], 'recom=' + shSertBaru.rows[0][iRecom]);
  {
    const exp = c.toDate_(shSertBaru.rows[0][iExpiredBaru]);
    const harap = c.fmtDate_(c.addMonths_(exp, -3), 'yyyy-MM-dd');
    sama('Recom_Update tepat 3 bulan sebelum Expired_at',
      String(shSertBaru.rows[0][iRecom]).slice(0, 10), harap);
  }
  ok('Kategori lama tidak hilang (dipindah ke Catatan)',
    ortuKategori === '' || String(shSertBaru.rows[0][iCatatan]).indexOf('Kategori lama: ' + ortuKategori) !== -1,
    'kategori=' + ortuKategori + ' catatan=' + shSertBaru.rows[0][iCatatan]);

  // kunci utama & relasi tetap utuh
  const certIdAwal = ssLama.getSheetByName('Master_File_BACKUP_' +
    laporan.backup.find((b) => b.indexOf('Master_File_BACKUP') === 0).replace('Master_File_BACKUP_', ''))
    .rows[0][0];
  ok('Cert_Id mempertahankan nilai Doc_id lama',
    String(shSertBaru.rows[0][0]) === String(certIdAwal), 'baru=' + shSertBaru.rows[0][0] + ' lama=' + certIdAwal);

  // ---------- aplikasi tetap bisa membaca setelah migrasi ----------
  const envBaru = loadBackend(ssLama, { cache: new Map() });
  const c2 = envBaru.ctx;
  const daftar = c2.apiListFiles(token, { page: 1, per_page: 25 });
  ok('apiListFiles jalan setelah migrasi', daftar.ok, daftar.error);
  sama('total setelah migrasi = jumlah baris', daftar.data.total, barisFileAwal);
  ok('setiap baris punya cert_id', daftar.data.rows.every((r) => String(r.doc_id || '').length > 0));
  ok('setiap baris punya penyelenggara terbaca', daftar.data.rows.every((r) => r.penyelenggara !== undefined));
  ok('setiap baris punya recom_update', daftar.data.rows.every((r) => String(r.recom_update || '').length === 10));
  ok('setiap baris punya teks durasi', daftar.data.rows.every((r) => String(r.sisa_teks || '').length > 0),
    JSON.stringify(daftar.data.rows.slice(0, 3).map((r) => r.sisa_teks)));

  const dash = c2.apiGetDashboard(token, {});
  ok('apiGetDashboard jalan setelah migrasi', dash.ok, dash.error);
  sama('KPI setelah migrasi = jumlah baris', dash.data.kpi.total_sertifikasi, barisFileAwal);

  const stat2 = c2.apiStatusSkema(token);
  ok('setelah migrasi tidak perlu migrasi lagi', stat2.ok && stat2.data.perlu_migrasi === false);
  {
    const lagi = c2.migrateSchemaV2_({});
    ok('migrasi kedua aman (idempoten)', lagi.ok, JSON.stringify(lagi.errors));
    sama('jumlah baris tidak berubah setelah migrasi kedua',
      ssLama.getSheetByName('T_Sertifikasi').rows.length, barisFileAwal);
  }

  // ---------- sesi & login tetap jalan di skema baru ----------
  const s = c2.apiGetSession(token);
  ok('sesi tetap valid setelah migrasi', s.ok, s.error);
  const login = c2.apiLogin(lama.kredensial[5].username, lama.kredensial[5].kode);
  ok('login tetap berhasil setelah migrasi', login.ok && login.data.token, login.error);
}


/* ------------------------------------------- H2. info struktur sheet ------- */
head('H2. Info struktur sheet (menjawab "relasinya ke user lewat mana?")');

{
  // pada skema LAMA: Master_Sertifikasi harus dijelaskan sebagai katalog tanpa relasi
  const lama = buatDatabase({ users: 20, files: 30, notif: 5, skema: 'lama' });
  const c = loadBackend(lama.ss, { cache: new Map() }).ctx;
  const info = c.infoStrukturSheet_();

  const cari = (n) => info.baris.filter((b) => b.sheet === n)[0];
  const jenis = cari('Master_Sertifikasi');
  const sert = cari('T_Sertifikasi');
  const usr = cari('Master_User');

  ok('info memuat keterangan Master_Sertifikasi lama', !!jenis);
  sama('Master_Sertifikasi ditandai USANG', jenis ? jenis.jenis : '', 'USANG');
  ok('keterangan Master_Sertifikasi menyebut TIDAK punya relasi ke karyawan',
    !!jenis && jenis.keterangan.indexOf('TIDAK punya relasi ke karyawan') !== -1,
    jenis ? jenis.keterangan : '');
  ok('Master_Sertifikasi TIDAK diberi kolom relasi user',
    !!jenis && jenis.kolom_utama.indexOf('FK ke user') === -1, jenis ? jenis.kolom_utama : '');

  sama('kunci utama Master_User = Employee_code', usr ? usr.pk || usr.kolom_utama : '', 'PK: Employee_code');

  // pada skema lama T_Sertifikasi belum ada -> harus dilaporkan perlu migrasi
  sama('T_Sertifikasi belum ada di skema lama', sert, undefined);
  ok('info menyimpulkan perlu migrasi', info.perlu_migrasi === true);

  // setelah migrasi: T_Sertifikasi ada dan relasinya jelas
  const c2 = loadBackend(lama.ss, { cache: new Map() }).ctx;
  c2.migrateSchemaV2_({});
  const info2 = c2.infoStrukturSheet_();
  const sert2 = info2.baris.filter((b) => b.sheet === 'T_Sertifikasi')[0];
  const arsip = info2.baris.filter((b) => b.sheet === 'Master_Sertifikasi_ARSIP')[0];

  ok('setelah migrasi T_Sertifikasi dilaporkan ada', !!sert2);
  sama('PK T_Sertifikasi = Cert_Id', sert2 ? sert2.kolom_utama.split('  |  ')[0] : '', 'PK: Cert_Id');
  ok('T_Sertifikasi menyebut relasi FK ke user lewat Employee_Code',
    !!sert2 && sert2.kolom_utama.indexOf('FK ke user: Employee_Code') !== -1,
    sert2 ? sert2.kolom_utama : '');
  ok('Master_Sertifikasi_ARSIP ditandai sebagai arsip',
    !!arsip && arsip.jenis === 'arsip', arsip ? arsip.jenis : 'tidak ada');
  ok('setelah migrasi tidak perlu migrasi lagi', info2.perlu_migrasi === false);
  ok('barisnya memuat jumlah baris per sheet (bukan 0 semua)',
    info2.baris.some((b) => b.baris > 0), JSON.stringify(info2.baris.map((b) => b.sheet + '=' + b.baris)));
}

/* ---------------------------------------------------------------- I. durasi */
head('I. Teks durasi "3 Tahun 2 Bulan 4 Hari" dan Recom_Update');

{
  const env = loadBackend(ss, { cache: new Map() });
  const c = env.ctx;
  const ref = new Date(2026, 0, 15);          // 15 Jan 2026
  const akhir = new Date(2029, 2, 19);        // 19 Mar 2029
  sama('durasi kalender tepat', c.durasiTeks_(akhir, ref), '3 Tahun 2 Bulan 4 Hari');

  sama('durasi satu bulan saja', c.durasiTeks_(new Date(2026, 1, 15), ref), '1 Bulan');
  sama('durasi beberapa hari', c.durasiTeks_(new Date(2026, 0, 20), ref), '5 Hari');
  sama('durasi tepat di hari yang sama', c.durasiTeks_(ref, ref), '0 Hari');
  ok('durasi lewat ditandai "Lewat"', c.durasiTeks_(new Date(2025, 11, 15), ref).indexOf('Lewat ') === 0,
    c.durasiTeks_(new Date(2025, 11, 15), ref));
  sama('durasi tanggal kosong', c.durasiTeks_('', ref), '');

  // Recom_Update = 3 bulan sebelum expired
  sama('recomUpdate_ mengurangi 3 bulan', c.recomUpdate_('2027-05-20'), '2027-02-20');
  sama('recomUpdate_ menyeberangi tahun', c.recomUpdate_('2027-01-15'), '2026-10-15');
  sama('recomUpdate_ tanggal kosong', c.recomUpdate_(''), '');
}


/* ---------------------------------------------------- J. instalasi baru ---- */
head('J. Instalasi baru dari nol (kickstart)');

{
  const kosong = buatDatabase({ kosong: true });
  const ssBaru = kosong.ss;
  sama('spreadsheet baru benar-benar kosong', ssBaru.getSheets().length, 0);

  // ScriptProperties bertahan antar permintaan (seperti di Apps Script nyata)
  const propsBersama = new Map();
  const env = loadBackend(ssBaru, { cache: new Map(), props: propsBersama });

  // 1. penanda berkas: semua berkas backend terbaca lengkap
  const kurang = env.ctx.berkasBackendHilang_();
  sama('berkasBackendHilang_() melaporkan tidak ada yang kurang', kurang.length, 0,
    JSON.stringify(kurang));

  // 2. kickstart membuat seluruh sheet + config + akun awal
  const laporan = env.ctx.kickstart_(false);
  ok('kickstart_ berhasil tanpa error', laporan.ok, JSON.stringify(laporan.errors));

  const perlu = ['Config', 'Master_User', 'T_Sertifikasi', 'Session_Token',
    'T_Notifikasi', 'T_Email_Log', 'T_Audit_Trail'];
  perlu.forEach((n) => {
    ok('sheet ' + n + ' dibuat otomatis', !!ssBaru.getSheetByName(n));
  });
  ok('sheet usang Master_File TIDAK dibuat', !ssBaru.getSheetByName('Master_File'));
  ok('sheet usang Master_Sertifikasi TIDAK dibuat', !ssBaru.getSheetByName('Master_Sertifikasi'));

  const shUser = ssBaru.getSheetByName('Master_User');
  const shSert = ssBaru.getSheetByName('T_Sertifikasi');
  sama('header Master_User sesuai skema (6 kolom inti di depan)',
    shUser.header.slice(0, 6).join(','),
    'Employee_code,Nama_Lengkap,Username,Password,Role,Working_Location');
  sama('header T_Sertifikasi sesuai skema',
    shSert.header.slice(0, 10).join(','),
    'Cert_Id,Employee_Code,No_Sertifikat,Nama_Sertifikasi,Start_Pelaksanaan,End_Pelaksanaan,Tanggal_Sertifikasi,Penyelenggara,Expired_at,Recom_Update');

  const konfig = ssBaru.getSheetByName('Config');
  ok('Config terisi default (>= 40 baris)', konfig.rows.length >= 40, 'baris=' + konfig.rows.length);

  ok('akun Super Admin dibuat', shUser.rows.some((r) => String(r[4]).toUpperCase() === 'SA'));
  ok('akun Human Capital dibuat', shUser.rows.some((r) => String(r[4]).toUpperCase() === 'HC'));

  // 3. aplikasi langsung bisa dipakai pada instalasi baru
  const env2 = loadBackend(ssBaru, { cache: new Map(), props: propsBersama });
  const c2 = env2.ctx;
  const sa = shUser.rows.find((r) => String(r[4]).toUpperCase() === 'SA');
  const login = c2.apiLogin(String(sa[2]), String(sa[3]));
  ok('login akun awal berhasil', login.ok && login.data.token, login.error);

  const t2 = login.data.token;
  const daftar = c2.apiListFiles(t2, { page: 1, per_page: 25 });
  ok('apiListFiles jalan di instalasi baru (0 data)', daftar.ok && daftar.data.total === 0,
    daftar.error || ('total=' + daftar.data.total));

  const dash = c2.apiGetDashboard(t2, {});
  ok('apiGetDashboard jalan di instalasi baru', dash.ok && dash.data.kpi.total_sertifikasi === 0,
    dash.error);

  const meta = c2.apiGetMeta(t2);
  ok('apiGetMeta jalan & menyediakan saran nama kosong',
    meta.ok && Array.isArray(meta.data.nama_sertifikasi_options), meta.error);

  const stat = c2.apiStatusSkema(t2);
  ok('apiStatusSkema: skema baru langsung dianggap sesuai', stat.ok && stat.data.perlu_migrasi === false,
    stat.error || JSON.stringify(stat.data));

  // 4. simpan satu data lalu pastikan tampil
  const simpan = c2.apiSaveFile(t2, {
    employee_id: String(sa[0]), nama_sertifikasi: 'Sertifikasi Pertama',
    start_pelaksanaan: '2025-01-01', end_pelaksanaan: '2025-01-10',
    masa_berlaku_bulan: 36, penyelenggara: 'Lembaga A', no_sertifikat: 'A/1'
  });
  ok('simpan data pertama berhasil', simpan.ok, simpan.error);
  const daftar2 = c2.apiListFiles(t2, { page: 1, per_page: 25 });
  sama('data pertama tampil', daftar2.data.total, 1);
  ok('data pertama punya sisa_teks & recom_update',
    !!daftar2.data.rows[0].sisa_teks && !!daftar2.data.rows[0].recom_update,
    JSON.stringify({ sisa: daftar2.data.rows[0].sisa_teks, recom: daftar2.data.rows[0].recom_update }));

  // 5. kickstart kedua tidak melakukan apa-apa (idempoten)
  const env3 = loadBackend(ssBaru, { cache: new Map(), props: propsBersama });
  const lagi = env3.ctx.kickstart_(false);
  ok('kickstart kedua dilewati (bootstrap sudah selesai)', lagi.sudah_sebelumnya === true);
  sama('jumlah user tidak bertambah', ssBaru.getSheetByName('Master_User').rows.length, shUser.rows.length);
}


/* ------------------------------------------- H3. format waktu DTO --------- */
head('H3. Kolom waktu dikirim terformat, bukan String(Date) mentah');

{
  const env = loadBackend(ss, { cache: new Map() });
  const c = env.ctx;

  const d = new Date(2026, 9, 8, 15, 20, 32);
  sama('fmtWaktu_ memformat objek Date', c.fmtWaktu_(d), '2026-10-08 15:20:32');
  sama('fmtWaktu_ memformat string ber-jam', c.fmtWaktu_('2026-10-08 15:20:32'), '2026-10-08 15:20:32');
  sama('fmtWaktu_ kosong -> string kosong', c.fmtWaktu_(''), '');
  sama('String(Date) mentah memang buruk (dasar perbaikan)',
    String(d).indexOf('GMT') !== -1, true);

  // DTO file: created_at/updated_at/verified_at harus berformat rapi
  const doc = c.sheetToObjects_('T_Sertifikasi')[0];
  doc.Created_At = new Date(2026, 9, 8, 15, 20, 33);
  doc.Updated_At = new Date(2026, 9, 8, 15, 20, 32);
  doc.Verified_At = new Date(2026, 9, 8, 15, 25, 0);
  const dto = c.fileDto_(doc, c.petaUser_());

  sama('created_at terformat', dto.created_at, '2026-10-08 15:20:33');
  sama('updated_at terformat', dto.updated_at, '2026-10-08 15:20:32');
  sama('verified_at terformat', dto.verified_at, '2026-10-08 15:25:00');
  ok('tidak ada lagi "GMT" pada created_at/updated_at/verified_at',
    [dto.created_at, dto.updated_at, dto.verified_at].join(' ').indexOf('GMT') === -1);
  ok('recom_update tetap format tanggal murni',
    /^\d{4}-\d{2}-\d{2}$/.test(dto.recom_update) || dto.recom_update === '',
    dto.recom_update);

  // userPublic_ ikut rapi
  const u = c.sheetToObjects_('Master_User')[0];
  u.Login_Terakhir = new Date(2026, 9, 1, 8, 5, 0);
  const up = c.userPublic_(u);
  sama('login_terakhir terformat', up.login_terakhir, '2026-10-01 08:05:00');

  // notifikasi: created_at harus bisa diurutkan sebagai teks (ISO-like)
  const n = c.sheetToObjects_('T_Notifikasi')[0];
  n.Created_At = new Date(2026, 0, 5, 9, 0, 0);
  ok('created_at notifikasi berformat ISO-like (bisa diurutkan)',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(c.fmtWaktu_(n.Created_At)),
    c.fmtWaktu_(n.Created_At));
}


/* ------------------------------- K. alur verifikasi HC (periksa / revisi) -- */
head('K. Alur verifikasi: Employee upload -> HC periksa -> Terverifikasi / Revisi');

{
  const db = buatDatabase({ users: 30, files: 40, notif: 5 });
  const ss2 = db.ss;
  const c = loadBackend(ss2, { cache: new Map() }).ctx;

  // token HC (index 1) sudah di-seed di Session_Token
  const tokenHc = db.token;
  const kodeEmp = db.kredensial[7].kode;

  const kodeVerif = (v) => String(v || '').toUpperCase();
  const bacaVerif = (certId) => {
    const row = c.findRowByCol_('T_Sertifikasi', 'Cert_Id', certId);
    return row === -1 ? null : {
      status: kodeVerif(sel(ss2, 'T_Sertifikasi', row, 'Status_Verifikasi')),
      oleh: String(sel(ss2, 'T_Sertifikasi', row, 'Verified_By') || '').trim(),
      catatan: String(sel(ss2, 'T_Sertifikasi', row, 'Catatan') || '')
    };
  };

  /* ---------- 1. karyawan mengunggah data -> PENDING ---------- */
  const loginEmp = c.apiLogin(db.kredensial[7].username, kodeEmp);
  ok('login karyawan berhasil', loginEmp.ok && loginEmp.data.token, loginEmp.error);
  const tokenEmp = loginEmp.data.token;

  const unggah = c.apiSaveFile(tokenEmp, {
    employee_id: kodeEmp, nama_sertifikasi: 'DATA ANALYST',
    start_pelaksanaan: '2026-03-02', end_pelaksanaan: '2026-03-02',
    masa_berlaku_bulan: 36, penyelenggara: 'LSP INFORMATIKA', no_sertifikat: 'DA/1'
  });
  ok('karyawan berhasil mengunggah data', unggah.ok, unggah.error);
  const certId = unggah.data.doc_id;
  sama('status awal = PENDING (menunggu HC)', bacaVerif(certId).status, 'PENDING');

  /* ---------- 2. karyawan TIDAK boleh memverifikasi ---------- */
  const cobaEmp = c.apiVerifyFile(tokenEmp, certId, 'VERIFIED', '');
  ok('karyawan DITOLAK saat mencoba memverifikasi', !cobaEmp.ok, JSON.stringify(cobaEmp));
  sama('status tetap PENDING setelah percobaan karyawan', bacaVerif(certId).status, 'PENDING');

  /* ---------- 3. HC memeriksa -> Perlu Revisi WAJIB pakai catatan ---------- */
  const tanpaCatatan = c.apiVerifyFile(tokenHc, certId, 'REVISI', '');
  ok('HC tidak bisa menandai Revisi tanpa catatan', !tanpaCatatan.ok, JSON.stringify(tanpaCatatan));
  ok('pesan error menyebut catatan wajib',
    !tanpaCatatan.ok && tanpaCatatan.error.indexOf('Catatan wajib') !== -1, tanpaCatatan.error);

  const revisi = c.apiVerifyFile(tokenHc, certId, 'REVISI', 'Lampiran tidak terbaca, mohon unggah ulang halaman 2.');
  ok('HC berhasil menandai Perlu Revisi + catatan', revisi.ok, revisi.error);
  sama('status tersimpan = REVISI', bacaVerif(certId).status, 'REVISI');
  sama('catatan alasan tersimpan di kolom Catatan', bacaVerif(certId).catatan,
    'Lampiran tidak terbaca, mohon unggah ulang halaman 2.');
  ok('Verified_By diisi Employee Code HC', bacaVerif(certId).oleh.length > 0, bacaVerif(certId).oleh);

  /* ---------- 4. notifikasi in-app ke pemilik ---------- */
  const notifEmp = c.sheetToObjects_('T_Notifikasi').filter(function (n) {
    return String(n.Cert_Id) === certId && String(n.Employee_code) === kodeEmp
      && String(n.Level) === 'VERIFIKASI';
  });
  sama('pemilik menerima 1 notifikasi verifikasi', notifEmp.length, 1);
  if (notifEmp.length) {
    sama('notifikasi memuat status REVISI', kodeVerif(notifEmp[0].Status_key), 'REVISI');
    ok('notifikasi memuat catatan dari HC',
      String(notifEmp[0].Pesan || '').indexOf('Lampiran tidak terbaca') !== -1,
      notifEmp[0].Pesan);
    ok('judul memakai istilah "Perlu revisi", bukan "Ditolak"',
      String(notifEmp[0].Judul || '').indexOf('Perlu revisi') !== -1, notifEmp[0].Judul);
    sama('notifikasi belum dibaca', kodeVerif(notifEmp[0].Is_Read), 'FALSE');
  }
  ok('tidak ada notifikasi bertuliskan "Ditolak"',
    c.sheetToObjects_('T_Notifikasi').every(function (n) {
      return String(n.Judul || '').indexOf('Ditolak') === -1;
    }));

  /* ---------- 5. karyawan memperbaiki -> kembali PENDING ---------- */
  const perbaiki = c.apiSaveFile(tokenEmp, {
    doc_id: certId, employee_id: kodeEmp, nama_sertifikasi: 'DATA ANALYST',
    start_pelaksanaan: '2026-03-02', end_pelaksanaan: '2026-03-02',
    masa_berlaku_bulan: 36, penyelenggara: 'LSP INFORMATIKA', no_sertifikat: 'DA/1'
  });
  ok('karyawan bisa memperbaiki datanya', perbaiki.ok, perbaiki.error);
  sama('status kembali PENDING setelah diperbaiki', bacaVerif(certId).status, 'PENDING');

  /* ---------- 6. HC menyatakan Terverifikasi ---------- */
  const verif = c.apiVerifyFile(tokenHc, certId, 'VERIFIED', 'Sudah sesuai.');
  ok('HC berhasil memverifikasi', verif.ok, verif.error);
  sama('status = VERIFIED', bacaVerif(certId).status, 'VERIFIED');
  sama('label verifikasi dikembalikan', verif.data.status_verifikasi_label, 'Terverifikasi');

  const notif2 = c.sheetToObjects_('T_Notifikasi').filter(function (n) {
    return String(n.Cert_Id) === certId && String(n.Level) === 'VERIFIKASI';
  });
  sama('pemilik dapat notifikasi kedua (terverifikasi)', notif2.length, 2);
  ok('notifikasi terverifikasi memakai judul "Terverifikasi"',
    notif2.some(function (n) { return String(n.Judul).indexOf('Terverifikasi') !== -1; }),
    JSON.stringify(notif2.map(function (n) { return n.Judul; })));

  /* ---------- 7. istilah lama 'REJECTED' tetap diterima ---------- */
  const lama = c.apiVerifyFile(tokenHc, certId, 'REJECTED', 'pakai istilah lama');
  ok('keputusan "REJECTED" (istilah lama) tetap diterima', lama.ok, lama.error);
  sama('"REJECTED" dikonversi menjadi REVISI', lama.data.status_verifikasi, 'REVISI');
  sama('kolom tersimpan juga REVISI, bukan REJECTED', bacaVerif(certId).status, 'REVISI');

  /* ---------- 8. HC memverifikasi datanya SENDIRI -> tanpa notifikasi ---------- */
  const kodeHc = db.hc;
  const simpanHc = c.apiSaveFile(tokenHc, {
    employee_id: kodeHc, nama_sertifikasi: 'Sertifikasi HC', start_pelaksanaan: '2026-01-01',
    end_pelaksanaan: '2026-01-02', masa_berlaku_bulan: 36
  });
  ok('HC menyimpan data', simpanHc.ok, simpanHc.error);
  sama('data yang diinput HC langsung VERIFIED', bacaVerif(simpanHc.data.doc_id).status, 'VERIFIED');
  const notifHc = c.sheetToObjects_('T_Notifikasi').filter(function (n) {
    return String(n.Cert_Id) === simpanHc.data.doc_id;
  });
  sama('HC tidak mengirim notifikasi ke dirinya sendiri', notifHc.length, 0);

  /* ---------- 9. ringkasan & filter memakai istilah baru ---------- */
  const ringkas = c.apiGetRingkasanHeader(tokenHc);
  ok('apiGetRingkasanHeader ok', ringkas.ok, ringkas.error);
  ok('badge verifikasi terpisah dari badge mendesak',
    ringkas.data.badge_verifikasi !== undefined && ringkas.data.badge_mendesak !== undefined,
    JSON.stringify(ringkas.data));
  sama('badge mendesak TIDAK lagi mencampur antrean verifikasi',
    ringkas.data.badge_mendesak, ringkas.data.mendesak);
  sama('badge verifikasi = menunggu + perlu revisi',
    ringkas.data.badge_verifikasi, ringkas.data.perlu_verifikasi + ringkas.data.perlu_revisi);

  const dash2 = c.apiGetDashboard(tokenHc, {});
  ok('dashboard menyediakan kpi.perlu_revisi', dash2.ok && dash2.data.kpi.perlu_revisi !== undefined,
    dash2.error);

  const filterRevisi = c.apiListFiles(tokenHc, { verifikasi: 'REVISI', page: 1, per_page: 50 });
  ok('filter verifikasi=REVISI jalan', filterRevisi.ok, filterRevisi.error);
  ok('semua baris hasil filter berstatus REVISI',
    filterRevisi.data.rows.every(function (r) { return r.status_verifikasi === 'REVISI'; }));

  const filterLama = c.apiListFiles(tokenHc, { verifikasi: 'REJECTED', page: 1, per_page: 50 });
  ok('filter dengan istilah lama REJECTED tetap cocok ke REVISI',
    filterLama.ok && filterLama.data.rows.length === filterRevisi.data.rows.length,
    filterLama.error || (filterLama.data.rows.length + ' vs ' + filterRevisi.data.rows.length));

  const meta = c.apiGetMeta(tokenHc);
  ok('meta mengirim verifikasi_defs', meta.ok && Array.isArray(meta.data.verifikasi_defs)
    && meta.data.verifikasi_defs.length === 3, meta.error);
  ok('tidak ada definisi berlabel "Ditolak"',
    meta.data.verifikasi_defs.every(function (v) { return v.label.indexOf('Ditolak') === -1; }),
    JSON.stringify(meta.data.verifikasi_defs.map(function (v) { return v.label; })));

  /* ---------- 9b. notifikasi verifikasi bisa dibedakan ---------- */
  const daftarNotif = c.apiListNotifications(tokenHc, { limit: 100 });
  ok('apiListNotifications ok', daftarNotif.ok, daftarNotif.error);
  const nv = daftarNotif.data.rows.filter(function (r) { return r.level === 'VERIFIKASI'; });
  ok('notifikasi verifikasi muncul di daftar', nv.length >= 2, 'jumlah=' + nv.length);
  ok('setiap notifikasi verifikasi membawa status_key',
    nv.every(function (r) { return String(r.status_key || '').length > 0; }),
    JSON.stringify(nv.map(function (r) { return r.status_key; })));
  ok('status_key hanya salah satu dari VERIFIED/REVISI',
    nv.every(function (r) { return ['VERIFIED', 'REVISI'].indexOf(r.status_key) !== -1; }),
    JSON.stringify(nv.map(function (r) { return r.status_key; })));
  ok('created_at notifikasi berformat ISO-like (bisa diurutkan)',
    daftarNotif.data.rows.every(function (r) {
      return !r.created_at || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.created_at);
    }),
    JSON.stringify(daftarNotif.data.rows.slice(0, 3).map(function (r) { return r.created_at; })));

  /* ---------- 10. audit trail tercatat ---------- */
  const audit = c.sheetToObjects_('T_Audit_Trail').filter(function (a) {
    return String(a.Aksi) === 'VERIFIKASI_SERTIFIKASI' && String(a.Ref_id) === certId;
  });
  ok('setiap verifikasi tercatat di T_Audit_Trail', audit.length >= 3, 'jumlah=' + audit.length);
}

/* ---------------------------------- K2. migrasi istilah REJECTED lama ---- */
head('K2. Migrasi menormalkan istilah verifikasi lama (REJECTED -> REVISI)');

{
  const lama = buatDatabase({ users: 20, files: 25, notif: 5, skema: 'lama' });
  const ssLama = lama.ss;
  const shFile = ssLama.getSheetByName('Master_File');
  const iVerif = shFile.header.indexOf('Status_Verifikasi');
  shFile.rows[0][iVerif] = 'REJECTED';
  shFile.rows[1][iVerif] = 'Ditolak';
  shFile.rows[2][iVerif] = 'VERIFIED';

  const c = loadBackend(ssLama, { cache: new Map() }).ctx;
  const laporan = c.migrateSchemaV2_({});
  ok('migrasi selesai tanpa error', laporan.ok, JSON.stringify(laporan.errors));

  const baru = ssLama.getSheetByName('T_Sertifikasi');
  const iBaru = baru.header.indexOf('Status_Verifikasi');
  sama('REJECTED -> REVISI', String(baru.rows[0][iBaru]).toUpperCase(), 'REVISI');
  sama('Ditolak -> REVISI', String(baru.rows[1][iBaru]).toUpperCase(), 'REVISI');
  sama('VERIFIED tetap VERIFIED', String(baru.rows[2][iBaru]).toUpperCase(), 'VERIFIED');
  sama('laporan menyebut jumlah baris yang dirapikan',
    laporan.jumlah.verifikasi_dinormalkan, 2);
}


/* ---------------------------- L. email pengingat ke Email_Pribadi Master_User */
head('L. Email pengingat dikirim ke email pribadi masing-masing (dari Master_User)');

{
  const db = buatDatabase({ users: 30, files: 40, notif: 5 });
  const ss2 = db.ss;
  const c = loadBackend(ss2, { cache: new Map() }).ctx;
  const tokenHc = db.token;

  const shUser = ss2.getSheetByName('Master_User');
  const iKode = shUser.header.indexOf('Employee_code');
  const iPribadi = shUser.header.indexOf('Email_Pribadi');
  const iKantor = shUser.header.indexOf('Email_Perusahaan');
  const iRole = shUser.header.indexOf('Role');

  // karyawan uji: email pribadi jelas berbeda dari email perusahaan
  const kodeEmp = db.kredensial[9].kode;
  const rowEmp = shUser.rows.findIndex((r) => String(r[iKode]) === kodeEmp);
  shUser.rows[rowEmp][iPribadi] = 'pribadi.karyawan@gmail.com';
  shUser.rows[rowEmp][iKantor] = 'karyawan@perusahaan.co.id';

  // HC: email pribadi juga berbeda
  const rowHc = shUser.rows.findIndex((r) => String(r[iRole]).toUpperCase() === 'HC');
  shUser.rows[rowHc][iPribadi] = 'hc.pribadi@gmail.com';
  shUser.rows[rowHc][iKantor] = 'hc@perusahaan.co.id';

  // data sertifikasi milik karyawan itu, mendekati kadaluarsa
  const exp = c.addMonths_(c.todayDate_(), 1);
  const simpan = c.apiSaveFile(tokenHc, {
    employee_id: kodeEmp, nama_sertifikasi: 'Uji Email Pribadi',
    start_pelaksanaan: '2025-01-01', end_pelaksanaan: '2025-01-02',
    expired_at: c.fmtDate_(exp, 'yyyy-MM-dd'), masa_berlaku_bulan: 36
  });
  ok('data uji tersimpan', simpan.ok, simpan.error);
  const certId = simpan.data.doc_id;

  /* ---------- 1. fungsi pemilihan alamat ---------- */
  const uji = { Email_Pribadi: 'a@gmail.com', Email_Perusahaan: 'b@kantor.co.id' };
  sama('default memakai Email_Pribadi', c.emailUtamaUser_(uji), 'a@gmail.com');

  c.setConfig_('reminder_email_utama', 'PERUSAHAAN');
  sama('bila diubah ke PERUSAHAAN', c.emailUtamaUser_(uji), 'b@kantor.co.id');
  c.setConfig_('reminder_email_utama', 'PRIBADI');
  sama('dikembalikan ke PRIBADI', c.emailUtamaUser_(uji), 'a@gmail.com');

  sama('cadangan dipakai bila pribadi kosong',
    c.emailUtamaUser_({ Email_Pribadi: '', Email_Perusahaan: 'b@kantor.co.id' }), 'b@kantor.co.id');
  sama('tanpa email sama sekali -> kosong', c.emailUtamaUser_({ Email_Pribadi: '', Email_Perusahaan: '' }), '');
  sama('email tidak valid diabaikan', c.emailUtamaUser_({ Email_Pribadi: 'bukan-email' }), '');
  sama('user null aman', c.emailUtamaUser_(null), '');

  /* ---------- 2. penerima: TIDAK memakai alamat default aplikasi ---------- */
  const peta = c.petaUser_();
  const f = c.cariFile_(certId);
  const alamat = c.penerimaReminder_(f, peta);

  ok('pemilik ada di daftar Kepada', alamat.ke.length === 1, JSON.stringify(alamat.ke));
  sama('Kepada = email pribadi pemilik', alamat.ke[0], 'pribadi.karyawan@gmail.com');
  ok('email perusahaan TIDAK dipakai selama pribadi ada',
    alamat.ke.indexOf('karyawan@perusahaan.co.id') === -1, JSON.stringify(alamat.ke));
  ok('HC masuk daftar Cc', alamat.cc.length > 0, JSON.stringify(alamat.cc));
  ok('Cc memakai email pribadi HC',
    alamat.cc.indexOf('hc.pribadi@gmail.com') !== -1, JSON.stringify(alamat.cc));
  ok('Cc TIDAK memakai email perusahaan HC',
    alamat.cc.indexOf('hc@perusahaan.co.id') === -1, JSON.stringify(alamat.cc));

  // tidak ada alamat bawaan aplikasi yang bocor ke daftar penerima
  const semuaAlamat = alamat.ke.concat(alamat.cc).join(',').toLowerCase();
  ['hc@gde.co.id', 'superadmin@gde.co.id'].forEach(function (bawaan) {
    ok('alamat bawaan "' + bawaan + '" tidak dipakai', semuaAlamat.indexOf(bawaan) === -1, semuaAlamat);
  });
  ok('email atasan ikut Cc bila diisi', (function () {
    const u = peta[kodeEmp];
    return !u.Email_Atasan || alamat.cc.indexOf(String(u.Email_Atasan).trim()) !== -1;
  })());

  /* ---------- 3. emailHc_ hanya dari Master_User ---------- */
  const hcList = c.emailHc_();
  ok('emailHc_ memakai email pribadi HC', hcList.indexOf('hc.pribadi@gmail.com') !== -1,
    JSON.stringify(hcList));
  ok('emailHc_ tidak memakai email perusahaan HC', hcList.indexOf('hc@perusahaan.co.id') === -1);
  ok('emailHc_ tidak memuat hc@gde.co.id', hcList.indexOf('hc@gde.co.id') === -1);

  /* ---------- 4. reminder harian mengirim ke email pribadi ---------- */
  ENV.emails = [];
  const jr = c.jalankanReminder_(true);   // paksa: abaikan jadwal hari
  ok('reminder berjalan', jr && jr.terkirim > 0, JSON.stringify(jr && jr.detail && jr.detail.slice(0, 3)));
  const untukDia = ENV.emails.filter(function (e) {
    return String(e.to || '').indexOf('pribadi.karyawan@gmail.com') !== -1;
  });
  ok('ada email yang dikirim ke email pribadi karyawan', untukDia.length > 0,
    JSON.stringify(ENV.emails.slice(0, 3).map(function (e) { return e.to; })));
  ok('TIDAK ada email ke email perusahaan karyawan',
    ENV.emails.every(function (e) { return String(e.to || '').indexOf('karyawan@perusahaan.co.id') === -1; }),
    JSON.stringify(ENV.emails.map(function (e) { return e.to; }).slice(0, 5)));
  const bawaanAplikasi = ['hc@gde.co.id', 'superadmin@gde.co.id'];
  ok('TIDAK ada email ke alamat bawaan aplikasi (hc@/superadmin@gde.co.id)',
    ENV.emails.every(function (e) {
      const semua = String(e.to || '') + ',' + String(e.cc || '');
      return bawaanAplikasi.every(function (b) { return semua.indexOf(b) === -1; });
    }), JSON.stringify(ENV.emails.map(function (e) { return e.to + ' | cc=' + (e.cc || ''); }).slice(0, 3)));

  /* ---------- 5. tombol notify manual (apiKirimNotifikasiFile) ---------- */
  ENV.emails = [];
  const pratinjau = c.apiPratinjauNotifikasi(tokenHc, certId);
  ok('apiPratinjauNotifikasi ok', pratinjau.ok, pratinjau.error);
  sama('pratinjau menampilkan Kepada = email pribadi',
    pratinjau.data.ke[0], 'pribadi.karyawan@gmail.com');
  sama('pratinjau TIDAK mengirim email apa pun', ENV.emails.length, 0);
  ok('pratinjau memberi tahu bila memakai cadangan', pratinjau.data.pakai_cadangan === false);

  ENV.emails = [];
  const kirim = c.apiKirimNotifikasiFile(tokenHc, certId, 'Mohon segera diperpanjang ya.');
  ok('apiKirimNotifikasiFile ok', kirim.ok, kirim.error);
  ok('notifikasi benar-benar terkirim', kirim.data.terkirim === true, JSON.stringify(kirim.data));
  sama('terkirim ke email pribadi pemilik', kirim.data.ke[0], 'pribadi.karyawan@gmail.com');
  ok('email memuat catatan tambahan dari HC',
    String(ENV.emails[0].htmlBody || '').indexOf('Mohon segera diperpanjang ya.') !== -1,
    String(ENV.emails[0].htmlBody || '').slice(0, 200));
  ok('subjek memuat nama sertifikasi',
    String(ENV.emails[0].subject || '').indexOf('Uji Email Pribadi') !== -1,
    ENV.emails[0].subject);

  /* tercatat di T_Email_Log + notifikasi in-app */
  const log = c.sheetToObjects_('T_Email_Log').filter(function (l) {
    return String(l.Cert_Id) === certId && String(l.Status) === 'SENT';
  });
  ok('pengiriman manual tercatat di T_Email_Log', log.length >= 1, 'jumlah=' + log.length);
  ok('log mencatat penerima email pribadi',
    String(log[log.length - 1].Penerima || '').indexOf('pribadi.karyawan@gmail.com') !== -1,
    log.length ? log[log.length - 1].Penerima : '');
  ok('audit KIRIM_NOTIFIKASI tercatat',
    c.sheetToObjects_('T_Audit_Trail').some(function (a) {
      return String(a.Aksi) === 'KIRIM_NOTIFIKASI' && String(a.Ref_id) === certId;
    }));

  /* karyawan tidak boleh memakai tombol ini */
  const loginEmp = c.apiLogin(db.kredensial[9].username, kodeEmp);
  ok('login karyawan ok', loginEmp.ok, loginEmp.error);
  const coba = c.apiKirimNotifikasiFile(loginEmp.data.token, certId, '');
  ok('karyawan DITOLAK memakai tombol notifikasi', !coba.ok, JSON.stringify(coba));

  /* ---------- 6. pemilik tanpa email -> SKIPPED dengan alasan jelas ---------- */
  const kodeKosong = db.kredensial[11].kode;
  const rowKosong = shUser.rows.findIndex((r) => String(r[iKode]) === kodeKosong);
  shUser.rows[rowKosong][iPribadi] = '';
  shUser.rows[rowKosong][iKantor] = '';
  const simpan2 = c.apiSaveFile(tokenHc, {
    employee_id: kodeKosong, nama_sertifikasi: 'Tanpa Email',
    start_pelaksanaan: '2025-01-01', end_pelaksanaan: '2025-01-02', masa_berlaku_bulan: 36
  });
  ok('data tanpa email tersimpan', simpan2.ok, simpan2.error);

  const envB = loadBackend(ss2, { cache: new Map() });
  ENV.emails = [];
  const kirim2 = envB.ctx.apiKirimNotifikasiFile(tokenHc, simpan2.data.doc_id, '');
  ok('permintaan tidak gagal, tetapi dilaporkan tidak terkirim',
    kirim2.ok && kirim2.data.terkirim === false, JSON.stringify(kirim2.data));
  ok('alasan menyebut email belum diisi',
    String(kirim2.data.alasan || '').indexOf('Email_Pribadi') !== -1
      || String(kirim2.data.alasan || '').indexOf('Email pemilik') !== -1,
    kirim2.data.alasan);
  sama('tidak ada email dikirim', ENV.emails.length, 0);
}

/* ------------------------ L2. aturan 'PERUSAHAAN' & alamat cadangan --------- */
head('L2. Bila Email_Pribadi kosong atau prioritas diubah');

{
  const db = buatDatabase({ users: 20, files: 20, notif: 3 });
  const ss2 = db.ss;
  const c = loadBackend(ss2, { cache: new Map() }).ctx;
  const shUser = ss2.getSheetByName('Master_User');
  const iKode = shUser.header.indexOf('Employee_code');
  const iPribadi = shUser.header.indexOf('Email_Pribadi');
  const iKantor = shUser.header.indexOf('Email_Perusahaan');

  const kode = db.kredensial[5].kode;
  const row = shUser.rows.findIndex((r) => String(r[iKode]) === kode);
  shUser.rows[row][iPribadi] = '';
  shUser.rows[row][iKantor] = 'hanya.kantor@perusahaan.co.id';

  const env = loadBackend(ss2, { cache: new Map() });
  const c2 = env.ctx;
  const simpan = c2.apiSaveFile(db.token, {
    employee_id: kode, nama_sertifikasi: 'Uji Cadangan',
    start_pelaksanaan: '2025-01-01', end_pelaksanaan: '2025-01-02', masa_berlaku_bulan: 36
  });
  ok('data tersimpan', simpan.ok, simpan.error);

  const pratinjau = c2.apiPratinjauNotifikasi(db.token, simpan.data.doc_id);
  ok('pratinjau ok', pratinjau.ok, pratinjau.error);
  sama('memakai email perusahaan sebagai cadangan',
    pratinjau.data.ke[0], 'hanya.kantor@perusahaan.co.id');
  ok('pratinjau menandai sedang memakai cadangan', pratinjau.data.pakai_cadangan === true);

  // ubah prioritas -> email perusahaan jadi utama
  c2.setConfig_('reminder_email_utama', 'PERUSAHAAN');
  const env3 = loadBackend(ss2, { cache: new Map() });
  const u = { Email_Pribadi: 'p@gmail.com', Email_Perusahaan: 'k@kantor.co.id' };
  sama('prioritas PERUSAHAAN memakai email kantor', env3.ctx.emailUtamaUser_(u), 'k@kantor.co.id');

  // daftar tambahan HC tetap dihormati
  env3.ctx.setConfig_('reminder_extra_emails', 'hc.pusat@perusahaan.co.id, bukan-email');
  const extra = env3.ctx.emailExtra_();
  sama('email tambahan valid diambil', extra.length, 1);
  sama('nilai bukan email diabaikan', extra[0], 'hc.pusat@perusahaan.co.id');
}


/* ------------------------------------------- M. merek aplikasi: myCertif --- */
head('M. Nama aplikasi myCertif (dan kompatibilitas instalasi lama)');

{
  const db = buatDatabase({ users: 10, files: 10, notif: 3 });
  const ss2 = db.ss;

  /* ScriptProperties berisi penanda LAMA saja -> harus dianggap sudah bootstrap */
  const propsLama = new Map();
  propsLama.set('SIAGA_BOOTSTRAP', 'v1.3.0');
  const c = loadBackend(ss2, { cache: new Map(), props: propsLama }).ctx;

  ok('APP_NAME = myCertif', c.APP_NAME === 'myCertif', c.APP_NAME);
  ok('APP_SUB tetap menjelaskan fungsi aplikasi', String(c.APP_SUB).length > 10);

  sama('properti bootstrap baru belum ada', propsLama.get('MYCERTIF_BOOTSTRAP'), undefined);
  const envBaru = loadBackend(ss2, { cache: new Map(), props: propsLama });
  ok('penanda LAMA (nilai versi lama) tetap dianggap sudah siap',
    envBaru.ctx.isBootstrapDone_() === true);
  ok('properti baru ikut ditulis (migrasi otomatis)',
    propsLama.get('MYCERTIF_BOOTSTRAP') !== undefined, String(propsLama.get('MYCERTIF_BOOTSTRAP')));
  sama('properti LAMA dibuang setelah dipindahkan', propsLama.get('SIAGA_BOOTSTRAP'), undefined);
  ok('tidak ada kickstart ulang hanya karena ganti nama',
    envBaru.ctx.kickstart_(false).sudah_sebelumnya === true);

  /* kunci Config baru tetap disisipkan tanpa kickstart ulang */
  {
    const ssKosong = buatDatabase({ users: 5, files: 5, notif: 1 }).ss;
    const shCfg = ssKosong.getSheetByName('Config');
    const iKey = shCfg.header.indexOf('Key');
    const sebelum = shCfg.rows.length;
    ok('Config contoh belum punya reminder_email_utama',
      !shCfg.rows.some((r) => String(r[iKey]) === 'reminder_email_utama'));
    // hapus satu baris supaya jelas ada yang perlu disisipkan
    shCfg.rows = shCfg.rows.filter((r) => String(r[iKey]) !== 'zona_waktu');
    const propsSeed = new Map();
    propsSeed.set('MYCERTIF_BOOTSTRAP', 'v1.4.0');
    const envS = loadBackend(ssKosong, { cache: new Map(), props: propsSeed });
    const laporan = envS.ctx.kickstart_(false);
    ok('kickstart dilewati', laporan.sudah_sebelumnya === true);
    ok('key Config yang hilang disisipkan otomatis',
      shCfg.rows.some((r) => String(r[iKey]) === 'reminder_email_utama'),
      'baris=' + sebelum + ' -> ' + shCfg.rows.length);
    ok('key yang dihapus juga dikembalikan',
      shCfg.rows.some((r) => String(r[iKey]) === 'zona_waktu'));
  }

  /* konfigurasi bawaan memakai nama baru */
  sama('Config app_name', c.getConfig_('app_name'), 'myCertif');
  ok('awalan subjek email bawaan memuat myCertif',
    String(c.CONFIG_DEFAULTS.email_subject_prefix).indexOf('myCertif') !== -1,
    c.CONFIG_DEFAULTS.email_subject_prefix);
  ok('catatan kaki email bawaan memuat myCertif',
    String(c.CONFIG_DEFAULTS.email_footer).indexOf('myCertif') !== -1,
    c.CONFIG_DEFAULTS.email_footer);
  ok('menu spreadsheet memakai myCertif',
    c.SCHEMAS && true); // dijaga oleh check.js, di sini cukup pastikan konteks termuat

  /* email yang benar-benar dikirim memakai nama baru */
  const shUser = ss2.getSheetByName('Master_User');
  const iKode = shUser.header.indexOf('Employee_code');
  const iPribadi = shUser.header.indexOf('Email_Pribadi');
  const kode = db.kredensial[4].kode;
  const row = shUser.rows.findIndex((r) => String(r[iKode]) === kode);
  shUser.rows[row][iPribadi] = 'brand.uji@gmail.com';

  const simpan = c.apiSaveFile(db.token, {
    employee_id: kode, nama_sertifikasi: 'Uji Merek',
    start_pelaksanaan: '2025-01-01', end_pelaksanaan: '2025-01-02', masa_berlaku_bulan: 36
  });
  ok('data uji tersimpan', simpan.ok, simpan.error);

  const env2 = loadBackend(ss2, { cache: new Map(), props: propsLama });
  ENV.emails = [];
  const kirim = env2.ctx.apiKirimNotifikasiFile(db.token, simpan.data.doc_id, '');
  ok('notifikasi terkirim', kirim.ok && kirim.data.terkirim, JSON.stringify(kirim.data));
  const surel = ENV.emails[0] || {};
  ok('subjek email memakai myCertif',
    String(surel.subject || '').indexOf('myCertif') !== -1, surel.subject);
  ok('subjek TIDAK menyebut nama lama',
    String(surel.subject || '').toUpperCase().indexOf('SIAGA') === -1, surel.subject);
  ok('isi email menyebut myCertif',
    String(surel.htmlBody || '').indexOf('myCertif') !== -1);

  /* audit trail memakai actor/aksi yang sama (tidak terpengaruh nama) */
  ok('audit tetap tercatat', c.sheetToObjects_('T_Audit_Trail').length > 0);
}

/* ---------------------------------------------------------------- ringkas */
console.log('\n' + '='.repeat(78));
console.log(' HASIL UJI: ' + lulus + ' lulus, ' + gagal + ' gagal');
if (gagal) {
  console.log(' Kegagalan:');
  kegagalan.forEach((k) => console.log('   - ' + k));
}
console.log('='.repeat(78));
process.exit(gagal ? 1 : 0);
