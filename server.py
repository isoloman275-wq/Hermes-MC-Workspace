#!/usr/bin/env python3
"""
Mission Control + Kanban — merged 3D war-room backend.
- TITANS  = machines (M1/M2/M3) + <brain> opaque cloud
- DAEMONS = LLMs (<your-coder-model> / <brain-model-b> / <your-model> / <brain>)
- TASKS   = Kanban cards rendered as shards orbiting their assignee Titan
- DRONES  = cron jobs (from static inventory)
- ECONOMY = the 9 income streams (labels only)

Stdlib only. SSE live feed. Windows-proxy LAN probing for M2/M3.
"""
import json, os, sqlite3, subprocess, threading, socket, datetime, time, re, uuid
try:
    import yaml
except Exception:
    yaml = None
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qsl
import comfy_wrapper as cw

# --- local ollama providers: direct /v1 chat (bypass heavy hermes agent loop) ---
import urllib.request as _urllib, urllib.error as _urle
def _ollama_chat(base_url, model, msg):
    payload = {
        "model": model or "",
        "messages": [{"role": "user", "content": msg}],
        "stream": False,
        "think": False,
        "max_tokens": 800,
    }
    data = json.dumps(payload).encode()
    req = _urllib.Request(base_url + "/chat/completions", data=data,
                           headers={"Content-Type": "application/json"})
    with _urllib.urlopen(req, timeout=120) as r:
        resp = json.loads(r.read().decode())
    return (resp.get("choices", [{}])[0].get("message", {}).get("content", "") or "").strip()

OLLAMA_BASE = {
    "ollama-m1": "http://<host-m1>:11434/v1",
    "ollama-m2": "http://<host-m2>:11434/v1",
    "ollama-m3": "http://<host-m3>:11434/v1",
}

# --- operator chat: single-flight guard so repeated prompts can't stack subprocesses ---
_hermes_op_lock = threading.Lock()
def hermes_operator_reply(msg, model=None, provider=None):
    """Route chat to a real model. Cloud (openrouter) uses the full Hermes agent
    via `hermes -z`; local ollama providers get a direct /v1 chat completion
    (thinking off, bounded) so weak local models don't hang the agent loop."""
    if not msg:
        return ""
    # Local ollama providers: direct /v1 chat completion (bypasses heavy agent loop)
    if provider in OLLAMA_BASE:
        try:
            return _ollama_chat(OLLAMA_BASE[provider], model or "", msg)
        except Exception as e:
            return "✗ local model error: " + str(e)[:200]
    # Cloud: full Hermes agent
    hermes_bin = os.path.expanduser("~/.local/share/pipx/venvs/hermes-agent/bin/hermes")
    if not os.path.isfile(hermes_bin):
        hermes_bin = "hermes"
    try:
        cmd = [hermes_bin, "-z", msg]
        _ap = {"openrouter", "ollama-m1", "ollama-m2", "ollama-m3"}
        if provider and provider in _ap:
            cmd += ["--provider", provider]
        if model and re.match(r"^[A-Za-z0-9:._/-]+$", model or ""):
            cmd += ["-m", model]
        res = subprocess.run(cmd,
                             capture_output=True, text=True, timeout=180)
        return (res.stdout or "").strip() or ("✗ hermes error: " + (res.stderr or "").strip()[:200])
    except subprocess.TimeoutExpired:
        return "⏳ Hermes took too long to answer (>3 min). Try a shorter prompt, or ask again."
    except Exception as e:
        return "✗ hermes call failed: " + str(e)[:200]

socket.setdefaulttimeout(6)

PORT = int(os.environ.get("PORT", "8777"))
HERE = os.path.dirname(os.path.abspath(__file__))
KANBAN_DB = os.path.expanduser("~/.hermes/kanban.db")

# ---- Machines (edit freely) ----
# Add or remove "Node" entries as needed — one node or twenty.
# id (unique), name (label), host (LAN IP or <host-n>), proxy (False = MC host
# reaches it directly), models (placeholder names), note, titan (large 3D node),
# brain_for (optional routing tag).
MACHINES = [
    {"id": "m1", "name": "Node 1", "host": "<host-m1>", "proxy": False,
     "models": ["<brain-model>", "<your-model>"], "note": "Main agent & Primary · sub-agent: <your-model> · <brain>/OpenRouter brain lives here",
     "titan": True, "brain_for": "<brain>"},
    {"id": "m2", "name": "Node 2", "host": "<host-m2>", "proxy": False,
     "models": ["<your-coder-model>", "<your-large-model>"], "note": "LLM server — <your-large-model> · sub-agent: <your-coder-model>", "titan": True},
    {"id": "m3", "name": "Node 3", "host": "<host-m3>", "proxy": False,
     "models": ["<your-small-model-a>"], "note": "sub-agent: <your-small-model-a>", "titan": True},
]

# VRAM/context ceilings (user-explicit: zero offload ever)
CTX_CAPS = {"<your-coder-model>": 196608, "<your-large-model>": 131072, "<your-model>": 131072, "<your-small-model-a>": 64000, "<your-small-model-c>": 64000}

# Cron drones (static inventory; host tag = routing)
CRON_DRONES = [
    {"id": "c1", "name": "Daily Config Backup", "host": "m1", "schedule": "daily 17:00"},
    {"id": "c2", "name": "Daily Trend Analysis", "host": "m1", "schedule": "daily"},
    {"id": "c3", "name": "Weekly Repo Backup Reminder", "host": "m1", "schedule": "2026-07-26"},
]

# Income-stream pylons (display only, no infra). UI shows up to 12;
# edit this list freely — add or remove streams as your setup changes.
ECONOMY = ["Stream 1", "Stream 2", "Stream 3", "Stream 4",
           "Stream 5", "Stream 6", "Stream 7", "Stream 8",
           "Stream 9", "Stream 10", "Stream 11", "Stream 12"]

# Greenlight Gate — agent actions requiring human approval before execution.
# Mirrors the lab operating model: no destructive / external-send / model-pull /
# credential-change / config-change unprompted. Agents POST /api/approvals/create.
GREENLIGHT_GATES = {
    "default": ["destructive", "external-send", "credential-change", "model-pull", "config-change"],
    "devops": ["destructive", "external-send", "credential-change", "model-pull", "config-change", "restart"],
    "architect": ["merge", "publish", "destructive"],
    "coder": ["external-send", "destructive"],
    "builder": ["model-pull", "destructive"],
    "researcher": ["external-send"],
    "reviewer": ["merge"],
    "copywriter": ["external-send", "publish"],
    "ip-guard": ["external-send", "publish", "destructive"],
    "data-analyst": ["external-send", "destructive"],
}

STATE = {"booting": True, "built_at": None, "machines": [], "daemons": [],
         "tasks": [], "drones": CRON_DRONES, "economy": ECONOMY, "errors": []}
