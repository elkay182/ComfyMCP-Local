# Deployment Runbook

This runbook uses placeholder hostnames only. Keep real LAN hostnames, bearer
tokens, workflow JSON, and TLS paths in local environment files or secret stores.

## Build

```sh
npm ci
npm run check
npm run build
```

## Upstream ComfyUI

Loopback ComfyUI is allowed by default:

```sh
COMFYMCP_COMFYUI_URL=http://127.0.0.1:8188
```

HTTPS LAN ComfyUI requires explicit opt-in:

```sh
COMFYMCP_COMFYUI_URL=https://comfy-gpu.lan.example
COMFYMCP_ALLOW_LAN_COMFYUI=true
COMFYMCP_COMFYUI_ALLOWED_HOSTS=comfy-gpu.lan.example
```

LAN upstream DNS answers are checked before outbound REST and WebSocket
requests and must remain in private LAN ranges.

## Streamable HTTP

Create a bearer token before first HTTP startup:

```sh
COMFYMCP_STATE_DIR=/var/lib/comfymcp node dist/index.js auth create --label lan-client
```

Trusted proxy mode keeps the MCP listener on loopback and delegates public TLS
to a reverse proxy:

```sh
COMFYMCP_TRANSPORT=streamable_http
COMFYMCP_HTTP_BIND=127.0.0.1
COMFYMCP_HTTP_PORT=9100
COMFYMCP_HTTP_TLS_MODE=trusted_proxy
COMFYMCP_HTTP_ADVERTISED_URL=https://mcp.lan.example/mcp
COMFYMCP_HTTP_ALLOWED_HOSTS=mcp.lan.example
COMFYMCP_HTTP_ALLOWED_CLIENT_CIDRS=192.168.1.0/24
COMFYMCP_HTTP_TRUSTED_PROXY_CIDRS=127.0.0.1/32
```

The proxy must preserve `Host`, pass `Authorization`, and restrict access to
the configured client CIDRs. Native TLS mode is also supported when binding to a
specific private LAN address and providing certificate/key paths.

## launchd

Create a plist that runs:

```sh
/usr/local/bin/node /opt/comfymcp/dist/index.js
```

Set environment variables in the plist or source them from a local wrapper
script outside the repository. Use `KeepAlive` and send logs to files owned by
the service user.

## systemd

Example service shape:

```ini
[Service]
WorkingDirectory=/opt/comfymcp
EnvironmentFile=/etc/comfymcp/comfymcp.env
ExecStart=/usr/bin/node /opt/comfymcp/dist/index.js
Restart=on-failure
User=comfymcp
Group=comfymcp
NoNewPrivileges=true
PrivateTmp=true
```

Keep `/etc/comfymcp/comfymcp.env` mode `0600`.

## Docker

Run the built package with a read-write state volume and environment provided by
your orchestrator:

```sh
docker run --rm \
  --env-file /secure/comfymcp.env \
  --volume comfymcp-state:/var/lib/comfymcp \
  --publish 127.0.0.1:9100:9100 \
  comfymcp-local:latest
```

Do not bake real hostnames or bearer tokens into the image.

## Smoke Test

After `npm run build`, provide a tiny API workflow through environment and run:

```sh
COMFYMCP_SMOKE_API_GRAPH_JSON='{"1":{"class_type":"SaveImage","inputs":{}}}' npm run smoke:real
```

Use a real minimal workflow that is valid for your ComfyUI node graph. The smoke
script verifies `system_status`, `workflows_validate`, `workflows_run`,
`jobs_get`, `jobs_list`, `jobs_cancel`, terminal success, and asset
registration.

## SQLite Backup

Stop the service or use SQLite online backup tooling, then copy:

```sh
/var/lib/comfymcp/state.sqlite
```

Restore by stopping the service, replacing the database file, setting ownership
back to the service user, and starting the service. Keep backups encrypted if
they contain audit records or asset metadata.

## Token Rotation

```sh
node dist/index.js auth list
node dist/index.js auth rotate <token_id>
node dist/index.js auth revoke <old_token_id>
```

Rotation revokes the previous token after creating the replacement. Revoked
tokens are rejected during HTTP admission.
