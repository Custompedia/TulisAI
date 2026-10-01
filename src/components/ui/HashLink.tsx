'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { setHash } from '@/lib/client/hash';

type Props = Omit<React.ComponentProps<typeof Link>, 'href'> & { href: string };

// A link to a hash sub-page (e.g. /settings#pemakaian). On the same page it only swaps the hash, so the
// page and the sidebar switch together; from elsewhere it is an ordinary client navigation.
export function HashLink({ href, onClick, ...rest }: Props) {
  const pathname = usePathname();
  const [path, hash] = href.split('#');
  return (
    <Link href={href} {...rest} onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented || !hash || path !== pathname || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); setHash(hash);
    }} />
  );
}
