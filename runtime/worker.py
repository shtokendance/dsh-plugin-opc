"""Plugin-owned deterministic worker. Never imports or executes application code."""
import argparse
import base64
import contextlib
import io
import json
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
if sys.version_info < (3, 9):
    sys.exit("Requires Python 3.9 or newer")

from app_delivery.scripts import delivery as d
from app_delivery.scripts.invoke_api import execute
from app_delivery_auth import resolve_authentication, validate_auth_probe_coverage, validate_auth_questions
from app_delivery_config import original_fields
from app_delivery_migration import (
    enrich_contract_and_discovery_report,
    inspect_credentials_in_source,
    inspect_local_sqlite_files,
    scan_app_routes_and_pages,
)
from app_delivery_repair import check_archive_syntax, read_archive_file
from app_delivery_sources import dependency_path


def redact(text, name=""):
    lines = text.splitlines()
    hidden = set(d.secret_lines(text, name))
    return "\n".join("[REDACTED credential line]" if i in hidden else line for i, line in enumerate(lines, 1))


def load_json_if_exists(path: Path, default):
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def validate_file_change(source: Path, change: dict):
    d.require(isinstance(change, dict), "修改项必须是对象")
    d.require(isinstance(change.get("group", ""), str) and len(change.get("group", "")) <= 160, "修改分组必须是简短文字")
    path = change.get("path")
    target = d.relative(source, path)
    if target.exists() and not target.is_file():
        raise ValueError("修改路径必须是普通文件")
    if any(p in d.EXCLUDED or p == ".coworker" for p in Path(path).parts):
        raise ValueError("禁止修改版本库或 Agent 配置")
    if not isinstance(change.get("path"), str) or not change["path"] or not isinstance(change.get("reason", "适配修改"), str) or not isinstance(change.get("content"), str):
        raise ValueError("修改项必须有路径、原因和完整文件内容")
    if target.is_file() and target.suffix in {".mjs", ".cjs", ".js", ".py", ".go", ".ts"}:
        old = d.text_of(target)
        if old and len(old.splitlines()) > 100 and len(change["content"].splitlines()) < 10:
            raise ValueError("疑似用代码片段覆盖完整业务文件；请保留原业务并提交完整文件内容")
    if len(change["content"].encode("utf-8")) > 2_000_000 or "[REDACTED" in change["content"]:
        raise ValueError("提案文件超限或包含脱敏占位符，需重新分析")


def resolve_and_enrich_proposal(root: Path, proposal: dict, *, repair: bool = False, failed_revision: str = "", failure_feedback: str = "") -> dict:
    source = root / "review/source"
    draft_files = load_json_if_exists(root / "draft_files.json", {})
    resolved_changes = []
    for idx, change in enumerate(proposal.get("changes", [])):
        if isinstance(change, dict) and "content" not in change:
            cid = change.get("id") or change.get("path")
            if cid and cid in draft_files:
                staged = draft_files[cid]
                if change.get("path") and staged.get("path") and change["path"] != staged["path"]:
                    raise ValueError("汇总提案的文件路径与分项提案不一致")
                change = {**staged, **change}
            elif change.get("path"):
                by_path = next((v for v in draft_files.values() if isinstance(v, dict) and v.get("path") == change["path"]), None)
                if by_path:
                    change = {**by_path, **change}
        if isinstance(change, dict) and not change.get("reason"):
            change = {**change, "reason": "容器化与部署适配"}
        validate_file_change(source, change)
        resolved_changes.append(change)
    proposal["changes"] = resolved_changes

    contract = proposal.get("contract")
    if isinstance(contract, dict) and source.is_dir() and (root / "routes_scanned.json").is_file():
        job_meta = {
            "slug": contract.get("slug", ""),
            "name": contract.get("name", contract.get("slug", "")),
            "description": contract.get("description", ""),
            "app_url": contract.get("base_url", ""),
            "port": (contract.get("runtime") or {}).get("port", 8080) if isinstance(contract.get("runtime"), dict) else 8080,
        }
        try:
            enrich_contract_and_discovery_report(source, job_meta, proposal)
            proposal.pop("discovery_report", None)
            proposal.pop("transformation_report", None)
        except Exception:
            pass

    if repair and failed_revision and failed_revision.isalnum():
        failed_archive = root / failed_revision / "bundle/app.tar"
        if failed_archive.is_file():
            failed_read = set(load_json_if_exists(root / "failed_files_read.json", []))
            if not failed_read:
                raise ValueError("修复模式必须先调用 read_failed 读取实际失败制品，不能仅复用旧提案")
            if re.search(r"SyntaxError|ReferenceError|TypeError|ModuleNotFound|Cannot find module", failure_feedback or ""):
                changed = False
                for change in proposal.get("changes", []):
                    try:
                        old = read_archive_file(failed_archive, change["path"])
                    except ValueError:
                        changed = True
                        continue
                    changed = changed or old != change["content"]
                if not changed:
                    raise ValueError("本轮未修改失败制品中的文件，不能将相同程序错误标记为已修复；请读取出错文件并修正")

    if isinstance(contract, dict):
        validate_auth_questions(proposal)
        resolve_authentication(contract)
        for rule in contract.get("auth_rules", []):
            for evidence in rule.get("evidence", []):
                match = re.fullmatch(r"(.+):(\d+)(?:-\d+)?", str(evidence))
                if not match:
                    raise ValueError("认证证据必须是 文件:行号，而不是旧提案或猜测")
                evidence_path = d.relative(source, match[1])
                content = next((c["content"] for c in proposal["changes"] if c["path"] == match[1]), None)
                if content is None:
                    content = d.text_of(evidence_path) if evidence_path.is_file() else None
                if content is None or not 1 <= int(match[2]) <= len(content.splitlines()):
                    raise ValueError("认证证据位置不存在：" + str(evidence))
        if not proposal.get("unresolved") and not contract.get("unresolved"):
            validate_auth_probe_coverage(contract)

    return proposal


