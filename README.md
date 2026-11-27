# Efektivitas Bulanan

Pengatur keuangan bulanan bergaya **neon circuit** untuk dipakai berdua. Web statis (HTML/CSS/JS) + Supabase untuk login dan penyimpanan data. Bisa di-hosting gratis di GitHub Pages.

> **Mode demo** tersedia tanpa backend. Data demo disimpan di `localStorage` browser.

## Fitur

- **Dashboard**: total budget, terpakai, sisa, aman/hari, progress bar, grafik kumulatif, donut kategori, bar harian, insight otomatis, transaksi terakhir.
- **Budget**: set budget awal bulan dan tambahan. Sisa otomatis bertambah saat budget ditambah dan berkurang saat pengeluaran dicatat.
- **Pengeluaran**: catat, edit, hapus, cari, filter kategori, dikelompokkan per tanggal.
- **Menu & Jajan**: preset masakan dan jajanan (harga bisa diubah). Klik **Catat** untuk langsung mengisi form pengeluaran.
- **Shared rumah tangga**: 2 akun bisa melihat dan mengedit data yang sama lewat kode undangan.
- **Multi-bulan**: pilih bulan lewat kontrol bulan di header.
- **Export JSON** untuk backup.
- **Realtime** (Supabase): perubahan dari akun pasangan langsung tersinkron.
- **Keamanan**: Supabase Auth + Row Level Security (RLS). Anon key aman di frontend selama RLS aktif.

## Struktur

```
index.html
css/style.css
js/config.js      # URL + anon key Supabase
js/utils.js       # format uang, tanggal, helper
js/store.js       # SupabaseStore + DemoStore
js/app.js         # UI & logika aplikasi
supabase/schema.sql
```

## Coba dulu (tanpa setup)

Buka situs, klik **Coba Mode Demo**. Data contoh bulan ini dan bulan depan otomatis dibuat, termasuk daftar masak/jajan.

Reset data demo: **Pengaturan → Reset Data Demo**.

## Setup Supabase (gratis)

1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, copy-paste seluruh isi `supabase/schema.sql`, lalu **Run**.
3. Buka **Project Settings → API**, salin:
   - `Project URL`
   - `anon public` key
4. Isi dua nilai itu di `js/config.js`:

   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...",
   ```

   Alternatif: buka situs → **Panduan Setup** → tempel URL + anon key. Nilai disimpan di `localStorage` browser (tanpa mengubah file).

5. **Authentication → Providers → Email**:
   - Untuk masa testing, matikan **Confirm email** agar langsung bisa login setelah daftar.
   - Setelah akun kamu dan pasangan dibuat, matikan **Allow new users to sign up** supaya tidak ada akun random.
6. **Authentication → URL Configuration**:
   - `Site URL`: URL GitHub Pages kamu, mis. `https://im-tarooo.github.io/effectivity-bulanan/`
   - Tambahkan URL itu juga di `Redirect URLs`.

> Jangan pernah memakai `service_role` key di frontend. Yang dipakai hanya `anon public`.

## Alur 2 user

1. User pertama daftar → **Buat Rumah Tangga**.
2. Buka **Pengaturan**, salin **Kode undangan**.
3. User kedua daftar → **Gabung** dengan kode tersebut.
4. Keduanya sekarang melihat budget dan pengeluaran yang sama.

## Deploy ke GitHub Pages

Repo: `https://github.com/IM-Tarooo/effectivity-bulanan`

```bash
git init
git add .
git commit -m "feat: efektivitas bulanan neon finance app"
git branch -M main
git remote add origin https://github.com/IM-Tarooo/effectivity-bulanan.git
git push -u origin main
```

Lalu di GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**.

Situs akan tersedia di:

```
https://im-tarooo.github.io/effectivity-bulanan/
```

### Catatan akses GitHub Pages

- GitHub Pages untuk **repo private** membutuhkan GitHub Pro. Jika repo public, situsnya bisa dilihat siapa saja, **tetapi data tetap aman** karena butuh login dan dilindungi RLS.
- Anon key terlihat di source (itu normal dan aman selama RLS aktif). Jangan taruh `service_role` key.
- Ingin seluruh situs dikunci (bukan hanya data)? Pakai **Cloudflare Pages + Cloudflare Access** (gratis, email OTP) atau Netlify password protection (berbayar). Ini opsional; login + RLS sudah melindungi data.

## Menjalankan lokal

Karena memakai CDN dan localStorage, sebaiknya lewat server lokal:

```bash
npx serve .
# atau
python -m http.server 8000
```

Buka `http://localhost:8000` (atau port yang ditampilkan).

## Model data

- `households` — rumah tangga + kode undangan.
- `household_members` — anggota (user) dan nama tampilan.
- `entries` — transaksi; `type = 'budget' | 'expense'`. Sisa = total budget − total pengeluaran.
- `menu_items` — preset masak/jajan.

Semua tabel memakai RLS: user hanya bisa mengakses data rumah tangga tempat dia menjadi anggota.

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| Tidak bisa daftar / login | Cek URL + anon key. Pastikan schema.sql sudah dijalankan. |
| "Email not confirmed" | Matikan Confirm email di Supabase, atau konfirmasi lewat inbox. |
| Data tidak muncul | Pastikan user sudah tergabung di rumah tangga. Cek RLS aktif. |
| Grafik kosong | Pastikan Chart.js CDN tidak diblokir. Coba refresh. |
| Perubahan pasangan tidak muncul | Refresh halaman. Realtime butuh tabel `entries` di publication Supabase. |
| Ingin ganti project Supabase | Hapus `efb_config` di localStorage, atau edit `js/config.js`. |

## Keamanan

- RLS wajib aktif (sudah ada di schema).
- Setelah 2 akun dibuat, matikan signup publik.
- Jangan commit `service_role` key.
- Untuk perlindungan penuh di level situs, gunakan Cloudflare Access.
