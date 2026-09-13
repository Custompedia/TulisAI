# Bukti implementasi dan review

Tanggal: 12 September 2026. Pelaksana awal Luna/Terra; Astra melakukan review, perbaikan integrasi, dan verifikasi akhir.

## Batas bukti

Implementasi core MVP tersedia di workspace lokal. Tidak ada kredensial Google OAuth/OpenRouter atau resource Cloudflare remote; tidak ada login Google nyata, panggilan model berbayar, push, deployment, maupun verifikasi browser. HTTP smoke hanya membuktikan shell SSR dan respons konfigurasi, bukan interaksi pengguna terautentikasi. Build dan tes tidak membuktikan kualitas visual di perangkat atau kualitas semantik model live.

## Gate lokal

| Gate | Hasil |
| --- | --- |
| `pnpm typecheck` | Lulus TypeScript strict |
| `pnpm lint --max-warnings=0` | Lulus, tanpa warning |
| `pnpm test` | 70 tes, 6 file; termasuk 19 kontrak fixture evaluasi |
| `pnpm db:migrate:local` | Migrasi initial berhasil pada D1 lokal melalui Wrangler |
| `pnpm build` | Bundle client, RSC, SSR dan route API berhasil |
| `pnpm cf:check` | Wrangler deploy dry-run; tidak ada deployment |
| `pnpm cf:types` | Tipe binding Worker diperbarui |
| HTTP dev smoke tanpa browser | Enam shell halaman HTTP 200; `/api/me` menolak dengan 503 CONFIGURATION_REQUIRED sesuai kredensial yang belum tersedia |

CI tersedia di `.github/workflows/quality.yml`; belum berjalan pada remote Git. Source asli PRD, blueprint, dan prompt referensi tidak diubah. Registry memeriksa sembilan hash prompt final v1 yang tetap.

## Pemetaan task dan bukti

| Task | Implementasi | Bukti utama |
| --- | --- | --- |
| M01-F01–F04 | package/lockfile, Vite/Vinext, migrations, D1/Drizzle, R2, CI, env templates | Build Workers, dry-run, migrasi lokal, SQLite integration |
| M02-U01–U04 | globals.css, workspace components, Tiptap/ProseMirror, ID/EN dan drawer responsif | Typecheck/build, serializer fixtures; layout ditinjau dari source, belum browser |
| M03-D01 | Better Auth Google handler, server session ownership, login/logout | Real Better Auth + Drizzle adapter dengan SQLite; Google callback live belum diuji |
| M03-D02/D06 | landing contoh statis, Quick Start, daftar paginated, new document | Route dan payload direview; input kosong tidak memanggil AI |
| M03-D03/D04 | autosave revision, IndexedDB per owner/dokumen, recovery/copy, prefs | Stale revision, original immutable dan source snapshot sebelum Apply diuji |
| M03-D05 | settings/usage API, hapus akun/dokumen, local draft preferences | Kontrak UI/backend diselaraskan, owner scope, bounded deletion dan orphan cleanup |
| M04-S01/S02 | checkpoint, timeline, rename, restore, A/B compare/deep link | SQLite history tests, scoped ProseMirror fixtures dan diff lokal |
| M04-S03 | metrics lokal dan bounded diff | Empty/Unicode/ID/EN/input besar diuji |
| M04-S04/S05 | term locks persisted, visual decoration, author-year citation detection | Exact multiplicity, angka, sitasi baru, scope dan lock-race tests |
| M05-A01/A02 | registry dan runtime/response schemas final v1 | Hash baseline, sembilan registry prompt, runtime P01–P08/P10 fixtures |
| M05-A03/A04 | OpenRouter, privacy deny, quota reservation, timeout/size bounds, ledger | Transport provider di-mock; request ganda tidak membuat panggilan kedua |
| M05-A05/A06 | validasi, single P10, preview stored, atomic Apply/Discard | Repaired text normalizes correctly, P07 unsafe rejected tanpa repair, stale Apply dan replay tests |
| M06-W01–W08 | enam mode, Custom, Sesuaikan, preview/compare/copy/apply/discard | UI wired ke route aktual; fixture runtime dan pipeline safety lulus; kualitas live menunggu provider |
| M07-I01–I03 | scoped P07, Humanizer/Academic, anchors, minimal context, undo | Unicode/marks/list/table/multi-paragraph replacement fixtures, unsafe alternatives tests |
| M08-O01/O02 | metadata usage, bounded private storage, cron expiry/orphans | Tidak mencatat raw document; maintenance dan auth adapter integration tests |
| M09-Q01/Q03/Q04 | gate lokal, audit source dan scope, koreksi hasil agent | Bukti perintah di atas; browser tidak dijalankan sesuai AGENTS.md |
| M09-Q02 | 19 fixture dan rubrik evaluasi | Kontrak fixture lulus; penilaian hasil model nyata tetap terbuka |
| M10-R01/R02 | setup, privacy defaults, release/rollback guide | Paket konfigurasi siap; staging/production belum dibuat atau dirilis |

## Temuan review yang diperbaiki

