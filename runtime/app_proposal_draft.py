import json
import re
import uuid

from app_delivery.scripts import delivery as d


TEXT_SECTION = re.compile(r"(file|reference)\.([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})")
CONTRACT_SECTION = re.compile(r"contract\.[a-z][a-z0-9_]{0,63}")
REFERENCE_NAME = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}")
PROPOSAL_FIELDS = {
    "proposal", "summary", "readiness", "contract", "issues",
    "unresolved", "changes", "decisions", "skill_markdown",
}
MAX_PART_BYTES = 12_000
MAX_DRAFT_BYTES = 16 * 1024 * 1024
MAX_REFERENCE_BYTES = 2 * 1024 * 1024


def proposal_draft(root, action, body):
    revision = body.get("draft_revision")
    d.require(type(revision) is int and 0 <= revision <= 1_000_000, "无效的提案草稿版本")
    path = root / f"proposal-draft-{revision}.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None
    if action == "proposal_draft_status":
        return draft_status(data)
    if action == "assemble_proposal":
        return assemble_proposal(data, body.get("draft_id"))
    section = body.get("section")
    d.require(isinstance(section, str) and (
        section in PROPOSAL_FIELDS or CONTRACT_SECTION.fullmatch(section) or TEXT_SECTION.fullmatch(section)
    ), "无效的提案分段字段")
    if not data:
        data = {"id": uuid.uuid4().hex, "sections": {}}
    sections = data["sections"]
    if action == "clear_proposal_section":
        sections.pop(section, None)
    else:
        save_part(sections, section, body)
    d.save(path, data)
    return draft_status(data, section)


def save_part(sections, section, body):
    part = body.get("part")
    content = body.get("content")
    items = body.get("items")
    last = body.get("last")
    d.require(type(part) is int and 1 <= part <= 4096 and type(last) is bool,
              "请提供从 1 开始的段号和是否为末段")
    is_array = items is not None
    if is_array:
        d.require(isinstance(items, list) and content is None and section not in {"proposal", "skill_markdown"}
                  and not TEXT_SECTION.fullmatch(section), "数组分段请只提供 items，并指定数组字段")
        content = json.dumps(items, ensure_ascii=False, separators=(",", ":"))
    else:
        d.require(isinstance(content, str) and content, "文本分段请提供非空 content")
    d.require(len(json.dumps(content, ensure_ascii=False).encode("utf-8")) <= MAX_PART_BYTES,
              "提案单段超过 12000 UTF-8 字节，请拆小这一段")
    if section not in sections:
        d.require(len(sections) < 512, "提案草稿分段字段过多")
    field = sections.setdefault(section, {"parts": [], "complete": False, "array": is_array})
    d.require(field.get("array", False) == is_array, f"{section} 请沿用同一种分段格式")
    parts = field["parts"]
    d.require(part <= len(parts) + 1, f"{section} 请先提交第 {len(parts) + 1} 段")
    d.require(not last or part >= len(parts), f"{section} 的末段后仍有已保存内容，请先清空该字段再重写")
    if part <= len(parts):
        d.require(parts[part - 1] == content or body.get("replace") is True,
                  f"{section} 第 {part} 段内容已保存，修改时请传 replace=true")
        if field["complete"] and part == len(parts) and not last:
            d.require(body.get("replace") is True, f"{section} 已完整保存，继续追加前请传 replace=true 并重开末段")
        parts[part - 1] = content
    else:
        d.require(not field["complete"], f"{section} 已完整保存，请先重开末段")
        parts.append(content)
    if part == len(parts):
        field["complete"] = last
    size = sum(len(part.encode("utf-8")) for field in sections.values() for part in field["parts"])
    d.require(size <= MAX_DRAFT_BYTES, "本次提案草稿超过 16 MiB。请将已有大文件按路径引用，部署契约保留实际使用内容。")


def draft_status(data, section=None):
    if not data:
        return {"available": False}
    sections = [
        {"section": name, "saved_parts": len(field["parts"]), "complete": field["complete"],
         "format": "items" if field.get("array") else "content",
         "next_part": None if field["complete"] else len(field["parts"]) + 1}
        for name, field in sorted(data["sections"].items()) if section is None or name == section
    ]
    return {"available": True, "draft_id": data["id"], "sections": sections}


def assemble_proposal(data, draft_id):
    d.require(data and data["id"] == draft_id, "提案草稿编号无效，请查询本轮草稿")
    d.require(data["sections"], "提案草稿没有已保存的内容")
    values = {}
    for section, field in data["sections"].items():
        d.require(field["complete"], f"草稿 {section} 未保存完整，请继续提交第 {len(field['parts']) + 1} 段")
        if field.get("array"):
            values[section] = [item for part in field["parts"] for item in json.loads(part)]
            continue
        content = "".join(field["parts"])
        if section == "skill_markdown" or TEXT_SECTION.fullmatch(section):
            values[section] = content
        else:
            try:
                values[section] = json.loads(content)
            except ValueError as error:
                raise ValueError(f"草稿 {section} 的 JSON 格式无效，请修正该字段的分段") from error
    proposal = values.pop("proposal", {})
    d.require(isinstance(proposal, dict), "草稿 proposal 必须为 JSON 对象")
    files = {}
    references = {}
    for section, value in values.items():
        if section in PROPOSAL_FIELDS:
            proposal[section] = value
        elif section.startswith("file."):
            files[section[5:]] = value
        elif section.startswith("reference."):
            references[section[10:]] = value
    for section, value in values.items():
        if section.startswith("contract."):
            contract = proposal.setdefault("contract", {})
            d.require(isinstance(contract, dict), "草稿 contract 必须为 JSON 对象")
            contract[section[9:]] = value
    changes = proposal.get("changes", [])
    d.require(isinstance(changes, list), "草稿 changes 必须为 JSON 数组")
    remaining_files = set(files)
    for change in changes:
        if isinstance(change, dict) and isinstance(change.get("id"), str) and change["id"] in files:
            d.require("content" not in change, f"草稿文件 {change['id']} 已分段保存，请省略 changes 中的 content")
            change["content"] = files[change["id"]]
            remaining_files.discard(change["id"])
    d.require(not remaining_files, f"草稿文件未在 changes 登记：{'、'.join(sorted(remaining_files))}")
    if references:
        proposal["skill_references"] = references
    return proposal
