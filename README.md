# Efektivitas Bulanan

Pengatur keuangan bulanan bergaya **editorial-luxury** untuk dipakai berdua. Web statis (HTML/CSS/JS) + Supabase untuk login dan penyimpanan data. Bisa di-hosting gratis di GitHub Pages.

> **Mode demo** tersedia tanpa backend. Data demo disimpan di `localStorage` browser.

## Fitur

- **Dashboard**: total budget, terpakai, sisa, aman/hari, progress bar, grafik kumulatif, donut kategori, bar harian, insight otomatis, transaksi terakhir.
- **Budget**: set budget awal bulan dan tambahan. Sisa otomatis bertambah saat budget ditambah dan berkurang saat pengeluaran dicatat.
- **Pengeluaran**: catat, edit, hapus, cari, filter kategori, dikelompokkan per tanggal.
- **Menu & Jajan**: preset masakan dan jajanan (harga bisa diubah). Klik **Catat** untuk langsung mengisi form pengeluaran.
- **Shared rumah tangga**: 2 akun bisa melihat dan mengedit data yang sama lewat kode undangan.
- **Login kode/QR**: owner bisa memakai kode 5 karakter atau QR untuk masuk dari perangkat lain tanpa email.
- **Multi-bulan**: pilih bulan lewat kontrol bulan di header.
- **Export JSON** untuk backup.
- **Realtime** (Supabase): perubahan dari akun pasangan langsung tersinkron.
- **Keamanan**: Supabase Auth + Row Level Security (RLS). Anon key aman di frontend selama RLS aktif.
- **Tampilan**: kertas hangat, hijau tua, aksen emas, tipografi Fraunces + Manrope.

## Struktur

```
index.html
css/style.css
js/config.js      # URL + anon key Supabase
js/utils.js       # format uang, tanggal, helper
js/store.js       # SupabaseStore + DemoStore
js/app.js         # UI & logika aplikasi
supabase/schema.sql
supabase/config.toml
supabase/functions/code-login/index.ts   # Edge Function login kode/QR
```

## Coba dulu (tanpa setup)

Buka situs, klik **Coba Mode Demo**. Data contoh bulan ini dan bulan depan otomatis dibuat, termasuk daftar masak/jajan.

Reset data demo: **Pengaturan → Reset Data Demo**.

## Setup Supabase (gratis)

