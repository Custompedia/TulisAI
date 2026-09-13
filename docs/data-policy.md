# Kebijakan data awal

Disetujui pengguna dalam sesi implementasi core MVP.

- Working document dan versi disimpan sampai pengguna menghapus dokumen atau akun.
- Preview AI kedaluwarsa setelah 24 jam; preview kedaluwarsa tidak boleh diterapkan dan payload harus dibersihkan.
- Penghapusan mencakup dokumen, snapshot, preview, istilah, object turunan dan cache lokal yang terkait; metadata operasional tidak boleh mempertahankan isi teks.
- Source text, output AI, selection, catatan tambahan, judul sensitif dan system prompt tidak masuk log/analytics umum.
- AI publik tetap nonaktif sampai kredensial dan konfigurasi privasi provider diverifikasi; klaim retensi provider harus mengikuti konfigurasi yang nyata.
- Tidak ada kredensial Google OAuth/OpenRouter atau resource Cloudflare yang tersedia pada tahap implementasi ini; verifikasi live dan deployment belum dapat dilakukan.

Batas input, kuota dan durasi timeout merupakan konfigurasi operasional aplikasi, bukan harga atau paket komersial yang disepakati.
