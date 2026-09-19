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


## Tier berbayar: kuota karakter, DOCX, perintah inline, guard angka (2026-09-18)

Scope: batas parafrase per tier, kuota bulanan berbasis karakter, perbaikan penolakan angka, impor/ekspor DOCX dengan fidelity Microsoft Office, mode notebook lanjutan, perintah AI bebas per paragraf, dan copy berformat. Teks prompt di `src/server/ai/core/prompts.ts` dan `systemprompt.md` tidak disentuh — `tests/ai/core.test.ts` yang memaksa kesamaan byte tetap lulus tanpa diubah.

### Spike yang dijalankan lebih dulu

| ID | Hasil |
| --- | --- |
| S1 DOCX di Workers | Lulus tanpa dependency baru. `src/lib/docx/zip.ts` memakai `CompressionStream`/`DecompressionStream('deflate-raw')`; `crc32("abc")` = `0x352441c2`; `unzip -t` sistem memvalidasi arsip; ZIP tulisan `zip(1)` terbaca balik. `mammoth`/`docx` ditolak (butuh shim Node, 300–600 KB) |
| S2 Agregat kuota D1 | Lulus. `EXPLAIN QUERY PLAN` pada D1 lokal: `SEARCH usage_ledger USING COVERING INDEX usage_owner_period_charge_idx (owner_id=? AND period_key=?)` untuk `COUNT(1)` + `SUM(charge_characters)` sekaligus. Filter `status` dihapus dari query itu karena membuang covering index dan sudah redundan |
| S3 Metrik baris Word | Lulus, diturunkan dari file font nyata, bukan dugaan. `public/fonts/Carlito-Regular.ttf` hhea: ascent 1950, descent −550, lineGap 0, unitsPerEm 2048 → satu baris = 2500/2048 = 1,2207 em; × 1,08 = **1,3184** (`LINE_HEIGHT`). Subsetting font tidak mengubah metrik ini |
| S4 Lubang injection | Terkonfirmasi ada: `additional_instruction` (`settings.extra`) dikompilasi ke **system message** lewat `compileControlBlock` (`core/index.ts:65,132`). Karena itu perintah bebas yang baru **tidak** memakai jalur tersebut |

### Bukti eksternal untuk DOCX

Tidak hanya round-trip internal. Berkas hasil `editorDocumentToDocx` dibaca oleh **python-docx** (pembaca OOXML independen): page 11906×16838 twip, margin 1440 keempat sisi, style Normal `Calibri 11.0`, judul core properties, alignment `JUSTIFY`/`RIGHT`, daftar, Quote, dan tabel terbaca benar. **LibreOffice** (`soffice --convert-to pdf`) merender penuh: penanda bullet `•`, nomor `1.`/`2.`, justify, dan tabel; `pdfinfo` melaporkan `595.304 x 841.89 pts (A4)`; `pdffonts` menunjukkan LibreOffice mensubstitusi **Carlito** untuk Calibri, yang membuktikan pilihan font metric-compatible itu tepat.

Arah sebaliknya diuji dengan berkas yang **bukan** buatan exporter ini (`fixtures/docx/third-party.docx`, ditulis python-docx dengan template default Word). Uji itu menemukan satu bug nyata: daftar yang hanya ditandai style Word (`List Bullet`/`List Number`, tanpa `w:numPr`) terbaca sebagai paragraf biasa. Diperbaiki lewat `listFromStyle()`; round-trip internal tidak akan pernah menemukannya karena exporter selalu menulis `w:numPr`.

### Bug yang ditemukan dan diperbaiki selama pengerjaan

1. **Hold kuota tidak dilepas.** Bila pass repair P10 gagal di provider, `AI_UNAVAILABLE` melewati closure `rejected()`, sehingga karakter pengguna tetap tertagih padahal tidak ada output. Sekarang seluruh jalur setelah panggilan provider dibungkus dan melepas hold sekali (`release`/`voidUsage`), dan `tests/review/document-safety.test.ts` menguncinya.
2. **Penolakan generik menutupi penyebab.** Pass repair yang gagal melaporkan `AI_UNAVAILABLE`, bukan pelanggaran aslinya. Sekarang pelanggaran asli yang dilaporkan, lengkap dengan token pelanggar.
3. **Relationship DOCX tidak terbaca.** `parseXml` mengembalikan root sintetis, sehingga `childrenNamed(root,'Relationship')` tidak menemukan apa pun dan semua hyperlink hilang saat impor.
4. **Daftar berbasis style** (lihat di atas).

