import { AppShell } from '@/components/app/AppShell';
import Workspace from '@/components/workspace/Workspace';

// Keyed by id so every project gets fresh workspace state.
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AppShell fullBleed><Workspace key={id} /></AppShell>;
}
