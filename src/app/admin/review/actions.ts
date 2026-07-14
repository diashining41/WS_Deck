'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { decks, titles, type Climax } from '@/db/schema';

export interface ApproveInput {
  deckId: string;
  climaxes: Climax[];
  titleId: number | null;
  imageId: string | null;
}

/**
 * One click ends the review. The deck goes live, and the image binding is
 * recorded as verified — which is the whole point for trio posts, where the
 * image is the only thing distinguishing two otherwise identical decks.
 */
export async function approveDeck(input: ApproveInput): Promise<void> {
  await db
    .update(decks)
    .set({
      climaxes: input.climaxes,
      titleId: input.titleId,
      imageId: input.imageId,
      imageVerified: true,
      status: 'published',
      provenance: 'human',
      confidence: 1,
    })
    .where(eq(decks.id, input.deckId));

  await recount();
  revalidatePath('/admin/review');
}

export async function rejectDeck(deckId: string): Promise<void> {
  await db
    .update(decks)
    .set({ status: 'rejected', provenance: 'human' })
    .where(eq(decks.id, deckId));

  await recount();
  revalidatePath('/admin/review');
}

async function recount(): Promise<void> {
  await db.execute(
    // Keeps the title index honest — a rejected deck should stop being counted.
    // eslint-disable-next-line
    (await import('drizzle-orm')).sql`
      UPDATE titles SET deck_count = (
        SELECT count(*) FROM decks
        WHERE decks.title_id = titles.id AND decks.status = 'published'
      )
    `,
  );
}

export async function listTitleOptions(): Promise<{ id: number; nameKo: string; code: string }[]> {
  return db.select({ id: titles.id, nameKo: titles.nameKo, code: titles.code }).from(titles).orderBy(titles.nameKo);
}
