# ComfyMCP Local

ComfyMCP Local is a local-first MCP server for controlling a loopback-only
ComfyUI instance from a same-machine client or an authenticated private-LAN MCP
client.

The project starts in disconnected/read-only `local_stdio` mode with no required
environment variables. HTTP/LAN mode is intentionally fail-closed until TLS,
bearer auth, exact Host admission, and client CIDRs are configured.

By default the ComfyUI upstream must be loopback. To target an HTTPS ComfyUI
server on your LAN, opt in explicitly and allowlist the exact upstream host:

```sh
COMFYMCP_COMFYUI_URL=https://comfy-gpu.lan.example
COMFYMCP_ALLOW_LAN_COMFYUI=true
COMFYMCP_COMFYUI_ALLOWED_HOSTS=comfy-gpu.lan.example
```

LAN upstreams require HTTPS, an origin-only URL, no embedded credentials, and
DNS answers that stay inside private LAN address ranges.

```sh
npm install
npm run check
```

Useful development commands:

```sh
npm run build
npm test
npm run typecheck
node dist/index.js tools:list
```

The implementation follows `PROJECT_BRIEF.md`. Milestone 0 focuses on package
shape, configuration, transport admission policy, authentication primitives,
tool inventory, and fake-ComfyUI test support before porting the full action
services.
