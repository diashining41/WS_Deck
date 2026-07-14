import type { Climax } from '@/db/schema';

/**
 * Climax shorthand, as written in posts.
 *
 * Derived from the spreadsheet rather than hand-written: 485 rows already pair a
 * human-verified Korean label with a post whose text spells the same climax in
 * shorthand, so correlating them recovers the table. See
 * scripts/derive-climax-aliases.ts.
 *
 * Confidence, from that derivation:
 *   문 11/11 · 게이트 5/5 · 책 2/2 · 금괴 7/8 · 초이스 7/9 · 스탠 16/18
 *
 * Three more were settled by cross-referencing an opponent's deck named in the
 * text against that title's known climaxes elsewhere in the sheet — e.g. the
 * text writes "ウマ娘 魂宝" and every 우마무스메 row is 금괴/2소울; 宝 is already
 * pinned to 금괴, so 魂 must be 2소울:
 *   포커스 (ブラダス 8フォーカス → 포커스)
 *   2소울  (ウマ娘 魂宝 → 금괴/2소울)
 *   찬스   (テイルズチャンス宝 → 찬스/금괴)
 *
 * 샷 · 회오리 · 망원경 · 보따리 have no usable rows in the corpus yet, so they
 * carry the obvious literal shorthand and are unverified.
 */
export const CLIMAX_ALIASES: Record<Climax, string[]> = {
  문: ['扉', '문'],
  게이트: ['門', 'ゲート', '게이트', '게'],
  스탠: ['電源', '電', 'スタンバイ', 'スタン', '스탠바이', '스탠'],
  // 択 is 選択 clipped — "八択" is 8 choice, and it shows up as often as 枝.
  초이스: ['枝', '択', 'チョイス', '초이스', '초'],
  금괴: ['宝', 'トレジャー', '금괴', '금'],
  책: ['本', 'ドロー', '책'],
  포커스: ['フォーカス', '焦点', '포커스', '포커'],
  '2소울': ['魂', 'ソウル', '2소울', '더블소울'],
  찬스: ['チャンス', '찬스'],
  // Unverified — no occurrences in the imported corpus.
  샷: ['ショット', '샷'],
  회오리: ['リターン', '회오리'],
  망원경: ['望遠鏡', '망원경'],
  보따리: ['プール', '보따리'],
};

/**
 * Japanese/Korean shorthand for series titles, keyed by the master code.
 *
 * This table — not the vision model — is what identifies the 작품 in most posts.
 * Tweets almost never spell a title out: they write ホロ, サマポケ, オバロ, グラブル.
 * scripts/seed-aliases.ts reports how much of the corpus these actually cover, so
 * gaps show up as a number instead of as silent misses.
 */