STATE_LOCK = threading.Lock()
EVENT_QUEUES = []  # list of queue.Queue for SSE clients
EVENT_LOCK = threading.Lock()


def http_get(host, port, path, timeout=5):
    """Direct HTTP GET. Returns (status, body). For LAN hosts from WSL use win_proxy_get."""
    try:
        with socket.create_connection((host, port), timeout=timeout) as s:
            req = f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
            s.sendall(req.encode())
            buf = b""
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                buf += chunk
            head, _, body = buf.partition(b"\r\n\r\n")
            status = int(head.split(b" ")[1])
            return status, body.decode("utf-8", "replace")
    except Exception:
        return 0, ""


_MC_HIDDEN_VBS = '''Set sh = CreateObject("WScript.Shell")
cmd = WScript.Arguments(0)
out = WScript.Arguments(1)
rc = sh.Run("cmd.exe /c " & cmd & " > """ & out & """ 2>&1", 0, True)
WScript.Quit rc
'''
_MC_HIDDEN_VBS_PATH = r"C:\tmp\mc_hidden.vbs"


def _ensure_hidden_vbs():
    try:
        os.makedirs(r"C:\tmp", exist_ok=True)
        if not os.path.exists(_MC_HIDDEN_VBS_PATH):
            with open(_MC_HIDDEN_VBS_PATH, "w", encoding="utf-8") as f:
                f.write(_MC_HIDDEN_VBS)
    except Exception:
        pass


def _win_hidden(cmd, out_path, timeout):
    """Run a Windows console command hidden (no console window); return (rc, stdout)."""
    _ensure_hidden_vbs()
    try:
        r = subprocess.run(
            ["wscript.exe", _MC_HIDDEN_VBS_PATH, cmd, out_path],
            capture_output=True, text=True, timeout=timeout)
        try:
            with open(out_path, "r", encoding="utf-8", errors="replace") as f:
                data = f.read()
        except Exception:
            data = ""
        return r.returncode, data
    except Exception:
        return 1, ""
    finally:
        try:
            os.remove(out_path)
        except Exception:
            pass


def http_post(host, port, path, payload, timeout=20):
    """Direct HTTP POST (JSON body). Returns (ok_bool, body_text)."""
    try:
        body = json.dumps(payload).encode("utf-8")
        with socket.create_connection((host, port), timeout=timeout) as s:
            s.settimeout(timeout)
            req = (f"POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\n"
                   f"Content-Type: application/json\r\n"
                   f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n").encode() + body
            s.sendall(req)
            buf = b""
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                buf += chunk
            head, _, body = buf.partition(b"\r\n\r\n")
            return (int(head.split(b" ")[1]) == 200), body.decode("utf-8", "replace")
    except Exception:
        return False, ""

def win_proxy_get(host, port, path, timeout=8):
    """HTTP GET via Windows curl (hidden window) — WSL can't reach M3 directly."""
    url = f"http://{host}:{port}{path}"
    out_path = r"C:\tmp\mc_get_" + uuid.uuid4().hex + ".txt"
    rc, data = _win_hidden(f"curl -s --max-time {timeout} {url}", out_path, timeout + 6)
    return 200 if rc == 0 and data.strip() else 0, data


def win_proxy_post(host, port, path, payload, timeout=20):
    """HTTP POST via Windows curl (hidden window) — WSL can't reach M3 directly."""
    url = f"http://{host}:{port}{path}"
    tmp = r"C:\tmp\mc_post.json"
    try:
        os.makedirs(r"C:\tmp", exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload))
        out_path = r"C:\tmp\mc_post_out_" + uuid.uuid4().hex + ".txt"
        cmd = (f'curl -s --max-time {timeout} -X POST '
               f'-H "Content-Type: application/json" -d @{tmp} {url}')
        rc, data = _win_hidden(cmd, out_path, timeout + 6)
        return rc == 0, data
    except Exception:
        return False, ""


def ollama_tags(host, proxy=False, timeout=4):
    fn = win_proxy_get if proxy else http_get
    st, data = fn(host, 11434, "/api/tags", timeout)
    if st != 200:
        return []
    try:
        return [m.get("name", "?") for m in json.loads(data).get("models", [])]
    except Exception:
        return []


def ollama_loaded(host, proxy=False, timeout=4):
    fn = win_proxy_get if proxy else http_get
    st, data = fn(host, 11434, "/api/ps", timeout)
    if st != 200:
        return []
    try:
        return [m.get("name") for m in json.loads(data).get("models", [])]
    except Exception:
        return []


def machine_state(m):
    rec = {"id": m["id"], "name": m["name"], "online": False, "cloud": m.get("cloud", False),
           "note": m.get("note", ""), "models": m.get("models", []),
           "titan": m.get("titan", True)}
    if m.get("cloud"):
        rec["online"] = True
        # resolve the live brain model name for the operator (Atua)
        if m.get("brain_for"):
            # <brain> is opaque; report its configured model id (<brain-model> from config)
            rec["brain"] = m.get("brain_model", "<brain-model>")
        return rec
    # probe
    if m.get("proxy"):
        st, _ = win_proxy_get(m["host"], 11434, "/api/tags", 4)
        rec["online"] = (st == 200)
    else:
        st, _ = http_get(m["host"], 11434, "/api/tags", 4)
        rec["online"] = (st == 200)
    # if this machine is the operator's fallback and <brain> is down, show fallback brain
    if m.get("brain_for"):
        brain = next((x for x in MACHINES if x["id"] == m["brain_for"]), None)
        if brain and brain.get("brain_model"):
            rec["brain"] = brain["brain_model"]   # <brain> reachable -> show its real model id
            rec["brain_fallback"] = False
        else:
            rec["brain"] = (m["models"][0] if m["models"] else "local")
            rec["brain_fallback"] = True
    return rec


def daemon_state():
    daemons = []
    # OpenRouter API — lives in Atua (m1) now. Shown as Atua's brain core,
    # conforming to the same daemon-core convention as every other LLM.
    daemons.append({"id": "<brain>-openrouter", "name": "<brain-model>", "host": "m1",
                    "loaded": True, "cloud": True, "ctx_cap": None})
    for m in MACHINES:
        if m.get("cloud"):
            continue
        ms = machine_state(m)
        if ms["online"]:
            installed = ollama_tags(m["host"], proxy=m.get("proxy"))
            loaded = set(ollama_loaded(m["host"], proxy=m.get("proxy")))
            for mod in installed:
                base = mod.split(":")[0]
                ctx = CTX_CAPS.get(mod) or CTX_CAPS.get(base)
                daemons.append({"id": f"{m['id']}:{mod}", "name": mod, "host": m["id"],
                                "loaded": mod in loaded, "cloud": False,
                                "ctx_cap": ctx})
        else:
            for mod in m.get("models", []):
                base = mod.split(":")[0]
                ctx = CTX_CAPS.get(mod) or CTX_CAPS.get(base)
                daemons.append({"id": f"{m['id']}:{mod}", "name": mod, "host": m["id"],
                                "loaded": False, "cloud": False, "ctx_cap": ctx})
    return daemons


