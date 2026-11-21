#!/usr/bin/env python3
"""Invoke a documented application operation without embedding credentials."""

import argparse
from email.message import Message
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import urllib.response


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class LoginContractError(ValueError):
    pass


def application_opener(candidate_probe=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    return CandidateProbeOpener(opener, candidate_probe) if candidate_probe else opener


class CandidateProbeOpener:
    def __init__(self, opener, target):
        self.opener = opener
        self.target = target

    def open(self, request, timeout):
        url = urllib.parse.urlsplit(request.full_url)
        path = urllib.parse.urlunsplit(("", "", url.path or "/", url.query, ""))
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("candidate operation must use an application path")
        probe = {"method": request.get_method(), "path": path, "headers": dict(request.header_items())}
        target_id = self.target.get("target")
        if target_id:
            self.target.pop("proof", None)
            probe["target"] = target_id
        if request.data is not None:
            probe["body"] = request.data.decode("utf-8")
        envelope = urllib.request.Request(
            self.target["url"],
            data=json.dumps(probe, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": "Bearer " + self.target["token"], "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with self.opener.open(envelope, timeout=min(timeout, 30)) as response:
                result = json.loads(response.read(16 * 1024 * 1024).decode("utf-8"))
        except urllib.error.HTTPError as exc:
            exc.close()
            raise OSError(f"候选验收代理返回 HTTP {exc.code}") from exc
        status = result.get("status")
        content = result.get("body", "")
        if not isinstance(status, int) or not 100 <= status <= 599 or not isinstance(content, str):
            raise ValueError("候选验收代理返回无效结果")
        if target_id and isinstance(result.get("proof"), str):
            self.target["proof"] = result["proof"]
        headers = Message()
        for name, values in result.get("headers", {}).items():
            for value in values:
                headers.add_header(name, value)
        payload = io.BytesIO(content.encode("utf-8"))
        if status >= 300:
            raise urllib.error.HTTPError(request.full_url, status, "candidate application response", headers, payload)
        return urllib.response.addinfourl(payload, headers, request.full_url, status)


def valid_origin(value):
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 for c in value) or "\\" in value:
        raise ValueError("base_url must be an HTTP(S) origin without whitespace or backslashes")
    u = urllib.parse.urlsplit(value)
    if u.scheme not in {"http", "https"} or not u.hostname or u.username is not None or u.password is not None:
        raise ValueError("base_url must be a complete HTTP(S) URL without credentials")
    if u.query or u.fragment or u.path not in {"", "/"} or (u.port is not None and not 1 <= u.port <= 65535):
        raise ValueError("base_url must be an application origin, not a path/query or invalid port")
    return u


def read_json(value, filename):
    if filename:
        return json.load(sys.stdin) if filename == "-" else json.loads(Path(filename).read_text(encoding="utf-8"))
    return json.loads(value)


def validate_basic(value, schema, label):
    """Validate common JSON shapes, not the whole JSON Schema standard."""
    types = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "object": dict, "array": list, "null": type(None)}
    kind = schema.get("type")
    if kind in types:
        if not isinstance(value, types[kind]) or (kind in {"integer", "number"} and isinstance(value, bool)):
            raise ValueError(label + " has the wrong JSON type")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(label + " is outside the documented enum")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(label + " must be a finite JSON number")
        if "minimum" in schema and value < schema["minimum"]:
            raise ValueError(label + " is below the documented minimum")
        if "maximum" in schema and value > schema["maximum"]:
            raise ValueError(label + " is above the documented maximum")
    if isinstance(value, dict):
        missing = set(schema.get("required", [])) - set(value)
        if missing:
            raise ValueError("missing required fields in " + label + ": " + ", ".join(sorted(missing)))
        if schema.get("additionalProperties") is False and set(value) - set(schema.get("properties", {})):
            raise ValueError("unknown fields in " + label)
        for key, child_schema in schema.get("properties", {}).items():
            if key in value:
                validate_basic(value[key], child_schema, label + "." + key)
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for item in value:
            validate_basic(item, schema["items"], label + "[]")


def read_skill_login(markdown):
    match = re.search(r"^<!-- opc-admin-login -->\n```json\n([^\r\n]+)\n```$", markdown, re.M)
    if not match:
        return None
    login = json.loads(match[1])
    if not isinstance(login, dict) or set(login) != {"profile", "username", "password"} or not all(isinstance(v, str) and v for v in login.values()):
        raise ValueError("技能 Markdown 中的管理员账号格式无效")
    return login


def skill_login_credentials(contract, markdown, operation, credential_env):
    login = read_skill_login(markdown)
    if login is None:
        return credential_env
    auth = next((api.get("auth", {}) for api in contract["apis"] if api["id"] == operation), {})
    if auth.get("profile") != login["profile"]:
        return credential_env
    profile = contract.get("auth_profiles", {}).get(login["profile"], {})
    if not profile.get("username_env") or not profile.get("password_env"):
        raise ValueError("技能 Markdown 中的管理员账号缺少对应登录方式")
    values = dict(credential_env)
    for key in (auth.get("env"), profile.get("token_env")):
        values.pop(key, None)
    values.update({profile["username_env"]: login["username"], profile["password_env"]: login["password"]})
    return values


def login_method(profile):
    method = profile.get("login_method") or "POST"
    # Older delivery packages combined the HTTP verb with the already configured content type.
    if isinstance(method, str):
        method = method.strip().upper().removesuffix(" APPLICATION/JSON")
    if method not in ("POST", "PUT", "PATCH", "GET", "HEAD", "DELETE", "OPTIONS"):
        raise ValueError("登录请求方式无效，例如请分别填写 POST 和 JSON 请求体")
    return method


def _resolve_contract_auth_credential(contract, auth, credential_env=None, candidate_probe=None, strict_auth=False):
    """Use a supplied session token or exchange supplied credentials at the app login endpoint."""
    environment = os.environ if credential_env is None else credential_env
    profile_id = auth.get("profile")
    profile = contract.get("auth_profiles", {}).get(profile_id) if profile_id else contract.get("auth_profile")
    if profile_id and not isinstance(profile, dict):
        raise ValueError("unknown authentication profile: " + str(profile_id))
    if not isinstance(profile, dict):
        return ""
    token_key = profile.get("token_env")
    if token_key and environment.get(token_key):
        return str(environment[token_key])

    u_key = profile.get("username_env")
    p_key = profile.get("password_env")
    username = environment.get(u_key, "") if u_key else ""
    password = environment.get(p_key, "") if p_key else ""

    login_url = str(profile.get("login_url") or "").strip()
    if login_url and (not login_url.startswith("/") or login_url.startswith("//") or "\\" in login_url or any(c in login_url for c in "\r\n#")):
        raise ValueError("login URL must be a same-origin application path")
    if login_url and (u_key or p_key) and (not u_key or username) and (not p_key or password):
        try:
            body_tpl = profile.get("login_body_template") or profile.get("login_body")
            if not isinstance(body_tpl, dict) or not body_tpl:
                body_tpl = {"username": username, "password": password}
            resolved_body = {}
            for k, v in body_tpl.items():
                if v == "${username}" or (not strict_auth and v in (f"env:{u_key}", "env:USERNAME")):
                    if strict_auth and not username:
                        raise LoginContractError("登录模板引用用户名，但方案没有提供用户名配置值")
                    resolved_body[k] = username
                elif v == "${password}" or (not strict_auth and v in (f"env:{p_key}", "env:PASSWORD")):
                    if strict_auth and not password:
                        raise LoginContractError("登录模板引用口令，但方案没有提供口令配置值")
                    resolved_body[k] = password
                elif isinstance(v, str) and v.startswith("env:"):
                    env_k = v[4:]
                    value = environment.get(env_k)
                    if strict_auth and not value:
                        raise LoginContractError("登录模板引用了没有配置值的键：" + env_k)
                    resolved_body[k] = value or (username if "USER" in env_k else password)
                else:
                    resolved_body[k] = v

            req_url = contract["base_url"].rstrip("/") + login_url
            req = urllib.request.Request(
                req_url,
                data=json.dumps(resolved_body).encode("utf-8"),
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                method=login_method(profile),
            )
            login_probe = {key: candidate_probe[key] for key in ("url", "token")} if candidate_probe else None
            opener = application_opener(login_probe)
            with opener.open(req, timeout=10) as resp:
                if auth.get("type") == "header" and auth.get("header", "").lower() == "cookie":
                    cookies = resp.headers.get_all("Set-Cookie") or []
                    if cookies:
                        return "; ".join(c.split(";", 1)[0] for c in cookies)
                    if strict_auth:
                        raise LoginContractError("应用登录响应缺少方案声明的 Cookie")
                token_path = str(profile.get("token_json_path") or "").strip()
                if strict_auth and not token_path:
                    raise LoginContractError("登录方案须声明应用响应中的 token_json_path")
                raw = json.loads(resp.read(65536).decode("utf-8"))
                cur = raw
                for part in (token_path or "token").split("."):
                    if isinstance(cur, dict) and part in cur:
                        cur = cur[part]
                    else:
                        cur = None
                        break
                if isinstance(cur, str) and cur.strip():
                    return cur.strip()
                if strict_auth:
                    raise LoginContractError("登录响应缺少方案声明的 Token 路径：" + token_path)
                if isinstance(raw, dict):
                    for candidate_key in ("token", "access_token", "jwt", "session_token"):
                        if isinstance(raw.get(candidate_key), str) and raw[candidate_key].strip():
                            return raw[candidate_key].strip()
                        if isinstance(raw.get("data"), dict) and isinstance(raw["data"].get(candidate_key), str):
                            return raw["data"][candidate_key].strip()
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise ValueError("应用登录失败，请核对账号权限或更新登录凭据") from exc
            raise ValueError(f"应用登录接口返回 HTTP {exc.code}，请检查应用日志或登录配置") from exc
        except LoginContractError:
            raise
        except (urllib.error.URLError, ValueError, OSError) as exc:
            raise ValueError("应用登录请求失败，请检查连接和登录配置") from exc
    if username and password and auth.get("type") == "header" and auth.get("header", "").lower() == "authorization":
        import base64
        return "Basic " + base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return ""


def build_request(contract, operation, params, body, approve_write=False, credential_env=None, candidate_probe=None, strict_auth=False):
    origin = valid_origin(contract["base_url"])
    matches = [a for a in contract["apis"] if a["id"] == operation]
    if len(matches) != 1:
        raise ValueError("unknown operation; consult references/operations.json")
    api = matches[0]
    if api.get("effect") not in {"read", "write", "destructive", "external"}:
        raise ValueError("operation must declare its business side effects")
    if api["effect"] != "read" and not approve_write:
        raise ValueError("operation changes business state; obtain user approval before --approve-write")
    if not isinstance(params, dict):
        raise ValueError("parameters must be a JSON object")
    path = api["path"]
    query, headers = {}, {"Accept": "application/json"}
    known = {p["name"] for p in api.get("parameters", [])}
    if set(params) - known:
        raise ValueError("unknown parameters: " + ", ".join(sorted(set(params) - known)))
    for param in api.get("parameters", []):
        key = param["name"]
        if param.get("required") and (key not in params or params[key] is None):
            raise ValueError("missing required parameter: " + key)
        if key not in params:
            continue
        value = params[key]
        validate_basic(value, param, "parameter " + key)
        if isinstance(value, (dict, list)):
            raise ValueError("complex parameter encoding must be defined in the skill: " + key)
        value = str(value).lower() if isinstance(value, bool) else str(value)
        if param["in"] == "path":
            if value in {".", "..", ""}:
                raise ValueError("path parameter must be a nonempty non-traversing segment")
            path = path.replace("{" + key + "}", urllib.parse.quote(value, safe=""))
        elif param["in"] == "query":
            query[key] = value
        elif param["in"] == "header":
            if key.lower() in {"host", "authorization", "proxy-authorization", "cookie", "content-length", "transfer-encoding", "connection", "upgrade"}:
                raise ValueError("authentication headers must use the declared auth environment variable")
            headers[key] = value
    if re.search(r"\{[^}]+\}", path):
        raise ValueError("unresolved path parameter")
    if not path.startswith("/") or path.startswith("//") or "?" in path or "#" in path:
        raise ValueError("invalid operation path")
    auth = api.get("auth", {"type": "none"})
    if auth.get("type") not in {"none", "bearer", "header"}:
        raise ValueError("unsupported authentication; a dedicated client is required")
    if auth["type"] != "none":
        credential = (os.environ if credential_env is None else credential_env).get(auth.get("env", ""), "")
        if not credential:
            credential = _resolve_contract_auth_credential(contract, auth, credential_env, candidate_probe, strict_auth)
        if not credential:
            raise ValueError("missing credential connection / 应用账号连接不可用，请检查认证方案：" + str(auth.get("profile") or auth.get("env") or "default"))
        if auth["type"] == "bearer":
            headers["Authorization"] = "Bearer " + credential
        else:
            if auth["header"].lower() in {"host", "proxy-authorization", "content-length", "transfer-encoding", "connection", "upgrade"}:
                raise ValueError("invalid authentication header name")
            headers[auth["header"]] = credential
    spec = api.get("request_body")
    if spec and spec.get("required") and body is None:
        raise ValueError("request body is required")
    if body is not None:
        if not spec:
            raise ValueError("operation does not declare a request body")
        schema = spec.get("schema", {})
        validate_basic(body, schema, "request body")
        headers["Content-Type"] = "application/json"
    url = contract["base_url"].rstrip("/") + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    target = urllib.parse.urlsplit(url)
    if (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
        raise ValueError("request escaped the declared application origin")
    for key, value in headers.items():
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", key) or any(c in value for c in "\r\n\x00"):
            raise ValueError("invalid header name/value; credential values are not logged")
        try:
            value.encode("latin-1")
        except UnicodeEncodeError:
            raise ValueError("header value requires explicit encoding; credential values are not logged") from None
    payload = None if body is None else json.dumps(body, allow_nan=False).encode()
    return urllib.request.Request(url, data=payload, headers=headers, method=api["method"])


def execute(contract, operation, params, body=None, approve_write=False, credential_env=None, candidate_probe=None, strict_auth=False):
    verification = contract.get("verification")
    explicit_auth = bool(strict_auth or candidate_probe or (isinstance(verification, dict) and verification.get("targets")))
    request = build_request(contract, operation, params, body, approve_write, credential_env, candidate_probe, explicit_auth)
    # Do not forward credentials through redirects or system proxies.
    opener = application_opener(candidate_probe)
    try:
        with opener.open(request, timeout=180) as response:
            return response.status, response.headers.get("Content-Type", ""), response.read(100_000_001)
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, exc.headers.get("Content-Type", ""), exc.read(100_000_001)
        finally:
            exc.close()


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operation", required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--params", default="{}")
    group.add_argument("--params-file")
    parser.add_argument("--body-file")
    parser.add_argument("--approve-write", action="store_true")
    args = parser.parse_args()
    try:
        root = Path(__file__).resolve().parents[1]
        if (root / ".work-delivery-pending").exists():
            raise ValueError("Work application deployment has not passed verification; this skill is disabled")
        contract = json.loads((root / "references/operations.json").read_text(encoding="utf-8"))
        params = read_json(args.params, args.params_file)
        body = read_json("null", args.body_file)
        md = root / "SKILL.md"
        credentials = skill_login_credentials(contract, md.read_text(encoding="utf-8") if md.is_file() else "", args.operation, os.environ)
        status, content_type, content = execute(contract, args.operation, params, body, args.approve_write, credentials)
        if len(content) > 100_000_000:
            raise ValueError("response exceeds 100 MB; narrow the query")
        print(content.decode("utf-8", errors="replace"))
        return 0 if 200 <= status < 300 else 1
    except (ValueError, KeyError, OSError, urllib.error.URLError) as exc:
        # Avoid logging request objects, credential values, or credential-bearing URLs.
        print("Invocation failed: " + (str(exc) if isinstance(exc, ValueError) else type(exc).__name__), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
