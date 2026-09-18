# Task implementasi AI Writing Workspace — Core MVP

Status: implementasi core MVP dan review lokal selesai; evaluasi provider live (M09-Q02) dan rilis remote (M10-R02) tetap terbuka karena kredensial/resource belum tersedia. Bukti: docs/verification.md.

## 1. Acuan dan keputusan final

| Acuan | Bagian yang digunakan |
| --- | --- |
| `AI_Writing_Workspace_PRD_Super_Lengkap_v1.pdf` | §4–9 inventory/flow/UI, §11–17 AI dan data, §20–23 QA/privacy/responsive/release |
| `AI_Writing_Workspace_Technical_Architecture_Build_Blueprint_v1.pdf` | §4–15 editor/storage/auth/AI/safety, §18–26 security/API/gates/dependencies |
| `AI_WRITING_SYSTEM_PROMPTS_FINAL_v1.md` | Satu-satunya sumber system prompt, runtime, routing dan acceptance P01–P10 |
| Task sebelumnya | Direview untuk menemukan ekspansi scope; aturan yang diganti dicatat di register konflik |
| Instruksi pengguna terbaru | Initial release hanya core MVP; V1.1 backlog; P09 opsional; tidak menggabungkan atau membuat prompt baru |

Instruksi terbaru menggantikan keputusan sebelumnya tentang MVP + V1.1 dan benchmark prompt gabungan; dokumen referensi asli tetap utuh.

Keputusan yang tetap berlaku: warna biru, Google login sebelum AI, Indonesia-first dengan dukungan ID/EN, satu kanvas editor, Astra sebagai pengarah/reviewer, Luna/Terra sebagai eksekutor.

Nama final belum dipilih; gunakan nama kerja AI Writing Workspace, bukan menganggap Rangkai atau nama di mockup sebagai merek final.

## 2. Final MVP scope

| Area | Wajib initial release | Bukti penerimaan |
| --- | --- | --- |
| Foundation | Authentication, Dashboard, Quick Start, Document Workspace | Pengguna login, membuat/membuka dokumen miliknya, melanjutkan draft dan memanggil AI dari input yang nyata |
| Editor | Rich text, format dasar, autosave, recovery | Isi dan format tersimpan; refresh/save failure tidak diam-diam menghilangkan teks |
| Version safety | Original immutable, checkpoint manual, version history, restore | Apply/restore membuat versi baru; autosave tidak membanjiri timeline; riwayat lama tetap ada |
| Compare | Diff on-demand, versi A/B, perubahan tambah/hapus | Tidak ada AI; label dan markup menjelaskan perubahan tanpa mengandalkan warna saja |
| AI | P01–P08 dan P10 | Setiap capability punya route, runtime, schema, UI yang relevan, validasi dan pengujian terintegrasi |
| Safety | Preview sebelum Apply, Term Lock, Citation Protection, deterministic validation | Hasil tidak aman tidak diterapkan; stale Apply tidak menimpa ketikan terbaru |
| Analytics lokal | Word count, character count, reading time, change percentage | Dihitung lokal tanpa LLM; formula, baseline dan keterbatasannya terdokumentasi |
| Operasional minimum | Ownership, rate limit, quota/usage ledger, metadata log, pengaturan dasar/data controls | Tidak ada secret atau teks dokumen dalam log umum; semua akses data terotorisasi |

P09 Quality Evaluation bukan dependency atau blocker initial release; task terpisah di §8.

Sentence count boleh digunakan secara internal untuk segmentasi; panel skor kualitas, repeated-phrase analysis, dan metrik tambahan bukan syarat MVP.

Landing cukup menjelaskan produk dan mengarahkan ke login/Quick Start dengan contoh statis; tanpa demo AI anonim, pricing checkout, atau halaman pemasaran ekspansif.

### Batas UI dan flow

| Surface | Flow wajib |
| --- | --- |
| `/` dan auth | Ringkasan manfaat → Google login → `/app`; error/cancel/session expired tidak menghilangkan draft |
| `/app` | Input besar → bahasa → enam mode → opsional Sesuaikan → Generate → preview; daftar dokumen terbaru memakai data akun asli |
| `/documents/new` | Tempel/tulis atau dokumen kosong; tidak ada Upload atau Template |
| `/documents/:id` | Satu kanvas, toolbar format, AI panel dapat ditutup, status autosave, timeline dapat dilipat |
| `?panel=history` | Original/AI/manual/restore → preview versi → compare atau konfirmasi restore sebagai versi baru |
| `?compare=a:b` | Label dua versi, diff inline, change percentage, keluar compare; split view opsional bukan blocker |
| Metrik/footer | Kata, karakter, estimasi baca, perubahan setelah rewrite/compare; membuka metrik tidak memanggil AI |
| `/settings` | Preferensi bahasa/mode, akun, pemakaian dan penghapusan terkonfirmasi; tanpa paket harga atau pembayaran yang belum ditetapkan |

Alur AI: simpan/capture sumber dan revision → satu primary call → deterministic validation → P10 maksimal sekali jika applicable → validasi ulang → preview → Apply eksplisit → snapshot versi.

Quick Start menyimpan Original sebelum hasil pertama diterapkan; Discard selalu mempertahankan sumber; Compare/Copy/Discard/Apply bukan panggilan AI.

Inline: pilih scope → tindakan → preview alternatif atau rewrite → Ganti → snapshot dan undo; hanya scope serta konteks minimal dikirim.

