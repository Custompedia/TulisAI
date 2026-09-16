'use client';
import {
  Archive, BookOpen, Briefcase, Calendar, Camera, ClipboardList, Code, Coffee, Compass, Feather, FileText, FlaskConical, Globe, GraduationCap, Heart, Landmark,
  Leaf, Lightbulb, Mail, MessageSquare, Music, Newspaper, NotebookPen, Palette, PenLine, Presentation, Rocket, Scale, Sparkles, Star, Target, Users, type LucideIcon,
} from 'lucide-react';
import { asMode } from '@/lib/writing/settings';
import { parseNotebookIcon, type NotebookIconName } from '@/lib/notebook/appearance';
import { modeIcon } from '@/components/writing/modes';

export const NOTEBOOK_ICONS: Record<NotebookIconName, LucideIcon> = {
  BookOpen, NotebookPen, GraduationCap, Briefcase, Feather, Lightbulb, Palette, PenLine, FileText, Newspaper, Mail, Presentation, FlaskConical, Scale, Code, Globe,
  Heart, Star, Sparkles, Target, Rocket, Compass, Camera, Music, Coffee, Leaf, Landmark, Users, MessageSquare, ClipboardList, Calendar, Archive,
};

// Emoji render slightly larger than stroke icons at the same nominal size.
export function NotebookIcon({ icon, mode, size = 16, className = '' }: { icon: string | null | undefined; mode: string | null | undefined; size?: number; className?: string }) {
  const parsed = parseNotebookIcon(icon);
  if (parsed?.kind === 'emoji') return <span aria-hidden="true" className={`inline-grid shrink-0 place-items-center leading-none ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.92) }}>{parsed.value}</span>;
  const known = asMode(mode);
  const Icon = parsed?.kind === 'icon' ? NOTEBOOK_ICONS[parsed.name] : known ? modeIcon[known] : FileText;
  return <Icon size={size} aria-hidden="true" className={`shrink-0 ${className}`} />;
}
