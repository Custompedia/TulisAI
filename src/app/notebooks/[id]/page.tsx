import { AppShell } from '@/components/app/AppShell';
import Workspace from '@/components/workspace/Workspace';

// Keyed by id so every notebook gets fresh workspace state.
export default async function NotebookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell bare><Workspace key={id} /></AppShell>;
}