def kanban_tasks():
    """Read live cards from kanban.db (SQLite). Map status -> color."""
    tasks = []
    if not os.path.exists(KANBAN_DB):
        return tasks
    try:
        con = sqlite3.connect(KANBAN_DB, timeout=3)
        con.row_factory = sqlite3.Row
        cur = con.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cur.fetchall()]
        if "tasks" in tables:
            cur.execute("SELECT * FROM tasks ORDER BY rowid DESC LIMIT 200")
            cols = [d[0] for d in cur.description]
            for row in cur.fetchall():
                d = dict(row)
                assignee = d.get("assignee") or d.get("owner") or "unassigned"
                status = (d.get("status") or "ready").lower()
                tasks.append({
                    "id": d.get("id") or d.get("task_id") or str(d.get("rowid")),
                    "title": (d.get("title") or d.get("name") or "(untitled)")[:120],
                    "assignee": assignee,
                    "status": status,
                    "parents": d.get("parents") or [],
                    "board": d.get("board") or "default",
                })
        con.close()
    except Exception as e:
        with STATE_LOCK:
            STATE["errors"].append(f"kanban read: {e}")
    return tasks


# ---- Kanban CLI shell-out (board is source of truth) ----
HERMES_BIN = os.path.expanduser("~/.local/bin/hermes")


def kanban_cli(args, timeout=30):
    """Shell out to `hermes kanban <args>`. Returns (rc, stdout)."""
    try:
        proc = subprocess.run(
            [HERMES_BIN, "kanban"] + args,
            capture_output=True, text=True, timeout=timeout)
        return proc.returncode, (proc.stdout + proc.stderr).strip()
    except Exception as e:
        return 1, str(e)