### Desain komponen dan warna

- Primary `#2563EB`, hover `#1D4ED8`, subtle `#EFF6FF`; kanvas putih, background `#F8FAFC`, teks `#0F172A`, teks sekunder `#475569`.
- Warning amber dan error merah khusus status; diff tambah biru + underline/label, hapus merah + strikethrough/label.
- UI 14–16 px, editor 17–18 px, line-height sekitar 1.7; spacing 4/8/12/16/24/32 px; radius kontrol 8 px dan card 12 px.
- Kanvas mendominasi desktop; sidebar/panel AI menjadi drawer ketika ruang sempit; mobile mendukung quick rewrite, preview, edit dasar, history/compare sederhana.
- Komponen inti: Composer, ModeSelector, ModeSettings, CustomizeForm, RichTextCanvas, FormattingToolbar, SelectionToolbar, AssistantPanel, ResultPreview, ProtectedTermsList, SaveStatus, RecoveryBanner, VersionTimeline, HistoryDrawer, DiffView, LocalMetrics, ConfirmDialog.
- Semua komponen interaktif punya keyboard focus, accessible name, loading/disabled/error/success yang relevan; tidak memakai glow, gradient dekoratif atau semua kontrol berbentuk pill.
- Copy UI dan error konsisten ID/EN; bahasa antarmuka dipisahkan dari bahasa tulisan Auto/ID/EN; tidak diam-diam menerjemahkan isi.

## 3. Kontrak AI: final v1 tanpa perubahan prompt

Salin hanya isi code block System Prompt milik capability yang dipilih dari `AI_WRITING_SYSTEM_PROMPTS_FINAL_v1.md`; jangan mengirim seluruh dokumen.

Tidak menggunakan `systemprompt.md`, BASE v3, benchmark gabungan, prompt baru, atau tambahan instruksi sistem; evaluasi menguji v1 yang sama, bukan mengubah baseline.

Runtime controls, source text dan konteks dikirim terpisah sebagai structured data; schema API dan adapter bukan alasan mengedit teks prompt.

| ID | UI/runtime utama dari v1 | Response model | Routing/acceptance |
| --- | --- | --- | --- |
| P01_STANDARD_REWRITE | Strength light/balanced/strong, language, protection | transformed_text, change_categories, warnings | Parafrase menjaga makna, angka dan nama; satu call |
| P02_ACADEMIC | thesis/journal/general_academic, audience, length | transformed_text, change_categories, warnings | Sitasi, uncertainty, teori/variabel tetap; tidak mengarang evidence |
| P03_HUMANIZER | academic/professional/general, strength, preservation | humanized_text, change_categories, warnings | Konteks tetap; tidak menambah typo/fakta/pengalaman palsu |
| P04_PROFESSIONAL | audience, document_type, length | transformed_text, change_categories, warnings | Komitmen, deadline, nama dan jumlah tidak berubah |
| P05_CREATIVE | audience, creative_goal, creativity_strength | transformed_text, change_categories, warnings | Variasi gaya tanpa kebebasan mengarang fakta |
| P06_SIMPLIFY | target_audience, reading_level, length, output_format | transformed_text, change_categories, warnings | Essential meaning, kondisi dan caveat tetap |
| P07_INLINE_ALTERNATIVES | selection, context, alternatives/clearer/shorter/paraphrase, active_mode | alternatives[{text}], warnings | 3–5 opsi aman/distinct; hasil tidak aman/noncompliant ditolak sesuai C04/C05 |
| P08_CUSTOM_TRANSFORM | format, length, audience, focus, extra_request | transformed_text, change_categories, warnings | Custom mandiri tersedia; mode + Sesuaikan tetap memakai prompt mode sekali |
| P10_REPAIR | failed_output, original_scope, required protected spans | corrected_text | Hanya repair pelanggaran perlindungan, maksimal sekali; bukan fitur user atau rewrite tambahan |

P08 dibuka melalui tindakan Custom mandiri di panel yang sama, tanpa memisahkan dokumen menjadi produk lain; enam mode utama tetap utuh.

Sesuaikan menyediakan format paragraf/poin/bernomor/tabel/ringkasan, panjang, audiens, fokus dan permintaan tambahan; field mode serta form harus menghasilkan satu nilai efektif yang ditampilkan dalam summary.

Tabel hasil transform P06/P08 merupakan struktur keluaran AI, bukan ekstraksi tabel dari file; dukungan ini tidak membutuhkan parser DOCX/PDF.

Adapter boleh memetakan `humanized_text` menjadi field preview internal yang seragam setelah validasi schema P03; schema/model output v1 tidak diubah.

Hasil sama persis dideteksi lokal; jangan menambahkan field wajib `no_change_needed` dari referensi lain.

## 4. Konflik, keputusan terbuka dan dampak

