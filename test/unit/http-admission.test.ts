import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/schema.js";
import { admitHttpRequest } from "../../src/transport/http-admission.js";
import { createBearerToken } from "../../src/transport/http-auth.js";

function httpConfig() {
  return parseEnv({
    COMFYMCP_TRANSPORT: "streamable_http",
    COMFYMCP_HTTP_BIND: "192.168.1.50",
    COMFYMCP_HTTP_ADVERTISED_URL: "https://comfy-gpu.lan:9100/mcp",
    COMFYMCP_HTTP_TLS_MODE: "native",
    COMFYMCP_HTTP_TLS_CERT: "/tmp/comfy-gpu.crt",
    COMFYMCP_HTTP_TLS_KEY: "/tmp/comfy-gpu.key",
    COMFYMCP_HTTP_ALLOWED_CLIENT_CIDRS: "192.168.1.0/24",
    COMFYMCP_HTTP_ALLOWED_HOSTS: "comfy-gpu.lan:9100",
    COMFYMCP_HTTP_ALLOWED_ORIGINS: "https://client.lan"
  });
}

describe("HTTP admission", () => {
  it("admits authenticated private-LAN requests", () => {
    const token = createBearerToken("client");
    const decision = admitHttpRequest(httpConfig(), {
      method: "POST",
      path: "/mcp",
      remoteAddress: "192.168.1.22",
      bodyBytes: 128,
      headers: {
        host: "comfy-gpu.lan:9100",
        authorization: `Bearer ${token.plaintext}`
      },
      records: [token.record]
    });

    expect(decision).toMatchObject({
      ok: true,
      actorId: token.record.actorId,
      tokenId: token.record.tokenId,
      isPreflight: false
    });
  });

  it("rejects hostile hosts, disallowed origins, missing auth, and oversized bodies before dispatch", () => {
    const token = createBearerToken("client");
    const config = httpConfig();

    expect(
      admitHttpRequest(config, {
        method: "POST",
        path: "/mcp",
        remoteAddress: "192.168.1.22",
        bodyBytes: 128,
        headers: {
          host: "evil.example",
          authorization: `Bearer ${token.plaintext}`
        },
        records: [token.record]
      })
    ).toMatchObject({ ok: false, status: 403 });

    expect(
      admitHttpRequest(config, {
        method: "POST",
        path: "/mcp",
        remoteAddress: "192.168.1.22",
        bodyBytes: 128,
        headers: {
          host: "comfy-gpu.lan:9100",
          origin: "null",
          authorization: `Bearer ${token.plaintext}`
        },
        records: [token.record]
      })
    ).toMatchObject({ ok: false, status: 403 });

    expect(
      admitHttpRequest(config, {
        method: "POST",
        path: "/mcp",
        remoteAddress: "192.168.1.22",
        bodyBytes: 128,
        headers: {
          host: "comfy-gpu.lan:9100"
        },
        records: [token.record]
      })
    ).toMatchObject({ ok: false, status: 401 });

    expect(
      admitHttpRequest(config, {
        method: "POST",
        path: "/mcp",
        remoteAddress: "192.168.1.22",
        bodyBytes: config.http.maxBodyBytes + 1,
        headers: {
          host: "comfy-gpu.lan:9100",
          authorization: `Bearer ${token.plaintext}`
        },
        records: [token.record]
      })
    ).toMatchObject({ ok: false, status: 413 });
  });
});
