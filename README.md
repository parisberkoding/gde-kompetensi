# myCertif — Monitoring & Reminder Sertifikasi (Unit Patuha)

**myCertif** adalah sistem manajemen dan *reminder* otomatis sertifikasi karyawan di Unit Patuha yang membantu divisi **Human Capital (HC)** beralih dari pemantauan manual ke sistem bertenaga **Google Apps Script**. Sistem ini memfasilitasi pelacakan masa berlaku dokumen, notifikasi otomatis, dan pengelolaan profil pengguna dengan hak akses berjenjang.

---

## Struktur Project

Sesuai dengan blueprint arsitektur aplikasi, berkas-berkas dikelompokkan ke dalam struktur berikut:

```text
├── Backend/                     # SEMUA berkas ini harus ditempel ke Apps Script
│   ├── Kode.gs.txt              # Konstanta, skema sheet, doGet, kickstarter, menu, diagnosa
│   ├── Data.gs.txt              # Lapisan data ber-cache: Config sekali baca, memo baris,
│   │                            #   indeks pencarian, dan tulis batch
│   ├── Sertifikasi.gs.txt       # T_Sertifikasi: CRUD, filter+paginasi, verifikasi,
│   │                            #   profil pekerja, dashboard
│   ├── User.gs.txt              # Master_User: CRUD akun, profil sendiri, sinkron/impor akun
│   ├── Notifikasi.gs.txt        # Notifikasi in-app, email pengingat, anti-spam, trigger harian
│   ├── Ekspor.gs.txt            # Ekspor Excel & PDF (termasuk PDF profil pekerja)
│   ├── Migrasi.gs.txt           # Migrasi skema v1 -> v2 + pemeriksa status skema
│   ├── Session.gs.txt           # Autentikasi & sesi berlapis
│   ├── Importer.gs.txt          # Impor sheet mentah hasil tempel Excel
│   └── subprocess.gs.txt        # Mesin status (sisa hari/bulan, durasi tahun-bulan-hari,
│                                #   Recom_Update) + meta & pengaturan
├── Frontend/
│   ├── Login.html.txt           # Halaman autentikasi (Username: nama depan, Password: employee code)
│   ├── Dashboard.html.txt       # Overview statistik sisa masa berlaku & tabel prioritas
│   ├── DataSertifikasi.html.txt # Detailing data + kolom "Berlaku Hingga"
│   ├── ProfilPekerja.html.txt   # Profil pekerja + seluruh sertifikasinya
│   └── Register.html.txt        # Formulir input sertifikasi & unggah dokumen
├── _tools/                      # Alat pengembang (TIDAK dipasang ke Apps Script)
│   ├── check.js                 # Pemeriksa konsistensi statis
│   ├── uji.js                   # Uji kebenaran backend (simulator Apps Script)
│   ├── uji-ui.js                # Uji tampilan frontend tanpa browser
│   └── sim.js                   # Pengukur biaya akses spreadsheet per endpoint
├── gde-ui-templates/            # Basis CSS/JS & layout standar perusahaan
├── docs/                        # Dokumentasi arsitektur sistem
└── README.md                    # Panduan teknis utama project
```

---

## Environment Variables (Script Properties)

Project ini berjalan di **Google Apps Script**, jadi konfigurasi infrastruktur
diisi di **Project Settings → Script Properties**:

| Key | Value / Contoh | Deskripsi |
| :--- | :--- | :--- |
| `SPREADSHEET_ID` | `1bA...xyz` | ID Google Spreadsheet database. Sebenarnya sudah diisi lewat konstanta `SPREADSHEET_ID` di `Kode.gs`; properti ini hanya cadangan dan diisi otomatis oleh `setupSpreadsheetId_()`. |
| `MYCERTIF_BOOTSTRAP` | `v1.4.0` | Penanda internal bahwa kickstart sudah selesai. Diisi otomatis — jangan diubah manual. |
| `MYCERTIF_REPAIR_AT` | timestamp | Penanda internal kapan password terakhir direset. Diisi otomatis. |

