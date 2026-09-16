import { redirect } from 'next/navigation';

export default async function DocumentRedirect({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const item of [value ?? []].flat()) query.append(key, item);
  const search = query.toString();
  redirect(`/projects/${encodeURIComponent(id)}${search ? `?${search}` : ''}`);
}
