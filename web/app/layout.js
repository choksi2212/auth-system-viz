import "./globals.css";
export const metadata = {
  title: "Vellum — Private by design",
  description: "An encrypted workspace for documents that matter.",
};
export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
