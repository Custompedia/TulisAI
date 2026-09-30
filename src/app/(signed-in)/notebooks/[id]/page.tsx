'use client';
import { useParams } from 'next/navigation';
import Workspace from '@/components/workspace/Workspace';

// The shared signed-in layout keeps the rail beside the editor; keyed by id for fresh state per notebook.
export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  return <Workspace key={id} />;
}
