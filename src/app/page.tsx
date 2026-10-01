import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';

export const metadata: Metadata = {
  description: 'Parafrase dan sempurnakan tulisan dalam satu ruang kerja. Pilih gaya, lindungi istilah dan sitasi, lihat perubahan, dan tetap pegang kendali.',
};

export default function LandingPage() {
  return <Landing />;
}
