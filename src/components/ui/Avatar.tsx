'use client';
import { useState } from 'react';

export function AvatarGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={`h-full w-full text-brand-800 ${className}`}>
      <circle cx="32" cy="24.5" r="11.5" fill="currentColor" />
      <path d="M9 64c0-13.8 10.3-24 23-24s23 10.2 23 24Z" fill="currentColor" fillOpacity="0.9" />
    </svg>
  );
}

export function Avatar({ name, image, size = 36, className = '' }: { name: string; image?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = Boolean(image) && failed !== image;
  return (
    <span role="img" aria-label={name} className={`relative inline-block shrink-0 overflow-hidden rounded-full bg-brand-100 ring-1 ring-brand-200 ${className}`} style={{ width: size, height: size }}>
      {showImage
        // eslint-disable-next-line @next/next/no-img-element -- remote provider avatars bypass the image optimizer
        ? <img src={image ?? undefined} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(image ?? null)} className="h-full w-full object-cover" />
        : <AvatarGlyph />}
    </span>
  );
}
