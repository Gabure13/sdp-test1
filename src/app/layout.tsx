import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RAT — Repo Analysis Tool",
  description:
    "Dashboard of repository metrics: add repos by zip upload or remote clone.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <nav className="app-nav" aria-label="Main navigation">
          <div className="app-nav-inner">
            <Link href="/" className="app-brand" aria-label="RAT home">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7" cy="6" r="2.5" /><circle cx="7" cy="18" r="2.5" /><circle cx="17" cy="6" r="2.5" /><path d="M7 8.5v7M17 8.5v2a4 4 0 0 1-4 4H7" />
                </svg>
              </span>
              <span>RAT<span className="brand-caption">Repository intelligence</span></span>
            </Link>
            <div className="nav-links">
              <Link href="/">Repositories</Link>
              <Link href="/metrics">Insights <span aria-hidden="true">↗</span></Link>
            </div>
            <span className="local-badge"><span />Local workspace</span>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
