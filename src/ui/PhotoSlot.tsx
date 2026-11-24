import { photoUrl } from '../lib/photoUrl';

interface PhotoSlotProps {
  path?: string | null;
  /** A local preview (object URL) shown before the upload finishes. */
  preview?: string | null;
  size?: 40 | 56 | 72 | 96;
  selected?: boolean;
  alt?: string;
}

/** The "écrin": a round setting for a jewel photo, with a neutral ring when there is none. */
export function PhotoSlot({ path, preview, size = 40, selected = false, alt = '' }: PhotoSlotProps) {
  const src = preview ?? photoUrl(path ?? null);
  const classes = ['ecrin', `ecrin--${size}`, selected && 'ecrin--selected', !src && 'ecrin--empty'].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {src ? (
        <img src={src} alt={alt} width={size} height={size} loading="lazy" decoding="async" />
      ) : (
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} aria-hidden="true" focusable="false">
          <circle cx="12" cy="14.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9.5 4.5h5L12 8.2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}
