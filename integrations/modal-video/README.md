# Sakura MiniMax-H3 video on Modal (MCP, no UI)

You type a prompt in Claude, Claude calls the `generate_video` tool, a Modal GPU makes the clip, and you get an MP4 link back in chat.

```
Claude chat ──MCP──> Modal web endpoint ──spawn──> L40S GPU (stable-diffusion.cpp sd-cli)
                         ▲                                │
                         └──── check_video → MP4 URL ◄────┘  (saved in Modal Volume)
```

**Important:** the HF link you shared contains only the *text encoder*. A full MiniMax-H3 run also needs the denoiser and the two VAEs from `webmp3/Sakura-MiniMax-H3-GGUF`. `app.py` downloads all four files (~34 GB, Q4_K_M):

| Role | Repo | File |
|---|---|---|
| `--llm` (uncensored encoder) | webmp3/Sakura-MiniMax-H3-Uncensored-GGUF | Sakura-MiniMax-H3-TextEncoder-Uncensored-Q4_K_M-14.05GiB.gguf |
| `--diffusion-model` | webmp3/Sakura-MiniMax-H3-GGUF | Sakura-MiniMax-H3-FL2VA-Pruned-Q4_K_M-11.71GiB.gguf |
| `--vae` | webmp3/Sakura-MiniMax-H3-GGUF | minimax_h3_video_vae_fp16.safetensors |
| `--audio-vae` | webmp3/Sakura-MiniMax-H3-GGUF | minimax_h3_audio_vae_fp32.safetensors |

ComfyUI is not used. The model runs with `sd-cli` from stable-diffusion.cpp, the only runtime the model card supports. The app uses the project's prebuilt CUDA image (`ghcr.io/leejet/stable-diffusion.cpp:master-cuda`), so nothing gets compiled.

---

## Steps

### 1. Install the Modal CLI and log in (on your PC)
```bash
pip install -U modal
```
```bash
modal setup
```

### 2. Get the code
```bash
git clone -b claude/inspiring-bell-aoaoao https://github.com/varwent/web.git
```
```bash
cd web/integrations/modal-video
```

### 3. Create the two secrets
Make a Hugging Face token (read access) at huggingface.co/settings/tokens. Open both model pages once while logged in and accept any adult/licence prompt.
```bash
modal secret create huggingface HF_TOKEN=hf_xxxxxxxxxxxxxxxx
```
Pick a long random string. It acts as the password for your MCP URL:
```bash
modal secret create sakura-mcp MCP_TOKEN=$(python -c "import secrets;print(secrets.token_urlsafe(24))")
```
To see the token later, open the Modal dashboard: Secrets → sakura-mcp.

### 4. Download the weights into a Modal Volume (one time, all 4 files in parallel, ~5–20 min)
```bash
modal run app.py::download_models
```

### 5. Test from the terminal (first run pulls the prebuilt sd.cpp CUDA image, ~2–4 min)
```bash
modal run app.py --prompt "A red fox runs through fresh snow at sunrise, cinematic tracking shot, wind sound"
```
The MP4 gets saved in your current folder.

### 6. Deploy the MCP server
```bash
modal deploy app.py
```
Modal prints a URL like `https://<you>--sakura-video-web.modal.run`. Your MCP URL is:
```
https://<you>--sakura-video-web.modal.run/<MCP_TOKEN>/mcp
```

### 7. Add it to Claude
claude.ai → Settings → Connectors → **Add custom connector** → paste the MCP URL above → name it `Sakura Video`. Turn it on in the chat's tools menu.

Claude Code CLI instead:
```bash
claude mcp add --transport http sakura-video "https://<you>--sakura-video-web.modal.run/<MCP_TOKEN>/mcp"
```

### 8. Use it
In chat: *"Use Sakura Video: a samurai walking through neon rain at night, slow dolly-in, thunder and rain sounds, 864x480, 56 frames."*
Claude calls `generate_video`, then `check_video` until it gets the `video_url` (MP4 with audio).

---

## Tools
- `generate_video(prompt, width=864, height=480, frames=56, fps=24, steps=8, seed=-1)` → `job_id`
- `check_video(job_id)` → `running` / `failed` + error / `done` + `video_url`

Clip length is `frames / fps` (56 / 24 ≈ 2.3 s). Use multiples of 32 for width and height. Settings follow the model card (cfg 1.0, 8 steps). Raise `steps` to 20 for better quality at about 2.5× the time.

## Settings to change in app.py
- **GPU:** `SAKURA_GPU=A100-80GB modal deploy app.py` if you hit out-of-memory or want bigger or longer clips.
- **Quality:** swap the `Q4_K_M` filenames for Q5/Q6/Q8 (bigger files that need more VRAM), then re-run step 4.
- **Cost:** you pay only while a GPU container runs. `scaledown_window=300` keeps it warm 5 min after a job; lower it to save money.

## Useful commands
```bash
modal app logs sakura-video
```
```bash
modal volume ls sakura-outputs
```
```bash
modal volume get sakura-outputs <file>.mp4 .
```
```bash
modal app stop sakura-video
```

## Rules
Adults-only model under the MiniMax H3 Community License. It forbids content involving minors and using the outputs to train other models, and commercial products must show "MiniMax H3". Don't generate real, identifiable people. Check that Modal's acceptable-use policy allows your content.