export const TITLE_ALIASES: Record<string, string[]> = {
  GA: ['GA文庫', 'GA'],
  GBF: ['グラブル', 'グランブルーファンタジー'],
  BRD: ['ブラダス', 'ブラウンダスト', 'ブラウンダスト2', 'ブラダス2', 'ブラウンピザ'],
  ALL: ['アサリリ', 'アサリ', 'アサルトリリィ'],
  SMP: ['サマポケ', 'サマーポケッツ', 'Summer Pockets'],
  OVL: ['オバロ', 'オーバーロード'],
  THP: ['東方project', '東方プロジェクト', '東方'],
  DDD: ['ダンダダン'],
  IMC: ['デレマス', 'シンデレラガールズ', 'シンデレラ', 'デレ'],
  UMA: ['ウマ娘', 'ウマ'],
  OS10: ['ネイブル'],
  LHS: ['蓮ノ空', 'ハスノソラ', '하스동'],
  DAL: ['デアラ', 'デート・ア・ライブ', 'デートアライブ'],
  GIM: ['学マス', '学園アイドルマスター', '学園マスター'],
  PJS: ['プロセカ', 'プロジェクトセカイ'],
  HOL: ['ホロライブ', 'ホロ'],
  NIK: ['ニケ', '勝利の女神'],
  BAV: ['ブルアカ', 'ブルーアーカイブ'],
  TAL: ['テイルズ'],
  ISC: ['シャニマス'],
  IMS: ['ミリマス', 'ミリオン', 'ミリオンライブ'],
  BD: ['バンドリ', 'BanG Dream'],
  SBY: ['青ブタ', '青春ブタ野郎'],
  KJ8: ['怪獣8号'],
  MAR: ['マーベル', 'MARVEL', 'marvel'],
  OSK: ['推しの子'],
  AGS: ['アリスギア', 'アリス・ギア'],
  RZ: ['リゼロ', 'Re:ゼロ'],
  AZL: ['アズールレーン', 'アズレン'],
  KGL: ['かぐや', 'かぐや様'],
  SY: ['ハルヒ', '涼宮ハルヒ'],
  ARI: ['ありふれ'],
  AOH: ['あおぎり', 'あおぎり高校'],
  SKS: ['スニーカー文庫', 'スニーカー'],
  KOF: ['KOF', 'キングオブファイターズ'],
  '5HY': ['五等分', '5等分', '五等分の花嫁'],
  CCS: ['カードキャプターさくら', 'カドサク', 'カキャプ', '카캡사'],
  SAO: ['SAO', 'ソードアート', 'ソードアート・オンライン'],
  LL: ['ラブライブ', 'μ\'s'],
  LSS: ['サンシャイン', 'Aqours'],
  LSP: ['スーパースター', 'Liella'],
  LNJ: ['虹ヶ咲', 'ニジガク'],
  LSF: ['スクフェス'],
  SFN: ['フリーレン', '葬送のフリーレン'],
  KMD: ['メイドラゴン', 'メイドラ'],
  CSM: ['チェンソーマン', 'チェンソー'],
  SPY: ['スパイファミリー', 'SPY×FAMILY'],
  P5: ['ペルソナ'],
  FS: ['Fate', 'フェイト'],
  FGO: ['FGO', 'Fate/Grand Order'],
  HBR: ['ヘブバン', 'ヘブンバーンズレッド'],
  LRC: ['リコリコ', 'リコリス・リコイル'],
  TSK: ['転スラ'],
  MTI: ['無職転生', '無職'],
  DDM: ['ダンまち'],
  KS: ['このすば'],
  GU: ['ごちうさ', 'ご注文はうさぎですか'],
  YRC: ['ゆるキャン'],
  BTR: ['ぼっち・ざ・ろっく', 'ぼざろ', 'ぼっち'],
  GCR: ['ガルクラ', 'ガールズバンドクライ'],
  MKI: ['マケイン', '負けヒロイン'],
  RKN: ['るろ剣', 'るろうに剣心'],
  DJ: ['D4DJ'],
  SG: ['シンフォギア'],
  KC: ['艦これ', '艦隊これくしょん'],
  EV: ['エヴァ', 'エヴァンゲリオン'],
  JJ: ['ジョジョ'],
  MM: ['まどマギ', 'まどか'],
  AB: ['エンジェルビーツ', 'Angel Beats'],
  KEY: ['Key'],
  DBG: ['神様になった日', '神ヒ'],
  STG: ['シュタゲ', 'シュタインズゲート'],
  AOT: ['進撃', '進撃の巨人'],
  BM: ['モノガタリ', '物語'],
  RSL: ['レヴュースタァライト', 'スタァライト'],
  PXR: ['ピクサー', 'PIXAR'],
  DISN: ['ディズニー', 'Disney'],
  SW: ['スターウォーズ', 'STAR WARS'],
  GZL: ['ゴジラ'],
  PD: ['プロジェクトディーヴァ', 'ミク'],
  VRG: ['バーチャルガール'],
  ATLA: ['アバター'],
  TRV: ['東リベ', '東京リベンジャーズ'],
  SDS: ['七つの大罪'],
  CTB: ['キャプテン翼'],
  AW: ['アクセルワールド'],
  RG: ['超電磁砲', 'レールガン'],
  NGL: ['ノーゲームノーライフ', 'ノゲノラ'],
  GGO: ['ガンゲイル', 'GGO'],
  PRD: ['プリコネ'],
  YHN: ['幻日のヨハネ', 'ヨハネ'],
  KNK: ['カノカノ', 'かのかり'],
  CHA: ['シャーロット', 'Charlotte'],
  LB: ['リトバス', 'リトルバスターズ'],
  RW: ['リライト', 'Rewrite'],
  SS: ['シャナ', '灼眼のシャナ'],
  SHS: ['冴えカノ'],
  NK: ['ニセコイ'],
  GL: ['グレンラガン'],
  DC: ['ダカーポ', 'D.C.'],
  PI: ['プリズマイリヤ', 'イリヤ'],
  AYT: ['あやかしトライアングル'],
  GBS: ['ゴブスレ', 'ゴブリンスレイヤー'],
  WTR: ['ワールドトリガー', 'ワートリ'],
  ZLS: ['ゾンビランドサガ', 'ゾンサガ'],
  IM: ['アイマス', 'THE IDOLM@STER'],
  KMN: ['けもフレ', 'けものフレンズ'],
  ND: ['なのは', 'リリカルなのは'],
  DCT: ['ディサイド'],
  LOD: ['ロストディケイド'],
  ANM: ['アネモイ'],
  CGS: ['シヨコ'],
  DS: ['ダルセーニョ'],
  BFR: ['防振り', '防御力'],
  HLL: ['ヒナロジ'],
  GRI: ['グリザイア'],
  LH: ['ログホラ', 'ログ・ホライズン'],
  RSK: ['リアセカイ'],
  MDE: ['マクロス'],
  PY: ['ぷよぷよ'],
  FXX: ['ダリフラ'],
  KMS: ['きんいろモザイク', 'きんモザ'],
  TL: ['ToLOVEる'],
  FT: ['フェアリーテイル'],
  AMG: ['甘神さんち'],
  PAD: ['パズドラ'],
  GF: ['ガールフレンド'],
  KR: ['境界のRINNE'],
  VS: ['ヴィヴィッドストライク'],
  NS: ['なのは'],
  OS01: ['ゆずソフト'],
  OS02: ['まどそふと'],
  OS03: ['はるかぜ'],
  OS04: ['異種族レビュアーズ'],
  OS05: ['SPRITE'],
  OS06: ['枕'],
  OS07: ['ルーズウィスプ'],
  OS08: ['アクアプラス'],
  OS09: ['アリスソフト'],
  OS11: ['パープル'],
  OS12: ['ぬきたし'],
  OS13: ['オーガスト'],
  電撃: ['電撃文庫'],
  富士見: ['富士見ファンタジア文庫', '富士見'],
};

