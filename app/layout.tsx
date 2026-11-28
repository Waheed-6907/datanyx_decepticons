import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CystoAI - Hydatid Cyst Decision Support",
  description: "AI-assisted Hydatid Cyst Stage Classification and Clinical Decision Support",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