def hermes_cli(args, timeout=60):
    """Shell out to `hermes <args>` (any subcommand). Returns (rc, stdout)."""
    try:
        proc = subprocess.run(
            [HERMES_BIN] + list(args),
            capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return proc.returncode, (proc.stdout + proc.stderr).strip()
    except Exception as e:
        return 1, str(e)


PROFILE_DIR = os.path.expanduser("~/.hermes/profiles")


def list_profiles():
    """Read the 9 Hermes profiles + their model/host."""
    profiles = []
    if not os.path.isdir(PROFILE_DIR):
        return profiles
    # machine mapping per lab topology (user-verified)
    PROFILE_MACHINE = {
        "coder": "m2", "researcher": "m2", "reviewer": "m2",
        "builder": "m1", "data-analyst": "m1",
        "copywriter": "m3", "ip-guard": "m3", "devops": "m3",
        "architect": "<brain>",
    }
    ROLE_COLOR = {
        "architect": "gold", "coder": "blue", "builder": "green",
        "devops": "amber", "researcher": "violet", "reviewer": "teal",
        "copywriter": "pink", "ip-guard": "red", "data-analyst": "cyan",
    }
    for name in sorted(os.listdir(PROFILE_DIR)):
        pdir = os.path.join(PROFILE_DIR, name)
        if not os.path.isdir(pdir):
            continue
        cfg = {}
        cfgpath = os.path.join(pdir, "config.yaml")
        if os.path.isfile(cfgpath):
            try:
                import yaml
                with open(cfgpath) as f:
                    cfg = yaml.safe_load(f) or {}
            except Exception:
                pass
        model = cfg.get("model") or ""
        profiles.append({
            "id": name,
            "name": name,
            "machine": PROFILE_MACHINE.get(name, "m1"),
            "color": ROLE_COLOR.get(name, "blue"),
            "model": model,
            "online": True,
            "loaded": False,
        })
    return profiles


def _profile_loaded(name, model, machine):
    """Is this profile's model currently loaded? Local = Ollama ps; <brain> = daemon state."""
    try:
        if machine == "<brain>":
            for d in STATE.get("daemons", []):
                if d.get("host") == "<brain>" or "<brain>" in d.get("id", "").lower():
                    return bool(d.get("loaded"))
        elif machine == "m1":
            return model in set(ollama_loaded("localhost", proxy=False))
        elif machine == "m2":
            return model in set(ollama_loaded("<host-m2>", proxy=True))
        elif machine == "m3":
            return model in set(ollama_loaded("<host-m3>", proxy=False))
    except Exception:
        pass
    return False


def list_profiles():
    """Inventory all Hermes worker profiles (roles dispatched by the head
    operator). Source of truth = the profiles/ dir + each profile's config.yaml
    model.

    IMPORTANT — two distinct meanings of "architect", do NOT conflate:
      * The HEAD / OPERATOR (you + Hermes agent, running on M1) uses <brain>
        (OpenRouter) as its brain, with fallback <your-large-model> (M2) -> <your-model>
        (M1). This is the lead agent session. <brain> belongs to the operator.
      * The "architect" WORKER PROFILE is just one role we own, executing its
        LLM on M2 (<your-large-model>). It is NOT the operator brain. The operator
        brain is <brain> (with M2/M1 fallback), not the architect worker profile.
    """
    profiles = []
    PROFILE_MACHINE = {
        "coder": "m2", "researcher": "m2", "reviewer": "m2",
        "builder": "m1", "data-analyst": "m1",
        "copywriter": "m3", "ip-guard": "m3", "devops": "m3",
        "architect": "m2",
    }
    ROLE_COLOR = {
        "architect": "gold", "coder": "blue", "builder": "green",
        "devops": "amber", "researcher": "violet", "reviewer": "teal",
        "copywriter": "pink", "ip-guard": "red", "data-analyst": "cyan",
    }
    if not os.path.isdir(PROFILE_DIR):
        return profiles
    for name in sorted(os.listdir(PROFILE_DIR)):
        pdir = os.path.join(PROFILE_DIR, name)
        if not os.path.isdir(pdir):
            continue
        cfg = {}
        cfgpath = os.path.join(pdir, "config.yaml")
        if os.path.isfile(cfgpath):
            try:
                import yaml
                with open(cfgpath) as f:
                    cfg = yaml.safe_load(f) or {}
            except Exception:
                pass
        model = cfg.get("model") or ""
        machine = PROFILE_MACHINE.get(name, "m1")
        profiles.append({
            "id": name,
            "name": name,
            "machine": machine,
            "color": ROLE_COLOR.get(name, "blue"),
            "model": model,
            "online": True,
            "loaded": _profile_loaded(name, model, machine),
        })
    return profiles


def assignable_profiles():
    """Who can take work right now. Respects M2 single-VRAM:
    if M2 has a model loaded, only ONE m2-profile may be active."""
    profs = list_profiles()
    # probe M2 load
    m2_loaded = bool(ollama_loaded("<host-m2>", proxy=True))
    if m2_loaded:
        # only allow one m2 profile at a time; mark others busy
        seen_m2 = False
        for p in profs:
            if p["machine"] == "m2":
                if seen_m2:
                    p["busy"] = True
                else:
                    seen_m2 = True
    return profs


def tail_log(profile, n=50, base=None):
    """Return last n lines of a profile's agent log.
    base overrides the default ~/.hermes/profiles dir (used for the operator log at ~/.hermes/logs)."""
    root = base if base else PROFILE_DIR
    logpath = os.path.join(root, profile, "logs", "agent.log") if base else os.path.join(PROFILE_DIR, profile, "logs", "agent.log")
    if not os.path.isfile(logpath):
        return []
    try:
        with open(logpath, "r", errors="replace") as f:
            lines = f.readlines()
        return [l.rstrip() for l in lines[-n:]]
    except Exception:
        return []



# ---------- MCv3 S3: Lab metrics + Cron manager ----------

# GPU VRAM totals (bytes) per machine — USER-VERIFY: correct these to your
# actual GPU sizes; they're only used to compute the VRAM usage %.
VRAM_TOTAL_GB = {"m1": 24, "m2": 24, "m3": 4}

START_TIME = time.time()


def ollama_ps(host, proxy=False, timeout=5):
    """Raw /api/ps model list (with size_vram) for a host."""
    fn = win_proxy_get if proxy else http_get
    st, data = fn(host, 11434, "/api/ps", timeout)
    if st != 200:
        return []
    try:
        return json.loads(data).get("models", [])
    except Exception:
        return []


def _gateway_running():
    try:
        out = subprocess.run(["pgrep", "-f", "hermes_cli.main gateway"],
                             capture_output=True, text=True, timeout=5)
        return out.returncode == 0 and bool(out.stdout.strip())
    except Exception:
        return False


def _task_throughput():
    try:
        con = sqlite3.connect(KANBAN_DB, timeout=3)
        cur = con.cursor()
        now = int(time.time())
        hour_ago = now - 3600
        cur.execute("SELECT COUNT(*) FROM task_runs WHERE outcome='completed' AND ended_at >= ?", (hour_ago,))
        done_1h = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM tasks")
        total = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM tasks WHERE status='done'")
        done = cur.fetchone()[0]
        con.close()
        return {"completed_last_hour": done_1h, "tasks_total": total, "tasks_done": done}
    except Exception:
        return {"completed_last_hour": 0, "tasks_total": 0, "tasks_done": 0}


# ---- live system metrics: RAM / CPU / disk / VRAM per node ----
# M1 = this box (real /proc). M2 = reachable via SSH (<ssh-user>@<host-m2>).
# M3 = LAN-only (VRAM via Ollama proxy; RAM/CPU/disk firewalled -> "LAN·restricted").
LOCAL_MACHINE_IDS = {"m1"}
SSH_HOSTS = {"m2": ("<ssh-user>", "<host-m2>")}   # id -> (user, host)

_cpu_prev_local = None
_cpu_prev_remote = {}
_sys_cache = {}


def _parse_meminfo(text):
    d = {}
    for line in text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            try:
                d[k.strip()] = int(v.split()[0])
            except (ValueError, IndexError):
                pass
    total = d.get("MemTotal", 0) * 1024
    avail = d.get("MemAvailable", d.get("MemFree", 0)) * 1024
    return total, avail


def _cpu_pct_from_stat(stat_text, prev):
    """Busy % from a /proc/stat 'cpu ' line given previous (total, idle) sample."""
    line = next((l for l in stat_text.splitlines() if l.startswith("cpu ")), None)
    if not line:
        return None, prev
    nums = list(map(int, line.split()[1:]))
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
    total = sum(nums[:8]) if len(nums) >= 8 else sum(nums)
    if prev is None:
        return None, (total, idle)
    pt, pi = prev
    dtotal = total - pt
    didle = idle - pi
    if dtotal <= 0:
        return 0.0, (total, idle)
    pct = max(0.0, min(100.0, 100.0 * (dtotal - didle) / dtotal))
    return pct, (total, idle)


def _parse_loadavg(text):
    try:
        return round(float(text.split()[0]), 2)
    except Exception:
        return 0.0


def _parse_df(text):
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 6 and parts[5] == "/":
            try:
                # df columns: fs, 1B-blocks(total), Used, Available, Use%, Mounted
                return int(parts[2]), int(parts[1])
            except ValueError:
                pass
    return (0, 1)


def _parse_nvidia(text):
    used = tot = 0
    for line in text.strip().splitlines():
        line = line.replace("MiB", "").strip()
        if "," in line:
            u, t = line.split(",")
            try:
                used += int(u.strip()); tot += int(t.strip())
            except ValueError:
                pass
    return used, tot


def _read_local_sys():
    global _cpu_prev_local
    total, avail = _parse_meminfo(open("/proc/meminfo").read())
    cpu_pct, _cpu_prev_local = _cpu_pct_from_stat(open("/proc/stat").read(), _cpu_prev_local)
    load = _parse_loadavg(open("/proc/loadavg").read())
    cores = os.cpu_count() or 1
    df_out = subprocess.run(["df", "-B1", "/"], capture_output=True, text=True).stdout
    used_b, total_b = _parse_df(df_out)
    ram_used = total - avail
    return {
        "ram_used_gb": round(ram_used / 1e9, 1), "ram_total_gb": round(total / 1e9, 1),
        "ram_pct": round(100.0 * ram_used / total, 1) if total else 0.0,
        "cpu_pct": round(cpu_pct, 1) if cpu_pct is not None else None,
        "cpu_cores": cores, "load1": load,
        "disk_used_gb": round(used_b / 1e9, 1), "disk_total_gb": round(total_b / 1e9, 1),
        "disk_pct": round(100.0 * used_b / total_b, 1) if total_b else 0.0,
        "vram_used_gb": None, "vram_total_gb": VRAM_TOTAL_GB.get("m1", 0),
        "vram_pct": None,
    }


def _read_ssh_sys(key):
    user, host = SSH_HOSTS[key]
    now = time.time()
    cached = _sys_cache.get(key)
    if cached and now - cached[0] < 5:
        return cached[1]
    remote = ("cat /proc/meminfo; echo @@S@@; cat /proc/stat; echo @@L@@; "
              "cat /proc/loadavg; echo @@C@@; nproc; echo @@D@@; "
              "df -B1 / /home 2>/dev/null; echo @@N@@; "
              "nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null")
    try:
        out = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
                              "-o", "StrictHostKeyChecking=no", f"{user}@{host}", remote],
                             capture_output=True, text=True, timeout=12).stdout
    except Exception:
        _sys_cache[key] = (now, None); return None
    try:
        segs = out.split("@@S@@"); mem_txt = segs[0]
        segs = segs[1].split("@@L@@"); stat_txt = segs[0]
        segs = segs[1].split("@@C@@"); load_txt = segs[0]
        _cm = re.search(r"\d+", segs[1])
        cores = int(_cm.group()) if _cm else 1
        segs = segs[1].split("@@D@@"); rest_seg = segs[1] if len(segs) > 1 else ""
        segs = rest_seg.split("@@N@@"); df_txt = segs[0]
        nv_txt = segs[1] if len(segs) > 1 else ""
    except Exception:
        _sys_cache[key] = (now, None); return None
    total, avail = _parse_meminfo(mem_txt)
    cpu_pct, _cpu_prev_remote[key] = _cpu_pct_from_stat(stat_txt, _cpu_prev_remote.get(key))
    load = _parse_loadavg(load_txt)
    used_b, total_b = _parse_df(df_txt)
    nv_used, nv_tot = _parse_nvidia(nv_txt)
    ram_used = total - avail
    res = {
        "ram_used_gb": round(ram_used / 1e9, 1), "ram_total_gb": round(total / 1e9, 1),
        "ram_pct": round(100.0 * ram_used / total, 1) if total else 0.0,
        "cpu_pct": round(cpu_pct, 1) if cpu_pct is not None else None,
        "cpu_cores": cores, "load1": load,
        "disk_used_gb": round(used_b / 1e9, 1), "disk_total_gb": round(total_b / 1e9, 1),
        "disk_pct": round(100.0 * used_b / total_b, 1) if total_b else 0.0,
        "vram_used_gb": round(nv_used / 1024, 1) if nv_used else None,
        "vram_total_gb": round(nv_tot / 1024, 1) if nv_tot else VRAM_TOTAL_GB.get(key, 0),
        "vram_pct": round(100.0 * nv_used / nv_tot, 1) if nv_tot else None,
    }
    _sys_cache[key] = (now, res)
    return res


