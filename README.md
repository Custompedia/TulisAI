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
| `/` | Landing: hero watercolor, demo editor interaktif dengan contoh statis ID/EN, fitur, cara kerja, mode, FAQ |
| `/login`, `/register` | Masuk/daftar username-email + Google (opsional) |
| `/onboarding` | Preferensi pertama: bahasa + kebutuhan utama (bisa dilewati) |
| `/app` | Dashboard: composer Quick Start + dokumen terbaru |
| `/documents`, `/documents/new` | Semua dokumen (hapus terkonfirmasi) dan dokumen baru |
| `/documents/:id` | Workspace: editor, toolbar format, menu seleksi, panel AI, linimasa versi, `?panel=history`, `?panel=analytics`, `?compare=a:b` |
| `/settings` | Profil, preferensi, privasi & data, pemakaian AI, hapus akun |

AI tetap nonaktif sampai `AI_PUBLIC_ENABLED=true` dan `OPENROUTER_API_KEY` diisi. P09 (analisis kualitas) hanya berjalan saat diminta.

- [Checklist implementasi](task.md) · [Setup](docs/setup.md) · [Verifikasi](docs/verification.md) · [Kebijakan data](docs/data-policy.md)
