import { MediaItem, GroupedMedia } from '../types';

/**
 * Groups media items by 'none', 'day', 'month', or 'year' in Italian locale,
 * matching static/scripts/grouping.js.
 */
export function groupMediaItems(
  items: MediaItem[],
  level: 'none' | 'day' | 'month' | 'year'
): GroupedMedia[] {
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp);

  if (level === 'none') {
    return [{ title: '', items: sorted }];
  }

  const groups = new Map<string, MediaItem[]>();

  for (const item of sorted) {
    const date = new Date(item.timestamp * 1000);
    let key = '';
    if (level === 'day') {
      key = date.toLocaleDateString('it-IT', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } else if (level === 'month') {
      key = date.toLocaleDateString('it-IT', {
        month: 'long',
        year: 'numeric',
      });
    } else if (level === 'year') {
      key = date.getFullYear().toString();
    }

    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  }

  return Array.from(groups.entries()).map(([title, groupItems]) => ({
    title,
    items: groupItems,
  }));
}

export function isVideoFilename(filename: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(filename);
}
