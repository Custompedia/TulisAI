import type { Mode } from '@/lib/writing/settings';

type Example = { after: string; changes: string[] };
type Sample = { source: string; locked: string[]; outputs: Record<Exclude<Mode, 'custom'>, Example> };

// Hand-written static samples for the landing demo; no AI is called.
export const SAMPLES: Record<'id' | 'en', Sample> = {
  id: {
    source: 'Di era digital yang terus berkembang ini, teknologi informasi memainkan peran yang sangat penting sekali dalam dunia pendidikan. Penelitian ini menggunakan Technology Acceptance Model (TAM) untuk mengukur penerimaan mahasiswa terhadap sistem e-learning (Davis, 1989).',
    locked: ['Technology Acceptance Model (TAM)', '(Davis, 1989)'],
    outputs: {
      standard: { after: 'Teknologi informasi kini sangat penting dalam dunia pendidikan. Penelitian ini memakai Technology Acceptance Model (TAM) untuk mengukur sejauh mana mahasiswa menerima sistem e-learning (Davis, 1989).', changes: ['kosakata', 'struktur kalimat'] },
      academic: { after: 'Teknologi informasi memiliki peran penting dalam pendidikan. Penelitian ini menggunakan Technology Acceptance Model (TAM) untuk mengukur tingkat penerimaan mahasiswa terhadap sistem e-learning (Davis, 1989).', changes: ['hapus redundansi', 'istilah lebih tepat'] },
      humanize: { after: 'Teknologi informasi sudah menjadi bagian penting dari pendidikan. Untuk melihat seberapa jauh mahasiswa menerima sistem e-learning, penelitian ini menggunakan Technology Acceptance Model (TAM) (Davis, 1989).', changes: ['kurangi frasa klise', 'variasi ritme kalimat'] },
      professional: { after: 'Teknologi informasi berperan penting dalam pendidikan. Penelitian ini mengukur penerimaan mahasiswa terhadap sistem e-learning dengan Technology Acceptance Model (TAM) (Davis, 1989).', changes: ['poin utama lebih awal', 'lebih ringkas'] },
      creative: { after: 'Ruang kelas kini tak lepas dari teknologi informasi. Lewat Technology Acceptance Model (TAM), penelitian ini menelusuri seberapa hangat mahasiswa menyambut sistem e-learning (Davis, 1989).', changes: ['pembuka lebih hidup', 'diksi lebih kuat'] },
      simplify: { after: 'Teknologi informasi sangat membantu pendidikan saat ini. Penelitian ini memakai Technology Acceptance Model (TAM), yaitu cara melihat apakah mahasiswa mau memakai sistem e-learning (Davis, 1989).', changes: ['kata lebih umum', 'kalimat lebih pendek'] },
    },
  },
  en: {
    source: "In today's ever-evolving digital era, information technology plays a very crucial and important role in the world of education. This study uses the Technology Acceptance Model (TAM) to measure student acceptance of e-learning systems (Davis, 1989).",
    locked: ['Technology Acceptance Model (TAM)', '(Davis, 1989)'],
    outputs: {
      standard: { after: 'Information technology now plays a crucial role in education. This study uses the Technology Acceptance Model (TAM) to measure how far students accept e-learning systems (Davis, 1989).', changes: ['word choice', 'sentence structure'] },
      academic: { after: "Information technology plays an important role in education. This study applies the Technology Acceptance Model (TAM) to measure students' acceptance of e-learning systems (Davis, 1989).", changes: ['removed redundancy', 'more precise terms'] },
      humanize: { after: 'Information technology has become a core part of education. To see how readily students accept e-learning systems, this study uses the Technology Acceptance Model (TAM) (Davis, 1989).', changes: ['fewer stock phrases', 'varied sentence rhythm'] },
      professional: { after: 'Information technology is central to education. This study measures student acceptance of e-learning systems using the Technology Acceptance Model (TAM) (Davis, 1989).', changes: ['main point first', 'more concise'] },
      creative: { after: 'Classrooms now run on information technology. Through the Technology Acceptance Model (TAM), this study explores how warmly students welcome e-learning systems (Davis, 1989).', changes: ['livelier opening', 'stronger verbs'] },
      simplify: { after: 'Information technology helps education a lot today. This study uses the Technology Acceptance Model (TAM), a way to check whether students want to use e-learning systems (Davis, 1989).', changes: ['everyday words', 'shorter sentences'] },
    },
  },
};