def get_metrics():
    """Per-machine VRAM/models + live RAM/CPU/disk system metrics."""
    machines = []
    for m in MACHINES:
        rec = {"id": m["id"], "name": m["name"], "online": False,
               "vram_used_bytes": 0,
               "vram_total_bytes": int(VRAM_TOTAL_GB.get(m["id"], 0) * 1e9),
               "vram_pct": 0.0, "models_loaded": [], "models_installed": [],
               "ram_pct": None, "ram_used_gb": None, "ram_total_gb": None,
               "cpu_pct": None, "cpu_cores": None, "load1": None,
               "disk_pct": None, "disk_used_gb": None, "disk_total_gb": None,
               "vram_used_gb": None, "vram_total_gb": None,
               "sys_source": "offline"}
        if m.get("cloud"):
            rec["online"] = True
            rec["sys_source"] = "cloud"
            machines.append(rec)
            continue
        if m.get("proxy"):
            st, _ = win_proxy_get(m["host"], 11434, "/api/tags", 4)
        else:
            st, _ = http_get(m["host"], 11434, "/api/tags", 4)
        rec["online"] = (st == 200)
        # live system metrics (RAM/CPU/disk/VRAM) where reachable
        if m["id"] in LOCAL_MACHINE_IDS:
            sys = _read_local_sys(); rec["sys_source"] = "local"
        elif m["id"] in SSH_HOSTS:
            sys = _read_ssh_sys(m["id"]); rec["sys_source"] = "ssh" if sys else "lan"
        else:
            sys = None; rec["sys_source"] = "lan" if rec["online"] else "offline"
        if rec["online"]:
            loaded = ollama_ps(m["host"], proxy=m.get("proxy"))
            installed = ollama_tags(m["host"], proxy=m.get("proxy"))
            rec["models_installed"] = installed
            used = 0
            for mod in loaded:
                name = mod.get("name", "?")
                sz = mod.get("size_vram") or 0
                used += sz
                base = name.split(":")[0]
                ctx = CTX_CAPS.get(name) or CTX_CAPS.get(base)
                rec["models_loaded"].append(
                    {"name": name, "size_vram": sz, "ctx_cap": ctx})
            rec["vram_used_bytes"] = used
            tot = rec["vram_total_bytes"]
            rec["vram_pct"] = round(100.0 * used / tot, 1) if tot else 0.0
        # overlay real VRAM from nvidia-smi (ssh) when present
        if sys and sys.get("vram_used_gb") is not None:
            rec["vram_used_gb"] = sys["vram_used_gb"]
            rec["vram_total_gb"] = sys["vram_total_gb"]
            rec["vram_pct"] = sys["vram_pct"]
            rec["vram_used_bytes"] = int(sys["vram_used_gb"] * 1e9)
            rec["vram_total_bytes"] = int(sys["vram_total_gb"] * 1e9)
        if sys:
            for k in ("ram_pct", "ram_used_gb", "ram_total_gb", "cpu_pct",
                      "cpu_cores", "load1", "disk_pct", "disk_used_gb", "disk_total_gb"):
                rec[k] = sys.get(k)
        if not rec["online"] and rec.get("vram_used_gb") is None:
            rec["vram_pct"] = None
        machines.append(rec)
    return {
        "machines": machines,
        "throughput": _task_throughput(),
        "uptime_s": int(time.time() - START_TIME),
        "gateway": "running" if _gateway_running() else "down",
        "generated_at": datetime.datetime.now().isoformat(),
    }


def get_cron_jobs():
    try:
        with open(os.path.expanduser("~/.hermes/cron/jobs.json")) as f:
            data = json.load(f)
        out = []
        for j in data.get("jobs", []):
            out.append({
                "id": j.get("id"),
                "name": j.get("name"),
                "schedule": j.get("schedule_display") or j.get("schedule"),
                "repeat": j.get("repeat"),
                "enabled": bool(j.get("enabled", True)),
                "state": j.get("state"),
                "next_run_at": j.get("next_run_at"),
                "last_run_at": j.get("last_run_at"),
                "last_status": j.get("last_status"),
                "profile": j.get("profile"),
            })
        return out
    except Exception:
        return []


_MEM_CACHE = {"n": 0, "ts": 0.0}
def memory_fact_count():
    """Count facts in the Hermes holographic memory store (fact_store). Read-only, cached 30s."""
    import os, time, sqlite3 as _sql
    now = time.time()
    if now - _MEM_CACHE["ts"] < 30:
        return _MEM_CACHE["n"]
    try:
        db = os.path.expanduser('~/.hermes/memory_store.db')
        con = _sql.connect(db, timeout=2)
        n = con.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        con.close()
        _MEM_CACHE["n"] = n; _MEM_CACHE["ts"] = now
        return n
    except Exception:
        return _MEM_CACHE["n"]