- Quick Start, settings dan Google login semula memakai payload/endpoint yang tidak konsisten; kini memakai kontrak backend aktual.
- Selection rewrite semula bisa memakai scope dokumen penuh; scoped actions membawa anchor yang benar.
- Serializer semula merusak format di luar selection multiline; replacement sekarang memakai transaksi ProseMirror.
- Apply dan penandaan preview semula terpisah; kini satu batch D1 dengan revision serta lock-set guard.
- Source ketikan sebelum Apply pertama kini memiliki checkpoint walaupun dokumen awal kosong.
- P10 semula menyimpan response dengan schema yang tidak cocok untuk Apply; hasil repair kini dikembalikan ke bentuk response capability asal.
- Reservasi key yang sedang berjalan kini menolak request ganda; usage menghitung seluruh percobaan yang mungkin menimbulkan spend.
- P07 yang hanya memilih istilah terkunci ditolak sebelum provider; whitespace-only/oversized output juga ditolak.
- Token angka tambahan/hilang serta sitasi baru yang cocok pola ditolak; ini tidak membuktikan seluruh fakta atau makna terjaga.
- ESLint kini memeriksa TypeScript/TSX, bukan hanya JavaScript.

## Formula metrik dan batas operasional

- Kata: token nonkosong yang dipisah whitespace; tanda baca yang berdiri sendiri ikut token.
- Karakter: Unicode code points, termasuk whitespace; berbeda dari jumlah grapheme yang tampak pada emoji gabungan.
- Estimasi baca: ceil(kata / 200), nol untuk dokumen kosong.
- Persentase perubahan: jumlah token tambah/hapus dibagi jumlah kata terbesar dari dua teks, dibulatkan dan dibatasi 100%; label UI memakai estimasi.
- Teks besar memakai delta frekuensi/posisi token agar pekerjaan tetap bounded; angka ini bukan skor kualitas atau kesamaan makna.
- Diff detail memiliki batas waktu/edit; bila terlalu besar, menampilkan seluruh sumber sebagai dihapus dan hasil sebagai ditambahkan.
- Batas dokumen/output 200.000 unit teks UTF-16; body request maksimum 1,6 MB, kompleksitas JSON dibatasi, istilah maksimum 300 karakter dan 200 lock/dokumen.
- Default AI: 100 percobaan/bulan UTC dan 10/menit per akun, termasuk repair dan request gagal; dapat dikonfigurasi untuk batas bulanan.
- Provider timeout 30 detik per call, body response maksimum 2 MB, tanpa retry/fallback model otomatis.
- Preview tidak bisa diterapkan setelah 24 jam; penghapusan payload via cron bersifat bounded/eventual. Snapshot dokumen tetap tersimpan sampai dihapus pengguna.

## Gate yang sengaja tetap terbuka

M09-Q02: evaluasi kualitas final v1 terhadap output provider nyata memerlukan kredensial dan keputusan biaya/privacy. M10-R02: staging/production, migrasi remote, smoke live dan deployment memerlukan resource serta otorisasi efek eksternal. Brand final tetap memakai nama kerja AI Writing Workspace.


## Username/password authentication extension

Scope: registration, username/email sign-in, Google button with official colored icon, square GPT Image photo, ID/EN form states, and D1 persistence. Auth tables use migration `0001_username_auth.sql`; Google OAuth remains optional.

Local runtime evidence: real HTTP requests through Vinext/Cloudflare Worker and local D1 passed registration, cookie-backed get-session, normalized username sign-in, email sign-in, and sign-out. The temporary QA account was deleted after verification. The migration applied successfully to local D1. A private ignored `.dev.vars` was created with a random local auth secret; no remote credentials were added.

Image check: PNG header confirms 1254 × 1254 (1:1). Photo provenance and exact prompts: [assets/auth-photo.md](assets/auth-photo.md).

Remote D1 provisioning, real Google OAuth, email verification/reset delivery, and browser visual checks are not claimed.

Final gate: `pnpm test` passed 79 tests in 7 files; `pnpm typecheck`, `pnpm lint --max-warnings=0`, and `pnpm build` passed. Root reviewed form validation, request lifecycle, safe error handling, D1 integration, and square photo sizing.

`pnpm cf:check` passed Cloudflare deployment dry-run; no remote deployment performed.


## Refactor UI total (2026-09-13)

Scope: seluruh antarmuka ditulis ulang dengan Tailwind CSS v4 (sesuai blueprint) dan ikon lucide-react; CSS lama (`globals.css` custom, `workspace.css`, `auth.css`) dihapus. Dokumen PRD, blueprint, dan system prompt tidak diubah.

Tambahan backend untuk PRD: migrasi `0002_workspace_metadata.sql` (use case, konteks humanize default, status onboarding, `prompt_id`/`scope_type` pada versi), mode aktif di daftar dokumen, `originalVersionId` di DTO, preferensi saat membuat dokumen, route P09 `POST /api/ai/analyze-quality` (on demand, teks tidak disimpan), batas scope AI 20.000 karakter, dan `extra_request` maksimal 300 karakter.

Bug lama yang diperbaiki: client memanggil `PATCH /autosave` tetapi route hanya `POST` (autosave selalu 405); `DELETE /api/documents/:id` mengembalikan `NOT_FOUND` di D1 karena `meta.changes` ikut menghitung baris cascade sehingga snapshot R2 tidak terhapus.

Bukti lokal: `pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test` (87 tes, 9 file), `pnpm build`, `pnpm cf:check` lulus; migrasi 0002 diterapkan ke D1 lokal. Smoke HTTP pada dev server: SSR 9 halaman 200 tanpa error; alur daftar, onboarding, buat dokumen (mode tersimpan), autosave PATCH, checkpoint, kunci istilah, restore, konflik revisi 409, hapus dokumen, dan hapus akun berhasil; generate/analisis mengembalikan 503 `CONFIGURATION_REQUIRED` sesuai AI nonaktif. Akun uji dihapus.

Tidak diklaim: verifikasi visual/interaksi di browser, output AI nyata, Google OAuth nyata, deployment.
