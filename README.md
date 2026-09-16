# AI Writing Workspace

Ruang kerja menulis Indonesia-first (ID/EN): enam mode (Standar, Akademik, Humanize, Profesional, Kreatif, Sederhanakan) + Kustom, pratinjau sebelum diterapkan, kunci istilah & sitasi, riwayat versi, bandingkan versi, dan analisis lokal. Stack: Next.js (vinext) di Cloudflare Workers, D1, R2, Tiptap, Tailwind CSS v4, lucide-react, OpenRouter.

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm db:migrate:local   # menerapkan 0000–0002
pnpm dev
```

## Halaman

| Route | Isi |
| --- | --- |
| `/` | Landing: hero watercolor, berbahasa Inggris, demo editor interaktif dengan contoh statis, fitur, cara kerja, mode, FAQ |
| `/login`, `/register` | Masuk/daftar username-email + Google (opsional) |
| `/onboarding` | Preferensi pertama: bahasa + kebutuhan utama (bisa dilewati) |
| `/app` | Beranda: kartu prompt dengan chip mode, membuat notebook lalu membuka kanvas (`?autoGenerate=1`), plus notebook terbaru |
| `/notebooks` | Semua notebook (kartu folder, cari, ikon & warna, ganti nama, hapus terkonfirmasi, muat lebih banyak) |
| `/notebooks/:id` | Workspace notebook: editor, toolbar format, menu seleksi, panel AI, riwayat versi, `?compare=a:b` |
| `/documents`, `/documents/new`, `/documents/:id` | Redirect ke `/notebooks`, `/app#compose`, `/notebooks/:id` |
| `/projects` | Redirect lama ke `/notebooks` |
| `/settings` | Profil, preferensi, privasi & data, pemakaian AI, hapus akun |

AI tetap nonaktif sampai `AI_PUBLIC_ENABLED=true` dan `OPENROUTER_API_KEY` diisi. P09 (analisis kualitas) hanya berjalan saat diminta.

- [Checklist implementasi](task.md) · [Setup](docs/setup.md) · [Verifikasi](docs/verification.md) · [Kebijakan data](docs/data-policy.md)
