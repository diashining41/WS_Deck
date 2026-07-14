CREATE TYPE "public"."climax" AS ENUM('스탠', '문', '찬스', '샷', '회오리', '초이스', '망원경', '포커스', '보따리', '금괴', '책', '게이트', '2소울');--> statement-breakpoint
CREATE TYPE "public"."deck_status" AS ENUM('published', 'needs_review', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."t_format" AS ENUM('SINGLES', 'TRIO');--> statement-breakpoint
CREATE TYPE "public"."game" AS ENUM('WS', 'ROSE', 'BLAU');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('sheet_import', 'ai', 'human');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('JP', 'KR', 'OVERSEAS');--> statement-breakpoint
CREATE TYPE "public"."t_scale" AS ENUM('SHOP', 'CS', 'BUSHIROAD');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('x', 'decklog', 'naver', 'dc', 'wstcg', 'manual');--> statement-breakpoint
CREATE TABLE "climax_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "climax_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"climax" "climax" NOT NULL,
	"alias" text NOT NULL,
	"lang" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"media_index" smallint NOT NULL,
	"image_id" uuid,
	"image_verified" boolean DEFAULT false NOT NULL,
	"title_id" integer,
	"title_raw" text,
	"climaxes" "climax"[] DEFAULT '{}' NOT NULL,
	"region" "region" NOT NULL,
	"scale" "t_scale" NOT NULL,
	"format" "t_format" NOT NULL,
	"top4" boolean,
	"placement" smallint,
	"tournament_name" text,
	"status" "deck_status" DEFAULT 'needs_review' NOT NULL,
	"provenance" "provenance" DEFAULT 'ai' NOT NULL,
	"confidence" real,
	"extracted" jsonb,
	"sort_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"media_index" smallint NOT NULL,
	"origin_url" text NOT NULL,
	"orig_key" text,
	"thumb_key" text,
	"medium_key" text,
	"width" integer,
	"height" integer,
	"sha256" text,
	"blur" text,
	"kind" text DEFAULT 'user_photo' NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"source_id" text NOT NULL,
	"url_canonical" text NOT NULL,
	"url_original" text NOT NULL,
	"author_handle" text,
	"posted_at" timestamp with time zone NOT NULL,
	"raw_text" text DEFAULT '' NOT NULL,
	"raw_json" jsonb,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_id" uuid NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_accounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "source_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" "source" NOT NULL,
	"handle" text NOT NULL,
	"tier" text DEFAULT 'longtail' NOT NULL,
	"last_seen_id" text,
	"last_polled_at" timestamp with time zone,
	"last_post_at" timestamp with time zone,
	"deck_count" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title_aliases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "title_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title_id" integer NOT NULL,
	"alias" text NOT NULL,
	"lang" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "titles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name_ko" text NOT NULL,
	"name_ja" text,
	"game" "game" DEFAULT 'WS' NOT NULL,
	"merged_into" integer,
	"deck_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decks" ADD CONSTRAINT "decks_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_aliases" ADD CONSTRAINT "title_aliases_title_id_titles_id_fk" FOREIGN KEY ("title_id") REFERENCES "public"."titles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "climax_aliases_alias_uq" ON "climax_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "decks_post_media_uq" ON "decks" USING btree ("post_id","media_index");--> statement-breakpoint
CREATE INDEX "decks_title_sort_idx" ON "decks" USING btree ("title_id","sort_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "decks_climaxes_gin" ON "decks" USING gin ("climaxes");--> statement-breakpoint
CREATE INDEX "decks_review_idx" ON "decks" USING btree ("confidence","created_at");--> statement-breakpoint
CREATE INDEX "decks_feed_idx" ON "decks" USING btree ("sort_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "images_post_media_uq" ON "images" USING btree ("post_id","media_index");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_source_id_uq" ON "posts" USING btree ("source","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_url_uq" ON "posts" USING btree ("url_canonical");--> statement-breakpoint
CREATE INDEX "review_queue_open_idx" ON "review_queue" USING btree ("resolved_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "source_accounts_uq" ON "source_accounts" USING btree ("source","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "title_aliases_alias_uq" ON "title_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "title_aliases_title_idx" ON "title_aliases" USING btree ("title_id");--> statement-breakpoint
CREATE UNIQUE INDEX "titles_name_ko_uq" ON "titles" USING btree ("name_ko");--> statement-breakpoint
CREATE INDEX "titles_code_idx" ON "titles" USING btree ("code");--> statement-breakpoint
CREATE INDEX "titles_deck_count_idx" ON "titles" USING btree ("deck_count");--> statement-breakpoint
CREATE INDEX "titles_game_idx" ON "titles" USING btree ("game");