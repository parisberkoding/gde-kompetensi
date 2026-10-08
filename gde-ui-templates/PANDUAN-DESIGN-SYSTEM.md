# GDE UI Templates — Panduan Design System

Pustaka tampilan resmi **PT Geo Dipa Energi (Persero) — Unit Patuha** untuk aplikasi SIAGA.
Satu sumber gaya untuk seluruh antarmuka: warna, tipografi, komponen, dan kerangka aplikasi.

Versi: **1.0** · Pemilik: Divisi General Affairs &amp; tim IT Unit Patuha ·
Halaman demo interaktif: [`demo.html`](demo.html) (buka di peramban).

---

## 1. Mengapa pustaka ini ada

Sebelumnya tampilan aplikasi mengikuti template pihak ketiga (NiceAdmin) dengan warna bawaan
(`#4154f1` indigo dan `#012970` navy) serta sebagian halaman memuat gaya dari CDN luar.
Pustaka ini menggantinya dengan identitas Geodipa: palet resmi, huruf Poppins, komponen
yang konsisten, dan **tanpa ketergantungan CDN**.

Cara kerjanya dua lapis:

| Lapisan | Berkas | Untuk apa |
|---|---|---|
| **Pustaka komponen** | `gde-tokens/base/components/app.css` | Markup **baru** memakai kelas `gde-*` |
| **Jembatan (bridge)** | `gde-compat.css` | Membuat markup **lama** (Bootstrap + NiceAdmin) ikut tampil baru **tanpa mengubah Blade** |

---

## 2. Isi folder

```
public/gde-ui-templates/
├── demo.html                    Style guide + contoh semua komponen
├── README.md                    Daftar aset hasil vendoring + lisensi + cara memperbarui
├── PANDUAN-DESIGN-SYSTEM.md     Berkas ini
├── css/
│   ├── gde-tokens.css           Variabel warna, tipografi, jarak, radius, bayangan
│   ├── gde-base.css             Elemen dasar + utilitas .gde-u-* + aksesibilitas + cetak
│   ├── gde-components.css       Tombol, kartu, badge, alert, tabel, form, tab, modal, dll.
│   ├── gde-app.css              Kerangka aplikasi (topbar, sidebar, konten, footer)
│   └── gde-compat.css           Jembatan Bootstrap 5 + NiceAdmin  ← WAJIB dimuat terakhir
├── fonts/                       Poppins (6 bobot × 2 subset) + poppins.css
├── icons/                       Bootstrap Icons + fontnya
├── js/
│   ├── gde-ui.js                Perilaku komponen gde-* (dropdown, modal, tab, salin)
│   └── vendor/mermaid.min.js    Untuk diagram pada dokumentasi
└── vendor/                      Stylesheet pihak ketiga yang di-self-host
```

---

## 3. Cara memasang

Cukup dua baris di Blade:

```blade
{{-- di dalam <head>, SETELAH Bootstrap dan style.css NiceAdmin --}}
@include('partials.gde-head')

{{-- sebelum </body> --}}
@include('partials.gde-scripts')
```

Partial `gde-head` menerima dua parameter opsional:

```blade
@include('partials.gde-head', ['gdeApp' => false])     {{-- tanpa gaya kerangka aplikasi --}}
@include('partials.gde-head', ['gdeCompat' => false])  {{-- tanpa jembatan NiceAdmin --}}
```

Halaman cetak (mis. `template-spd.blade.php`) sebaiknya memakai `gdeCompat => false`
agar tata letak surat tidak berubah.

### Urutan pemuatan itu penting

```
Bootstrap 5 → Bootstrap Icons → style.css (NiceAdmin) → tokens → base → components → app → compat
```

`gde-compat.css` harus **paling akhir**. Bila ia dimuat sebelum Bootstrap, gaya lama akan menang
dan perubahan tidak terlihat.

---

## 4. Token warna