| ID | Temuan dan sumber | Status / tindakan | Dependency yang terdampak |
| --- | --- | --- | --- |
| C01 | Task lama memasukkan V1.1 sebagai syarat rilis; instruksi terbaru hanya MVP | Selesai: V1.1 dipindah ke backlog, bukan build sekarang | Tidak ada |
| C02 | Task lama menggabungkan v1/v3; instruksi terbaru hanya final v1 | Selesai: hapus semua task merge/benchmark kandidat dan aturan v3 | Tidak ada |
| C03 | PRD/blueprint masih menyebut prompt TBD/placeholder | Selesai: sumber final v1 sudah tersedia; implementasi wajib prompt nyata | M05 |
| C04 | v1 P07 acceptance baris 820–827 mengizinkan tidak ada opsi aman; §12 baris 1454–1459 selalu meminta 3–5 | DISETUJUI pengguna: tolak hasil tidak aman/noncompliant, simpan sumber, tampilkan pesan; tidak memaksakan opsi palsu | M07-I01 |
| C05 | v1 §1.3 meminta P10 setelah pelanggaran setiap transform; P10 hanya menerima satu failed_output sedangkan P07 mengembalikan array | DISETUJUI pengguna: P07 tidak memakai P10; tolak hasil tidak aman, P10 hanya untuk hasil rewrite tunggal | M07-I01 |
| C06 | v1 P06 memakai summary; P08/custom mapping memakai short_summary | Mapping adapter eksplisit diperlukan: satu label UI ke enum capability masing-masing, tanpa mengubah prompt | M05-A02 |
| C07 | v1 routing mendukung mode + custom_request tetapi contoh runtime beberapa mode tidak memuat seluruh controls | Gunakan application envelope §3 dan routing §2 sebagai kontrak; uji payload efektif tiap mode, bukan menambah system prompt | M05-A02 |
| C08 | Blueprint memakai contoh R2 working/current.json; revision safety perlu pointer yang tidak rusak oleh race | Catat perbaikan storage aplikasi: object per revision + conditional metadata commit; bukan fitur baru | M01-F03 |
| C09 | Blueprint mensyaratkan Playwright; AGENTS.md melarang browser tanpa permintaan | Utamakan build/typecheck dan integration; browser/E2E belum dijalankan tanpa permintaan, keterbatasan bukti wajib dilaporkan | M09-Q03 |
| C11 | Ringkasan/shorter v1 tidak memberi ambang numerik essential meaning | Jangan mengimpor ambang v3; ikuti prioritas protected content/makna dan warning pada §9 v1, gunakan fixture kondisi/caveat dan review manusia; jangan menyatakan validator literal membuktikan kualitas ringkasan | M06-W06/W07, M09-Q02 |
| C12 | Prompt source switched from final v1 to `systemprompt.md` v3 on user request, 2026-09-16; supersedes C02, C06, C11 and §3 v1 lock | Selesai: prompts/schemas/validators v3 di server | M05, M06, M07 |
| C13 | Fitur Skills menambahkan "Contoh tulisan" yang harus sampai ke model, sedangkan teks prompt v4 di `systemprompt.md` bersifat verbatim dan tidak boleh diedit | DISETUJUI pengguna 2026-09-17: sample dikirim sebagai blok terpisah `<style_reference>` plus `<style_reference_rules>` di USER message; tidak ada satu karakter pun pada blok ```text``` systemprompt.md yang diubah, system message tetap apa adanya, dan validator `sampleEcho` menolak hasil yang menyalin 8+ kata berturut-turut dari sample yang tidak ada di teks penulis. "Kapan dipakai" murni metadata dan tidak pernah dikirim | M05-A02, M05-A05 |
| C14 | Judul notebook pendek harus datang dari model, sedangkan teks prompt v4 di `systemprompt.md` bersifat verbatim dan tidak boleh diedit | Mengikuti pola C13: permintaan judul dikirim sebagai blok terpisah `<title_request>` di USER message dan hanya pada run pertama notebook baru (`suggestTitle`), sehingga tidak ada panggilan atau pembacaan dokumen kedua; skema respons `suggested_title` hanya dipakai saat diminta; nilai divalidasi server (maks. 3 kata/40 karakter, bukan kalimat) dan jatuh ke judul lokal bila ditolak; tidak ada karakter pada blok ```text``` systemprompt.md yang diubah | M05, UI03, UI04 |
| C15 | Tabel paket menampilkan batas panjang teks terpilih/dokumen per tier, padahal `scopeLimit()` tidak bercabang per tier | Baris tersebut kini memakai satu angka nyata dari `SELECTION_LIMIT`/`AI_SCOPE_LIMIT` untuk semua paket, dan kuota Gratis dibaca dari `usage.requestLimit`; sisa katalog tetap mock berlabel | UI03 |
| C10 | Final brand, kuota, retensi dan kebijakan provider belum diputuskan | Nama kerja tidak menghambat core; retensi sudah disetujui; default operasional 100 attempts/bulan dan 10/menit terdokumentasi; privacy provider harus diverifikasi sebelum AI publik | M00-P04, M03-D05, M05-A04, M10-R01 |

Deterministic validation menjamin pemeriksaan literal/struktur yang didefinisikan, bukan bukti lengkap bahwa makna, grammar atau relasi sitasi-klaim benar; kualitas ini dinilai melalui fixture dan review hasil v1.

Tidak mengimpor batas 200 karakter, tiga fokus, preservation ceiling 15/30/50%, atau aturan paragraf v3; batas operasional aplikasi ditetapkan terpisah dalam konfigurasi sebelum integrasi publik.

## 5. Updated milestone plan dan acceptance criteria

Checkbox menandai implementasi dan gate lokal selesai; penerimaan live/visual tidak tersirat oleh checkbox dan batas bukti ada di docs/verification.md; owner pelaksana Luna/Terra dan reviewer akhir Astra.

### M00 — Review scope; owner Astra

