import type { Metadata, Viewport } from "next";
import { Comfortaa, Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { AppProvider } from "@/components/AppProvider";
import { DryRunToggle, HeaderNav, NearWalletButton } from "@/components/Header";
import { LogoMark } from "@/components/Logo";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// the wordmark only: a round geometric lowercase in the spirit of NEAR's own logotype
const wordmark = Comfortaa({ weight: "700", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "NearAnyStake",
  description: "Stake NEAR from any chain: NEAR Intents delivers native NEAR to your account, one signature stakes it.",
};

export const viewport: Viewport = { themeColor: "#1f1f1f" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <AppProvider>
          <header className="border-b border-line">
            {/* below lg two rows (brand + account, then tabs + mode); one row from lg up */}
            <div className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-2 [grid-template-areas:'brand_account'_'nav_mode'] lg:flex lg:min-h-[72px] lg:gap-x-2 lg:py-3">
              <Link href="/" aria-label="NearAnyStake home" className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg [grid-area:brand] lg:mr-6">
                <LogoMark size={30} />
                <span className={`${wordmark.className} text-[18px] leading-none tracking-[-0.01em] sm:text-[20px]`}>
                  near<span className="text-accent">anystake</span>
                </span>
              </Link>
              <HeaderNav className="-ml-3 [grid-area:nav] lg:mr-auto lg:ml-0" />
              <div className="justify-self-end [grid-area:mode]">
                <DryRunToggle />
              </div>
              <div className="flex min-w-0 justify-end [grid-area:account]">
                <NearWalletButton />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
          <footer className="border-t border-line">
            <div className="mx-auto flex max-w-6xl flex-col gap-1.5 px-4 py-6 text-xs text-muted">
              <p>
                NearAnyStake is an independent project built for the NEAR Hackathon 2026. Cross-chain deposits route through NEAR Intents (1Click);
                staking through{" "}
                <a className="underline" href="https://docs.anywallet.tech">
                  Any Wallet Kit
                </a>{" "}
                staking modules. Non-custodial: the app never holds keys or funds.
              </p>
              <p>
                Staking reads, quotes and transactions come from <code>@anywalletkit/protocol-staking-native-near</code> and{" "}
                <code>@anywalletkit/protocol-staking-liquid-near</code> (pre-release builds from the <code>feat/near-staking</code> branch).
              </p>
            </div>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
