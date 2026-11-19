"""Apply the administrator account to the isolated delivery copy."""

import ast
from contextlib import closing
from datetime import datetime
import hashlib
import json
import re
import secrets
import shutil
import sqlite3
import struct
import subprocess

from app_delivery.scripts import delivery as d
from app_delivery.scripts.invoke_api import read_skill_login
from app_delivery_config import document, original_value
from vendor import yaml


def sql_name(name):
    d.require(isinstance(name, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name), "SQLite 管理员表或字段名无效")
    return '"' + name + '"'


def original_account_field(source, reference):
    if "keys" in reference:
        return original_value(source, reference)
    path = d.relative(source, reference["path"])
    if "table" in reference:
        table, column = sql_name(reference["table"]), sql_name(reference["column"])
        conditions = reference.get("where", {})
        d.require(isinstance(conditions, dict) and all(type(value) in (str, int, bool) for value in conditions.values()), "原 SQLite 账号筛选无效")
        where = " WHERE " + " AND ".join(sql_name(name) + " = ?" for name in conditions) if conditions else ""
        with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as db:
            db.execute("PRAGMA trusted_schema = OFF")
            rows = db.execute(f"SELECT {column} FROM {table}{where} LIMIT 2", list(conditions.values())).fetchall()
        d.require(len(rows) == 1 and isinstance(rows[0][0], str), "原 SQLite 账号引用必须唯一指向一个明文字段")
        return rows[0][0]
    line_number, name = reference.get("line"), reference.get("name")
    lines = (d.text_of(path) or "").splitlines()
    d.require(type(line_number) is int and 1 <= line_number <= len(lines) and isinstance(name, str), "原始账号常量位置无效")
    match = re.fullmatch(r"\s*(?:(?:const|let|var)\s+)?" + re.escape(name) + r"\s*=\s*(.+?)\s*;?\s*", lines[line_number - 1])
    d.require(bool(match), "原始账号引用必须指向一个明确的字符串常量")
    try:
        value = ast.literal_eval(match[1])
    except (ValueError, SyntaxError):
        raise ValueError("原始账号引用必须指向一个明确的字符串常量") from None
    d.require(isinstance(value, str), "原始账号引用必须指向字符串")
    return value


def validate_account_plan(source, contract):
    plan = contract.get("admin_account")
    if plan is None:
        return
    d.require(isinstance(plan, dict) and set(plan) <= {"mode", "profile", "evidence", "source", "storage"}, "管理员方案只能声明位置与格式")
    profile = contract.get("auth_profiles", {}).get(plan.get("profile", ""))
    d.require(bool(profile and profile.get("login_url") and profile.get("username_env") and profile.get("password_env")
                   and profile["username_env"] != profile["password_env"]), "管理员账密必须绑定已有登录方式")
    routes = [*contract.get("apis", []), *contract.get("pages", [])]
    d.require(any(item.get("auth", {}).get("profile") == plan["profile"] for item in routes), "请将管理员登录方式绑定到实际受保护的接口或页面")
    if plan.get("mode") == "existing":
        d.require("storage" not in plan, "使用已有管理员时不修改账号存储")
        if "source" in plan:
            references = plan["source"]
            d.require(isinstance(references, dict) and set(references) == {"username", "password"}, "请提供账号和密码的原始位置")
            d.require(all(original_account_field(source, ref) for ref in references.values()), "原配置没有完整的账密，请从改造会话询问")
        return
    d.require(plan.get("mode") == "create" and "source" not in plan, "管理员方案必须选择 existing 或 create")
    target = plan.get("storage")
    d.require(isinstance(target, dict) and target.get("kind") in ("file", "sqlite"), "首次建号需要实际文件或 SQLite 位置")
    d.relative(source, target["path"])


def resolve_account(source, contract, reply=None, previous_markdown=""):
    plan = contract.get("admin_account")
    if plan is None:
        return None
    login = {"profile": plan["profile"]}
    if plan.get("source"):
        login.update({key: original_account_field(source, ref) for key, ref in plan["source"].items()})
    else:
        if not reply or reply.get("profile") != plan["profile"] or reply.get("mode") != plan["mode"]:
            reply = read_skill_login(previous_markdown)
        d.require(reply and reply.get("profile") == plan["profile"], "请先在改造会话中填写管理员账号和密码")
        login.update({key: reply.get(key) for key in ("username", "password")})
    d.require(all(isinstance(login[key], str) and 0 < len(login[key]) <= 4096 and not re.search(r"[\r\n\0]", login[key])
                  for key in ("username", "password")), "管理员账号或密码格式无效")
    return login


