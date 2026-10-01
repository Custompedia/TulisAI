// The custom domain also answers plain http, but Better Auth only trusts the
// https origin, so sign-in from an http page fails with "Invalid origin".
// Send every http request to the same URL on https before the app sees it.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function httpsRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:") return null;
  if (LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost")) return null;
  url.protocol = "https:";
  // 308 keeps the method and body, so a POST is retried as a POST.
  return new Response(null, { status: 308, headers: { location: url.toString() } });
}