1. Buat project di [supabase.com](https://supabase.com).
2. Buka **SQL Editor**, salin seluruh isi `supabase/schema.sql`, lalu **Run**.
   - Jika project sudah pernah memakai schema lama, jalankan ulang file yang sama. Bagian akses kode bersifat idempotent dan akan membuat kode untuk rumah tangga yang sudah ada.
3. Deploy Edge Function login kode/QR:
   ```bash
   npx supabase login
   npx supabase functions deploy code-login --remote=<project-ref> --use-api --no-verify-jwt --yes
   ```
   Ganti `<project-ref>` dengan ID project Supabase (mis. `cntuzjthzvmwuoulqjkt`). Function ini otomatis memakai `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`; jangan menaruh service role di frontend.
4. Buka **Project Settings → API**, salin:
   - `Project URL`
   - `anon public` key
5. Isi dua nilai itu di `js/config.js`:

   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...",
   ```

   Alternatif: buka situs → **Panduan Setup** → tempel URL + anon key. Nilai disimpan di `localStorage` browser (tanpa mengubah file).

6. **Authentication → Providers → Email**:
   - Untuk masa testing, matikan **Confirm email** agar langsung bisa login setelah daftar.
   - Setelah akun kamu dan pasangan dibuat, matikan **Allow new users to sign up** supaya tidak ada akun random.
7. **Authentication → URL Configuration**:
   - `Site URL`: URL GitHub Pages kamu, mis. `https://im-tarooo.github.io/effectivity-bulanan/`
   - Tambahkan URL itu juga di `Redirect URLs`.

> Jangan pernah memakai `service_role` key di frontend. Yang dipakai hanya `anon public`.

## Alur 2 user

1. User pertama daftar → **Buat Rumah Tangga**.
2. Buka **Pengaturan**, salin **Kode undangan**.
3. User kedua daftar → **Gabung** dengan kode tersebut.
4. Keduanya sekarang melihat budget dan pengeluaran yang sama.

## Login kode/QR

1. Owner buka **Pengaturan → Akses Kode**.
2. Salin **kode 5 karakter** atau tunjukkan **QR** ke perangkat lain.
3. Di perangkat baru, scan QR (langsung masuk) atau buka tab **Kode** lalu masukkan kodenya.
4. Kode/QR bisa diedit atau diacak kapan saja. Mengganti kode akan membuat QR lama tidak berlaku.

> Perangkat baru masuk sebagai **akun owner yang sama**, bukan anggota baru. Siapa pun yang memegang kode/QR bisa mengakses data owner, jadi jaga kerahasiaannya. Login email tetap tersedia sebagai cadangan.

## Deploy ke GitHub Pages

Repo: `https://github.com/IM-Tarooo/effectivity-bulanan`

```bash
git init
git add .
git commit -m "feat: efektivitas bulanan finance app"
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
- `household_access` — kode 5 karakter + token QR milik owner. Hanya bisa dibaca lewat RPC owner.
- `access_login_attempts` — catatan percobaan login untuk rate limit Edge Function.

Semua tabel memakai RLS: user hanya bisa mengakses data rumah tangga tempat dia menjadi anggota.

## Troubleshooting

| Masalah | Solusi |
| --- | --- |
| Tidak bisa daftar / login | Cek URL + anon key. Pastikan schema.sql sudah dijalankan. |
| "Email not confirmed" | Matikan Confirm email di Supabase, atau konfirmasi lewat inbox. |
| "Login kode belum aktif" | Edge Function `code-login` belum di-deploy. Jalankan langkah deploy di atas. |
| "Kode akses tidak valid" | Pastikan 5 karakter benar. Setelah 8–20 percobaan gagal, tunggu 10 menit. |
| QR tidak muncul | Pastikan CDN `qrcodejs` tidak diblokir, lalu refresh. |
| Kode akses hilang setelah update | Jalankan ulang `schema.sql`; backfill akan membuat kode untuk rumah tangga lama. Buka **Pengaturan → Akses Kode**. |
| Tidak bisa daftar akun baru | Signup memang dimatikan. Nyalakan sementara **Allow new users to sign up**, buat akun, lalu matikan lagi. |
| Data tidak muncul | Pastikan user sudah tergabung di rumah tangga. Cek RLS aktif. |
| Grafik kosong | Pastikan Chart.js CDN tidak diblokir. Coba refresh. |
| Perubahan pasangan tidak muncul | Refresh halaman. Realtime butuh tabel `entries` di publication Supabase. |
| Ingin ganti project Supabase | Klik **Ganti koneksi Supabase** di halaman login, hapus `efb_config` di localStorage, atau edit `js/config.js`. |
| `git push` ditolak 403 / Permission denied | Login sebagai pemilik repo: `gh auth login` lalu pilih akun `IM-Tarooo`, atau tambahkan akun yang dipakai sebagai collaborator repo. |

## Keamanan

- RLS wajib aktif (sudah ada di schema).
- Setelah 2 akun dibuat, matikan signup publik.
- Jangan commit `service_role` key. Service role hanya dipakai di Edge Function `code-login` (otomatis dari environment Supabase).
- Kode 5 karakter mudah ditebak; QR memakai token 64 karakter. Jangan bagikan kode/QR ke orang yang tidak dipercaya.
- Login kode dibatasi 8 percobaan gagal per IP dan 20 per kode/token dalam 10 menit.
- Untuk perlindungan penuh di level situs, gunakan Cloudflare Access.