> **Email pengingat TIDAK memakai variabel lingkungan.** Alamat tujuan selalu
> diambil dari sheet `Master_User` (`Email_Pribadi`, cadangan
> `Email_Perusahaan`) — lihat bagian *Logika & Aturan Bisnis Inti*.
> Folder Drive lampiran diatur lewat konstanta `DRIVE_FOLDER_ID` di `Kode.gs`
> (dibuat otomatis bila dikosongkan), dan ambang status/jadwal reminder diatur
> dari halaman **Pengaturan** (sheet `Config`).

---

## 🗄️ Spesifikasi Struktur Data (Spreadsheet DB)

Aplikasi memanfaatkan Google Spreadsheet sebagai representasi database relasional yang terbagi menjadi dua tabel utama:

### 1. `Master_User`

Enam kolom inti berada di depan; kolom pendukung setelahnya dipakai untuk
notifikasi email, keamanan akun, dan profil pekerja.

| Column | Tipe Data | Deskripsi |
| :--- | :--- | :--- |
| `Employee_code` | String (PK) | Kode unik penanda karyawan (sekaligus password standar) |
| `Nama_Lengkap` | String | Nama lengkap sesuai dokumen legal |
| `Username` | String | Nama depan karyawan, huruf kecil (dipakai untuk login) |
| `Password` | String | Password = `Employee_code`, disimpan apa adanya (tanpa hash) |
| `Role` | Enum | Hak akses sistem: `HC`, `EMP`, atau `SA` (Superadmin) |
| `Working_Location` | String | Lokasi kerja karyawan |
| `Email_Perusahaan` | String | Tujuan utama notifikasi email |
| `Email_Pribadi` | String | CC notifikasi email |
| `Divisi`, `Jabatan`, `Email_Atasan`, `No_HP` | String | Profil pekerja & CC reminder ke atasan |
| `Status`, `Must_Change_Password`, `Login_Terakhir`, `Gagal_Login`, `Terkunci_Sampai` | - | Keamanan akun |
| `Created_At`, `Updated_At`, `Created_By` | - | Jejak audit |

### 2. `T_Sertifikasi` — data sertifikasi (1 karyawan : banyak sertifikasi)

| Column | Tipe Data | Deskripsi |
| :--- | :--- | :--- |
| `Cert_Id` | String (PK) | Kunci unik, format `DOC-YYYYMM-####` |
| `Employee_Code` | String (FK) | Relasi ke `Master_User.Employee_code` |
| `No_Sertifikat` | String | Nomor yang tertera pada dokumen sertifikat |
| `Nama_Sertifikasi` | String | Nama sertifikat kompetensi atau lisensi kerja |
| `Start_Pelaksanaan` | Date | Tanggal awal pelaksanaan |
| `End_Pelaksanaan` | Date | Tanggal selesai pelaksanaan |
| `Tanggal_Sertifikasi` | Date (Nullable) | Tanggal pencetakan fisik atau ujian |
| `Penyelenggara` | String | Lembaga penyelenggara / penerbit sertifikat |
| `Expired_at` | Date (Req) | Tanggal absolut kedaluwarsa dokumen |
| `Recom_Update` | Date | **Rekomendasi perpanjangan = `Expired_at` − 3 bulan** |
| `Sisa_masa_berlaku_day` | Integer | Hasil hitung mundur sisa hari |
| `Sisa_masa_berlaku_by_month` | Integer | Hasil hitung mundur dalam bulan |
| `Status` | String | Label kondisi berdasarkan ambang batas waktu |
| `Masa_berlaku_bulan` | Integer | 36 / 60 / lainnya — dasar hitung `Expired_at` |
| `Tanggal_waktu_perpanjangan` | Date (Nullable) | Diisi bila sertifikat sudah diperpanjang |
| `Link_file`, `File_id`, `File_name`, `Mime_type`, `Ukuran_file` | - | Lampiran Drive |
| `Status_Verifikasi` | Enum | `PENDING` (menunggu) \| `VERIFIED` (terverifikasi) \| `REVISI` (perlu revisi) |
| `Verified_By`, `Verified_At`, `Catatan` | - | Siapa & kapan memeriksa, plus catatan untuk pemilik data |
| `Created_At`, `Updated_At`, `Created_By` | - | Jejak audit |

