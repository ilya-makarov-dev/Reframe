# Brand palette mounts + live token edit

Opens the editor, mounts brand-palette into the right-panel slot, then
fires a brand.setToken gesture and verifies the SSE fan-out handles
the update through the MCP bridge.

- navigate /platform/project/editorial
- assert-role editor-shell/root
- assert-role editor-shell/right-panel
- mount brand-palette brandSlug=ferrari
- mounted brand-palette
- gesture brand.setToken {"brand":"ferrari","name":"color.primary","value":"#00FF88"}