- [x] M00-P01 — Review empat acuan dan revisi scope; AC: §2 hanya core MVP, §7 V1.1, §8 optional/deferred, tanpa jalur rilis melalui V1.1.
- [x] M00-P02 — Tetapkan prompt final v1 dan identifikasi konflik; AC: tidak ada task aktif merge/prompt baru, register konflik memiliki status dan dampak.
- [x] M00-P03 — Tutup konflik P07; AC: pengguna menyetujui penolakan hasil tidak aman/noncompliant tanpa P10, C04/C05 tercatat dan M07-I01 mewajibkan fixture exception tersebut.
- [x] M00-P04 — Tetapkan kebijakan data; AC: pengguna menyetujui dokumen/versi sampai dihapus, preview 24 jam, tanpa raw-text log dan AI nonaktif sampai privasi provider terverifikasi; keputusan tercatat di docs/data-policy.md, kredensial/resource belum tersedia sehingga tidak ada klaim live.

### M01 — Fondasi dan data; owner Terra; dependency M00-P01/P02

- [x] M01-F01 — Verifikasi runtime lalu scaffold Next.js/TypeScript strict/CSS tokens/pnpm; AC: versi dan adapter blueprint diverifikasi dari docs resmi, build adapter Workers berhasil, tidak mengasumsikan dukungan dependency Node.
- [x] M01-F02 — Buat schema/migrasi D1 dan domain boundaries; AC: auth, documents, versions, locks, transformations, usage tersimpan melalui services/repository, migrasi bersih reproducible, owner query indexed/keyset/bounded.
- [x] M01-F03 — Implementasikan storage working copy/snapshot D1/R2; AC: snapshot immutable, object per revision, stale pointer tidak tertimpa, kegagalan object/metadata tidak menghasilkan versi setengah jadi, cleanup orphan dapat diuji.
- [x] M01-F04 — Siapkan konfigurasi lokal dan CI; AC: contoh env tanpa secret, bindings terpisah, typecheck/lint/test/build commands bekerja; tidak provisioning/deploy produksi.

### M02 — Design system dan editor; owner Luna untuk UI, Terra untuk editor; dependency M01

- [x] M02-U01 — Implementasikan token/primitif/shell biru; AC: warna §2 dipakai konsisten, kanvas terbesar, panel dapat ditutup, keyboard focus/accessible labels tersedia, state loading/error/disabled terlihat jelas.
- [x] M02-U02 — Implementasikan rich text dan format dasar; AC: heading, bold/italic/underline, alignment, list, link, undo/redo bekerja pada canonical editor JSON, pasted HTML disanitasi, tidak memanggil AI.
- [x] M02-U03 — Implementasikan serializer dan scope anchor; AC: Unicode/marks/list/multi-paragraf dapat dipetakan antara teks dan editor tanpa mengubah isi di luar target; struktur tabel sederhana keluaran AI dapat dirender aman.
- [x] M02-U04 — Implementasikan responsif dan lokalisasi; AC: desktop/tablet/mobile menggunakan satu editor, drawer tidak menutup kontrol/caret, seluruh copy/error/label ID/EN konsisten dan bahasa teks dapat diatur terpisah.

### M03 — Auth, dokumen, Quick Start dan autosave; owner Terra/Luna; dependency M01/M02

- [x] M03-D01 — Integrasikan Google auth; AC: login/logout/callback/cancel/expired session ditangani, redirect aman, server menolak endpoint dokumen/AI tanpa sesi dan akses resource pengguna lain.
- [x] M03-D02 — Bangun Dashboard/Quick Start/New Document; AC: create/open/rename/list menggunakan backend nyata, recent list paginated, input kosong/limit/error tidak dibuang, Standar default, blank document tidak memanggil AI.
- [x] M03-D03 — Implementasikan autosave/recovery; AC: dirty copy tersimpan lokal per user/document, autosave conditional revision, refresh/offline/failure/two-tab conflict tidak menimpa teks diam-diam, status saved/saving/unsaved sesuai keadaan nyata.
- [x] M03-D04 — Implementasikan Original dan prefs; AC: sumber awal teridentifikasi sebelum Apply pertama, original tidak dapat ditimpa normal UI, mode/bahasa/locks pulih saat reopen, preferences tidak menulis ulang dokumen lama.
- [x] M03-D05 — Implementasikan settings dan penghapusan; AC: prefs/usage memakai data nyata, hapus memerlukan konfirmasi dan owner check, object/snapshot/preview terkait serta cache lokal ditangani sesuai kebijakan, kegagalan bisa dipulihkan/dicoba ulang.
- [x] M03-D06 — Buat entry page dan onboarding ringan; AC: CTA menuju login/app, preference dapat dilewati dan diubah kembali, contoh statis jelas berlabel, tidak ada AI anonim atau tombol fitur backlog.

### M04 — Versioning, diff dan proteksi; owner Terra/Luna; dependency M03

- [x] M04-S01 — Implementasikan checkpoint/history/restore; AC: original immutable, checkpoint manual dan restore menghasilkan snapshot baru, restore menjaga working edits secara aman, history metadata paginated dan autosave tidak membuat versi per ketikan.
- [x] M04-S02 — Implementasikan compare; AC: A/B jelas, tambah/hapus benar pada fixture Unicode/punctuation, no-change state tersedia, compare readonly, exit kembali ke working copy, tanpa LLM.
- [x] M04-S03 — Implementasikan empat metrik lokal; AC: words/characters/reading time/change percentage punya formula dan baseline eksplisit, empty input tidak membagi nol, estimasi diberi label, hitungan tidak memakai AI.
- [x] M04-S04 — Implementasikan Term Lock; AC: lock/unlock dan daftar persisted, exact string dijaga untuk seluruh occurrence yang relevan, scope tidak membawa locks asing, edit manual tidak meninggalkan metadata lock rusak.
- [x] M04-S05 — Implementasikan citation detection/validator; AC: pola author-year yang didukung diuji, kunci manual menutup pola tidak dikenali, exact protection diperiksa server, original/output kosong atau terpotong ditolak sesuai kontrak, tidak mengklaim semua sitasi terdeteksi.

