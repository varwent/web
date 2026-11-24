"""
Sakura MiniMax-H3 (uncensored text encoder) on Modal, exposed as a remote MCP server.

Pieces:
  * download_models  - one-off CPU job that pulls the GGUF/VAE weights into a Modal Volume
  * VideoGen.generate - GPU job: runs stable-diffusion.cpp `sd-cli -M vid_gen`, converts to MP4
  * web              - FastAPI app with:
        /<MCP_TOKEN>/mcp                 -> MCP server (tools: generate_video, check_video)
        /<MCP_TOKEN>/videos/<name>.mp4   -> serves finished videos
  * main             - `modal run app.py --prompt "..."` to test from your terminal

Deploy:  modal deploy app.py
"""

import os
import subprocess
import uuid
from pathlib import Path

import modal

APP_NAME = "sakura-video"

# ---------------------------------------------------------------- model files
ENCODER_REPO = "webmp3/Sakura-MiniMax-H3-Uncensored-GGUF"
DENOISER_REPO = "webmp3/Sakura-MiniMax-H3-GGUF"

# Q4_K_M everywhere = smallest that the author tested; fits a 48 GB L40S.
ENCODER_FILE = "Sakura-MiniMax-H3-TextEncoder-Uncensored-Q4_K_M-14.05GiB.gguf"
DENOISER_FILE = "Sakura-MiniMax-H3-FL2VA-Pruned-Q4_K_M-11.71GiB.gguf"
VIDEO_VAE_FILE = "minimax_h3_video_vae_fp16.safetensors"
AUDIO_VAE_FILE = "minimax_h3_audio_vae_fp32.safetensors"

MODELS_DIR = Path("/models")
OUTPUTS_DIR = Path("/outputs")

models_vol = modal.Volume.from_name("sakura-models", create_if_missing=True)
outputs_vol = modal.Volume.from_name("sakura-outputs", create_if_missing=True)

GPU = os.environ.get("SAKURA_GPU", "L40S")  # or "A100-80GB" / "H100"

# ---------------------------------------------------------------- images
# Prebuilt stable-diffusion.cpp CUDA image published by the sd.cpp project (no compiling).
# It is rebuilt on every push to sd.cpp master, so it includes MiniMax-H3 support.
SD_CLI = "/sd.cpp/bin/sd-cli"
sd_image = (
    modal.Image.from_registry("ghcr.io/leejet/stable-diffusion.cpp:master-cuda", add_python="3.11")
    .entrypoint([])
    .apt_install("ffmpeg")
)

download_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "huggingface_hub[hf_xet]>=0.32"
)

web_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]>=0.115", "mcp==1.30.0"
)

app = modal.App(APP_NAME)


# ---------------------------------------------------------------- 1. download weights
@app.function(
    image=download_image,
    volumes={MODELS_DIR: models_vol},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=3 * 60 * 60,
)
def download_one(repo: str, name: str):
    from huggingface_hub import hf_hub_download

    if (MODELS_DIR / name).exists():
        print(f"already have {name}")
        return
    print(f"downloading {repo}/{name} ...")
    hf_hub_download(repo_id=repo, filename=name, local_dir=MODELS_DIR)
    models_vol.commit()
    print(f"done {name}")


@app.function(image=download_image, volumes={MODELS_DIR: models_vol}, timeout=3 * 60 * 60)
def download_models():
    """Downloads all 4 files at the same time (one container per file)."""
    wanted = [
        (ENCODER_REPO, ENCODER_FILE),
        (DENOISER_REPO, DENOISER_FILE),
        (DENOISER_REPO, VIDEO_VAE_FILE),
        (DENOISER_REPO, AUDIO_VAE_FILE),
    ]
    list(download_one.starmap(wanted))
    models_vol.reload()
    for p in sorted(MODELS_DIR.glob("*")):
        if p.is_file():
            print(f"{p.name:70s} {p.stat().st_size / 1e9:6.2f} GB")


