import type { Metadata } from "next";
import "./globals.css";
import "./allocation.css";
export const metadata: Metadata = {
  title: "OptiFlow MVP Beta — Smarter Decisions. Better Operations.",
  description:
    "Turn operational complexity into a clear, mathematically optimized plan.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body><aside className="beta-notice" aria-label="MVP beta limitations">OptiFlow · MVP Beta — Review verified recommendations before acting. Data is stored in this browser; export backups. Not a labor-law compliance tool.</aside>{children}</body>
    </html>
  );
}
