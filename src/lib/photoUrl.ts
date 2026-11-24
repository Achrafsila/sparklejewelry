import { supabaseUrl } from './supabase';

/** Public URL of a photo stored in the "photos" bucket. */
export function photoUrl(path: string | null): string | null {
  if (!path) return null;
  return `${supabaseUrl}/storage/v1/object/public/photos/${path.split('/').map(encodeURIComponent).join('/')}`;
}
