"""
ComfyUI wrapper for Mission Control.

Config-driven — no hardcoded endpoint:
  COMFYUI_BASE_URL   default http://127.0.0.1:8188   (local ComfyUI)
  COMFY_CLOUD_API_KEY if set, cloud mode (https://cloud.comfy.org)

Transport:
  - local (127.0.0.1/localhost) or cloud -> Python urllib
  - LAN host (WSL cannot reach LAN directly) -> cmd.exe curl, JSON bodies
    written to C:\\tmp to dodge Windows cmd.exe quote-parsing of '&' in prompts.

Workflows are discovered from comfy_workflows/ (manifest.json or *.json scan).
Outputs are tracked in comfy_gallery.json (survives restarts).
"""
import os
import json
import base64
import subprocess
import datetime
import urllib.request
import urllib.error
import urllib.parse
import random

HERE = os.path.dirname(os.path.abspath(__file__))
COMFY_ENV_FILE = os.path.join(HERE, "comfy_env.json")

def _load_comfy_env():
    """Config precedence: env var > comfy_env.json > default. Read at import."""
    fe = {}
    try:
        with open(COMFY_ENV_FILE) as _f:
            fe = json.load(_f) or {}
    except Exception:
        pass
    base = os.environ.get("COMFYUI_BASE_URL") or fe.get("COMFYUI_BASE_URL") or "http://127.0.0.1:8188"
    key = (os.environ.get("COMFY_CLOUD_API_KEY") or fe.get("COMFY_CLOUD_API_KEY") or "").strip()
    return base.rstrip("/"), key

COMFYUI_BASE_URL, COMFY_CLOUD_API_KEY = _load_comfy_env()
COMFY_IS_CLOUD = bool(COMFY_CLOUD_API_KEY)
COMFY_WORKFLOWS_DIR = os.path.join(HERE, "comfy_workflows")
COMFY_GALLERY_FILE = os.path.join(HERE, "comfy_gallery.json")
COMFY_CLIENT_ID = "mission-control"
WIN_TMP = "/mnt/c/tmp"  # accessible to Windows-side curl as C:\tmp


# ---------- helpers ----------

def _comfy_is_local():
    host = urllib.parse.urlparse(COMFYUI_BASE_URL).hostname or ""
    return host in ("127.0.0.1", "localhost", "::1")


def _comfy_url(path):
    if COMFY_IS_CLOUD:
        return "https://cloud.comfy.org" + path
    return COMFYUI_BASE_URL + path


def _win_tmp_path(name):
    os.makedirs(WIN_TMP, exist_ok=True)
    return os.path.join(WIN_TMP, name), "C:\\tmp\\" + name


def _comfy_request(method, path, json_body=None, timeout=120):
    """JSON request. Returns (rc, body_bytes).

    WSL now reaches the LAN ComfyUI directly (<host-m2>:8188), so all
    non-cloud hosts use in-memory urllib POST/GET -- no cmd.exe and no
    C:\\tmp file staging (that mount is unreliable from WSL).
    """
    url = _comfy_url(path)
    headers = {}
    if COMFY_IS_CLOUD:
        headers["X-API-Key"] = COMFY_CLOUD_API_KEY
    data = None
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode()
    req = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 0, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 1, str(e).encode()


def comfy_output_bytes(filename, subfolder, type_field):
    """Fetch a saved image/video. Returns (bytes, error)."""
    q = "/view?filename=" + urllib.parse.quote(filename) + \
        "&subfolder=" + urllib.parse.quote(subfolder or "") + \
        "&type=" + urllib.parse.quote(type_field or "output")
    if COMFY_IS_CLOUD:
        url = "https://cloud.comfy.org" + q
        try:
            hdr = subprocess.run(
                ["cmd.exe", "/c", "curl", "-s", "-D", "-", "-o", "nul", "-m", "30",
                 "-X", "GET", url, "-H", "X-API-Key: " + COMFY_CLOUD_API_KEY],
                capture_output=True, text=True, timeout=40)
            loc = ""
            for line in hdr.stdout.splitlines():
                if line.lower().startswith("location:"):
                    loc = line.split(":", 1)[1].strip()
            if not loc:
                return None, "no redirect from cloud /view"
            # fetch the signed storage URL WITHOUT the API key (avoid leak)
            out = subprocess.run(["cmd.exe", "/c", "curl", "-s", "-L", "-m", "120",
                                  "-X", "GET", loc], capture_output=True, timeout=130)
            return out.stdout, None
        except Exception as e:
            return None, str(e)
    if _comfy_is_local():
        try:
            with urllib.request.urlopen(_comfy_url(q), timeout=120) as r:
                return r.read(), None
        except Exception as e:
            return None, str(e)
    # LAN host -> direct urllib (WSL reaches LAN now; no cmd.exe / C:\\tmp)
    try:
        with urllib.request.urlopen(_comfy_url(q), timeout=120) as r:
            return r.read(), None
    except Exception as e:
        return None, str(e)


