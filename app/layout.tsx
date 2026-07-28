import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dimcan Platform",
  description: "A project-first construction workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}