> **Jenjang jenis/kategori sertifikasi sudah dihapus**. Nama sertifikasi dan masa
> berlakunya diisi manual per baris. Formulir tetap memberi *saran* nama dari
> data yang pernah diinput agar penulisan konsisten, tanpa membatasi input.

---

## Logika & Aturan Bisnis Inti

### 1. Sistem Threshold Status Warna
Masa berlaku dihitung secara berkala oleh `subprocess.gs.txt` dengan pembagian indikator visual sebagai berikut:
* **Hijau (Masih Berlaku):** Sisa masa berlaku **> 9 Bulan**.
* **Kuning (Peringatan):** Sisa masa berlaku **≤ 9 Bulan**.
* **Orange (Perlu Perhatian):** Sisa masa berlaku **≤ 6 Bulan**.
* **Merah (Segera Perpanjang):** Sisa masa berlaku **≤ 3 Bulan**.
* **Hitam tulisan Putih (Mendekati Kadaluarsa):** Sisa masa berlaku **≤ 2 Bulan**.

### 2. Penamaan Dokumen di Cloud Storage
Setiap file dokumen pendukung (`PDF`, `Excel`, `Gambar`, `Word`) yang diunggah melalui komponen Frontend akan otomatis diganti namanya oleh sistem menjadi:
`[6_CHAR_UUID]_[EMPLOYEE_CODE]_[NAMA_SERTIFIKASI]` sebelum disimpan ke dalam target ekosistem Google Drive.

### 3. Alur verifikasi: Employee unggah → HC periksa → Terverifikasi / Perlu Revisi

1. Karyawan mengunggah atau memperbaiki data → status **Menunggu Verifikasi**.
2. HC/SA membuka *Data Sertifikasi*, memfilter **Verifikasi = Menunggu**, lalu
   memeriksa data beserta lampirannya.
3. HC memilih **Terverifikasi** atau **Perlu Revisi**. Bila memilih *Perlu
   Revisi*, **catatan alasan wajib diisi**.
4. Pemilik data menerima **notifikasi in-app** berisi hasil dan catatan HC.
5. Data yang diinput HC/SA langsung Terverifikasi. Data karyawan yang diubah
   setelah diverifikasi otomatis kembali Menunggu Verifikasi.

Verifikasi **tidak mengunci** data: karyawan tetap bisa memperbaiki, dan HC
memeriksa ulang. Istilahnya "Perlu Revisi", bukan "Ditolak" — datanya tidak
dibuang, hanya diminta diperbaiki. Nilai lama `REJECTED` tetap dibaca dan
dinormalkan otomatis.

### 4. Email pengingat: dikirim ke email pribadi masing-masing

Alamat penerima **selalu diambil dari sheet `Master_User`** — tidak pernah dari
alamat bawaan aplikasi:

| Peran | Alamat |
|---|---|
| Kepada (TO) | pemilik sertifikasi → `Email_Pribadi` |
| Cc | seluruh HC & Super Admin (email masing-masing), `Email_Atasan`, dan alamat tambahan dari Pengaturan |

Bila `Email_Pribadi` kosong, otomatis memakai `Email_Perusahaan` sebagai
cadangan. Bila **keduanya** kosong, pengingat tidak dikirim dan tercatat
`SKIPPED` di `T_Email_Log` beserta alasannya — sengaja tidak dikirim hanya ke Cc
lalu dilaporkan sukses, supaya HC tidak mengira karyawannya sudah diingatkan.

Prioritas kolom bisa dibalik di **Pengaturan → Alamat yang diutamakan**
(Config `reminder_email_utama` = `PRIBADI` | `PERUSAHAAN`).

### 5. Kirim notifikasi manual per data

Selain pengingat otomatis harian, HC dapat mengirim pengingat untuk **satu data**
dari tabel Data Sertifikasi (ikon kirim di kolom Aksi). Sistem menampilkan
**pratinjau penerima** lebih dulu, HC boleh menambah catatan, lalu kirim.
Pemilik tetap menerima notifikasi in-app, dan pengiriman tercatat di
`T_Email_Log` serta `T_Audit_Trail`.

