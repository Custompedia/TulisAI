import { describe, expect, it } from "vitest";
import {
  authErrorFromResponse,
  normalizeIdentifier,
  normalizeName,
  normalizeUsername,
  validateLogin,
  validateRegistration,
} from "@/lib/auth/form";

describe("auth form helpers", () => {
  it("normalizes credential payload values before submission", () => {
    expect(normalizeName(" Ada Lovelace ")).toBe("Ada Lovelace");
    expect(normalizeUsername(" Ada.Lovelace ")).toBe("ada.lovelace");
    expect(normalizeIdentifier(" ADA@EXAMPLE.TEST ")).toBe("ada@example.test");
  });

  it("reports every invalid registration field", () => {
    const errors = validateRegistration({ name: "", username: "a!", email: "invalid", password: "short", confirm: "" }, false);
    expect(errors).toMatchObject({ name: expect.any(String), username: expect.any(String), email: expect.any(String), password: expect.any(String), confirm: expect.any(String) });
  });

  it("allows a nonempty login password without applying the registration minimum", () => {
    expect(validateLogin({ identifier: "ada", password: "x" }, true)).toEqual({});
    expect(validateLogin({ identifier: "ada", password: "" }, true)).toMatchObject({ password: expect.any(String) });
  });

  it("maps Better Auth status and nested error codes without exposing raw messages", () => {
    expect(authErrorFromResponse({ error: { code: "USERNAME_IS_ALREADY_TAKEN", message: "raw database text" } }, 400, true)).toMatchObject({ fields: { username: "This username is already in use." } });
    expect(authErrorFromResponse({ code: "INVALID_EMAIL_OR_PASSWORD" }, 401, true)).toEqual({ message: "Username/email or password is incorrect.", fields: {} });
    expect(authErrorFromResponse({ error: { code: "SERVICE_UNAVAILABLE" } }, 503, false).message).toBe("Autentikasi sedang tidak tersedia.");
    expect(authErrorFromResponse(null, 429, true).message).toBe("Too many attempts. Please wait a minute and try again.");
  });
});
