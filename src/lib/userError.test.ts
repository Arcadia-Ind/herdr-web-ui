import { afterEach, describe, expect, it } from "bun:test";
import { ApiError } from "./api.ts";
import { withChatReadDeadline } from "./chatReadDeadline.ts";
import { setCurrentLanguage, translate } from "./i18n.ts";
import { userErrorMessage } from "./userError.ts";

const api = (status: number, detail = "herdr said no") => new ApiError("/api/x", status, detail, null);

describe("userErrorMessage", () => {
  afterEach(() => setCurrentLanguage("en"));

  it("tells a signed-out browser to pair again", () => {
    for (const status of [401, 403]) expect(userErrorMessage(api(status))).toEqual({ message: "This browser is not signed in to this PC any more. Pair it again in Settings → Phone & devices.", detail: "herdr said no" });
  });

  it("says a missing item is gone", () => {
    expect(userErrorMessage(api(404)).message).toBe("That item no longer exists on the PC. Refresh and try again.");
  });

  it("says a conflicting change happened on the PC", () => {
    expect(userErrorMessage(api(409)).message).toBe("It changed on the PC while you were acting. Check it and try again.");
  });

  it("says the PC was too slow, for 408, 504 and an aborted or timed-out request", () => {
    const slow = "The PC took too long to answer. Try again.";
    expect(userErrorMessage(api(408)).message).toBe(slow);
    expect(userErrorMessage(api(504)).message).toBe(slow);
    expect(userErrorMessage(new DOMException("The operation was aborted.", "AbortError")).message).toBe(slow);
    expect(userErrorMessage(new DOMException("signal timed out", "TimeoutError")).message).toBe(slow);
  });

  it("says the PC was too slow when the chat read misses its own deadline", async () => {
    const missed = await withChatReadDeadline(() => new Promise<never>(() => {}), 0).then(() => null, (cause: unknown) => cause);
    expect(userErrorMessage(missed)).toEqual({ message: "The PC took too long to answer. Try again.", detail: "Chat read timed out." });
  });

  it("says the PC could not do it for any other 5xx", () => {
    expect(userErrorMessage(api(500))).toEqual({ message: "The PC could not do that. Try again; if it keeps failing, restart herdr web ui on the PC.", detail: "herdr said no" });
    expect(userErrorMessage(api(502)).message).toBe("The PC could not do that. Try again; if it keeps failing, restart herdr web ui on the PC.");
  });

  it("says the PC cannot be reached when fetch never got an answer", () => {
    for (const words of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      expect(userErrorMessage(new TypeError(words))).toEqual({ message: "Can't reach the PC. Check your connection, then try again.", detail: words });
    }
  });

  it("falls back to a generic sentence for anything else, keeping its words", () => {
    const generic = "Something went wrong. Try again.";
    expect(userErrorMessage(new TypeError("x is not a function"))).toEqual({ message: generic, detail: "x is not a function" });
    expect(userErrorMessage(api(400, "label too long"))).toEqual({ message: generic, detail: "label too long" });
    expect(userErrorMessage("plain string")).toEqual({ message: generic, detail: "plain string" });
  });

  it("leaves out a detail that is empty or the sentence itself", () => {
    expect(userErrorMessage(new Error("")).detail).toBeNull();
    expect(userErrorMessage(new Error("Something went wrong. Try again.")).detail).toBeNull();
  });

  it("answers in the UI language", () => {
    setCurrentLanguage("ko");
    expect(userErrorMessage(new TypeError("Failed to fetch")).message).toBe(translate("ko", "Can't reach the PC. Check your connection, then try again."));
    expect(userErrorMessage(new TypeError("Failed to fetch")).message).not.toBe("Can't reach the PC. Check your connection, then try again.");
  });
});
