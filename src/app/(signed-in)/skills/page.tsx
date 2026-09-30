'use client';
import { Suspense } from 'react';
import { SkillsView } from '@/components/skills/SkillsView';

// Skills moved out of Settings in UX 1b; /settings#skills redirects here.
export default function SkillsPage() {
  return <Suspense><SkillsView /></Suspense>;
}