### M05 — Prompt v1 dan backend AI; owner Terra; dependency M03/M04

- [x] M05-A01 — Buat registry prompt wajib server-only; AC: P01–P08/P10 sama persis dengan System Prompt final v1, hash/text comparison lulus, source file tidak diedit, tidak ada import systemprompt.md atau P09 wajib.
- [x] M05-A02 — Buat schemas/envelope/normalizer; AC: runtime v1 dan response P01–P08/P10 teruji, P09 tidak diwajibkan, P03 humanized_text dipetakan internal setelah parse, P06/P08 format mapping eksplisit, custom controls tidak hilang atau menimbulkan audiens ganda.
- [x] M05-A03 — Implementasikan OpenRouter adapter; AC: model/structured-output support terverifikasi, key/prompt server-only, request timeout/error/schema invalid ditangani, output gagal tidak menyentuh editor, tidak ada cross-model fallback diam-diam.
- [x] M05-A04 — Implementasikan limits/privacy/usage/idempotency; AC: kebijakan provider dan batas konfigurasi eksplisit sebelum live, auth+reservasi kuota sebelum spend, double request tidak memanggil provider dua kali, usage generation/repair/discard tercatat, pending/unknown timeout tidak diretry buta.
- [x] M05-A05 — Implementasikan pipeline validasi/P10; AC: hasil rewrite tunggal P01–P06/P08 tervalidasi sebelum preview safe, pelanggaran protected content maksimal satu P10 lalu validasi ulang; P07 ditolak tanpa P10 sesuai C04/C05, gagal lagi ditolak, tidak ada repair untuk sekadar polishing/schema error.
- [x] M05-A06 — Implementasikan Apply/Discard backend; AC: hasil berasal dari stored validated preview, expected revision dan anchor diperiksa, double Apply membuat tepat satu versi, konflik mempertahankan edit terbaru, Discard tidak mengubah sumber.

### M06 — Integrasi enam mode dan Custom; owner Luna/Terra; dependency M05

- [x] M06-W01 — Integrasikan P01 Quick Start sampai workspace; AC: generate→validate→preview→compare/apply/discard nyata, Original tersimpan, Apply membuat satu versi, reload memulihkan hasil applied.
- [x] M06-W02 — Integrasikan P02 Academic; AC: konteks thesis/journal/general_academic bekerja, citation protection aktif, fixture istilah/uncertainty tidak berubah, tidak mengarang sumber.
- [x] M06-W03 — Integrasikan P03 Humanizer; AC: context/strength/preservation mengikuti v1, change_categories tampil, academic tetap academic, Kurangi Perubahan memakai sumber transform yang jelas dan hanya memanggil AI atas tindakan pengguna.
- [x] M06-W04 — Integrasikan P04 Professional; AC: audience/document_type/length diteruskan dan dipakai, facts/commitments/deadlines tetap pada fixtures, state gagal menjaga input.
- [x] M06-W05 — Integrasikan P05 Creative; AC: creative_goal/audience/strength v1 dipakai, gaya berubah tanpa fakta baru dan protection tetap lolos.
- [x] M06-W06 — Integrasikan P06 Simplify; AC: target audience/reading level/length/format dipakai, kondisi dan caveat penting tetap, output sederhana/list/tabel dirender aman tanpa parser file.
- [x] M06-W07 — Integrasikan Sesuaikan dan P08 mandiri; AC: format/length/audience/focus/extra_request tervalidasi, mode+custom satu call mode, Custom mandiri satu call P08, reset/close tidak memanggil AI, tidak ada mode→P08 otomatis.
- [x] M06-W08 — Lengkapi preview dan recovery; AC: Apply/Compare/Copy/Discard bekerja, clipboard failure tertangani, no-change lokal jelas, provider/limit/session/validation/stale-preview error mempertahankan sumber dan menyediakan tindakan recovery yang nyata.

### M07 — Inline alternatives; owner Luna/Terra; dependency M06 dan M00-P03

- [x] M07-I01 — Integrasikan P07; AC: keputusan C04/C05 diterapkan, sukses berisi 3–5 opsi valid/distinct dalam satu call, unsafe/duplicate/empty tidak bisa diterapkan, tidak menambah opsi palsu atau mengubah prompt.
- [x] M07-I02 — Integrasikan selection toolbar dan replace; AC: selection tetap valid saat fokus pindah, context minimal, protected term tidak ditawarkan sebagai replacement, Ganti hanya mengubah target, undo dan versi memulihkan hasil.
- [x] M07-I03 — Integrasikan scoped mode actions; AC: Humanize selection→P03 dan Academic selection→P02, selection kecil tidak mengirim dokumen penuh, anchor stale ditolak dan multi-paragraf memakai transform scope yang sesuai.

### M08 — Operasional minimum; owner Terra; dependency M06/M07

