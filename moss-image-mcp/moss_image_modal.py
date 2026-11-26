"""VARWENT MOSS Image: MOSS-Image (OpenMOSS) on Modal, with a remote MCP server.

One Modal app holds:
  * MossImage  - GPU worker (H100) that loads MOSS-Image-SFT or -Base and renders PNGs
  * web        - small CPU web endpoint serving
                   /<MCP_TOKEN>/mcp        the MCP server (add it in claude.ai as a custom connector)
                   /files/<path>?t=<sig>   signed download links for rendered images
                   /health                 liveness check

Deploy from Windows cmd (see README.md in this folder):
    modal secret create moss-image-auth MCP_TOKEN=<long-random-string>
    modal run moss_image_modal.py::download      (one time: pulls ~30 GB of weights into the volume)
    modal deploy moss_image_modal.py
"""

import hashlib
import hmac
import io
import os
import re
import time
from datetime import datetime, timezone

import modal

APP_NAME = "varwent-moss-image"
MODELS = {
    "sft": "OpenMOSS-Team/MOSS-Image-SFT",
    "base": "OpenMOSS-Team/MOSS-Image-Base",
}
DATA = "/data"
IMAGES_DIR = f"{DATA}/images"
DEFAULT_NEGATIVE = "nsfw, worst quality, bad anatomy, watermark, jpeg artifact"

# ~1.5 MP presets (MOSS-Image works best at 1-2 MP), every side a multiple of 16.
ASPECTS = {
    "1:1": (1248, 1248),
    "9:16": (928, 1648),
    "16:9": (1648, 928),
    "4:5": (1104, 1376),
    "5:4": (1376, 1104),
    "3:4": (1072, 1424),
    "4:3": (1424, 1072),
    "2:3": (1024, 1536),
    "3:2": (1536, 1024),
}

app = modal.App(APP_NAME)
volume = modal.Volume.from_name("varwent-moss-image", create_if_missing=True)
auth_secret = modal.Secret.from_name("moss-image-auth")

gpu_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install(
        "torch>=2.9",
        "diffusers>=0.38",
        "transformers>=5.3",
        "accelerate>=1.10",
        "safetensors>=0.6",
        "Pillow>=10",
        "huggingface_hub[hf_transfer]",
        "sentencepiece",
    )
    .env({"HF_HOME": f"{DATA}/hf", "HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

web_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]", "mcp==2.3.0", "Pillow>=10"
)


# ----------------------------------------------------------------------------- helpers


def _slug(text: str, limit: int = 40) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return (s[:limit] or "image").strip("_")


def _sign(path: str) -> str:
    key = os.environ["MCP_TOKEN"].encode()
    return hmac.new(key, path.encode(), hashlib.sha256).hexdigest()[:32]


def _snap16(v: int) -> int:
    return max(512, min(2048, int(round(v / 16)) * 16))


# ----------------------------------------------------------------------------- GPU worker


@app.cls(
    image=gpu_image,
    gpu="H100",
    volumes={DATA: volume},
    secrets=[auth_secret],
    timeout=900,
    scaledown_window=120,  # same idea as the LTX server: GPU stops after 2 min idle
    max_containers=1,
)
class MossImage:
    model: str = modal.parameter(default="sft")

    @modal.enter()
    def load(self):
        import diffusers
        import torch

        repo = MODELS[self.model]
        t0 = time.time()
        self.pipe = diffusers.DiffusionPipeline.from_pretrained(
            repo,
            custom_pipeline="pipeline_moss_image",
            trust_remote_code=True,
            torch_dtype={"default": torch.bfloat16, "vae": torch.float32},
        )
        self.base_scheduler_config = dict(self.pipe.scheduler.config)
        self.pipe.to("cuda")
        self.load_seconds = round(time.time() - t0, 1)
        print(f"loaded {repo} in {self.load_seconds}s")

    @modal.method()
    def ping(self) -> dict:
        return {"model": self.model, "ready": True, "load_seconds": self.load_seconds}

    @modal.method()
    def generate(
        self,
        prompt: str,
        negative: str = DEFAULT_NEGATIVE,
        width: int = 1248,
        height: int = 1248,
        steps: int = 50,
        cfg: float = 3.0,
        shift: float = 5.0,
        seed: int | None = None,
        num_images: int = 1,
        name: str | None = None,
        skip_layer: int | None = 22,
    ) -> dict:
        import random

        import torch

        width, height = _snap16(width), _snap16(height)
        num_images = max(1, min(4, int(num_images)))
        if seed is None:
            seed = random.randint(0, 2**31 - 1)

        sched_cls = type(self.pipe.scheduler)
        self.pipe.scheduler = sched_cls.from_config(self.base_scheduler_config, shift=shift)

        day = datetime.now(timezone.utc).strftime("%Y%m%d")
        out_dir = f"{IMAGES_DIR}/{day}"
        os.makedirs(out_dir, exist_ok=True)
        stem = _slug(name or prompt)

        files, t0 = [], time.time()
        for i in range(num_images):
            s = seed + i
            kwargs = dict(
                prompt=prompt,
                negative_prompt=negative or "",
                height=height,
                width=width,
                num_inference_steps=int(steps),
                guidance_scale=float(cfg),
                generator=torch.Generator("cpu").manual_seed(s),
                # pipeline default is (22,); None turns layer skipping off
                uncond_skip_layers=[int(skip_layer)] if skip_layer is not None and skip_layer >= 0 else None,
            )
            img = self.pipe(**kwargs).images[0]
            rel = f"images/{day}/{stem}_{int(time.time())}_{s}.png"
            img.save(f"{DATA}/{rel}")
            files.append({"path": rel, "seed": s})
        volume.commit()
        return {
            "files": files,
            "width": width,
            "height": height,
            "model": self.model,
            "steps": steps,
            "cfg": cfg,
            "seconds": round(time.time() - t0, 1),
        }


