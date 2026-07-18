import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PlatformDialogHost from "./components/PlatformDialogHost";
import SiteUpdateBanner from "./components/SiteUpdateBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Studio CARABASAI",
    template: "%s · Studio CARABASAI",
  },
  applicationName: "Studio CARABASAI",
  description: "Carabasai AI film production studio.",
  icons: {
    icon: [{ url: "/logo-carabasai.svg", type: "image/svg+xml" }],
    shortcut: "/logo-carabasai.svg",
    apple: "/logo-carabasai.svg",
  },
  appleWebApp: {
    capable: true,
    title: "Studio CARABASAI",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const buildVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "development";
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="site-shell min-h-screen">
          <div className="site-shell__background" aria-hidden="true" />
          <div className="site-shell__veil" aria-hidden="true" />
          <div className="site-shell__content">{children}</div>
          <SiteUpdateBanner buildVersion={buildVersion} />
          <PlatformDialogHost />
        </div>
      </body>
    </html>
  );
}
