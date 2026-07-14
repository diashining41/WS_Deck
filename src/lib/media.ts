import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import sharp from 'sharp';

/**
 * Deck images arrive in two very different shapes and must not be processed
 * alike:
 *
 *   decklog_render — a synthetic, crisp card grid. Sharpening it rings the tiny
 *                    card text, so we leave it alone.
 *   user_photo     — a phone photo of physical cards on a table: glare, skew,
 *                    soft focus. A light sharpen after downscale rescues detail
 *                    that the review UI (and the vision model) depends on.
 */
export type ImageKind = 'decklog_render' | 'wstcg_upload' | 'user_photo';

const PUBLIC_DIR = 'public';
export const MEDIA_ROOT = 'media';

const THUMB_W = 480; // grid card
const MEDIUM_W = 1080; // lightbox first paint

export interface StoredImage {
  sha256: string;
  origKey: string;
  thumbKey: string;
  mediumKey: string;
  width: number;
  height: number;
  blur: string;
}

function write(key: string, buf: Buffer): void {
  const path = join(PUBLIC_DIR, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

export async function storeImage(bytes: Buffer, kind: ImageKind): Promise<StoredImage> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const shard = sha256.slice(0, 2);

  const img = sharp(bytes, { failOn: 'none' });
  const meta = await img.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const ext = meta.format === 'png' ? 'png' : 'jpg';
  const origKey = `${MEDIA_ROOT}/orig/${shard}/${sha256}.${ext}`;
  const thumbKey = `${MEDIA_ROOT}/thumb/${shard}/${sha256}.webp`;
  const mediumKey = `${MEDIA_ROOT}/medium/${shard}/${sha256}.webp`;

  // Keep the bytes we fetched. Re-encodes are derivatives; the original is the
  // archive, and it is the only copy that survives the tweet being deleted.
  write(origKey, bytes);

  const derive = (w: number) => {
    let p = sharp(bytes, { failOn: 'none' }).resize({ width: w, withoutEnlargement: true });
    if (kind === 'user_photo') p = p.sharpen({ sigma: 0.6 });
    return p.webp({ quality: 78, smartSubsample: true }).toBuffer();
  };

  write(thumbKey, await derive(THUMB_W));
  write(mediumKey, await derive(MEDIUM_W));

  const blurBuf = await sharp(bytes, { failOn: 'none' })
    .resize({ width: 20 })
    .webp({ quality: 40 })
    .toBuffer();

  return {
    sha256,
    origKey: `/${origKey}`,
    thumbKey: `/${thumbKey}`,
    mediumKey: `/${mediumKey}`,
    width,
    height,
    blur: `data:image/webp;base64,${blurBuf.toString('base64')}`,
  };
}

export async function download(url: string, referer?: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      ...(referer ? { Referer: referer } : {}),
    },
  });
  if (!res.ok) throw new Error(`이미지 다운로드 실패 ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
