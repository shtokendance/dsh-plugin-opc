"""Read metadata using an explicitly referenced application connection."""
import csv
import io
import os
import re
import shutil
import subprocess
from urllib.parse import parse_qs, unquote, urlsplit

from app_delivery_config import original_value


SQL_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,62}")


def run_reader(command, env):
    tool = shutil.which(command[0])
    if not tool:
        raise ValueError(f"本机缺少 {command[0]}，请用 Platform 的专属资源读取接口或提供结构资料")
    try:
        result = subprocess.run([tool, *command[1:]], env=env, capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError("读取应用数据资源超时或连接不可用") from None
    if result.returncode or len(result.stdout) > 256_000:
        raise ValueError("读取应用数据资源失败，请核对网络、连接与账号的读取权限")
    return result.stdout


def inspect_source_connection(source, reference, table=None, schema=None, key=None):
    try:
        url = urlsplit(original_value(source, reference))
        host, port = url.hostname, url.port
        if not host or not re.fullmatch(r"[A-Za-z0-9._:-]+", host):
            raise ValueError("invalid host")
    except (TypeError, ValueError, AttributeError):
        raise ValueError("请选择指向真实连接 URL 的应用源码配置字段") from None
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("PG", "REDISCLI_")) and k not in {"LD_PRELOAD", "DYLD_INSERT_LIBRARIES"}}
    password = unquote(url.password or "")
    username = unquote(url.username or "")
    if url.scheme in {"postgres", "postgresql"}:
        name = unquote(url.path.lstrip("/"))
        if not SQL_NAME.fullmatch(name) or not username:
            raise ValueError("PostgreSQL 连接需要指定实际数据库和账号")
        env.update(PGHOST=host, PGPORT=str(port or 5432), PGDATABASE=name, PGUSER=username, PGPASSWORD=password,
                   PGSSLMODE=parse_qs(url.query).get("sslmode", ["prefer"])[0],
                   PGCONNECT_TIMEOUT="5", PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=5000")
        if table:
            schema = schema or "public"
            if not SQL_NAME.fullmatch(schema) or not SQL_NAME.fullmatch(table) or schema.startswith("pg_") or schema == "information_schema":
                raise ValueError("请选择应用的表和 schema")
            sql, kind = f'SELECT count(*) AS row_count FROM "{schema}"."{table}"', "row_count"
        else:
            kind = "columns"
            sql = ("SELECT table_schema, table_name, column_name, data_type, is_nullable "
                   "FROM information_schema.columns WHERE table_schema NOT IN ('information_schema','pg_catalog') "
                   "AND left(table_schema,3) <> 'pg_' ORDER BY table_schema, table_name, ordinal_position LIMIT 100")
        result = run_reader(["psql", "-X", "-w", "--csv", "-v", "ON_ERROR_STOP=1", "-c", sql], env)
        return {"engine": "postgresql", kind: list(csv.DictReader(io.StringIO(result)))}
    if url.scheme in {"redis", "rediss"}:
        database = url.path.lstrip("/") or "0"
        if not database.isdigit() or not isinstance(key, str) or not key or len(key) > 256 or "\0" in key:
            raise ValueError("Redis 读取需要应用实际使用的一个键")
        command = ["redis-cli", "--raw", "-h", host, "-p", str(port or 6379), "-n", database]
        if password:
            env["REDISCLI_AUTH"] = password
        if username:
            command.extend(["--user", username])
        if url.scheme == "rediss":
            command.append("--tls")
        return {"engine": "redis", "type": run_reader(command + ["TYPE", key], env).strip(),
                "ttl": run_reader(command + ["TTL", key], env).strip()}
    raise ValueError("本机连接读取支持 PostgreSQL 和 Redis；其他资源请使用 Platform 可用工具或提供资料")
