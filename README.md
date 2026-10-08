# HC Monitoring & Reminder Sertifikasi — Patuha Project

Sistem manajemen dan *reminder* otomatis sertifikasi karyawan di Patuha untuk membantu divisi **Human Capital (HC)** beralih dari pemantauan manual ke sistem bertenaga **Google Apps Script**. Sistem ini memfasilitasi pelacakan masa berlaku dokumen, notifikasi otomatis, dan pengelolaan profil pengguna dengan hak akses berjenjang.

---

## Struktur Project

Sesuai dengan blueprint arsitektur aplikasi, berkas-berkas dikelompokkan ke dalam struktur berikut:

```text
├── Backend/
│   ├── Kode.gs.txt          # Main Process (Routing doGet, doPost, Auth, CRUD inti)
│   └── subprocess.gs.txt    # Subprocess (Hitung status harian, trigger Email, generator UUID)
├── Frontend/
│   ├── Login.html.txt       # Halaman autentikasi awal (Username: nama depan, Password: employee code)
│   ├── Dashboard.html.txt   # Overview statistik sisa masa berlaku sertifikasi & tabel utama
│   ├── Detail.html.txt      # Detailing data: [Sidebar][Editable Profile Cards][Toggleable PDF Previewer]
│   └── Register.html.txt    # Formulir registrasi mandiri karyawan & unggah dokumen pendukung
├── gde-ui-templates/        # Repositori aset CSS/JS dan basis layout standar perusahaan
├── docs/                    # Berkas dokumentasi arsitektur sistem
└── README.md                # Panduan teknis utama project
```

---

## Environment Variables (Script Properties)

Karena project ini berjalan di lingkungan **Google Apps Script**, variabel lingkungan dikonfigurasi melalui **Project Settings > Script Properties** pada Google Cloud Console Apps Script kamu:

| Key | Value / Contoh | Deskripsi |
| :--- | :--- | :--- |
| `DATABASE_SS_ID` | `1bA...xyz` | ID Google Spreadsheet yang berfungsi sebagai database utama |
| `STORAGE_FOLDER_ID` | `1fD...abc` | ID Google Drive Folder tempat penyimpanan lampiran dokumen |
| `HC_EMAIL_GROUP` | `hc.patuha@company.com` | Email utama divisi HC untuk menerima ringkasan peringatan harian |

---

## 🗄️ Spesifikasi Struktur Data (Spreadsheet DB)

Aplikasi memanfaatkan Google Spreadsheet sebagai representasi database relasional yang terbagi menjadi dua tabel utama:

### 1. `Master_User`

| Column | Tipe Data | Deskripsi |
| :--- | :--- | :--- |
| `Employee_code` | String (PK) | Kode unik penanda karyawan (digunakan sebagai password standar) |
| `Nama_Lengkap` | String | Nama lengkap sesuai dokumen legal |
| `Username` | String | Nama depan karyawan (digunakan untuk login) |
| `Password` | String | Password terenkripsi atau teks mentah awal |
| `Role` | Enum | Hak akses sistem: `HC`, `EMP`, atau `SA` (Superadmin) |
| `email_perusahaan`| String | Alamat email korporat utama |
| `email_pribadi` | String | Alamat email cadangan untuk pengiriman notifikasi ganda |

### 2. `Master_File`

| Column | Tipe Data | Deskripsi |
| :--- | :--- | :--- |
| `Doc_id` | String (PK) | Format penamaan otomatis: `<uuid:6char>_<employeecode>_Nama Sertifikasi` |
| `Employee_id` | String (FK) | Relasi ke `Employee_code` di tabel `Master_User` |
| `Nama Sertifikasi`| String | Nama sertifikat kompetensi atau lisensi kerja |
| `Start_pelaksanaan`| Date | Tanggal awal berlakunya sertifikasi |
| `end_pelaksanaan` | Date | Tanggal berakhirnya masa sertifikasi |
| `tanggal_sertifikasi`| Date (Nullable)| Tanggal pencetakan fisik atau ujian |
| `tanggal_waktu_perpanjangan`| DateTime| Timestamp kapan entri ini diperbarui untuk diperpanjang |
| `expired_at` | Date (Req) | Tanggal absolut kedaluwarsa dokumen |
| `sisa_masa_berlaku_day`| Integer | Formula/Output hitungan mundur sisa hari aktif |
| `sisa_masa_berlaku_month`| Integer | Formula/Output hitungan mundur dalam hitungan bulan |
| `Status` | String | Label kondisi berdasarkan ambang batas waktu (Threshold) |
| `link_file` | String | URL berkas dokumen yang tersimpan di Google Drive / Gdocs |

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

### 3. Alur Kerja Notifikasi Otomatis
Sistem menjalankan pemicu (*Time-driven Trigger*) harian untuk memindai seluruh data pada tabel `Master_File`. Jika ditemukan dokumen yang memasuki zona **Kuning**, **Orange**, **Merah**, atau **Hitam**, sistem akan mengeksekusi fungsi `MailApp.sendEmail()` untuk mengirimkan pengingat instan secara simultan ke `email_perusahaan`, `email_pribadi` karyawan yang bersangkutan, serta melampirkan salinannya ke `HC_EMAIL_GROUP`.

---

## 🖥️ Fitur Utama Antarmuka (UI Requirements)

Aplikasi dibangun responsif mengikuti fondasi CSS dari komponen `gde-ui-templates`:
* **Halaman Login Terproteksi:** Autentikasi berbasis pencocokan nama depan dan kode karyawan.
* **Dashboard Ringkasan Visual:** Panel metrik yang menampilkan jumlah dokumen aktif, dokumen kritis, dan grafik agregasi status warna untuk monitoring cepat pihak HC.
* **On-Page File Explorer (Detailing):** Desain tata letak panel ganda di mana sisi kiri menampilkan data profil karyawan yang dapat diedit (*editable field*), sedangkan sisi kanan merupakan jendela preview dokumen PDF/file pendukung yang dapat disembunyikan (*toggleable preview*).
* **Registrasi & Unggah Mandiri:** Antarmuka khusus bagi akun dengan role `EMP` untuk memperbarui berkas sertifikasi baru secara mandiri tanpa membebani administrator HC.
* **Ekspor Data Terintegrasi:** Fitur konversi instan seluruh baris data pelacakan dari spreadsheet ke format dokumen cetak `PDF` atau spreadsheet eksternal `Excel` langsung lewat UI.