def build_state():
    result = {}
    def _run():
        result["snap"] = _build_core()
    th = threading.Thread(target=_run, daemon=True)
    th.start()
    th.join(timeout=14)
    if th.is_alive():
        with STATE_LOCK:
            STATE["booting"] = False
            STATE["error"] = "build timeout"
            STATE["built_at"] = datetime.datetime.now().isoformat()
            STATE["machines"] = [machine_state(m) for m in MACHINES]
            STATE["daemons"] = daemon_state()
            STATE["tasks"] = kanban_tasks()
            STATE["drones"] = CRON_DRONES
            STATE["build_ms"] = 14000
        return False
    return result.get("snap", False)


def _build_core():
    t0 = datetime.datetime.now()
    try:
        machines = [machine_state(m) for m in MACHINES]
        daemons = daemon_state()
        tasks = kanban_tasks()
        snap = {"booting": False, "built_at": t0.isoformat(),
                "machines": machines, "daemons": daemons, "tasks": tasks,
                "drones": CRON_DRONES, "economy": ECONOMY,
                "memory_facts": memory_fact_count(),
                "errors": STATE.get("errors", []),
                "build_ms": int((datetime.datetime.now() - t0).total_seconds() * 1000)}
        with STATE_LOCK:
            for k, v in snap.items():
                STATE[k] = v
        # notify SSE clients of new snapshot
        _emit({"type": "state", "ts": snap["built_at"]})
        return True
    except Exception as e:
        with STATE_LOCK:
            STATE["booting"] = False
            STATE["error"] = str(e)
            STATE["built_at"] = t0.isoformat()
            STATE["machines"] = []
            STATE["daemons"] = []
            STATE["tasks"] = []
            STATE["errors"] = [str(e)]
            STATE["build_ms"] = int((datetime.datetime.now() - t0).total_seconds() * 1000)
        return False


def _emit(obj):
    with EVENT_LOCK:
        for q in list(EVENT_QUEUES):
            try:
                q.put(obj)
            except Exception:
                pass