### Perubahan perilaku yang perlu dicatat di rilis

- Batas parafrase per run turun dari 20.000/5.000 menjadi **1.000 untuk Gratis** (Plus 2.000, Pro/Tim 5.000). `INLINE_LIMIT` 600, `AI_SCOPE_LIMIT` 20.000, dan batas keras 200.000 tidak diubah.
- Kuota bulanan kini karakter, bukan permintaan. Karakter hanya ditagih bila run menghasilkan output terpakai: provider gagal, hasil ditolak validasi, dan pass repair P10 semuanya nol.
- Guard angka membandingkan **nilai**, bukan string digit. `1.000` ≡ `1,000`, `1 juta` ≡ `1.000.000`, `10` ≡ `sepuluh` ≡ `ten`, dan menyebut ulang satu angka lebih/kurang sering tidak lagi ditolak. Kata-bilangan hanya berfungsi sebagai pencocok, tidak pernah sebagai klaim, sehingga "one of the reasons" tidak dianggap angka yang dikarang. Angka yang benar-benar hilang, dikarang, atau diubah tetap ditolak.
- `usage_ledger.charge_characters` **tidak** di-backfill dari `source_characters`; mem-backfill akan langsung menghabiskan kuota semua akun saat deploy.

### Gate lokal

`pnpm typecheck`, `pnpm lint` (0 error, 0 warning), `pnpm test` (453 tes, 31 file), `pnpm build`, dan `pnpm cf:check` lulus; migrasi `0010_character_quota.sql` diterapkan ke D1 lokal. Test baru: `tests/ai/numeric.test.ts`, `tests/ai/instruction.test.ts`, `tests/ai/docx-mapping.test.ts`, `tests/review/entitlements.test.ts`, `tests/review/rejection-codes.test.ts`, `tests/review/clipboard-html.test.ts`, `tests/review/paragraph-gutter.test.ts`. Daftar migrasi yang sebelumnya ditulis manual di enam file test diganti `tests/helpers/migrations.ts` agar migrasi baru otomatis ikut.

### Afordansi fitur terkunci

Atas permintaan pengguna, setiap fitur berbayar yang belum terbuka tampil sebagai **gembok abu-abu**, bukan disembunyikan dan bukan ikon mahkota. Satu komponen bersama (`src/components/app/PaidLock.tsx`) memasok ikon, teks redup, dan tombol "Buka dengan <tier>" yang nama tier-nya dibaca dari `requiredTierFor()` supaya copy tidak bisa melenceng dari gate. Terpasang pada keempat permukaan berbayar: impor DOCX (`/notebooks`), ekspor DOCX dan mode lanjutan (menu notebook), serta perintah AI bebas (menu seleksi). Semuanya tetap bisa diklik untuk membuka dialog paket.

Tabel perbandingan paket kini menandai baris yang benar-benar ditegakkan dengan label "aktif" dan menyatakan di bawah tabel bahwa sisanya masih pratinjau. Sebelumnya tabel menjanjikan pembatasan (jumlah notebook, retensi versi, kuota analisis kualitas, Sesuaikan) yang tidak ada penegakannya di server; klaim itu sekarang tidak lagi tampak sebagai fakta.

### Perbaikan setelah pengguna mencoba aplikasinya (2026-09-18)

1. **Admin hanya dapat 1.000 karakter.** Dilaporkan pengguna. `entitlement()` memberi admin seluruh fitur tetapi `limits` masih dibaca dari kolom tier-nya, yang bernilai `free` — jadi admin memegang semua fitur tapi tetap menabrak batas 1.000 karakter per run. `MAX_RUN_LIMIT` sudah diekspor tapi tidak pernah dipakai. Diperbaiki dengan `effectiveLimits(tier, unlimited)`: admin kini memakai paket tertinggi (5.000/run) dan kuota karakter tak terbatas. Dikunci oleh test di `tests/review/entitlements.test.ts`.

