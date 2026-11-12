"""Plugin-owned deterministic worker. Never imports or executes application code."""
from __future__ import annotations
import argparse
import base64
import contextlib
import difflib
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile
import time
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
if sys.version_info < (3, 9):
    sys.exit("Requires Python 3.9 or newer")

from app_delivery.scripts import delivery as d
from app_delivery.scripts.invoke_api import execute
from app_delivery_auth import resolve_authentication, validate_auth_probe_coverage, validate_auth_questions
from app_delivery_config import loopback_connection, original_fields, original_value
from app_delivery_migration import (
    enrich_contract_and_discovery_report,
    inspect_credentials_in_source,
    inspect_local_sqlite_files,
    scan_app_routes_and_pages,
    select_and_filter_platform_resources,
)
from app_delivery_repair import check_archive_syntax, read_archive_file
from app_delivery_sources import dependency_path


def _fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def redact(text: str, name: str = "") -> str:
    hidden = set(d.secret_lines(text, name))
    config = Path(name).suffix.lower() in {".yaml", ".yml", ".ini", ".toml", ".properties"} or Path(name).name.startswith(".env")
    lines = []
    for i, line in enumerate(text.splitlines(), 1):
        if i not in hidden:
            lines.append(line)
            continue
        key = re.match(r"^(\s*(?:#\s*)?(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*[:=])", line) if config else None
        lines.append(key.group(1) + ' "[REDACTED]"' if key else "[REDACTED credential line]")
    return "\n".join(lines)


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


def compute_change_diffs(source: Path, changes: list[dict]) -> dict[str, str]:
    diffs: dict[str, str] = {}
    for ch in changes:
        cpath = ch.get("path", "")
        if not cpath or not isinstance(ch.get("content"), str):
            continue
        p = d.relative(source, cpath)
        old = redact(p.read_text(encoding="utf-8", errors="replace"), cpath) if p.is_file() else ""
        new = redact(ch["content"], cpath)
        diffs[cpath] = "\n".join(
            difflib.unified_diff(
                old.splitlines(),
                new.splitlines(),
                fromfile=cpath + " (原始)",
                tofile=cpath + " (建议)",
            )
        )
    return diffs


def resolve_and_enrich_proposal(
    root: Path,
    proposal: dict,
    *,
    repair: bool = False,
    failed_revision: str = "",
    failure_feedback: str = "",
    revision_count: int = 1,
    feedback_text: str = "",
) -> tuple[dict, dict | None, dict | None]:
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
        if isinstance(change, dict) and not change.get("id"):
            change = {**change, "id": change.get("path") or f"change-{idx + 1}"}
        if isinstance(change, dict) and not change.get("reason"):
            change = {**change, "reason": "容器化与部署适配"}
        validate_file_change(source, change)
        resolved_changes.append(change)
    proposal["changes"] = resolved_changes

    discovery_report = None
    transformation_report = None
    contract = proposal.get("contract")
    if isinstance(contract, dict) and source.is_dir():
        job_meta = {
            "slug": contract.get("slug", ""),
            "name": contract.get("name", contract.get("slug", "")),
            "description": contract.get("description", ""),
            "app_url": contract.get("base_url", ""),
            "port": (contract.get("runtime") or {}).get("port", 8080) if isinstance(contract.get("runtime"), dict) else 8080,
            "revision": revision_count,
            "analysis_mode": "repair" if repair else "analysis",
            "feedback": feedback_text,
        }
        try:
            enrich_contract_and_discovery_report(source, job_meta, proposal)
            discovery_report = proposal.pop("discovery_report", None)
            transformation_report = proposal.pop("transformation_report", None)
        except Exception:
            proposal.pop("discovery_report", None)
            proposal.pop("transformation_report", None)

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
        for config in contract.get("configs", []):
            if not isinstance(config, dict):
                raise ValueError("配置项必须是对象")
            if config.get("source") is not None:
                val = original_value(source, config["source"])
                if not config.get("secret") and not config.get("default") and val:
                    config["default"] = val

        unresolved_all = list(proposal.get("unresolved") or []) + list(contract.get("unresolved") or [])
        decisions = proposal.get("decisions", [])
        if decisions is not None:
            if not isinstance(decisions, list):
                raise ValueError("decisions 必须是列表")
            decision_ids = set()
            for decision in decisions:
                if (
                    not isinstance(decision, dict)
                    or not isinstance(decision.get("id"), str)
                    or not decision["id"]
                    or decision["id"] in decision_ids
                    or decision.get("question") not in unresolved_all
                    or not isinstance(decision.get("impact", ""), str)
                    or not isinstance(decision.get("options"), list)
                    or len(decision["options"]) > 4
                    or any(not isinstance(opt, str) or not opt.strip() for opt in decision["options"])
                ):
                    raise ValueError("每项决定须关联未解决问题、使用唯一 ID 并给出至多四个可选回答")
                decision_ids.add(decision["id"])

        if not unresolved_all:
            bindings = {_fingerprint(c["source"]) for c in contract.get("configs", []) if isinstance(c, dict) and c.get("source")}
            for change in proposal.get("changes", []):
                for field in original_fields(source, change["path"]):
                    ref = field["source"]
                    if field["has_value"] and re.search(d.SECRET_KEY, "_".join(map(str, ref["keys"])), re.I) and _fingerprint(ref) not in bindings:
                        raise ValueError(
                            "原有敏感配置必须保留并通过 source 引用注入，不能清空："
                            + ref["path"]
                            + " / "
                            + ".".join(map(str, ref["keys"]))
                        )

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

    return proposal, discovery_report, transformation_report


