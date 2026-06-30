# Upstream Reference

ComfyMCP Local is planned as a curated local-focused fork of Artokun's
MIT-licensed `comfyui-mcp`.

- Repository: `https://github.com/artokun/comfyui-mcp`
- Audited baseline commit: `dc21cc953ea605e98a2ce25d47ef797773784d8c`
- Baseline role: implementation reference for ComfyUI client behavior, workflow
  handling, validation, downloads, and security patterns.

The version 1 product boundary removes cloud inference, public tunnels, external
storage publishing, panel orchestration, remote-ComfyUI targeting, and embedded
agent features from the product build. Upstream changes should be imported
selectively and must pass local-inference policy tests.
