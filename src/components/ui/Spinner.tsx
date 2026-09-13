import { LoaderCircle } from 'lucide-react';

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-ink-500">
      <Spinner size={18} className="text-brand-600" />{label}
    </div>
  );
}