def collector_loop():
    """Background: rebuild state every 5s, always respond instantly with booting:true first."""
    while True:
        build_state()
        time.sleep(5)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.end_headers()
        if isinstance(body, str):
            body = body.encode()
        self.wfile.write(body)

    def _send_file_bytes(self, data, ctype):
        """Send file bytes with HTTP Range support (required for <video> streaming)."""
        total = len(data)
        rng = self.headers.get("Range")
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        if rng:
            try:
                spec = rng.split("=", 1)[1].strip()
                start_s, _, end_s = spec.partition("-")
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else total - 1
                end = min(end, total - 1)
                if start < 0 or start > end:
                    self.send_header("Content-Range", "bytes */%d" % total)
                    self.end_headers()
                    return
                chunk = data[start:end + 1]
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, total))
                self.send_header("Content-Length", str(len(chunk)))
                self.end_headers()
                self.wfile.write(chunk)
                return
            except Exception:
                pass  # fall through to full 200
        self.send_header("Content-Length", str(total))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/" or p == "/index.html":
            self._serve_file("index.html", "text/html")
        elif p == "/api/state":
            with STATE_LOCK:
                self._send(200, json.dumps(STATE))
        elif p == "/api/events":
            self._sse()
        elif p == "/api/profiles":
            self._send(200, json.dumps({"profiles": list_profiles()}))
        elif p == "/api/assignable":
            self._send(200, json.dumps({"profiles": assignable_profiles()}))
        elif p == "/api/approvals":
            self._send(200, json.dumps({"approvals": get_approvals(),
                                         "gates": GREENLIGHT_GATES}))
        elif p == "/api/operator/message":
            # operator prompt window -> REAL Hermes (Atua). Logs locally AND
            # shells out to `hermes -z` for a genuine agent reply, returned to
            # the dashboard chat window.
            msg = (data.get("message") or "").strip()
            model = (data.get("model") or "").strip()
            provider = (data.get("provider") or "").strip()
            reply = ""
            if msg:
                try:
                    op_log = os.path.expanduser("~/.hermes/logs/agent.log")
                    os.makedirs(os.path.dirname(op_log), exist_ok=True)
                    ts = datetime.now().strftime("%H:%M:%S")
                    with open(op_log, "a") as f:
                        f.write(f"[{ts}] >> operator prompt (Atua): {msg}\n")
                except Exception:
                    pass
                acquired = _hermes_op_lock.acquire(blocking=False)
                if not acquired:
                    reply = "⏳ Hermes is already answering — wait for the current reply before sending another."
                else:
                    try:
                        reply = hermes_operator_reply(msg, model, provider)
                    finally:
                        _hermes_op_lock.release()
            self._send(200, json.dumps({"ok": True, "reply": reply}))
        elif p == "/api/logs/operator":
            op_base = os.path.expanduser("~/.hermes/logs")
            self._send(200, json.dumps({"profile": "operator", "lines": tail_log("operator", 80, base=op_base)}))
        elif p.startswith("/api/logs/"):
            prof = p.split("/")[-1]
            self._send(200, json.dumps({"profile": prof, "lines": tail_log(prof, 80)}))
        elif p == "/api/metrics":
            self._send(200, json.dumps(get_metrics()))
        elif p == "/api/cron":
            self._send(200, json.dumps({"jobs": get_cron_jobs()}))
        elif p == "/api/comfy/status":
            self._send(200, json.dumps(cw.comfy_status()))
        elif p == "/api/comfy/workflows":
            self._send(200, json.dumps({"workflows": cw.comfy_list_workflows()}))
        elif p == "/api/comfy/gallery":
            self._send(200, json.dumps({"gallery": cw.comfy_gallery_load()}))
        elif p.startswith("/api/comfy/job/"):
            pid = p.split("/")[-1]
            self._send(200, json.dumps(cw.comfy_job(pid)))
        elif p == "/api/comfy/output":
            d = dict(parse_qsl(urlparse(self.path).query))
            data, err = cw.comfy_output_bytes(d.get("filename", ""), d.get("subfolder", ""), d.get("type", ""))
            if err:
                self._send(404, json.dumps({"error": err}))
            else:
                fn = (d.get("filename") or "").lower()
                ctype = "video/mp4" if fn.endswith((".mp4", ".webm", ".mov", ".mkv")) else "image/png"
                self._send_file_bytes(data, ctype)
        elif p == "/api/comfy/m2_vram":
            m2 = next((x for x in MACHINES if x["id"] == "m2"), None)
            if not m2:
                self._send(200, json.dumps({"online": False, "busy": False, "loaded": [], "m2_models": []}))
            else:
                st, _ = http_get(m2["host"], 11434, "/api/ps", 4)
                online = (st == 200)
                loaded = ollama_loaded(m2["host"], proxy=m2.get("proxy")) if online else []
                own_bases = {mm.split(":")[0] for mm in m2["models"]}
                own = [n for n in loaded if n.split(":")[0] in own_bases]
                self._send(200, json.dumps({"online": online, "busy": bool(own),
                                            "loaded": loaded, "m2_models": own}))
        elif p.startswith("/js/") or p.startswith("/css/") or p == "/RobotExpressive.glb":
            ctype = "text/javascript" if p.endswith(".js") else (
                "model/gltf-binary" if p.endswith(".glb") else "text/css")
            self._serve_file(p.lstrip("/"), ctype)
        else:
            self._send(404, "not found")

    def do_POST(self):
        p = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode() or "{}")
        except Exception:
            data = {}
        if p == "/api/operator/message":
            # operator prompt window -> REAL Hermes (Atua). Logs locally AND
            # shells out to `hermes -z` for a genuine agent reply.
            msg = (data.get("message") or "").strip()
            model = (data.get("model") or "").strip()
            provider = (data.get("provider") or "").strip()
            reply = ""
            if msg:
                try:
                    op_log = os.path.expanduser("~/.hermes/logs/agent.log")
                    os.makedirs(os.path.dirname(op_log), exist_ok=True)
                    ts = datetime.now().strftime("%H:%M:%S")
                    with open(op_log, "a") as f:
                        f.write(f"[{ts}] >> operator prompt (Atua): {msg}\n")
                except Exception:
                    pass
                acquired = _hermes_op_lock.acquire(blocking=False)
                if not acquired:
                    reply = "⏳ Hermes is already answering — wait for the current reply before sending another."
                else:
                    try:
                        reply = hermes_operator_reply(msg, model, provider)
                    finally:
                        _hermes_op_lock.release()
            self._send(200, json.dumps({"ok": True, "reply": reply}))
            return
        if p == "/api/task/create":
            title = (data.get("title") or "").strip()
            if not title:
                self._send(400, json.dumps({"error": "title required"}))
                return
            args = ["create", title]
            if data.get("assignee"):
                args += ["--assignee", data["assignee"]]
            if data.get("body"):
                args += ["--body", data["body"]]
            rc, out = kanban_cli(args)
            self._send(200 if rc == 0 else 500,
                       json.dumps({"ok": rc == 0, "detail": out}))
            _emit({"type": "kanban", "action": "create", "title": title})
        elif p == "/api/task/assign":
            tid = data.get("id") or data.get("task_id")
            who = data.get("assignee")
            if not tid or not who:
                self._send(400, json.dumps({"error": "id + assignee required"}))
                return
            rc, out = kanban_cli(["assign", tid, "--assignee", who])
            self._send(200 if rc == 0 else 500,
                       json.dumps({"ok": rc == 0, "detail": out}))
            _emit({"type": "kanban", "action": "assign", "id": tid, "to": who})
        elif p == "/api/task/claim":
            tid = data.get("id") or data.get("task_id")
            who = data.get("profile") or data.get("assignee")
            if not tid or not who:
                self._send(400, json.dumps({"error": "id + profile required"}))
                return
            rc, out = kanban_cli(["claim", tid, "--profile", who])
            self._send(200 if rc == 0 else 500,
                       json.dumps({"ok": rc == 0, "detail": out}))
            _emit({"type": "kanban", "action": "claim", "id": tid, "by": who})
        elif p == "/api/task/complete":
            tid = data.get("id") or data.get("task_id")
            if not tid:
                self._send(400, json.dumps({"error": "id required"}))
                return
            rc, out = kanban_cli(["complete", tid])
            self._send(200 if rc == 0 else 500,
                       json.dumps({"ok": rc == 0, "detail": out}))
            _emit({"type": "kanban", "action": "complete", "id": tid})
        elif p == "/api/task/comment":
            tid = data.get("id") or data.get("task_id")
            text = data.get("text") or ""
            if not tid or not text:
                self._send(400, json.dumps({"error": "id + text required"}))
                return
            rc, out = kanban_cli(["comment", tid, text])
            self._send(200 if rc == 0 else 500,
                       json.dumps({"ok": rc == 0, "detail": out}))
            _emit({"type": "kanban", "action": "comment", "id": tid})
        elif p == "/api/task/delete":
            # soft-archive then hard-purge so the card fully leaves the board
            tids = data.get("ids") or []
            if isinstance(tids, str):
                tids = [tids]
            if not tids:
                self._send(400, json.dumps({"error": "ids required"}))
                return
            rc1, out1 = kanban_cli(["archive"] + list(tids))
            rc2, out2 = kanban_cli(["archive", "--rm"] + list(tids))
            ok = (rc1 == 0 and rc2 == 0)
            self._send(200 if ok else 500,
                       json.dumps({"ok": ok, "archived": out1, "purged": out2}))
            _emit({"type": "kanban", "action": "delete", "ids": tids})
        elif p == "/api/profile/create":
            try:
                name = (data.get("name") or "").strip().lower()
                machine = (data.get("machine") or "").strip().lower()
                desc = (data.get("description") or "").strip()
                if not name or not re.match(r"^[a-z0-9][a-z0-9_\-]*$", name):
                    self._send(400, json.dumps({"error": "valid lowercase profile name required"}))
                    return
                clone_from = {"m1": "builder", "m2": "architect", "m3": "ip-guard"}.get(machine, "default")
                args = ["profile", "create", name, "--clone-from", clone_from]
                if desc:
                    args += ["--description", desc]
                print("[PROFILE_CREATE] calling hermes_cli", args, flush=True)
                rc, out = hermes_cli(args)
                print("[PROFILE_CREATE] rc=", rc, "out=", out[:200], flush=True)
                self._send(200 if rc == 0 else 500,
                           json.dumps({"ok": rc == 0, "detail": out, "clone_from": clone_from}))
            except Exception as e:
                print("[PROFILE_CREATE] EXC", repr(e), flush=True)
                self._send(500, json.dumps({"error": str(e)}))
        elif p == "/api/dispatch":
            rc, out = kanban_cli(["dispatch", "--max", str(data.get("max", 4))])
            self._send(200 if rc == 0 else 500,
                       json.dumps({"ok": rc == 0, "detail": out}))
            _emit({"type": "kanban", "action": "dispatch"})
        elif p == "/api/approvals/create":
            try:
                requester = (data.get("requester") or "agent").strip()
                action = (data.get("action") or "action").strip()
                target = data.get("target") or ""
                detail = data.get("detail") or ""
                aid = create_approval(requester, action, target, detail)
                self._send(200, json.dumps({"ok": True, "id": aid}))
                _emit({"type": "approval", "id": aid, "action": action,
                       "requester": requester, "target": target, "detail": detail, "status": "pending"})
            except Exception as e:
                self._send(500, json.dumps({"ok": False, "error": str(e)}))
        elif p == "/api/approvals/resolve":
            try:
                aid = data.get("id")
                if aid is None:
                    self._send(400, json.dumps({"error": "id required"}))
                    return
                decision = "approved" if (data.get("decision") == "approve") else "denied"
                by = data.get("by") or "operator"
                resolve_approval(aid, decision, by)
                self._send(200, json.dumps({"ok": True}))
                _emit({"type": "approval", "id": aid, "status": decision, "by": by})
            except Exception as e:
                self._send(500, json.dumps({"ok": False, "error": str(e)}))
        elif p == "/api/cron/pause":
            tid = data.get("id")
            if not tid:
                self._send(400, json.dumps({"error": "id required"})); return
            pr = subprocess.run([HERMES_BIN, "cron", "pause", str(tid)],
                                capture_output=True, text=True, timeout=30)
            self._send(200 if pr.returncode == 0 else 500,
                       json.dumps({"ok": pr.returncode == 0, "detail": (pr.stdout + pr.stderr).strip()}))
            _emit({"type": "cron", "action": "pause", "id": tid})
        elif p == "/api/cron/resume":
            tid = data.get("id")
            if not tid:
                self._send(400, json.dumps({"error": "id required"})); return
            pr = subprocess.run([HERMES_BIN, "cron", "resume", str(tid)],
                                capture_output=True, text=True, timeout=30)
            self._send(200 if pr.returncode == 0 else 500,
                       json.dumps({"ok": pr.returncode == 0, "detail": (pr.stdout + pr.stderr).strip()}))
            _emit({"type": "cron", "action": "resume", "id": tid})
        elif p == "/api/cron/run":
            tid = data.get("id")
            if not tid:
                self._send(400, json.dumps({"error": "id required"})); return
            pr = subprocess.run([HERMES_BIN, "cron", "run", str(tid)],
                                capture_output=True, text=True, timeout=60)
            self._send(200 if pr.returncode == 0 else 500,
                       json.dumps({"ok": pr.returncode == 0, "detail": (pr.stdout + pr.stderr).strip()}))
            _emit({"type": "cron", "action": "run", "id": tid})
        elif p == "/api/comfy/generate":
            wid = data.get("workflow_id")
            if not wid:
                self._send(400, json.dumps({"error": "workflow_id required"})); return
            args = data.get("args", {}) or {}
            img = data.get("input_image")
            pid, err = cw.comfy_submit(wid, args, img)
            if err:
                self._send(500, json.dumps({"ok": False, "error": err}))
            else:
                wf = next((w for w in cw.comfy_list_workflows() if w["id"] == wid), {})
                cw.comfy_gallery_add({
                    "prompt_id": pid, "workflow_id": wid,
                    "label": wf.get("label", wid), "type": wf.get("type", "image"),
                    "prompt": args.get("prompt", ""),
                    "created": datetime.datetime.now().isoformat(),
                    "status": "running", "outputs": [],
                })
                self._send(200, json.dumps({"ok": True, "prompt_id": pid}))
                _emit({"type": "comfy", "action": "submit", "prompt_id": pid})
        elif p == "/api/comfy/free_m2":
            m2 = next((x for x in MACHINES if x["id"] == "m2"), None)
            if not m2:
                self._send(400, json.dumps({"error": "no m2 configured"})); return
            loaded = ollama_loaded(m2["host"], proxy=m2.get("proxy"))
            own_bases = {mm.split(":")[0] for mm in m2["models"]}
            to_free = [n for n in loaded if n.split(":")[0] in own_bases]
            results = {}
            for name in to_free:
                ok, _ = http_post(m2["host"], 11434, "/api/generate",
                                       {"model": name, "prompt": "", "keep_alive": 0}, timeout=30)
                results[name] = bool(ok)
            self._send(200, json.dumps({"freed": to_free, "results": results}))
        else:
            self._send(404, "not found")

    def _serve_file(self, rel, ctype):
        fp = os.path.join(HERE, "static", rel)
        if not os.path.isfile(fp):
            self._send(404, "missing")
            return
        with open(fp, "rb") as f:
            self._send(200, f.read(), ctype)

    def _sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        import queue
        q = queue.Queue()
        with EVENT_LOCK:
            EVENT_QUEUES.append(q)
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    obj = q.get(timeout=15)
                    self.wfile.write(f"data: {json.dumps(obj)}\n\n".encode())
                    self.wfile.flush()
                except Exception:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
        except Exception:
            pass
        finally:
            with EVENT_LOCK:
                if q in EVENT_QUEUES:
                    EVENT_QUEUES.remove(q)

    def log_message(self, *a):
        pass


