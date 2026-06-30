# Security Policy

ComfyMCP Local is designed for a single-operator local or private-LAN trust
domain. The default transport is MCP over stdio and opens no listener.

Key version 1 security boundaries:

- ComfyUI must be configured as an exact loopback origin.
- Streamable HTTP is opt-in and must use TLS, bearer authentication, exact
  allowed hosts, and configured private-LAN client CIDRs.
- Ordinary workflow execution is local-only; API-backed, cloud, mixed, and
  unknown workflows are rejected by default.
- Administrative mutations are disabled by default and require immutable plans
  plus local approval unless a narrow unattended policy is configured.
- Secrets, bearer tokens, approval tokens, session IDs, prompts, and media
  bodies must not be logged, persisted in plaintext, or returned in tool output.

This initial scaffold implements the policy/configuration shell and contract
inventory needed for Milestone 0. Release builds still require the full security
test matrix from `PROJECT_BRIEF.md`.