2. **Spasi tidak ikut saat copy-paste.** HTML clipboard hanya membawa `text-align`, sehingga Word dan Docs memakai spasi default mereka sendiri dan hasil paste tidak sama dengan kanvas. `src/lib/editor/clipboard-style.ts` kini menyediakan dua profil — `paged` (Normal Word: 11pt, line-height 1,3184, jarak antar paragraf 8pt, indent daftar 0,5 inci) dan `plain` (16px, 1,75, jarak 12px) — yang ditulis sebagai inline CSS dan diambil dari konstanta yang sama dengan kanvas serta penulis DOCX. Profilnya mengikuti kanvas yang sedang dilihat, jadi copy 1:1 baik di mode lanjutan maupun tidak.

3. **Kontrol berbayar dipindah ke toolbar notebook.** Sebelumnya toggle mode lanjutan dan ekspor DOCX ada di dalam menu ⋮, yang menurut pengguna terasa seperti navbar kedua. Keduanya kini jadi tombol ringkas di toolbar atas notebook, sebentuk dengan toggle "Bandingkan" yang sudah ada (`aria-pressed` + ring brand saat aktif), dan hanya turun ke menu ⋮ pada layar sempit. Judul notebook memakai `min-w-0 flex-1 truncate` dan toolbar `shrink-0`, jadi judul yang menyusut lebih dulu dan toolbar tidak pernah meluber.

### Toolbar format dan kanvas gaya Docs (2026-09-18)

Editor sudah mendukung bold/italic/underline, heading, alignment, daftar, kutipan, tautan, dan tabel sejak awal — yang tidak ada adalah **UI**-nya, jadi semua itu hanya bisa dipakai lewat keyboard. `src/components/workspace/FormattingToolbar.tsx` kini mengeksposnya. **Tidak ada library editor baru yang ditambahkan**: seluruh kontrol memanggil perintah TipTap yang sudah terpasang.

Cakupan toolbar: undo/redo, gaya paragraf (Normal, Judul 1–3), bold/italic/underline, tautan dengan validasi skema http(s), empat alignment termasuk justify, daftar poin dan bernomor, kutipan, tambah/kurangi indentasi (lewat `sinkListItem`/`liftListItem`), sisipkan tabel, menu ubah tabel (tambah/hapus baris dan kolom, hapus tabel) yang muncul saat kursor berada di dalam tabel, garis pemisah, dan hapus format.

Yang sengaja **tidak** disediakan: pemilih font dan ukuran font per-kata. Keduanya butuh mark `textStyle`/`fontSize` yang tidak ada di whitelist `EditorNodeSchema`, jadi kalau dipaksakan hasilnya akan hilang saat disimpan, dan sekalian merusak premis "satu gaya konsisten setara Word Normal" yang menopang fidelity export. `tests/ai/editor-document.test.ts` mengunci batas ini: setiap blok dan mark yang ditawarkan toolbar harus lolos schema, sementara `textStyle`, `fontSize`, dan tautan non-http harus ditolak.

Mode lanjutan kini halaman datar di atas latar abu (`#f4f5f2`) tanpa sudut membulat dan tanpa shadow tebal. **Card pembungkus kolom tulisan dihapus sepenuhnya** di mode ini — tanpa border, tanpa radius, tanpa isian putih — sehingga yang terlihat hanya halaman di atas latarnya, seperti pengolah kata. Sebelumnya halaman tampak seperti kartu di dalam kartu. Strip header tetap putih supaya toolbar terbaca di atas latar abu.

Toolbar lengkap itu **hanya ada di mode lanjutan**; mode dasar tetap kanvas polos dengan undo/redo di header. Karena itu undo/redo tidak pernah muncul dua kali: di mode lanjutan keduanya ada di toolbar, dan tombol header disembunyikan.

Fitur Bandingkan ikut menyesuaikan: di mode lanjutan diffnya dirender di atas permukaan halaman yang sama (`.ww-paged-doc`, memakai variabel CSS yang sama dengan kanvas dan penulis DOCX) dan **default-nya berdampingan**, sehingga dua versi terbaca sebagai dua dokumen, bukan satu aliran yang menyatu. Mode dasar tidak berubah.

