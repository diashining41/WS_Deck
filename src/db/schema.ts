import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums */

export const regionEnum = pgEnum('region', ['JP', 'KR', 'OVERSEAS']); // 일본 / 한국 / 해외
export const scaleEnum = pgEnum('t_scale', ['SHOP', 'CS', 'BUSHIROAD']); // 소 / 중 / 대
export const formatEnum = pgEnum('t_format', ['SINGLES', 'TRIO']); // 개인 / 트리오

/**
 * The 13 climax types, spelled exactly as the community (and the source
 * spreadsheet's legend) writes them. Storing the Korean tokens rather than
 * codes keeps the UI, the AI prompt and the DB speaking one vocabulary.
 *
 * Only 10 of the 13 appear in the imported data; 회오리/망원경/보따리 are
 * carried because the legend defines them and new sets can start using them.
 */
export const climaxEnum = pgEnum('climax', [
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
]);

/**
 * Weiß Schwarz has two spin-offs with entirely separate card pools: Rosé (adult
 * visual-novel brands) and Blau. A Rosé deck on a Neo-Standard title page isn't
 * a mislabelled row, it's the wrong game — this site is base WS only.
 *
 * Rosé is decidable from the title alone: every Rosé work carries an OS## code,
 * and in the imported data that rule agrees with the post text 31/31 in both
 * directions. No text heuristic needed.
 */
export const gameEnum = pgEnum('game', ['WS', 'ROSE', 'BLAU']);

export const sourceEnum = pgEnum('source', ['x', 'decklog', 'naver', 'dc', 'wstcg', 'manual']);
export const deckStatusEnum = pgEnum('deck_status', ['published', 'needs_review', 'rejected']);
export const provenanceEnum = pgEnum('provenance', ['sheet_import', 'ai', 'human']);

/* ----------------------------------------------------------------- titles */

export const titles = pgTable(
  'titles',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    code: text('code').notNull(), // GA, GBF, HOL, OS01, 電撃 …
    nameKo: text('name_ko').notNull(),
    nameJa: text('name_ja'),
    /** Which game this work belongs to. Only 'WS' is served. */
    game: gameEnum('game').notNull().default('WS'),
    /** Points at the surviving title when two master rows meant the same work. */
    mergedInto: integer('merged_into'),
    deckCount: integer('deck_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('titles_name_ko_uq').on(t.nameKo),
    index('titles_code_idx').on(t.code),
    index('titles_deck_count_idx').on(t.deckCount),
    index('titles_game_idx').on(t.game),
  ],
);

/**
 * Alternate spellings that appear in post text — Japanese shorthand above all
 * (ホロ, サマポケ, オバロ, グラブル, 学マス …). This table, not the vision
 * model, is what actually identifies the 작품 in most posts.
 */
export const titleAliases = pgTable(
  'title_aliases',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    titleId: integer('title_id')
      .notNull()
      .references(() => titles.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    lang: text('lang').notNull(), // 'ja' | 'ko' | 'en'
    weight: real('weight').notNull().default(1),
  },
  (t) => [uniqueIndex('title_aliases_alias_uq').on(t.alias), index('title_aliases_title_idx').on(t.titleId)],
);

/**
 * Climax shorthand as written in posts: 扉/門/電源/枝/宝/魂/本/フォーカス …
 * and the Korean 초/금/문/게. Derived from the spreadsheet by correlating its
 * labelled rows against the tweet text (scripts/derive-climax-aliases.ts).
 */
export const climaxAliases = pgTable(
  'climax_aliases',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    climax: climaxEnum('climax').notNull(),
    alias: text('alias').notNull(),
    lang: text('lang').notNull(),
    weight: real('weight').notNull().default(1),
  },
  (t) => [uniqueIndex('climax_aliases_alias_uq').on(t.alias)],
);

/* ------------------------------------------------------------------ posts */

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: sourceEnum('source').notNull(),
    /**
     * TEXT, never a number: X snowflake ids are 19 digits and exceed 2^53, so
     * round-tripping one through a JS number silently corrupts its last digits.
     */
    sourceId: text('source_id').notNull(),
    urlCanonical: text('url_canonical').notNull(),
    urlOriginal: text('url_original').notNull(),
    authorHandle: text('author_handle'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    rawText: text('raw_text').notNull().default(''),
    rawJson: jsonb('raw_json'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('posts_source_id_uq').on(t.source, t.sourceId),
    uniqueIndex('posts_url_uq').on(t.urlCanonical),
  ],
);

