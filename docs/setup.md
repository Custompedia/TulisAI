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

Migrasi `0000`–`0012` diterapkan berurutan. `0011_mkl_identity_bridge.sql` menambah otoritas link identitas eksternal `(issuer, subject)` serta guard database yang menolak link admin, promosi linked customer menjadi admin, dan penghapusan akun yang masih linked. `0012_b3_entitlement_authority.sql` menambah organisasi terverifikasi pada link, checkpoint/proyeksi entitlement MKL, grant support/test nonkomersial, dan evidence portabilitas DOCX. Migrasi B3 tidak membuat offer, order, payment, atau wallet.

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

Implicit provider linking dinonaktifkan untuk mencegah pengambilalihan akun berdasarkan kecocokan email. Akibatnya, akun Google yang sudah tertaut tetap dapat login dan akun Google baru dengan email yang belum dipakai tetap dapat dibuat, tetapi Google dengan email terverifikasi yang sudah dimiliki akun lokal lain akan ditolak dan tidak pernah diadopsi otomatis. Pengguna harus masuk melalui metode yang sudah dimiliki akun lokal tersebut; B2 tidak menambahkan UI penautan Google baru.

## MKL OIDC identity bridge

Bridge MKL memakai Authorization Code + PKCE S256 dan mempertahankan Better Auth sebagai otoritas sesi lokal. Konfigurasi identity runtime adalah `MKL_ISSUER`, `MKL_CLIENT_ID`, `MKL_CLIENT_SECRET`, dan `BETTER_AUTH_URL`. B3 juga mengenal `MKL_APP_KEY`, `MKL_CATALOG_ITEM_ID`, serta secret commerce/API yang terpisah, `MKL_APP_API_SECRET`. `MKL_APP_API_SECRET` tidak boleh memakai ulang `MKL_CLIENT_SECRET`. Semua secret hanya boleh diberikan melalui binding secret lokal/Cloudflare dan tidak boleh ditaruh di repository. Nilai produksi yang dikunci adalah:

- issuer: `https://marikitalembur.com`
- origin aplikasi: `https://tulis.marikitalembur.com`
- callback: `https://tulis.marikitalembur.com/api/auth/mkl/callback`
- post-logout: `https://tulis.marikitalembur.com/`

Client ID, app key, catalog item, dan secret produksi belum ditetapkan di source karena commissioning TulisAI belum dilakukan. Untuk test/dev, gunakan nilai test eksplisit dan origin localhost. Endpoint lokal bridge adalah `POST /api/auth/mkl/start`, `POST /api/auth/mkl/link/start`, `GET /api/auth/mkl/callback`, serta `GET`/`POST /api/account/mkl/link/confirm`.

Email dari MKL hanya profil dan pemeriksaan konflik; link selalu menggunakan issuer + subject dan menyimpan claim `mkl_organization_id` yang terverifikasi. Email yang sama tidak pernah mengadopsi akun lokal. Akun admin lokal tidak dapat memakai link pelanggan MKL. Logout TulisAI hanya mencabut sesi TulisAI dan tidak menghapus link atau mengklaim logout global MKL. Unlink belum tersedia; implementasinya menunggu reautentikasi, alternate login, recovery, dan tombstone audit.

Saat konfigurasi B3 lokal lengkap, callback yang baru memverifikasi ID token membaca `GET /app/v1/entitlements` dengan `MKL-Id-Token`, client ID, dan `MKL_APP_API_SECRET`. ID token mentah, authorization code, verifier PKCE, SSO secret, app API secret, dan payment secret tidak disimpan. Hak berbayar hanya hidup sampai minimum `fresh_until` (15 menit dari verifikasi) dan `period_end`; provider outage boleh memakai cache positif yang masih fresh, sedangkan cache stale/invalid selalu fail-closed. `/api/access` adalah bentuk authority yang jujur; `/api/usage` mempertahankan field lama dan menambahkan objek `access` sebagai adapter kompatibilitas.

## OpenRouter dan privacy gate

AI memakai `OPENROUTER_API_KEY` dan `OPENROUTER_MODEL`. Model wajib dipilih dan diuji berdasarkan structured output prompt final v1. Provider request hardcoded `provider.data_collection=deny`. `AI_PUBLIC_ENABLED` harus tetap `false` sampai retensi dan privacy setting provider diverifikasi secara nyata.

B4 mengganti authority karakter komersial dengan grants, purchased lots,
reservations, dan allocations di D1. Free selalu 3.000 sekali per akun;
`AI_FREE_CHARACTER_ALLOWANCE`, local tier, role admin, capability grant, dan
`ai_character_limit_override` bukan sumber nilai wallet. `usage_ledger` tetap
telemetry/analytics dan `AI_MONTHLY_REQUEST_LIMIT` tetap pengaman request
kalender yang terpisah. Lihat `docs/b4-character-wallet.md` untuk cutover,
lease 90 detik, recovery, dan batas internal B5. Timeout, response size,
idempotency, dan status provider error tetap dipertahankan sebagai error;
aplikasi tidak mengganti kegagalan dengan output palsu.

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
pnpm exec wrangler secret put MKL_CLIENT_SECRET
# Hanya setelah commissioning aplikasi disetujui; jangan gunakan MKL_CLIENT_SECRET:
pnpm exec wrangler secret put MKL_APP_API_SECRET
pnpm exec wrangler secret put OPENROUTER_API_KEY
```

Set `BETTER_AUTH_URL` pada vars ke origin Worker/domain target dan daftarkan callback Google yang sama. `MKL_CLIENT_ID`, `MKL_APP_KEY`, dan `MKL_CATALOG_ITEM_ID` baru boleh diisi setelah client/application row disetujui dan diregistrasikan; registrasi redirect/post-logout, aktivasi SSO, app API secret, dan commissioning entitlement adalah langkah terpisah. B3 lokal ini bukan izin untuk membuat client/secret produksi. Terapkan migrasi dengan `wrangler d1 migrations apply <database_name> --remote` hanya setelah database target diverifikasi. Build dan dry-run dahulu; `pnpm exec wrangler deploy` merupakan langkah eksternal terpisah setelah persetujuan rilis. AI tetap `false` sampai konfigurasi provider, kuota, dan evaluasi hasil disetujui.

Sebelum update berikutnya, catat versi Worker aktif dan ambil backup D1 menggunakan `wrangler d1 export <database_name> --remote --output <backup.sql>` ke lokasi privat. Rollback Worker melalui `wrangler rollback <version-id>` tidak mengembalikan data D1/R2; migrasi data memerlukan rencana pemulihan tersendiri. Migrasi initial hanya dijalankan sekali dan belum memiliki migrasi destruktif.

Setelah resource tersedia, verifikasi login/callback, CRUD dan restore akun uji, satu generate–preview–apply, kuota, ownership, penghapusan, dan cron pada staging. Build/dry-run lokal tidak menggantikan pemeriksaan ini.
