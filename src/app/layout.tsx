import type { Metadata, Viewport } from "next";
import { Comfortaa, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { AppProvider } from "@/components/AppProvider";
import { BackendBadge } from "@/components/BackendBadge";
import { DryRunToggle, HeaderNav, NearWalletButton } from "@/components/Header";
import { LogoMark } from "@/components/Logo";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// the wordmark only: a round geometric lowercase in the spirit of NEAR's own logotype
const wordmark = Comfortaa({ weight: "700", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Stake Anywhere",
  description: "Stake NEAR from any chain: NEAR Intents delivers native NEAR to your account, one signature stakes it.",
};

export const viewport: Viewport = { themeColor: "#1f1f1f" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <AppProvider>
          <header className="border-b border-line">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3.5">
              <Link href="/" aria-label="Stake Anywhere home" className="flex shrink-0 items-center gap-2">
                <LogoMark size={30} />
                <span className={`${wordmark.className} text-[18px] leading-none tracking-[-0.01em] sm:text-[20px]`}>
                  stake<span className="text-accent">anywhere</span>
                </span>
              </Link>
              {/* phones: logo + wallet on top, nav + dry-run switch below */}
              <div className="flex items-center gap-2 sm:order-3">
                <span className="hidden sm:block">
                  <DryRunToggle compact />
                </span>
                <NearWalletButton />
              </div>
              <div className="flex w-full items-center justify-between gap-2 sm:order-2 sm:w-auto">
                <HeaderNav />
                <span className="sm:hidden">
                  <DryRunToggle compact />
                </span>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-col gap-1.5 px-4 py-6 text-xs text-muted">
              <p>
                Stake Anywhere is an independent project built for the NEAR Hackathon 2026. Cross-chain deposits route through NEAR Intents (1Click);
                staking through{" "}
                <a className="underline" href="https://docs.anywallet.tech">
                  Any Wallet Kit
                </a>{" "}
                staking modules. Non-custodial: the app never holds keys or funds.
              </p>
              <p>
                <BackendBadge />
              </p>
            </div>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
