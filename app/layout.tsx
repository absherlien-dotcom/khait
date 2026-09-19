import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "خَيْط | محادثات الأعمال عبر البريد",
  description: "منصة تنظم رسائل البريد الإلكتروني في محادثات واضحة بين الشركات وعملائها.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
