# AI Writing Workspace — setup lokal

Dokumen ini menjelaskan setup lokal untuk core MVP. Kredensial Google OAuth, OpenRouter, dan resource Cloudflare belum tersedia pada workspace ini; login username/password memakai D1 lokal dengan secret lokal; Google dan AI memerlukan kredensial tambahan. Tidak ada klaim bahwa deployment production sudah berhasil.

## Prasyarat

- Node.js >=22.16 (tests memakai `node:sqlite`).
- pnpm 10.33.2.
- Wrangler 4 untuk D1/R2 lokal.

Install dependency dan salin konfigurasi:

```sh
pnpm install --frozen-lockfile
cp .env.example .dev.vars
```

`.dev.vars` hanya untuk mesin lokal dan tidak boleh di-commit. Isi `BETTER_AUTH_SECRET` dengan random secret. Biarkan `AI_PUBLIC_ENABLED=false` sampai privacy provider diverifikasi.

## Database dan development

Migrasi `0000`–`0002` diterapkan berurutan; `0002_workspace_metadata.sql` menambah preferensi onboarding dan metadata mode/scope versi.

Konfigurasi Worker ada di `wrangler.jsonc`. Binding lokal yang digunakan adalah `DB` (D1) dan `DOCUMENTS` (R2). Terapkan migrasi lokal:

```sh
pnpm db:migrate:local
pnpm dev
```

URL dev berasal dari output Vinext. Jalankan gate lokal sebelum review:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Pemeriksaan lokal Cloudflare; `cf:check` melakukan dry-run tanpa deploy, sedangkan `cf:types` memperbarui file tipe binding:

```sh
pnpm cf:check
pnpm cf:types
```

Vinext masih beta pada toolchain ini; perlakukan perubahan adapter/runtime sebagai risiko dan verifikasi build setiap kali dependency diperbarui.

## Login username/password dan Google OAuth

Login kredensial selalu tersedia saat `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, dan binding D1 terisi; Google bersifat opsional. Terapkan migrasi `0001_username_auth.sql` melalui perintah migrasi yang sama sebelum membuka registrasi.

Endpoint Better Auth berada di bawah `/api/auth`:

- `POST /sign-up/email`: `{ name, email, username, password, callbackURL? }`
- `POST /sign-in/email`: `{ email, password, rememberMe?, callbackURL? }`
- `POST /sign-in/username`: `{ username, password, rememberMe?, callbackURL? }`
- `POST /sign-out`: `{}` dengan cookie sesi

Username dinormalisasi menjadi lowercase tanpa spasi di tepi, wajib 3--30 karakter, diawali dan diakhiri huruf/angka, dan hanya menerima huruf kecil, angka, titik, atau underscore. Indeks unik D1 menjamin username tidak dapat diduplikasi tanpa membedakan kapital. Password wajib 10--128 karakter dan hash dikelola Better Auth; password tidak pernah disimpan sebagai teks biasa. Akun Google boleh memiliki username kosong; login Google tetap tersedia untuk akun tersebut.

Reset password (`/forgot-password` → email → `/reset-password`, token 1 jam), ganti password, dan ganti email (link verifikasi ke email baru, lalu redirect ke `/settings?email=changed#profil`) memakai Cloudflare Email Service. Akun Google tanpa password dapat menambah password lewat `POST /api/account/password`.

## Email (Cloudflare Email Service)

1. Onboarding Email Service di dashboard Cloudflare (Compute → Email Service) dan verifikasi domain pengirim (DNS SPF/DKIM dibuat otomatis bila domain ada di Cloudflare).
2. Binding `send_email` bernama `EMAIL` sudah ada di `wrangler.jsonc`. Ganti var `EMAIL_FROM` (`no-reply@REPLACE_WITH_VERIFIED_DOMAIN`) dengan alamat di domain terverifikasi, lalu jalankan `pnpm cf:types`.
3. Tanpa binding atau dengan `EMAIL_FROM` placeholder, endpoint email mengembalikan `EMAIL_CONFIGURATION_REQUIRED` (503) dan UI menampilkan "Pengiriman email belum dikonfigurasi". Saat `pnpm dev`, email disimulasikan secara lokal oleh Miniflare.

Better Auth menyimpan pembatasan brute-force di tabel D1 `rate_limit`: maksimal 10 permintaan per menit untuk `/sign-in/username` dan `/sign-in/email`, 5 per menit untuk `/sign-up/email` dan `/change-password`, serta 3 per menit untuk `/request-password-reset` dan `/change-email`. Key memakai `cf-connecting-ip`, sehingga header tersebut hanya boleh diteruskan oleh Cloudflare Worker. Endpoint auth mengembalikan JSON 503 bila `BETTER_AUTH_SECRET` atau `BETTER_AUTH_URL` belum diisi.

Untuk Google, isi `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET`, lalu set `BETTER_AUTH_URL` ke origin dev yang digunakan. Callback Better Auth berada di:

`http://localhost:3000/api/auth/callback/google`

Jika port berbeda, ganti host dan port sesuai URL dev. Tambahkan callback exact tersebut di Google Cloud OAuth client. Login UI memulai `POST /api/auth/sign-in/social` dengan `{ provider: "google", callbackURL: "/app" }`; cancel, expired session, dan konfigurasi yang hilang harus menghasilkan pesan yang dapat dipahami pengguna.