def apply_plan(root, proposal, target, *, repair=False, failed_revision="", failure_feedback=""):
    original = root / "review"
    d.require(d.inspect_source(original / "source")[0] == d.load(original / "inventory.json")["files"], "Source changed; import again")
    d.require(isinstance(proposal.get("summary"), str) and proposal["summary"].strip(), "summary required")
    d.require(not proposal.get("unresolved"), "Resolve outstanding questions before preparation")
    proposal, discovery_report, transformation_report = resolve_and_enrich_proposal(
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
    d.check_work(target)
    return proposal, discovery_report, transformation_report


def extract_original_config_values(source: Path, configs: list[dict]) -> tuple[dict[str, str], list[str]]:
    values: dict[str, str] = {}
    has_original_keys: list[str] = []
    for cfg in configs:
        if isinstance(cfg, dict) and cfg.get("source"):
            try:
                val = original_value(source, cfg["source"])
                if val:
                    values[cfg["key"]] = val
                    has_original_keys.append(cfg["key"])
            except Exception:
                pass
    return values, has_original_keys


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
    if action == "filter_resources":
        resources = body.get("resources") or []
        slug = str(body.get("slug") or "")
        default_only = bool(body.get("default_only", False))
        return {"resources": select_and_filter_platform_resources(resources, slug, default_only=default_only)}
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
        rev_count = int(body.get("revision_count") or 1)
        fb_text = str(body.get("feedback") or "")
        source_dir = root / "review/source"
        if proposal.get("unresolved") and body.get("allow_unresolved"):
            proposal, discovery_report, transformation_report = resolve_and_enrich_proposal(
                root,
                proposal,
                repair=repair_flag,
                failed_revision=failed_rev,
                failure_feedback=failure_fb,
                revision_count=rev_count,
                feedback_text=fb_text,
            )
            diffs = compute_change_diffs(source_dir, proposal.get("changes", []))
            _, has_orig = extract_original_config_values(source_dir, (proposal.get("contract") or {}).get("configs", []))
            return {
                "valid": True,
                "proposal": proposal,
                "discovery_report": discovery_report,
                "transformation_report": transformation_report,
                "diffs": diffs,
                "has_original_keys": has_orig,
            }
        with tempfile.TemporaryDirectory(dir=root, prefix="check-") as temp:
            temp_path = Path(temp)
            proposal, discovery_report, transformation_report = apply_plan(
                root,
                proposal,
                temp_path / "approved",
                repair=repair_flag,
                failed_revision=failed_rev,
                failure_feedback=failure_fb,
            )
            d.bundle_work(temp_path / "approved", temp_path / "bundle")
            syntax_check = check_archive_syntax(temp_path / "bundle/app.tar")
        # Persist staged files for future rounds
        draft_path = root / "draft_files.json"
        drafts = load_json_if_exists(draft_path, {})
        for ch in proposal.get("changes", []):
            if isinstance(ch, dict) and ch.get("id") and ch.get("path") and isinstance(ch.get("content"), str):
                drafts[ch["id"]] = dict(ch)
        d.save(draft_path, drafts)
        diffs = compute_change_diffs(source_dir, proposal.get("changes", []))
        _, has_orig = extract_original_config_values(source_dir, (proposal.get("contract") or {}).get("configs", []))
        return {
            "valid": True,
            "proposal": proposal,
            "syntax_check": syntax_check,
            "discovery_report": discovery_report,
            "transformation_report": transformation_report,
            "diffs": diffs,
            "has_original_keys": has_orig,
        }
    if action == "bundle":
        # Each revision has a fresh immutable destination. Failed revisions are never published.
        dest = root / body["revision"]
        d.require(body["revision"].isalnum(), "Invalid revision")
        dest.mkdir(mode=0o700)
        proposal = body["proposal"]
        proposal, discovery_report, transformation_report = apply_plan(
            root,
            proposal,
            dest / "approved",
            repair=bool(body.get("repair")),
            failed_revision=str(body.get("failed_revision") or ""),
            failure_feedback=str(body.get("failure_feedback") or ""),
        )
        result = d.bundle_work(dest / "approved", dest / "bundle")
        syntax_check = check_archive_syntax(dest / "bundle/app.tar")
        skill_markdown = ""
        try:
            with zipfile.ZipFile(dest / "bundle/skill.zip") as zf:
                skill_markdown = zf.read("SKILL.md").decode("utf-8")
        except Exception:
            pass
        dockerfile_path = dest / "approved/source/Dockerfile"
        dockerfile_content = dockerfile_path.read_text(encoding="utf-8", errors="replace") if dockerfile_path.is_file() else ""
        source_dir = root / "review/source"
        orig_values, has_orig = extract_original_config_values(source_dir, (proposal.get("contract") or {}).get("configs", []))
        diffs = compute_change_diffs(source_dir, proposal.get("changes", []))
        preparation_checks = [
            syntax_check,
            {"label": "原源码完整性", "status": "passed", "detail": "已核对分析时的源码摘要，改造在独立副本完成"},
            {"label": "交付文件与业务技能契约", "status": "passed", "detail": "已通过打包器的构建输入、配置和业务契约校验；不是编译或运行测试"},
            {"label": "服务器构建、启动与业务访问", "status": "pending", "detail": "确认部署后在目标服务器验证"},
        ]
        return {
            "summary": result,
            "proposal": proposal,
            "syntax_check": syntax_check,
            "preparation_checks": preparation_checks,
            "discovery_report": discovery_report,
            "transformation_report": transformation_report,
            "skill_markdown": skill_markdown,
            "dockerfile_content": dockerfile_content,
            "original_config_values": orig_values,
            "has_original_keys": has_orig,
            "diffs": diffs,
        }
    if action == "extract_skill_contract":
        zip_bytes = base64.b64decode(body["skill_zip_b64"], validate=True)
        actual_sha = d.sha(zip_bytes)
        expected_sha = str(body.get("expected_sha256") or "").strip().lower()
        if expected_sha and actual_sha != expected_sha:
            raise ValueError("回滚技能包摘要不一致，拒绝启用")
        skill_markdown = ""
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            ops_name = next(
                (n for n in zf.namelist() if n == "references/operations.json" or n.endswith("/references/operations.json")),
                None,
            )
            if not ops_name:
                raise ValueError("回退技能包缺少有效的 references/operations.json")
            ops_raw = zf.read(ops_name).decode("utf-8")
            contract = json.loads(ops_raw)
            md_name = next((n for n in zf.namelist() if n == "SKILL.md" or n.endswith("/SKILL.md")), None)
            if md_name:
                skill_markdown = zf.read(md_name).decode("utf-8", errors="replace")
        expected_slug = str(body.get("slug") or "").strip()
        if expected_slug and contract.get("slug") and contract.get("slug") != expected_slug:
            raise ValueError("回退技能包的标识与当前应用不一致")
        expected_url = str(body.get("app_url") or "").strip()
        if expected_url and contract.get("base_url") and str(contract["base_url"]).rstrip("/") != expected_url.rstrip("/"):
            raise ValueError("回退技能包的访问地址与当前应用不一致")
        return {"contract": contract, "sha256": actual_sha, "skill_markdown": skill_markdown}
    if action == "probe":
        contract = body["contract"]
        credentials = body.get("credentials", {})
        approve_write = bool(body.get("approved"))
        operation_id = body["operation"]
        api_def = next((a for a in (contract.get("apis") or []) if isinstance(a, dict) and a.get("id") == operation_id), {})
        is_readonly = not approve_write and api_def.get("effect", "read") == "read"
        max_attempts = 3 if is_readonly else 1
        result = None
        for attempt in range(max_attempts):
            try:
                # No ambient host credentials or proxy configuration enters an application call.
                result = execute(contract, operation_id, body.get("params", {}), body=body.get("body"), approve_write=approve_write, credential_env=credentials)
            except OSError as exc:
                if attempt == max_attempts - 1:
                    raise ValueError(f"{operation_id} 验证请求失败（{type(exc).__name__}）") from exc
            else:
                if result[0] not in {502, 503, 504} or attempt == max_attempts - 1:
                    break
            time.sleep(0.5 * (attempt + 1))
        d.require(result is not None and len(result[2]) <= 2_000_000, "Response exceeds 2 MB")
        return {"status": result[0], "content_type": result[1], "content": result[2].decode("utf-8", errors="replace")}
    raise ValueError("Unknown worker action")


if __name__ == "__main__":
    try:
        print(json.dumps({"ok": True, "value": main(json.load(sys.stdin))}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": redact(str(exc))[:2000]}, ensure_ascii=False))
        sys.exit(1)
