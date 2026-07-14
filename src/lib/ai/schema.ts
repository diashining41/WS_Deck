import { z } from 'zod';

/**
 * The extraction contract.
 *
 * Two constraints drive the shape:
 *
 *  1. **One post can hold up to four decks.** A trio team posts every member's
 *     list in a single tweet, and in at least one real post two of those decks
 *     are identical in every metadata field — the image is the only thing that
 *     tells them apart. So each deck must name the image it came from.
 *
 *  2. **The model must never invent a 작품.** It picks a code from the master
 *     list or returns null. Left free, 148 titles becomes 400 fragments in three
 *     months, and no amount of downstream cleanup gets that back.
 */

export const CLIMAX_VALUES = [
  '스탠',
  '문',
  '찬스',
  '샷',
  '회오리',
  '초이스',
  '망원경',
  '포커스',
  '보따리',
  '금괴',
  '책',
  '게이트',
  '2소울',
] as const;

/**
 * Non-deck images are the classic trio failure: four photos, three decks,
 * because photo #1 is the team holding up a trophy. Classify first, then bind.
 */
export const IMAGE_KIND = [
  'decklog_render',
  'deck_list_scan',
  'physical_deck_photo',
  'award_or_people',
  'other',
] as const;

const ImageAnalysis = z.object({
  index: z.number().int().describe('The IMAGE INDEX label shown above this image.'),
  kind: z.enum(IMAGE_KIND),
  legible: z.boolean().describe('Can the individual cards actually be made out?'),
  readable_climaxes: z
    .array(z.enum(CLIMAX_VALUES))
    .describe('Climax types you can actually SEE in this image. Empty if you cannot read them.'),
  title_hint: z.string().nullable().describe('Series you recognise from the card art, verbatim. Null if unsure.'),
});

const DeckExtraction = z.object({
  seq: z.number().int().describe('0-based order within the post.'),
  image_index: z
    .number()
    .int()
    .nullable()
    .describe('Which IMAGE INDEX holds THIS deck. Null if you cannot bind it confidently.'),
  binding_basis: z.enum(['positional', 'image_content', 'unknown']),

  title_code: z
    .string()
    .nullable()
    .describe('MUST be a code from the supplied master list, or null if the work is not on it.'),
  title_raw: z.string().nullable().describe('The work name exactly as written in the post, if it is written at all.'),
  title_evidence: z
    .string()
    .describe('Verbatim quote from the post text, or a string starting with "image:" if read from the art.'),

  climaxes: z.array(z.enum(CLIMAX_VALUES)).max(4),
  climax_source: z.enum(['text', 'image', 'none']),
  climax_evidence: z.string(),

  player_name: z.string().nullable(),
  trio_position: z.enum(['선봉', '중견', '대장']).nullable(),
  placement: z.number().int().nullable().describe('1 = 우승. Null if not stated.'),
  top4: z.boolean().nullable(),

  self_confidence: z.object({
    title: z.number(),
    climax: z.number(),
    binding: z.number(),
  }),
});

export const PostExtraction = z.object({
  images: z.array(ImageAnalysis),

  is_tournament: z.boolean().describe('False for casual builds, deck showcases, 첨삭 requests, sale posts.'),
  tournament_evidence: z
    .string()
    .describe('Verbatim quote from the post proving it is a tournament result. Empty if is_tournament is false.'),
  not_tournament_reason: z.string().nullable(),

  tournament_name: z.string().nullable(),
  scale: z.enum(['소', '중', '대']).nullable().describe('소=샵 공인 · 중=사설 CS · 대=부시로드 주관'),
  format: z.enum(['개인', '트리오']).nullable(),
  region: z.enum(['일본', '한국', '해외']),

  deck_count: z.number().int().min(0).max(4),
  decks: z.array(DeckExtraction).max(4),
});

export type PostExtractionResult = z.infer<typeof PostExtraction>;
export type DeckExtractionResult = z.infer<typeof DeckExtraction>;
