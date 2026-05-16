import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PostHogInit } from "./posthog-init";

export const metadata: Metadata = {
  title: "Relaunch — Your next chapter, found daily",
  description:
    "A daily job-finding companion for tech folks affected by layoffs.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PostHogInit />
        {children}
      </body>
    </html>
  );
}