/* ----------------------------------------------------------------- images */

export const images = pgTable(
  'images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** Position within the post's media array — the tweet's own image order. */
    mediaIndex: smallint('media_index').notNull(),
    originUrl: text('origin_url').notNull(),
    origKey: text('orig_key'),
    thumbKey: text('thumb_key'),
    mediumKey: text('medium_key'),
    width: integer('width'),
    height: integer('height'),
    sha256: text('sha256'),
    blur: text('blur'), // tiny base64 WebP for placeholder="blur"
    /** Drives climax legibility scoring: a decklog render is readable, a table photo often is not. */
    kind: text('kind').notNull().default('user_photo'),
    status: text('status').notNull().default('ok'), // ok | unavailable | error
  },
  (t) => [uniqueIndex('images_post_media_uq').on(t.postId, t.mediaIndex)],
);

/* ------------------------------------------------------------------ decks */

export const decks = pgTable(
  'decks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /**
     * Which image in the post is THIS deck. A trio tweet carries up to 4 decks
     * and 4 photos; in at least one real post two decks share every metadata
     * field, so the image is the only thing that tells them apart. Never render
     * a deck with post.images[0].
     */
    mediaIndex: smallint('media_index').notNull(),
    imageId: uuid('image_id').references(() => images.id, { onDelete: 'set null' }),
    /** False until we have confirmed this deck really is the one in that image. */
    imageVerified: boolean('image_verified').notNull().default(false),

    titleId: integer('title_id').references(() => titles.id),
    titleRaw: text('title_raw'), // verbatim, for growing the alias table

    /** Up to 4 in the real data — modelling this as two columns would drop rows. */
    climaxes: climaxEnum('climaxes').array().notNull().default(sql`'{}'`),

    /**
     * Nullable: the early spreadsheet tabs (2024 H2 – 2025) recorded only the
     * work, climax, date and URL — no country/scale/format columns existed yet.
     * Those rows are archived with these left null; the UI hides the badge when
     * a value is missing rather than inventing one. Captured/AI rows and the
     * 2026 tabs always fill them.
     */
    region: regionEnum('region'),
    scale: scaleEnum('scale'),
    format: formatEnum('format'),
    /**
     * Nullable, and deliberately unconstrained: the spreadsheet's legend claims
     * top-4 is only tracked for 중/대 events, but 11 SHOP-scale rows are marked
     * O. A CHECK tying this to scale would reject real data.
     */
    top4: boolean('top4'),
    placement: smallint('placement'),
    tournamentName: text('tournament_name'),

    status: deckStatusEnum('status').notNull().default('needs_review'),
    provenance: provenanceEnum('provenance').notNull().default('ai'),
    confidence: real('confidence'),
    extracted: jsonb('extracted'),

    /** Sort key for "최신 등록순" — kept on the deck so one index covers list+facets. */
    sortAt: timestamp('sort_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('decks_post_media_uq').on(t.postId, t.mediaIndex),
    index('decks_title_sort_idx').on(t.titleId, t.sortAt.desc(), t.id.desc()),
    index('decks_climaxes_gin').using('gin', t.climaxes),
    index('decks_review_idx').on(t.confidence, t.createdAt),
    index('decks_feed_idx').on(t.sortAt.desc(), t.id.desc()),
  ],
);

/* ----------------------------------------------------------- ingest tables */

export const sourceAccounts = pgTable(
  'source_accounts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    source: sourceEnum('source').notNull(),
    handle: text('handle').notNull(),
    /** 'hot' polls hourly, 'active' every 3h, 'longtail' twice a day. */
    tier: text('tier').notNull().default('longtail'),
    /** Snowflake of the newest tweet we have stored. TEXT for the same reason as posts.source_id. */
    lastSeenId: text('last_seen_id'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    lastPostAt: timestamp('last_post_at', { withTimezone: true }),
    deckCount: integer('deck_count').notNull().default(0),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('source_accounts_uq').on(t.source, t.handle)],
);

export const reviewQueue = pgTable(
  'review_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    reasons: text('reasons').array().notNull().default(sql`'{}'`),
    priority: integer('priority').notNull().default(0),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: jsonb('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('review_queue_open_idx').on(t.resolvedAt, t.priority)],
);

export type Title = typeof titles.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Image = typeof images.$inferSelect;
export type Deck = typeof decks.$inferSelect;
export type Climax = (typeof climaxEnum.enumValues)[number];