def write_config_account(source, path, target, login):
    suffix = path.suffix.lower()
    d.require(suffix in (".json", ".yaml", ".yml"), "管理员文件写入支持 JSON 或 YAML")
    content = document(source, target["path"]) if path.is_file() else {}
    for key in ("username", "password"):
        fields = target.get(f"{key}_keys")
        d.require(isinstance(fields, list) and fields and all(isinstance(field, str) and field for field in fields), "管理员字段位置必须是名称数组")
        item = content
        for field in fields[:-1]:
            d.require(isinstance(item, dict), "管理员字段位置与应用配置不匹配")
            item = item.setdefault(field, {})
        d.require(isinstance(item, dict) and item.get(fields[-1]) in (None, ""), "应用配置已有管理员，请使用已有账号")
        item[fields[-1]] = login[key]
    if suffix == ".json":
        d.save(path, content)
    else:
        path.write_text(yaml.safe_dump(content, allow_unicode=True, sort_keys=False), encoding="utf-8")


def _salsa20_8_xor(dest, src):
    x = [dest[i] ^ src[i] for i in range(16)]
    w = list(x)
    for _ in range(4):
        for a, b, c, e in ((0, 4, 8, 12), (5, 9, 13, 1), (10, 14, 2, 6), (15, 3, 7, 11)):
            s = (w[a] + w[e]) & 0xFFFFFFFF; w[b] ^= ((s << 7) | (s >> 25)) & 0xFFFFFFFF
            s = (w[b] + w[a]) & 0xFFFFFFFF; w[c] ^= ((s << 9) | (s >> 23)) & 0xFFFFFFFF
            s = (w[c] + w[b]) & 0xFFFFFFFF; w[e] ^= ((s << 13) | (s >> 19)) & 0xFFFFFFFF
            s = (w[e] + w[c]) & 0xFFFFFFFF; w[a] ^= ((s << 18) | (s >> 14)) & 0xFFFFFFFF
        for a, b, c, e in ((0, 1, 2, 3), (5, 6, 7, 4), (10, 11, 8, 9), (15, 12, 13, 14)):
            s = (w[a] + w[e]) & 0xFFFFFFFF; w[b] ^= ((s << 7) | (s >> 25)) & 0xFFFFFFFF
            s = (w[b] + w[a]) & 0xFFFFFFFF; w[c] ^= ((s << 9) | (s >> 23)) & 0xFFFFFFFF
            s = (w[c] + w[b]) & 0xFFFFFFFF; w[e] ^= ((s << 13) | (s >> 19)) & 0xFFFFFFFF
            s = (w[e] + w[c]) & 0xFFFFFFFF; w[a] ^= ((s << 18) | (s >> 14)) & 0xFFFFFFFF
    return [(x[i] + w[i]) & 0xFFFFFFFF for i in range(16)]


