# gde-ui-templates — Vendored UI Assets

Folder ini berisi aset font, ikon, dan library JS yang **di-self-host** (vendored) agar
aplikasi SIAGA tidak lagi bergantung pada CDN eksternal. Semua berkas di sini dilayani
langsung dari `public/`, sehingga tidak ada request keluar ke `fonts.googleapis.com`,
`fonts.gstatic.com`, atau `cdn.jsdelivr.net` saat runtime.

## Daftar Isi Folder

```
public/gde-ui-templates/
├── README.md                     # berkas ini
├── fonts/
│   ├── poppins.css               # @font-face untuk 6 weight × 2 subset (latin, latin-ext)
│   ├── poppins-300-latin.woff2
│   ├── poppins-300-latin-ext.woff2
│   ├── poppins-400-latin.woff2
│   ├── poppins-400-latin-ext.woff2
│   ├── poppins-500-latin.woff2
│   ├── poppins-500-latin-ext.woff2
│   ├── poppins-600-latin.woff2
│   ├── poppins-600-latin-ext.woff2
│   ├── poppins-700-latin.woff2
│   ├── poppins-700-latin-ext.woff2
│   ├── poppins-800-latin.woff2
│   └── poppins-800-latin-ext.woff2
├── icons/
│   ├── bootstrap-icons.css       # path sudah dinormalisasi (tanpa referensi remote)
│   └── fonts/
│       ├── bootstrap-icons.woff2
│       └── bootstrap-icons.woff
└── js/
    └── vendor/
        └── mermaid.min.js
```

**Total: 18 berkas** (1 README + 1 CSS Poppins + 12 woff2 Poppins + 1 CSS Bootstrap Icons
+ 2 font Bootstrap Icons + 1 mermaid.min.js).

## Cara Pakai

```html
<!-- Poppins (relatif terhadap public/) -->
<link rel="stylesheet" href="{{ asset('gde-ui-templates/fonts/poppins.css') }}">

<!-- Bootstrap Icons -->
<link rel="stylesheet" href="{{ asset('gde-ui-templates/icons/bootstrap-icons.css') }}">

<!-- Mermaid (opsional, untuk dokumentasi/diagram) -->
<script src="{{ asset('gde-ui-templates/js/vendor/mermaid.min.js') }}"></script>
```

Catatan: `poppins.css` mereferensikan berkas `.woff2` secara **relatif** (`url('poppins-400-latin.woff2')`),
dan `bootstrap-icons.css` mereferensikan `url("fonts/bootstrap-icons.woff2")`. Karena itu kedua
folder harus dipertahankan strukturnya seperti di atas.

Subset yang disertakan hanya **latin** dan **latin-ext**. Teks berbahasa Indonesia
sepenuhnya tercakup oleh subset `latin`.

## Sumber Unduhan & Lisensi

| Aset | Versi | Sumber | Lisensi |
|---|---|---|---|
| Poppins | v24 (Google Fonts CSS2 API), weight 300–800 | `fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap` → berkas dari `fonts.gstatic.com/s/poppins/v24/` | **SIL Open Font License 1.1 (OFL-1.1)** — bebas di-self-host |
| Bootstrap Icons | 1.11.3 | `cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css` | **MIT** |
| Mermaid | 10.9.4 | `cdn.jsdelivr.net/npm/mermaid@10.9.4/dist/mermaid.min.js` | **MIT** |

Poppins: © Indian Type Foundry — <https://fonts.google.com/specimen/Poppins>
Bootstrap Icons: © The Bootstrap Authors — <https://icons.getbootstrap.com/>
Mermaid: © Knut Sveidqvist & contributors — <https://mermaid.js.org/>

## Cara Memperbarui

Semua langkah dilakukan dengan `curl`/`bash` (tanpa PHP/Node), dijalankan dari root repo.

### 1. Perbarui Poppins

```bash
cd public/gde-ui-templates/fonts
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" -o /tmp/poppins.css
```

1. Buka `/tmp/poppins.css`, ambil semua URL `https://fonts.gstatic.com/...woff2`
   **hanya untuk blok `/* latin */` dan `/* latin-ext */`** (abaikan cyrillic, devanagari, vietnamese).
2. Unduh tiap URL, simpan dengan pola nama `poppins-<weight>-<subset>.woff2`
   (mis. `poppins-400-latin-ext.woff2`).
3. Perbarui `poppins.css`: satu blok `@font-face` per berkas, dengan
   `font-family: 'Poppins'`, `font-style: normal`, `font-display: swap`,
   `font-weight` sesuai berat, `src: url('<nama-file>') format('woff2')`, dan
   `unicode-range` disalin apa adanya dari CSS Google Fonts.
4. Pastikan **tidak ada** string `https://` di dalam `poppins.css`
   (tulis URL sumber tanpa skema pada komentar header).

### 2. Perbarui Bootstrap Icons

```bash
cd public/gde-ui-templates/icons
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
VER=1.11.3   # ganti sesuai versi baru
curl -s -f -A "$UA" "https://cdn.jsdelivr.net/npm/bootstrap-icons@$VER/font/bootstrap-icons.css" -o bootstrap-icons.css
curl -s -f -A "$UA" "https://cdn.jsdelivr.net/npm/bootstrap-icons@$VER/font/fonts/bootstrap-icons.woff2" -o fonts/bootstrap-icons.woff2
curl -s -f -A "$UA" "https://cdn.jsdelivr.net/npm/bootstrap-icons@$VER/font/fonts/bootstrap-icons.woff"  -o fonts/bootstrap-icons.woff
```

Lalu normalisasi CSS (hapus query string `?hash`, ubah `./fonts/` → `fonts/`, buang skema `https://`):

```bash
sed -i '' -E 's|url\("\./fonts/([^"?]*)\?[^"]*"\)|url("fonts/\1")|g' bootstrap-icons.css
sed -i '' 's|https://||g' bootstrap-icons.css
```

### 3. Perbarui Mermaid

```bash
cd public/gde-ui-templates/js/vendor
curl -sL -f "https://cdn.jsdelivr.net/npm/mermaid@<VERSI>/dist/mermaid.min.js" -o mermaid.min.js
```

### 4. Verifikasi Setelah Memperbarui

```bash
cd public/gde-ui-templates

# magic bytes woff2 harus 774f4632 ("wOF2"), woff harus 774f4646 ("wOFF")
for f in fonts/*.woff2 icons/fonts/*.woff2; do printf "%s %s\n" "$(xxd -l 4 -p "$f")" "$f"; done

# tidak boleh ada referensi remote di CSS
grep -c 'https://' fonts/poppins.css icons/bootstrap-icons.css   # harus 0 dan 0

# ukuran
ls -lR .
du -sh .
```

Ekspektasi ukuran wajar: woff2 Poppins ±5–8 KB per berkas (subset latin/latin-ext),
`bootstrap-icons.woff2` ±130 KB, `mermaid.min.js` ±3,2 MB.

## Catatan

- Berkas di folder ini **tidak mengubah** Blade apa pun; template lama di
  `public/DashboardTemplates/` tidak disentuh dan tetap dibiarkan apa adanya.
- Untuk migrasi bertahap, cukup ganti tag `<link>`/`<script>` yang menunjuk ke CDN
  menjadi `asset('gde-ui-templates/...')` seperti pada bagian *Cara Pakai*.