Dock perintah AI diperkecil: kondisi tertutup hanya tombol bundar 36 px berikon sparkle yang terbuka saat hover atau fokus keyboard, kondisi terbuka satu baris `rounded-full` selebar maksimal 520 px dengan target ("teks terpilih"/"paragraf ini") sebagai chip inline. Baris keterangan kedua dipindah ke tooltip supaya tinggi dock tetap satu baris. Dock menutup sendiri saat kursor keluar, kecuali sedang ada teks yang diketik atau field masih fokus.

Toggle Dasar/Lanjutan memakai `Segmented` yang sudah ada, dengan opsi `fit` baru supaya lebarnya mengikuti label (bukan lebar tetap 9,5 rem) dan tingginya sama dengan tombol di sebelahnya.

### Tidak diklaim

Verifikasi visual di browser tidak dijalankan (sesuai AGENTS.md), jadi kanvas berhalaman, kartu perintah inline, tombol gutter paragraf, dan dialog impor belum pernah dilihat dirender. Microsoft Word sendiri tidak tersedia di lingkungan ini: fidelity dibuktikan lewat python-docx, LibreOffice, dan metrik font, bukan lewat Word. `pnpm smoke` pada model live belum dijalankan karena butuh izin biaya. Paginasi editor sungguhan (page break otomatis) dan ekspor PDF tidak dibangun.

## Paket Free/Plus/Pro/Max, jatah karakter, dan gating fitur (2026-09-19)

Scope: menyelaraskan katalog paket, jatah karakter AI, aturan penagihan, dan gating fitur dengan `TULISAI_OWNER_DECISIONS_ADDENDUM_2026-09-19.md`. Billing, top-up berbayar, dan integrasi MKL **tidak** diimplementasikan di fase ini.

### Yang berubah

| Area | Sebelum | Sesudah |
| --- | --- | --- |
| Tangga paket | free/plus/pro/team | free/plus/pro/max; `asTier('team')` → `pro` supaya baris lama tidak jatuh ke free |
| Harga | mock (49k/99k/79k per anggota) | Rp0 / Rp49.000 / Rp179.000 / Rp499.000 di `PLAN_LIMITS[...].priceIdr` |
| Jatah karakter | 100k/500k/2jt/3jt per bulan | 3.000 sekali pakai per akun (Free), 25.000 / 100.000 / 350.000 per periode |
| Batas per run | 1.000/2.000/5.000/5.000 | tetap, Max = 5.000 |
| Fitur berbayar | semua fitur untuk semua tier berbayar | Plus: skills tersimpan + kelayakan top-up; Pro: + workspace lanjutan & impor/ekspor DOCX; Max: + AI Mode |
| Penagihan AI Mode | karakter sumber | `MAX(sumber, output)`, di-hold `2×` sumber sebelum panggilan provider lalu di-settle turun |
| Env | `AI_MONTHLY_CHARACTER_LIMIT` (100000) | `AI_FREE_CHARACTER_ALLOWANCE` (3000) |

Jatah Free dihitung lintas periode (`WHERE owner_id=?`), bukan per bulan, baik saat reservasi di `reserve()` maupun di `usageSummary()`; `UsageSummary.characterScope` membawa bedanya ke UI supaya label tidak menjanjikan reset bulanan. Override karakter per user tetap membuat kuota terisi ulang per periode.

Gating baru ditegakkan di server: `createStyle`/`updateStyle` menuntut `saved_styles` (list dan delete tetap terbuka — turun paket tidak menyandera skill yang sudah tersimpan), `freeform_prompt` kini hanya Max, dan impor/ekspor DOCX serta mode notebook lanjutan naik dari Plus ke Pro.

### Penegakan per tier setelah sapu ulang

| Yang dijaga | Di mana | Berlaku untuk |
| --- | --- | --- |
| `saved_styles` | `createStyle`/`updateStyle` (`src/server/writing/styles.ts`) | Plus ke atas; list & delete tetap terbuka |
| `advanced_notebook` | `src/server/documents/service.ts` (create + autosave) | Pro ke atas |
| `docx_import` / `docx_export` | route impor & ekspor | Pro ke atas |
| `freeform_prompt` | `generatePreview` | Max saja |
| Batas karakter per run | `scopeLimit()` dari `rights.limits` | 1.000 / 2.000 / 5.000 / 5.000 |
| Jatah karakter | `reserve()` + `usageSummary()` | Free lintas periode, berbayar per periode |
| Batas permintaan per periode | `reserve()` | 100 / 500 / 2.000 / 3.000; admin dilewati |
| Burst 10 permintaan / menit | `reserve()` | semua akun |