# ---------- workflow registry ----------

def _load_manifest():
    mp = os.path.join(COMFY_WORKFLOWS_DIR, "manifest.json")
    if os.path.isfile(mp):
        try:
            with open(mp) as f:
                d = json.load(f)
            return d.get("workflows", []) if isinstance(d, dict) else d
        except Exception:
            return []
    return []


def comfy_list_workflows():
    os.makedirs(COMFY_WORKFLOWS_DIR, exist_ok=True)
    man = _load_manifest()
    if man:
        out = []
        for w in man:
            out.append({
                "id": w["id"],
                "label": w.get("label", w["id"]),
                "type": w.get("type", "image"),
                "params": w.get("params", []),
            })
        return out
    # fallback: scan directory for *.json (excluding manifest)
    out = []
    for fn in sorted(os.listdir(COMFY_WORKFLOWS_DIR)):
        if not fn.endswith(".json") or fn == "manifest.json":
            continue
        wid = fn[:-5]
        out.append({"id": wid, "label": wid, "type": "image", "params": []})
    return out


def _workflow_file(wid):
    for w in _load_manifest():
        if w["id"] == wid:
            return w.get("file", wid + ".json")
    return wid + ".json"


def _manifest_params(wid):
    for w in _load_manifest():
        if w["id"] == wid:
            return w.get("params", [])
    return []


def _load_workflow_file(wid):
    fp = os.path.join(COMFY_WORKFLOWS_DIR, _workflow_file(wid))
    if not os.path.isfile(fp):
        return None, "workflow file not found: " + _workflow_file(wid)
    try:
        with open(fp) as f:
            return json.load(f), None
    except Exception as e:
        return None, "invalid workflow JSON: " + str(e)


def _inject_params(workflow, args, manifest_params):
    """Set workflow node inputs from args.

    Manifest params with node+input pins are used first (deterministic);
    otherwise auto-detect by matching the input key name on a non-link input.
    """
    pin = {}
    for p in (manifest_params or []):
        if p.get("node") and p.get("input") and p.get("key"):
            pin[p["key"]] = (str(p["node"]), p["input"])
    pending_img = None
    for key, val in (args or {}).items():
        if val in (None, ""):
            continue
        if key in pin:
            nid, inp = pin[key]
            if nid in workflow and isinstance(workflow.get(nid), dict):
                workflow[nid].setdefault("inputs", {})[inp] = val
            continue
        if key == "input_image":
            pending_img = val  # handled by caller after upload
            continue
        placed = False
        for nid, node in workflow.items():
            if not isinstance(node, dict) or not isinstance(node.get("inputs"), dict):
                continue
            if key in node["inputs"] and not isinstance(node["inputs"][key], list):
                node["inputs"][key] = val
                placed = True
                break
        # if not placed, leave it (unknown key ignored)
    return workflow, pending_img


# ---------- upload ----------

def comfy_upload(img_bytes, name):
    """Upload a reference image via in-memory multipart POST (no temp file)."""
    import tempfile
    url = _comfy_url("/upload/image")
    boundary = "----mcboundary" + str(random.randint(0, 1 << 30))
    parts = [
        b"--" + boundary,
        b'Content-Disposition: form-data; name="type"', b"", b"input",
        b"--" + boundary,
        b'Content-Disposition: form-data; name="overwrite"', b"", b"true",
        b"--" + boundary,
        ('Content-Disposition: form-data; name="image"; filename="%s"' % name).encode(),
        b"Content-Type: image/png", b"", img_bytes,
        b"--" + boundary + b"--",
    ]
    body = b"\r\n".join(parts) + b"\r\n"
    headers = {"Content-Type": "multipart/form-data; boundary=" + boundary}
    if COMFY_IS_CLOUD:
        headers["X-API-Key"] = COMFY_CLOUD_API_KEY
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=70) as r:
            j = json.loads(r.read())
        return j.get("name") or name, None
    except Exception as e:
        return None, "upload failed: " + str(e)[:200]


# ---------- submit ----------

