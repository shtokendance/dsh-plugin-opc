"""Resolve scanner uncertainty using explicit, evidence-backed authentication rules."""
import copy
import re

from app_delivery.scripts import delivery


def resolve_authentication(contract):
    errors = []
    rules = contract.get('auth_rules', [])
    valid_rules = []
    if not isinstance(rules, list):
        errors.append('auth_rules 必须是数组')
    else:
        for index, rule in enumerate(rules):
            field = f'auth_rules[{index}]'
            if not isinstance(rule, dict):
                errors.append(f'{field} 必须是对象')
                continue
            rule_ok = True
            if rule.get('target') not in ('api', 'page'):
                errors.append(f'{field}.target 必须填写 api 或 page')
                rule_ok = False
            if not rule.get('evidence'):
                errors.append(f'{field}.evidence 缺少源码证据，请引用读取工具返回的 文件:行号')
                rule_ok = False
            elif not isinstance(rule.get('evidence'), list) or not all(isinstance(e, str) and e for e in rule['evidence']):
                errors.append(f'{field}.evidence 必须是源码位置数组')
                rule_ok = False
            if not isinstance(rule.get('auth'), dict) or rule['auth'].get('type') not in ('none', 'header', 'bearer'):
                errors.append(f'{field}.auth.type 必须使用已确认的 none/header/bearer 方式')
                rule_ok = False
            for key in ('path', 'prefix'):
                if key in rule and (not isinstance(rule[key], str) or not rule[key].startswith('/')):
                    errors.append(f'{field}.{key} 必须是以 / 开头的路径')
                    rule_ok = False
            if bool(rule.get('path')) == bool(rule.get('prefix')):
                errors.append(f'{field} 必须选择精确 path 或路径 prefix')
                rule_ok = False
            if 'method' in rule and not isinstance(rule['method'], str):
                errors.append(f'{field}.method 必须是字符串')
                rule_ok = False
            if rule_ok:
                valid_rules.append(rule)
    for target, key in [('api', 'apis'), ('page', 'pages')]:
        items = contract.get(key, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            matches = [r for r in valid_rules if r['target'] == target
                       and (not r.get('method') or r['method'].upper() == item.get('method', '').upper())
                       and (r.get('path') == item['path'] or
                            (r.get('prefix') and item['path'].startswith(r['prefix'])))]
            if matches:
                ranked = sorted(matches, key=lambda r: (bool(r.get('path')), len(r.get('prefix', '')), bool(r.get('method'))), reverse=True)
                best = ranked[0]
                rank = lambda r: (bool(r.get('path')), len(r.get('prefix', '')), bool(r.get('method')))
                if any(rank(r) == rank(best) and r.get('auth') != best.get('auth') for r in ranked[1:]):
                    errors.append('存在互相冲突的认证规则：' + item['path'])
                    continue
                auth = copy.deepcopy(best['auth'])
                explicit = item.get('auth') or {}
                # A shared guard describes the transport. Keep a route's explicit
                # login reference when that guard uses the same transport and has
                # not selected credentials of its own.
                if (best.get('prefix') and auth['type'] in {'header', 'bearer'}
                        and explicit.get('type') == auth['type']
                        and str(explicit.get('header', '')).lower() == str(auth.get('header', '')).lower()):
                    if not (auth.get('profile') or auth.get('env')):
                        auth.update({key: explicit[key] for key in ('profile', 'env') if explicit.get(key)})
                    if 'roles' in explicit and 'roles' not in auth:
                        auth['roles'] = explicit['roles']
                item['auth'] = {**auth, 'evidence': best['evidence']}
            auth = item.get('auth', {'type': 'unknown'})
            if auth.get('type') == 'unknown':
                evidence = item.get('evidence')
                location = evidence[0] if isinstance(evidence, list) and evidence else ''
                origin = f"。源码位置：{location}" if isinstance(location, str) and location else ""
                label = item.get('method') if target == 'api' else '页面'
                errors.append(
                    f"认证尚未分析（{key} 项，需匹配 target='{target}'）：{label or '接口'} {item['path']}{origin}。"
                    f"请读取该条目的实际登录、会话或权限代码，并在 auth_rules 中补充 target='{target}' 且 path='{item['path']}'（或覆盖它的 prefix）的规则，或直接补齐该条目的 auth 与 evidence。"
                )
    if errors:
        raise ValueError("\n".join(dict.fromkeys(errors)))
    return contract


def validate_auth_evidence(source, proposal):
    """Check citations in the exact source snapshot the proposal describes."""
    contract = proposal["contract"]
    changes = {
        delivery.relative(source, change["path"]): change["content"]
        for change in proposal.get("changes", [])
    }
    auth_rules = contract.get("auth_rules", [])
    auth_blockers = contract.get("auth_blockers", [])
    entries = [
        entry.get("evidence") if isinstance(entry, dict) else None
        for entry in [
            *(auth_rules if isinstance(auth_rules, list) else []),
            *(auth_blockers if isinstance(auth_blockers, list) else []),
        ]
    ]
    account = contract.get("admin_account")
    if account is not None:
        entries.append(account.get("evidence") if isinstance(account, dict) else None)
    # Older contracts put source citations on the route itself. When an
    # explicit authentication citation is supplied, check that citation.
    for collection in ("apis", "pages"):
        items = contract.get(collection, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            auth = item.get("auth")
            entries.append(auth.get("evidence", item.get("evidence")) if isinstance(auth, dict) else item.get("evidence"))

    errors = []
    line_counts = {}
    for citations in entries:
        if not isinstance(citations, list) or not citations:
            errors.append("认证证据必须是非空的 文件:行号 数组")
            continue
        for evidence in citations:
            match = re.fullmatch(r"(.+):(\d+)(?:-(\d+))?", evidence) if isinstance(evidence, str) else None
            if not match:
                errors.append("认证证据必须引用源码读取工具返回的 文件:行号")
                continue
            path, start, end = match.groups()
            try:
                source_path = delivery.relative(source, path)
            except ValueError as exc:
                errors.append(str(exc))
                continue
            if source_path not in line_counts:
                content = changes.get(source_path)
                if content is None:
                    if not source_path.is_file():
                        errors.append(f"认证证据位置不存在：{evidence}。找不到文件 {path}" + delivery.source_path_hint(source, path))
                        continue
                    content = delivery.text_of(source_path)
                line_counts[source_path] = len(content.splitlines()) if content is not None else 0
            count = line_counts[source_path]
            if not 1 <= int(start) <= int(end or start) <= count:
                location = "拟提交文件" if source_path in changes else "当前导入源码"
                errors.append(
                    f"认证证据位置不存在：{evidence}。{location} {path} 共 {count} 行。"
                    "请只重读该文件的登录处理、会话读取或权限检查，用实际行号修正证据后重新提交。"
                )
    if errors:
        raise ValueError("\n".join(dict.fromkeys(errors)))


def verification_credential_fields(contract):
    """Describe the credential references the verification form may accept."""
    fields = {}
    for api in contract.get("apis", []):
        auth = api.get("auth", {})
        if auth.get("type") in {"header", "bearer"} and auth.get("env"):
            fields[auth["env"]] = "session"
    for profile in [contract.get("auth_profile", {}), *contract.get("auth_profiles", {}).values()]:
        for key, kind in (("token_env", "session"), ("username_env", "username"), ("password_env", "password")):
            if profile.get(key):
                fields[profile[key]] = kind
    return [{"key": key, "kind": kind} for key, kind in fields.items()]


def validate_auth_questions(proposal):
    """Technical uncertainty is returned to the model, not turned into a user prompt."""
    errors = []
    contract = proposal.get('contract', {})
    questions = [q for q in [*proposal.get('unresolved', []), *contract.get('unresolved', [])] if isinstance(q, str) and q.strip()]
    blockers = contract.get('auth_blockers', [])
    if not isinstance(blockers, list):
        errors.append('auth_blockers 必须是数组')
        blockers = []
    valid_reasons = {'external_authorization', 'missing_credential', 'role_change'}
    for question in dict.fromkeys(questions):
        if re.search(r'令牌|token|登录|账密|凭据|授权码', question, re.I):
            q_trimmed = question.strip()
            matched = [b for b in blockers if isinstance(b, dict) and str(b.get('question', '')).strip() == q_trimmed]
            if not any(b.get('evidence') and b.get('affected') and b.get('action') and b.get('reason') in valid_reasons for b in matched):
                if matched:
                    detail = '对应的 auth_blockers 项缺少非空的 evidence/affected/action 或有效 reason（external_authorization/missing_credential/role_change）'
                elif blockers:
                    detail = 'contract.auth_blockers[].question 必须与 unresolved 中的问题文本完全一致'
                else:
                    detail = '如运行时账号/令牌可在第 3 步部署配置填写，请从 unresolved 移除；若确实阻塞改造，请在 contract.auth_blockers 中用完全相同的 question 提供 evidence/affected/action/reason'
                errors.append(f'认证提问缺少证据（unresolved 条目「{q_trimmed}」）：{detail}。')
    if errors:
        raise ValueError("\n".join(dict.fromkeys(errors)))


def validate_auth_probe_coverage(contract):
    """Exercise a protected business read when the application has one."""
    if not contract.get('auth_rules') and not contract.get('auth_profiles'):
        return  # Existing packaged skills keep their original verification contract.
    health_path = (contract.get('health') or {}).get('path')
    protected_reads = [api for api in contract.get('apis', [])
                       if api.get('auth', {}).get('type') in {'header', 'bearer'}
                       and api.get('effect') == 'read' and api.get('path') != health_path]
    operations = {case.get('operation') for case in contract.get('verification', {}).get('cases', [])
                  if case.get('json_contains')}
    if protected_reads and not any(api['id'] in operations for api in protected_reads):
        examples = '、'.join(f"{api['id']}（{api['method']} {api['path']}）" for api in protected_reads[:3])
        raise ValueError(f'请在 verification.cases 中选择一个受保护的只读业务接口，填写可核实的响应字段。可选：{examples}。')