`purchase_topup` belum punya endpoint apa pun untuk dijaga — tidak ada jalur pembelian di kode.

Dua celah yang ditemukan saat sapu ulang dan sudah ditutup:

1. **Batas permintaan per tier tidak pernah ditegakkan.** `TIER_LIMITS` hanya ditampilkan di panel admin dan ringkasan pemakaian, padahal kolom "Batas permintaan khusus" menyiratkan penegakan. Kini menjadi guard ketiga di `reserve()`. Pass repair P10 tidak menghitung dan tidak ikut diblokir — itu pass kami, bukan permintaan penulis. Karena satu INSERT memeriksa tiga guard sekaligus, penolakan didiagnosis setelahnya supaya kodenya tepat: `RATE_LIMITED` (tunggu sebentar), `REQUEST_LIMIT_REACHED` (naikkan paket), `QUOTA_EXCEEDED` (persingkat teks). Copy `QUOTA_EXCEEDED` juga tidak lagi menjanjikan reset bulanan.
2. **Panel admin mengukur akun Free per bulan.** Jatah Free sekali pakai membuat angka "karakter bulan ini" salah setelah ganti bulan. `AdminUser` kini membawa `charactersUsed` + `characterScope`, dan baris sekali-pakai pada halaman yang sedang dilihat dijumlahkan lewat satu query `owner_id IN (...)` terbatas satu halaman — tetap memakai covering index, bukan scan tabel.

### Bukti

`pnpm typecheck`, `pnpm lint`, `pnpm test` (600 tes, 37 file), `pnpm build`, `pnpm cf:check` lulus. `EXPLAIN QUERY PLAN` pada migrasi lokal: `SELECT SUM(charge_characters) ... WHERE owner_id=?` tetap `SEARCH usage_ledger USING COVERING INDEX usage_owner_period_charge_idx (owner_id=?)`, jadi agregat seumur akun tidak memicu scan.

Test baru: `tests/review/plan-catalogue.test.ts` (harga, jatah, batas paket, pemetaan tier `team` lama, katalog top-up), `tests/review/entitlements.test.ts` (jatah Free sekali pakai, batas fitur per tier, skills mulai Plus), `tests/review/rejection-codes.test.ts` (AI Mode terkunci di Pro, penagihan `MAX(sumber, output)`), `tests/review/document-safety.test.ts` (jatah Free tidak terisi ulang saat bulan berganti, diagnosis tiga guard, repair lolos dari batas permintaan), `tests/review/admin-service.test.ts` (ukuran pemakaian mengikuti scope jatah).

### Tidak diklaim

Pembayaran, checkout, pembelian top-up, pencairan saldo top-up, siklus perpanjangan/pembekuan, dan integrasi identitas MKL belum ada di kode. Halaman paket menyatakan hal ini apa adanya: tombol paket dan blok top-up menjelaskan pembelian belum tersedia di aplikasi. Migrasi database tidak ditambahkan; tidak ada verifikasi browser atau deployment.

### Koreksi halaman paket setelah cross-check (2026-09-19)

- Kartu Max tidak lagi mengklaim "catatan & instruksi khusus" dan "contoh tulisan sebagai acuan gaya": keduanya (`extra`, `sample`) terbuka di semua tier dan tidak dijaga server, jadi bukan pembeda Max. Menunggu keputusan owner apakah akan dikunci ke Max.
- Kartu Plus tidak lagi mengklaim "bisa beli tambahan karakter" — belum ada jalur pembelian.
- "/ periode" diganti "/ bulan": backend me-reset kuota per bulan kalender UTC (`period_key` = `YYYY-MM`) karena belum ada periode langganan; footer menyatakan ini apa adanya.
- Klaim tanpa dasar dihapus: "sudah termasuk pajak", "pembaruan fitur tanpa biaya tambahan", "Hubungi kami" (tidak ada kanal kontak), dan badge "Populer" (belum ada data) diganti "Rekomendasi".
- Blok top-up disusun ulang selebar kartu: tiga paket dengan harga per 1.000 karakter, tag "Paling hemat" dihitung dari katalog, dan tiga aturan top-up sebagai daftar ringkas.