Selalu gunakan variabel — jangan tulis kode heksa langsung di view.

| Variabel | Nilai | Kegunaan |
|---|---|---|
| `--gde-green` | `#8DC63F` | Hijau Geodipa: aksen, status aktif, tombol positif |
| `--gde-yellow` | `#FFF56B` | Kuning Geodipa: peringatan, sorotan |
| `--gde-blue` | `#0B50A1` | Biru Geodipa: warna utama, tautan, tombol primer |
| `--gde-red` | `#ED1B2F` | Merah Geodipa: bahaya, penolakan |
| `--gde-green-d` / `-d2` | `#71A62F` / `#5C8A24` | Hijau untuk teks/ tombol (kontras aman) |
| `--gde-blue-d` / `-d2` | `#093D7D` / `#062E5E` | Biru tua: gradasi sidebar, hover |
| `--gde-green-l`, `--gde-blue-l`, `--gde-yellow-l`, `--gde-red-l` | muda | Latar badge/alert |
| `--gde-ink` / `--gde-ink-2` / `--gde-muted` / `--gde-muted-2` | `#16202E` / `#33465C` / `#64748B` / `#94A3B8` | Tingkatan teks |
| `--gde-line` / `--gde-line-2` | `#E4E9F0` / `#F1F5F9` | Garis |
| `--gde-surface` / `-2` / `-3` | `#FFFFFF` / `#F8FAFC` / `#F4F7FB` | Permukaan |

Tipografi: `--gde-font` (Poppins), `--gde-fs-xs … --gde-fs-4xl`, `--gde-fw-*`.
Bentuk: `--gde-r-xs … --gde-r-pill`. Bayangan: `--gde-sh-1 … --gde-sh-3`.

---

## 5. Komponen (kelas `gde-*`)

Nama kelas selalu diawali `gde-` agar tidak bertabrakan dengan Bootstrap.

| Komponen | Kelas dasar | Varian |
|---|---|---|
| Tombol | `.gde-btn` | `--primary --green --danger --warning --dark --outline --outline-primary --ghost --link`, ukuran `--sm --xs --lg --block --icon` |
| Kartu | `.gde-card` | `__head __body __foot`, `__head--brand`, `__icon--blue/red/yellow` |
| Statistik | `.gde-stat` | `--green --red --yellow`, `__icon __label __value __hint` |
| Badge | `.gde-badge` | `--blue --red --yellow --gray --dark --solid --solid-blue --dot` |
| Chip | `.gde-chip` | `--soft` |
| Alert | `.gde-alert` | `--info --success --warning --danger`, `__icon __body` |
| Tabel | `.gde-table-wrap` + `.gde-table` | `--compact --zebra`, `.gde-num`, `.gde-ctr` |
| Form | `.gde-label .gde-input .gde-select .gde-textarea .gde-hint .gde-error` | `.is-invalid`, `.gde-check`, `.gde-switch` |
| Navigasi | `.gde-tabs/.gde-tab`, `.gde-nav-pills`, `.gde-pagination`, `.gde-breadcrumb` | `.is-active`, `.is-disabled` |
| Progres | `.gde-progress` + `.gde-progress__bar`, `.gde-meter` | `--blue --red --yellow` |
| Overlay | `.gde-modal` (+`__scrim __dialog __head __body __foot`), `.gde-tooltip/.gde-tip` | dialog `--lg` |
| Lain-lain | `.gde-steps`, `.gde-timeline`, `.gde-list`, `.gde-avatar`, `.gde-empty`, `.gde-skeleton`, `.gde-spinner` | — |
| Kerangka | `.gde-topbar`, `.gde-shell`, `.gde-sidebar`, `.gde-nav`, `.gde-content`, `.gde-footer` | `.is-collapsed`, `.gde-nav--sub` |

Perilaku interaktif ditangani `gde-ui.js`:

```html
<!-- modal -->
<button data-gde-modal="#modalSaya">Buka</button>
<div class="gde-modal" id="modalSaya">
  <div class="gde-modal__scrim"></div>
  <div class="gde-modal__dialog">
    <div class="gde-modal__head"><h3>Judul</h3><button class="gde-modal__close">&times;</button></div>
    <div class="gde-modal__body">…</div>
    <div class="gde-modal__foot"><button class="gde-btn gde-btn--outline" data-gde-close>Tutup</button></div>
  </div>
</div>

<!-- dropdown -->
<div class="gde-dropdown">
  <button class="gde-icon-btn" data-gde-dropdown><i class="bi bi-three-dots-vertical"></i></button>
  <div class="gde-dropdown__menu">
    <a class="gde-dropdown__item" href="#"><i class="bi bi-pencil"></i> Ubah</a>
  </div>
</div>
```

---

## 6. Jembatan ke markup lama (`gde-compat.css`)

Lapisan ini **tidak menambah kelas baru** ke Blade. Ia menimpa gaya Bootstrap 5 dan NiceAdmin
pada markup yang sudah ada:

* `.sidebar` → gradasi biru Geodipa, lebar 264px, sudut menu 10px, menu aktif bergaris hijau.
  Termasuk mengatasi `.nav-link.collapsed` milik NiceAdmin yang memaksa latar putih.
* `.header` → tinggi 64px, putih transparan + blur, garis bawah tipis.
* `#main` → margin kiri 264px, latar `--gde-surface-3`, padding 24/32px; tetap responsif
  dan tetap mendukung mode `body.toggle-sidebar` bawaan template.
* `.card`, `.card-title`, `.info-card`, `.info-label`, `.info-value` → sudut 18px, garis tipis,
  bayangan halus, tipografi Poppins.
* `.btn-*`, `.form-control`, `.form-select`, `.form-label`, `.form-check-input` → warna dan
  bentuk Geodipa; cincin fokus hijau.
* `.table`, `.badge`, `.alert-*`, `.nav-tabs`, `.nav-pills`, `.pagination`, `.dropdown-menu`,
  `.modal-content`, `.progress`, `.list-group`, `.back-to-top`, `.breadcrumb`, `.pagetitle`.
* `.datatable-*` (simple-datatables) dan `.swal2-*` (SweetAlert2) ikut diselaraskan.
* Variabel Bootstrap (`--bs-primary`, `--bs-success`, `--bs-body-font-family`, dst.) ditimpa
  sehingga utilitas `bg-*`, `text-*`, dan `border-*` otomatis mengikuti palet Geodipa.

Karena itu, **halaman lama tidak perlu diubah** untuk mendapatkan tampilan baru.

---

## 7. Aturan penulisan

**Lakukan**

1. Pakai token: `color: var(--gde-blue)` bukan `color: #0B50A1`.
2. Pakai komponen `gde-*` untuk tampilan baru.
3. Simpan CSS khusus halaman seminimal mungkin; bila terpaksa, akhiri dengan `var(--gde-*)`.
4. Tambahkan CSS baru ke pustaka (`gde-components.css`), bukan ke view.

**Hindari**

1. Jangan memuat CSS/font dari CDN pada halaman baru.
2. Jangan menaruh `gde-compat.css` sebelum `style.css`.
3. Jangan menimpa `.card`, `.btn`, atau `.sidebar` di dalam view — perbaiki di pustaka.
4. Jangan mengganti versi Chart.js / simple-datatables secara terburu-buru: beberapa halaman
   masih memakai versi CDN tertentu (lihat bagian 9).

### 7.1 Kontras teks — wajib

Palet merek dipakai dua versi agar tetap terbaca:

