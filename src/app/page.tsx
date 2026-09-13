import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';

export const metadata: Metadata = {
  description: 'Paraphrase and refine your writing in one workspace. Choose a style, protect terms and citations, preview changes, and stay in control.',
};

export default function LandingPage() {
  return <Landing />;
}
