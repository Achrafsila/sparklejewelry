import { AppError } from './errors';
import { fitWithin } from './photoSize';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

const MAX_SIDE = 1600;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall back to <img> decoding below
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes, shrinks to 1600 px and re-encodes as JPEG (which also drops location metadata). */
export async function preparePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new AppError('PHOTO_ILLISIBLE');
  }
  let image: ImageBitmap | HTMLImageElement;
  try {
    image = await decode(file);
  } catch {
    throw new AppError('PHOTO_ILLISIBLE');
  }
  const { width, height } = fitWithin(image.width, image.height, MAX_SIDE);
  if (!width || !height) throw new AppError('PHOTO_ILLISIBLE');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('PHOTO_ILLISIBLE');
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  if ('close' in image) image.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new AppError('PHOTO_ILLISIBLE');
  return blob;
}

/** Uploads to the "photos" bucket with progress (0–1). Resolves to the stored path. */
export async function uploadPhoto(blob: Blob, folder: 'variants' | 'offers', onProgress: (ratio: number) => void): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppError('NON_AUTORISE');
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/photos/${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', supabaseAnonKey);
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new AppError('PHOTO_ENVOI', xhr.status)));
    xhr.onerror = () => reject(new AppError('RESEAU'));
    xhr.send(blob);
  });
  onProgress(1);
  return path;
}
