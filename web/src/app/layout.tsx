import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "OpenJobSlots — Açık iş ilanlarını ara",
  description:
    "Açık iş ilanlarını tek yerden ara. 628 ATS platformu ve toplayıcı kaynak arasından güncel ilanlar.",
};

// Resolve the persisted theme before paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('ojs-theme')||'dark';var d=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.classList.toggle('theme-light',d==='light');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
