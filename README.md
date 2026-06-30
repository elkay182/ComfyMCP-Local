# ComfyMCP Local

ComfyMCP Local is a local-first MCP server for controlling a loopback-only
ComfyUI instance from a same-machine client or an authenticated private-LAN MCP
client.

The project starts in disconnected/read-only `local_stdio` mode with no required
environment variables. HTTP/LAN mode is intentionally fail-closed until TLS,
bearer auth, exact Host admission, and client CIDRs are configured.

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