| Keperluan | Pakai | Contoh |
|---|---|---|
| **Teks** di atas latar putih | versi **gelap** | `.text-success` → `#3F6B18`, `.text-danger` → `#C4142A`, `.text-warning` → `#8A6A00` |
| **Latar** dengan teks putih | versi **lebih gelap** dari merek | `.bg-success` → `#4A7A1C`, `.bg-danger` → `#C4142A`, `.bg-primary` → `#0B50A1` |
| **Aksen/ikon/border** | versi merek | `--gde-green #8DC63F`, `--gde-red #ED1B2F` |
| Teks sekunder | `--gde-muted` (`#5B6B80`) | sudah lolos AA untuk teks kecil |

**Judul di dalam header berlatar gelap.** Komponen dasar menetapkan `h1…h6 { color: var(--gde-ink) }`.
Agar judul tetap terbaca di atas latar gelap, lapisan jembatan memaksa pewarisan warna
(`color: inherit`) pada konteks `.text-white`, `.bg-primary`, `.bg-dark`, dan header berkepala
merek. Artinya:

```blade
{{-- BENAR: judul mewarisi putih dari header --}}
<div class="card-header bg-primary text-white">
  <h5 class="mb-0">Kelola Permohonan</h5>
</div>

{{-- SALAH: menulis warna teks sendiri di dalam konteks gelap --}}
<div class="card-header bg-primary text-white">
  <h5 style="color:#16202E">Kelola Permohonan</h5>
</div>
```

**Cara memeriksa.** Jalankan audit kontras otomatis (rasio WCAG AA: 4,5:1 teks biasa,
3:1 teks besar/tebal) pada halaman yang diubah. Contoh cepat di konsol peramban:

```js
// laporkan elemen teks yang rasionya di bawah ambang
// (skrip audit lengkap dipakai saat pengembangan; prinsipnya: hitung rasio
//  warna teks vs warna latar efektif, dengan gradien diperhitungkan)
```

Ketika audit terakhir dijalankan pada 14 halaman utama (Kelola Permohonan, Dashboard Bisnis,
SA Dashboard, Kelola User, Kendaraan, Lunch, Forecast, Employee Default, Distribusi, Dispatcher,
Assign PIC, Approval BBM, Jadwal Service, Tab Pelaporan), hasilnya **0 temuan**.

---

## 8. Pemeliharaan

* **Menambah komponen**: tambahkan ke `gde-components.css`, lalu tampilkan di `demo.html`.
* **Mengubah warna**: cukup di `gde-tokens.css` — seluruh aplikasi ikut berubah.
* **Memperbarui font/ikon**: lihat `README.md` bagian *Cara Memperbarui*.
* **Uji setelah perubahan**: buka `demo.html`, lalu periksa satu halaman dashboard
  (`.card`, `.table`, `.btn`, `.form-control`, `.sidebar`) pada lebar 1500px dan 800px.

---

## 9. Sisa ketergantungan CDN (JS, bukan gaya)

Seluruh **stylesheet dan font** sudah lokal. Yang masih memuat CDN hanya pustaka JavaScript
fungsional berikut — sengaja dibiarkan karena terikat versi:

| Pustaka | Dipakai di | Catatan |
|---|---|---|
| `simple-datatables@10.3.0` (JS) | `admin/index`, `admin/approval` | CSS-nya sudah lokal (`vendor/simple-datatables-10.3.0.css`) |
| `html5-qrcode@2.3.8` | pemindai barcode/QR (3 view) | — |
| `Chart.js 4.4.1` | `superadmin/vehicle-health/show`, `financial-report` | Lokal tersedia v4.4.2 — dapat dialihkan |
| `Chart.js 3.9.1` | `superadmin/partials/dashboard-bisnis` | **Jangan** dialihkan tanpa uji: v3 → v4 mengubah API |
| `sweetalert2@11.23.0` | `templates/main` | Gaya popup sudah diselaraskan lewat jembatan |
| `jspdf@2.5.1`, `leaflet@1.9.4` | cetak PDF, peta | Dapat divendorkan menyusul |

Rencana lanjutan: vendorkan keempat pustaka pertama ke `js/vendor/` setelah diuji per halaman.