# ---------- Greenlight Approval Gate (SQLite-backed) ----------
APPROVALS_INIT = False
def _init_approvals_db():
    global APPROVALS_INIT
    if APPROVALS_INIT:
        return
    try:
        con = sqlite3.connect(KANBAN_DB)
        con.execute("""CREATE TABLE IF NOT EXISTS approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT, requester TEXT, action TEXT,
            target TEXT, detail TEXT, status TEXT DEFAULT 'pending',
            resolved_by TEXT, resolved_at TEXT)""")
        con.commit(); con.close()
        APPROVALS_INIT = True
    except Exception as e:
        print("approvals db init failed:", e)

def _db():
    con = sqlite3.connect(KANBAN_DB)
    con.execute("PRAGMA busy_timeout=5000")
    con.row_factory = sqlite3.Row
    return con

def get_approvals():
    _init_approvals_db()
    try:
        con = _db()
        rows = con.execute("SELECT * FROM approvals ORDER BY id DESC").fetchall()
        con.close()
        return [dict(r) for r in rows]
    except Exception as e:
        print("get_approvals failed:", e)
        return []

def create_approval(requester, action, target, detail):
    _init_approvals_db()
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    con = _db()
    cur = con.execute(
        "INSERT INTO approvals (created_at, requester, action, target, detail, status) "
        "VALUES (?,?,?,?,?,'pending')",
        (ts, requester, action, target, detail))
    aid = cur.lastrowid
    con.commit(); con.close()
    return aid

def resolve_approval(aid, decision, by):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    con = _db()
    con.execute(
        "UPDATE approvals SET status=?, resolved_by=?, resolved_at=? WHERE id=?",
        (decision, by, ts, aid))
    con.commit(); con.close()


if __name__ == "__main__":
    _init_approvals_db()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    threading.Thread(target=collector_loop, daemon=True).start()
    print(f"Mission Control + Kanban on http://0.0.0.0:{PORT}")
    srv.serve_forever()
