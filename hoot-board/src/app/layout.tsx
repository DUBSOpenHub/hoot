import type { Metadata } from "next";
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
  title: "Hoot 🦉 Dashboard",
  description:
    "The AI That Never Sleeps — built by Gregg Cochran with the GitHub Copilot CLI",
};

const globalKeyframes = `
  @keyframes owlFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }
  @keyframes owlSpin {
    0% { transform: rotate(0deg) scale(1); }
    40% { transform: rotate(200deg) scale(1.25); }
    100% { transform: rotate(360deg) scale(1); }
  }
  @keyframes smoothPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.6); }
  }
  @keyframes pulseRing {
    0% { transform: scale(1); opacity: 0.5; }
    100% { transform: scale(2.8); opacity: 0; }
  }
  @keyframes gradientShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes confettiFall {
    0% { transform: translateY(0) rotate(0deg); opacity: 1; }
    80% { opacity: 1; }
    100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
  }
  @keyframes fadeInOut {
    0% { opacity: 0; }
    8% { opacity: 1; }
    85% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes tooltipPop {
    0% { opacity: 0; transform: translateX(-50%) translateY(4px) scale(0.8); }
    30% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.05); }
    50% { transform: translateX(-50%) translateY(0) scale(1); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.9); }
  }
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: globalKeyframes }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