def apply_plan(root, proposal, target, *, repair=False, failed_revision="", failure_feedback=""):
    original = root / "review"
    d.require(d.inspect_source(original / "source")[0] == d.load(original / "inventory.json")["files"], "Source changed; import again")
    d.require(isinstance(proposal.get("summary"), str) and proposal["summary"].strip(), "summary required")
    d.require(not proposal.get("unresolved"), "Resolve outstanding questions before preparation")
    proposal = resolve_and_enrich_proposal(
        root,
        proposal,
        repair=repair,
        failed_revision=failed_revision,
        failure_feedback=failure_feedback,
    )
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
        source_dir = root / "review/source"
        p = d.relative(source_dir, body["path"])
        content = d.text_of(p)
        if content is None:
            return {"text": "Binary file"}
        start = max(0, int(body.get("start", 1)) - 1)
        lines = redact(content, body["path"]).splitlines()
        excerpt = "\n".join(f"{i + start + 1}: {s[:400]}" for i, s in enumerate(lines[start:start+200]))
        fields = original_fields(source_dir, body["path"])
        if fields:
            excerpt += "\nOriginal configuration references (metadata only; values stay local):\n" + json.dumps(fields, ensure_ascii=False)
        return {"text": excerpt, "total_lines": len(lines)}
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
        failed_read_path = root / "failed_files_read.json"
        failed_read = set(load_json_if_exists(failed_read_path, []))
        failed_read.add(name)
        d.save(failed_read_path, sorted(failed_read))
        start = max(0, int(body.get("start", 1)) - 1)
        lines = redact(content, name).splitlines()
        return {"text": "\n".join(f"{i + start + 1}: {line[:400]}" for i, line in enumerate(lines[start:start+200])), "total_lines": len(lines)}
    if action == "reference":
        d.require(body["name"] in {"contract.md", "framework-checks.md", "preparation-checks.md", "integration.md"}, "Unknown reference")
        return {"text": (Path(__file__).parent / "app_delivery/references" / body["name"]).read_text(encoding="utf-8")}
    if action == "scan_routes_and_pages":
        res = scan_app_routes_and_pages(root / "review/source")
        d.save(root / "routes_scanned.json", {"scanned": True})
        res["_auto_contract_enrichment"] = (
            "系统已在后端自动缓存全部扫描到的 API 接口与页面视图。你在调用 opc_delivery_submit 时，"
            "后端会自动将全部扫描到的接口与页面 100% 合并注入 contract.apis 与 contract.pages 中。"
            "你无需重复手写几十个接口对象（传空数组 [] 或仅传需定制覆盖的接口即可），"
            "也严禁把接口数量多或扫描问题写入 unresolved！"
        )
        return res
    if action == "inspect_local_storage":
        return inspect_local_sqlite_files(root / "review/source", str(body.get("path", "")))
    if action == "inspect_credentials":
        return inspect_credentials_in_source(
            root / "review/source",
            str(body.get("path", "")),
            str(body.get("cipher_text", "")),
            str(body.get("algorithm_hint", "")),
        )
    if action == "read_go_dependency":
        target = dependency_path(root / "review/source", str(body.get("module", "")), str(body.get("path", "")))
        if not isinstance(target, Path):
            return {"entries": target}
        content = d.text_of(target)
        if content is None:
            return {"text": "Binary dependency file; provide source or interface documentation"}
        start = max(0, int(body.get("start", 1)) - 1)
        rows = redact(content, str(body.get("path", ""))).splitlines()
        return {"text": "\n".join(f"{i + start + 1}: {line[:400]}" for i, line in enumerate(rows[start:start+200])), "total_lines": len(rows)}
    if action == "propose_file":
        change = {
            "id": str(body.get("id") or body.get("path") or ""),
            "path": str(body.get("path") or ""),
            "reason": str(body.get("reason") or "容器化与部署适配"),
            "content": body.get("content"),
            "executable": bool(body.get("executable", False)),
            "group": str(body.get("group") or ""),
        }
        validate_file_change(root / "review/source", change)
        draft_path = root / "draft_files.json"
        drafts = load_json_if_exists(draft_path, {})
        cid = change["id"]
        if cid in drafts and drafts[cid].get("path") != change["path"]:
            raise ValueError("同一修改 ID 不能对应不同文件")
        drafts[cid] = change
        d.save(draft_path, drafts)
        return {"staged": cid, "path": change["path"], "message": f"File proposal recorded: {cid}. Source is unchanged."}
    if action == "validate":
        proposal = body["proposal"]
        repair_flag = bool(body.get("repair"))
        failed_rev = str(body.get("failed_revision") or "")
        failure_fb = str(body.get("failure_feedback") or "")
        if proposal.get("unresolved") and body.get("allow_unresolved"):
            proposal = resolve_and_enrich_proposal(
                root,
                proposal,
                repair=repair_flag,
                failed_revision=failed_rev,
                failure_feedback=failure_fb,
            )
            return {"valid": True, "proposal": proposal}
        with tempfile.TemporaryDirectory(dir=root, prefix="check-") as temp:
            temp_path = Path(temp)
            apply_plan(
                root,
                proposal,
                temp_path / "approved",
                repair=repair_flag,
                failed_revision=failed_rev,
                failure_feedback=failure_fb,
            )
            d.bundle_work(temp_path / "approved", temp_path / "bundle")
            syntax_check = check_archive_syntax(temp_path / "bundle/app.tar")
        return {"valid": True, "proposal": proposal, "syntax_check": syntax_check}
    if action == "bundle":
        # Each revision has a fresh immutable destination. Failed revisions are never published.
        dest = root / body["revision"]
        d.require(body["revision"].isalnum(), "Invalid revision")
        dest.mkdir(mode=0o700)
        proposal = body["proposal"]
        apply_plan(
            root,
            proposal,
            dest / "approved",
            repair=bool(body.get("repair")),
            failed_revision=str(body.get("failed_revision") or ""),
            failure_feedback=str(body.get("failure_feedback") or ""),
        )
        result = d.bundle_work(dest / "approved", dest / "bundle")
        syntax_check = check_archive_syntax(dest / "bundle/app.tar")
        return {"summary": result, "proposal": proposal, "syntax_check": syntax_check}
    if action == "extract_skill_contract":
        zip_bytes = base64.b64decode(body["skill_zip_b64"], validate=True)
        actual_sha = d.sha(zip_bytes)
        expected_sha = str(body.get("expected_sha256") or "").strip().lower()
        if expected_sha and actual_sha != expected_sha:
            raise ValueError("回滚技能包摘要不一致，拒绝启用")
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            ops_raw = zf.read("references/operations.json").decode("utf-8")
            contract = json.loads(ops_raw)
        return {"contract": contract, "sha256": actual_sha}
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
