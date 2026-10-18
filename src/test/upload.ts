import { File as NodeFile } from "node:buffer";
import { vi } from "vitest";

/**
 * Stands in for `XMLHttpRequest`, which jsdom has but cannot send: the
 * upload of the panel goes through `fetch`, where the mock API answers,
 * with the progress events the panel listens to. `"fails"` answers as a
 * network that is down.
 */
export function installUpload(mode: "works" | "fails") {
  class FakeUpload {
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = {
      onprogress: null,
    };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = "";
    withCredentials = false;
    responseType = "";
    private method = "GET";
    private url = "";
    private headers: Record<string, string> = {};
    private response: Response | null = null;

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    getResponseHeader(name: string) {
      return this.response?.headers.get(name) ?? null;
    }
    abort() {
      this.onabort?.();
    }
    send(body: FormData) {
      void (async () => {
        if (mode === "fails") {
          this.onerror?.();
          return;
        }
        const boundary = "----panel-test-upload";
        const encoder = new TextEncoder();
        const parts: Uint8Array[] = [];
        for (const [name, value] of body.entries()) {
          if (typeof value === "string") continue;
          parts.push(
            encoder.encode(
              `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${value.type}\r\n\r\n`,
            ),
          );
          parts.push(new Uint8Array(await value.arrayBuffer()));
          parts.push(encoder.encode("\r\n"));
        }
        parts.push(encoder.encode(`--${boundary}--\r\n`));
        const bytes = new Uint8Array(
          parts.reduce((sum, part) => sum + part.length, 0),
        );
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        // Node's multipart parser makes its files with the page's `File`
        // (jsdom's here) and then does not recognise them: it gets Node's
        // own class while the mock reads the request.
        const pageFile = globalThis.File;
        globalThis.File = NodeFile as unknown as typeof File;
        let response: Response;
        try {
          response = await fetch(this.url, {
            method: this.method,
            headers: {
              ...this.headers,
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
            },
            body: bytes,
          });
        } finally {
          globalThis.File = pageFile;
        }
        this.response = response;
        this.status = response.status;
        this.responseText = await response.text();
        this.onload?.();
      })();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeUpload);
}
