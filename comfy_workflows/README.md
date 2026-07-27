# ComfyUI workflows

The Mission Control GEN panel is manifest-driven. To add a workflow:

1. Export your workflow from ComfyUI as **API format** (Workflow -> Export (API)).
2. Save it here as `<id>.json` (e.g. `sd15_txt2img.json`).
3. Add an entry to `manifest.json`'s `workflows` list:

```json
{
  "id": "sd15_txt2img",
  "label": "SDXL · Text to Image",
  "type": "image",
  "file": "sd15_txt2img.json",
  "params": [
    {"key": "prompt", "node": "2", "input": "text", "kind": "textarea", "label": "Prompt"},
    {"key": "negative_prompt", "node": "3", "input": "text", "kind": "textarea", "label": "Negative"},
    {"key": "steps", "node": "5", "input": "steps", "kind": "number", "label": "Steps", "default": 20}
  ]
}
```

- `params[].node` + `params[].input` pin where each arg lands in the workflow graph.
- `type` is `image` or `video` (controls the gallery renderer).
- **No workflows ship with MC** — yours won't match ours, so bring your own.