def comfy_submit(wid, args, input_image_b64=None):
    wf, err = _load_workflow_file(wid)
    if wf is None:
        return None, err
    manifest_params = _manifest_params(wid)
    if input_image_b64:
        try:
            raw = base64.b64decode((input_image_b64 or "").split(",", 1)[-1])
            name, e = comfy_upload(raw, "mc_input.png")
            if e:
                return None, e
            args = dict(args or {})
            args["input_image"] = name  # _inject_params pins it if manifest declares it
        except Exception as e:
            return None, "image decode failed: " + str(e)
    wf, pending_img = _inject_params(wf, args, manifest_params)
    if pending_img:
        # manifest must declare an input_image param with node+input
        for p in manifest_params:
            if p.get("key") == "input_image" and p.get("node") and p.get("input"):
                nid, inp = str(p["node"]), p["input"]
                if nid in wf:
                    wf[nid].setdefault("inputs", {})[inp] = pending_img
                break
    # defensive: guarantee every image/video saver has a filename_prefix
    # (ComfyUI rejects the prompt otherwise). Covers workflows that omit it.
    for _nid, _node in wf.items():
        if isinstance(_node, dict) and _node.get("class_type") in (
            "SaveImage", "SaveImageWebedit", "SaveAnimatedWEBP", "VHS_VideoCombine"
        ):
            _node.setdefault("inputs", {}).setdefault(
                "filename_prefix", "MC_" + str(wid))
    # translate KSampler seed <= 0 (conventional -1 = random) to a valid
    # positive seed (some ComfyUI builds reject seed < 0).
    for _nid, _node in wf.items():
        if isinstance(_node, dict) and _node.get("class_type") == "KSampler":
            _inp = _node.setdefault("inputs", {})
            try:
                _sd = int(_inp.get("seed"))
            except (TypeError, ValueError):
                _sd = -1
            if _sd < 0:
                _inp["seed"] = random.randint(0, 2 ** 31)
    rc, body = _comfy_request("POST", "/api/prompt",
                               {"prompt": wf, "client_id": COMFY_CLIENT_ID})
    if rc != 0:
        return None, "submit failed (rc=%s)" % rc
    try:
        j = json.loads(body)
        pid = j.get("prompt_id")
        if not pid:
            return None, "no prompt_id in response: " + body.decode(errors="replace")[:200]
        return pid, None
    except Exception as e:
        return None, "bad response: %s :: %s" % (e, body.decode(errors="replace")[:200])


# ---------- poll ----------

def _extract_outputs(entry):
    outs = entry.get("outputs", {}) or {}
    outputs = []
    for _nid, o in outs.items():
        for img in o.get("images", []):
            outputs.append({"type": "image", "filename": img.get("filename"),
                            "subfolder": img.get("subfolder", ""),
                            "type_field": img.get("type", "output")})
        for vid in (o.get("videos") or o.get("gifs") or []):
            outputs.append({"type": "video", "filename": vid.get("filename"),
                            "subfolder": vid.get("subfolder", ""),
                            "type_field": vid.get("type", "output")})
    return outputs


def comfy_job(pid):
    rc, body = _comfy_request("GET", "/history/" + pid, timeout=20)
    if rc != 0:
        return {"status": "unknown", "outputs": []}
    try:
        j = json.loads(body)
    except Exception:
        return {"status": "unknown", "outputs": []}
    if pid not in j:
        return {"status": "running", "outputs": []}
    entry = j[pid]
    status = entry.get("status", {}).get("status_str", "done")
    outputs = _extract_outputs(entry)
    if outputs:
        comfy_gallery_update(pid, "done", outputs)
    elif status == "error":
        comfy_gallery_update(pid, "error", [])
    else:
        comfy_gallery_update(pid, "done", outputs)
    return {"status": ("done" if status in ("success",) else status), "outputs": outputs}


# ---------- gallery (persisted) ----------

def comfy_gallery_load():
    if os.path.isfile(COMFY_GALLERY_FILE):
        try:
            with open(COMFY_GALLERY_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return []


def comfy_gallery_save(g):
    try:
        with open(COMFY_GALLERY_FILE, "w") as f:
            json.dump(g, f)
    except Exception:
        pass


def comfy_gallery_add(entry):
    g = comfy_gallery_load()
    g.insert(0, entry)
    g = g[:200]
    comfy_gallery_save(g)
    return g


def comfy_gallery_update(pid, status, outputs):
    g = comfy_gallery_load()
    changed = False
    for e in g:
        if e.get("prompt_id") == pid:
            e["status"] = status
            if outputs:
                e["outputs"] = outputs
            changed = True
            break
    if changed:
        comfy_gallery_save(g)


# ---------- status ----------

def comfy_status():
    if COMFY_IS_CLOUD:
        return {"reachable": True, "cloud": True, "base": "https://cloud.comfy.org"}
    rc, body = _comfy_request("GET", "/system_stats", timeout=8)
    if rc == 0 and body:
        try:
            d = json.loads(body)
            return {"reachable": True, "cloud": False, "base": COMFYUI_BASE_URL,
                    "devices": len(d.get("devices", []))}
        except Exception:
            return {"reachable": True, "cloud": False, "base": COMFYUI_BASE_URL}
    return {"reachable": False, "cloud": False, "base": COMFYUI_BASE_URL}
