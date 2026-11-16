// A production AI importer needs a public HTTPS API origin. The key stays there.
if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_API_URL) {
  const url = new URL(process.env.NEXT_PUBLIC_API_URL);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_API_URL must be an HTTPS origin without credentials or a path.");
  }
}
export default { output: "export", images: { unoptimized: true }, poweredByHeader: false };