- [x] M08-O01 — Tambahkan log metadata dan usage summary; AC: correlation ID/mode/scope/status/latency/usage dapat ditelusuri tanpa raw source/output/extra_request/title sensitif, tidak perlu vendor analytics eksternal untuk menjalankan MVP.
- [x] M08-O02 — Lengkapi security/data controls; AC: sessions/ownership/private object access tervalidasi pada seluruh surface, secret tidak masuk client bundle, logging tidak menyimpan dokumen, delete failure dapat ditelusuri tanpa bocor data.

### M09 — Verifikasi dan review Astra; dependency M08

- [x] M09-Q01 — Jalankan gate lokal; AC: strict typecheck/lint/unit/integration/migration/build adapter lulus, hasil perintah tercatat, test auth/revision/idempotency/storage recovery/protection mencakup failure path nyata.
- [ ] M09-Q02 — Jalankan evaluasi final v1; AC: fixtures ID/EN untuk P01–P08/P10 mencakup akademik/bisnis/creative/technical text, accepted cases menjaga protected strings dan scope, review menilai makna/register/grammar/fakta, kegagalan dicatat tanpa mengubah prompt diam-diam; live run memakai kredensial dan batas biaya eksplisit.
- [x] M09-Q03 — Audit UI dan scope; AC: semua tombol terlihat bekerja end-to-end, tidak ada Templates/Suggested Locks atau P09 nonaktif (Upload/Export DOCX kini fitur berbayar yang nyata, lihat §13), tidak ada API call saat typing/open/format/history/compare/local metrics; bukti visual/browser hanya diklaim jika benar-benar diminta dan dijalankan.
- [x] M09-Q04 — Review hasil eksekutor; AC: Astra memeriksa diff dan bukti integration semua task MVP, temuan diperbaiki, tidak ada blocker disembunyikan dengan checklist selesai.

### M10 — Release readiness dan deployment; dependency M09

- [x] M10-R01 — Siapkan paket rilis; AC: environment/secrets/migrations/rollback/data retention/provider policy eksplisit dan dapat direview, sisa keputusan brand dicatat, tidak membutuhkan task B/O/X untuk rilis MVP.
- [ ] M10-R02 — Jalankan rilis setelah izin efek eksternal; AC: staging/production data terpisah, deployment/migration terverifikasi dan smoke sesuai izin, laporan membedakan lokal/live AI/browser/push/deploy; tidak menyatakan produksi sukses berdasarkan build saja.

## 6. Dependency check

| Milestone | Prasyarat wajib | Boleh berjalan tanpa |
| --- | --- | --- |
| M01 | M00-P01/P02 | Keputusan P07, brand final, P09, seluruh V1.1 |
| M02 | M01 | AI live, P09, import/export/templates |
| M03 | M01/M02; khusus D05 juga M00-P04 | P07, P09, V1.1 |
| M04 | M03 | AI, P09, file parser |
| M05 | M03/M04; khusus A04 juga M00-P04 | P09, V1.1; keputusan P07 telah dicatat pada C04/C05 |
| M06 | M05 | P07, P09, V1.1 |
| M07 | M06 + keputusan C04/C05 | P09, V1.1 |
| M08 | M06/M07 | Vendor analytics eksternal, P09, V1.1 |
| M09 | M08 | P09, semua task backlog/deferred |
| M10 | M09 + izin deployment | P09, semua task backlog/deferred |

Jalur initial release: M01 → M02 → M03 → M04 → M05 → M06 → M07 → M08 → M09 → M10; review scope M00-P01/P02 menjadi entry gate.

Tidak ada edge balik atau dependency dari M ke B/O/X; fitur V1.1 kelak bergantung pada editor/storage MVP yang sudah stabil, bukan sebaliknya.

R2 tetap diperlukan untuk snapshot versi, bukan berarti import/export masuk MVP; table node sederhana untuk P06/P08 tidak membutuhkan table extraction; queues/OCR/collaboration runtime tidak diperlukan pada jalur AI interaktif.

Pekerjaan independen boleh didelegasikan setelah kontrak bersama stabil; hindari edit simultan pada file kontrak yang sama.

## 7. Backlog V1.1 — jangan implementasi sekarang

Task berikut dicatat untuk masa depan, tidak masuk bundle UI, route aktif, migration khusus fitur, dependency paket parser, atau syarat release initial.

| ID | Backlog | Acceptance criteria saat kelak dikerjakan |
| --- | --- | --- |
| B01 | DOCX import — dipindah ke scope aktif §13 (T05) pada 2026-09-18 | File picker nyata, validasi ukuran/jenis, preview ekstraksi sebelum membuat dokumen, fidelity didokumentasi, error/cancel/retry dan akses privat; tidak memanggil AI untuk parsing |
| B02 | PDF text-based import | Hanya PDF bertulisan selectable, preview urutan baca, file scan/photo ditolak dengan pesan, corrupt/encrypted ditangani; tidak melakukan OCR atau complex table extraction |
| B03 | DOCX export — dipindah ke scope aktif §13 (T06) pada 2026-09-18 | Ekspor revisi tersimpan yang dipilih, isi/format didukung diverifikasi, download privat, progress/error/retry; tidak ada AI |
| B04 | PDF export | Hasil render terbaca, page break/font/Unicode terverifikasi, sumber revision jelas dan download privat; tidak ada AI |
| B05 | Template system | Galeri dan preview memakai template nyata, penggunaan membuat dokumen independen, tidak ada referensi/data palsu, tidak bergantung AI |
| B06 | Suggested locks | Saran diberi label belum terlindungi sampai pengguna memilih, confirm/ignore tersedia dan lock tersimpan; tidak mengubah kunci manual diam-diam |

