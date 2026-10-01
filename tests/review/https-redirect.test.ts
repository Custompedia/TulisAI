import { describe, expect, it } from "vitest";
import { httpsRedirect } from "../../worker/https";

describe("httpsRedirect", () => {
  it("sends http requests on the public domain to https with the same path and query", () => {
    const response = httpsRedirect(new Request("http://tulis.marikitalembur.com/login?next=%2Fapp"));
    expect(response?.status).toBe(308);
    expect(response?.headers.get("location")).toBe("https://tulis.marikitalembur.com/login?next=%2Fapp");
  });

  it("keeps POSTs as 308 so the method survives", () => {
    const response = httpsRedirect(new Request("http://tulis.marikitalembur.com/api/auth/sign-in/social", { method: "POST", body: "{}" }));
    expect(response?.status).toBe(308);
  });

  it("leaves https and local development alone", () => {
    expect(httpsRedirect(new Request("https://tulis.marikitalembur.com/"))).toBeNull();
    expect(httpsRedirect(new Request("http://localhost:5173/login"))).toBeNull();
    expect(httpsRedirect(new Request("http://127.0.0.1:8787/"))).toBeNull();
    expect(httpsRedirect(new Request("http://app.localhost:5173/"))).toBeNull();
  });
});
