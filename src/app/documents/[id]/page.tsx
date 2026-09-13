import Workspace from '@/components/workspace/Workspace';

// Keyed by id so every document gets fresh workspace state.
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace key={id} />;
}