/**
 * Korean shorthand, keyed by master code.
 *
 * The master's own 작품 names are the long forms (그랑블루판타지, 섬머포켓), but
 * Korean posts type the short ones — and sometimes a different spelling of them
 * (서머포켓 vs the master's 섬머포켓). Without these, half the Korean corpus reads
 * as "title not named" even when it plainly is.
 */
export const TITLE_ALIASES_KO: Record<string, string[]> = {
  GBF: ['그랑블루', '그랑블'],
  SMP: ['서머포켓', '섬포', '서포'],
  BRD: ['브더', '브더2', '브라운더스트2'],
  ALL: ['어설트', '아사리리', '어설트릴리'],
  THP: ['동방'],
  HOL: ['홀로'],
  UMA: ['우마'],
  IMC: ['신데렐라', '신데'],
  IMS: ['밀리'],
  GIM: ['학마스'],
  DAL: ['데어라'],
  LHS: ['하스동', '하스노소라'],
  PJS: ['프세카'],
  BAV: ['블아'],
  SAO: ['소아온'],
  CCS: ['카캡사'],
  '5HY': ['오등분'],
  PAD: ['퍼즈도라', '퍼즐앤드래곤'],
  LRC: ['리코리코'],
  OSK: ['최애'],
  SBY: ['청춘돼지'],
  BTR: ['봇치'],
  KJ8: ['괴수8호'],
  TAL: ['테일즈'],
  ISC: ['샤니'],
  OVL: ['오버로드'],
  DDD: ['단다단'],
  NIK: ['니케'],
  GA: ['GA문고'],
};
