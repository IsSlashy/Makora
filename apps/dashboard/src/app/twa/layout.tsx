import type { Metadata, Viewport } from 'next';
import '../globals.css';

// Prevent static pre-rendering — PrivyProvider requires browser APIs
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#050508',
};

export const metadata: Metadata = {
  title: 'MAKORA | Telegram Dashboard',
  description: 'Makora DeFi Agent — live dashboard inside Telegram',
};

export default function TWALayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="twa-page">
        {children}
      </body>
    </html>
  );
}
