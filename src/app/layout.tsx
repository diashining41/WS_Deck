import type { Metadata } from 'next';
import Link from 'next/link';

import './globals.css';

export const metadata: Metadata = {
  title: '바이스슈발츠 대회 덱 레시피',
  description: 'X · 공식 홈페이지 · 카페의 바이스슈발츠 대회 덱 레시피를 타이틀별로 모아봅니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              바이스슈발츠 <span className="text-[var(--accent)]">덱 레시피</span>
            </Link>
            <span className="text-xs text-[var(--muted)]">대회 레시피만 모읍니다</span>
            <Link
              href="/admin/review"
              className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--accent)]"
            >
              검수
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-5 pb-12 pt-8 text-xs leading-relaxed text-[var(--muted)]">
          덱 레시피 이미지와 본문의 저작권은 각 게시자에게 있습니다. 모든 항목은 원본 게시물로 연결됩니다.
        </footer>
      </body>
    </html>
  );
}
