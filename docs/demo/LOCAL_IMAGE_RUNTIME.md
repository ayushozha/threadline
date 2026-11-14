# Local MiniMax image assets

The asset script generates fictional editorial stills with the native MiniMax
H3 Image path in ComfyUI. It does not create a video or call a hosted image API.
The user confirmed sponsor permission for local use at this event.

The isolated runtime is pinned to ComfyUI commit
`eee59185ff4f43ae2d9ad122b245619d27d9daad`. Its dependencies are reused from an
existing Python environment; the previous project's ComfyUI files and model
configuration are not modified. Model files stay in ignored local directories.

From the Threadline repository in PowerShell, initial runtime checkout:

```powershell
git clone https://github.com/Comfy-Org/ComfyUI.git .artifacts/comfyui-image
git -C .artifacts/comfyui-image checkout eee59185ff4f43ae2d9ad122b245619d27d9daad
```

Configure these in local `.env` or the current shell:

```dotenv
PYTHON_RUNTIME="C:/Users/ayush/Desktop/Hackathons/YC/11-07-2026/Naive Autonomous Company Hackathon/ai-ugc-creator/.venv/Scripts/python.exe"
COMFYUI_DIR="C:/Users/ayush/Desktop/Hackathons/YC/11-14-2026/.artifacts/comfyui-image"
MINIMAX_TEXT_ENCODER_DIR="C:/Users/ayush/Desktop/Hackathons/YC/11-07-2026/Naive Autonomous Company Hackathon/ai-ugc-creator/ComfyUI/models/text_encoders"
MINIMAX_IMAGE_MODEL_FILE=minimax_h3_image_pruned_w4a8.safetensors
MINIMAX_TEXT_ENCODER_FILE=qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors
MINIMAX_IMAGE_VAE_FILE=minimax_h3_image_vae_fp16.safetensors
LOCAL_COMFY_URL=http://127.0.0.1:8188
```

The image checkpoint belongs under `.models/ComfyUI/diffusion_models/` and its
VAE under `.models/ComfyUI/vae/`. The model download manifest records pinned
source revisions, file sizes, and hashes.

Start and check the runtime:

```powershell
./tools/start_local_image_runtime.ps1
Invoke-RestMethod http://127.0.0.1:8188/system_stats
```

Generate one asset at a time:

```powershell
uv run python tools/generate_local_h3_images.py mug-plant
uv run python tools/generate_local_h3_images.py older-hands-plant
uv run python tools/generate_local_h3_images.py quiet-evening-desk
```

The renderer uses `MiniMaxH3ImageConditioning`, six Euler steps, the simple
scheduler, and CFG 1, with no prompt-expansion model. Default output is
1536 × 864; use `--width` and `--height` for another multiple-of-32 size. It
refuses to overwrite an existing output. PNGs are saved under
`assets/demo/visuals/`; prompts, resolved workflow graphs, and generation
receipts are kept under `.artifacts/local-h3-image/`.

Runtime warnings about older frontend or workflow-template packages do not
establish an API failure; the required native nodes and actual rendering must
be checked. No clinical inference is performed by these illustrations.
