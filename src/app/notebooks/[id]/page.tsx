'use client';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app/AppShell';
import Workspace from '@/components/workspace/Workspace';

// Client page so AppShell and Workspace share one module graph; keyed by id for fresh state.
export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  return <AppShell bare><Workspace key={id} /></AppShell>;
}
