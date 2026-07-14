import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { loadEnv } from '@/lib/env';

import { PostExtraction, type PostExtractionResult } from './schema';
import { buildSystemPrompt, type TitleRow } from './prompt';

/**
 * Opus rather than Sonnet, deliberately.
 *
 * The hard part of this pipeline is reading a climax trigger icon off a phone
 * photo of cards on a table — glare, skew, tiny print. Every deck the model
 * can't read confidently lands in the human review queue, so accuracy converts
 * directly into review minutes. At ~500 decks/month the model choice is worth
 * roughly $15 either way; a week of avoidable review is worth more than that.
 */
const MODEL = 'claude-opus-4-8';

export interface ExtractInput {
  text: string;
  source: string;
  authorHandle: string | null;
  postedAt: Date;
  /** Public keys under /public — e.g. "/media/medium/ab/….webp" */
  imageKeys: string[];
}

export interface ExtractOutput {
  result: PostExtractionResult;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
  };
}

// Opus 4.8: $5 / $25 per Mtok. Cache reads bill at 0.1x, writes at 1.25x.
const IN = 5 / 1_000_000;
const OUT = 25 / 1_000_000;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    loadEnv();
    // Zero-arg: the SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an
    // `ant auth login` profile on disk, in that order. Demanding the env var
    // here would reject a perfectly good browser login.
    client = new Anthropic();
  }
  return client;
}

/**
 * Missing credentials surface as a plain Error at *request* time — not as an
 * AuthenticationError, and not from the constructor. A catch that only looks for
 * the typed error reports it as N identical mystery failures instead of the one
 * thing that is actually wrong, so match the message too.
 */
export function isAuthError(err: unknown): boolean {
  if (err instanceof Anthropic.AuthenticationError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /could not resolve authentication|api[_ ]?key|authentication_error/i.test(msg);
}

export const CREDENTIALS_HELP = [
  '❌ Anthropic 자격증명이 없습니다.',
  '',
  '  방법 1 — API 키',
  '     프로젝트 루트에 .env.local 을 만들고:',
  '       ANTHROPIC_API_KEY=sk-ant-...',
  '     (키 발급: https://console.anthropic.com/settings/keys)',
  '',
  '  방법 2 — 브라우저 로그인 (키를 파일에 두지 않아도 됨)',
  '       ant auth login',
].join('\n');

function imageBlock(key: string): Anthropic.ImageBlockParam {
  const path = join('public', key.replace(/^\//, ''));
  const bytes = readFileSync(path);
  const media = key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return {
    type: 'image',
    source: { type: 'base64', media_type: media, data: bytes.toString('base64') },
  };
}

export async function extractPost(input: ExtractInput, titles: TitleRow[]): Promise<ExtractOutput> {
  const anthropic = getClient();

  // Label each image BEFORE the image itself. The model binds indices reliably
  // only when the label precedes the bytes it names.
  const content: Anthropic.ContentBlockParam[] = [];
  for (const [i, key] of input.imageKeys.entries()) {
    content.push({ type: 'text', text: `IMAGE INDEX ${i}:` });
    content.push(imageBlock(key));
  }

  content.push({
    type: 'text',
    text: [
      `# 게시물`,
      `출처: ${input.source}`,
      input.authorHandle ? `작성자: @${input.authorHandle}` : '',
      `작성일: ${input.postedAt.toISOString().slice(0, 10)}`,
      `이미지 수: ${input.imageKeys.length}`,
      '',
      '## 본문',
      input.text || '(본문 없음)',
      '',
      '위 게시물에서 대회 덱 레시피를 추출하십시오.',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    // Adaptive thinking is OFF unless asked for on Opus 4.8. Reading climax
    // icons off a bad photo is exactly the kind of work worth thinking about.
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: zodOutputFormat(PostExtraction),
    },
    system: [
      {
        type: 'text',
        text: buildSystemPrompt(titles),
        // Breakpoint on the last system block: caches the whole title master.
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ],
    messages: [{ role: 'user', content }],
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('구조화 출력 파싱 실패');

  const u = response.usage;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;

  return {
    result: parsed,
    usage: {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead,
      cacheWrite,
      costUsd: u.input_tokens * IN + cacheRead * IN * 0.1 + cacheWrite * IN * 1.25 + u.output_tokens * OUT,
    },
  };
}