## 8. Optional dan removed/deferred

| ID | Fitur | Status dan acceptance/batas |
| --- | --- | --- |
| O01 | P09 Quality Evaluation | Opsional, bukan blocker; jika kelak diaktifkan wajib prompt/schema v1, hanya on-demand, requested dimensions/score 1–5/reason/N/A tertangani dan hasil stale dilabeli; jika belum selesai tidak ada CTA/route runtime yang berpura-pura bekerja |
| X01 | OCR PDF scan/photo | Tidak dibangun; tidak ada OCR service/dependency/upload flow pada MVP atau asumsi OCR sebagai bagian B02 |
| X02 | Collaboration realtime | Ditunda; tidak ada multi-user editor, shared cursor, presence atau coordination service |
| X03 | Sharing workspace | Ditunda; semua dokumen single-owner/private, tanpa tombol Share atau public document URL |
| X04 | Plagiarism checker | Tidak dibangun; tidak ada pemeriksaan maupun klaim persentase plagiarisme |
| X05 | AI detector | Tidak dibangun; tidak ada skor/probabilitas AI atau klaim bypass detector |
| X06 | Reference manager | Ditunda; citation protection bukan pencarian sumber, pengelolaan bibliografi atau formatting referensi otomatis |
| X07 | Advanced document intelligence | Ditunda; tidak ada RAG, indexing semantik, knowledge workspace atau analisis dokumen otomatis |
| X08 | Complex table extraction | Ditunda; tidak ada ekstraksi tabel dari PDF/scan atau dependency parser tabel kompleks |

Removed dari rencana lama: milestone import/export/template/mobile file flows sebagai gate MVP, benchmark v1/v3/gabungan, authoring prompt baru, vendor analytics wajib, dan P09 sebagai bagian golden suite wajib.

## 9. Definition of Done dan bukti

Setiap task aktif ditutup dengan ID, file berubah, command/check beserta hasil, dan review Astra; task yang gagal/terblokir tetap terbuka dengan penyebab dan dependency.

Fixture/mocks hanya untuk development/test; aplikasi yang diserahkan menggunakan backend dan provider nyata untuk fitur yang terlihat, error konfigurasi dinyatakan jelas dan tidak diganti hasil AI palsu.

Typing, format, membuka dokumen, lock/unlock, autosave, history, restore, diff, metrik, copy/apply/discard dan membuka Sesuaikan menghasilkan nol panggilan LLM; Generate/scoped rewrite/P07/P08 masing-masing satu primary call, P10 exception maksimal sekali, P09 tidak otomatis.

Scope selesai ketika seluruh task M yang wajib lolos acceptance, tidak ada placeholder UI/backend, konflik yang memengaruhi fitur sudah ditutup, dan laporan menyebut batas bukti verifikasi secara jujur; task B/O/X tidak menghambat status selesai MVP.


## 10. Penutupan implementasi lokal

Bukti rinci per task dan file ada di [docs/verification.md](docs/verification.md); setup ada di [docs/setup.md](docs/setup.md). Semua jalur core memiliki backend aktual dan AI publik tetap off; tidak ada fitur V1.1 yang dijadikan dependency.

Detail implementasi fondasi: style memakai CSS tokens/primitif yang terkontrol; adapter Cloudflare memakai Vinext beta yang tercatat di setup. Tidak ada klaim stabilitas production atau fidelity browser berdasarkan build.

Yang belum dijalankan: login Google nyata, generasi OpenRouter nyata/evaluasi semantik, browser QA, CI remote, push, staging/production dan deploy. Browser QA tidak dijalankan sesuai AGENTS.md; dua checkbox live tetap terbuka, bukan dianggap selesai karena mock tests.


## 11. Tambahan autentikasi atas permintaan pengguna

Instruksi terbaru menggantikan batas Google-only: login username/password dan registrasi masuk scope; Google tetap tersedia bila kredensial dikonfigurasi. Penyimpanan akun, hash password, sesi, dan rate limit memakai D1; tidak memerlukan fitur V1.1 atau panggilan AI.

| ID | Task dan acceptance criteria | Status |
| --- | --- | --- |
| AUTH01 | Registrasi nama/email/username/password; username unik dan ternormalisasi; password di-hash; sesi dibuat dan diarahkan ke workspace | Selesai lokal; direview |
| AUTH02 | Login username atau email, remember me, logout; password salah ditolak; CSRF dan pembatasan login persisten | Selesai lokal; direview |
| AUTH03 | Form login/daftar responsif, validasi inline, show/hide password, loading/error/success, dan bahasa ID/EN; semua tombol memiliki aksi nyata | Selesai lokal; direview |
| AUTH04 | Tombol Google memakai ikon berwarna; foto GPT Image tampil di panel kiri; tidak ada CTA reset password palsu | Selesai lokal; direview |
| AUTH05 | Migrasi D1 lokal, setup integrasi remote, tests, typecheck, lint, build dan dry-run lolos | Selesai lokal; direview |

D1 remote dan Google OAuth nyata tetap menunggu resource/kredensial yang sebelumnya dinyatakan belum tersedia. Reset password dan verifikasi email memerlukan layanan pengiriman email dan tidak diklaim tersedia.