### 6. Kolom "Berlaku Hingga" (tampilan sisa masa berlaku)
Tabel Data Sertifikasi menampilkan tanggal kedaluwarsa dengan sisa masa berlaku
berjenjang tahun/bulan/hari sebagai teks kecil di bawahnya:

```text
| Berlaku Hingga        |
| 19 Mar 29             |
| 3 Tahun 2 Bulan 4 Hari|
```

Perhitungan memakai kalender sungguhan (bukan `hari / 30`), dilakukan sekali di
server (`durasiTeks_()` pada `subprocess.gs.txt`) lalu dikirim sebagai
`sisa_teks`, sehingga tabel, ekspor Excel, dan PDF menampilkan angka yang sama.

### 7. Alur Kerja Notifikasi Otomatis
Sistem menjalankan pemicu (*Time-driven Trigger*) harian untuk memindai seluruh
baris `T_Sertifikasi`. Baris yang masuk zona **Kuning**, **Orange**, **Merah**,
atau **Hitam** memicu `MailApp.sendEmail()` ke email pemilik (dari
`Master_User`), ditembuskan ke seluruh HC/SA dan atasan sesuai pengaturan.
Pengiriman dicatat di `T_Email_Log` sebagai penanda anti-spam, dan pemilik juga
menerima notifikasi in-app. Ambang, jadwal, dan batas jumlah email per jalan
diatur di halaman **Pengaturan**.

---

## ⚡ Catatan Performa

Seluruh akses spreadsheet melewati `Backend/Data.gs.txt`:

* Sheet `Config` dibaca **sekali** per permintaan lalu diambil dari cache
  (`CacheService`, TTL 5 menit, otomatis dibuang saat Config diubah).
* Isi sheet lain disimpan di memori selama satu permintaan.
* Pencarian satu baris memakai indeks, bukan menarik seluruh kolom.
* Perubahan ditulis **batch**: kolom bersebelahan jadi satu `setValues()`.

Hasil pengukuran (`node _tools/sim.js --banding`, 220 user / 260 sertifikasi):

| Endpoint | Sebelum | Sesudah | Efisiensi |
| :--- | ---: | ---: | ---: |
| `apiListFiles` | 1.311 | 3 | **437x** |
| `apiGetDashboard` | 1.316 | 4 | **329x** |
| `apiGetRingkasanHeader` | 1.312 | 4 | **328x** |
| `jalankanReminder_` (harian) | 1.576 | 4 | **394x** |
| **TOTAL pembacaan sheet** | **6.906** | **33** | **209x** |
| **TOTAL sel dibaca** | **1.285.592** | **107.300** | **12x** |

Selain itu ditemukan satu bug penting: `fmtDate_()` dengan pola ber-jam
memotong komponen waktu ke `00:00:00`, sehingga `Valid_Until` setiap sesi yang
baru dibuat langsung berada di masa lalu. Aplikasi pun mengulang login terus
dan setiap pengulangan melipatgandakan permintaan ke spreadsheet. Bug ini sudah
diperbaiki di `Backend/Kode.gs.txt`.

## 🖥️ Fitur Utama Antarmuka (UI Requirements)

Aplikasi dibangun responsif mengikuti fondasi CSS dari komponen `gde-ui-templates`:
* **Halaman Login Terproteksi:** Autentikasi berbasis pencocokan nama depan dan kode karyawan.
* **Dashboard Ringkasan Visual:** Panel metrik yang menampilkan jumlah dokumen aktif, dokumen kritis, dan grafik agregasi status warna untuk monitoring cepat pihak HC.
* **On-Page File Explorer (Detailing):** Desain tata letak panel ganda di mana sisi kiri menampilkan data profil karyawan yang dapat diedit (*editable field*), sedangkan sisi kanan merupakan jendela preview dokumen PDF/file pendukung yang dapat disembunyikan (*toggleable preview*).
* **Registrasi & Unggah Mandiri:** Antarmuka khusus bagi akun dengan role `EMP` untuk memperbarui berkas sertifikasi baru secara mandiri tanpa membebani administrator HC.
* **Ekspor Data Terintegrasi:** Fitur konversi instan seluruh baris data pelacakan dari spreadsheet ke format dokumen cetak `PDF` atau spreadsheet eksternal `Excel` langsung lewat UI.