# ---------------------------------------------------------------- 2. GPU generation
@app.cls(
    image=sd_image,
    gpu=GPU,
    memory=65536,
    volumes={MODELS_DIR: models_vol, OUTPUTS_DIR: outputs_vol},
    timeout=60 * 60,
    scaledown_window=300,  # stay warm 5 min after a job (you pay while warm)
)
class VideoGen:
    @modal.method()
    def generate(
        self,
        prompt: str,
        width: int = 864,
        height: int = 480,
        frames: int = 56,
        fps: int = 24,
        steps: int = 8,
        cfg_scale: float = 1.0,
        seed: int = -1,
        offload_to_cpu: bool = True,
    ) -> dict:
        job = uuid.uuid4().hex[:12]
        work = Path("/tmp") / job
        work.mkdir(parents=True, exist_ok=True)
        avi = work / "out.avi"

        cmd = [
            SD_CLI, "-M", "vid_gen",
            "--diffusion-model", str(MODELS_DIR / DENOISER_FILE),
            "--llm", str(MODELS_DIR / ENCODER_FILE),
            "--vae", str(MODELS_DIR / VIDEO_VAE_FILE),
            "--audio-vae", str(MODELS_DIR / AUDIO_VAE_FILE),
            "-p", prompt,
            "--cfg-scale", str(cfg_scale),
            "--steps", str(steps),
            "-W", str(width), "-H", str(height),
            "--video-frames", str(frames), "--fps", str(fps),
            "--diffusion-fa", "--rng", "cpu",
            "-s", str(seed),
            "-o", str(avi),
            "-v",
        ]
        if offload_to_cpu:
            cmd.append("--offload-to-cpu")

        print(" ".join(cmd[:3]), "...")
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0 or not avi.exists():
            tail = (proc.stdout + "\n" + proc.stderr)[-4000:]
            raise RuntimeError(f"sd-cli failed (code {proc.returncode}):\n{tail}")

        # AVI (MJPEG + PCM) -> browser/phone friendly MP4 (H.264 + AAC)
        name = f"{job}.mp4"
        mp4 = OUTPUTS_DIR / name
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(avi),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(mp4)],
            check=True,
        )
        outputs_vol.commit()
        return {"file": name, "size_mb": round(mp4.stat().st_size / 1e6, 2)}


# ---------------------------------------------------------------- 3. MCP server + video hosting
@app.function(
    image=web_image,
    volumes={OUTPUTS_DIR: outputs_vol},
    secrets=[modal.Secret.from_name("sakura-mcp")],  # holds MCP_TOKEN
    scaledown_window=600,
)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def web():
    from contextlib import asynccontextmanager

    from fastapi import FastAPI, HTTPException
    from fastapi.responses import FileResponse
    from mcp.server.fastmcp import FastMCP
    from mcp.server.transport_security import TransportSecuritySettings

    token = os.environ["MCP_TOKEN"]
    base_url = web.get_web_url().rstrip("/")

    mcp = FastMCP(
        "sakura-video",
        stateless_http=True,
        streamable_http_path="/mcp",
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    @mcp.tool()
    def generate_video(
        prompt: str,
        width: int = 864,
        height: int = 480,
        frames: int = 56,
        fps: int = 24,
        steps: int = 8,
        seed: int = -1,
    ) -> dict:
        """Start a MiniMax-H3 text-to-video (+audio) job on the GPU.
        Returns a job_id immediately; call check_video(job_id) every ~30-60 s.
        width/height should be multiples of 32. frames/fps = clip length in seconds
        (56 frames @ 24 fps ~ 2.3 s). First job after idle includes ~1-3 min cold start."""
        call = VideoGen().generate.spawn(
            prompt=prompt, width=width, height=height, frames=frames,
            fps=fps, steps=steps, seed=seed,
        )
        return {"job_id": call.object_id, "status": "queued"}

    @mcp.tool()
    def check_video(job_id: str) -> dict:
        """Check a job started by generate_video. When done, returns video_url (MP4)."""
        call = modal.FunctionCall.from_id(job_id)
        try:
            result = call.get(timeout=0)
        except modal.exception.FunctionTimeoutError as e:  # the GPU job itself timed out
            return {"job_id": job_id, "status": "failed", "error": str(e)}
        except (TimeoutError, modal.exception.TimeoutError):  # not finished yet
            return {"job_id": job_id, "status": "running"}
        except Exception as e:  # sd-cli error, OOM, etc.
            return {"job_id": job_id, "status": "failed", "error": str(e)[-2000:]}
        return {
            "job_id": job_id,
            "status": "done",
            "video_url": f"{base_url}/{token}/videos/{result['file']}",
            "size_mb": result["size_mb"],
        }

    @asynccontextmanager
    async def lifespan(_app):
        async with mcp.session_manager.run():
            yield

    api = FastAPI(lifespan=lifespan)

    @api.get("/")
    def health():
        return {"ok": True}

    @api.get(f"/{token}/videos/{{name}}")
    def video(name: str):
        if "/" in name or not name.endswith(".mp4"):
            raise HTTPException(404)
        outputs_vol.reload()
        path = OUTPUTS_DIR / name
        if not path.exists():
            raise HTTPException(404)
        return FileResponse(path, media_type="video/mp4")

    api.mount(f"/{token}", mcp.streamable_http_app())
    return api


# ---------------------------------------------------------------- 4. terminal test
@app.local_entrypoint()
def main(prompt: str = "A red fox runs through fresh snow at sunrise, cinematic tracking shot, soft wind sound",
         frames: int = 56, steps: int = 8, seed: int = 42):
    res = VideoGen().generate.remote(prompt=prompt, frames=frames, steps=steps, seed=seed)
    print("generated:", res)
    data = b"".join(outputs_vol.read_file(res["file"]))
    Path(res["file"]).write_bytes(data)
    print("saved locally:", res["file"])