## OpenRouter dan privacy gate

AI memakai `OPENROUTER_API_KEY` dan `OPENROUTER_MODEL`. Model wajib dipilih dan diuji berdasarkan structured output prompt final v1. Provider request hardcoded `provider.data_collection=deny`. `AI_PUBLIC_ENABLED` harus tetap `false` sampai retensi dan privacy setting provider diverifikasi secara nyata.

`AI_MONTHLY_CHARACTER_LIMIT` (default 100000) adalah kuota karakter bulanan untuk tier Gratis dan merupakan cap yang benar-benar ditegakkan; tier berbayar memakai angka di `src/lib/plans.ts`. `AI_MONTHLY_REQUEST_LIMIT` kini hanya angka informasi di panel admin. Keduanya batas operasional internal, bukan harga atau paket komersial. Timeout, response size, quota reservation, idempotency, dan status provider error harus dipertahankan sebagai error; aplikasi tidak boleh mengganti kegagalan dengan output palsu.

## Cloudflare sebelum deployment

Ganti `database_id` placeholder pada `wrangler.jsonc` dengan D1 database nyata dan buat R2 bucket sesuai nama binding. Set secrets melalui Wrangler pada environment yang tepat. Jangan memasukkan key ke client bundle atau file yang di-commit. Terapkan migrasi pada database target secara terpisah dan review rollback sebelum deployment.

Preview AI berumur 24 jam. Worker menjalankan cron hourly (`17 * * * *`) untuk cleanup bounded, sehingga penghapusan bersifat eventual dan dapat tertunda. Working document dan versions disimpan sampai pengguna menghapusnya. Penghapusan mencakup snapshots, preview, locks, serta cache IndexedDB berprefix `writing-draft:<userId>:`; log operasional tidak menyimpan source text, output, selection, extra request, judul sensitif, atau prompt.

Cron cleanup sudah dideklarasikan hourly pada `wrangler.jsonc`; verifikasi handler, binding, bounded batch, eventual expiry, observability, dan retry policy pada environment target sebelum production. R2 orphan berumur 24 jam atau lebih masuk cleanup.

Quota operasional default adalah 100 attempts per bulan dan 10 attempts per menit. Attempt mencakup request gagal dan repair; pending/unknown provider timeout tidak boleh diulang buta. Staging harus memakai konfigurasi Wrangler dan binding D1/R2 terpisah; pemisahan environment belum tersedia otomatis dan harus dideklarasikan operator sebelum deployment.

## Batas rilis saat ini

Impor dan ekspor DOCX tersedia sebagai fitur berbayar (lihat task.md §13); fontnya ada di `public/fonts` (Carlito, OFL) dan dipakai pratinjau berhalaman. Masih tidak tercakup: OCR, impor/ekspor PDF, template, collaboration, sharing, plagiarism checker, AI detector, reference manager, advanced document intelligence, dan complex table extraction. P09 Quality Evaluation juga bukan blocker dan tidak boleh memiliki CTA runtime sebelum benar-benar diaktifkan.

## Paket staging dan rollback

Perintah berikut adalah panduan operator dan belum dijalankan pada resource remote. Siapkan akun Cloudflare dan login Wrangler terlebih dahulu. Gunakan nama staging yang terpisah dari produksi:

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create ai-writing-workspace-staging
pnpm exec wrangler r2 bucket create ai-writing-workspace-staging-documents
```

Salin `wrangler.jsonc` menjadi konfigurasi staging, lalu ubah nama Worker, `database_name`, `database_id`, dan `bucket_name` sesuai hasil create. Binding tetap `DB` dan `DOCUMENTS`. Untuk build staging, gunakan konfigurasi tersebut sebagai konfigurasi aktif Vite/Cloudflare sebelum `pnpm build`; jangan mengirim build produksi ke binding staging atau sebaliknya.

Set secret memakai input interaktif Wrangler agar nilainya tidak menjadi argumen shell:

```sh
pnpm exec wrangler secret put BETTER_AUTH_SECRET
pnpm exec wrangler secret put GOOGLE_CLIENT_ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm exec wrangler secret put OPENROUTER_API_KEY
```

Set `BETTER_AUTH_URL` pada vars ke origin Worker/domain target dan daftarkan callback Google yang sama. Terapkan migrasi dengan `wrangler d1 migrations apply <database_name> --remote` hanya setelah database target diverifikasi. Build dan dry-run dahulu; `pnpm exec wrangler deploy` merupakan langkah eksternal terpisah setelah persetujuan rilis. AI tetap `false` sampai konfigurasi provider, kuota, dan evaluasi hasil disetujui.

Sebelum update berikutnya, catat versi Worker aktif dan ambil backup D1 menggunakan `wrangler d1 export <database_name> --remote --output <backup.sql>` ke lokasi privat. Rollback Worker melalui `wrangler rollback <version-id>` tidak mengembalikan data D1/R2; migrasi data memerlukan rencana pemulihan tersendiri. Migrasi initial hanya dijalankan sekali dan belum memiliki migrasi destruktif.

Setelah resource tersedia, verifikasi login/callback, CRUD dan restore akun uji, satu generate–preview–apply, kuota, ownership, penghapusan, dan cron pada staging. Build/dry-run lokal tidak menggantikan pemeriksaan ini.
