"""Plugin-owned deterministic worker. Never imports or executes application code."""
import argparse
import contextlib
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import tarfile
sys.path.insert(0, str(Path(__file__).resolve().parent))
if sys.version_info < (3, 9):
    sys.exit("Requires Python 3.9 or newer")
from app_delivery.scripts import delivery as d
from app_delivery.scripts.invoke_api import execute


def redact(text, name=""):
    lines = text.splitlines()
    hidden = set(d.secret_lines(text, name))
    return "\n".join("[REDACTED credential line]" if i in hidden else line for i, line in enumerate(lines, 1))


def apply_plan(root, proposal, target):
    original = root / "review"
    d.require(d.inspect_source(original / "source")[0] == d.load(original / "inventory.json")["files"], "Source changed; import again")
    d.require(isinstance(proposal.get("summary"), str) and proposal["summary"].strip(), "summary required")
    d.require(not proposal.get("unresolved"), "Resolve outstanding questions before preparation")
    shutil.copytree(original, target)
    seen = set()
    for change in proposal.get("changes", []):
        name = change["path"]
        d.require(name not in seen, "Duplicate file change")
        seen.add(name)
        p = d.relative(target / "source", name)
        d.require(isinstance(change.get("content"), str) and len(change["content"]) <= 2_000_000, "Invalid complete file content")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(change["content"], encoding="utf-8")
        p.chmod(0o700 if change.get("executable") else 0o600)
    contract = proposal["contract"]
    d.require(contract["health"]["path"] == "/healthz" and contract["health"]["json_contains"].get("service") == contract["slug"], "Platform requires /healthz with service=slug")
    # Credentials stay in original application files or runtime configuration, not generated skills.
    for profile in [contract.get("auth_profile", {})] + list(contract.get("auth_profiles", {}).values()):
        d.require(not any(profile.get(k) for k in ("password", "admin_password", "auth_token", "token", "api_key", "secret", "bearer_token", "session_cookie", "cookie_value", "admin_username", "username", "cookie", "default_credential")), "Use credential environment references, not embedded credentials")
    d.save(target / "app-contract.json", contract)
    d.save(target / "review.json", {"kind": "ai-technical", "scope": "deployment-adaptation", "source": "DSH isolated preparation; deployment requires separate user confirmation", "approved_issue_ids": ["container-adaptation"], "unresolved": []})
    (target / "analysis.md").write_text(proposal["summary"], encoding="utf-8")
    return d.check_work(target)


def main(body):
    root = Path(body["root"]).resolve()
    action = body["action"]
    if action == "prepare":
        with contextlib.redirect_stdout(io.StringIO()):
            d.prepare(argparse.Namespace(archive=body["source"], work_dir=str(root / "review"), slug=body["slug"], url=body["url"]))
        return {"imported": True}
    if action == "inventory":
        files = d.load(root / "review/inventory.json")["files"]
        start = max(0, int(body.get("start", 1)) - 1)
        return {"files": [{"path": f["path"], "bytes": f["bytes"]} for f in files[start:start+500]], "total": len(files)}
    if action == "read":
        p = d.relative(root / "review/source", body["path"])
        content = d.text_of(p)
        if content is None:
            return {"text": "Binary file"}
        start = max(0, int(body.get("start", 1)) - 1)
        lines = redact(content, body["path"]).splitlines()
        return {"text": "\n".join(f"{i + start + 1}: {s[:400]}" for i, s in enumerate(lines[start:start+200])), "total_lines": len(lines)}
    if action == "read_failed":
        revision = body.get("revision", "")
        d.require(isinstance(revision, str) and revision.isalnum(), "Invalid revision")
        name = body["path"]
        d.relative(root, name)
        archive = root / revision / "bundle/app.tar"
        with tarfile.open(archive) as tar:
            matches = [item for item in tar if item.name == name]
            d.require(len(matches) == 1 and matches[0].isfile() and matches[0].size <= 2_000_000, "Failed artifact file missing or unsafe")
            content = tar.extractfile(matches[0]).read().decode("utf-8")
        start = max(0, int(body.get("start", 1)) - 1)
        lines = redact(content, name).splitlines()
        return {"text": "\n".join(f"{i + start + 1}: {line[:400]}" for i, line in enumerate(lines[start:start+200])), "total_lines": len(lines)}
    if action == "reference":
        d.require(body["name"] in {"contract.md", "framework-checks.md", "preparation-checks.md"}, "Unknown reference")
        return {"text": (Path(__file__).parent / "app_delivery/references" / body["name"]).read_text()}
    if action == "validate":
        with tempfile.TemporaryDirectory(dir=root, prefix="check-") as temp:
            apply_plan(root, body["proposal"], Path(temp) / "approved")
        return {"valid": True}
    if action == "bundle":
        # Each revision has a fresh immutable destination. Failed revisions are never published.
        dest = root / body["revision"]
        d.require(body["revision"].isalnum(), "Invalid revision")
        dest.mkdir(mode=0o700)
        apply_plan(root, body["proposal"], dest / "approved")
        result = d.bundle_work(dest / "approved", dest / "bundle")
        return {"summary": result}
    if action == "probe":
        contract = body["contract"]
        credentials = body.get("credentials", {})
        # No ambient host credentials or proxy configuration enters an application call.
        result = execute(contract, body["operation"], body.get("params", {}), body=body.get("body"), approve_write=bool(body.get("approved")), credential_env=credentials)
        d.require(len(result[2]) <= 2_000_000, "Response exceeds 2 MB")
        return {"status": result[0], "content_type": result[1], "content": result[2].decode("utf-8", errors="replace")}
    raise ValueError("Unknown worker action")


if __name__ == "__main__":
    try:
        print(json.dumps({"ok": True, "value": main(json.load(sys.stdin))}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": redact(str(exc))[:2000]}, ensure_ascii=False))
        sys.exit(1)
