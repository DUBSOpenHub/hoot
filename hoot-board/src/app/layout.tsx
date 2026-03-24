import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hoot 🦉 — The AI That Never Sleeps",
  description:
    "Personal AI daemon that runs 24/7. Built by Gregg Cochran with over 100 AI agents across 10 models using the GitHub Copilot CLI. No hand-written code.",
  icons: [],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