def _pure_scrypt(password_bytes, salt, n, r, p, dklen):
    block_words = 32 * r
    b = hashlib.pbkdf2_hmac("sha256", password_bytes, salt, 1, p * block_words * 4)
    words = list(struct.unpack(f"<{len(b) // 4}I", b))
    for i in range(p):
        off = i * block_words
        x = words[off:off + block_words]
        v = []
        for _ in range(n):
            v.append(x)
            y = [0] * block_words
            prev = x[-16:]
            for j in range(2 * r):
                prev = _salsa20_8_xor(prev, x[j * 16:(j + 1) * 16])
                pos = (j // 2 if j % 2 == 0 else r + j // 2) * 16
                y[pos:pos + 16] = prev
            x = y
        for _ in range(n):
            idx = x[-16] & (n - 1)
            mixed = [x[k] ^ v[idx][k] for k in range(block_words)]
            y = [0] * block_words
            prev = mixed[-16:]
            for j in range(2 * r):
                prev = _salsa20_8_xor(prev, mixed[j * 16:(j + 1) * 16])
                pos = (j // 2 if j % 2 == 0 else r + j // 2) * 16
                y[pos:pos + 16] = prev
            x = y
        words[off:off + block_words] = x
    b2 = struct.pack(f"<{len(words)}I", *words)
    return hashlib.pbkdf2_hmac("sha256", password_bytes, b2, 1, dklen)


def scrypt_digest(password_bytes, salt, n, r, p, length):
    if hasattr(hashlib, "scrypt"):
        return hashlib.scrypt(password_bytes, salt=salt, n=n, r=r, p=p, dklen=length, maxmem=96 * 1024 * 1024).hex()
    node_bin = shutil.which("node")
    if node_bin:
        payload = json.dumps({"p": password_bytes.hex(), "s": salt.hex(), "n": n, "r": r, "p_par": p, "len": length})
        proc = subprocess.run(
            [node_bin, "-e", "const fs=require('fs'),c=require('crypto');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(c.scryptSync(Buffer.from(d.p,'hex'),Buffer.from(d.s,'hex'),d.len,{N:d.n,r:d.r,p:d.p_par,maxmem:96*1024*1024}).toString('hex'))"],
            input=payload, text=True, capture_output=True, timeout=30,
        )
        if proc.returncode == 0 and len(proc.stdout.strip()) == length * 2:
            return proc.stdout.strip()
    return _pure_scrypt(password_bytes, salt, n, r, p, length).hex()


def write_sqlite_account(path, target, login):
    table = sql_name(target["table"])
    row = target.get("row")
    d.require(isinstance(row, dict) and row and len(row) <= 40, "请按应用表结构声明管理员字段")
    names = ", ".join(sql_name(key) for key in row)
    d.require("$username" in row.values(), "管理员记录须包含账号")
    d.require(all(type(value) in (str, int, float, bool) or value is None for value in row.values()), "管理员记录仅支持标量字段")
    values = {"$username": login["username"], "$now": datetime.now().isoformat(timespec="seconds")}
    encoding = target.get("password", {"kind": "plain"})
    if encoding.get("kind") == "plain":
        d.require("$password" in row.values(), "管理员记录须包含密码字段")
        values["$password"] = login["password"]
    else:
        d.require(encoding.get("kind") == "scrypt" and "$salt" in row.values() and "$hash" in row.values() and "$password" not in row.values(),
                  "管理员密码格式不受支持，请保留应用现有登录方式并核对摘要格式")
        n, r, p, length, salt_bytes = (encoding.get(k) for k in ("n", "r", "p", "dklen", "salt_bytes"))
        d.require(all(type(v) is int for v in (n, r, p, length, salt_bytes)) and 2 <= n <= 65536 and 1 <= r <= 16 and 1 <= p <= 8
                  and 16 <= length <= 128 and 8 <= salt_bytes <= 64 and n * r * p <= 524288, "scrypt 参数无效")
        salt = secrets.token_bytes(salt_bytes)
        values.update({"$salt": salt.hex(), "$hash": scrypt_digest(login["password"].encode(), salt, n, r, p, length)})
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA trusted_schema = OFF")
        db.execute("BEGIN IMMEDIATE")
        exists = db.execute("SELECT 1 FROM sqlite_master WHERE name = ? AND type = 'table'", (target["table"],)).fetchone()
        if not exists:
            schema = target.get("create_table", "")
            d.require(isinstance(schema, str) and bool(re.match(r"\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:" + re.escape(table) + "|" + re.escape(target["table"]) + r")\s*\(", schema, re.I)),
                      "管理员表尚未初始化，请提供原项目的 CREATE TABLE 定义")
            db.execute(schema)
        d.require(not db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone(), "应用数据库已有管理员，请使用已有账号")
        db.execute(f"INSERT INTO {table} ({names}) VALUES ({', '.join('?' for _ in row)})", [values.get(value, value) for value in row.values()])


def apply_account(work, contract, login):
    plan = contract.get("admin_account")
    if not plan or plan["mode"] != "create":
        return
    target = plan["storage"]
    source = work / "source"
    path = d.relative(source, target["path"])
    path.parent.mkdir(parents=True, exist_ok=True)
    if target["kind"] == "file":
        write_config_account(source, path, target, login)
    else:
        write_sqlite_account(path, target, login)
    d.require(target["path"] in d.context_files(work, contract), "管理员存储文件必须进入实际应用部署包")
