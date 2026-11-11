import { describe, expect, it } from "vitest";
import { mailtoHref, telHref } from "./links";

describe("links made from what somebody outside typed", () => {
  it("writes to one address and nothing more", () => {
    expect(mailtoHref("priya@example.com")).toBe("mailto:priya@example.com");
    expect(mailtoHref("  einkauf+rf@firma.de ")).toBe(
      "mailto:einkauf+rf@firma.de",
    );
    // Extra recipients, a subject or a body would ride on the link.
    expect(mailtoHref("a@b.de?bcc=x@evil.example")).toBeUndefined();
    expect(mailtoHref("a@b.de&body=hello")).toBeUndefined();
    expect(mailtoHref("a@b.de,c@d.de")).toBeUndefined();
    expect(mailtoHref("a@b.de%0Abcc:x@evil.example")).toBeUndefined();
    expect(mailtoHref("not an address")).toBeUndefined();
    expect(mailtoHref("")).toBeUndefined();
    expect(mailtoHref(null)).toBeUndefined();
  });

  it("dials the digits of a number, with its plus", () => {
    expect(telHref("+49 170 1234567")).toBe("tel:+491701234567");
    expect(telHref("(069) 12 34-56")).toBe("tel:069123456");
    expect(telHref("0170/1234567;ext=1?x")).toBe("tel:017012345671");
    expect(telHref("call me")).toBeUndefined();
    expect(telHref(undefined)).toBeUndefined();
  });
});