## 12. Refactor UI total atas permintaan pengguna (2026-09-13)

| ID | Task dan acceptance criteria | Status |
| --- | --- | --- |
| UI01 | Landing lengkap: navbar adaptif, hero foto layar penuh, demo statis per mode, fitur, cara kerja, mode, trust, CTA mobile | Selesai lokal |
| UI02 | Login/daftar ringkas dengan ikon lucide, `?next` aman, onboarding bahasa + kebutuhan utama (bisa dilewati) | Selesai lokal |
| UI03 | App shell (sidebar, terbaru, pemakaian), dashboard composer, daftar dokumen, dokumen baru, pengaturan | Selesai lokal |
| UI04 | Workspace: rail, header, toolbar format, menu seleksi, panel AI, pratinjau, linimasa, riwayat, compare A/B inline/berdampingan, analitik | Selesai lokal |
| O01 | P09 on-demand memakai teks prompt final v1; hasil berlabel indikatif, tidak disimpan, `academic_fit` tidak berlaku di luar Akademik | Selesai lokal; output live belum diuji |

Desain: Tailwind CSS v4, palet ink navy + biru brand + kertas hangat, Plus Jakarta Sans (UI) dan Source Serif 4 (editor/judul). Bukti di docs/verification.md.

## 13. Tier berbayar dan perbaikan guard angka atas permintaan pengguna (2026-09-18)

Instruksi terbaru memindahkan B01/B03 (impor/ekspor DOCX) dari backlog §7 ke scope aktif sebagai fitur berbayar, dan mengganti model kuota dari per-permintaan menjadi per-karakter. B02/B04 (PDF) tetap di backlog.

| ID | Task dan acceptance criteria | Status |
| --- | --- | --- |
| T01 | Batas parafrase per tier dari satu katalog (`src/lib/plans.ts`): Gratis 1.000, Plus 2.000, Pro/Tim 5.000 karakter, berlaku untuk run teks terpilih maupun dokumen penuh; `INLINE_LIMIT` 600, `AI_SCOPE_LIMIT` 20.000, dan batas keras 200.000 tidak diubah; ditegakkan server dan tercermin di seluruh petunjuk klien tanpa konstanta ganda | Selesai lokal |
| T02 | Kuota bulanan berbasis karakter dengan reserve-then-settle pada `usage_ledger.charge_characters`; cap dievaluasi di dalam INSERT atomik lewat covering index; provider gagal, hasil ditolak, dan pass repair P10 tidak menagih; replay idempoten hanya menagih sekali | Selesai lokal |
| T03 | Guard angka membandingkan nilai, bukan string digit: separator ID/EN, kata skala, kata-bilangan ID/EN, persen, dan penanda daftar tidak lagi menolak hasil yang sah; multiplisitas diabaikan; angka yang hilang/dikarang/diubah tetap ditolak | Selesai lokal |
| T04 | Kode penolakan terpisah per penyebab (`AI_LOCKED_TERM_REJECTED`, `AI_NUMBER_REJECTED`, `AI_CITATION_REJECTED`, `AI_PLACEHOLDER_REJECTED`) dengan token pelanggar di `details`, menggantikan satu pesan untuk empat penyebab | Selesai lokal |
| T05 | Impor DOCX berbayar: ZIP+XML tanpa dependency baru, sniffing `PK\x03\x04` + `[Content_Types].xml`, batas 5 MB dan batas zip-bomb, pratinjau ekstraksi dengan daftar peringatan sebelum notebook dibuat, hasil selalu lewat `EditorDocumentSchema` | Selesai lokal |
| T06 | Ekspor DOCX berbayar lewat route server sehingga gate-nya nyata; page size, margin, font, dan spacing dari satu sumber `office-defaults.ts` | Selesai lokal |
| T07 | Pratinjau berhalaman mengikuti default Word (A4/Letter per locale, margin 1 inci, Calibri 11pt via Carlito, line-height 1,3184, spacing 8pt) dari variabel yang sama dengan penulis DOCX | Selesai lokal; belum diverifikasi visual |
| T08 | Mode notebook lanjutan berbayar, ditegakkan server: create menolak flag, autosave melepas flag agar penulis tidak terjebak loop gagal simpan | Selesai lokal |
| T09 | Perintah AI bebas per paragraf (berbayar, opsional): batas 300 karakter, disanitasi, dikirim sebagai blok `<user_instruction>` di USER message dengan aturan subordinasi; wajib anchor; seluruh guard tetap berlaku | Selesai lokal |
| T10 | Copy dari notebook menulis `text/html` + `text/plain`, sehingga heading, penekanan, daftar, dan tabel utuh saat di-paste ke Word atau Docs; `documentText()`/`mapping()` tidak disentuh | Selesai lokal |

Keputusan yang dicatat: kata-bilangan hanya dipakai sebagai pencocok nilai, tidak pernah sebagai klaim, supaya kata umum seperti "one" tidak dianggap angka yang dikarang. `charge_characters` tidak di-backfill. Ekspor PDF dan paginasi editor sungguhan tidak dibangun; klaim PDF dihapus dari katalog paket sampai ada jalannya. Billing tetap belum ada: `user.tier` masih diatur admin, jadi seluruh pekerjaan ini adalah plumbing entitlement tanpa jalur pembelian.

Bukti, spike, bug yang ditemukan, dan batas klaim: [docs/verification.md](docs/verification.md) bagian "Tier berbayar".