# ----------------------------------------------------------------------------- one-time weight download


@app.function(image=gpu_image, volumes={DATA: volume}, timeout=3600, cpu=4, memory=16384)
def download(which: str = "sft"):
    """Pre-download weights into the volume so the first render does not wait. which = sft | base | all"""
    from huggingface_hub import snapshot_download

    names = list(MODELS) if which == "all" else [which]
    for n in names:
        print("downloading", MODELS[n])
        snapshot_download(MODELS[n])
    volume.commit()
    print("done")


# ----------------------------------------------------------------------------- web + MCP


def build_web_app():
    import asyncio
    import contextlib

    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import FileResponse
    from mcp.server.mcpserver import Image, MCPServer
    from mcp.server.transport_security import TransportSecuritySettings
    from PIL import Image as PILImage

    token = os.environ["MCP_TOKEN"]
    base_url_holder: dict[str, str] = {}

    def link(rel: str) -> str:
        base = base_url_holder.get("url", "")
        return f"{base}/files/{rel}?t={_sign(rel)}"

    def thumb(rel: str) -> Image:
        with PILImage.open(f"{DATA}/{rel}") as im:
            im = im.convert("RGB")
            im.thumbnail((640, 640))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=82)
        return Image(data=buf.getvalue(), format="jpeg")

    mcp = MCPServer(
        name="VARWENT MOSS Image",
        instructions=(
            "Text-to-image with MOSS-Image (5B DiT, strong text rendering, layouts, photoreal and anime). "
            "Flow: optionally warmup_gpu, then generate_image -> poll check_job until done. "
            "One job at a time. Write detailed English prompts (up to ~4K tokens); put exact text to render "
            "in quotes, with line breaks where you want them."
        ),
    )

    @mcp.tool()
    async def warmup_gpu(model: str = "sft") -> dict:
        """Start the H100 and load MOSS-Image (cold start ~1-3 min). Call right before rendering.
        model: "sft" (default, cleaner, better text layout) or "base" (raw, best for LoRA-style looks).
        The GPU shuts down automatically after 120 s idle."""
        if model not in MODELS:
            raise ValueError(f"model must be one of {list(MODELS)}")
        call = MossImage(model=model).ping.spawn()
        return {"job_id": call.object_id, "note": "GPU is starting; poll check_job or just call generate_image."}

    @mcp.tool()
    async def generate_image(
        prompt: str,
        negative: str = DEFAULT_NEGATIVE,
        aspect: str = "1:1",
        width: int | None = None,
        height: int | None = None,
        steps: int = 50,
        cfg: float = 3.0,
        seed: int | None = None,
        num_images: int = 1,
        model: str = "sft",
        name: str | None = None,
        shift: float = 5.0,
        skip_layer: int = 22,
    ) -> dict:
        """Generate image(s) with MOSS-Image. Returns a job_id; poll check_job every ~20 s.
        - prompt: detailed English description (subject, setting, light, style, camera). Text to render goes
          in quotes, e.g. a poster with the title "SUMMER SALE". Layout JSON prompts are also accepted.
        - aspect: 1:1, 9:16, 16:9, 4:5, 5:4, 3:4, 4:3, 2:3, 3:2 (~1.5 MP). Or pass width+height (multiples of
          16, 512-2048).
        - steps: 50 recommended (30 for quick drafts). cfg: 3.0 for long prompts, 4-6 for short ones.
        - num_images: 1-4 (seeds seed, seed+1, ...). model: "sft" (default) or "base".
        - skip_layer: negative-branch layer skip, 22 recommended; -1 disables (more realistic, less detail).
        Warm GPU: ~20-40 s per 1.5 MP image at 50 steps. Cold start adds ~1-3 min."""
        if model not in MODELS:
            raise ValueError(f"model must be one of {list(MODELS)}")
        if width and height:
            w, h = int(width), int(height)
        else:
            if aspect not in ASPECTS:
                raise ValueError(f"aspect must be one of {list(ASPECTS)}")
            w, h = ASPECTS[aspect]
        call = MossImage(model=model).generate.spawn(
            prompt=prompt,
            negative=negative,
            width=w,
            height=h,
            steps=steps,
            cfg=cfg,
            shift=shift,
            seed=seed,
            num_images=num_images,
            name=name,
            skip_layer=None if skip_layer is None or skip_layer < 0 else skip_layer,
        )
        return {"job_id": call.object_id, "status": "queued", "width": _snap16(w), "height": _snap16(h)}

    @mcp.tool()
    async def check_job(job_id: str, preview: bool = True) -> list:
        """Check a job. When done, returns download links and (preview=true) a small JPEG preview of each image."""
        call = modal.FunctionCall.from_id(job_id)
        try:
            result = await asyncio.to_thread(call.get, timeout=0)
        except TimeoutError:
            return [{"status": "running"}]
        except modal.exception.OutputExpiredError:
            return [{"status": "expired", "note": "Job result is older than 24 h; use list_images."}]
        if "files" not in result:  # warmup ping
            return [{"status": "done", "result": result}]
        await asyncio.to_thread(volume.reload)
        for f in result["files"]:
            f["link"] = link(f["path"])
        out: list = [{"status": "done", "result": result}]
        if preview:
            for f in result["files"]:
                out.append(await asyncio.to_thread(thumb, f["path"]))
        return out

    @mcp.tool()
    async def list_images(limit: int = 20) -> dict:
        """List the most recent rendered images with download links (newest first)."""
        await asyncio.to_thread(volume.reload)
        items = []
        if os.path.isdir(IMAGES_DIR):
            for day in sorted(os.listdir(IMAGES_DIR), reverse=True):
                d = f"{IMAGES_DIR}/{day}"
                for fn in sorted(os.listdir(d), key=lambda n: os.path.getmtime(f"{d}/{n}"), reverse=True):
                    rel = f"images/{day}/{fn}"
                    items.append({"path": rel, "link": link(rel)})
                    if len(items) >= limit:
                        return {"images": items}
        return {"images": items}

    mcp_http = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        async with mcp.session_manager.run():
            yield

    web = FastAPI(title="VARWENT MOSS Image", lifespan=lifespan, docs_url=None, redoc_url=None)

    @web.middleware("http")
    async def remember_base_url(request: Request, call_next):
        if "url" not in base_url_holder:
            base_url_holder["url"] = f"https://{request.headers.get('host', '')}"
        return await call_next(request)

    @web.get("/health")
    async def health():
        return {"ok": True, "app": APP_NAME}

    @web.get("/files/{rel:path}")
    async def files(rel: str, t: str = ""):
        if ".." in rel or not hmac.compare_digest(t, _sign(rel)):
            raise HTTPException(status_code=403, detail="bad link")
        full = f"{DATA}/{rel}"
        if not os.path.isfile(full):
            await asyncio.to_thread(volume.reload)
        if not os.path.isfile(full):
            raise HTTPException(status_code=404, detail="not found")
        return FileResponse(full, media_type="image/png")

    # The secret token is part of the MCP URL: https://<host>/<MCP_TOKEN>/mcp
    web.mount(f"/{token}", mcp_http)
    return web


@app.function(image=web_image, volumes={DATA: volume}, secrets=[auth_secret], timeout=600)
@modal.concurrent(max_inputs=50)
@modal.asgi_app()
def web():
    return build_web_app()
