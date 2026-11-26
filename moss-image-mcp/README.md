# VARWENT MOSS Image: MOSS-Image on Modal + MCP

Hosts [MOSS-Image](https://github.com/OpenMOSS/MOSS-Image) (5B text-to-image model: strong text
rendering, layouts, photoreal and anime) on a Modal H100. The same Modal app runs a remote MCP
server, so Claude can generate images the way it uses the VARWENT LTX server.

```
Claude ──MCP──> web (CPU, Modal) ──spawn──> MossImage (H100, loads MOSS-Image-SFT)
                     │                               │
                     └──── /files links <── volume "varwent-moss-image" (weights + PNGs)
```

| MCP tool | What it does |
| --- | --- |
| `warmup_gpu(model)` | Starts the H100 and loads the model (cold start ~1–3 min) |
| `generate_image(prompt, aspect, ...)` | Queues a render and returns a `job_id` |
| `check_job(job_id)` | `running`, or `done` with download links and a preview |
| `list_images(limit)` | The newest images, with links |

The GPU shuts down after 2 minutes idle, so you only pay while it renders.

## Deploy from Windows cmd

Run these in a `cmd` window inside this `moss-image-mcp` folder.

**1. Install Modal and log in** (skip if `modal` already works from your LTX setup):

```bash
pip install -U modal
```

```bash
modal setup
```

**2. Create a secret token.** It goes into the MCP URL and signs the download links. Make a random one:

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

Copy the output and use it in place of `PASTE_TOKEN_HERE`:

```bash
modal secret create moss-image-auth MCP_TOKEN=PASTE_TOKEN_HERE
```

**3. Download the weights into the Modal volume, one time** (~27 GB, about 5–15 min, CPU only):

```bash
modal run moss_image_modal.py::download
```

To also get the Base model: `modal run moss_image_modal.py::download --which all`

**4. Deploy:**

```bash
modal deploy moss_image_modal.py
```

The output prints the web URL, for example `https://varwent--varwent-moss-image-web.modal.run`.

**5. Check it is live** (open in a browser): `https://<your-url>/health` should show `{"ok":true,...}`.

## Add it to Claude

claude.ai → **Settings → Connectors → Add custom connector**

- Name: `VARWENT MOSS Image`
- URL: `https://<your-url>/<MCP_TOKEN>/mcp`

Example: `https://varwent--varwent-moss-image-web.modal.run/AbC123.../mcp`

Keep this URL private. Anyone who has it can generate images on your GPU.

Then ask Claude, for example: *"Using MOSS Image, make a 9:16 poster of a red sneaker on a
yellow background with the title "STEP UP" at the top."*

## Settings that matter

- **Prompts:** detailed English works best (up to ~4K tokens). Put text you want rendered in quotes,
  with line breaks where you want them. Layout JSON prompts also work (see the upstream USERGUIDE).
- **aspect:** `1:1, 9:16, 16:9, 4:5, 5:4, 3:4, 4:3, 2:3, 3:2` (~1.5 MP each). Or pass `width`/`height`
  (multiples of 16, 512–2048).
- **steps** 50 (30 for drafts) · **cfg** 3 for long prompts, 4–6 for short ones · **skip_layer** 22
  (-1 turns it off: more realistic, less detail).
- **model:** `sft` (default, cleaner) or `base`.
- **Default negative prompt:** `nsfw, worst quality, bad anatomy, watermark, jpeg artifact`

## Cost and speed (estimates, not measured)

H100 on Modal costs about $4/hour while running. With the GPU warm, a 1.5 MP image at 50 steps should
take roughly 20–40 s. A cold start adds about 1–3 min to load ~27 GB from the volume.

## Useful commands

```bash
modal app logs varwent-moss-image
```

```bash
modal app stop varwent-moss-image
```

To change the token: `modal secret create moss-image-auth MCP_TOKEN=NEW --force`, then
`modal deploy moss_image_modal.py` again and update the connector URL.
