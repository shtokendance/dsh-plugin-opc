var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name2, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name: name2, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name2, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name2]() {
    return __privateGet(this, extra);
  }, set [name2](x) {
    return __privateSet(this, extra, x);
  } }, name2));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name2) : __name(target, name2);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name2, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name2 in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name2];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name2] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name2, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/index.ts
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import z2 from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import open from "open";

// src/host/auth.ts
import { createHash as createHash2, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { hostname, platform, arch } from "node:os";
import { EventEmitter } from "node:events";

// src/host/context.ts
import { createHash } from "node:crypto";
var OpcError = class extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
    this.name = "OpcError";
  }
  code;
};
function contextId(context) {
  return createHash("sha256").update(`${context.issuer}|${context.subject}|${context.tenant}|${context.generation}`).digest("hex").slice(0, 32);
}
function identityHash(context) {
  if (!context.issuer.trim() || !context.subject.trim()) throw new OpcError("INVALID_IDENTITY");
  return createHash("sha256").update(`${context.issuer.trim()}
${context.subject.trim()}`.normalize("NFC")).digest("hex");
}
var ContextStore = class {
  #context = null;
  #epoch = 0;
  #controller = new AbortController();
  #identityEpoch = 0;
  #identityController = new AbortController();
  get applicationContextId() {
    return this.#context && `${identityHash(this.#context)}:${this.#identityEpoch}`;
  }
  captureApplication(expected) {
    const context = this.current;
    if (!context) throw new OpcError("ENTERPRISE_NOT_AUTHENTICATED");
    const id = this.applicationContextId;
    if (expected && id !== expected) throw new OpcError("CONTEXT_CHANGED");
    const signal = this.#identityController.signal;
    return { context, signal, assertCurrent: () => signal.throwIfAborted() };
  }
  get current() {
    return this.#context && structuredClone(this.#context);
  }
  get epoch() {
    return this.#epoch;
  }
  replace(context) {
    if (this.#context?.issuer !== context?.issuer || this.#context?.subject !== context?.subject) {
      this.#identityController.abort(new OpcError("CONTEXT_CHANGED"));
      this.#identityController = new AbortController();
      this.#identityEpoch++;
    }
    this.#controller.abort(new OpcError("CONTEXT_CHANGED"));
    this.#controller = new AbortController();
    this.#context = context && structuredClone(context);
    this.#epoch++;
  }
  capture(expectedId) {
    const context = this.current;
    if (!context) throw new OpcError("ENTERPRISE_NOT_AUTHENTICATED");
    if (expectedId && contextId(context) !== expectedId) throw new OpcError("CONTEXT_CHANGED");
    const epoch = this.#epoch;
    return { context, epoch, signal: this.#controller.signal, assertCurrent: () => {
      if (epoch !== this.#epoch) throw new OpcError("CONTEXT_CHANGED");
    } };
  }
  switchTenant(tenant) {
    const { context } = this.capture();
    if (!context.spaces.includes(tenant)) throw new OpcError("SPACE_FORBIDDEN");
    this.replace({ ...context, tenant, generation: context.generation + 1 });
  }
};

// src/host/http.ts
function parsePlatformBaseUrl(base) {
  let url;
  try {
    url = new URL(base.trim());
  } catch {
    throw new OpcError("INVALID_PLATFORM_URL", "\u5E73\u53F0\u7F51\u5173\u5730\u5740\u683C\u5F0F\u65E0\u6548\uFF0C\u8BF7\u8F93\u5165\u5B8C\u6574\u7684 https:// \u670D\u52A1\u5730\u5740\u3002");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new OpcError("INVALID_PLATFORM_URL", "\u5E73\u53F0\u7F51\u5173\u5730\u5740\u4E0D\u80FD\u5305\u542B\u7528\u6237\u540D\u3001\u5BC6\u7801\u3001\u67E5\u8BE2\u53C2\u6570\u6216\u951A\u70B9\u3002");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) {
    throw new OpcError("INSECURE_PLATFORM_URL", "\u5E73\u53F0\u7F51\u5173\u5730\u5740\u5FC5\u987B\u4F7F\u7528 https://\uFF08\u672C\u673A\u8C03\u8BD5\u53EF\u4F7F\u7528 http://localhost \u6216 http://127.0.0.1\uFF09\u3002");
  }
  return url;
}
var PlatformHttp = class {
  constructor(base, timeoutMs = 15e3, fetcher = fetch) {
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
    this.#base = parsePlatformBaseUrl(base);
  }
  timeoutMs;
  fetcher;
  #base;
  get base() {
    return this.#base;
  }
  setBase(base) {
    this.#base = parsePlatformBaseUrl(base);
    return this.#base;
  }
  async archive(path, token, signal) {
    if (!path.startsWith("/integration/v1/resources/skills/")) throw new OpcError("INVALID_PLATFORM_PATH");
    const response = await this.fetcher(new URL(path, this.base), { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(12e4)]), headers: { Authorization: `Bearer ${token}`, Accept: "application/zip" } });
    if (response.status !== 200 || !response.body) throw new OpcError(response.status === 409 ? "SKILL_VERSION_CHANGED" : "ARCHIVE_DOWNLOAD_FAILED");
    const chunks = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (; ; ) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 256 * 1024 * 1024) throw new OpcError("SKILL_PACKAGE_UNSAFE");
        chunks.push(Buffer.from(part.value));
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return { bytes: Buffer.concat(chunks), sha256: response.headers.get("X-SHA256") };
  }
  async request(path, options = {}) {
    if (!path.startsWith("/integration/v1/")) throw new OpcError("INVALID_PLATFORM_PATH");
    const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...options.signal ? [options.signal] : []]);
    const response = await this.fetcher(new URL(path, this.base), {
      method: options.body === void 0 ? "GET" : "POST",
      redirect: "error",
      signal,
      headers: { Accept: "application/json", ...options.body !== void 0 ? { "Content-Type": "application/json" } : {}, ...options.token ? { Authorization: `Bearer ${options.token}` } : {} },
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body)
    });
    const raw = await response.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OpcError("INVALID_PLATFORM_RESPONSE");
    return { status: response.status, body: raw, headers: response.headers };
  }
};
var TokenRefresh = class {
  constructor(refresh) {
    this.refresh = refresh;
  }
  refresh;
  #pending;
  run() {
    if (!this.#pending) this.#pending = this.refresh().finally(() => {
      this.#pending = void 0;
    });
    return this.#pending;
  }
};

// src/host/auth.ts
function text(value) {
  return typeof value === "string" ? value : "";
}
var LOGIN_ERROR_MESSAGES = {
  SUBJECT_NOT_PROVISIONED: "\u5F53\u524D\u8D26\u53F7\u672A\u540C\u6B65\u5230 OPC \u5E73\u53F0\u6216\u5DF2\u88AB\u7981\u7528\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u5728\u7EDF\u4E00\u8D26\u6237\u4E2D\u5FC3\u542F\u7528\u8D26\u53F7\u5E76\u6267\u884C\u5168\u91CF\u540C\u6B65\u540E\u91CD\u8BD5\u3002",
  SUBJECT_CONFLICT: "\u5F53\u524D\u8D26\u53F7\u5B58\u5728\u8EAB\u4EFD\u7ED1\u5B9A\u51B2\u7A81\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u5728\u7EDF\u4E00\u8D26\u6237\u4E2D\u5FC3\u6838\u5BF9\u8D26\u53F7\u4FE1\u606F\u3002",
  WECOM_EXCHANGE_FAILED: "\u4F01\u4E1A\u5FAE\u4FE1\u8EAB\u4EFD\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u5982\u6301\u7EED\u5931\u8D25\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u68C0\u67E5\u4F01\u4E1A\u5FAE\u4FE1\u5E94\u7528\u914D\u7F6E\u3002",
  ACCOUNT_CENTER_UNAVAILABLE: "\u7EDF\u4E00\u8D26\u6237\u4E2D\u5FC3\u6682\u4E0D\u53EF\u7528\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\uFF1B\u5982\u6301\u7EED\u5931\u8D25\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u3002",
  AUTH_STATE_MISMATCH: "\u767B\u5F55\u4F1A\u8BDD\u5DF2\u5931\u6548\u6216\u72B6\u6001\u4E0D\u5339\u914D\uFF0C\u8BF7\u8FD4\u56DE DSH \u91CD\u65B0\u53D1\u8D77\u4F01\u4E1A\u767B\u5F55\u3002",
  AUTH_CODE_REPLAYED: "\u6388\u6743\u7801\u5DF2\u5931\u6548\u6216\u5DF2\u88AB\u4F7F\u7528\uFF0C\u8BF7\u8FD4\u56DE DSH \u91CD\u65B0\u53D1\u8D77\u4F01\u4E1A\u767B\u5F55\u3002",
  INTERNAL_ERROR: "OPC \u5E73\u53F0\u8BA4\u8BC1\u670D\u52A1\u5F02\u5E38\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u6216\u8054\u7CFB\u7BA1\u7406\u5458\u3002",
  AUTHORIZATION_DENIED: "\u4F01\u4E1A\u6388\u6743\u672A\u5B8C\u6210\u6216\u672A\u8FD4\u56DE\u6388\u6743\u7801\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  access_denied: "\u4F01\u4E1A\u6388\u6743\u5DF2\u53D6\u6D88\u6216\u672A\u901A\u8FC7\uFF0C\u8BF7\u91CD\u8BD5\u3002",
  INVALID_TOKEN_RESPONSE: "\u5E73\u53F0\u8FD4\u56DE\u7684\u767B\u5F55\u4EE4\u724C\u683C\u5F0F\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5\u6216\u8054\u7CFB\u7BA1\u7406\u5458\u3002",
  INVALID_SESSION_RESPONSE: "\u5E73\u53F0\u8FD4\u56DE\u7684\u4F1A\u8BDD\u4FE1\u606F\u65E0\u6548\uFF0C\u8BF7\u91CD\u8BD5\u6216\u8054\u7CFB\u7BA1\u7406\u5458\u3002",
  PLATFORM_REQUEST_FAILED: "\u5E73\u53F0\u767B\u5F55\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5E73\u53F0\u7F51\u5173\u914D\u7F6E\u540E\u91CD\u8BD5\u3002"
};
function normalizeCallbackErrorCode(rawError) {
  const trimmed = rawError?.trim() ?? "";
  return /^[A-Za-z0-9_.-]{1,64}$/.test(trimmed) ? trimmed : "AUTHORIZATION_DENIED";
}
function describeLoginError(code) {
  return LOGIN_ERROR_MESSAGES[code] ?? LOGIN_ERROR_MESSAGES[code.toUpperCase()] ?? (code === "LOGIN_FAILED" ? "\u4F01\u4E1A\u767B\u5F55\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002" : `\u4F01\u4E1A\u767B\u5F55\u672A\u5B8C\u6210\uFF08${code}\uFF09\uFF0C\u8BF7\u91CD\u8BD5\u3002`);
}
function check(response) {
  if (response.status >= 400) {
    const error = response.body.error;
    throw new OpcError(error?.code ?? "PLATFORM_REQUEST_FAILED");
  }
  return response.body;
}
var AuthManager = class extends EventEmitter {
  constructor(http, grants, openBrowser, clientId = "work-desktop") {
    super();
    this.http = http;
    this.grants = grants;
    this.openBrowser = openBrowser;
    this.clientId = clientId;
    this.#refreshFlight = new TokenRefresh(() => this.refresh());
  }
  http;
  grants;
  openBrowser;
  clientId;
  contexts = new ContextStore();
  #access = "";
  #refresh = "";
  #expiresAt = 0;
  #revision = 0;
  #sessionRequest = 0;
  #writes = Promise.resolve();
  #login;
  #error;
  #refreshFlight;
  device = createHash2("sha256").update(`${hostname()}:${platform()}:${arch()}`).digest("hex").slice(0, 32);
  get state() {
    return { signedIn: this.contexts.current !== null, loginInProgress: !!this.#login, loginAuthorizeUrl: this.#login?.url, loginError: this.#error, context: this.contexts.current };
  }
  changed() {
    this.emit("change", this.state);
  }
  persist(action) {
    const next = this.#writes.then(action);
    this.#writes = next.catch(() => {
    });
    return next;
  }
  sessionContext(view, old, newLogin = false) {
    const subject = text(view.subject);
    if (!subject || !Array.isArray(view.spaces) || !view.spaces.every((s) => typeof s === "string")) throw new OpcError("INVALID_SESSION_RESPONSE");
    const spaces = view.spaces;
    const tenant = old?.subject === subject && spaces.includes(old.tenant) ? old.tenant : spaces.includes(text(view.tenant)) ? text(view.tenant) : spaces[0] ?? "";
    return {
      issuer: this.http.base.origin,
      subject,
      tenant,
      spaces,
      generation: newLogin || !old ? this.contexts.epoch + 1 : old.generation + Number(old.tenant !== tenant),
      displayName: text(view.name) || old?.displayName || "",
      email: text(view.email) || old?.email || "",
      spacesDetail: spaces.map((id) => {
        const details = Array.isArray(view.spaces_detail) ? view.spaces_detail : [];
        const detail = details.find((item) => item && typeof item === "object" && item.id === id);
        return { id, name: detail && typeof detail.name === "string" ? detail.name : id };
      })
    };
  }
  async syncSession() {
    const revision = this.#revision;
    const request = ++this.#sessionRequest;
    const token = await this.token();
    const isCurrent = () => revision === this.#revision && request === this.#sessionRequest && token === this.#access;
    if (!isCurrent()) throw new OpcError("CONTEXT_CHANGED");
    const response = await this.http.request("/integration/v1/session", { token });
    if (!isCurrent()) throw new OpcError("CONTEXT_CHANGED");
    if (response.status === 401 || ["SESSION_REVOKED", "SUBJECT_NOT_PROVISIONED"].includes(text(response.body.error?.code))) {
      await this.invalidateSession();
    }
    const view = check(response);
    const current = this.contexts.current;
    if (!current || view.subject !== current.subject) throw new OpcError("INVALID_SESSION_RESPONSE");
    const updated = this.sessionContext(view, current);
    if (JSON.stringify(current) !== JSON.stringify(updated)) {
      this.contexts.replace(updated);
      this.changed();
    }
  }
  async accept(body, revision, newLogin = false) {
    if (revision !== this.#revision) throw new OpcError("CONTEXT_CHANGED");
    const access = text(body.access_token), refresh = text(body.refresh_token);
    if (!access || !refresh || typeof body.expires_in !== "number" || body.expires_in <= 0) throw new OpcError("INVALID_TOKEN_RESPONSE");
    let view = body;
    if (!text(view.subject) || !Array.isArray(view.spaces)) view = { ...body, ...check(await this.http.request("/integration/v1/session", { token: access })) };
    if (revision !== this.#revision) throw new OpcError("CONTEXT_CHANGED");
    const old = this.contexts.current;
    const context = this.sessionContext(view, old, newLogin);
    try {
      await this.persist(async () => {
        if (revision !== this.#revision) throw new OpcError("CONTEXT_CHANGED");
        await this.grants.write({ refreshToken: refresh, platformBaseUrl: this.http.base.href, lastContext: context });
      });
    } catch (error) {
      if (revision === this.#revision) await this.clear().catch(() => {
      });
      throw error;
    }
    if (revision !== this.#revision) {
      await this.persist(async () => {
        if ((await this.grants.read())?.refreshToken === refresh) await this.grants.delete();
      });
      throw new OpcError("CONTEXT_CHANGED");
    }
    this.#access = access;
    this.#refresh = refresh;
    this.#expiresAt = Date.now() + body.expires_in * 1e3;
    if (!old || JSON.stringify(old) !== JSON.stringify(context)) this.contexts.replace(context);
    this.changed();
    return access;
  }
  async restore() {
    const revision = this.#revision;
    const stored = await this.grants.read();
    if (revision !== this.#revision || !stored || stored.platformBaseUrl !== this.http.base.href) return;
    this.#refresh = stored.refreshToken;
    await this.#refreshFlight.run();
  }
  async token() {
    this.contexts.capture();
    if (Date.now() >= this.#expiresAt - 12e4) return this.#refreshFlight.run();
    return this.#access;
  }
  async refresh() {
    const revision = this.#revision;
    if (!this.#refresh) throw new OpcError("ENTERPRISE_NOT_AUTHENTICATED");
    try {
      return await this.accept(check(await this.http.request("/integration/v1/auth/refresh", { body: { refresh_token: this.#refresh, client_id: this.clientId, device: this.device } })), revision);
    } catch (error) {
      if (revision === this.#revision && error instanceof OpcError && ["REFRESH_REUSE_DETECTED", "SESSION_REVOKED", "SUBJECT_NOT_PROVISIONED"].includes(error.code)) await this.clear();
      throw error;
    }
  }
  async clear() {
    this.#revision++;
    this.cancelLogin();
    this.#access = "";
    this.#refresh = "";
    this.#expiresAt = 0;
    this.contexts.replace(null);
    this.changed();
    await this.persist(() => this.grants.delete());
  }
  async invalidateSession() {
    await this.clear();
  }
  async setPlatformBase(baseUrl) {
    const next = parsePlatformBaseUrl(baseUrl);
    if (next.href === this.http.base.href) return false;
    await this.invalidateSession();
    this.http.setBase(next.href);
    this.changed();
    return true;
  }
  async logout() {
    const refresh = this.#refresh, access = this.#access;
    await this.clear();
    if (refresh) {
      try {
        await this.http.request("/integration/v1/auth/logout", { token: access, body: { refresh_token: refresh, client_id: this.clientId } });
      } catch (error) {
        this.emit("logout-remote-failed", error instanceof OpcError ? error.code : "NETWORK_ERROR");
      }
    }
  }
  switchTenant(tenant) {
    this.contexts.switchTenant(tenant);
    this.changed();
  }
  cancelLogin() {
    const login = this.#login;
    if (!login) return;
    this.#revision++;
    this.#login = void 0;
    clearTimeout(login.timer);
    login.controller.abort();
    login.server.close();
    this.changed();
  }
  async startLogin() {
    this.cancelLogin();
    this.#revision++;
    this.#error = void 0;
    const revision = this.#revision;
    const verifier = randomBytes(48).toString("base64url"), state = randomBytes(32).toString("base64url");
    const controller = new AbortController();
    let consumed = false;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET" || url.pathname !== "/callback" || url.searchParams.get("state") !== state || consumed) {
        response.writeHead(400).end("Invalid callback");
        return;
      }
      consumed = true;
      const code = url.searchParams.get("code")?.trim();
      const callbackError = url.searchParams.get("error");
      void (async () => {
        try {
          if (callbackError !== null && callbackError.trim() !== "") {
            const errorCode = normalizeCallbackErrorCode(callbackError);
            throw new OpcError(errorCode, describeLoginError(errorCode));
          }
          if (!code) throw new OpcError("AUTHORIZATION_DENIED", describeLoginError("AUTHORIZATION_DENIED"));
          const result = check(await this.http.request("/integration/v1/auth/token", { signal: controller.signal, body: { grant_type: "authorization_code", client_id: this.clientId, code, code_verifier: verifier, device: this.device, audience: "work" } }));
          if (controller.signal.aborted) throw new OpcError("LOGIN_CANCELLED");
          await this.accept(result, revision, true);
          response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("\u767B\u5F55\u6210\u529F\uFF0C\u8BF7\u8FD4\u56DE DSH\u3002");
        } catch (error) {
          const errorCode = error instanceof OpcError ? error.code : "LOGIN_FAILED";
          const message = describeLoginError(errorCode);
          if (revision === this.#revision) this.#error = { code: errorCode, message };
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end(`\u767B\u5F55\u5931\u8D25\uFF1A${message}\uFF08${errorCode}\uFF09\u8BF7\u8FD4\u56DE DSH\u3002`);
        } finally {
          if (this.#login?.server === server) this.cancelLogin();
        }
      })();
    });
    await new Promise((resolve2, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve2);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new OpcError("CALLBACK_LISTEN_FAILED");
    }
    const timer = setTimeout(() => {
      if (this.#login?.server === server) {
        this.#error = { code: "LOGIN_TIMEOUT", message: "\u767B\u5F55\u7B49\u5F85\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5\u3002" };
        this.cancelLogin();
      }
    }, 3e5);
    timer.unref();
    this.#login = { server, controller, timer };
    this.changed();
    try {
      const result = check(await this.http.request("/integration/v1/auth/authorize", { signal: controller.signal, body: { client_id: this.clientId, redirect_uri: `http://127.0.0.1:${address.port}/callback`, state, code_challenge: createHash2("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", device: this.device } }));
      const url = new URL(text(result.authorize_url), this.http.base);
      if (url.origin !== this.http.base.origin || url.username || url.password) throw new OpcError("INVALID_AUTHORIZATION_URL");
      if (this.#login?.server !== server || revision !== this.#revision) throw new OpcError("LOGIN_CANCELLED");
      this.#login.url = url.href;
      this.changed();
      await this.openBrowser(url.href);
      return { authorizeUrl: url.href };
    } catch (error) {
      if (this.#login?.server === server) this.cancelLogin();
      throw error;
    }
  }
  async dispose() {
    this.#revision++;
    this.cancelLogin();
    this.contexts.replace(null);
    this.removeAllListeners();
  }
};

// src/host/core.ts
import { EventEmitter as EventEmitter2 } from "node:events";

// src/host/authz-cache.ts
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OpcError("INVALID_PLATFORM_RESPONSE");
  return value;
}
function resourceItem(value) {
  const item = object(value);
  if (typeof item.tenant_id !== "string" || typeof item.name !== "string" || typeof item.availability !== "string") throw new OpcError("INVALID_PLATFORM_RESPONSE");
  return {
    tenant_id: item.tenant_id,
    name: item.name,
    availability: item.availability,
    source_tenant_id: typeof item.source_tenant_id === "string" ? item.source_tenant_id : void 0,
    source_tenant_name: typeof item.source_tenant_name === "string" ? item.source_tenant_name : void 0,
    permission: typeof item.permission === "string" ? item.permission : void 0,
    catalog_id: typeof item.catalog_id === "string" ? item.catalog_id : void 0,
    knowledge_base_id: typeof item.knowledge_base_id === "string" ? item.knowledge_base_id : void 0,
    version: typeof item.version === "string" ? item.version : void 0,
    bundle_sha256: typeof item.bundle_sha256 === "string" ? item.bundle_sha256 : void 0,
    description: typeof item.description === "string" ? item.description : void 0
  };
}
var ResourceAuthorization = class {
  constructor(auth, onRevoked) {
    this.auth = auth;
    this.onRevoked = onRevoked;
  }
  auth;
  onRevoked;
  #entries = /* @__PURE__ */ new Map();
  #sessionExpires = 0;
  #epoch = -1;
  sync() {
    if (this.#epoch === this.auth.contexts.epoch) return;
    this.#entries.clear();
    this.#sessionExpires = 0;
    this.#epoch = this.auth.contexts.epoch;
  }
  async session() {
    this.sync();
    const captured = this.auth.contexts.capture();
    if (this.#sessionExpires > Date.now()) return;
    const token = await this.auth.token();
    captured.assertCurrent();
    const response = await this.auth.http.request("/integration/v1/session", { token, signal: captured.signal });
    captured.assertCurrent();
    if (response.status !== 200) {
      const code = response.body.error?.code;
      if (response.status === 401 || code === "SESSION_REVOKED") await this.auth.invalidateSession();
      throw new OpcError(code ?? "SESSION_NOT_AUTHORIZED");
    }
    if (!Array.isArray(response.body.spaces) || !response.body.spaces.includes(captured.context.tenant)) throw new OpcError("SPACE_FORBIDDEN");
    this.#sessionExpires = Date.now() + 6e4;
  }
  async knowledge(tenant, id, list) {
    this.sync();
    const captured = this.auth.contexts.capture();
    if (tenant !== captured.context.tenant) throw new OpcError("SPACE_FORBIDDEN");
    await this.session();
    captured.assertCurrent();
    const key = JSON.stringify(["knowledge", tenant, id]);
    const cached = this.#entries.get(key);
    if (cached && cached.expires > Date.now()) return cached.item;
    const items = await list();
    captured.assertCurrent();
    const item = items.find((item2) => item2.tenant_id === tenant && item2.knowledge_base_id === id && item2.availability === "available");
    if (!item) {
      this.#entries.delete(key);
      throw new OpcError("RESOURCE_NOT_ACCESSIBLE");
    }
    this.#entries.set(key, { item, expires: Date.now() + 3e4 });
    return item;
  }
  async catalog(tenant, catalog) {
    this.sync();
    const captured = this.auth.contexts.capture();
    if (tenant !== captured.context.tenant) throw new OpcError("SPACE_FORBIDDEN");
    try {
      await this.session();
    } catch (error) {
      if (error instanceof OpcError && error.code === "SPACE_FORBIDDEN") await this.onRevoked(tenant, catalog);
      throw error;
    }
    captured.assertCurrent();
    const key = JSON.stringify([tenant, catalog]);
    const cached = this.#entries.get(key);
    if (cached && cached.expires > Date.now()) return cached.item;
    const token = await this.auth.token();
    captured.assertCurrent();
    const response = await this.auth.http.request(`/integration/v1/resources/skills/${encodeURIComponent(catalog)}?tenant_id=${encodeURIComponent(tenant)}`, { token, signal: captured.signal });
    captured.assertCurrent();
    if ([403, 404].includes(response.status)) {
      await this.onRevoked(tenant, catalog);
      throw new OpcError("RESOURCE_NOT_ACCESSIBLE");
    }
    if (response.status !== 200) throw new OpcError("RESOURCE_AUTHORIZATION_FAILED");
    const item = resourceItem(response.body.item);
    if (item.tenant_id !== tenant || item.catalog_id !== catalog || item.availability !== "available") throw new OpcError("RESOURCE_NOT_ACCESSIBLE");
    this.#entries.set(key, { item, expires: Date.now() + 3e4 });
    return item;
  }
};

// src/host/installer.ts
import { createHash as createHash3, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, lstat, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fromBuffer } from "yauzl";
import { parse } from "yaml";
var idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function safeId(id) {
  if (!idPattern.test(id)) throw new OpcError("INVALID_RESOURCE_ID");
  return id;
}
function unsafe() {
  throw new OpcError("SKILL_PACKAGE_UNSAFE");
}
async function extract(bytes, root) {
  const zip = await new Promise((resolve2, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error || !value ? reject(error) : resolve2(value)));
  const names = /* @__PURE__ */ new Set(), skillPaths = [];
  let entries = 0, files = 0, total = 0;
  try {
    await new Promise((resolve2, reject) => {
      const fail = (error) => {
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("end", resolve2);
      zip.on("entry", (entry) => {
        void (async () => {
          const name2 = entry.fileName;
          const segments = name2.replace(/\/$/, "").split("/");
          const mode = entry.externalFileAttributes >>> 16 & 61440;
          if (++entries > 1e5 || name2.startsWith("/") || /[\\:\x00]/.test(name2) || segments.some((s) => s === ".." || s === "." || !s) || names.has(name2.toLowerCase()) || mode !== 0 && mode !== 32768 && mode !== 16384 || entry.generalPurposeBitFlag & 1) unsafe();
          names.add(name2.toLowerCase());
          const destination = join(root, ...segments);
          if (name2.endsWith("/")) {
            await mkdir(destination, { recursive: true });
            zip.readEntry();
            return;
          }
          if (++files > 2e4 || entry.uncompressedSize > 32 * 1024 * 1024 || total + entry.uncompressedSize > 512 * 1024 * 1024) unsafe();
          const stream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (error, value) => error || !value ? rejectStream(error) : resolveStream(value)));
          const chunks = [];
          let size = 0;
          for await (const chunk of stream) {
            const buffer = Buffer.from(chunk);
            size += buffer.length;
            total += buffer.length;
            if (size > 32 * 1024 * 1024 || total > 512 * 1024 * 1024) unsafe();
            chunks.push(buffer);
          }
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, Buffer.concat(chunks), { flag: "wx", mode: 384 });
          if (segments.at(-1) === "SKILL.md" && segments.length <= 2) skillPaths.push(segments.slice(0, -1).join("/"));
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
    if (skillPaths.length !== 1) unsafe();
    return join(root, skillPaths[0]);
  } finally {
    zip.close();
  }
}
var SkillInstaller = class {
  constructor(home) {
    this.home = home;
  }
  home;
  #locks = /* @__PURE__ */ new Map();
  root(context, catalog) {
    return join(this.home, "enterprise-skills", "catalog", identityHash(context), safeId(context.tenant), safeId(catalog));
  }
  async serialized(key, action) {
    const pending = (this.#locks.get(key) ?? Promise.resolve()).catch(() => {
    }).then(action);
    this.#locks.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.#locks.get(key) === pending) this.#locks.delete(key);
    }
  }
  async install(context, input, assertCurrent) {
    const root = this.root(context, input.catalogId);
    return this.serialized(root, async () => {
      if (!/^[a-f0-9]{64}$/.test(input.expectedSha256) || input.headerSha256 !== input.expectedSha256 || createHash3("sha256").update(input.bytes).digest("hex") !== input.expectedSha256) throw new OpcError("SKILL_HASH_MISMATCH");
      if (input.bytes.length > 256 * 1024 * 1024) unsafe();
      assertCurrent();
      await mkdir(join(root, "versions"), { recursive: true });
      const staging = join(root, `.staging-${randomUUID()}`);
      const pointer = join(root, `.active-${randomUUID()}.tmp`);
      await mkdir(staging);
      try {
        const skillRoot = await extract(input.bytes, staging).catch(() => unsafe());
        const skill = await this.parseSkill(join(skillRoot, "SKILL.md"));
        if (skill.name !== input.name) unsafe();
        assertCurrent();
        const version = join(root, "versions", input.expectedSha256);
        try {
          await rename(skillRoot, version);
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes(error.code ?? "")) throw error;
          if (!(await lstat(version)).isDirectory()) unsafe();
        }
        const record2 = { tenant_id: context.tenant, catalog_id: input.catalogId, name: input.name, version: input.version, active_sha256: input.expectedSha256, enabled: true, identity_hash: identityHash(context), installed_at: Math.floor(Date.now() / 1e3) };
        await writeFile(pointer, JSON.stringify(record2), { flag: "wx", mode: 384 });
        assertCurrent();
        await rename(pointer, join(root, "active.json"));
        return record2;
      } finally {
        await rm(staging, { recursive: true, force: true });
        await rm(pointer, { force: true });
      }
    });
  }
  async parseSkill(path) {
    const raw = await readFile(path, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
    if (!match) unsafe();
    const metadata = parse(match[1], { maxAliasCount: 20 });
    if (!metadata || typeof metadata.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || typeof metadata.description !== "string") unsafe();
    return { name: metadata.name, description: metadata.description, content: match[2] };
  }
  async list(context) {
    const root = dirname(this.root(context, "placeholder"));
    let names;
    try {
      names = await readdir(root);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const records = [];
    for (const name2 of names) {
      if (!idPattern.test(name2)) continue;
      try {
        const record2 = JSON.parse(await readFile(join(root, name2, "active.json"), "utf8"));
        if (record2.catalog_id !== name2 || record2.tenant_id !== context.tenant || record2.identity_hash !== identityHash(context) || !/^[a-f0-9]{64}$/.test(record2.active_sha256) || typeof record2.enabled !== "boolean") unsafe();
        records.push(record2);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return records;
  }
  async remove(context, catalog) {
    const root = this.root(context, catalog);
    await this.serialized(root, () => rm(root, { recursive: true, force: true }));
  }
  async setEnabled(context, catalog, enabled, assertCurrent) {
    const root = this.root(context, catalog);
    await this.serialized(root, async () => {
      const record2 = (await this.list(context)).find((r) => r.catalog_id === catalog);
      if (!record2) throw new OpcError("SKILL_NOT_INSTALLED");
      const temp = join(root, `.active-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify({ ...record2, enabled }), { flag: "wx", mode: 384 });
        assertCurrent();
        await rename(temp, join(root, "active.json"));
      } finally {
        await rm(temp, { force: true });
      }
    });
  }
  skillPath(context, record2) {
    if (!/^[a-f0-9]{64}$/.test(record2.active_sha256)) unsafe();
    return join(this.root(context, record2.catalog_id), "versions", record2.active_sha256, "SKILL.md");
  }
};

// src/host/knowledge-scope.ts
var KnowledgeScopes = class {
  constructor(contexts) {
    this.contexts = contexts;
  }
  contexts;
  #pins = /* @__PURE__ */ new Map();
  #turns = /* @__PURE__ */ new Map();
  pin(session, scope) {
    if (!scope) {
      this.#pins.delete(session);
      return;
    }
    const snapshot = this.contexts.capture(scope.contextId);
    if (scope.tenantId !== snapshot.context.tenant) throw new OpcError("SCOPE_MISMATCH");
    this.#pins.set(session, { ...scope, epoch: snapshot.epoch });
  }
  pins() {
    return Object.fromEntries([...this.#pins].filter(([, scope]) => scope.epoch === this.contexts.epoch).map(([session, scope]) => [session, scope.knowledgeBaseId]));
  }
  begin(session, turn, prompt = "") {
    let scope = this.#pins.get(session);
    const refs = new Set(Array.from(prompt.matchAll(/\[OPC 知识库\]\(opc-kb:([^)]+)\)/g), (match) => match[1]));
    if (refs.size > 1) throw new OpcError("MULTIPLE_KNOWLEDGE_BASES", "\u6BCF\u8F6E\u63D0\u95EE\u8BF7\u9009\u62E9\u4E00\u4E2A\u77E5\u8BC6\u5E93");
    for (const ref of refs) {
      const match = /^([a-f0-9]{32})\/([^/]+)$/.exec(ref);
      if (!match) throw new OpcError("INVALID_KNOWLEDGE_REFERENCE");
      const snapshot = this.contexts.capture(match[1]);
      scope = { tenantId: snapshot.context.tenant, knowledgeBaseId: decodeURIComponent(match[2]), epoch: snapshot.epoch };
    }
    if (!scope || scope.epoch !== this.contexts.epoch) {
      this.#turns.get(session)?.delete(turn);
      return;
    }
    const turns = this.#turns.get(session) ?? /* @__PURE__ */ new Map();
    turns.set(turn, { ...scope, hits: /* @__PURE__ */ new Set() });
    this.#turns.set(session, turns);
  }
  scope(session, turn) {
    this.contexts.capture();
    const scope = this.#turns.get(session)?.get(turn);
    if (scope && scope.epoch !== this.contexts.epoch) throw new OpcError("CONTEXT_CHANGED");
    return scope;
  }
  searchParams(session, turn, space, knowledgeBaseId) {
    const scope = this.scope(session, turn);
    if (scope && (space && space !== scope.tenantId || knowledgeBaseId && knowledgeBaseId !== scope.knowledgeBaseId)) throw new OpcError("SCOPE_MISMATCH");
    return { tenant_id: scope?.tenantId ?? space ?? this.contexts.capture().context.tenant, knowledge_base_id: scope?.knowledgeBaseId ?? knowledgeBaseId };
  }
  recordHits(session, turn, ids) {
    const scope = this.scope(session, turn);
    for (const id of ids) scope?.hits.add(id);
  }
  assertReadable(session, turn, id) {
    const scope = this.scope(session, turn);
    if (scope && !scope.hits.has(id)) throw new OpcError("SCOPE_MISMATCH");
  }
  verifyDocument(session, turn, tenant, knowledgeBaseId) {
    const scope = this.scope(session, turn);
    if (scope && (scope.tenantId !== tenant || scope.knowledgeBaseId !== knowledgeBaseId)) throw new OpcError("SCOPE_MISMATCH");
  }
  end(session, turn) {
    this.#turns.get(session)?.delete(turn);
  }
  clear() {
    this.#pins.clear();
    this.#turns.clear();
  }
};

// src/host/mcp.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function checked(response) {
  if (response.status >= 400) throw new OpcError(String(record(response.body.error).code ?? "MCP_REQUEST_FAILED"));
  return response.body;
}
function invocation(body) {
  const data = record(body.data);
  return record(data.invocation).invocation_id ? record(data.invocation) : data.invocation_id ? data : record(body.approval).invocation_id ? record(body.approval) : body;
}
var McpBridge = class {
  constructor(auth, options = { pollMs: 1e3, timeoutMs: 12e4 }) {
    this.auth = auth;
    this.options = options;
  }
  auth;
  options;
  async invoke(input, approve, signal) {
    const captured = this.auth.contexts.capture(input.contextId);
    const combined = AbortSignal.any([captured.signal, AbortSignal.timeout(this.options.timeoutMs), ...signal ? [signal] : []]);
    const tenant = encodeURIComponent(captured.context.tenant);
    let submitted = false;
    const request = async (path, body) => {
      combined.throwIfAborted();
      captured.assertCurrent();
      const token = await this.auth.token();
      captured.assertCurrent();
      combined.throwIfAborted();
      return this.auth.http.request(path, { body, token, signal: combined });
    };
    try {
      const args = structuredClone(input.arguments ?? {});
      submitted = true;
      const response = await request("/integration/v1/mcp/invoke", { service_id: input.serviceId, tool_name: input.toolName, arguments: args, tenant_id: captured.context.tenant, idempotency_key: randomUUID2() });
      captured.assertCurrent();
      const body = checked(response);
      let current = invocation(body);
      const id = current.invocation_id;
      const approvalRequired = body.code === "MCP_APPROVAL_REQUIRED" || record(body.error).code === "MCP_APPROVAL_REQUIRED" || current.status === "waiting_approval";
      if (approvalRequired) {
        if (typeof id !== "string") throw new OpcError("INVALID_APPROVAL_RESPONSE");
        const path = `/integration/v1/mcp/invocations/${encodeURIComponent(id)}`;
        if (!current.args_digest || !current.policy_version) current = invocation(checked(await request(`${path}?tenant=${tenant}`)));
        if (typeof current.args_digest !== "string" || typeof current.policy_version !== "string") throw new OpcError("INVALID_APPROVAL_RESPONSE");
        const outcome = await Promise.race([
          approve({ serviceId: input.serviceId, toolName: input.toolName, arguments: args, invocationId: id, signal: combined }),
          new Promise((_, reject) => {
            if (combined.aborted) reject(combined.reason);
            else combined.addEventListener("abort", () => reject(combined.reason), { once: true });
          })
        ]);
        captured.assertCurrent();
        combined.throwIfAborted();
        if (outcome !== "allowed-once" && outcome !== "rejected") throw new OpcError("INVOCATION_UNKNOWN_OUTCOME");
        const decided = checked(await request(`${path}/decision?tenant=${tenant}`, { decision: outcome === "allowed-once" ? "approve" : "deny", args_digest: current.args_digest, policy_version: current.policy_version }));
        captured.assertCurrent();
        if (outcome === "rejected") throw new OpcError("MCP_INVOCATION_DENIED");
        current = invocation(decided);
      }
      if (typeof id !== "string") {
        if (response.status !== 200) throw new OpcError("INVOCATION_UNKNOWN_OUTCOME");
        return body.result ?? body.data ?? body;
      }
      for (; ; ) {
        captured.assertCurrent();
        combined.throwIfAborted();
        switch (current.status) {
          case "succeeded":
            return current.result;
          case "failed":
            throw new OpcError("MCP_INVOCATION_FAILED");
          case "cancelled":
            throw new OpcError("MCP_INVOCATION_CANCELLED");
          case "denied":
            throw new OpcError("MCP_INVOCATION_DENIED");
          case "unknown_outcome":
            throw new OpcError("INVOCATION_UNKNOWN_OUTCOME");
          case "waiting_oauth":
            throw new OpcError("MCP_OAUTH_REQUIRED");
        }
        await delay(this.options.pollMs, void 0, { signal: combined });
        current = invocation(checked(await request(`/integration/v1/mcp/invocations/${encodeURIComponent(id)}?tenant=${tenant}`)));
      }
    } catch (error) {
      if (submitted && (combined.aborted || !(error instanceof OpcError))) throw new OpcError("INVOCATION_UNKNOWN_OUTCOME");
      throw error;
    }
  }
};

// src/host/core.ts
var OpcCore = class extends EventEmitter2 {
  constructor(auth, home) {
    super();
    this.auth = auth;
    this.installer = new SkillInstaller(home);
    this.authz = new ResourceAuthorization(auth, async (tenant, catalog) => {
      const { context } = auth.contexts.capture();
      if (context.tenant !== tenant) throw new OpcError("CONTEXT_CHANGED");
      await this.installer.remove(context, catalog);
      this.emit("skills-changed");
    });
    this.scopes = new KnowledgeScopes(auth.contexts);
    this.mcp = new McpBridge(auth);
    let epoch = auth.contexts.epoch;
    auth.on("change", () => {
      if (epoch !== auth.contexts.epoch) {
        epoch = auth.contexts.epoch;
        this.scopes.clear();
        this.emit("skills-changed");
      }
      this.emit("change");
    });
  }
  auth;
  installer;
  authz;
  scopes;
  mcp;
  async request(path, body) {
    const captured = this.auth.contexts.capture();
    const token = await this.auth.token();
    captured.assertCurrent();
    const response = await this.auth.http.request(path, { body, token, signal: captured.signal });
    captured.assertCurrent();
    if (response.status >= 400) {
      const error = response.body.error;
      throw new OpcError(error?.code ?? "PLATFORM_REQUEST_FAILED");
    }
    return response.body;
  }
  async catalog(kind, q = "") {
    return (await this.resourceDirectory(kind, q)).items;
  }
  async knowledgeDirectory(q = "") {
    return this.resourceDirectory("knowledge-bases", q);
  }
  async resourceDirectory(kind, q) {
    const captured = this.auth.contexts.capture();
    const items = [];
    const sharedQuery = kind === "knowledge-bases" ? "&include_shared=true" : "";
    let offset = 0, complete = true, includesShared = kind === "knowledge-bases";
    for (; ; ) {
      const page = await this.request(`/integration/v1/resources/${kind}?tenant_id=${encodeURIComponent(captured.context.tenant)}&q=${encodeURIComponent(q)}&offset=${offset}&limit=100${sharedQuery}`);
      captured.assertCurrent();
      if (!Array.isArray(page.items) || typeof page.total !== "number") throw new OpcError("INVALID_PLATFORM_RESPONSE");
      complete &&= page.complete === true && (!Array.isArray(page.failures) || page.failures.length === 0);
      includesShared &&= page.includes_shared === true;
      const current = page.items.map(resourceItem);
      if (current.some((item) => item.tenant_id !== captured.context.tenant)) throw new OpcError("SCOPE_MISMATCH");
      items.push(...current);
      offset += current.length;
      if (offset >= page.total || current.length === 0) {
        if (kind === "skills" && !q && complete && offset >= page.total) {
          for (const record2 of await this.installer.list(captured.context)) {
            captured.assertCurrent();
            if (!items.some((item) => item.catalog_id === record2.catalog_id)) await this.installer.remove(captured.context, record2.catalog_id);
          }
          this.emit("skills-changed");
        }
        if (kind === "knowledge-bases" && !complete) throw new OpcError("RESOURCE_DIRECTORY_INCOMPLETE", "\u77E5\u8BC6\u5E93\u76EE\u5F55\u52A0\u8F7D\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u5237\u65B0\u91CD\u8BD5\u3002");
        return { items, includesShared };
      }
    }
  }
  async install(input) {
    const captured = this.auth.contexts.capture(input.contextId);
    const item = await this.authz.catalog(captured.context.tenant, input.catalogId);
    captured.assertCurrent();
    if (item.bundle_sha256 !== input.expectedSha256) throw new OpcError("SKILL_VERSION_CHANGED");
    const token = await this.auth.token();
    captured.assertCurrent();
    const archive = await this.auth.http.archive(`/integration/v1/resources/skills/${encodeURIComponent(input.catalogId)}/archive?tenant_id=${encodeURIComponent(captured.context.tenant)}&expected_sha256=${encodeURIComponent(input.expectedSha256)}`, token, captured.signal);
    captured.assertCurrent();
    await this.installer.install(captured.context, { ...input, name: item.name, version: item.version ?? "", headerSha256: archive.sha256, bytes: archive.bytes }, captured.assertCurrent);
    this.emit("skills-changed");
  }
  async search(session, turn, query, space, knowledgeBaseId) {
    const captured = this.auth.contexts.capture();
    const scope = this.scopes.searchParams(session, turn, space, knowledgeBaseId);
    if (scope.tenant_id !== captured.context.tenant) throw new OpcError("SPACE_FORBIDDEN");
    const scopedItem = scope.knowledge_base_id ? await this.authz.knowledge(captured.context.tenant, scope.knowledge_base_id, () => this.catalog("knowledge-bases")) : void 0;
    captured.assertCurrent();
    const result = await this.request("/integration/v1/knowledge/search", { query, ...scope, include_shared: true });
    captured.assertCurrent();
    if (!Array.isArray(result.results)) throw new OpcError("INVALID_PLATFORM_RESPONSE");
    const ids = result.results.map((hit) => {
      if (!hit || typeof hit !== "object" || typeof hit.knowledge_id !== "string") throw new OpcError("INVALID_PLATFORM_RESPONSE");
      if ((hit.tenant_id ?? hit.source_tenant) !== scope.tenant_id || scopedItem && (hit.knowledge_base_id !== scopedItem.knowledge_base_id || (hit.source_tenant ?? hit.tenant_id) !== (scopedItem.source_tenant_id ?? scopedItem.tenant_id))) throw new OpcError("SCOPE_MISMATCH");
      return hit.knowledge_id;
    });
    this.scopes.recordHits(session, turn, ids);
    return result;
  }
  async read(session, turn, knowledgeId) {
    const captured = this.auth.contexts.capture();
    this.scopes.assertReadable(session, turn, knowledgeId);
    const scope = this.scopes.scope(session, turn);
    await this.authz.session();
    captured.assertCurrent();
    const scopedItem = scope ? await this.authz.knowledge(captured.context.tenant, scope.knowledgeBaseId, () => this.catalog("knowledge-bases")) : void 0;
    captured.assertCurrent();
    const result = await this.request(`/integration/v1/knowledge/${encodeURIComponent(knowledgeId)}?include_content=true&include_shared=true&tenant=${encodeURIComponent(captured.context.tenant)}${scope ? `&knowledge_base_id=${encodeURIComponent(scope.knowledgeBaseId)}` : ""}`);
    captured.assertCurrent();
    const data = result.data;
    const tenant = result.tenant_id ?? result.source_tenant;
    if (tenant !== captured.context.tenant || !data?.knowledge_base_id) throw new OpcError("SCOPE_MISMATCH");
    this.scopes.verifyDocument(session, turn, tenant, data.knowledge_base_id);
    const item = scopedItem ?? await this.authz.knowledge(tenant, data.knowledge_base_id, () => this.catalog("knowledge-bases"));
    if (result.source_tenant !== (item.source_tenant_id ?? item.tenant_id)) throw new OpcError("SCOPE_MISMATCH");
    captured.assertCurrent();
    if (typeof data?.content !== "string") throw new OpcError("KNOWLEDGE_CONTENT_UNAVAILABLE", "\u5E73\u53F0\u672A\u8FD4\u56DE\u6587\u6863\u6B63\u6587\uFF0C\u9700\u8981\u542F\u7528\u6B63\u6587\u8BFB\u53D6\u63A5\u53E3\u3002");
    return result;
  }
};

// src/host/skill-provider.ts
import { dirname as dirname2 } from "node:path";
var EnterpriseSkillProvider = class {
  constructor(core, control) {
    this.core = core;
    this.control = control;
    const invalidate = () => control.invalidate();
    core.on("skills-changed", invalidate);
    control.signal.addEventListener("abort", () => core.off("skills-changed", invalidate), { once: true });
  }
  core;
  control;
  name = "opc-enterprise";
  async list(options) {
    if (!this.core.auth.contexts.current) return [];
    const captured = this.core.auth.contexts.capture();
    await this.core.authz.session();
    captured.assertCurrent();
    const result = [];
    for (const record2 of await this.core.installer.list(captured.context)) {
      options.signal?.throwIfAborted();
      captured.assertCurrent();
      if (!record2.enabled) continue;
      const path = this.core.installer.skillPath(captured.context, record2);
      const skill = await this.core.installer.parseSkill(path);
      result.push({
        name: skill.name,
        description: `[OPC${record2.version ? ` \xB7 ${record2.version}` : ""}] ${skill.description}`,
        path,
        invocation: { modelInvocable: true, userInvocable: true },
        source: "opc-enterprise",
        provider: this.name,
        rank: 350,
        resourceBase: { kind: "directory", path: dirname2(path) },
        locator: { tenant: record2.tenant_id, catalog: record2.catalog_id, sha256: record2.active_sha256, identity: identityHash(captured.context), epoch: captured.epoch }
      });
    }
    captured.assertCurrent();
    return result;
  }
  async get(candidate, options) {
    if (!this.core.auth.contexts.current) return void 0;
    const captured = this.core.auth.contexts.capture();
    const locator = candidate.locator;
    if (locator.epoch !== captured.epoch || locator.tenant !== captured.context.tenant || locator.identity !== identityHash(captured.context)) return void 0;
    await this.core.authz.catalog(locator.tenant, locator.catalog);
    captured.assertCurrent();
    const active = (await this.core.installer.list(captured.context)).find((record2) => record2.catalog_id === locator.catalog && record2.enabled && record2.active_sha256 === locator.sha256);
    if (!active) {
      this.control.invalidate();
      return void 0;
    }
    options.signal?.throwIfAborted();
    const skill = await this.core.installer.parseSkill(this.core.installer.skillPath(captured.context, active));
    captured.assertCurrent();
    return { ...candidate, content: skill.content };
  }
};

// src/host/mcp-mount.ts
import { createServer as createServer2 } from "node:http";
import { createHash as createHash4, randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
function mcpMountName(id) {
  return `opc-${createHash4("sha256").update(id).digest("hex").slice(0, 16)}`;
}
var ManagedMcpMounts = class {
  constructor(core, register, approve, options = {}) {
    this.core = core;
    this.register = register;
    this.approve = approve;
    this.autoMountEnabled = options.autoMount ?? false;
    this.#lastEpoch = core.auth.contexts.epoch;
    core.auth.on("change", this.changed);
    if (this.autoMountEnabled && core.auth.contexts.current) {
      void this.autoMount();
    }
  }
  core;
  register;
  approve;
  #mounts = /* @__PURE__ */ new Map();
  #unmountedByUser = /* @__PURE__ */ new Set();
  #lastEpoch;
  autoMountEnabled;
  changed = () => {
    const currentEpoch = this.core.auth.contexts.epoch;
    for (const [id, mount] of this.#mounts) {
      if (mount.epoch !== currentEpoch) this.unmount(id);
    }
    if (this.#lastEpoch !== currentEpoch) {
      this.#lastEpoch = currentEpoch;
      this.#unmountedByUser.clear();
      if (this.autoMountEnabled && this.core.auth.contexts.current) {
        void this.autoMount();
      }
    }
  };
  list() {
    return [...this.#mounts.keys()];
  }
  unmount(id) {
    const mount = this.#mounts.get(id);
    if (!mount) return;
    this.#mounts.delete(id);
    mount.dispose();
    mount.server.closeAllConnections();
    mount.server.close();
    this.core.emit("change");
  }
  unmountByUser(id) {
    this.#unmountedByUser.add(id);
    this.unmount(id);
  }
  clearUnmountedByUser(id) {
    this.#unmountedByUser.delete(id);
  }
  async mount(serviceId, expectedContextId) {
    this.#unmountedByUser.delete(serviceId);
    const captured = this.core.auth.contexts.capture(expectedContextId);
    if (this.#mounts.has(serviceId)) return;
    const body = await this.core.request(`/integration/v1/mcp/services?include_schema=true&tenant=${encodeURIComponent(captured.context.tenant)}`);
    captured.assertCurrent();
    const data = body.data;
    const service = data?.services?.find((item) => item.service_id === serviceId);
    if (!service || !Array.isArray(service.tools)) throw new OpcError("RESOURCE_NOT_ACCESSIBLE");
    await this.mountSingleService(service, captured);
  }
  async mountSingleService(service, captured) {
    const serviceId = String(service.service_id);
    if (this.#mounts.has(serviceId)) return;
    const tools = service.tools.map((item) => {
      if (typeof item === "string") return { name: item, inputSchema: { type: "object", additionalProperties: true } };
      if (!item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string") throw new OpcError("INVALID_TOOL_CATALOG");
      const tool = item;
      return { name: item.name, description: typeof tool.description === "string" ? tool.description : "", inputSchema: tool.input_schema ?? tool.inputSchema ?? { type: "object", additionalProperties: true } };
    });
    const secret = randomBytes2(32).toString("hex");
    const expected = Buffer.from(`Bearer ${secret}`);
    const expectedContextId = contextId(captured.context);
    const server = createServer2((request, response) => {
      const auth = Buffer.from(request.headers.authorization ?? "");
      if (request.headers.origin || auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
        response.writeHead(401).end();
        return;
      }
      if (request.method !== "POST" || request.url !== "/mcp") {
        response.writeHead(405, { Allow: "POST" }).end();
        return;
      }
      const controller = new AbortController();
      response.on("close", () => {
        if (!response.writableFinished) controller.abort();
      });
      void (async () => {
        let rpc = {};
        try {
          captured.assertCurrent();
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 1024 * 1024) throw new OpcError("REQUEST_TOO_LARGE");
            chunks.push(Buffer.from(chunk));
          }
          rpc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") throw new OpcError("INVALID_REQUEST");
          if (rpc.id === void 0) {
            response.writeHead(202).end();
            return;
          }
          let result;
          const params = rpc.params;
          switch (rpc.method) {
            case "initialize":
              result = { protocolVersion: params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: `opc-${serviceId}`, version: "0.1.0" } };
              break;
            case "ping":
              result = {};
              break;
            case "tools/list":
              result = { tools };
              break;
            case "tools/call": {
              if (!params || typeof params.name !== "string" || !tools.some((tool) => tool.name === params.name)) throw new OpcError("UNKNOWN_TOOL");
              const args = params.arguments ?? {};
              if (!args || typeof args !== "object" || Array.isArray(args)) throw new OpcError("INVALID_ARGUMENTS");
              const output = await this.core.mcp.invoke({ serviceId, toolName: params.name, arguments: args, contextId: expectedContextId }, this.approve, controller.signal);
              result = output && typeof output === "object" && "content" in output && Array.isArray(output.content) ? output : { content: [{ type: "text", text: JSON.stringify(output ?? null) }] };
              break;
            }
            default:
              throw new OpcError("METHOD_NOT_FOUND");
          }
          captured.assertCurrent();
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
        } catch (error) {
          response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32e3, message: error instanceof OpcError ? error.code : "MCP_REQUEST_FAILED" } }));
        }
      })();
    });
    await new Promise((resolve2, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve2);
    });
    try {
      captured.assertCurrent();
      const address = server.address();
      if (!address || typeof address === "string") throw new OpcError("MCP_LISTEN_FAILED");
      if (this.#mounts.has(serviceId)) {
        server.close();
        return;
      }
      const dispose = this.register(mcpMountName(serviceId), { toolCallTimeoutMs: 125e3, transport: "streamable-http", url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: `Bearer ${secret}` } });
      this.#mounts.set(serviceId, { server, dispose, epoch: captured.epoch });
      this.core.emit("change");
    } catch (error) {
      server.close();
      throw error;
    }
  }
  async autoMount() {
    try {
      if (!this.core.auth.contexts.current) return;
      const captured = this.core.auth.contexts.capture();
      const body = await this.core.request(`/integration/v1/mcp/services?include_schema=true&tenant=${encodeURIComponent(captured.context.tenant)}`);
      captured.assertCurrent();
      const data = body.data;
      if (!Array.isArray(data?.services)) return;
      for (const service of data.services) {
        if (!service || typeof service !== "object" || !service.service_id) continue;
        const serviceId = String(service.service_id);
        if (this.#unmountedByUser.has(serviceId) || this.#mounts.has(serviceId)) continue;
        if (Array.isArray(service.tools) && service.tools.length > 0) {
          await this.mountSingleService(service, captured).catch(() => {
          });
        }
      }
    } catch {
    }
  }
  dispose() {
    this.core.auth.off("change", this.changed);
    for (const id of this.list()) this.unmount(id);
  }
};

// src/host/remote-service.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

// src/host/opc-config.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir as mkdir2, rename as rename2, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2 } from "node:path";
var DEFAULT_PLATFORM_BASE = "https://aiwork.benlai.com";
var DEFAULT_APP_DOMAIN_ROOT = "ai.benlai.com";
var DEFAULT_APP_DEFAULT_PORT = 8080;
function normalizePlatformBaseUrl(raw) {
  const input = typeof raw === "string" ? raw.trim() : "";
  if (!input) throw new Error("\u5E73\u53F0\u7F51\u5173\u5730\u5740\u4E0D\u80FD\u4E3A\u7A7A");
  return parsePlatformBaseUrl(input).href.replace(/\/+$/, "");
}
function sanitizeDomainRoot(raw) {
  const trimmed = String(raw ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
  if (trimmed && /[\s/?#]/.test(trimmed)) {
    throw new Error("\u5E94\u7528\u5185\u7F51\u6839\u57DF\u540D\u540E\u7F00\u683C\u5F0F\u65E0\u6548\uFF0C\u8BF7\u586B\u5199\u5982 ai.benlai.com");
  }
  return trimmed;
}
function validateAppDefaultPort(raw) {
  const num = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  if (!Number.isInteger(num) || num < 1 || num > 65535) {
    throw new Error("\u5E94\u7528\u9ED8\u8BA4\u5BB9\u5668\u7AEF\u53E3\u5FC5\u987B\u4E3A 1 \u81F3 65535 \u7684\u6574\u6570");
  }
  return num;
}
var OpcConfigStore = class {
  constructor(home, initial = {}, fetcher = fetch) {
    this.home = home;
    this.fetcher = fetcher;
    this.filePath = join2(this.home, "opc", "platform-config.json");
    let platformBase = DEFAULT_PLATFORM_BASE;
    try {
      if (initial.platformBaseUrl?.trim()) platformBase = normalizePlatformBaseUrl(initial.platformBaseUrl);
    } catch {
      platformBase = DEFAULT_PLATFORM_BASE;
    }
    let domainRoot = "";
    try {
      if (initial.appDomainRoot?.trim()) domainRoot = sanitizeDomainRoot(initial.appDomainRoot);
    } catch {
      domainRoot = "";
    }
    let defaultPort = DEFAULT_APP_DEFAULT_PORT;
    try {
      if (initial.appDefaultPort !== void 0) defaultPort = validateAppDefaultPort(initial.appDefaultPort);
    } catch {
      defaultPort = DEFAULT_APP_DEFAULT_PORT;
    }
    this.#fallback = {
      platform_base: platformBase,
      app_domain_root: domainRoot,
      app_default_port: defaultPort
    };
    this.#current = { ...this.#fallback };
  }
  home;
  fetcher;
  filePath;
  #fallback;
  #current;
  loadSync() {
    if (!existsSync(this.filePath)) {
      this.#current = { ...this.#fallback };
      return this.current;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      let platform_base = this.#fallback.platform_base;
      try {
        if (typeof parsed.platform_base === "string" && parsed.platform_base.trim()) {
          platform_base = normalizePlatformBaseUrl(parsed.platform_base);
        }
      } catch {
      }
      let app_domain_root = this.#fallback.app_domain_root;
      try {
        if (typeof parsed.app_domain_root === "string") {
          app_domain_root = sanitizeDomainRoot(parsed.app_domain_root);
        }
      } catch {
      }
      let app_default_port = this.#fallback.app_default_port;
      try {
        if (parsed.app_default_port !== void 0) {
          app_default_port = validateAppDefaultPort(parsed.app_default_port);
        }
      } catch {
      }
      this.#current = { platform_base, app_domain_root, app_default_port };
    } catch {
      this.#current = { ...this.#fallback };
    }
    return this.current;
  }
  get current() {
    return { ...this.#current };
  }
  getPayload(livePlatformBase) {
    const platform_base = livePlatformBase?.trim() ? livePlatformBase.replace(/\/+$/, "") : this.#current.platform_base;
    return {
      platform_base,
      app_domain_root: this.#current.app_domain_root,
      app_default_port: this.#current.app_default_port,
      default_platform_base: DEFAULT_PLATFORM_BASE,
      default_app_domain_root: DEFAULT_APP_DOMAIN_ROOT,
      default_app_default_port: DEFAULT_APP_DEFAULT_PORT,
      effective_app_domain_root: this.#current.app_domain_root || DEFAULT_APP_DOMAIN_ROOT
    };
  }
  async persist(value) {
    const dir = join2(this.home, "opc");
    await mkdir2(dir, { recursive: true, mode: 448 });
    const temp = join2(dir, `platform-config-${randomUUID3()}.tmp`);
    await writeFile2(temp, `${JSON.stringify(value, null, 2)}
`, { mode: 384 });
    await rename2(temp, this.filePath);
  }
  async update(patch) {
    const prevBase = this.#current.platform_base;
    const nextBase = patch.platform_base !== void 0 ? normalizePlatformBaseUrl(patch.platform_base) : this.#current.platform_base;
    const nextDomainRoot = patch.app_domain_root !== void 0 ? sanitizeDomainRoot(patch.app_domain_root) : this.#current.app_domain_root;
    const nextDefaultPort = patch.app_default_port !== void 0 ? validateAppDefaultPort(patch.app_default_port) : this.#current.app_default_port;
    const next = {
      platform_base: nextBase,
      app_domain_root: nextDomainRoot,
      app_default_port: nextDefaultPort
    };
    await this.persist(next);
    this.#current = next;
    return {
      config: this.getPayload(),
      platform_base_changed: nextBase !== prevBase
    };
  }
  async reset() {
    return this.update({
      platform_base: DEFAULT_PLATFORM_BASE,
      app_domain_root: "",
      app_default_port: DEFAULT_APP_DEFAULT_PORT
    });
  }
  async testConnection(rawUrl) {
    let url;
    try {
      url = parsePlatformBaseUrl(String(rawUrl ?? ""));
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "\u670D\u52A1\u5730\u5740\u65E0\u6548"
      };
    }
    const started = performance.now();
    try {
      const response = await this.fetcher(url.href, {
        method: "GET",
        signal: AbortSignal.timeout(5e3),
        redirect: "manual"
      });
      const latency_ms = Math.max(0, Math.round(performance.now() - started));
      if (response.status < 500) {
        return { ok: true, status_code: response.status, latency_ms };
      }
      return {
        ok: false,
        status_code: response.status,
        latency_ms,
        error: `HTTP ${response.status}`
      };
    } catch (error) {
      const latency_ms = Math.max(0, Math.round(performance.now() - started));
      return {
        ok: false,
        latency_ms,
        error: error instanceof Error ? error.message : "\u65E0\u6CD5\u8FDE\u63A5\u5230\u670D\u52A1\u5668"
      };
    }
  }
};

// src/host/remote-service.ts
var execFileAsync = promisify(execFile);
var WIN32_FOLDER_PICKER_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$owner = New-Object System.Windows.Forms.Form",
  "$owner.TopMost = $true",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = '\u9009\u62E9\u5E94\u7528\u6E90\u7801\u76EE\u5F55'",
  "$dialog.ShowNewFolderButton = $false",
  "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  "$owner.Dispose()",
  "$dialog.Dispose()"
].join("; ");
async function pickSourceFolder(platform2 = process.platform, exec = execFileAsync) {
  if (platform2 === "darwin") {
    try {
      const { stdout } = await exec(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "\u9009\u62E9\u5E94\u7528\u6E90\u7801\u76EE\u5F55")'],
        { timeout: 12e4 }
      );
      const path = stdout.trim().replace(/\/+$/, "") || "/";
      return { path };
    } catch {
      return { cancelled: true };
    }
  }
  if (platform2 === "win32") {
    try {
      const { stdout } = await exec(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-STA", "-Command", WIN32_FOLDER_PICKER_SCRIPT],
        { timeout: 12e4, windowsHide: true }
      );
      const path = stdout.trim();
      return path ? { path } : { cancelled: true };
    } catch (error) {
      if (error?.code === "ENOENT") return { cancelled: true, unsupported: true };
      return { cancelled: true };
    }
  }
  return { cancelled: true, unsupported: true };
}
var _decideDebugInvocation_dec, _unmountMcpService_dec, _mountMcpService_dec, _invokeMcpTool_dec, _listMcpServices_dec, _readKnowledgeDocument_dec, _searchKnowledge_dec, _setPinnedKnowledgeScope_dec, _uninstallSkill_dec, _setSkillEnabled_dec, _installSkill_dec, _listSkillsCatalog_dec, _listKnowledgeBases_dec, _switchTenant_dec, _syncSession_dec, _logout_dec, _cancelLogin_dec, _startLogin_dec, _watchState_dec, _state_dec, _opcConfigTest_dec, _opcConfigReset_dec, _opcConfigUpdate_dec, _opcConfigGet_dec, _appRollback_dec, _appDelete_dec, _appUpdateConfig_dec, _appRecheck_dec, _appSaveDownload_dec, _appDownload_dec, _appStorage_dec, _appLogs_dec, _appVersions_dec, _appDetails_dec, _appResources_dec, _appSetSkillEnabled_dec, _appVerifyWithOptions_dec, _appVerify_dec, _appPublish_dec, _appConfirmDeployment_dec, _appSkillPreview_dec, _appHandoff_dec, _appSaveLocalArtifact_dec, _appLocalArtifact_dec, _appSaveConfigDraft_dec, _appConfigDraft_dec, _appCancelAnalysis_dec, _appReopenDeployment_dec, _appReopenReview_dec, _appPrepare_dec, _appAnalyzeWithMode_dec, _appAnalyze_dec, _appCreate_dec, _appCatalog_dec, _appModels_dec, _appPickSourceFolder_dec, _appOpcConfig_dec, _appCheckSlug_dec, _appJobByAnalysisSession_dec, _appJob_dec, _appList_dec, _a, _init;
var OpcRemoteService = class extends (_a = TypertRemoteService, _appList_dec = [Remote], _appJob_dec = [Remote], _appJobByAnalysisSession_dec = [Remote], _appCheckSlug_dec = [Remote], _appOpcConfig_dec = [Remote], _appPickSourceFolder_dec = [Remote], _appModels_dec = [Remote], _appCatalog_dec = [Remote], _appCreate_dec = [Remote], _appAnalyze_dec = [Remote], _appAnalyzeWithMode_dec = [Remote], _appPrepare_dec = [Remote], _appReopenReview_dec = [Remote], _appReopenDeployment_dec = [Remote], _appCancelAnalysis_dec = [Remote], _appConfigDraft_dec = [Remote], _appSaveConfigDraft_dec = [Remote], _appLocalArtifact_dec = [Remote], _appSaveLocalArtifact_dec = [Remote], _appHandoff_dec = [Remote], _appSkillPreview_dec = [Remote], _appConfirmDeployment_dec = [Remote], _appPublish_dec = [Remote], _appVerify_dec = [Remote], _appVerifyWithOptions_dec = [Remote], _appSetSkillEnabled_dec = [Remote], _appResources_dec = [Remote], _appDetails_dec = [Remote], _appVersions_dec = [Remote], _appLogs_dec = [Remote], _appStorage_dec = [Remote], _appDownload_dec = [Remote], _appSaveDownload_dec = [Remote], _appRecheck_dec = [Remote], _appUpdateConfig_dec = [Remote], _appDelete_dec = [Remote], _appRollback_dec = [Remote], _opcConfigGet_dec = [Remote], _opcConfigUpdate_dec = [Remote], _opcConfigReset_dec = [Remote], _opcConfigTest_dec = [Remote], _state_dec = [Remote], _watchState_dec = [Remote({ mode: "stream" })], _startLogin_dec = [Remote], _cancelLogin_dec = [Remote], _logout_dec = [Remote], _syncSession_dec = [Remote], _switchTenant_dec = [Remote], _listKnowledgeBases_dec = [Remote], _listSkillsCatalog_dec = [Remote], _installSkill_dec = [Remote], _setSkillEnabled_dec = [Remote], _uninstallSkill_dec = [Remote], _setPinnedKnowledgeScope_dec = [Remote], _searchKnowledge_dec = [Remote], _readKnowledgeDocument_dec = [Remote], _listMcpServices_dec = [Remote], _invokeMcpTool_dec = [Remote], _mountMcpService_dec = [Remote], _unmountMcpService_dec = [Remote], _decideDebugInvocation_dec = [Remote], _a) {
  constructor(ctx, options) {
    super(ctx, "opc");
    __runInitializers(_init, 5, this);
    __publicField(this, "pendingApprovals", /* @__PURE__ */ new Map());
    __publicField(this, "mounts");
    __publicField(this, "manager");
    __publicField(this, "core");
    __publicField(this, "delivery");
    __publicField(this, "configStore");
    __publicField(this, "host");
    __publicField(this, "requestApproval", async () => {
      return "allowed-once";
    });
    const { core, delivery, configStore } = options;
    this.host = ctx;
    this.core = core;
    this.delivery = delivery;
    this.configStore = configStore ?? new OpcConfigStore(delivery.home, {
      platformBaseUrl: core.auth.http.base.href,
      ...delivery.getOptions()
    });
    ctx.inject(["mcpManager"], (child) => {
      const manager = child.mcpManager;
      const mounts = new ManagedMcpMounts(core, (name2, entry) => manager.register(name2, entry), this.requestApproval, { autoMount: true });
      this.manager = manager;
      this.mounts = mounts;
      core.emit("change");
      child.on("mcp-manager/status", () => {
        core.emit("change");
      });
      child.effect(() => () => {
        this.manager = void 0;
        this.mounts = void 0;
        mounts.dispose();
        core.emit("change");
      });
    });
  }
  async appList(expectedContextId) {
    return JSON.stringify(await this.delivery.list(expectedContextId));
  }
  async appJob(id, expectedContextId) {
    return JSON.stringify(await this.delivery.getJob(id, expectedContextId));
  }
  async appJobByAnalysisSession(sessionId, expectedContextId) {
    return JSON.stringify(await this.delivery.getJobByAnalysisSession(sessionId, expectedContextId));
  }
  async appCheckSlug(slug, expectedContextId) {
    return JSON.stringify(await this.delivery.checkSlug(slug, expectedContextId));
  }
  async appOpcConfig(expectedContextId) {
    return JSON.stringify(await this.delivery.opcConfig(expectedContextId));
  }
  async appPickSourceFolder(expectedContextId) {
    this.core.auth.contexts.captureApplication(expectedContextId);
    return JSON.stringify(await pickSourceFolder());
  }
  async appModels(expectedContextId) {
    const scope = this.core.auth.contexts.captureApplication(expectedContextId);
    const groups = await Promise.all(this.host.llm.listProviders().map(async (provider) => {
      const models = await this.host.llm.listModels(provider.id).catch(() => []);
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await this.host.llm.resolveModelInfo(provider.id, model.id, scope.signal).catch(() => void 0);
        return { id: model.id, name: model.name, reasoning: resolved?.reasoning };
      }));
      return { id: provider.id, name: provider.name, models: entries };
    }));
    scope.assertCurrent();
    return JSON.stringify(groups.filter((group) => group.models.length));
  }
  async appCatalog(expectedContextId) {
    return JSON.stringify(await this.delivery.platform("/", expectedContextId));
  }
  async appCreate(inputJson, sessionId, expectedContextId) {
    return JSON.stringify(await this.delivery.create(JSON.parse(inputJson), sessionId, expectedContextId));
  }
  async appAnalyze(id, feedback, sessionId, expectedContextId) {
    return JSON.stringify(await this.delivery.startAnalysis(id, feedback, expectedContextId, sessionId));
  }
  async appAnalyzeWithMode(id, feedback, sessionId, mode, expectedContextId) {
    const parsedMode = mode === "resume" ? "resume" : mode === "repair" ? "repair" : "analysis";
    return JSON.stringify(await this.delivery.startAnalysis(id, feedback, expectedContextId, sessionId, { mode: parsedMode }));
  }
  async appPrepare(id, proposalHash, expectedContextId) {
    return JSON.stringify(await this.delivery.prepare(id, proposalHash, expectedContextId));
  }
  async appReopenReview(id, expectedContextId) {
    return JSON.stringify(await this.delivery.reopenReview(id, expectedContextId));
  }
  async appReopenDeployment(id, expectedContextId) {
    return JSON.stringify(await this.delivery.reopenDeployment(id, expectedContextId));
  }
  async appCancelAnalysis(id, expectedContextId) {
    await this.delivery.cancelAnalysis(id, expectedContextId);
  }
  async appConfigDraft(id, expectedContextId) {
    return JSON.stringify(await this.delivery.configDraft(id, expectedContextId));
  }
  async appSaveConfigDraft(id, body, expectedContextId) {
    await this.delivery.saveConfigDraft(id, JSON.parse(body), expectedContextId);
  }
  async appLocalArtifact(id, filename, expectedContextId) {
    return JSON.stringify(await this.delivery.localArtifact(id, filename, expectedContextId));
  }
  async appSaveLocalArtifact(id, filename, expectedContextId) {
    return JSON.stringify(await this.delivery.saveLocalArtifact(id, filename, expectedContextId));
  }
  async appHandoff(id, expectedContextId) {
    return JSON.stringify(await this.delivery.handoff(id, expectedContextId));
  }
  async appSkillPreview(id, expectedContextId) {
    return JSON.stringify(await this.delivery.skillPreview(id, expectedContextId));
  }
  async appConfirmDeployment(id, inputJson, expectedContextId) {
    return JSON.stringify(await this.delivery.confirmDeployment(id, JSON.parse(inputJson), expectedContextId));
  }
  async appPublish(id, confirmationJson, expectedContextId) {
    return JSON.stringify(await this.delivery.publish(id, JSON.parse(confirmationJson), expectedContextId));
  }
  async appVerify(id, expectedContextId) {
    return JSON.stringify(await this.delivery.verify(id, expectedContextId));
  }
  async appVerifyWithOptions(id, optionsJson, expectedContextId) {
    return JSON.stringify(await this.delivery.verify(id, expectedContextId, optionsJson ? JSON.parse(optionsJson) : void 0));
  }
  async appSetSkillEnabled(id, enabled, expectedContextId) {
    await this.delivery.setSkillEnabled(id, enabled, expectedContextId);
  }
  async appResources(expectedContextId) {
    return JSON.stringify(await this.delivery.platform("/resources", expectedContextId));
  }
  async appDetails(slug, expectedContextId) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new OpcError("INVALID_APP_SLUG");
    const detail = await this.delivery.platform("/" + slug, expectedContextId);
    return JSON.stringify({
      id: detail.id,
      name: detail.name,
      slug: detail.slug ?? slug,
      description: detail.description ?? "",
      language: detail.language,
      runtime_version: detail.runtime_version,
      dockerfile_content: detail.dockerfile_content,
      app_url: detail.app_url,
      container_port: detail.container_port,
      status: detail.status,
      current_version: detail.current_version,
      app_config: detail.app_config ?? [],
      resource_ids: detail.resource_ids ?? [],
      storage_mounts: detail.storage_mounts ?? [],
      config_fingerprint: detail.config_fingerprint,
      skill_name: detail.skill_name,
      catalog_skill_id: detail.catalog_skill_id,
      skill_synced: detail.skill_synced,
      build_log: detail.build_log,
      error_message: detail.error_message,
      created_by: detail.created_by,
      created_at: detail.created_at,
      updated_at: detail.updated_at,
      can_manage: detail.can_manage
    });
  }
  async appVersions(slug, expectedContextId) {
    return JSON.stringify(await this.delivery.versions(slug, expectedContextId));
  }
  async appLogs(slug, expectedContextId) {
    return JSON.stringify(await this.delivery.logs(slug, expectedContextId));
  }
  async appStorage(slug, expectedContextId) {
    return JSON.stringify(await this.delivery.storage(slug, expectedContextId));
  }
  async appDownload(slug, selectionJson, expectedContextId) {
    return JSON.stringify(await this.delivery.download(slug, JSON.parse(selectionJson), expectedContextId));
  }
  async appSaveDownload(slug, selectionJson, expectedContextId) {
    return JSON.stringify(await this.delivery.saveDownload(slug, JSON.parse(selectionJson), expectedContextId));
  }
  async appRecheck(slug, expectedContextId) {
    return JSON.stringify(await this.delivery.recheck(slug, expectedContextId));
  }
  async appUpdateConfig(slug, bodyJson, expectedContextId) {
    return JSON.stringify(await this.delivery.updateConfig(slug, JSON.parse(bodyJson), expectedContextId));
  }
  async appDelete(slug, purgeVolumes, expectedContextId) {
    return JSON.stringify(await this.delivery.deleteApp(slug, purgeVolumes, expectedContextId));
  }
  async appRollback(slug, payloadJson, expectedContextId) {
    const parsed = JSON.parse(payloadJson);
    return JSON.stringify(await this.delivery.rollback(slug, Number(parsed.targetVersion ?? parsed.target_version ?? 0), String(parsed.reason ?? ""), expectedContextId));
  }
  async applyConfigChange(result) {
    const { config, platform_base_changed } = result;
    await this.core.auth.setPlatformBase(config.platform_base);
    this.delivery.updateOptions({
      appDomainRoot: config.app_domain_root,
      appDefaultPort: config.app_default_port
    });
    if (platform_base_changed) this.core.emit("skills-changed");
    return JSON.stringify({ ...config, platform_base_changed });
  }
  async opcConfigGet() {
    return JSON.stringify(this.configStore.getPayload(this.core.auth.http.base.href));
  }
  async opcConfigUpdate(payloadJson) {
    const parsed = JSON.parse(payloadJson);
    return this.applyConfigChange(await this.configStore.update({
      platform_base: parsed.platform_base,
      app_domain_root: parsed.app_domain_root,
      app_default_port: parsed.app_default_port
    }));
  }
  async opcConfigReset() {
    return this.applyConfigChange(await this.configStore.reset());
  }
  async opcConfigTest(url) {
    return JSON.stringify(await this.configStore.testConnection(url));
  }
  async state() {
    const state = this.core.auth.state;
    const mounted = this.mounts?.list() ?? [];
    const cfg = this.configStore.getPayload(this.core.auth.http.base.href);
    return JSON.stringify({ ...state, knowledgeMentionScopeVersion: 1, mountAvailable: !!this.mounts, mcpConnections: Object.fromEntries(mounted.map((id) => {
      const status = this.manager?.list().find((item) => item.name === mcpMountName(id))?.status;
      return [id, { state: status?.state ?? "connecting", toolCount: status?.state === "connected" ? status.toolCount : 0 }];
    })), pinnedScopes: this.core.scopes.pins(), mountedServices: mounted, approvals: [...this.pendingApprovals].map(([id, pending]) => ({ id, contextId: pending.contextId, ...pending.prompt })), opcConfig: { platformBaseUrl: cfg.platform_base, appDomainRoot: cfg.effective_app_domain_root, rawAppDomainRoot: cfg.app_domain_root, defaultPort: cfg.app_default_port }, context: state.context ? { ...state.context, contextId: contextId(state.context), applicationContextId: this.core.auth.contexts.applicationContextId, epoch: this.core.auth.contexts.epoch } : null });
  }
  async *watchState(signal) {
    let wake, dirty = true;
    const changed = () => {
      dirty = true;
      wake?.();
    };
    this.core.on("change", changed);
    signal.addEventListener("abort", changed);
    try {
      while (!signal.aborted) {
        if (dirty) {
          dirty = false;
          yield await this.state();
        }
        if (!dirty && !signal.aborted) await new Promise((resolve2) => {
          wake = resolve2;
        });
      }
    } finally {
      this.core.off("change", changed);
      signal.removeEventListener("abort", changed);
    }
  }
  async startLogin() {
    return JSON.stringify(await this.core.auth.startLogin());
  }
  async cancelLogin() {
    this.core.auth.cancelLogin();
  }
  async logout() {
    await this.core.auth.logout();
  }
  async syncSession() {
    await this.core.auth.syncSession();
  }
  async switchTenant(tenantId) {
    this.core.auth.switchTenant(tenantId);
  }
  async listKnowledgeBases(q) {
    return JSON.stringify(await this.core.knowledgeDirectory(q));
  }
  async listSkillsCatalog(q) {
    const captured = this.core.auth.contexts.capture();
    const items = await this.core.catalog("skills", q);
    const installed = await this.core.installer.list(captured.context);
    captured.assertCurrent();
    return JSON.stringify(items.map((item) => ({ ...item, installed: installed.find((record2) => record2.catalog_id === item.catalog_id) ?? null })));
  }
  async installSkill(catalogId, expectedSha256, expectedContextId) {
    await this.core.install({ catalogId, expectedSha256, contextId: expectedContextId });
  }
  async setSkillEnabled(catalogId, enabled, expectedContextId) {
    const captured = this.core.auth.contexts.capture(expectedContextId);
    if (enabled) await this.core.authz.catalog(captured.context.tenant, catalogId);
    captured.assertCurrent();
    await this.core.installer.setEnabled(captured.context, catalogId, enabled, captured.assertCurrent);
    this.core.emit("skills-changed");
  }
  async uninstallSkill(catalogId, expectedContextId) {
    const captured = this.core.auth.contexts.capture(expectedContextId);
    await this.core.installer.remove(captured.context, catalogId);
    this.core.emit("skills-changed");
  }
  async setPinnedKnowledgeScope(sessionId, knowledgeBaseId, expectedContextId) {
    const captured = this.core.auth.contexts.capture(expectedContextId);
    if (knowledgeBaseId) {
      const available = await this.core.catalog("knowledge-bases");
      captured.assertCurrent();
      if (!available.some((item) => item.knowledge_base_id === knowledgeBaseId && item.availability === "available")) throw new OpcError("RESOURCE_NOT_ACCESSIBLE");
    }
    this.core.scopes.pin(sessionId, knowledgeBaseId ? { tenantId: captured.context.tenant, knowledgeBaseId, contextId: expectedContextId } : null);
    this.core.emit("change");
  }
  async searchKnowledge(sessionId, query, knowledgeBaseId, expectedContextId) {
    const captured = this.core.auth.contexts.capture(expectedContextId);
    const session = `preview:${sessionId}`;
    this.core.scopes.pin(session, knowledgeBaseId ? { tenantId: captured.context.tenant, knowledgeBaseId, contextId: expectedContextId } : null);
    this.core.scopes.begin(session, "preview");
    return JSON.stringify(await this.core.search(session, "preview", query, void 0, knowledgeBaseId || void 0));
  }
  async readKnowledgeDocument(sessionId, knowledgeId, expectedContextId) {
    this.core.auth.contexts.capture(expectedContextId);
    return JSON.stringify(await this.core.read(`preview:${sessionId}`, "preview", knowledgeId));
  }
  async listMcpServices() {
    const { context } = this.core.auth.contexts.capture();
    return JSON.stringify(await this.core.request(`/integration/v1/mcp/services?include_schema=true&tenant=${encodeURIComponent(context.tenant)}`));
  }
  async invokeMcpTool(serviceId, toolName, argumentsJson, expectedContextId) {
    this.core.auth.contexts.capture(expectedContextId);
    const args = JSON.parse(argumentsJson);
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new OpcError("INVALID_ARGUMENTS");
    const result = await this.core.mcp.invoke({ serviceId, toolName, arguments: args, contextId: expectedContextId }, this.requestApproval);
    return JSON.stringify(result ?? null);
  }
  async mountMcpService(serviceId, expectedContextId) {
    if (!this.mounts) throw new OpcError("MCP_MOUNT_UNAVAILABLE");
    await this.mounts.mount(serviceId, expectedContextId);
  }
  async unmountMcpService(serviceId, expectedContextId) {
    this.core.auth.contexts.capture(expectedContextId);
    this.mounts?.unmountByUser(serviceId);
  }
  async decideDebugInvocation(id, allowed, expectedContextId) {
    this.core.auth.contexts.capture(expectedContextId);
    const pending = this.pendingApprovals.get(id);
    if (!pending || pending.contextId !== expectedContextId) throw new OpcError("CONTEXT_CHANGED");
    pending.resolve(allowed ? "allowed-once" : "rejected");
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "appList", _appList_dec, OpcRemoteService);
__decorateElement(_init, 1, "appJob", _appJob_dec, OpcRemoteService);
__decorateElement(_init, 1, "appJobByAnalysisSession", _appJobByAnalysisSession_dec, OpcRemoteService);
__decorateElement(_init, 1, "appCheckSlug", _appCheckSlug_dec, OpcRemoteService);
__decorateElement(_init, 1, "appOpcConfig", _appOpcConfig_dec, OpcRemoteService);
__decorateElement(_init, 1, "appPickSourceFolder", _appPickSourceFolder_dec, OpcRemoteService);
__decorateElement(_init, 1, "appModels", _appModels_dec, OpcRemoteService);
__decorateElement(_init, 1, "appCatalog", _appCatalog_dec, OpcRemoteService);
__decorateElement(_init, 1, "appCreate", _appCreate_dec, OpcRemoteService);
__decorateElement(_init, 1, "appAnalyze", _appAnalyze_dec, OpcRemoteService);
__decorateElement(_init, 1, "appAnalyzeWithMode", _appAnalyzeWithMode_dec, OpcRemoteService);
__decorateElement(_init, 1, "appPrepare", _appPrepare_dec, OpcRemoteService);
__decorateElement(_init, 1, "appReopenReview", _appReopenReview_dec, OpcRemoteService);
__decorateElement(_init, 1, "appReopenDeployment", _appReopenDeployment_dec, OpcRemoteService);
__decorateElement(_init, 1, "appCancelAnalysis", _appCancelAnalysis_dec, OpcRemoteService);
__decorateElement(_init, 1, "appConfigDraft", _appConfigDraft_dec, OpcRemoteService);
__decorateElement(_init, 1, "appSaveConfigDraft", _appSaveConfigDraft_dec, OpcRemoteService);
__decorateElement(_init, 1, "appLocalArtifact", _appLocalArtifact_dec, OpcRemoteService);
__decorateElement(_init, 1, "appSaveLocalArtifact", _appSaveLocalArtifact_dec, OpcRemoteService);
__decorateElement(_init, 1, "appHandoff", _appHandoff_dec, OpcRemoteService);
__decorateElement(_init, 1, "appSkillPreview", _appSkillPreview_dec, OpcRemoteService);
__decorateElement(_init, 1, "appConfirmDeployment", _appConfirmDeployment_dec, OpcRemoteService);
__decorateElement(_init, 1, "appPublish", _appPublish_dec, OpcRemoteService);
__decorateElement(_init, 1, "appVerify", _appVerify_dec, OpcRemoteService);
__decorateElement(_init, 1, "appVerifyWithOptions", _appVerifyWithOptions_dec, OpcRemoteService);
__decorateElement(_init, 1, "appSetSkillEnabled", _appSetSkillEnabled_dec, OpcRemoteService);
__decorateElement(_init, 1, "appResources", _appResources_dec, OpcRemoteService);
__decorateElement(_init, 1, "appDetails", _appDetails_dec, OpcRemoteService);
__decorateElement(_init, 1, "appVersions", _appVersions_dec, OpcRemoteService);
__decorateElement(_init, 1, "appLogs", _appLogs_dec, OpcRemoteService);
__decorateElement(_init, 1, "appStorage", _appStorage_dec, OpcRemoteService);
__decorateElement(_init, 1, "appDownload", _appDownload_dec, OpcRemoteService);
__decorateElement(_init, 1, "appSaveDownload", _appSaveDownload_dec, OpcRemoteService);
__decorateElement(_init, 1, "appRecheck", _appRecheck_dec, OpcRemoteService);
__decorateElement(_init, 1, "appUpdateConfig", _appUpdateConfig_dec, OpcRemoteService);
__decorateElement(_init, 1, "appDelete", _appDelete_dec, OpcRemoteService);
__decorateElement(_init, 1, "appRollback", _appRollback_dec, OpcRemoteService);
__decorateElement(_init, 1, "opcConfigGet", _opcConfigGet_dec, OpcRemoteService);
__decorateElement(_init, 1, "opcConfigUpdate", _opcConfigUpdate_dec, OpcRemoteService);
__decorateElement(_init, 1, "opcConfigReset", _opcConfigReset_dec, OpcRemoteService);
__decorateElement(_init, 1, "opcConfigTest", _opcConfigTest_dec, OpcRemoteService);
__decorateElement(_init, 1, "state", _state_dec, OpcRemoteService);
__decorateElement(_init, 1, "watchState", _watchState_dec, OpcRemoteService);
__decorateElement(_init, 1, "startLogin", _startLogin_dec, OpcRemoteService);
__decorateElement(_init, 1, "cancelLogin", _cancelLogin_dec, OpcRemoteService);
__decorateElement(_init, 1, "logout", _logout_dec, OpcRemoteService);
__decorateElement(_init, 1, "syncSession", _syncSession_dec, OpcRemoteService);
__decorateElement(_init, 1, "switchTenant", _switchTenant_dec, OpcRemoteService);
__decorateElement(_init, 1, "listKnowledgeBases", _listKnowledgeBases_dec, OpcRemoteService);
__decorateElement(_init, 1, "listSkillsCatalog", _listSkillsCatalog_dec, OpcRemoteService);
__decorateElement(_init, 1, "installSkill", _installSkill_dec, OpcRemoteService);
__decorateElement(_init, 1, "setSkillEnabled", _setSkillEnabled_dec, OpcRemoteService);
__decorateElement(_init, 1, "uninstallSkill", _uninstallSkill_dec, OpcRemoteService);
__decorateElement(_init, 1, "setPinnedKnowledgeScope", _setPinnedKnowledgeScope_dec, OpcRemoteService);
__decorateElement(_init, 1, "searchKnowledge", _searchKnowledge_dec, OpcRemoteService);
__decorateElement(_init, 1, "readKnowledgeDocument", _readKnowledgeDocument_dec, OpcRemoteService);
__decorateElement(_init, 1, "listMcpServices", _listMcpServices_dec, OpcRemoteService);
__decorateElement(_init, 1, "invokeMcpTool", _invokeMcpTool_dec, OpcRemoteService);
__decorateElement(_init, 1, "mountMcpService", _mountMcpService_dec, OpcRemoteService);
__decorateElement(_init, 1, "unmountMcpService", _unmountMcpService_dec, OpcRemoteService);
__decorateElement(_init, 1, "decideDebugInvocation", _decideDebugInvocation_dec, OpcRemoteService);
__decoratorMetadata(_init, OpcRemoteService);

// src/host/tools.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
function registerTools(ctx, core) {
  const turns = /* @__PURE__ */ new Map();
  const scope = (exec) => {
    if (!exec.agent) throw new OpcError("AGENT_REQUIRED");
    const session = String(exec.agent.session.id);
    const boundary = ctx.agents.turnBoundaryOf(exec.agent.session);
    if (boundary.openTurnStartSeq === null) throw new OpcError("TURN_REQUIRED");
    const turn = String(boundary.openTurnStartSeq);
    const old = turns.get(session);
    if (old?.turn !== turn || old.epoch !== core.auth.contexts.epoch) {
      if (old) core.scopes.end(session, old.turn);
      const messages = exec.agent.session.snapshotEvents().slice(boundary.openTurnStartSeq);
      const prompt = messages.flatMap((event) => event.type === "user/message" && event.data.source.kind === "user" ? event.data.content.flatMap((part) => part.type === "text" ? [part.text] : []) : []).join("\n");
      core.scopes.begin(session, turn, prompt);
      turns.set(session, { turn, epoch: core.auth.contexts.epoch });
    }
    return { session, turn };
  };
  const output = { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] };
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "opc_knowledge_search",
    description: "\u68C0\u7D22\u5F53\u524D\u4F01\u4E1A\u7A7A\u95F4\u77E5\u8BC6\u5E93\uFF1B\u9047\u5230 OPC \u77E5\u8BC6\u5E93\u5F15\u7528\u65F6\u53EA\u4F20 query\uFF0C\u5BBF\u4E3B\u4ECE\u672C\u8F6E\u5F15\u7528\u786E\u5B9A\u7A7A\u95F4\u548C\u77E5\u8BC6\u5E93\uFF1B\u518D\u7528 opc_knowledge_read \u8BFB\u53D6\u547D\u4E2D\u6B63\u6587\u5E76\u6CE8\u660E\u6587\u6863\u540D\u3002",
    parameters: { query: { type: "string", required: true }, space: { type: "string" }, knowledge_base_id: { type: "string" } },
    output,
    async execute(args, exec) {
      const s = scope(exec);
      return JSON.stringify(await core.search(s.session, s.turn, args.query, args.space, args.knowledge_base_id));
    }
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "opc_knowledge_read",
    description: "\u8BFB\u53D6\u4F01\u4E1A\u77E5\u8BC6\u6587\u6863\uFF1B\u9650\u5B9A\u6A21\u5F0F\u4E0B\u53EA\u80FD\u8BFB\u53D6\u672C\u8F6E\u68C0\u7D22\u547D\u4E2D\u7684\u6587\u6863\u3002",
    parameters: { knowledge_id: { type: "string", required: true } },
    output,
    async execute(args, exec) {
      const s = scope(exec);
      return JSON.stringify(await core.read(s.session, s.turn, args.knowledge_id));
    }
  })));
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "opc_mcp_invoke",
    description: "\u8C03\u7528\u5F53\u524D\u7A7A\u95F4\u4F01\u4E1A MCP \u5DE5\u5177\u3002\u9AD8\u654F\u64CD\u4F5C\u9700\u7528\u6237\u5BA1\u6279\uFF1BUNKNOWN_OUTCOME \u65F6\u7981\u6B62\u81EA\u52A8\u91CD\u8BD5\u3002",
    parameters: { service_id: { type: "string", required: true }, tool_name: { type: "string", required: true }, arguments: { type: "object", additionalProperties: true } },
    output,
    async execute(args, exec) {
      const agent = exec.agent;
      if (!agent) throw new OpcError("AGENT_REQUIRED");
      return JSON.stringify(await core.mcp.invoke({ serviceId: args.service_id, toolName: args.tool_name, arguments: args.arguments }, async () => "allowed-once", exec.signal));
    }
  })));
}

// src/host/app-delivery.ts
import { createWriteStream, existsSync as existsSync3 } from "node:fs";
import { spawn as spawn2 } from "node:child_process";
import { createHash as createHash5, randomUUID as randomUUID4 } from "node:crypto";
import { copyFile, link, lstat as lstat2, mkdir as mkdir3, readFile as readFile2, readdir as readdir2, stat, writeFile as writeFile3, rename as rename3, rm as rm2 } from "node:fs/promises";
import { dirname as dirname3, isAbsolute, join as join3, resolve } from "node:path";
import { homedir as homedir2 } from "node:os";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay2 } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// src/host/python-runtime.ts
import { execFile as execFile2, spawn } from "node:child_process";
import { existsSync as existsSync2, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { promisify as promisify2 } from "node:util";
var execFileAsync2 = promisify2(execFile2);
var PROBE_SCRIPT = 'import json, sys; print(json.dumps({"v": list(sys.version_info[:2]), "exe": sys.executable}))';
var MIN_PYTHON_MAJOR = 3;
var MIN_PYTHON_MINOR = 9;
var WINDOWS_APPS_SEGMENT = /[\\/]Microsoft[\\/]WindowsApps(?:[\\/]|$)/i;
var WINDOWS_SAFE_ENV_KEYS = /* @__PURE__ */ new Set([
  "systemroot",
  "windir",
  "systemdrive",
  "userprofile",
  "homedrive",
  "homepath",
  "localappdata",
  "appdata",
  "programdata",
  "temp",
  "tmp",
  "comspec",
  "pathext"
]);
function workerEnv(platform2 = process.platform, sourceEnv = process.env) {
  const env = { LANG: "en_US.UTF-8" };
  const pathValue = sourceEnv.PATH ?? sourceEnv.Path;
  if (pathValue !== void 0) env.PATH = pathValue;
  if (sourceEnv.HOME !== void 0) env.HOME = sourceEnv.HOME;
  if (platform2 === "win32") {
    const seen = /* @__PURE__ */ new Set(["lang", "path", "home"]);
    for (const [key, value] of Object.entries(sourceEnv)) {
      if (value === void 0) continue;
      const lower = key.toLowerCase();
      if (!WINDOWS_SAFE_ENV_KEYS.has(lower) || seen.has(lower)) continue;
      seen.add(lower);
      env[key] = value;
    }
  }
  return env;
}
function isSupportedVersion(version) {
  return Array.isArray(version) && version.length >= 2 && typeof version[0] === "number" && typeof version[1] === "number" && (version[0] > MIN_PYTHON_MAJOR || version[0] === MIN_PYTHON_MAJOR && version[1] >= MIN_PYTHON_MINOR);
}
function safeReadDir(readDir, dir) {
  try {
    return readDir(dir);
  } catch {
    return [];
  }
}
function versionSortKey(name2) {
  const dotted = name2.match(/(\d+)\.(\d+)/);
  if (dotted) {
    const base = Number.parseInt(dotted[1], 10) * 1e3 + Number.parseInt(dotted[2], 10);
    return base * 2 + (/-32$/i.test(name2) ? 0 : 1);
  }
  const compact = name2.match(/python(\d)(\d+)/i);
  if (compact) {
    const base = Number.parseInt(compact[1], 10) * 1e3 + Number.parseInt(compact[2], 10);
    return base * 2 + (/-32$/i.test(name2) ? 0 : 1);
  }
  return 0;
}
function isWindowsAppsPath(pathValue) {
  return WINDOWS_APPS_SEGMENT.test(pathValue);
}
function candidateKey(candidate, platform2) {
  const pathApi = platform2 === "win32" ? win32 : posix;
  const normalizedCmd = pathApi.isAbsolute(candidate.command) ? pathApi.normalize(candidate.command) : candidate.command;
  const cmdKey = platform2 === "win32" ? normalizedCmd.toLowerCase() : normalizedCmd;
  return `${cmdKey}\0${candidate.prefixArgs.join("\0")}`;
}
function bundledPythonCandidates(options = {}) {
  const platform2 = options.platform ?? process.platform;
  const pathApi = platform2 === "win32" ? win32 : posix;
  const execPath = options.execPath ?? process.execPath;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const exists = options.exists ?? existsSync2;
  const executable = pathApi.dirname(execPath);
  const dshHome = env.DSH_HOME?.trim() || pathApi.join(homeDir, ".dsh");
  const runtimeDirs = [
    env.DSH_PRIMARY_RUNTIME_DIR?.trim(),
    env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR?.trim()
  ].filter((value) => Boolean(value));
  const relExecutables = platform2 === "win32" ? ["dependencies/python/python.exe"] : ["dependencies/python/bin/python3", "dependencies/python/bin/python"];
  const paths = [];
  for (const dir of runtimeDirs) {
    for (const rel of relExecutables) paths.push(pathApi.join(dir, rel));
  }
  if (resourcesPath) {
    for (const rel of relExecutables) paths.push(pathApi.join(resourcesPath, "runtime/primary-runtime", rel));
  }
  if (platform2 === "win32") {
    paths.push(
      pathApi.join(executable, "resources/runtime/primary-runtime/dependencies/python/python.exe"),
      pathApi.join(executable, "../resources/runtime/primary-runtime/dependencies/python/python.exe"),
      pathApi.join(executable, "../../python/python.exe"),
      pathApi.join(dshHome, "dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe")
    );
  } else {
    paths.push(
      pathApi.join(executable, "../Resources/runtime/primary-runtime/dependencies/python/bin/python3"),
      pathApi.join(executable, "../resources/runtime/primary-runtime/dependencies/python/bin/python3"),
      pathApi.join(executable, "../../python/bin/python3"),
      pathApi.join(dshHome, "dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3")
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const candidatePath of paths) {
    const key = platform2 === "win32" ? pathApi.normalize(candidatePath).toLowerCase() : pathApi.normalize(candidatePath);
    if (seen.has(key)) continue;
    seen.add(key);
    if (exists(candidatePath)) {
      result.push({ command: candidatePath, prefixArgs: [] });
    }
  }
  return result;
}
function parseWindowsRegistryPythonPaths(output) {
  const results = [];
  let inInstallPath = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^HKEY_/i.test(line)) {
      inInstallPath = /\\InstallPath$/i.test(line);
      continue;
    }
    if (!inInstallPath) continue;
    const execMatch = line.match(/^ExecutablePath\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i);
    if (execMatch?.[1]) {
      results.push(execMatch[1].trim());
      continue;
    }
    const defaultMatch = line.match(/^\([^)]+\)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i);
    if (defaultMatch?.[1]) {
      const base = defaultMatch[1].trim();
      if (base) results.push(/\.exe$/i.test(base) ? base : win32.join(base, "python.exe"));
    }
  }
  return results;
}
async function defaultQueryWindowsRegistry() {
  const roots = [
    "HKCU\\SOFTWARE\\Python",
    "HKLM\\SOFTWARE\\Python",
    "HKLM\\SOFTWARE\\WOW6432Node\\Python"
  ];
  const found = [];
  for (const root of roots) {
    try {
      const { stdout } = await execFileAsync2("reg.exe", ["query", root, "/s"], {
        timeout: 3e3,
        windowsHide: true
      });
      found.push(...parseWindowsRegistryPythonPaths(stdout));
    } catch {
    }
  }
  return found;
}
function windowsInstallDirCandidates(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const exists = options.exists ?? existsSync2;
  const readDir = options.readDir ?? ((dir) => readdirSync(dir));
  const userProfile = env.USERPROFILE?.trim() || homeDir;
  const localAppData = env.LOCALAPPDATA?.trim() || win32.join(userProfile, "AppData", "Local");
  const appData = env.APPDATA?.trim() || win32.join(userProfile, "AppData", "Roaming");
  const programFiles = env.ProgramFiles?.trim() || "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"]?.trim() || "C:\\Program Files (x86)";
  const programData = env.ProgramData?.trim() || "C:\\ProgramData";
  const systemDrive = env.SystemDrive?.trim() || "C:";
  const rootDrive = systemDrive.endsWith("\\") ? systemDrive : `${systemDrive}\\`;
  const candidatePaths = [];
  const versionedParents = [
    win32.join(localAppData, "Programs", "Python"),
    programFiles,
    programFilesX86,
    rootDrive
  ];
  for (const parent of versionedParents) {
    const dirs = safeReadDir(readDir, parent).filter((name2) => /^Python3\d*(?:-[A-Za-z0-9_]+)?$/i.test(name2)).sort((a, b) => versionSortKey(b) - versionSortKey(a));
    for (const dir of dirs) {
      candidatePaths.push(win32.join(parent, dir, "python.exe"), win32.join(parent, dir, "python3.exe"));
    }
  }
  for (const uvRoot of [win32.join(localAppData, "uv", "python"), win32.join(appData, "uv", "python")]) {
    const dirs = safeReadDir(readDir, uvRoot).filter((name2) => /^cpython-3\./i.test(name2)).sort((a, b) => versionSortKey(b) - versionSortKey(a));
    for (const dir of dirs) {
      candidatePaths.push(win32.join(uvRoot, dir, "python.exe"));
    }
  }
  const pyenvVersionsDir = win32.join(userProfile, ".pyenv", "pyenv-win", "versions");
  for (const dir of safeReadDir(readDir, pyenvVersionsDir).filter((name2) => /^3\./.test(name2)).sort((a, b) => versionSortKey(b) - versionSortKey(a))) {
    candidatePaths.push(win32.join(pyenvVersionsDir, dir, "python.exe"));
  }
  const scoopApps = win32.join(userProfile, "scoop", "apps");
  for (const dir of safeReadDir(readDir, scoopApps).filter((name2) => /^python/i.test(name2)).sort((a, b) => versionSortKey(b) - versionSortKey(a))) {
    candidatePaths.push(win32.join(scoopApps, dir, "current", "python.exe"));
  }
  candidatePaths.push(win32.join(userProfile, "scoop", "shims", "python.exe"));
  const chocoBase = env.ChocolateyInstall?.trim() || win32.join(programData, "chocolatey");
  candidatePaths.push(win32.join(chocoBase, "bin", "python.exe"), win32.join(chocoBase, "bin", "python3.exe"));
  for (const condaRoot of [
    win32.join(userProfile, "miniconda3"),
    win32.join(userProfile, "anaconda3"),
    win32.join(userProfile, "miniforge3"),
    win32.join(userProfile, "mambaforge"),
    win32.join(localAppData, "miniconda3"),
    win32.join(localAppData, "anaconda3"),
    win32.join(localAppData, "miniforge3"),
    win32.join(programData, "miniconda3"),
    win32.join(programData, "anaconda3"),
    win32.join(programData, "miniforge3")
  ]) {
    candidatePaths.push(win32.join(condaRoot, "python.exe"));
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const candidatePath of candidatePaths) {
    const key = win32.normalize(candidatePath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (exists(candidatePath)) {
      result.push({ command: candidatePath, prefixArgs: [] });
    }
  }
  return result;
}
function pathCandidates(options) {
  const { platform: platform2, env, exists } = options;
  const pathApi = platform2 === "win32" ? win32 : posix;
  const rawPath = env.PATH ?? env.Path ?? "";
  const pathSep = platform2 === "win32" ? ";" : ":";
  const entries = rawPath.split(pathSep).map((entry) => entry.trim().replace(/^"+|"+$/g, "")).filter(Boolean);
  const names = platform2 === "win32" ? ["python3.exe", "python.exe"] : ["python3", "python"];
  const regular = [];
  const windowsApps = [];
  for (const dir of entries) {
    const targetList = platform2 === "win32" && isWindowsAppsPath(dir) ? windowsApps : regular;
    for (const name2 of names) {
      const fullPath = pathApi.join(dir, name2);
      if (exists(fullPath)) {
        targetList.push({ command: fullPath, prefixArgs: [] });
      }
    }
  }
  if (platform2 !== "win32") {
    regular.push({ command: "python3", prefixArgs: [] }, { command: "python", prefixArgs: [] });
  }
  return { regular, windowsApps };
}
function windowsLauncherCandidates(options) {
  const { env, homeDir, exists } = options;
  const systemRoot = env.SystemRoot?.trim() || env.SYSTEMROOT?.trim() || env.WINDIR?.trim() || "C:\\Windows";
  const userProfile = env.USERPROFILE?.trim() || homeDir;
  const localAppData = env.LOCALAPPDATA?.trim() || win32.join(userProfile, "AppData", "Local");
  const paths = [
    win32.join(systemRoot, "py.exe"),
    win32.join(localAppData, "Programs", "Python", "Launcher", "py.exe")
  ];
  const rawPath = env.PATH ?? env.Path ?? "";
  for (const dir of rawPath.split(";").map((entry) => entry.trim().replace(/^"+|"+$/g, "")).filter(Boolean)) {
    paths.push(win32.join(dir, "py.exe"));
  }
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const candidatePath of paths) {
    const key = win32.normalize(candidatePath).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (exists(candidatePath)) {
      result.push({ command: candidatePath, prefixArgs: ["-3"] });
    }
  }
  return result;
}
async function defaultProbePython(candidate, env, signal) {
  return new Promise((resolve2) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve2(result);
    };
    let child;
    try {
      child = spawn(candidate.command, [...candidate.prefixArgs, "-I", "-B", "-X", "utf8", "-c", PROBE_SCRIPT], {
        stdio: ["ignore", "pipe", "ignore"],
        env,
        signal,
        timeout: 5e3,
        windowsHide: true
      });
    } catch {
      finish({ ok: false });
      return;
    }
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4096) stdout += chunk;
    });
    child.on("error", () => finish({ ok: false }));
    child.on("close", (code) => {
      if (code !== 0) {
        finish({ ok: false });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        if (!isSupportedVersion(parsed.v)) {
          finish({ ok: false });
          return;
        }
        finish({
          ok: true,
          version: [parsed.v[0], parsed.v[1]],
          executable: typeof parsed.exe === "string" && parsed.exe ? parsed.exe : void 0
        });
      } catch {
        finish({ ok: false });
      }
    });
  });
}
var cachedResolution;
function resetPythonResolutionCache() {
  cachedResolution = void 0;
}
async function discoverPython(options = {}) {
  const platform2 = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const exists = options.exists ?? existsSync2;
  const readDir = options.readDir ?? ((dir) => readdirSync(dir));
  const queryRegistry = options.queryRegistry ?? defaultQueryWindowsRegistry;
  const probe = options.probe ?? defaultProbePython;
  const childEnv = workerEnv(platform2, env);
  const tried = /* @__PURE__ */ new Set();
  const tryCandidates = async (candidates) => {
    for (const candidate of candidates) {
      options.signal?.throwIfAborted();
      const key = candidateKey(candidate, platform2);
      if (tried.has(key)) continue;
      tried.add(key);
      const result = await probe(candidate, childEnv, options.signal);
      options.signal?.throwIfAborted();
      if (!result.ok) continue;
      if (candidate.prefixArgs.length > 0 && result.executable && exists(result.executable)) {
        const direct = { command: result.executable, prefixArgs: [] };
        const directProbe = await probe(direct, childEnv, options.signal);
        options.signal?.throwIfAborted();
        if (directProbe.ok) return direct;
      }
      return candidate;
    }
    return void 0;
  };
  const bundledMatch = await tryCandidates(bundledPythonCandidates({
    platform: platform2,
    execPath: options.execPath,
    resourcesPath: options.resourcesPath,
    env,
    homeDir,
    exists
  }));
  if (bundledMatch) return bundledMatch;
  const fromPath = pathCandidates({ platform: platform2, env, exists });
  const pathMatch = await tryCandidates(fromPath.regular);
  if (pathMatch) return pathMatch;
  if (platform2 === "win32") {
    const launcherMatch = await tryCandidates(windowsLauncherCandidates({ env, homeDir, exists }));
    if (launcherMatch) return launcherMatch;
    const dirMatch = await tryCandidates(windowsInstallDirCandidates({ env, homeDir, exists, readDir }));
    if (dirMatch) return dirMatch;
    const registryPaths = await queryRegistry();
    const registryCandidates = registryPaths.filter((p) => exists(p)).map((p) => ({ command: p, prefixArgs: [] }));
    const registryMatch = await tryCandidates(registryCandidates);
    if (registryMatch) return registryMatch;
    const userProfile = env.USERPROFILE?.trim() || homeDir;
    const localAppData = env.LOCALAPPDATA?.trim() || win32.join(userProfile, "AppData", "Local");
    const storeCandidates = [...fromPath.windowsApps];
    for (const name2 of ["python3.exe", "python.exe"]) {
      const storePath = win32.join(localAppData, "Microsoft", "WindowsApps", name2);
      if (exists(storePath)) storeCandidates.push({ command: storePath, prefixArgs: [] });
    }
    const storeMatch = await tryCandidates(storeCandidates);
    if (storeMatch) return storeMatch;
  }
  throw new Error("\u9700\u8981 Python 3.9 \u6216\u4EE5\u4E0A\u7248\u672C\uFF1A\u8BF7\u5B89\u88C5\u540E\u91CD\u65B0\u6253\u5F00 DSH\u3002\u539F\u9879\u76EE\u672A\u6539\u52A8\u3002");
}
async function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve2, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve2(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}
async function resolvePythonInterpreter(options = {}) {
  options.signal?.throwIfAborted();
  if (options.useCache === false) {
    return discoverPython(options);
  }
  if (!cachedResolution) {
    const { signal: _signal, ...sharedOptions } = options;
    const pending = discoverPython(sharedOptions).catch((error) => {
      if (cachedResolution === pending) cachedResolution = void 0;
      throw error;
    });
    cachedResolution = pending;
  }
  return awaitWithAbort(cachedResolution, options.signal);
}

// src/host/app-delivery.ts
var ROLLBACK_NOTICE = "\u56DE\u6EDA\u6062\u590D\u4EE3\u7801\u4E0E\u8FD0\u884C\u914D\u7F6E\uFF0C\u4E0D\u81EA\u52A8\u56DE\u9000\u6570\u636E\u5E93/\u5377\u4E2D\u7684\u4E1A\u52A1\u6570\u636E\uFF1B\u65E7\u4EE3\u7801\u548C\u65B0\u6570\u636E\u517C\u5BB9\u6027\u4ECD\u9700\u9A8C\u8BC1\u3002";
function analysisQuestions(proposal) {
  const pendingAccount = proposal?.adminAccountPending ? [`\u8BF7${proposal?.contract?.admin_account?.mode === "create" ? "\u8BBE\u7F6E" : "\u586B\u5199\u5DF2\u6709\u7684"}\u7BA1\u7406\u5458\u8D26\u53F7\u548C\u5BC6\u7801\uFF0C\u76F4\u63A5\u5728\u5F53\u524D\u5BF9\u8BDD\u56DE\u590D\u300C\u8D26\u53F7\uFF1A\u2026\u300D\u548C\u300C\u5BC6\u7801\uFF1A\u2026\u300D\uFF08\u53EF\u5206\u4E24\u884C\u6216\u540C\u884C\u7528\u7A7A\u683C\u9694\u5F00\uFF09\u3002`] : [];
  return [.../* @__PURE__ */ new Set([...pendingAccount, ...proposal?.unresolved ?? [], ...proposal?.contract?.unresolved ?? []])];
}
function readAdminReply(plan, text3) {
  let username = text3.match(/^\s*(?:[-*•]\s*)?(?:账号|帐号|用户名|username)\s*[：:=]\s*([^\r\n]+)$/im)?.[1]?.trim();
  let password = text3.match(/^\s*(?:[-*•]\s*)?(?:密码|password)\s*[：:=]\s*([^\r\n]+)$/im)?.[1]?.trim();
  if (!username || !password) {
    const userFirst = text3.match(/(?:^|[\s,，;；])(?:账号|帐号|用户名|username)\s*[：:=]\s*([^\r\n]+?)[\s,，;；]+(?:密码|password)\s*[：:=]\s*([^\r\n]+)/i);
    const passFirst = userFirst ? void 0 : text3.match(/(?:^|[\s,，;；])(?:密码|password)\s*[：:=]\s*([^\r\n]+?)[\s,，;；]+(?:账号|帐号|用户名|username)\s*[：:=]\s*([^\r\n]+)/i);
    if (userFirst) {
      username = userFirst[1].replace(/[,，;；]+$/, "").trim();
      password = userFirst[2].trim();
    } else if (passFirst) {
      password = passFirst[1].replace(/[,，;；]+$/, "").trim();
      username = passFirst[2].trim();
    }
  }
  if (!username || !password || username.length > 4096 || password.length > 4096 || /\0/.test(username + password)) return void 0;
  return { profile: plan.profile, mode: plan.mode, username, password };
}
function appendAnalysisFeedback(job, text3) {
  job.conversation = [...job.conversation ?? [], { role: "user", text: text3, revision: job.revisionCount }];
  job.feedbackHistory = job.feedbackHistory ? `${job.feedbackHistory}

\u672C\u6B21\u8865\u5145\uFF08\u6709\u51B2\u7A81\u65F6\u4EE5\u672C\u6B21\u4E3A\u51C6\uFF09\uFF1A
${text3}` : text3;
}
function matchesReceipt(log, hashes) {
  return !!hashes?.["app.tar"] && !!hashes["skill.zip"] && typeof log === "string" && log.includes(`[Artifact] app.tar:${hashes["app.tar"]}
`) && log.includes(`[Artifact] skill.zip:${hashes["skill.zip"]}
`) && (!hashes["delivery.json"] || log.includes(`[Artifact] delivery.json:${hashes["delivery.json"]}
`));
}
function checkPublishReceipt(job, receipt) {
  if (receipt.request_id && receipt.request_id !== job.requestId) throw new Error("\u53D1\u5E03\u56DE\u6267\u8BF7\u6C42\u53F7\u4E0D\u4E00\u81F4");
  if (receipt.app_url && receipt.app_url !== job.url) throw new Error("\u5E73\u53F0\u8FD4\u56DE\u5730\u5740\u4E0E\u786E\u8BA4\u5730\u5740\u4E0D\u540C");
  if (receipt.app_tar_sha256 && receipt.app_tar_sha256 !== job.hashes?.["app.tar"] || receipt.skill_zip_sha256 && receipt.skill_zip_sha256 !== job.hashes?.["skill.zip"] || job.hashes?.["delivery.json"] && receipt.delivery_plan_sha256 !== job.hashes["delivery.json"]) {
    throw new Error("\u53D1\u5E03\u56DE\u6267\u5236\u54C1\u6458\u8981\u4E0D\u4E00\u81F4");
  }
  if (Object.hasOwn(receipt, "published_version") && (!Number.isSafeInteger(receipt.published_version) || receipt.published_version < 0 || receipt.status === "running" && receipt.published_version !== receipt.version)) throw new Error("\u53D1\u5E03\u56DE\u6267\u6B63\u5F0F\u7248\u672C\u65E0\u6548");
  if (["accepted", "building", "built", "activating", "runtime_ready", "running", "failed"].includes(receipt.status) && (!Number.isSafeInteger(receipt.version) || receipt.version < 1)) throw new Error("\u53D1\u5E03\u56DE\u6267\u7F3A\u5C11\u6709\u6548\u7248\u672C");
}
function verificationCredentialFields(contract) {
  const fields = /* @__PURE__ */ new Map();
  for (const api of contract.apis ?? []) {
    if (["header", "bearer"].includes(api.auth?.type) && api.auth.env) fields.set(api.auth.env, "session");
  }
  for (const profile of [contract.auth_profile, ...Object.values(contract.auth_profiles ?? {})]) {
    if (profile?.token_env) fields.set(profile.token_env, "session");
    if (profile?.username_env) fields.set(profile.username_env, "username");
    if (profile?.password_env) fields.set(profile.password_env, "password");
  }
  return [...fields].map(([key, kind]) => ({ key, kind }));
}
function probeMatches(result, status, expected) {
  if (result.status !== status) return false;
  try {
    return contains(JSON.parse(result.content), expected);
  } catch {
    return false;
  }
}
function loopbackConnection(key, value) {
  if (["HOST", "PORT", "BIND_HOST", "LISTEN_HOST"].includes(key.toUpperCase()) || !/URL|URI|DSN|HOST|ENDPOINT|CONNECTION|SERVER/i.test(key)) {
    return false;
  }
  return /(?:^|:\/\/|@|tcp\(|(?:host|server)\s*=)(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?=[:/,;)]|$)/i.test(value.trim());
}
function isExampleConfigPath(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const suffixRe = /(?:^|[._-])(?:example|sample|template)$/;
  return suffixRe.test(base) || suffixRe.test(stem);
}
function isSensitiveConfigKey(key) {
  return /password|passwd|secret|token|credential|api.?key|private.?key|dsn|connection.?string/i.test(key);
}
var hash = (value) => createHash5("sha256").update(value).digest("hex");
var fingerprint = (value) => hash(JSON.stringify(value));
function contains(actual, expected) {
  if (expected === void 0) return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && (expected.length ? expected.every((e) => actual.some((a) => contains(a, e))) : !actual.length);
  if (expected && typeof expected === "object") return actual !== null && typeof actual === "object" && Object.entries(expected).every(([k, v]) => contains(actual[k], v));
  return actual === expected;
}
var workerQueues = /* @__PURE__ */ new Map();
async function serializeByRoot(rootKey, signal, fn) {
  if (!rootKey) return fn();
  const resolved = resolve(rootKey);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const previous = workerQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.catch(() => {
  }).then(() => gate);
  workerQueues.set(key, tail);
  void tail.finally(() => {
    if (workerQueues.get(key) === tail) workerQueues.delete(key);
  });
  try {
    if (signal) {
      signal.throwIfAborted();
      let onAbort;
      try {
        await Promise.race([
          previous.catch(() => {
          }),
          new Promise((_, reject) => {
            onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
            signal.addEventListener("abort", onAbort, { once: true });
          })
        ]);
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    } else {
      await previous.catch(() => {
      });
    }
    signal?.throwIfAborted();
    return await fn();
  } finally {
    release();
  }
}
async function renameWithRetry(src, dest) {
  const retryable = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES"]);
  for (let attempt = 0; ; attempt++) {
    try {
      await rename3(src, dest);
      return;
    } catch (error) {
      const code = error?.code;
      if (process.platform === "win32" && code && retryable.has(code) && attempt < 6) {
        await new Promise((resolve2) => setTimeout(resolve2, 15 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}
async function worker(input, signal) {
  const rootKey = typeof input?.root === "string" && input.root ? input.root : void 0;
  return serializeByRoot(rootKey, signal, async () => {
    const path = fileURLToPath(new URL("../../runtime/worker.py", import.meta.url));
    const runtime = import.meta.url.endsWith("/lib/index.js") ? fileURLToPath(new URL("../runtime/worker.py", import.meta.url)) : path;
    const python = await resolvePythonInterpreter({ signal });
    return new Promise((resolve2, reject) => {
      const child = spawn2(python.command, [...python.prefixArgs, "-I", "-B", "-X", "utf8", runtime], {
        stdio: ["pipe", "pipe", "pipe"],
        env: workerEnv(),
        signal,
        timeout: 12e4,
        windowsHide: true
      });
      let stdout = "", stderr = "", exceeded = false;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data) => {
        stdout += data;
        if (stdout.length > 8e6) {
          exceeded = true;
          child.kill();
        }
      });
      child.stderr.on("data", (data) => {
        if (stderr.length < 2e3) stderr += data;
      });
      child.on("error", (error) => {
        if (error.message.includes("ENOENT")) resetPythonResolutionCache();
        reject(new Error(error.message.includes("ENOENT") ? "\u9700\u8981 Python 3.9 \u6216\u4EE5\u4E0A\u7248\u672C\uFF1A\u8BF7\u5B89\u88C5\u540E\u91CD\u65B0\u6253\u5F00 DSH\u3002\u539F\u9879\u76EE\u672A\u6539\u52A8\u3002" : error.message));
      });
      child.on("close", (code, closeSignal) => {
        if (exceeded) return reject(new Error("\u5206\u6790\u8F93\u51FA\u8D85\u8FC7\u9650\u5236\uFF0C\u8BF7\u7F29\u5C0F\u8BFB\u53D6\u8303\u56F4"));
        try {
          const result = JSON.parse(stdout);
          if (!result.ok) throw new Error(result.error);
          resolve2(result.value);
        } catch (error) {
          if (stdout) {
            reject(new Error(error instanceof Error ? error.message : String(error)));
            return;
          }
          const trimmedStderr = stderr.trim().slice(0, 500);
          const detail = trimmedStderr ? `\uFF1A${trimmedStderr}` : closeSignal ? `\uFF08\u8FDB\u7A0B\u88AB\u4FE1\u53F7 ${closeSignal} \u4E2D\u6B62\uFF09` : code !== 0 && code !== null ? `\uFF08\u9000\u51FA\u7801 ${code}\uFF09` : "\uFF08\u672A\u8FD4\u56DE\u4EFB\u4F55\u8F93\u51FA\uFF09";
          reject(new Error(`\u5E94\u7528\u51C6\u5907\u5DE5\u5177\u672A\u80FD\u542F\u52A8${detail}`));
        }
      });
      child.stdin.on("error", () => {
      });
      child.stdin.end(JSON.stringify(input));
    });
  });
}
var AppRequestError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
var AppDelivery = class {
  constructor(core, home, credentials, options = {}) {
    this.core = core;
    this.home = home;
    this.credentials = credentials;
    this.options = options;
  }
  core;
  home;
  credentials;
  options;
  busy = /* @__PURE__ */ new Set();
  analyses = /* @__PURE__ */ new Map();
  adminReplies = /* @__PURE__ */ new Map();
  preparedProposals = /* @__PURE__ */ new Map();
  analyze;
  getOptions() {
    return { ...this.options };
  }
  updateOptions(next) {
    this.options = {
      ...this.options,
      ...next.appDomainRoot !== void 0 ? { appDomainRoot: next.appDomainRoot } : {},
      ...next.appDefaultPort !== void 0 ? { appDefaultPort: next.appDefaultPort } : {}
    };
    this.core.emit("change");
  }
  scope(expected) {
    const captured = this.core.auth.contexts.captureApplication(expected);
    const directory = join3(this.home, "opc", "apps", identityHash(captured.context));
    return { ...captured, directory };
  }
  async save(root, job) {
    await mkdir3(root, { recursive: true, mode: 448 });
    const temp = join3(root, `job-${randomUUID4()}.tmp`);
    try {
      await writeFile3(temp, JSON.stringify(job), { mode: 384 });
      await renameWithRetry(temp, join3(root, "job.json"));
    } finally {
      await rm2(temp, { force: true }).catch(() => {
      });
    }
    this.core.emit("change");
  }
  skillPreferencePath(directory, slug) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    return join3(directory, "skill-preferences", slug);
  }
  async isSkillDisabled(directory, slug) {
    return readFile2(this.skillPreferencePath(directory, slug), "utf8").then((value) => value === "disabled", (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  }
  async directories(directory) {
    const entries = await readdir2(directory).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return [directory, ...entries.filter((id) => /^[a-f0-9]{64}$/.test(id)).map((id) => join3(directory, id))];
  }
  async open(directory, id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("\u65E0\u6548\u4EFB\u52A1");
    for (const parent of await this.directories(directory)) {
      const root = join3(parent, id);
      try {
        const job = JSON.parse(await readFile2(join3(root, "job.json"), "utf8"));
        return { root, job };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    throw Object.assign(new Error("\u5E94\u7528\u4EFB\u52A1\u4E0D\u5B58\u5728"), { code: "ENOENT" });
  }
  recordFailureState(job, errorMsg, extraLog, remoteVersion, stage = "deployment") {
    job.status = "failed";
    job.failureStage = stage;
    job.error = errorMsg;
    job.failedRevision = job.revision || job.failedRevision;
    const combinedLog = [errorMsg, extraLog].filter(Boolean).join("\n");
    job.failureContext = (job.failureContext ? `${job.failureContext}
${combinedLog}` : combinedLog).slice(-24e3);
    job.failedSnapshot = {
      artifactHashes: job.hashes,
      version: remoteVersion ?? job.version,
      configKeys: job.configKeys ?? [],
      resourceIds: job.resourceIds ?? [],
      storageMounts: job.proposal?.contract?.storage_mounts ?? [],
      verificationError: errorMsg
    };
  }
  async recoverInterrupted(root, job) {
    const interrupted = { importing: "import", analyzing: "analysis", preparing: "preparation", verifying: "verification" };
    if (job.status === "publishing") {
      job.status = "unknown";
      job.error = "\u53D1\u5E03\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u67E5\u8BE2\u72B6\u6001\uFF0C\u4E0D\u8981\u91CD\u590D\u53D1\u5E03";
    } else if (job.status in interrupted) {
      if (job.status === "verifying" && job.archivedRevision) job.assessmentPending = true;
      job.failureStage = interrupted[job.status];
      job.status = "failed";
      job.error = "\u4E0A\u6B21\u4EFB\u52A1\u4E2D\u65AD\uFF0C\u53EF\u4ECE\u5F53\u524D\u6B65\u9AA4\u7EE7\u7EED";
    } else return;
    await this.save(root, job);
  }
  async archivePublishedVersion(scopeDir, job, bundleDir) {
    const { slug, version, requestId, id: jobId } = job;
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !version || version <= 0) return;
    const verDir = join3(scopeDir, "versions", slug, `v${version}`);
    await mkdir3(verDir, { recursive: true, mode: 448 });
    const hashes = {};
    for (const name2 of ["app.tar", "skill.zip", "app-manifest.json", "summary.json", "delivery.json"]) {
      try {
        const src = join3(bundleDir, name2);
        await copyFile(src, join3(verDir, name2));
        if (name2 === "app.tar" || name2 === "skill.zip") {
          hashes[name2] = hash(await readFile2(src));
        }
      } catch {
      }
    }
    if (Object.keys(hashes).length > 0) {
      await writeFile3(join3(verDir, "summary.json"), JSON.stringify({ version, hashes, jobId, requestId }, null, 2), { mode: 384 }).catch(() => {
      });
    }
  }
  async applyPublishReceipt(scopeDir, root, job, receipt) {
    checkPublishReceipt(job, receipt);
    if (!["accepted", "building", "built", "activating", "runtime_ready", "running", "failed"].includes(receipt.status)) return false;
    job.published = true;
    job.version = Object.hasOwn(receipt, "published_version") ? receipt.published_version || void 0 : receipt.version;
    if (receipt.status === "failed") {
      this.recordFailureState(job, receipt.error_message || "\u90E8\u7F72\u5931\u8D25", receipt.build_log?.slice(-8e3), job.version);
    } else {
      job.status = "building";
      job.error = void 0;
      if (job.revision && job.version) {
        await this.archivePublishedVersion(scopeDir, job, join3(root, job.revision, "bundle"));
      }
    }
    return true;
  }
  async demoteOtherJobsForSlug(scopeDir, slug, activeJobId) {
    for (const parent of await this.directories(scopeDir)) {
      const entries = await readdir2(parent).catch(() => []);
      for (const id of entries.filter((e) => /^[a-f0-9-]{36}$/.test(e) && e !== activeJobId)) {
        const opened = await this.open(scopeDir, id).catch(() => void 0);
        if (opened && opened.job.slug === slug && ["verified", "awaiting_page_verification"].includes(opened.job.status)) {
          opened.job.status = "ready";
          opened.job.superseded = true;
          opened.job.events.push("\u540C\u5E94\u7528\u5DF2\u5207\u6362\u81F3\u5176\u4ED6\u751F\u6548\u7248\u672C\uFF0C\u6B64\u5386\u53F2\u4EFB\u52A1\u6280\u80FD\u5DF2\u505C\u7528");
          await this.save(opened.root, opened.job);
        }
      }
    }
  }
  async localJobIds(directory) {
    const directories = await this.directories(directory);
    const entries = (await Promise.all(directories.map((directory2) => readdir2(directory2).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })))).flat();
    return [...new Set(entries.filter((id) => /^[a-f0-9-]{36}$/.test(id)))];
  }
  async list(expected) {
    const scope = this.scope(expected);
    const jobs = await Promise.all((await this.localJobIds(scope.directory)).map(async (id) => {
      const result = await this.open(scope.directory, id).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return void 0;
      });
      if (!result) return void 0;
      let { job } = result;
      const { root } = result;
      if (!this.busy.has(id) && ["importing", "analyzing", "preparing", "verifying", "publishing"].includes(job.status)) {
        await this.exclusive(id, async () => {
          job = (await this.open(scope.directory, id)).job;
          await this.recoverInterrupted(root, job);
        });
      }
      if (!this.busy.has(id) && ["unknown", "building"].includes(job.status)) {
        const latestJob = await this.open(scope.directory, id);
        if (!this.busy.has(id) && latestJob.job.status === job.status && latestJob.job.requestId === job.requestId) {
          job = latestJob.job;
          try {
            if (job.requestId && (job.status === "unknown" || !job.version)) {
              const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected);
              if ((job.status === "unknown" || ["running", "failed"].includes(receipt.status)) && !this.busy.has(id)) {
                await this.exclusive(id, async () => {
                  job = (await this.open(scope.directory, id)).job;
                  if (job.status !== latestJob.job.status || job.requestId !== latestJob.job.requestId || job.version !== latestJob.job.version) return;
                  if (await this.applyPublishReceipt(scope.directory, root, job, receipt)) await this.save(root, job);
                });
              }
            }
            if (job.status === "building" && job.version) {
              const remote = await this.platform("/" + job.slug, expected);
              if (remote.status === "failed" && remote.current_version === job.version && !this.busy.has(id)) {
                await this.exclusive(id, async () => {
                  job = (await this.open(scope.directory, id)).job;
                  if (job.status !== "building" || remote.current_version !== job.version) return;
                  this.recordFailureState(job, remote.error_message || "\u90E8\u7F72\u5931\u8D25", remote.build_log?.slice(-8e3), remote.current_version);
                  await this.save(root, job);
                });
              } else if (remote.status === "running" && remote.current_version !== job.version && !this.busy.has(id)) {
                const history = await this.platform("/" + job.slug + "/versions", expected).catch(() => void 0);
                const attempted = history?.versions?.find((version) => version.version === job.version);
                if (attempted?.status === "failed" && attempted.app_tar_sha256 === job.hashes?.["app.tar"] && attempted.skill_zip_sha256 === job.hashes?.["skill.zip"]) {
                  await this.exclusive(id, async () => {
                    job = (await this.open(scope.directory, id)).job;
                    if (job.status !== "building" || job.version !== attempted.version) return;
                    this.recordFailureState(job, attempted.error_message || "\u672C\u6B21\u53D1\u5E03\u5931\u8D25\uFF0C\u65E7\u7248\u672C\u4ECD\u5728\u8FD0\u884C", attempted.build_log?.slice(-8e3), job.version);
                    await this.save(root, job);
                  });
                }
              }
            }
          } catch {
          }
        }
      }
      const view = this.public(job, root);
      if (job.status === "verified") view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug);
      const sortAt = typeof job.createdAt === "number" ? job.createdAt : await stat(join3(root, "job.json")).then((info) => info.mtimeMs, () => 0);
      return { view, sortAt };
    }));
    scope.assertCurrent();
    return jobs.filter((entry) => entry !== void 0).sort((a, b) => {
      if (b.sortAt !== a.sortAt) return b.sortAt - a.sortAt;
      const supDiff = Number(Boolean(a.view.superseded)) - Number(Boolean(b.view.superseded));
      if (supDiff !== 0) return supDiff;
      return Number(b.view.version ?? 0) - Number(a.view.version ?? 0);
    }).map((entry) => entry.view);
  }
  async getJob(id, expected) {
    const scope = this.scope(expected);
    let { root, job } = await this.open(scope.directory, id);
    if (!this.busy.has(id) && ["importing", "analyzing", "preparing", "verifying", "publishing"].includes(job.status)) {
      await this.exclusive(id, async () => {
        job = (await this.open(scope.directory, id)).job;
        await this.recoverInterrupted(root, job);
      });
    }
    scope.assertCurrent();
    const view = this.public(job, root);
    if (job.status === "verified") view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug);
    return view;
  }
  async getJobByAnalysisSession(sessionId, expected) {
    const scope = this.scope(expected);
    if (!/^[a-f0-9-]{36}$/.test(sessionId)) return null;
    const jobs = await Promise.all((await this.localJobIds(scope.directory)).map((id) => this.open(scope.directory, id).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return void 0;
    })));
    scope.assertCurrent();
    const match = jobs.find((entry) => entry?.job.analysisSessions?.includes(sessionId));
    return match ? this.getJob(match.job.id, expected) : null;
  }
  async checkSlug(slug, expected) {
    const trimmed = slug.trim();
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(trimmed)) throw new Error("\u5E94\u7528\u552F\u4E00\u6807\u8BC6\u9700\u4E3A 3\u201340 \u4F4D\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u6216\u8FDE\u5B57\u7B26\uFF0C\u4E14\u4EE5\u5B57\u6BCD\u5F00\u5934");
    const res = await this.platform("/check-slug", expected, { body: { slug: trimmed } });
    const configuredRoot = (this.options.appDomainRoot ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (configuredRoot && res?.slug) {
      res.app_url = `http://${res.slug}.${configuredRoot}`;
    }
    return res;
  }
  async opcConfig(expected) {
    this.scope(expected);
    const configuredRoot = (this.options.appDomainRoot ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    let appDomainRoot = configuredRoot;
    if (!appDomainRoot) {
      try {
        const probe = await this.platform("/check-slug", expected, { body: { slug: "app-domain-probe" } });
        if (typeof probe?.app_url === "string" && probe.app_url.startsWith("http")) {
          const parsed = new URL(probe.app_url);
          if (parsed.host.startsWith("app-domain-probe.")) {
            appDomainRoot = parsed.host.slice("app-domain-probe.".length);
          }
        }
      } catch {
      }
    }
    const defaultPort = Number.isInteger(this.options.appDefaultPort) && this.options.appDefaultPort >= 1 && this.options.appDefaultPort <= 65535 ? this.options.appDefaultPort : 8080;
    return {
      appDomainRoot: appDomainRoot || DEFAULT_APP_DOMAIN_ROOT,
      defaultPort,
      platformBaseUrl: this.core.auth?.http?.base?.toString()?.replace(/\/+$/, "") ?? ""
    };
  }
  public(job, root) {
    const { proposal, skillMarkdown: _sm, dockerfileContent: _df, configDraft, confirmationToken: _token, analysisSessions: _analysisSessions, autoPrepared, ...rest } = job;
    const hasOrigSet = new Set(job.hasOriginalKeys ?? []);
    const runtimeConfigs = (proposal?.contract?.configs ?? []).map((c) => {
      const hasOrig = hasOrigSet.has(c.key) && Boolean(c.source);
      const isExample = typeof c.source?.path === "string" && isExampleConfigPath(c.source.path);
      return {
        key: c.key,
        value: c.secret || c.resource_id ? "" : c.default ?? "",
        resource_id: c.resource_id,
        resource_key: c.resource_key,
        app_default: c.secret ? "" : typeof c.app_default === "string" ? c.app_default : "",
        description: c.description ?? "",
        required: Boolean(c.required),
        secret: Boolean(c.secret),
        has_value: hasOrig || Boolean(c.default || c.resource_id),
        has_original_value: hasOrig,
        ...isExample ? { is_example_source: true } : {},
        value_source: c.resource_id ? "resource" : hasOrig ? "original" : "manual",
        source_label: c.source?.path ? `${isExample ? "\u793A\u4F8B\u6A21\u677F\u53C2\u8003" : "\u6765\u81EA\u539F\u9879\u76EE"} ${c.source.path}` : void 0
      };
    });
    const artifactFiles = job.hashes && job.revision && /^[a-z0-9]+$/i.test(job.revision) ? Object.fromEntries(["app.tar", "skill.zip", "app-manifest.json", "summary.json", "delivery.json"].filter((name2) => name2 in job.hashes || name2 === "summary.json").map((name2) => [name2, root ? join3(root, job.revision, "bundle", name2) : join3(job.revision, "bundle", name2)])) : void 0;
    const artifactHash = job.hashes ? fingerprint(job.hashes) : void 0;
    return {
      ...rest,
      analysisChatStarting: !job.analysisSessionId && this.analyses.has(job.id),
      analysisChatActive: Boolean(job.analysisSessionId && this.analyses.has(job.id) && ["analyzing", "review"].includes(job.status)),
      model: job.modelSelection?.model ?? "",
      reasoning_effort: job.modelSelection?.reasoningEffort ?? "",
      revision_count: job.revisionCount,
      analysis_mode: job.analysisMode,
      analysis_failure: job.analysisFailure,
      pages_verified: job.pagesVerified,
      artifactHash,
      deploymentReviewPending: Boolean(job.status === "ready" && autoPrepared && artifactHash && configDraft?.artifactHash !== artifactHash),
      proposalHash: proposal ? fingerprint(proposal) : void 0,
      artifacts: artifactFiles,
      runtime_configs: runtimeConfigs,
      verification: {
        status: job.status === "verified" ? job.pagesVerified ? "verified-deployed-page" : "verified-deployed-api" : job.status === "awaiting_page_verification" ? "awaiting_page_verification" : job.status === "failed" ? "failed" : "",
        checks: (job.checks ?? []).map((c) => ({ operation: c.operation, status: c.status, passed: true })),
        pages_verified: Boolean(job.pagesVerified)
      },
      proposal: proposal && {
        delivery_format: proposal.delivery_format,
        summary: proposal.summary,
        issues: proposal.issues ?? [],
        unresolved: analysisQuestions(proposal),
        decisions: proposal.decisions ?? [],
        changes: proposal.changes?.map((change) => ({
          id: change.id,
          path: change.path,
          reason: change.reason,
          group: change.group ?? "",
          diff: job.diffs?.[change.path] ?? ""
        })),
        contract: {
          description: proposal.contract.description,
          data_plan: proposal.contract.data_plan,
          runtime: proposal.contract.runtime,
          health: proposal.contract.health,
          configs: (proposal.contract.configs ?? []).map((c) => ({
            ...c,
            default: c.secret ? "" : c.default,
            has_original_value: hasOrigSet.has(c.key) || Boolean(c.has_original_value)
          })),
          resources: proposal.contract.resources ?? [],
          storage_mounts: proposal.contract.storage_mounts ?? [],
          verification_credential_fields: verificationCredentialFields(proposal.contract),
          has_embedded_admin: Boolean(job.skillMarkdown?.includes("<!-- opc-admin-login -->")),
          verification: proposal.contract.verification,
          apis: proposal.contract.apis?.map(({ id, purpose, method, path, auth, effect }) => ({ id, purpose, method, path, auth, effect })),
          pages: proposal.contract.pages?.map(({ purpose, path, actions }) => ({ purpose, path, actions }))
        }
      }
    };
  }
  async platform(path, expected, options = {}) {
    if (!/^\/(?:check-slug|resources|dockerfile-templates|publish|deliveries|[a-z][a-z0-9-]*(?:\/(?:logs|versions(?:\/[0-9]+\/artifacts\/(?:app\.tar|skill\.zip|Dockerfile|manifest\.json|delivery\.json))?|deliveries(?:\/[a-f0-9-]+\/artifacts\/(?:app\.tar|skill\.zip|delivery\.json))?|database-schema|storage(?:\/backup)?|recheck|verify|rollback|migrate-data|config|requests\/[A-Za-z0-9_-]+(?:\/(?:assessment|rehearsal))?))?)?$/.test(path)) throw new Error("\u4E0D\u652F\u6301\u7684\u5E94\u7528\u64CD\u4F5C");
    const scope = this.scope(expected);
    const token = await this.core.auth.token();
    scope.assertCurrent();
    const url = new URL("/integration/v1/apps" + (path === "/" ? "" : path), this.core.auth.http.base);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const response = await fetch(url, {
      method: options.method ?? (options.body || options.form ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${token}`, ...options.form ? {} : { "Content-Type": "application/json" } },
      body: options.form ?? (options.body ? JSON.stringify(options.body) : void 0),
      redirect: "error",
      signal: AbortSignal.any([scope.signal, AbortSignal.timeout(
        path.endsWith("/rollback") ? 66e4 : path.endsWith("/storage/backup") ? 3e5 : options.form ? 18e4 : 3e4
      )])
    });
    scope.assertCurrent();
    if (response.ok && options.stream) return response;
    if (response.status === 404 && ["/", "/check-slug", "/resources"].includes(path)) throw new AppRequestError(404, "\u6D4B\u8BD5\u670D\u5C1A\u672A\u542F\u7528\u4F01\u4E1A\u5E94\u7528\u90E8\u7F72\u63A5\u53E3\uFF0C\u9700\u8981\u53D1\u5E03\u914D\u5957 Platform \u7248\u672C");
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && (options.download || path.endsWith("/skill.zip") || path.endsWith("/app.tar") && !options.query?.file || path.endsWith("/storage/backup") || contentType.includes("application/zip") || contentType.includes("application/x-tar") || contentType.includes("application/octet-stream"))) {
      const chunks = [];
      let length = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("\u5E73\u53F0\u672A\u8FD4\u56DE\u6587\u4EF6\u5185\u5BB9");
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 64 * 1024 * 1024) throw new Error("\u6587\u4EF6\u8D85\u8FC7\u63D2\u4EF6\u4E0B\u8F7D\u4E0A\u9650 64 MiB\uFF0C\u8BF7\u4ECE Work-OPC \u4E0B\u8F7D");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {
        });
      }
      scope.assertCurrent();
      return { bytes: Buffer.concat(chunks), sha256: response.headers.get("x-artifact-sha256") ?? void 0 };
    }
    const result = await response.json().catch(() => {
      throw new AppRequestError(response.status, `\u5E94\u7528\u63A5\u53E3 HTTP ${response.status}`);
    });
    if (!response.ok) throw new AppRequestError(response.status, result.error?.message ?? result.error ?? `\u5E94\u7528\u63A5\u53E3 HTTP ${response.status}`);
    return result;
  }
  async create(input, session, expected) {
    const scope = this.scope(expected);
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(input.slug) || typeof input.name !== "string" || !input.name.trim()) throw new Error("\u8BF7\u586B\u5199\u5E94\u7528\u540D\u79F0\u548C 3\u201340 \u4F4D\u82F1\u6587\u6807\u8BC6");
    let targetUrl;
    let targetName = input.name.trim();
    const defaultPort = Number.isInteger(this.options.appDefaultPort) && this.options.appDefaultPort >= 1 && this.options.appDefaultPort <= 65535 ? this.options.appDefaultPort : 8080;
    const portAuto = input.container_port === void 0;
    let targetPort = portAuto ? defaultPort : input.container_port;
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error("\u5BB9\u5668\u7AEF\u53E3\u5FC5\u987B\u4E3A 1 \u81F3 65535 \u7684\u6574\u6570");
    let targetDesc = typeof input.description === "string" ? input.description.trim() : "";
    let defaultVersionNote = "";
    const previous = input.previousJobId ? (await this.open(scope.directory, input.previousJobId)).job : void 0;
    if (previous && previous.slug !== input.slug) throw new Error("\u91CD\u65B0\u5BFC\u5165\u987B\u4FDD\u6301\u539F\u5E94\u7528\u6807\u8BC6");
    const isUpgrade = Boolean(input.upgrade || previous?.upgrade || previous?.published);
    if (isUpgrade) {
      const existing = await this.platform("/" + input.slug, expected);
      if (!existing.can_manage) throw new Error("\u53EA\u6709\u5E94\u7528\u521B\u5EFA\u4EBA\u6216\u7BA1\u7406\u5458\u53EF\u4EE5\u5347\u7EA7\u6B64\u5E94\u7528");
      targetUrl = existing.app_url;
      targetName = existing.name?.trim() || targetName;
      if (input.container_port === void 0 && Number.isInteger(existing.container_port) && existing.container_port >= 1 && existing.container_port <= 65535) {
        targetPort = existing.container_port;
      }
      if (!targetDesc && typeof existing.description === "string") {
        targetDesc = existing.description;
      }
      defaultVersionNote = "\u5E94\u7528\u5347\u7EA7";
    } else {
      const reserved = await this.checkSlug(input.slug, expected);
      if (!reserved.available) throw new Error("\u5E94\u7528\u6807\u8BC6\u5DF2\u88AB\u4F7F\u7528\uFF0C\u8BF7\u6362\u4E00\u4E2A\u6807\u8BC6\uFF1B\u82E5\u9700\u5347\u7EA7\u5DF2\u6709\u5E94\u7528\u8BF7\u9009\u62E9\u5347\u7EA7");
      targetUrl = reserved.app_url;
    }
    if (previous && previous.url !== targetUrl) throw new Error("\u91CD\u65B0\u5BFC\u5165\u987B\u4FDD\u6301\u539F\u5E94\u7528\u5730\u5740");
    scope.assertCurrent();
    const job = {
      id: randomUUID4(),
      name: targetName,
      slug: input.slug,
      url: targetUrl,
      port: targetPort,
      portAuto,
      description: targetDesc,
      upgrade: isUpgrade,
      deliveryMode: isUpgrade ? "update" : "initial",
      versionNote: defaultVersionNote,
      createdAt: Date.now(),
      modelSelection: input.modelSelection && typeof input.modelSelection.provider === "string" && typeof input.modelSelection.model === "string" ? { provider: input.modelSelection.provider, model: input.modelSelection.model, reasoningEffort: typeof input.modelSelection.reasoningEffort === "string" ? input.modelSelection.reasoningEffort : void 0 } : void 0,
      feedbackHistory: previous?.feedbackHistory,
      conversation: previous?.conversation?.filter((message) => message.role === "user"),
      session,
      status: "importing",
      events: ["\u6B63\u5728\u521B\u5EFA\u6E90\u7801\u9694\u79BB\u526F\u672C"]
    };
    const root = join3(scope.directory, job.id);
    await this.exclusive(job.id, async () => {
      await this.save(root, job);
      try {
        let source;
        if (input.zip) {
          if (typeof input.zip !== "string" || input.zip.length > 9e7) throw new Error("ZIP \u4E0D\u80FD\u8D85\u8FC7 64 MiB");
          const bytes = Buffer.from(input.zip, "base64");
          if (bytes.length > 64 * 1024 * 1024) throw new Error("ZIP \u4E0D\u80FD\u8D85\u8FC7 64 MiB");
          source = join3(root, "uploaded.zip");
          await writeFile3(source, bytes, { mode: 384 });
        } else {
          if (typeof input.source !== "string" || !isAbsolute(input.source)) throw new Error("\u8BF7\u9009\u62E9 ZIP \u6216\u586B\u5199\u672C\u673A\u6E90\u7801\u76EE\u5F55\u7684\u5B8C\u6574\u8DEF\u5F84");
          source = input.source;
          const entry = await lstat2(source);
          if (entry.isSymbolicLink() || !entry.isDirectory() && (!entry.isFile() || !/\.zip$/i.test(source))) {
            throw new Error("\u8BF7\u8F93\u5165\u672C\u673A\u6E90\u7801\u6587\u4EF6\u5939\u6216 ZIP \u7684\u5B8C\u6574\u8DEF\u5F84");
          }
          if (entry.isFile() && entry.size > 64 * 1024 * 1024) throw new Error("ZIP \u4E0D\u80FD\u8D85\u8FC7 64 MiB");
        }
        await worker({ action: "prepare", root, source, slug: job.slug, url: job.url }, scope.signal);
        scope.assertCurrent();
        job.status = "draft";
        job.events.push("\u5DF2\u5BFC\u5165\u72EC\u7ACB\u526F\u672C\uFF0C\u539F\u9879\u76EE\u4FDD\u6301\u4E0D\u53D8");
      } catch (error) {
        job.status = "failed";
        job.failureStage = "import";
        job.error = String(error);
      }
      await this.save(root, job);
    });
    return this.public(job, root);
  }
  async reopenReview(id, expected) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    return this.exclusive(id, async () => {
      if (!["ready", "awaiting_page_verification", "failed"].includes(job.status) || !job.proposal) throw new Error("\u5F53\u524D\u72B6\u6001\u65E0\u6CD5\u8FD4\u56DE\u6539\u9020\u65B9\u6848\u6838\u5BF9");
      job.analysisFailure = void 0;
      job.status = "review";
      if (job.proposal.contract.admin_account && !job.proposal.contract.admin_account.source && !job.skillMarkdown && !this.adminReplies.has(id)) {
        job.proposal.adminAccountPending = true;
      }
      job.confirmationToken = void 0;
      job.error = void 0;
      job.events.push("\u5DF2\u8FD4\u56DE\u6539\u9020\u65B9\u6848\u6838\u5BF9\u9636\u6BB5");
      await this.save(root, job);
      this.core.emit("skills-changed");
      return this.public(job, root);
    });
  }
  async reopenDeployment(id, expected) {
    const scope = this.scope(expected);
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id);
      if (job.status !== "failed" || !job.published || !job.revision || !job.hashes || !job.proposal) {
        throw new Error("\u5F53\u524D\u4EFB\u52A1\u6CA1\u6709\u53EF\u91CD\u65B0\u90E8\u7F72\u7684\u5931\u8D25\u7248\u672C");
      }
      const remote = await this.platform(`/${job.slug}`, expected);
      if (remote.can_manage !== true || remote.app_url !== job.url) throw new Error("\u6CA1\u6709\u6743\u9650\u91CD\u65B0\u90E8\u7F72\u6B64\u5E94\u7528\uFF0C\u6216\u5E94\u7528\u5730\u5740\u5DF2\u53D8\u5316");
      const saved = job.requestId ? await this.credentials.read(`publish-config-${job.requestId}`) : {};
      const config = saved.rows ? JSON.parse(saved.rows) : Array.isArray(remote.app_config) ? remote.app_config : [];
      const declarations = job.proposal.contract.configs ?? [];
      const allConfigs = [...declarations, ...config.filter((row) => !declarations.some((declared) => declared.key === row.key))];
      const rows = allConfigs.map((declared) => {
        const existing = config.find((row) => row.key === declared.key);
        return {
          key: declared.key,
          resource_id: existing?.resource_id,
          resource_key: existing?.resource_key,
          local_connection_confirmed: existing?.local_connection_confirmed === true,
          value: existing?.resource_id ? "" : existing?.value ?? (declared.secret ? "" : declared.default) ?? ""
        };
      });
      await this.credentials.write(`draft-${id}`, Object.fromEntries(rows.map((row) => [row.key, row.value])));
      scope.assertCurrent();
      const priorBindings = job.configDraft?.storageBindings ?? {};
      const existingMounts = Array.isArray(remote.storage_mounts) ? remote.storage_mounts : [];
      const storageBindings = {};
      for (const mount of job.proposal.contract.storage_mounts ?? []) {
        const path = mount.container_path;
        const fromDraft = typeof path === "string" ? priorBindings[path] : void 0;
        const fromRemote = typeof path === "string" ? existingMounts.find((old) => old.container_path === path)?.resource_id : void 0;
        if (typeof fromDraft === "string" && fromDraft) storageBindings[path] = fromDraft;
        else if (typeof fromRemote === "string" && fromRemote) storageBindings[path] = fromRemote;
      }
      job.configDraft = {
        artifactHash: fingerprint(job.hashes),
        rows: rows.map(({ value: _value, ...row }) => row),
        versionNote: "",
        ...Object.keys(storageBindings).length > 0 ? { storageBindings } : {}
      };
      job.confirmationToken = void 0;
      job.status = "ready";
      if (job.published) job.upgrade = true;
      job.published = void 0;
      job.superseded = void 0;
      job.events.push("\u5DF2\u6062\u590D\u5931\u8D25\u7248\u672C\u7684\u4EA4\u4ED8\u5305\u548C\u8FD0\u884C\u914D\u7F6E\uFF0C\u8BF7\u6838\u5BF9\u540E\u91CD\u65B0\u90E8\u7F72");
      await this.save(root, job);
      return this.public(job, root);
    });
  }
  async exclusive(id, fn) {
    if (this.busy.has(id)) throw new Error("\u4EFB\u52A1\u6B63\u5728\u6267\u884C\uFF0C\u8BF7\u7A0D\u5019");
    this.busy.add(id);
    try {
      return await fn();
    } finally {
      this.busy.delete(id);
    }
  }
  async startAnalysis(id, feedback, expected, session, options) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    if (!this.analyze) throw new Error("\u6B64 DSH \u7248\u672C\u672A\u63D0\u4F9B\u5E94\u7528\u5206\u6790\u6240\u9700\u7684 Agent \u6269\u5C55");
    if (this.busy.has(id) || ["building", "publishing", "unknown"].includes(job.status)) throw new Error("\u8BF7\u5148\u5B8C\u6210\u5F53\u524D\u90E8\u7F72\u72B6\u6001\u6838\u5BF9");
    if (job.assessmentPending && job.archivedRevision && options?.fromChat) {
      return this.exclusive(id, () => this.advancePreparedDelivery(root, job, expected, options.onChatReady));
    }
    const resume = options?.mode === "resume";
    const waitingForReply = resume && job.status === "review" && analysisQuestions(job.proposal).length > 0;
    const editing = options?.fromChat && ["review", "ready"].includes(job.status);
    if (resume && (!waitingForReply && !editing && job.status !== "failed" || feedback.trim())) throw new Error("\u53EA\u80FD\u7EE7\u7EED\u5DF2\u6682\u505C\u7684\u5E94\u7528\u51C6\u5907");
    this.busy.add(id);
    if (session && !job.analysisSessions?.includes(session)) job.session = session;
    let trimmedFeedback;
    try {
      trimmedFeedback = await worker({ action: "redact_feedback", root, text: feedback.slice(0, 2e4) }, scope.signal);
    } catch (error) {
      this.busy.delete(id);
      throw error;
    }
    const controller = new AbortController();
    const analysisSignal = AbortSignal.any([scope.signal, controller.signal]);
    this.analyses.set(id, controller);
    if (resume && job.failureStage === "preparation") job.analysisFailure ??= job.error;
    if (!resume && job.status !== "failed") {
      job.analysisFailure = void 0;
      if (!job.proposal) await rm2(join3(root, "draft_files.json"), { force: true }).catch(() => {
      });
    }
    if (!resume && (options?.mode === "repair" || job.revision && (job.published || job.status === "failed"))) {
      job.analysisMode = "repair";
      job.failedRevision = job.revision || job.failedRevision;
      const prevFailure = job.failureContext || job.error || "";
      job.failureContext = (prevFailure && trimmedFeedback ? `${prevFailure}
${trimmedFeedback}` : trimmedFeedback || prevFailure).slice(-24e3);
      job.failedSnapshot = {
        artifactHashes: job.hashes,
        version: job.version,
        configKeys: job.configKeys ?? [],
        resourceIds: job.resourceIds ?? [],
        storageMounts: job.proposal?.contract?.storage_mounts ?? [],
        verificationError: job.error || job.failureContext
      };
    } else if (!resume) {
      job.analysisMode = job.analysisMode || "analysis";
      job.failureContext = job.error || job.failureContext;
    }
    job.confirmationToken = void 0;
    if (!resume) {
      job.revisionCount = (job.revisionCount ?? 0) + 1;
      if (trimmedFeedback.trim()) appendAnalysisFeedback(job, trimmedFeedback.trim());
    }
    job.status = waitingForReply ? "review" : "analyzing";
    job.failureStage = void 0;
    job.error = void 0;
    job.checks = void 0;
    job.events.push(
      waitingForReply ? "\u6B63\u5728\u6062\u590D\u5DE6\u4FA7\u5206\u6790\u4F1A\u8BDD" : resume ? "\u{1F504} \u6B63\u5728\u7EE7\u7EED\u51C6\u5907\u5E94\u7528" : job.analysisMode === "repair" ? "\u{1F527} AI \u6B63\u5728\u8BFB\u53D6\u5931\u8D25\u5236\u54C1\u4E0E\u65E5\u5FD7\u8FDB\u884C\u4E13\u9879\u4FEE\u590D\u5206\u6790" : "\u{1F680} AI \u6B63\u5728\u5206\u6790\u6E90\u7801\uFF1B\u5C1A\u672A\u6267\u884C\u53D1\u5E03"
    );
    try {
      await rm2(join3(root, "failed_files_read.json"), { force: true });
      await this.save(root, job);
    } catch (error) {
      this.analyses.delete(id);
      this.busy.delete(id);
      throw error;
    }
    this.core.emit("skills-changed");
    void (async () => {
      try {
        await this.analyze(job, root, trimmedFeedback, analysisSignal, async (sessionId) => {
          analysisSignal.throwIfAborted();
          scope.assertCurrent();
          const analysisSessions = [...(job.analysisSessions ?? []).filter((id2) => id2 !== sessionId), sessionId];
          await this.save(root, { ...job, analysisSessions, analysisSessionId: sessionId });
          job.analysisSessions = analysisSessions;
          job.analysisSessionId = sessionId;
          options?.onChatReady?.();
        }, options?.fromChat);
        analysisSignal.throwIfAborted();
        scope.assertCurrent();
        if (!job.proposal || job.status === "analyzing") throw new Error("AI \u672A\u63D0\u4EA4\u6709\u6548\u6539\u9020\u65B9\u6848\uFF0C\u8BF7\u8865\u5145\u8BF4\u660E\u540E\u91CD\u8BD5");
        if (job.analysisSessionId && job.status === "review" && !analysisQuestions(job.proposal).length) {
          await this.prepareJob(root, job, analysisSignal, scope.assertCurrent, expected, true);
        }
      } catch (error) {
        const msg = controller.signal.aborted ? "\u7528\u6237\u53D6\u6D88\u5206\u6790" : error instanceof Error ? error.message : String(error);
        job.status = controller.signal.aborted ? "cancelled" : "failed";
        if (!controller.signal.aborted) job.failureStage = "analysis";
        job.error = msg;
        if (!controller.signal.aborted && !job.analysisFailure) job.analysisFailure = msg;
      }
      try {
        await this.save(root, job);
      } finally {
        const unused = this.preparedProposals.get(id);
        this.preparedProposals.delete(id);
        if (unused) await rm2(join3(root, unused.revision), { recursive: true, force: true }).catch(() => {
        });
        if (job.status !== "review" || !job.proposal?.adminAccountPending) this.adminReplies.delete(id);
        this.analyses.delete(id);
        this.busy.delete(id);
        options?.onChatReady?.();
        this.core.emit("change");
      }
    })().catch(() => {
    });
    return this.public(job, root);
  }
  async recordAnalysisReply(job, root, text3, signal) {
    if (job.status !== "analyzing" && job.status !== "review") throw new Error("\u5F53\u524D\u5E94\u7528\u51C6\u5907\u9636\u6BB5\u65E0\u6CD5\u63A5\u6536\u56DE\u590D");
    const account = job.proposal?.contract?.admin_account;
    const adminReply = job.proposal?.adminAccountPending && account ? readAdminReply(account, text3) : void 0;
    const proposalWithAccount = adminReply && job.proposal ? { ...job.proposal, adminAccountPending: false } : void 0;
    if (job.status === "review" && adminReply && proposalWithAccount && !analysisQuestions(proposalWithAccount).length) {
      const next2 = {
        ...job,
        proposal: proposalWithAccount,
        analysisFailure: void 0,
        events: [...job.events, "\u5DF2\u6536\u5230\u7BA1\u7406\u5458\u8D26\u5BC6\uFF0C\u7EE7\u7EED\u751F\u6210\u4EA4\u4ED8\u5305"]
      };
      signal.throwIfAborted();
      await this.save(root, { ...next2, proposal: job.proposal });
      this.adminReplies.set(job.id, adminReply);
      Object.assign(job, next2);
      return "";
    }
    const reply = adminReply ? "\u7528\u6237\u5DF2\u7ECF\u5728\u5F53\u524D\u5BF9\u8BDD\u63D0\u4F9B\u7BA1\u7406\u5458\u8D26\u53F7\u548C\u5BC6\u7801\u3002\u4FDD\u7559\u4E0A\u4E00\u7248 admin_account \u8BA4\u8BC1\u65B9\u6848\u4E0E\u5B9E\u9645\u5B58\u50A8\u4F4D\u7F6E\u5E76\u91CD\u65B0\u63D0\u4EA4\uFF0COPC \u4F1A\u628A\u8D26\u5BC6\u5199\u5165\u5E94\u7528\u548C\u6280\u80FD\u3002" : await worker({ action: "redact_feedback", root, text: text3.slice(0, 2e4) }, signal);
    signal.throwIfAborted();
    const next = {
      ...job,
      status: "analyzing",
      revisionCount: (job.revisionCount ?? 0) + 1,
      analysisFailure: void 0,
      events: [...job.events, "\u5DF2\u6536\u5230\u5DE6\u4FA7\u4F1A\u8BDD\u7684\u56DE\u590D\uFF0CAI \u7EE7\u7EED\u6539\u9020"]
    };
    appendAnalysisFeedback(next, reply.trim());
    await this.save(root, next);
    if (adminReply) this.adminReplies.set(job.id, adminReply);
    Object.assign(job, next);
    return reply;
  }
  async cancelAnalysis(id, expected) {
    const scope = this.scope(expected);
    await this.open(scope.directory, id);
    scope.assertCurrent();
    const controller = this.analyses.get(id);
    if (!controller) throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u53D6\u6D88\u7684\u5206\u6790");
    controller.abort();
  }
  async configDraft(id, expected) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    if (job.status !== "ready") return null;
    const sourceConfiguration = await worker({ action: "source_configuration", root }, scope.signal);
    const authored = job.proposal?.delivery_format === 1;
    const resources = authored ? (await this.platform("/resources", expected, { query: { slug: job.slug } }).catch(() => void 0))?.resources : void 0;
    const values = job.configDraft ? await this.credentials.read(`draft-${id}`) : {};
    const origAll = await this.credentials.read(`orig-${id}`);
    scope.assertCurrent();
    const secretKeys = new Set((job.proposal?.contract?.configs ?? []).filter((c) => c.secret).map((c) => c.key));
    const originalValues = Object.fromEntries(
      Object.entries(origAll).filter(([k, v]) => !secretKeys.has(k) && !isSensitiveConfigKey(k) && typeof v === "string")
    );
    return {
      ...job.configDraft,
      rows: (job.configDraft?.rows ?? []).filter((row) => !authored || job.proposal?.contract.configs?.some((config) => config.key === row.key)).map((row) => ({ ...row, value: values[row.key] ?? "" })),
      originalValues,
      sourceConfiguration,
      resources
    };
  }
  async saveConfigDraft(id, input, expected) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    return this.exclusive(id, async () => {
      if (job.status !== "ready" || input.artifactHash !== fingerprint(job.hashes)) throw new Error("\u4EA4\u4ED8\u7248\u672C\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u914D\u7F6E");
      const rows = input.rows;
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row.key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.key) || typeof row.value !== "string" || row.resource_id !== void 0 && typeof row.resource_id !== "string") || new Set(rows.map((row) => row.key)).size !== rows.length) throw new Error("\u914D\u7F6E\u8349\u7A3F\u683C\u5F0F\u65E0\u6548");
      await this.credentials.write(`draft-${id}`, Object.fromEntries(rows.map((row) => [row.key, row.value])));
      scope.assertCurrent();
      job.configDraft = {
        artifactHash: input.artifactHash,
        rows: rows.map((row) => ({
          key: row.key,
          resource_id: row.resource_id,
          resource_key: row.resource_key,
          local_connection_confirmed: row.local_connection_confirmed === true,
          has_value: row.has_value === true,
          ...row.value_source === "original" || row.value_source === "manual" || row.value_source === "resource" || row.value_source === "configured" ? { value_source: row.value_source } : {},
          ...row.secret === true ? { secret: true } : {}
        })),
        storageBindings: readStorageBindings(input.storageBindings),
        versionNote: typeof input.versionNote === "string" ? input.versionNote.slice(0, 1024) : ""
      };
      job.confirmationToken = void 0;
      await this.save(root, job);
    });
  }
  async localArtifact(id, filename, expected) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    if (!["ready", "building", "verifying", "awaiting_page_verification", "verified", "failed"].includes(job.status) || !job.revision || !/^[a-z0-9]+$/i.test(job.revision) || !["app.tar", "skill.zip", "app-manifest.json", "summary.json", "delivery.json"].includes(filename)) throw new Error("\u5F53\u524D\u4EA4\u4ED8\u6587\u4EF6\u4E0D\u53EF\u7528");
    const path = join3(root, job.revision, "bundle", filename);
    const size = (await stat(path)).size;
    if (size > 64 * 1024 * 1024) throw new Error("\u6587\u4EF6\u8D85\u8FC7\u63D2\u4EF6\u4E0B\u8F7D\u4E0A\u9650 64 MiB");
    const bytes = await readFile2(path);
    scope.assertCurrent();
    if (filename !== "summary.json" && hash(bytes) !== job.hashes?.[filename]) throw new Error("\u4EA4\u4ED8\u6587\u4EF6\u5DF2\u53D1\u751F\u53D8\u5316");
    return { filename: `${job.slug}-${filename}`, base64: bytes.toString("base64") };
  }
  async saveLocalArtifact(id, filename, expected, downloads = join3(homedir2(), "Downloads")) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    if (!["ready", "building", "verifying", "awaiting_page_verification", "verified", "failed"].includes(job.status) || !job.revision || !/^[a-z0-9]+$/i.test(job.revision) || !["app.tar", "skill.zip", "app-manifest.json", "summary.json", "delivery.json"].includes(filename)) throw new Error("\u5F53\u524D\u4EA4\u4ED8\u6587\u4EF6\u4E0D\u53EF\u7528");
    const src = join3(root, job.revision, "bundle", filename);
    const bytes = await readFile2(src);
    scope.assertCurrent();
    if (filename !== "summary.json" && hash(bytes) !== job.hashes?.[filename]) throw new Error("\u4EA4\u4ED8\u6587\u4EF6\u5DF2\u53D1\u751F\u53D8\u5316");
    await mkdir3(downloads, { recursive: true, mode: 448 });
    const outName = `${job.slug}-${filename}`;
    const temp = join3(downloads, `.opc-${randomUUID4()}.artifact`);
    await writeFile3(temp, bytes, { mode: 384 });
    try {
      const preferred = join3(downloads, outName);
      let dest = preferred;
      try {
        await link(temp, dest);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        dest = join3(downloads, `${randomUUID4().slice(0, 8)}-${outName}`);
        await link(temp, dest);
      }
      return { filename: outName, path: dest };
    } finally {
      await rm2(temp, { force: true }).catch(() => {
      });
    }
  }
  async skillPreview(id, expected) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    if (job.status !== "ready" || !job.skillMarkdown || !job.hashes?.["skill.zip"] || !job.revision) throw new Error("\u6280\u80FD\u5C1A\u672A\u751F\u6210");
    const bytes = await readFile2(join3(root, job.revision, "bundle", "skill.zip"));
    scope.assertCurrent();
    const result = await worker({
      action: "extract_skill_contract",
      root,
      skill_zip_b64: bytes.toString("base64"),
      expected_sha256: job.hashes["skill.zip"],
      slug: job.slug,
      app_url: job.url
    }, scope.signal);
    scope.assertCurrent();
    return { markdown: result.skill_markdown, contract: result.contract, sha256: result.sha256 };
  }
  async handoff(id, expected) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    if (!["review", "ready", "failed"].includes(job.status)) throw new Error("\u8BF7\u7B49\u5F85\u6539\u9020\u5206\u6790\u7ED3\u675F");
    return worker({ action: "handoff", root, job: {
      name: job.name,
      slug: job.slug,
      url: job.url,
      port: job.port,
      revision: job.status === "ready" ? job.revision : void 0,
      status: job.status,
      proposal: this.public(job).proposal,
      failure: job.analysisFailure || job.error || "",
      update: job.deliveryMode ? job.deliveryMode === "update" : Boolean(job.upgrade),
      revision_count: job.revisionCount ?? 1,
      feedback: job.feedbackHistory ?? ""
    } }, scope.signal);
  }
  async submit(job, root, proposal, signal, options) {
    if (proposal.contract?.slug !== job.slug || proposal.contract?.base_url !== job.url) throw new Error("\u5E94\u7528\u6807\u8BC6\u6216\u5730\u5740\u4E0E\u5BFC\u5165\u65F6\u4E0D\u4E00\u81F4");
    if (job.status !== "analyzing") throw new Error("\u672C\u8F6E\u5DF2\u63D0\u4EA4\u65B9\u6848");
    if (!Array.isArray(proposal.unresolved) || proposal.contract.unresolved !== void 0 && !Array.isArray(proposal.contract.unresolved)) {
      throw new Error("unresolved \u5FC5\u987B\u4E3A\u6570\u7EC4");
    }
    const account = proposal.contract.admin_account;
    const adminReply = this.adminReplies.get(job.id);
    if (adminReply && (!account || account.profile !== adminReply.profile || account.mode !== adminReply.mode)) {
      throw new Error("\u7528\u6237\u5DF2\u63D0\u4EA4\u7BA1\u7406\u5458\u8D26\u5BC6\uFF0C\u8BF7\u4FDD\u7559\u539F\u65B9\u6848\u7684 admin_account \u53CA\u5BF9\u5E94\u767B\u5F55\u65B9\u5F0F");
    }
    if ((job.upgrade || job.published) && account?.mode === "create") throw new Error("\u5DF2\u6709\u90E8\u7F72\u8BF7\u4F7F\u7528\u5E94\u7528\u73B0\u6709\u8D26\u53F7\uFF0C\u6539\u9020\u526F\u672C\u4E0D\u80FD\u66FF\u6362\u7EBF\u4E0A\u8D26\u53F7");
    const previousLogin = job.skillMarkdown?.match(/^<!-- opc-admin-login -->\n```json\n([^\r\n]+)\n```$/m)?.[1];
    const canReusePrevious = previousLogin && !job.failedSnapshot?.verificationError && job.proposal?.contract?.admin_account?.profile === account?.profile && job.proposal?.contract?.admin_account?.mode === account?.mode;
    const adminAccountPending = Boolean(account && !account.source && !adminReply && !canReusePrevious);
    const hasQuestions = Boolean(proposal.unresolved.length || proposal.contract.unresolved?.length);
    if (!hasQuestions) {
      const expectedPort = job.port ?? 8080;
      const actualPort = proposal.contract.runtime?.port;
      const field = "\u4EA4\u4ED8\u5951\u7EA6 runtime.port";
      if (actualPort == null) {
        throw new Error(job.portAuto ? `${field} \u7F3A\u5931\u3002\u8BF7\u8865\u5168 runtime.port\uFF081\u201365535 \u6574\u6570\uFF0C\u4F18\u5148\u586B\u5E94\u7528\u9ED8\u8BA4\u7AEF\u53E3\uFF0C\u65E0\u9ED8\u8BA4\u7AEF\u53E3\u65F6\u586B ${expectedPort}\uFF09` : `${field} \u7F3A\u5931\u3002\u8BF7\u8865\u5168 runtime \u5E76\u586B\u5199\u5DF2\u9501\u5B9A\u7684\u6570\u5B57 ${expectedPort}`);
      }
      if (!Number.isInteger(actualPort) || actualPort < 1 || actualPort > 65535) {
        throw new Error(`${field} \u5FC5\u987B\u662F 1 \u81F3 65535 \u7684\u6574\u6570`);
      }
      if (!job.portAuto && actualPort !== expectedPort) throw new Error(`${field} \u586B\u4E86 ${actualPort}\uFF0C\u4E0E\u5DF2\u9501\u5B9A\u7684\u5BB9\u5668\u7AEF\u53E3 ${expectedPort} \u4E0D\u4E00\u81F4\u3002\u6A21\u578B\u4E0D\u80FD\u9759\u9ED8\u6539\u53D8\u7528\u6237\u9009\u62E9\u7684\u5BB9\u5668\u7AEF\u53E3`);
    }
    const allowUnresolved = hasQuestions || adminAccountPending;
    const preparedRevision = options?.dockerfileOnly && !allowUnresolved ? randomUUID4().replaceAll("-", "") : void 0;
    const validated = await worker({
      action: preparedRevision ? "bundle" : "validate",
      revision: preparedRevision,
      root,
      proposal,
      allow_unresolved: allowUnresolved,
      dockerfile_only: options?.dockerfileOnly === true,
      reuse_source_admin: !job.upgrade && !job.published && !adminReply && !canReusePrevious,
      admin_reply: adminReply,
      previous_skill_markdown: canReusePrevious ? job.skillMarkdown : void 0,
      repair: Boolean(job.failedRevision),
      failed_revision: job.failedRevision ?? "",
      failure_feedback: job.failureContext ?? "",
      revision_count: job.revisionCount ?? 1,
      feedback: job.feedbackHistory ?? "",
      expected_port: job.portAuto ? null : job.port ?? 8080
    }, signal).catch(async (error) => {
      if (preparedRevision) await rm2(join3(root, preparedRevision), { recursive: true, force: true }).catch(() => {
      });
      throw error;
    });
    if (preparedRevision) {
      this.preparedProposals.set(job.id, { revision: preparedRevision, proposalHash: fingerprint(validated.proposal), result: validated });
    }
    signal.throwIfAborted();
    if (job.status !== "analyzing") throw new Error("\u672C\u8F6E\u5DF2\u63D0\u4EA4\u65B9\u6848");
    job.proposal = validated?.proposal ?? proposal;
    const validatedPort = job.proposal?.contract?.runtime?.port;
    if (job.portAuto && Number.isInteger(validatedPort) && validatedPort >= 1 && validatedPort <= 65535) {
      job.port = validatedPort;
    }
    if (adminAccountPending && !job.proposal.contract.admin_account?.source) job.proposal.adminAccountPending = true;
    else delete job.proposal.adminAccountPending;
    job.discoveryReport = validated?.discovery_report ?? job.discoveryReport;
    job.transformationReport = validated?.transformation_report ?? job.transformationReport;
    job.diffs = validated?.diffs ?? job.diffs;
    job.hasOriginalKeys = validated?.has_original_keys ?? job.hasOriginalKeys;
    if (job.proposal?.summary) {
      job.conversation = [...job.conversation ?? [], { role: "assistant", text: job.proposal.summary, revision: job.revisionCount ?? 1 }];
    }
    job.status = "review";
    job.analysisFailure = void 0;
    job.events.push(analysisQuestions(job.proposal).length ? "\u7B49\u5F85\u4F60\u5728\u5DE6\u4FA7\u4F1A\u8BDD\u56DE\u590D" : "\u6539\u9020\u65B9\u6848\u5DF2\u901A\u8FC7\u6821\u9A8C");
    await this.save(root, job);
  }
  async prepare(id, proposalHash, expected) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    return this.exclusive(id, async () => {
      if (job.status !== "review" || !job.proposal || fingerprint(job.proposal) !== proposalHash) throw new Error("\u65B9\u6848\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u6838\u5BF9");
      if (analysisQuestions(job.proposal).length) throw new Error("\u8BF7\u5148\u5728\u5DE6\u4FA7\u4F1A\u8BDD\u5904\u7406\u5F85\u786E\u8BA4\u4E8B\u9879");
      await this.prepareJob(root, job, scope.signal, scope.assertCurrent, expected);
      return this.public(job, root);
    });
  }
  async prepareJob(root, job, signal, assertCurrent, expected, autoPrepared = false) {
    job.status = "preparing";
    job.failureStage = void 0;
    job.error = void 0;
    job.events.push("\u6B63\u5728\u751F\u6210\u5E76\u68C0\u67E5\u4EA4\u4ED8\u5305");
    await this.save(root, job);
    try {
      const prepared = this.preparedProposals.get(job.id);
      const reusable = prepared && prepared.proposalHash === fingerprint(job.proposal) ? prepared : void 0;
      const revision = reusable?.revision ?? randomUUID4().replaceAll("-", "");
      const result = reusable?.result ?? await worker({
        action: "bundle",
        root,
        revision,
        proposal: job.proposal,
        admin_reply: this.adminReplies.get(job.id),
        previous_skill_markdown: job.skillMarkdown,
        repair: Boolean(job.failedRevision),
        failed_revision: job.failedRevision ?? "",
        failure_feedback: job.failureContext ?? "",
        expected_port: job.portAuto ? null : job.port ?? 8080,
        revision_count: job.revisionCount ?? 1,
        feedback: job.feedbackHistory ?? ""
      }, signal);
      signal.throwIfAborted();
      assertCurrent();
      if (reusable) this.preparedProposals.delete(job.id);
      job.revision = revision;
      job.hashes = result.summary.files;
      job.proposal = result.proposal ?? job.proposal;
      const bundledPort = job.proposal?.contract?.runtime?.port;
      if (Number.isInteger(bundledPort) && bundledPort >= 1 && bundledPort <= 65535) {
        job.port = bundledPort;
      }
      job.discoveryReport = result.discovery_report ?? job.discoveryReport;
      job.transformationReport = result.transformation_report ?? job.transformationReport;
      job.preparationChecks = result.preparation_checks ?? job.preparationChecks;
      job.skillMarkdown = result.skill_markdown || job.skillMarkdown;
      this.adminReplies.delete(job.id);
      job.dockerfileContent = result.dockerfile_content || job.dockerfileContent;
      job.hasOriginalKeys = result.has_original_keys ?? job.hasOriginalKeys;
      job.diffs = result.diffs ?? job.diffs;
      if (result.original_config_values && typeof result.original_config_values === "object") {
        await this.credentials.write(`orig-${job.id}`, result.original_config_values);
      }
      if (Object.keys(result.skill_credentials ?? {}).length) {
        await this.credentials.write(`skill-credentials-${job.id}-${revision}`, result.skill_credentials);
      }
      if (job.proposal?.delivery_format === 1) {
        job.archivedRevision = await this.archivePreparedRevision(root, job, revision, expected);
        job.events.push("\u672C\u8F6E\u6539\u9020\u5236\u54C1\u5DF2\u5F52\u6863");
      }
      signal.throwIfAborted();
      assertCurrent();
      job.autoPrepared = autoPrepared;
      job.status = "ready";
      if (job.published) {
        job.upgrade = true;
        if (!job.configDraft && job.requestId) {
          const priorPublished = await this.credentials.read(`publish-config-${job.requestId}`);
          const rows = priorPublished.rows ? JSON.parse(priorPublished.rows) : [];
          if (rows.length > 0) {
            await this.credentials.write(`draft-${job.id}`, Object.fromEntries(rows.map((row) => [row.key, row.value ?? ""])));
            job.configDraft = {
              artifactHash: fingerprint(job.hashes),
              rows: rows.map(({ value: _value, ...row }) => ({
                key: row.key,
                resource_id: row.resource_id,
                resource_key: row.resource_key,
                local_connection_confirmed: row.local_connection_confirmed === true
              })),
              versionNote: job.versionNote ?? ""
            };
          }
        }
      }
      job.version = void 0;
      job.published = void 0;
      job.restoredVersion = void 0;
      job.requestId = randomUUID4().replaceAll("-", "");
      job.confirmationToken = void 0;
      job.assessment = void 0;
      job.assessmentPending = void 0;
      job.events.push("\u90E8\u7F72\u5305\u5DF2\u751F\u6210\uFF0C\u670D\u52A1\u5668\u6784\u5EFA\u548C\u4E1A\u52A1\u9A8C\u8BC1\u5C1A\u672A\u6267\u884C");
    } catch (error) {
      signal.throwIfAborted();
      job.status = "failed";
      job.failureStage = "preparation";
      job.error = String(error);
    }
    await this.save(root, job);
  }
  async archivePreparedRevision(root, job, revision, contextId2) {
    const form = new FormData();
    form.append("slug", job.slug);
    form.append("revision", revision);
    for (const [name2, field] of [["app.tar", "app_tar"], ["skill.zip", "skill_zip"], ["delivery.json", "delivery_plan"]]) {
      const bytes = await readFile2(join3(root, revision, "bundle", name2));
      if (hash(bytes) !== job.hashes?.[name2]) throw new Error("\u5F85\u5F52\u6863\u5236\u54C1\u6458\u8981\u53D1\u751F\u53D8\u5316");
      form.append(field, new Blob([new Uint8Array(bytes)]), name2);
    }
    const receipt = await this.platform("/deliveries", contextId2, { form });
    if (receipt?.revision?.replaceAll("-", "") !== revision || receipt.slug !== job.slug || receipt.delivery_plan_sha256 !== job.hashes?.["delivery.json"] || receipt.app_tar_sha256 !== job.hashes?.["app.tar"] || receipt.skill_zip_sha256 !== job.hashes?.["skill.zip"]) {
      throw new Error("\u5E73\u53F0\u5F52\u6863\u56DE\u6267\u4E0E\u672C\u6B21\u5236\u54C1\u4E0D\u4E00\u81F4");
    }
    return String(receipt.revision);
  }
  async deploymentConfiguration(job, input, expected) {
    const migrationApproved = job.proposal?.contract?.data_plan?.strategy === "postgres_copy" && input.migrationApproved === true;
    if (job.proposal?.contract?.data_plan?.strategy === "postgres_copy" && !migrationApproved) throw new Error("\u8BF7\u786E\u8BA4\u672C\u8F6E\u6570\u636E\u5E93\u8FC1\u79FB\u548C\u505C\u5199\u7A97\u53E3");
    const rawConfigs = input.config;
    if (!Array.isArray(rawConfigs) || rawConfigs.some((c) => !c || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.key) || typeof c.value !== "string" || c.resource_id !== void 0 && typeof c.resource_id !== "string") || new Set(rawConfigs.map((c) => c.key)).size !== rawConfigs.length) throw new Error("\u914D\u7F6E\u683C\u5F0F\u65E0\u6548");
    const declarations = job.proposal.contract.configs ?? [];
    if (job.proposal.delivery_format === 1 && rawConfigs.some((row) => !declarations.some((item) => item.key === row.key))) {
      throw new Error("\u90E8\u7F72\u914D\u7F6E\u5FC5\u987B\u6765\u81EA\u5F53\u524D\u4EA4\u4ED8\u6E05\u5355\u3002\u5982\u9700\u65B0\u589E\u914D\u7F6E\uFF0C\u8BF7\u8FD4\u56DE\u6539\u9020\u4F1A\u8BDD\u66F4\u65B0\u65B9\u6848\u3002");
    }
    const origValues = await this.credentials.read(`orig-${job.id}`);
    const configs = rawConfigs.map((c) => {
      if (!c.resource_id && !c.value && (c.value_source === "original" || !c.has_value && c.value_source !== "manual") && origValues[c.key]) return { ...c, value: origValues[c.key], value_source: "original" };
      return { ...c, value_source: c.resource_id ? "resource" : "manual" };
    });
    const storageBindings = readStorageBindings(input.storageBindings);
    const declaredMounts = job.proposal.contract.storage_mounts ?? [];
    if (Object.keys(storageBindings).some((path) => !declaredMounts.some((mount) => mount.container_path === path))) {
      throw new Error("\u5B58\u50A8\u9009\u62E9\u5FC5\u987B\u5BF9\u5E94\u5DF2\u786E\u8BA4\u7684\u6301\u4E45\u5316\u76EE\u5F55");
    }
    const existingMounts = (job.upgrade || job.published) && declaredMounts.length ? (await this.platform("/" + job.slug, expected)).storage_mounts ?? [] : [];
    if (job.proposal.delivery_format === 1) {
      for (const mount of declaredMounts) {
        if (mount.resource_id && !storageBindings[mount.container_path] && !existingMounts.some((old) => old.container_path === mount.container_path)) {
          storageBindings[mount.container_path] = mount.resource_id;
        }
      }
    }
    const needsDefaultMountResolution = input.storageBindings !== void 0 && declaredMounts.some((mount) => !storageBindings[mount.container_path] && !existingMounts.some((old) => old.container_path === mount.container_path));
    const ids = [...new Set(configs.flatMap((c) => c.resource_id ? [c.resource_id] : []))].sort();
    const available = ids.length || Object.keys(storageBindings).length || needsDefaultMountResolution ? (await this.platform("/resources", expected, { query: { slug: job.slug } })).resources ?? [] : [];
    if (needsDefaultMountResolution) {
      for (const mount of declaredMounts) {
        if (storageBindings[mount.container_path] || existingMounts.some((old) => old.container_path === mount.container_path)) continue;
        const compatibleDefault = available.find((resource) => resource.is_default === true && (resource.type === "local-directory" || resource.type === "aliyun-oss-volume" && mount.kind !== "sqlite"));
        if (compatibleDefault) {
          storageBindings[mount.container_path] = compatibleDefault.id;
        } else {
          throw new Error("\u8BF7\u4E3A\u65B0\u589E\u6301\u4E45\u5316\u76EE\u5F55\u9009\u62E9 Platform \u5377\u8D44\u6E90");
        }
      }
    }
    for (const [path, id] of Object.entries(storageBindings)) {
      const resource = available.find((resource2) => resource2.id === id && ["local-directory", "aliyun-oss-volume", "docker-volume"].includes(resource2.type));
      if (!resource) throw new Error(`\u6301\u4E45\u5316\u76EE\u5F55\u7684\u5B58\u50A8\u8D44\u6E90\u4E0D\u53EF\u7528\uFF1A${path}`);
      if (resource.type === "aliyun-oss-volume" && declaredMounts.find((mount) => mount.container_path === path)?.kind === "sqlite") {
        throw new Error(`SQLite \u76EE\u5F55\u5FC5\u987B\u4F7F\u7528\u672C\u5730\u78C1\u76D8\u5377\uFF1A${path}`);
      }
    }
    const storageMounts = declaredMounts.map((mount) => {
      const { resource_id: _resource, storage_node_id: _node, ...declaration } = mount;
      return { ...declaration, resource_id: storageBindings[mount.container_path] };
    });
    for (const item of configs) {
      if (item.resource_id && (item.value || !available.some((r) => r.id === item.resource_id && r.env_keys?.includes(item.resource_key || item.key)))) {
        throw new Error(`\u914D\u7F6E\u9879\u7684\u8D44\u6E90\u9009\u62E9\u65E0\u6548\uFF1A${item.key}`);
      }
      if (!item.resource_id && loopbackConnection(item.key, item.value) && item.local_connection_confirmed !== true) {
        throw new Error(`\u8FDE\u63A5\u4ECD\u6307\u5411\u5E94\u7528\u5BB9\u5668\u81EA\u5DF1\uFF0C\u8BF7\u66F4\u6362\u4E3A\u670D\u52A1\u5668\u53EF\u8BBF\u95EE\u5730\u5740\uFF1B\u82E5\u670D\u52A1\u786E\u5B9E\u5C31\u5728\u540C\u4E00\u5BB9\u5668\u5185\uFF0C\u8BF7\u660E\u786E\u786E\u8BA4\uFF1A${item.key}`);
      }
      if (item.key === "PORT" && (item.resource_id || item.value && item.value !== String(job.port ?? 8080))) {
        throw new Error("PORT \u5FC5\u987B\u4E0E\u5DF2\u786E\u8BA4\u7684\u5BB9\u5668\u7AEF\u53E3\u4E00\u81F4\uFF1B\u5982\u9700\u66F4\u6362\u7AEF\u53E3\uFF0C\u8BF7\u91CD\u65B0\u5206\u6790\u751F\u6210\u4EA4\u4ED8\u5305");
      }
    }
    for (const c of declarations) {
      const selected = configs.find((i) => i.key === c.key);
      const preservedOnlineSecret = Boolean((job.upgrade || job.published) && selected?.has_value);
      if (c.required && c.key !== "PORT" && !selected?.value && !selected?.resource_id && !preservedOnlineSecret) throw new Error(`\u8BF7\u586B\u5199\u5FC5\u586B\u914D\u7F6E ${c.key}\uFF0C\u6216\u9009\u62E9\u5339\u914D\u7684\u5E73\u53F0\u6258\u7BA1\u8D44\u6E90\u3002`);
    }
    const bindings = configs.map((c) => ({
      key: c.key,
      value: c.value,
      value_source: c.value_source,
      ...c.has_value === true && !c.value && !c.resource_id ? { has_value: true } : {},
      resource_id: c.resource_id,
      resource_key: c.resource_id ? c.resource_key : void 0,
      required: declarations.some((item) => item.key === c.key && item.required)
    }));
    const note = input.versionNote ?? input.version_note;
    const versionNote = typeof note === "string" && note.trim() ? note.trim() : job.versionNote ?? "";
    const digest = fingerprint({ hashes: job.hashes, url: job.url, port: job.port, bindings, ids, storageMounts, versionNote, migrationApproved });
    return { bindings, configs, ids, storageMounts, versionNote, digest, migrationApproved };
  }
  async confirmDeployment(id, input, expected) {
    const scope = this.scope(expected);
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id);
      if (job.status !== "ready" || !job.proposal || input.artifactHash !== fingerprint(job.hashes)) throw new Error("\u4EA4\u4ED8\u5305\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9");
      await worker({ action: "validate_deployment_scope", root, proposal: job.proposal }, scope.signal);
      const { digest } = await this.deploymentConfiguration(job, input, expected);
      const prior = await this.credentials.read(`confirm-${id}`);
      scope.assertCurrent();
      if (!job.confirmationToken || prior.digest !== digest) {
        job.confirmationToken = randomUUID4();
        job.requestId = randomUUID4().replaceAll("-", "");
        await this.credentials.write(`confirm-${id}`, { digest });
        await this.save(root, job);
      }
      return { confirmationToken: job.confirmationToken, requestId: job.requestId };
    });
  }
  async publish(id, input, expected) {
    const scope = this.scope(expected);
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id);
      if (job.status === "unknown") throw new Error("\u4E0A\u6B21\u53D1\u5E03\u7ED3\u679C\u4ECD\u5F85\u786E\u8BA4\uFF0C\u8BF7\u5148\u68C0\u67E5\u90E8\u7F72\u72B6\u6001");
      if (job.status !== "ready" || input.artifactHash !== fingerprint(job.hashes) || !job.proposal || !job.revision) throw new Error("\u4EA4\u4ED8\u5305\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9");
      if (job.proposal.contract.runtime?.port !== (job.port ?? 8080)) throw new Error("\u4EA4\u4ED8\u5305\u7AEF\u53E3\u4E0E\u5DF2\u786E\u8BA4\u7AEF\u53E3\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u5206\u6790\u5E76\u6253\u5305");
      await worker({ action: "validate_deployment_scope", root, proposal: job.proposal }, scope.signal);
      await worker({ action: "validate_credential_references", root, contract: job.proposal.contract }, scope.signal);
      const { bindings, configs, ids, storageMounts, versionNote, digest, migrationApproved } = await this.deploymentConfiguration(job, input, expected);
      if (!job.confirmationToken || input.confirmationToken !== job.confirmationToken || (await this.credentials.read(`confirm-${id}`)).digest !== digest) {
        throw new Error("\u4EA4\u4ED8\u5305\u3001\u914D\u7F6E\u6216\u8D44\u6E90\u4E0E\u6700\u7EC8\u786E\u8BA4\u4E0D\u4E00\u81F4\uFF0C\u8BF7\u91CD\u65B0\u786E\u8BA4");
      }
      const requestId = job.requestId || randomUUID4().replaceAll("-", "");
      job.versionNote = versionNote;
      job.requestId = requestId;
      job.configKeys = bindings.map((c) => c.key);
      job.resourceIds = ids;
      const form = new FormData(), contract = job.proposal.contract;
      const folder = join3(root, job.revision, "bundle");
      for (const name2 of ["app.tar", "skill.zip"]) {
        const bytes = await readFile2(join3(folder, name2));
        if (hash(bytes) !== job.hashes?.[name2]) throw new Error("\u5236\u54C1\u6458\u8981\u4E0D\u4E00\u81F4\uFF0C\u62D2\u7EDD\u53D1\u5E03");
        form.append(name2 === "app.tar" ? "app_tar" : "skill_zip", new Blob([new Uint8Array(bytes)]), name2);
      }
      if (job.proposal.delivery_format === 1) {
        if (job.archivedRevision?.replaceAll("-", "") !== job.revision) throw new Error("\u672C\u8F6E\u4EA4\u4ED8\u5C1A\u672A\u5F52\u6863\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907");
        const capabilities = await this.platform("/resources", expected, { query: { slug: job.slug } });
        if (capabilities.delivery_format !== 1) throw new Error("\u5F53\u524D Platform \u7248\u672C\u4E0D\u652F\u6301\u6280\u80FD\u9A71\u52A8\u4EA4\u4ED8\uFF0C\u8BF7\u5347\u7EA7\u5E73\u53F0\u540E\u91CD\u65B0\u53D1\u5E03");
        const plan = await readFile2(join3(folder, "delivery.json"));
        if (hash(plan) !== job.hashes?.["delivery.json"]) throw new Error("\u4EA4\u4ED8\u6E05\u5355\u6458\u8981\u4E0D\u4E00\u81F4\uFF0C\u62D2\u7EDD\u53D1\u5E03");
        form.append("delivery_plan", plan.toString("utf8"));
        form.append("delivery_revision", job.archivedRevision);
        if (migrationApproved) form.append("migration_approved", "true");
      }
      let dockerfileContent = job.dockerfileContent ?? "";
      if (!dockerfileContent) {
        dockerfileContent = await readFile2(join3(root, job.revision, "approved/source/Dockerfile"), "utf8").catch(() => "");
      }
      for (const [key, value] of Object.entries({
        slug: job.slug,
        name: job.name,
        description: contract.description || job.description || "",
        container_port: String(contract.runtime.port),
        language: contract.runtime.language,
        runtime_version: contract.runtime.version,
        dockerfile_content: dockerfileContent,
        request_id: requestId,
        skill_zip_sha256: job.hashes?.["skill.zip"] ?? "",
        version_note: versionNote,
        app_config: JSON.stringify(bindings),
        resource_ids: JSON.stringify(ids),
        storage_mounts: JSON.stringify(storageMounts)
      })) form.append(key, String(value));
      scope.assertCurrent();
      await this.credentials.write(`publish-config-${requestId}`, { rows: JSON.stringify(configs) });
      scope.assertCurrent();
      job.status = "publishing";
      job.failureStage = void 0;
      job.error = void 0;
      job.checks = void 0;
      await this.save(root, job);
      this.core.emit("skills-changed");
      try {
        const result = await this.platform("/publish", expected, { form });
        if (result.app_url !== job.url) throw new Error("\u5E73\u53F0\u8FD4\u56DE\u5730\u5740\u4E0E\u786E\u8BA4\u5730\u5740\u4E0D\u540C");
        if (!await this.applyPublishReceipt(scope.directory, root, job, result)) throw new Error("\u5E73\u53F0\u5C1A\u672A\u786E\u8BA4\u53D1\u5E03\u8BF7\u6C42");
        job.events.push("\u5DF2\u4E0A\u4F20\u7ECF\u8FC7\u786E\u8BA4\u7684\u540C\u4E00\u4EA4\u4ED8\u5305\uFF0C\u7B49\u5F85\u670D\u52A1\u5668\u6784\u5EFA\u4E0E\u4E1A\u52A1\u9A8C\u8BC1");
      } catch (error) {
        if (error instanceof AppRequestError && [400, 401, 403, 404, 409, 413, 422].includes(error.status)) {
          job.status = "ready";
          job.error = error.message;
        } else {
          let reconciled = false;
          try {
            const reqState = await this.platform(`/${job.slug}/requests/${requestId}`, expected);
            reconciled = await this.applyPublishReceipt(scope.directory, root, job, reqState);
            if (reconciled && reqState.status !== "failed") {
              job.events.push("\u4E0A\u4F20\u8FDE\u63A5\u4E2D\u65AD\u540E\u5DF2\u901A\u8FC7\u5E42\u7B49\u8BF7\u6C42\u53F7\u6838\u5B9E\u5E73\u53F0\u63A5\u6536\u72B6\u6001");
            }
          } catch {
          }
          if (!reconciled) {
            job.status = "unknown";
            job.error = "\u53D1\u5E03\u7ED3\u679C\u672A\u786E\u8BA4\uFF0C\u7981\u6B62\u81EA\u52A8\u91CD\u8BD5\uFF1A" + String(error);
          }
        }
      }
      await this.save(root, job);
      return this.public(job, root);
    });
  }
  async verify(id, expected, options) {
    const scope = this.scope(expected);
    if (options?.automatic === true && this.busy.has(id)) {
      const { root, job } = await this.open(scope.directory, id);
      if (job.proposal?.delivery_format === 1 && job.archivedRevision && job.requestId) {
        if (this.analyses.has(id) || options?.automatic && job.assessmentPending) return this.public(job, root);
        if (!["building", "unknown", "verifying", "failed", "verified"].includes(job.status)) return this.public(job, root);
        return this.advancePreparedDelivery(root, job, expected);
      }
      return this.public(job, root);
    }
    return this.exclusive(id, async () => {
      const { root, job } = await this.open(scope.directory, id);
      if (options?.automatic === true && !["building", "unknown"].includes(job.status)) {
        const view2 = this.public(job, root);
        if (job.status === "verified") view2.userDisabled = await this.isSkillDisabled(scope.directory, job.slug);
        return view2;
      }
      if (!["building", "unknown", "awaiting_page_verification", "verified", "failed", "publishing", "verifying"].includes(job.status) || !job.hashes || !job.proposal) throw new Error("\u5E94\u7528\u5C1A\u672A\u53D1\u5E03");
      if (job.status === "unknown" || job.status === "publishing" || job.status === "building" && !job.version && job.requestId) {
        if (!job.requestId) throw new Error("\u7F3A\u5C11\u4E0A\u6B21\u53D1\u5E03\u8BF7\u6C42\u53F7\uFF0C\u65E0\u6CD5\u6838\u5BF9\u7ED3\u679C");
        const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected);
        if (!await this.applyPublishReceipt(scope.directory, root, job, receipt)) return this.public(job, root);
        await this.save(root, job);
        if (receipt.status === "failed" || !job.version) return this.public(job, root);
      }
      const contract = job.proposal.contract;
      const supplied = {};
      if (options?.credentials !== void 0) {
        if (!options.credentials || typeof options.credentials !== "object" || Array.isArray(options.credentials)) {
          throw new Error("\u4E1A\u52A1\u9A8C\u8BC1\u51ED\u636E\u683C\u5F0F\u65E0\u6548");
        }
        const authKeys = new Set(verificationCredentialFields(contract).map((field) => field.key));
        for (const [key, value] of Object.entries(options.credentials)) {
          if (!authKeys.has(key) || typeof value !== "string" || value.length > 16384 || /[\r\n\0]/.test(value)) {
            throw new Error("\u4E1A\u52A1\u9A8C\u8BC1\u51ED\u636E\u65E0\u6548\uFF0C\u8BF7\u4EC5\u586B\u5199\u672C\u5E94\u7528\u58F0\u660E\u7684\u767B\u5F55\u51ED\u636E");
          }
          supplied[key] = value;
        }
      }
      const remote = await this.platform("/" + job.slug, expected);
      if (remote.status === "running" && job.version && remote.current_version !== job.version) {
        const history = await this.platform("/" + job.slug + "/versions", expected);
        const attempted = history.versions?.find((version) => version.version === job.version);
        if (attempted?.status === "failed" && attempted.app_tar_sha256 === job.hashes["app.tar"] && attempted.skill_zip_sha256 === job.hashes["skill.zip"]) {
          this.recordFailureState(job, attempted.error_message || "\u672C\u6B21\u53D1\u5E03\u5931\u8D25\uFF0C\u65E7\u7248\u672C\u4ECD\u5728\u8FD0\u884C", attempted.build_log?.slice(-8e3), job.version);
          await this.save(root, job);
          this.core.emit("skills-changed");
          return this.public(job, root);
        }
        if (attempted && ["accepted", "building"].includes(attempted.status) && attempted.app_tar_sha256 === job.hashes["app.tar"] && attempted.skill_zip_sha256 === job.hashes["skill.zip"]) {
          return this.public(job, root);
        }
      }
      if (remote.status !== "running") {
        if (!["failed", "unhealthy"].includes(remote.status)) return this.public(job, root);
        if (job.version && remote.current_version !== job.version) throw new Error("\u7EBF\u4E0A\u7248\u672C\u53D1\u751F\u53D8\u5316\uFF0C\u65E0\u6CD5\u9A8C\u8BC1\u6B64\u4EA4\u4ED8\u4EFB\u52A1");
        this.recordFailureState(job, remote.error_message || "\u5E94\u7528\u6784\u5EFA\u6216\u542F\u52A8\u5931\u8D25", remote.build_log?.slice(-8e3), job.version);
        await this.save(root, job);
        this.core.emit("skills-changed");
        return this.public(job, root);
      }
      if (remote.app_url !== job.url || job.version && remote.current_version !== job.version) throw new Error("\u7EBF\u4E0A\u7248\u672C\u6216\u5730\u5740\u4E0D\u4E00\u81F4\uFF0C\u62D2\u7EDD\u542F\u7528\u6280\u80FD");
      if (!matchesReceipt(remote.build_log, job.hashes)) throw new Error("\u670D\u52A1\u5668\u5236\u54C1\u56DE\u6267\u4E0D\u4E00\u81F4");
      job.status = "verifying";
      job.failureStage = void 0;
      job.error = void 0;
      job.checks = void 0;
      job.pagesVerified = void 0;
      await this.save(root, job);
      try {
        await worker({ action: "validate_verification_contract", root, contract }, scope.signal);
        const credentials = { ...await this.readVersionCredentials(job, remote.app_config), ...supplied };
        const healthPath = contract.health?.path;
        const checks = [];
        for (const test of contract.verification?.cases ?? []) {
          const api = contract.apis.find((a) => a.id === test.operation);
          if (!api) throw new Error(`\u4E1A\u52A1\u9A8C\u8BC1\u63A5\u53E3\u4E0D\u5B58\u5728\uFF1A${test.operation}`);
          if (api.path === healthPath) {
            if (job.restoredVersion) throw new Error("\u56DE\u6EDA\u540E\u5FC5\u987B\u4F7F\u7528\u6709\u6548\u7684\u53EA\u8BFB\u4E1A\u52A1\u63A5\u53E3\u9A8C\u8BC1");
            continue;
          }
          if (api.effect !== "read") throw new Error("\u4E1A\u52A1\u9A8C\u8BC1\u53EA\u80FD\u4F7F\u7528\u53EA\u8BFB\u63A5\u53E3");
          const result = await worker({
            action: "probe",
            root,
            contract,
            operation: test.operation,
            params: test.params ?? {},
            body: test.body,
            credentials,
            skill_markdown: job.skillMarkdown
          }, scope.signal);
          if (!probeMatches(result, test.status ?? 200, test.json_contains)) throw new Error(`\u4E1A\u52A1\u9A8C\u8BC1\u5931\u8D25\uFF1A${test.operation}`);
          checks.push({ operation: test.operation, status: result.status });
        }
        const latest = await this.platform("/" + job.slug, expected);
        if (latest.status !== "running" || latest.current_version !== remote.current_version || latest.app_url !== job.url || latest.config_fingerprint !== remote.config_fingerprint || !matchesReceipt(latest.build_log, job.hashes)) {
          throw new Error("\u4E1A\u52A1\u9A8C\u8BC1\u671F\u95F4\u7EBF\u4E0A\u90E8\u7F72\u53D1\u751F\u53D8\u5316");
        }
        if (!checks.length) {
          const hasPages = Array.isArray(contract.pages) && contract.pages.length > 0;
          const hasNonHealthApis = (contract.apis ?? []).some((a) => a.path !== healthPath);
          if (hasPages && !hasNonHealthApis && options?.confirmPageVerification === true) {
            scope.assertCurrent();
            await this.demoteOtherJobsForSlug(scope.directory, job.slug, job.id);
            job.configFingerprint = latest.config_fingerprint;
            job.published = true;
            job.superseded = void 0;
            job.checks = [{ operation: "page_verification", status: 200 }];
            job.pagesVerified = true;
            job.version = remote.current_version;
            job.status = "verified";
            job.events.push("\u5DF2\u5B8C\u6210\u4EBA\u5DE5\u9875\u9762\u9A8C\u6536");
          } else if (hasPages && !hasNonHealthApis) {
            scope.assertCurrent();
            job.configFingerprint = latest.config_fingerprint;
            job.published = true;
            job.superseded = void 0;
            job.version = remote.current_version;
            job.status = "awaiting_page_verification";
            job.events.push("\u5E94\u7528\u5DF2\u90E8\u7F72\uFF0C\u8BF7\u5728\u5E94\u7528\u7BA1\u7406\u4E2D\u5B8C\u6210\u9875\u9762\u9A8C\u6536");
          } else {
            throw new Error("\u7F3A\u5C11\u53EA\u8BFB\u4E1A\u52A1\u9A8C\u8BC1\uFF1B\u9875\u9762\u5E94\u7528\u9700\u8981\u5355\u72EC\u9A8C\u6536\uFF0C\u4E0D\u80FD\u81EA\u52A8\u542F\u7528");
          }
        } else {
          scope.assertCurrent();
          await this.demoteOtherJobsForSlug(scope.directory, job.slug, job.id);
          job.configFingerprint = latest.config_fingerprint;
          job.published = true;
          job.superseded = void 0;
          if (options?.rememberCredentials === true && Object.keys(supplied).length) {
            await this.credentials.write(`version-${job.id}-${remote.current_version}`, credentials);
          }
          job.checks = checks;
          job.version = remote.current_version;
          job.status = "verified";
          job.events.push("\u53EA\u8BFB\u4E1A\u52A1\u9A8C\u8BC1\u901A\u8FC7\uFF1B\u9875\u9762\u5C1A\u672A\u9A8C\u8BC1");
        }
      } catch (error) {
        this.recordFailureState(job, String(error), remote.build_log?.slice(-8e3), remote.current_version ?? job.version, "verification");
      }
      await this.save(root, job);
      this.core.emit("skills-changed");
      const view = this.public(job, root);
      if (job.status === "verified") view.userDisabled = await this.isSkillDisabled(scope.directory, job.slug);
      return view;
    });
  }
  async advancePreparedDelivery(root, job, expected, onChatReady) {
    const scope = this.scope(expected);
    const path = `/${job.slug}/requests/${job.requestId}`;
    const receipt = await this.platform(path, expected);
    if (receipt.status === "unknown") {
      onChatReady?.();
      return this.public(job, root);
    }
    checkPublishReceipt(job, receipt);
    if (receipt.status === "running") {
      await this.completeAssessedDelivery(root, job, receipt, expected);
      onChatReady?.();
      return this.public(job, root);
    }
    if (receipt.status === "failed") {
      await this.applyPublishReceipt(scope.directory, root, job, receipt);
      job.assessmentPending = void 0;
      await this.save(root, job);
      onChatReady?.();
      return this.public(job, root);
    }
    if (receipt.status !== "built" && receipt.status !== "runtime_ready") {
      onChatReady?.();
      return this.public(job, root);
    }
    if (!this.analyze) throw new Error("\u5F53\u524D DSH \u7248\u672C\u4E0D\u652F\u6301\u5E94\u7528 AI \u9A8C\u6536");
    const controller = new AbortController();
    const signal = AbortSignal.any([scope.signal, controller.signal]);
    const run = { phase: receipt.status === "built" ? "build" : "runtime" };
    job.status = "verifying";
    job.assessmentPending = void 0;
    job.events.push(run.phase === "build" ? "AI \u6B63\u5728\u6838\u5BF9\u5019\u9009\u6784\u5EFA" : "AI \u6B63\u5728\u9A8C\u6536\u8FD0\u884C\u4E2D\u7684\u5019\u9009\u7248\u672C");
    this.analyses.set(job.id, controller);
    try {
      await this.save(root, job);
    } catch (error) {
      this.analyses.delete(job.id);
      throw error;
    }
    void (async () => {
      try {
        await this.analyze(job, root, "", signal, async (sessionId) => {
          signal.throwIfAborted();
          job.analysisSessionId = sessionId;
          job.analysisSessions = [.../* @__PURE__ */ new Set([...job.analysisSessions ?? [], sessionId])];
          await this.save(root, job);
          onChatReady?.();
        }, Boolean(onChatReady), run);
        if (!run.result) throw new Error("AI \u5C1A\u672A\u63D0\u4EA4\u9A8C\u6536\u7ED3\u8BBA");
        job.assessment = run.result;
        await this.save(root, job);
        const result = await this.platform(path + "/assessment", expected, { body: run.result });
        if (result.status === "running") {
          await this.completeAssessedDelivery(root, job, result, expected);
        } else {
          if (!await this.applyPublishReceipt(scope.directory, root, job, result)) throw new Error("\u5E73\u53F0\u672A\u786E\u8BA4\u672C\u8F6E\u9A8C\u6536");
          await this.save(root, job);
        }
      } catch (error) {
        if (scope.signal.aborted) return;
        job.assessmentPending = true;
        this.recordFailureState(job, String(error), void 0, job.version, "verification");
        await this.save(root, job);
      } finally {
        this.analyses.delete(job.id);
        onChatReady?.();
        this.core.emit("change");
        this.core.emit("skills-changed");
      }
    })().catch(() => {
    });
    return this.public(job, root);
  }
  async completeAssessedDelivery(root, job, receipt, expected) {
    const scope = this.scope(expected);
    checkPublishReceipt(job, receipt);
    let assessment;
    if (typeof receipt.delivery_assessment === "string") {
      assessment = JSON.parse(receipt.delivery_assessment || "{}").runtime;
    }
    if (assessment?.outcome !== "passed" || !assessment.evidence.length) throw new Error("\u53D1\u5E03\u8BB0\u5F55\u7F3A\u5C11\u672C\u7248\u672C\u7684 AI \u4E1A\u52A1\u9A8C\u6536\u7ED3\u8BBA");
    const remote = await this.platform(`/${job.slug}`, expected);
    if (remote.current_version !== receipt.published_version || remote.app_url !== job.url || !matchesReceipt(remote.build_log, job.hashes)) {
      throw new Error("\u9A8C\u6536\u7ED3\u679C\u4E0E\u5F53\u524D\u751F\u6548\u7248\u672C\u4E0D\u4E00\u81F4");
    }
    await this.applyPublishReceipt(scope.directory, root, job, receipt);
    await this.demoteOtherJobsForSlug(scope.directory, job.slug, job.id);
    job.status = "verified";
    job.assessment = assessment;
    job.assessmentPending = void 0;
    job.configFingerprint = remote.config_fingerprint;
    job.checks = [{ operation: "ai_delivery_assessment" }];
    job.superseded = void 0;
    await this.save(root, job);
  }
  async observeDeployment(job, root, input, expected, signal) {
    const receipt = await this.platform(`/${job.slug}/requests/${job.requestId}`, expected);
    checkPublishReceipt(job, receipt);
    if (input.kind === "rehearsal") {
      if (receipt.status !== "built" || job.proposal?.contract?.data_plan?.strategy !== "postgres_copy") throw new Error("\u672C\u8F6E\u4EA4\u4ED8\u6CA1\u6709\u5F85\u6F14\u7EC3\u7684\u6570\u636E\u8FC1\u79FB");
      return this.platform(`/${job.slug}/requests/${job.requestId}/rehearsal`, expected, { body: {} });
    }
    if (input.kind === "state") {
      const logs = receipt.status === "runtime_ready" ? await this.platform(`/${job.slug}/logs`, expected).catch(() => ({})) : {};
      const log = [receipt.build_log, receipt.error_message, logs.runtime_logs].filter(Boolean).join("\n").slice(-8e3);
      return {
        status: receipt.status,
        image: receipt.image,
        rehearsal: receipt.migration_rehearsal || void 0,
        migration: receipt.migration_execution || void 0,
        logs: await worker({ action: "redact_feedback", root, text: log }, signal)
      };
    }
    if (receipt.status !== "runtime_ready") throw new Error("\u5019\u9009\u7248\u672C\u8FD8\u6CA1\u6709\u8FDB\u5165\u8FD0\u884C\u6001");
    if (input.kind === "operation") {
      const contract = job.proposal.contract;
      const api = contract.apis.find((item) => item.id === input.operation);
      if (!api || api.effect !== "read") throw new Error("\u9A8C\u6536\u53EA\u5141\u8BB8\u8C03\u7528\u5DF2\u58F0\u660E\u7684\u53EA\u8BFB\u4E1A\u52A1\u64CD\u4F5C");
      const credentials = await this.readVersionCredentials(job);
      const result = await worker({
        action: "probe",
        root,
        contract,
        operation: input.operation,
        params: input.params ?? {},
        body: input.body,
        credentials,
        skill_markdown: job.skillMarkdown
      }, signal);
      let content = String(result.content ?? "").slice(0, 4e3);
      for (const value of Object.values(credentials)) if (typeof value === "string" && value) content = content.replaceAll(value, "[REDACTED]");
      return {
        operation: input.operation,
        status: result.status,
        content_type: result.content_type,
        content: await worker({ action: "redact_feedback", root, text: content }, signal)
      };
    }
    const path = String(input.path ?? "/");
    if (!path.startsWith("/") || path.startsWith("//") || /[\\\0\r\n]/.test(path)) throw new Error("\u8BF7\u63D0\u4F9B\u8BE5\u5E94\u7528\u7684\u7AD9\u5185\u8DEF\u5F84");
    const url = new URL(path, job.url);
    if (url.origin !== new URL(job.url).origin) throw new Error("\u9A8C\u6536\u8BF7\u6C42\u5FC5\u987B\u7559\u5728\u5E94\u7528\u57DF\u540D\u5185");
    const expectedStatuses = input.expected_statuses ?? [];
    const waitSeconds = input.within_seconds ?? 0;
    if (!Array.isArray(expectedStatuses) || expectedStatuses.length > 20 || expectedStatuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599) || !Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 90 || waitSeconds > 0 && !expectedStatuses.length) {
      throw new Error("\u7B49\u5F85\u5165\u53E3\u5C31\u7EEA\u65F6\u9700\u63D0\u4F9B\u9884\u671F HTTP \u72B6\u6001\u53CA 1\u201390 \u79D2\u7684\u7B49\u5F85\u65F6\u95F4");
    }
    const deadline = Date.now() + waitSeconds * 1e3;
    const method = input.method === "HEAD" ? "HEAD" : "GET";
    let last = { path };
    do {
      signal.throwIfAborted();
      const timeout = waitSeconds ? Math.min(1e4, Math.max(1, deadline - Date.now())) : 1e4;
      try {
        const response = await fetch(url, { method, redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
        await response.body?.cancel();
        const location = response.headers.get("location");
        const redirectPath = location ? URL.parse(location, url) : void 0;
        last = {
          path,
          status: response.status,
          content_type: response.headers.get("content-type"),
          redirect_path: redirectPath?.origin === url.origin ? redirectPath?.pathname : void 0
        };
        if (!expectedStatuses.length || expectedStatuses.includes(response.status)) return last;
      } catch {
        signal.throwIfAborted();
        last = { path, connection_error: "\u672A\u6536\u5230\u6709\u6548\u7684 HTTP \u54CD\u5E94" };
      }
      if (Date.now() < deadline) await delay2(Math.min(1e3, deadline - Date.now()), void 0, { signal });
    } while (Date.now() < deadline);
    return last;
  }
  async versions(slug, expected) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    return this.platform(`/${slug}/versions`, expected);
  }
  async logs(slug, expected) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    return this.platform(`/${slug}/logs`, expected);
  }
  async storage(slug, expected) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    return this.platform(`/${slug}/storage`, expected);
  }
  downloadTarget(slug, selection) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    if (selection.storage === true || typeof selection.mount === "string" && selection.mount) {
      return {
        path: `/${slug}/storage/backup`,
        filename: `${slug}-storage-backup.tar`,
        query: selection.mount ? { mount: String(selection.mount) } : void 0
      };
    }
    const { version, artifact } = selection;
    if (!Number.isSafeInteger(version) || version < 1 || !["app.tar", "skill.zip", "Dockerfile", "manifest.json", "delivery.json"].includes(artifact)) {
      throw new Error("\u65E0\u6548\u7248\u672C\u6587\u4EF6");
    }
    return { path: `/${slug}/versions/${version}/artifacts/${artifact}`, filename: `${slug}-v${version}-${artifact}` };
  }
  async download(slug, selection, expected) {
    const scope = this.scope(expected);
    const { filename, path, query } = this.downloadTarget(slug, selection);
    const result = await this.platform(path, expected, { query, download: true });
    scope.assertCurrent();
    if (!Buffer.isBuffer(result.bytes) || !result.bytes.length || result.sha256 && hash(result.bytes) !== result.sha256) {
      throw new Error("\u5E73\u53F0\u8FD4\u56DE\u6587\u4EF6\u4E3A\u7A7A\u6216\u6458\u8981\u4E0D\u5339\u914D");
    }
    return { filename, base64: result.bytes.toString("base64") };
  }
  async saveDownload(slug, selection, expected, downloads = join3(homedir2(), "Downloads")) {
    const scope = this.scope(expected);
    const { filename, path, query } = this.downloadTarget(slug, selection);
    await mkdir3(downloads, { recursive: true, mode: 448 });
    const temp = join3(downloads, `.opc-${randomUUID4()}.download`);
    const response = await this.platform(path, expected, { query, stream: true });
    if (!response.body) throw new Error("\u5E73\u53F0\u672A\u8FD4\u56DE\u6587\u4EF6\u5185\u5BB9");
    try {
      const digest = createHash5("sha256");
      let bytes = 0;
      const checksum = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        digest.update(chunk);
        callback(null, chunk);
      } });
      await pipeline(response.body, checksum, createWriteStream(temp, { flags: "wx", mode: 384 }), { signal: scope.signal });
      const expectedHash = response.headers.get("x-artifact-sha256");
      if (!bytes || expectedHash && digest.digest("hex") !== expectedHash) throw new Error("\u5E73\u53F0\u8FD4\u56DE\u6587\u4EF6\u4E3A\u7A7A\u6216\u6458\u8981\u4E0D\u5339\u914D");
      scope.assertCurrent();
      const preferred = join3(downloads, filename);
      let dest = preferred;
      try {
        await link(temp, dest);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        dest = join3(downloads, `${randomUUID4().slice(0, 8)}-${filename}`);
        await link(temp, dest);
      }
      return { path: dest };
    } finally {
      await rm2(temp, { force: true });
    }
  }
  async recheck(slug, expected) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    return this.platform(`/${slug}/recheck`, expected, { method: "POST", body: {} });
  }
  async updateConfig(slug, body, expected) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    const scope = this.scope(expected);
    const result = await this.platform(`/${slug}/config`, expected, { method: "PUT", body });
    const activeVersion = result.current_version ?? result.version;
    for (const parent of await this.directories(scope.directory)) {
      const entries = await readdir2(parent).catch(() => []);
      for (const id of entries.filter((e) => /^[a-f0-9-]{36}$/.test(e))) {
        const opened = await this.open(scope.directory, id).catch(() => void 0);
        const eligibleStatus = ["verified", "awaiting_page_verification"].includes(opened?.job.status ?? "") || opened?.job.published && opened.job.status === "failed" && opened.job.failureStage === "verification";
        if (opened && opened.job.slug === slug && !opened.job.superseded && eligibleStatus) {
          if (activeVersion && opened.job.version && opened.job.version !== activeVersion) continue;
          if (Number.isInteger(body.container_port) && body.container_port >= 1 && body.container_port <= 65535) {
            opened.job.port = body.container_port;
          }
          if (Array.isArray(body.app_config)) {
            const secretKeys = new Set(
              (opened.job.proposal?.contract?.configs ?? []).filter((cfg) => cfg.secret).map((cfg) => cfg.key)
            );
            const requestId = opened.job.requestId ||= randomUUID4().replaceAll("-", "");
            const existingSaved = await this.credentials.read(`publish-config-${requestId}`);
            const existingRows = existingSaved.rows ? JSON.parse(existingSaved.rows) : [];
            const existingByKey = new Map(existingRows.map((row) => [row.key, row]));
            const nextRows = body.app_config.map((row) => {
              const prior = existingByKey.get(row.key);
              const keepSecret = secretKeys.has(row.key) && !row.resource_id && !row.value && prior && !prior.resource_id && prior.value;
              return {
                ...row,
                value: row.resource_id ? "" : keepSecret ? prior.value : row.value ?? ""
              };
            });
            await this.credentials.write(`publish-config-${requestId}`, { rows: JSON.stringify(nextRows) });
            if (opened.job.version) {
              const versionKey = `version-${opened.job.id}-${opened.job.version}`;
              const versionCreds = await this.credentials.read(versionKey);
              const updatedVersionCreds = { ...versionCreds };
              let touchedVersionCreds = false;
              for (const row of nextRows) {
                if (row.key in updatedVersionCreds && !row.resource_id && typeof row.value === "string" && row.value) {
                  updatedVersionCreds[row.key] = row.value;
                  touchedVersionCreds = true;
                }
              }
              if (touchedVersionCreds) await this.credentials.write(versionKey, updatedVersionCreds);
            }
          }
          opened.job.status = "building";
          opened.job.failureStage = void 0;
          opened.job.error = void 0;
          opened.job.configFingerprint = void 0;
          opened.job.pagesVerified = void 0;
          opened.job.events.push("\u8FD0\u884C\u914D\u7F6E\u5DF2\u66F4\u65B0\uFF0C\u9700\u91CD\u65B0\u9A8C\u8BC1\u4E1A\u52A1\u540E\u542F\u7528\u6280\u80FD");
          await this.save(opened.root, opened.job);
        }
      }
    }
    this.core.emit("skills-changed");
    return result;
  }
  async deleteApp(slug, purgeVolumes, expected) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug)) throw new Error("\u65E0\u6548\u5E94\u7528\u6807\u8BC6");
    return this.platform(`/${slug}`, expected, { method: "DELETE", query: purgeVolumes ? { purge_volumes: "true" } : void 0 });
  }
  async rollback(slug, targetVersion, reason, expected) {
    if (!/^[a-z][a-z0-9-]{2,39}$/.test(slug) || !Number.isInteger(targetVersion) || targetVersion <= 0) throw new Error("\u56DE\u6EDA\u53C2\u6570\u65E0\u6548");
    const scope = this.scope(expected);
    const rbResult = await this.platform(`/${slug}/rollback`, expected, {
      method: "POST",
      body: { target_version: targetVersion, reason: reason || `\u56DE\u9000\u81F3\u7248\u672C v${targetVersion}` }
    });
    try {
      return await this.syncRolledBackSkill(slug, targetVersion, expected, rbResult, scope);
    } catch (error) {
      scope.assertCurrent();
      return {
        ...rbResult,
        active_version: targetVersion,
        local_skill_synced: false,
        local_skill_verified: false,
        skill_enabled: false,
        verification: { status: "probe-warning", detail: `\u5E94\u7528\u5DF2\u56DE\u9000\uFF0C\u6280\u80FD\u672A\u540C\u6B65\u6216\u672A\u9A8C\u8BC1\uFF1A${String(error)}` },
        rollback_notice: ROLLBACK_NOTICE
      };
    }
  }
  async syncRolledBackSkill(slug, targetVersion, expected, rbResult, scope) {
    const current = await this.platform(`/${slug}`, expected);
    if (current.status !== "running" || current.current_version !== targetVersion) {
      throw new Error("\u56DE\u6EDA\u540E\u7EBF\u4E0A\u7248\u672C\u72B6\u6001\u4E0D\u4E00\u81F4");
    }
    if (rbResult.config_fingerprint && current.config_fingerprint && rbResult.config_fingerprint !== current.config_fingerprint) {
      throw new Error("\u56DE\u6EDA\u540E\u8FD0\u884C\u914D\u7F6E\u6307\u7EB9\u4E0D\u4E00\u81F4");
    }
    const verInfo = rbResult.version ?? {};
    let expectedSkillSha = String(rbResult.skill_zip_sha256 || verInfo.skill_zip_sha256 || "").trim();
    let expectedAppTarSha = String(verInfo.app_tar_sha256 || "").trim();
    const localMeta = await readFile2(join3(scope.directory, "versions", slug, `v${targetVersion}`, "summary.json"), "utf8").then((s) => JSON.parse(s)).catch(() => void 0);
    let skillZipBytes;
    try {
      const dl = await this.platform(`/${slug}/versions/${targetVersion}/artifacts/skill.zip`, expected);
      if (dl?.bytes && Buffer.isBuffer(dl.bytes) && dl.bytes.length > 0) {
        skillZipBytes = dl.bytes;
      } else if (typeof dl?.skill_zip_b64 === "string" && dl.skill_zip_b64.length > 0) {
        skillZipBytes = Buffer.from(dl.skill_zip_b64, "base64");
      }
    } catch (error) {
      if (!(error instanceof AppRequestError) || error.status !== 404) throw error;
      const verDir = join3(scope.directory, "versions", slug, `v${targetVersion}`);
      const localFallback = join3(verDir, "skill.zip");
      if (existsSync3(localFallback)) {
        skillZipBytes = await readFile2(localFallback).catch(() => void 0);
      }
      if (localMeta) {
        if (!expectedSkillSha && localMeta?.hashes?.["skill.zip"]) expectedSkillSha = String(localMeta.hashes["skill.zip"]);
        if (!expectedAppTarSha && localMeta?.hashes?.["app.tar"]) expectedAppTarSha = String(localMeta.hashes["app.tar"]);
      }
    }
    if (skillZipBytes) {
      if (!expectedSkillSha || hash(skillZipBytes) !== expectedSkillSha) {
        throw new Error("\u56DE\u6EDA\u6280\u80FD\u5305\u6458\u8981\u4E0D\u4E00\u81F4\uFF0C\u62D2\u7EDD\u542F\u7528");
      }
      const verDir = join3(scope.directory, "versions", slug, `v${targetVersion}`);
      await mkdir3(verDir, { recursive: true, mode: 448 });
      await writeFile3(join3(verDir, "skill.zip"), skillZipBytes, { mode: 384 }).catch(() => {
      });
    }
    const matchingJobs = [];
    for (const parent of await this.directories(scope.directory)) {
      const entries = await readdir2(parent).catch(() => []);
      for (const id of entries.filter((e) => /^[a-f0-9-]{36}$/.test(e))) {
        const opened = await this.open(scope.directory, id).catch(() => void 0);
        if (opened && opened.job.slug === slug) {
          matchingJobs.push(opened);
        }
      }
    }
    let primary = matchingJobs.find(({ job }) => job.published && job.version === targetVersion && job.hashes?.["app.tar"] === expectedAppTarSha && job.hashes?.["skill.zip"] === expectedSkillSha);
    if (!primary && skillZipBytes) {
      const newId = randomUUID4();
      const newRoot = join3(scope.directory, newId);
      const newJob = {
        id: newId,
        name: current.name || slug,
        slug,
        url: current.app_url || verInfo.app_url || "",
        session: "rollback",
        status: "building",
        published: true,
        version: targetVersion,
        requestId: typeof localMeta?.requestId === "string" && /^[a-f0-9]+$/.test(localMeta.requestId) && localMeta.hashes?.["app.tar"] === expectedAppTarSha && localMeta.hashes?.["skill.zip"] === expectedSkillSha ? localMeta.requestId : void 0,
        port: current.container_port ?? verInfo.container_port,
        createdAt: Date.now(),
        events: [`\u4ECE\u5E73\u53F0\u540C\u6B65\u56DE\u9000\u7248\u672C v${targetVersion}`],
        proposal: { summary: `\u56DE\u9000\u81F3\u7248\u672C v${targetVersion}`, unresolved: [], changes: [], contract: {} }
      };
      await this.save(newRoot, newJob);
      primary = { root: newRoot, job: newJob };
      matchingJobs.push(primary);
    }
    let localSkillSynced = false;
    let localSkillVerified = false;
    let verification;
    for (const opened of matchingJobs) {
      if (opened !== primary) {
        if (["verified", "awaiting_page_verification"].includes(opened.job.status)) {
          opened.job.status = "ready";
          opened.job.superseded = true;
          opened.job.events.push(`\u5E94\u7528\u5DF2\u56DE\u9000\u81F3 v${targetVersion}\uFF0C\u65E7\u4EFB\u52A1\u6280\u80FD\u5DF2\u505C\u7528`);
          await this.save(opened.root, opened.job);
        } else if (opened.job.published && !opened.job.superseded) {
          opened.job.superseded = true;
          await this.save(opened.root, opened.job);
        }
        continue;
      }
      opened.job.version = targetVersion;
      opened.job.published = true;
      opened.job.restoredVersion = true;
      opened.job.superseded = void 0;
      opened.job.pagesVerified = void 0;
      opened.job.checks = void 0;
      opened.job.configFingerprint = current.config_fingerprint ?? rbResult.config_fingerprint;
      if (expectedAppTarSha && expectedSkillSha) {
        opened.job.hashes = {
          ...opened.job.hashes ?? {},
          "app.tar": expectedAppTarSha,
          "skill.zip": expectedSkillSha
        };
      }
      if (skillZipBytes && opened.job.proposal) {
        const extracted = await worker({
          action: "extract_skill_contract",
          root: opened.root,
          skill_zip_b64: skillZipBytes.toString("base64"),
          expected_sha256: expectedSkillSha,
          slug,
          app_url: opened.job.url || current.app_url || ""
        }, scope.signal);
        opened.job.proposal.contract = extracted.contract;
        if (extracted.skill_markdown) {
          opened.job.skillMarkdown = extracted.skill_markdown;
        }
        opened.job.hashes = {
          ...opened.job.hashes ?? {},
          "app.tar": expectedAppTarSha || opened.job.hashes?.["app.tar"] || "",
          "skill.zip": extracted.sha256
        };
        localSkillSynced = true;
      }
      if (localSkillSynced && opened.job.proposal?.contract && matchesReceipt(current.build_log, opened.job.hashes)) {
        try {
          const contract = opened.job.proposal.contract;
          await worker({ action: "validate_verification_contract", root: opened.root, contract }, scope.signal);
          const archivedJobId = localMeta?.hashes?.["skill.zip"] === expectedSkillSha && localMeta?.hashes?.["app.tar"] === expectedAppTarSha && typeof localMeta.jobId === "string" && /^[a-f0-9-]{36}$/.test(localMeta.jobId) ? localMeta.jobId : void 0;
          if (archivedJobId && archivedJobId !== opened.job.id) {
            const saved = await this.credentials.read(`version-${archivedJobId}-${targetVersion}`);
            if (Object.keys(saved).length) await this.credentials.write(`version-${opened.job.id}-${targetVersion}`, saved);
          }
          const credentials = await this.readVersionCredentials(opened.job);
          const checks = [];
          for (const test of contract.verification?.cases ?? []) {
            const api = (contract.apis ?? []).find((a) => a.id === test.operation);
            if (!api || api.path === contract.health?.path || api.effect !== "read") {
              throw new Error("\u56DE\u6EDA\u540E\u5FC5\u987B\u4F7F\u7528\u6709\u6548\u7684\u53EA\u8BFB\u4E1A\u52A1\u63A5\u53E3\u9A8C\u8BC1");
            }
            const res = await worker({
              action: "probe",
              root: opened.root,
              contract,
              operation: test.operation,
              params: test.params ?? {},
              body: test.body,
              credentials,
              skill_markdown: opened.job.skillMarkdown
            }, scope.signal);
            if (!probeMatches(res, test.status ?? 200, test.json_contains)) {
              throw new Error(`\u56DE\u6EDA\u540E\u4E1A\u52A1\u9A8C\u8BC1\u5931\u8D25\uFF1A${test.operation}`);
            }
            checks.push({ operation: test.operation, status: res.status });
          }
          const latest = await this.platform(`/${slug}`, expected);
          if (latest.status !== "running" || latest.current_version !== targetVersion || latest.app_url !== opened.job.url || latest.config_fingerprint !== current.config_fingerprint || !matchesReceipt(latest.build_log, opened.job.hashes)) {
            throw new Error("\u56DE\u6EDA\u9A8C\u8BC1\u671F\u95F4\u7EBF\u4E0A\u7248\u672C\u6216\u914D\u7F6E\u53D1\u751F\u53D8\u5316");
          }
          if (checks.length > 0) {
            opened.job.checks = checks;
            opened.job.failureStage = void 0;
            opened.job.error = void 0;
            opened.job.status = "verified";
            opened.job.events.push(`\u5DF2\u56DE\u9000\u81F3 v${targetVersion}\uFF0C\u5386\u53F2\u6280\u80FD\u4E0E\u4E1A\u52A1\u63A2\u9488\u9A8C\u8BC1\u901A\u8FC7`);
            localSkillVerified = true;
            verification = { status: "verified-rolled-back" };
          } else if (Array.isArray(contract.pages) && contract.pages.length > 0 && !(contract.apis ?? []).some((a) => a.path !== contract.health?.path)) {
            opened.job.status = "awaiting_page_verification";
            opened.job.failureStage = void 0;
            opened.job.error = void 0;
            verification = { status: "awaiting_page_verification", detail: "\u8BF7\u6253\u5F00\u9875\u9762\u5B8C\u6210\u4EBA\u5DE5\u9A8C\u6536" };
            opened.job.events.push(`\u5DF2\u56DE\u9000\u81F3 v${targetVersion}\uFF0C\u8BF7\u6253\u5F00\u9875\u9762\u5B8C\u6210\u4EBA\u5DE5\u9A8C\u6536\u540E\u542F\u7528\u6280\u80FD`);
          } else {
            throw new Error("\u7F3A\u5C11\u53EA\u8BFB\u4E1A\u52A1\u9A8C\u8BC1\uFF0C\u5E94\u7528\u6280\u80FD\u5C1A\u672A\u542F\u7528");
          }
        } catch (error) {
          this.recordFailureState(opened.job, String(error), void 0, targetVersion, "verification");
          verification = { status: "probe-warning", detail: opened.job.error };
          opened.job.events.push(`\u5DF2\u56DE\u9000\u81F3 v${targetVersion}\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1\u4E1A\u52A1\u540E\u542F\u7528\u6280\u80FD`);
        }
      } else {
        this.recordFailureState(opened.job, "\u56DE\u6EDA\u5B8C\u6210\uFF0C\u6280\u80FD\u5305\u6216\u7EBF\u4E0A\u5236\u54C1\u56DE\u6267\u5C1A\u672A\u6838\u5B9E", void 0, targetVersion, "verification");
        verification = { status: "probe-warning", detail: opened.job.error };
      }
      scope.assertCurrent();
      await this.save(opened.root, opened.job);
    }
    this.core.emit("skills-changed");
    return {
      ...rbResult,
      active_version: targetVersion,
      local_skill_synced: localSkillSynced,
      local_skill_verified: localSkillVerified,
      skill_enabled: localSkillVerified && !await this.isSkillDisabled(scope.directory, slug),
      verification,
      job_id: primary?.job.id,
      rollback_notice: ROLLBACK_NOTICE
    };
  }
  async setSkillEnabled(id, enabled, expected) {
    const scope = this.scope(expected);
    await this.exclusive(id, async () => {
      const { job } = await this.open(scope.directory, id);
      if (job.status !== "verified") throw new Error("\u5E94\u7528\u5C1A\u672A\u901A\u8FC7\u4E1A\u52A1\u9A8C\u8BC1");
      if (enabled) await this.verifiedJob(id, expected, true);
      const path = this.skillPreferencePath(scope.directory, job.slug);
      await mkdir3(dirname3(path), { recursive: true, mode: 448 });
      const temp = join3(dirname3(path), randomUUID4());
      try {
        await writeFile3(temp, enabled ? "enabled" : "disabled", { mode: 384 });
        scope.assertCurrent();
        await renameWithRetry(temp, path);
      } finally {
        await rm2(temp, { force: true });
      }
      this.core.emit("skills-changed");
      this.core.emit("change");
    });
  }
  async verifiedJob(id, expected, allowDisabled = false) {
    const scope = this.scope(expected);
    const { root, job } = await this.open(scope.directory, id);
    if (job.status !== "verified" || !job.proposal || !job.checks?.length) throw new Error("\u5E94\u7528\u5C1A\u672A\u901A\u8FC7\u4E1A\u52A1\u9A8C\u8BC1");
    await worker({ action: "validate_credential_references", root, contract: job.proposal.contract }, scope.signal);
    const remote = await this.platform("/" + job.slug, expected);
    scope.assertCurrent();
    if (remote.status !== "running" || remote.app_url !== job.url || remote.current_version !== job.version) throw new Error("\u5E94\u7528\u7EBF\u4E0A\u7248\u672C\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1");
    if (!matchesReceipt(remote.build_log, job.hashes)) throw new Error("\u7EBF\u4E0A\u5236\u54C1\u7248\u672C\u53D1\u751F\u53D8\u5316");
    if (job.configFingerprint !== remote.config_fingerprint) throw new Error("\u5E94\u7528\u914D\u7F6E\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1\u4E1A\u52A1");
    if (!allowDisabled && await this.isSkillDisabled(scope.directory, job.slug)) throw new Error("\u5E94\u7528\u6280\u80FD\u5DF2\u505C\u7528");
    return { job, root, signal: scope.signal, runtimeConfigs: remote.app_config };
  }
  async readVersionCredentials(job, runtimeConfigs) {
    if (!job.version && !job.requestId) return {};
    const config = job.requestId ? await this.credentials.read(`publish-config-${job.requestId}`) : {};
    const authKeys = new Set(verificationCredentialFields(job.proposal.contract).map((field) => field.key));
    const rows = config.rows ? JSON.parse(config.rows) : [];
    const configured = Object.fromEntries(rows.filter((row) => authKeys.has(row.key) && !row.resource_id && row.value).map((row) => [row.key, row.value]));
    const runtime = Object.fromEntries((runtimeConfigs ?? []).filter((row) => authKeys.has(row.key) && !row.resource_id && row.value).map((row) => [row.key, row.value]));
    const version = job.version ? await this.credentials.read(`version-${job.id}-${job.version}`) : {};
    const source = job.proposal?.delivery_format === 1 && job.revision ? await this.credentials.read(`skill-credentials-${job.id}-${job.revision}`) : {};
    const legacy = job.confirmationToken ? {} : await this.credentials.read(job.id);
    return { ...legacy, ...source, ...configured, ...runtime, ...version };
  }
  async invoke(id, operation, params, body, expected, approve, turn) {
    const { job, root, signal, runtimeConfigs } = await this.verifiedJob(id, expected);
    const api = job.proposal.contract.apis.find((a) => a.id === operation);
    if (!api) throw new Error("\u672A\u627E\u5230\u5E94\u7528\u64CD\u4F5C");
    let approved = false;
    if (api.effect !== "read") {
      approved = await approve(`${job.name}\uFF1A${api.purpose}
${api.method} ${api.path}
${JSON.stringify({ params, body })}`);
      if (!approved) throw new Error("\u64CD\u4F5C\u672A\u83B7\u6279\u51C6");
      const current = await this.verifiedJob(id, expected);
      if (current.job.revision !== job.revision) throw new Error("\u5BA1\u6279\u671F\u95F4\u5E94\u7528\u7248\u672C\u53D1\u751F\u53D8\u5316");
    }
    const invocationSignal = turn ? AbortSignal.any([signal, turn]) : signal;
    invocationSignal.throwIfAborted();
    return worker({
      action: "probe",
      root,
      contract: job.proposal.contract,
      operation,
      params,
      body,
      approved,
      credentials: await this.readVersionCredentials(job, runtimeConfigs),
      skill_markdown: job.skillMarkdown
    }, invocationSignal).catch((error) => {
      if (approved) throw new Error("\u64CD\u4F5C\u7ED3\u679C\u672A\u77E5\uFF0C\u8BF7\u5148\u67E5\u8BE2\u5B9E\u9645\u7ED3\u679C\u518D\u51B3\u5B9A\u4E0B\u4E00\u6B65", { cause: error });
      throw error;
    });
  }
};
function readStorageBindings(input) {
  if (input === void 0) return {};
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("\u5B58\u50A8\u914D\u7F6E\u683C\u5F0F\u65E0\u6548");
  const entries = Object.entries(input);
  if (entries.some(([path, id]) => !path.startsWith("/") || typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(id))) {
    throw new Error("\u5B58\u50A8\u914D\u7F6E\u683C\u5F0F\u65E0\u6548");
  }
  return Object.fromEntries(entries);
}

// src/host/app-agent.ts
import { randomUUID as randomUUID5 } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { defineTool as defineTool2 } from "@deepseek-ai/dsh-tools";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";

// src/host/app-proposal-schema.ts
var str = { type: "string" };
var text2 = { ...str, required: true };
var bool = { type: "boolean" };
var strings = { type: "array", items: str };
var object2 = { type: "object", additionalProperties: true };
var objects = { type: "array", items: object2 };
var routeAuth = { ...object2, properties: {
  evidence: { ...strings, description: "\u8BE5\u8DEF\u7531\u7684\u8BA4\u8BC1\u6E90\u7801\u4F4D\u7F6E\uFF0C\u4F7F\u7528\u6E90\u7801\u8BFB\u53D6\u5DE5\u5177\u8FD4\u56DE\u7684\u6587\u4EF6\u8DEF\u5F84\u548C\u884C\u53F7" }
} };
function proposalParameters(port, portLocked = true) {
  return {
    summary: { ...str, description: "\u4E2D\u6587\u6539\u9020\u6458\u8981\uFF1B\u4F7F\u7528\u7ED3\u6784\u5316\u53C2\u6570\u65F6\u5FC5\u586B" },
    skill_markdown: { ...str, description: "\u6309\u5F53\u524D\u6539\u9020\u6280\u80FD\u8981\u6C42\u751F\u6210\u53EF\u7528\u7684\u5E94\u7528 SKILL.md\uFF0C\u542B YAML \u540D\u79F0\u4E0E\u8BF4\u660E\uFF0C\u8BB0\u5F55\u771F\u5B9E\u4E1A\u52A1\u64CD\u4F5C\u4E0E\u8C03\u7528\u65B9\u5F0F\uFF0C\u53EA\u5199\u51ED\u636E\u5F15\u7528" },
    issues: { ...objects, items: { ...object2, properties: {
      id: text2,
      evidence: text2,
      impact: text2,
      recommendation: text2
    } } },
    unresolved: { ...strings, description: "\u4EC5\u586B\u5199\u5FC5\u987B\u7531\u7528\u6237\u5904\u7406\u7684\u90E8\u7F72\u963B\u585E\u3002\u9274\u6743\u963B\u585E\u9879\u4E0E contract.auth_blockers \u7684 question \u4FDD\u6301\u4E00\u81F4\u3002" },
    changes: { ...objects, items: { ...object2, properties: {
      id: text2,
      path: text2,
      reason: text2,
      group: str,
      content: { ...str, description: "\u5B8C\u6574\u6587\u4EF6\u5185\u5BB9\uFF1B\u5DF2\u901A\u8FC7 opc_delivery_propose_file \u6682\u5B58\u7684\u6587\u4EF6\u7701\u7565\u8BE5\u5B57\u6BB5" },
      executable: bool
    } } },
    contract: { ...object2, description: "\u63D0\u4EA4\u5B8C\u6574\u5951\u7EA6\uFF1B\u4FEE\u6B63\u5176\u4ED6\u5B57\u6BB5\u65F6\u4E5F\u4FDD\u7559\u5DF2\u786E\u5B9A\u7684\u8FD0\u884C\u914D\u7F6E", properties: {
      schema_version: { type: "integer", required: true, description: "\u5F53\u524D\u4EA4\u4ED8\u5951\u7EA6\u7248\u672C\u4E3A 1" },
      slug: str,
      name: text2,
      description: text2,
      base_url: str,
      runtime: { ...object2, required: true, properties: {
        language: text2,
        version: text2,
        port: {
          type: "integer",
          required: true,
          description: portLocked ? `\u5FC5\u987B\u662F\u5411\u5BFC\u5DF2\u9501\u5B9A\u7684\u6570\u5B57 ${port}\uFF0C\u4E0D\u662F\u5B57\u7B26\u4E32\u6216\u5BBF\u4E3B\u673A\u7AEF\u53E3` : `\u4F18\u5148\u586B\u5199\u5E94\u7528\u81EA\u8EAB\u9ED8\u8BA4\u76D1\u542C\u7AEF\u53E3\uFF08\u6574\u6570 1-65535\uFF09\uFF1B\u82E5\u5E94\u7528\u65E0\u9ED8\u8BA4\u7AEF\u53E3\uFF0C\u586B\u5199 OPC \u9ED8\u8BA4\u7AEF\u53E3 ${port}`
        }
      } },
      build_context: { ...strings, required: true },
      data_plan: { ...object2, required: true, properties: {
        strategy: { ...text2, enum: ["initialize", "reuse", "postgres_copy"] },
        summary: text2,
        recovery: text2,
        source_resource_id: str,
        target_resource_id: str,
        rehearsal_resource_id: str,
        migration_files: strings
      } },
      health: { ...object2, description: "\u53EF\u9009\u3002\u4EC5\u7528\u4E8E\u6807\u8BC6\u6E90\u7801\u5DF2\u6709\u7684\u5065\u5EB7\u5165\u53E3\uFF0C\u4E1A\u52A1\u9A8C\u8BC1\u4E0D\u5F97\u4F7F\u7528\u8BE5\u5165\u53E3\u3002\u6CA1\u6709\u5219\u7701\u7565\u3002", properties: { path: text2, status: { type: "integer" }, json_contains: object2 } },
      configs: { ...objects, description: "\u586B\u5199\u5E94\u7528\u5B9E\u9645\u4F7F\u7528\u7684\u914D\u7F6E\u952E\u3002\u975E\u654F\u611F\u9ED8\u8BA4\u503C\u5FC5\u987B\u80FD\u4ECE\u6E90\u7801\u786E\u8BA4\uFF1B\u51ED\u636E\u548C\u793A\u4F8B\u5360\u4F4D\u7B26\u4E0D\u80FD\u5199\u6210\u9ED8\u8BA4\u503C\u3002\u7531\u5E73\u53F0\u6CE8\u5165\u65F6\u5199\u8D44\u6E90 ID \u548C\u8D44\u6E90\u5B57\u6BB5\u540D\u3002", items: { ...object2, properties: {
        key: text2,
        default: text2,
        secret: { ...bool, required: true },
        required: { ...bool, required: true },
        description: str,
        app_default: { ...str, description: "\u4EC5\u975E\u654F\u611F\u914D\u7F6E\u53EF\u586B\u5199\u6E90\u7801\u4E2D\u7684\u515C\u5E95\u9ED8\u8BA4\u503C\uFF08\u53EA\u8BFB\u5C55\u793A\u53C2\u8003\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u6CE8\u5165\uFF09" },
        source: { ...object2, description: "\u4F7F\u7528 path \u548C keys \u5F15\u7528\u6E90\u914D\u7F6E\uFF0C\u7981\u6B62\u5199\u5165\u771F\u5B9E\u79D8\u5BC6\u503C" },
        resource_id: str,
        resource_key: str
      } } },
      resources: objects,
      storage_mounts: { ...objects, required: true, description: "\u5B8C\u6574\u6302\u8F7D\u6E05\u5355\uFF0C\u6CA1\u6709\u6302\u8F7D\u65F6\u4E3A []\u3002" },
      credential_sources: { ...object2, description: "\u7528\u4E8E\u4E1A\u52A1\u6280\u80FD\u7684\u5DF2\u6709\u51ED\u636E\u6E90\u7801\u5F15\u7528\u3002\u952E\u662F\u767B\u5F55\u51ED\u636E\u7684\u5F15\u7528\u540D\uFF0C\u503C\u4E3A {path,keys} \u6216 {path,line,name}\u3002\u4E0D\u521B\u5EFA\u90E8\u7F72\u73AF\u5883\u53D8\u91CF\uFF0C\u4E0D\u586B\u5199\u5B9E\u9645\u8D26\u5BC6\u3002" },
      auth_profile: { ...object2, description: "\u4FDD\u7559\u539F\u8BA4\u8BC1\uFF1B\u51ED\u636E\u53EA\u5199\u8FD0\u884C\u65F6\u73AF\u5883\u53D8\u91CF\u540D", properties: {
        page_auth_required: bool,
        api_auth_required: bool,
        username_env: str,
        password_env: str,
        token_env: str,
        login_url: str,
        login_method: str,
        token_json_path: str
      } },
      auth_profiles: { ...object2, description: '\u6309 ID \u4FDD\u5B58\u767B\u5F55\u65B9\u5F0F\u3002\u4F8B\uFF1A{"account":{"login_url":"/api/session","login_method":"POST","username_env":"APP_USER","password_env":"APP_PASSWORD"}}\u3002profile ID \u53EA\u51FA\u73B0\u4E00\u5C42\uFF0C\u63A5\u53E3\u901A\u8FC7 auth.profile \u5F15\u7528\u3002\u975E\u6807\u51C6\u767B\u5F55\u5B57\u6BB5\u7528 login_body_template\uFF0C\u4EC5\u5141\u8BB8\u8D26\u53F7\u548C\u5BC6\u7801\u5360\u4F4D\u7B26\u3002' },
      auth_rules: { ...objects, description: "\u5171\u7528\u9274\u6743\u5199\u4E00\u6761 prefix \u89C4\u5219\uFF1B\u516C\u5F00\u767B\u5F55\u7B49\u4F8B\u5916\u7528 path \u548C method\u3002\u767B\u5F55\u65B9\u5F0F\u5199\u5728\u53D7\u4FDD\u62A4\u89C4\u5219\u7684 auth.profile\uFF0C\u4E0D\u80FD\u53EA\u5199\u5728\u516C\u5F00\u767B\u5F55\u63A5\u53E3\u4E0A\u3002evidence \u5728\u89C4\u5219\u9876\u5C42\u3002", items: { ...object2, properties: {
        target: { ...text2, enum: ["api", "page"] },
        path: str,
        prefix: str,
        method: str,
        auth: { ...object2, required: true, properties: { type: { ...text2, enum: ["none", "header", "bearer"] }, profile: str, header: str, env: str } },
        evidence: { ...strings, required: true, description: '\u8BFB\u53D6\u5DE5\u5177\u8FD4\u56DE\u7684\u6E90\u7801\u4F4D\u7F6E\u6570\u7EC4\uFF0C\u4F8B\u5982 ["server.mjs:42"]' }
      } } },
      auth_blockers: { ...objects, description: "\u53EA\u586B\u786E\u5B9E\u963B\u585E\u6539\u9020\u7684\u5916\u90E8\u6388\u6743\u6216\u89D2\u8272\u51B3\u5B9A\u3002", items: { ...object2, properties: {
        question: text2,
        evidence: { ...strings, required: true },
        affected: { ...strings, required: true },
        action: text2,
        reason: { ...text2, enum: ["external_authorization", "missing_credential", "role_change"] }
      } } },
      apis: { ...objects, required: true, description: "\u586B\u5199\u6280\u80FD\u53EF\u4F7F\u7528\u7684\u771F\u5B9E\u63A5\u53E3\uFF0C\u6CA1\u6709\u65F6\u4E3A []\u3002", items: { ...object2, properties: {
        id: text2,
        method: text2,
        path: text2,
        purpose: text2,
        evidence: { ...strings, required: true },
        parameters: { ...objects, required: true },
        request_body: { oneOf: [{ type: "null" }, object2], required: true },
        responses: { ...object2, required: true },
        auth: { ...routeAuth, required: true },
        effect: { ...text2, enum: ["read", "write", "destructive", "external"] },
        confirmation_required: { ...bool, required: true, description: "effect \u4E3A write\u3001destructive \u6216 external \u65F6\u5FC5\u987B\u4E3A true" }
      } } },
      pages: {
        ...objects,
        required: true,
        description: "\u586B\u5199\u6280\u80FD\u53EF\u4F7F\u7528\u7684\u771F\u5B9E\u9875\u9762\uFF0C\u6CA1\u6709\u65F6\u4E3A []\u3002",
        items: { ...object2, properties: { auth: routeAuth } }
      },
      verification: { ...object2, description: "\u8BF4\u660E AI \u90E8\u7F72\u9A8C\u6536\u7684\u4E1A\u52A1\u76EE\u6807\u548C\u53EF\u53D6\u5F97\u7684\u8BC1\u636E\u3002" },
      unresolved: { ...strings, description: "\u4EC5\u4FDD\u7559\u963B\u585E\u90E8\u7F72\u4E14\u9700\u7528\u6237\u51B3\u5B9A\u7684\u95EE\u9898\u3002\u53EF\u9009\u96C6\u6210\u914D\u7F6E\u3001\u6539\u5BC6\u5EFA\u8BAE\u3001\u90E8\u7F72\u540E\u624D\u80FD\u786E\u8BA4\u7684\u4E8B\u9879\u653E\u5728\u6458\u8981\u3002" }
    } },
    decisions: { ...objects, items: { ...object2, properties: {
      id: text2,
      question: text2,
      impact: text2,
      options: { ...strings, required: true }
    } } },
    proposal: { ...str, description: "\u65E7\u7248\u5B8C\u6574\u63D0\u6848 JSON \u5B57\u7B26\u4E32\uFF0C\u4EC5\u5728\u6CA1\u6709\u7ED3\u6784\u5316\u53C2\u6570\u65F6\u4F7F\u7528" }
  };
}

// src/host/app-agent.ts
var ANALYSIS_TIMEOUT_MS = 15 * 6e4;
var REPLY_TIMEOUT_MS = 30 * 6e4;
var MAX_VALIDATION_ERRORS = 3;
function loadBundledSkillText(relativePath) {
  const fromSrc = fileURLToPath2(new URL(`../../runtime/app_delivery/${relativePath}`, import.meta.url));
  const fromLib = fileURLToPath2(new URL(`../runtime/app_delivery/${relativePath}`, import.meta.url));
  const target = import.meta.url.endsWith("/lib/index.js") ? fromLib : fromSrc;
  try {
    return readFileSync2(target, "utf8");
  } catch {
    return readFileSync2(fromSrc, "utf8");
  }
}
function normalizeDisplayPath(raw) {
  if (!raw) return "";
  let cleaned = raw.replace(/\\/g, "/");
  cleaned = cleaned.replace(/^[^/]+(?=\/(?:src|bff|app|lib|config|packages|server|client|api|doc|Dockerfile|package\.json))/i, "");
  cleaned = cleaned.replace(/^[^\s/]*[^\x00-\x7f\u4e00-\u9fa5\s/]+[^\s/]*\/+/g, "");
  return cleaned.replace(/^\/+/, "") || raw;
}
function formatToolStep(action, rawPath, language) {
  const path = normalizeDisplayPath(rawPath);
  if (action === "inventory") return `\u{1F50D} \u6B63\u5728\u626B\u63CF\u6E90\u7801\u76EE\u5F55\u7ED3\u6784${path ? ` (${path})` : ""}`;
  if (action === "scan_routes_and_pages") return "\u{1F9ED} \u6B63\u5728\u5168\u91CF\u626B\u63CF\u5E94\u7528\u540E\u7AEF API \u8DEF\u7531\u4E0E\u524D\u7AEF\u9875\u9762\u89C6\u56FE";
  if (action === "read") return path ? `\u{1F4D6} \u6B63\u5728\u6DF1\u5165\u5206\u6790\u6E90\u7801\u6587\u4EF6: ${path}` : "\u{1F4D6} \u6B63\u5728\u8BFB\u53D6\u6E90\u7801\u6587\u4EF6";
  if (action === "read_failed") return path ? `\u{1FA79} \u6B63\u5728\u8BFB\u53D6\u4E0A\u6B21\u5931\u8D25\u90E8\u7F72\u5236\u54C1\u6587\u4EF6: ${path}` : "\u{1FA79} \u6B63\u5728\u8BFB\u53D6\u5931\u8D25\u90E8\u7F72\u5236\u54C1";
  if (action === "reference") return "\u{1F50D} \u53C2\u8003\u6807\u51C6\u9002\u914D\u5951\u7EA6\u4E0E\u67B6\u6784\u6A21\u5F0F";
  if (action === "read_go_dependency") return "\u{1F4E6} \u5206\u6790 Go \u6A21\u5757\u4F9D\u8D56\u5951\u7EA6 (go.mod)";
  if (action === "template") return `\u{1F433} \u5339\u914D\u5B98\u65B9\u9002\u914D Dockerfile \u5BB9\u5668\u6A21\u677F${language ? ` (${language})` : ""}`;
  if (action === "inspect_local_storage") return "\u{1F4BE} \u68C0\u6D4B\u672C\u5730\u6570\u636E\u5B58\u50A8\u4E0E\u6301\u4E45\u5316\u5377\u9700\u6C42";
  if (action === "propose_file") return path ? `\u270F\uFE0F \u89C4\u5212\u6587\u4EF6\u4FEE\u6539\u5EFA\u8BAE: ${path}` : "\u270F\uFE0F \u89C4\u5212\u6587\u4EF6\u4FEE\u6539\u65B9\u6848";
  if (action === "submit") return "\u{1F4CB} \u6C47\u603B\u6280\u672F\u6539\u9020\u65B9\u6848\u4E0E\u4E1A\u52A1\u6280\u80FD\u5951\u7EA6";
  return `\u26A1 \u6267\u884C\u5206\u6790\u5DE5\u5177: ${action}${path ? ` (${path})` : ""}`;
}
function compactPreviousPlan(proposal) {
  if (!proposal || typeof proposal !== "object") return void 0;
  const prevContract = proposal.contract ?? {};
  const compactContract = {};
  for (const key of [
    "schema_version",
    "slug",
    "name",
    "description",
    "base_url",
    "runtime",
    "build_context",
    "auth_profile",
    "auth_profiles",
    "auth_rules",
    "auth_blockers",
    "admin_account",
    "resources",
    "storage_mounts",
    "verification"
  ]) {
    if (key in prevContract) compactContract[key] = prevContract[key];
  }
  const profileFields = ["login_url", "login_method", "token_json_path", "username_env", "password_env", "token_env"];
  const references = (profile) => Object.fromEntries(
    profileFields.filter((field) => typeof profile?.[field] === "string").map((field) => [field, profile[field]])
  );
  if (compactContract.auth_profile) compactContract.auth_profile = references(compactContract.auth_profile);
  if (compactContract.auth_profiles) compactContract.auth_profiles = Object.fromEntries(
    Object.entries(compactContract.auth_profiles).map(([id, profile]) => [id, references(profile)])
  );
  return {
    summary: proposal.summary,
    issues: proposal.issues ?? [],
    unresolved: [...proposal.unresolved ?? [], ...prevContract.unresolved ?? []],
    decisions: proposal.decisions ?? [],
    changes: (proposal.changes ?? []).map((c) => ({ id: c.id, path: c.path, reason: c.reason, group: c.group })),
    contract: compactContract
  };
}
function attachAppAgent(ctx, delivery) {
  const sessions = /* @__PURE__ */ new Map();
  delivery.analyze = async (job, root, feedback, signal, onSessionReady, fromChat, assessment) => {
    const parent = ctx.agents.get(job.session);
    const configured = job.modelSelection;
    const selection = configured ? {
      provider: configured.provider,
      model: configured.model,
      reasoningEffort: configured.reasoningEffort ? ReasoningEffortId(configured.reasoningEffort) : void 0
    } : parent?.model.current() ?? parent?.session.requestHeader()?.config;
    const appCtxId = delivery.core.auth.contexts.applicationContextId;
    const isRepair = Boolean(job.failedRevision || job.failedSnapshot || job.failureContext || job.analysisMode === "repair");
    const port = job.port ?? 8080;
    const portLocked = job.portAuto !== true;
    const updating = job.deliveryMode ? job.deliveryMode === "update" : Boolean(job.upgrade);
    const skill = loadBundledSkillText(updating ? "UPDATE.md" : "SKILL.md");
    const repairInstructions = isRepair ? "\n\u4FEE\u590D\u5931\u8D25\u90E8\u7F72\u65F6\uFF0C\u5148\u6838\u5BF9\u5931\u8D25\u9636\u6BB5\u548C\u65E5\u5FD7\uFF0C\u7528 read_failed \u8BFB\u53D6\u5B9E\u9645\u5931\u8D25\u5236\u54C1\u5E76\u4E0E\u539F\u6E90\u7801\u6BD4\u5BF9\u3002\u53EA\u4FEE\u6B63\u6839\u56E0\uFF0C\u63D0\u4EA4\u5B8C\u6574\u66FF\u6362\u6587\u4EF6\u3002" : "";
    const portInstructions = portLocked ? `\u672C\u4EFB\u52A1\u9501\u5B9A\u7684\u5BB9\u5668\u7AEF\u53E3\u4E3A ${port}\u3002` : `\u5BB9\u5668\u7AEF\u53E3\u7B56\u7565\uFF1A\u4F18\u5148\u8BC6\u522B\u5E76\u6CBF\u7528\u5E94\u7528\u81EA\u8EAB\u9ED8\u8BA4\u76D1\u542C\u7AEF\u53E3\uFF08\u4ECE\u6E90\u7801\u3001\u73B0\u6709 Dockerfile \u6216\u771F\u5B9E\u914D\u7F6E\u6587\u4EF6\u6838\u5B9E\uFF09\uFF1B\u82E5\u5E94\u7528\u65E0\u9ED8\u8BA4\u7AEF\u53E3\uFF08\u6216\u4F9D\u8D56\u5916\u90E8\u6CE8\u5165 PORT \u4E14\u65E0\u515C\u5E95\u503C\uFF09\uFF0C\u5219\u4F7F\u7528 OPC \u9ED8\u8BA4\u7AEF\u53E3 ${port}\u3002${job.upgrade ? `\u672C\u6B21\u4E3A\u5347\u7EA7\u90E8\u7F72\uFF0C\u5982\u65B0\u7248\u672A\u53D8\u66F4\u7AEF\u53E3\u4F18\u5148\u6CBF\u7528\u7EBF\u4E0A\u5F53\u524D\u7AEF\u53E3 ${port}\u3002` : ""}\u5BB9\u5668\u5185\u5FC5\u987B\u76D1\u542C 0.0.0.0\uFF08\u7981\u6B62\u76D1\u542C 127.0.0.1\uFF09\uFF0C\u4E14\u5951\u7EA6 configs \u4E2D\u7684 PORT \u5FC5\u987B\u4E0E runtime.port \u4E00\u81F4\uFF0C\u4E0D\u8981\u5F15\u7528 *.example \u793A\u4F8B\u6587\u4EF6\u4E2D\u51B2\u7A81\u7684 PORT \u6216\u5360\u4F4D\u5BC6\u94A5\u3002`;
    const prevPlan = compactPreviousPlan(job.proposal);
    const taskInstruction = assessment ? `\u5F53\u524D\u662F${assessment.phase === "build" ? "\u6784\u5EFA\u4EA7\u7269" : "\u8FD0\u884C\u7248\u672C"}\u9A8C\u6536\u9636\u6BB5\u3002\u5148\u901A\u8FC7 opc_delivery_observe \u8BFB\u53D6\u4E8B\u5B9E\uFF0C\u7136\u540E\u63D0\u4EA4 opc_delivery_assess \u7ED3\u8BBA\u3002` : isRepair ? "\u6CBF\u7528\u5DF2\u786E\u8BA4\u65B9\u6848\uFF0C\u5148\u7528\u5931\u8D25\u5236\u54C1\u6838\u5B9E\u6839\u56E0\uFF0C\u53EA\u4FEE\u590D\u5BFC\u81F4\u4E2D\u65AD\u7684\u95EE\u9898\u3002" : prevPlan || job.analysisFailure ? "\u4ECE\u5DF2\u6709\u65B9\u6848\u3001\u6682\u5B58\u6587\u4EF6\u4E0E\u4E0A\u6B21\u4E2D\u65AD\u4F4D\u7F6E\u7EE7\u7EED\u3002\u53EA\u8865\u672C\u8F6E\u7F3A\u7684\u5185\u5BB9\u3002" : "\u6309\u6280\u80FD\u7684\u4E09\u6B65\u5B8C\u6210\u672C\u6B21\u5E94\u7528\u6539\u9020\u3002";
    const timeout = new AbortController();
    const abort = AbortSignal.any([signal, timeout.signal]);
    let deadline;
    const setDeadline = (ms) => {
      clearTimeout(deadline);
      deadline = setTimeout(() => timeout.abort(new Error("AI \u5206\u6790\u8D85\u65F6\uFF0C\u539F\u6E90\u7801\u548C\u5DF2\u6709\u56DE\u7B54\u5DF2\u4FDD\u7559\u3002\u8BF7\u7EE7\u7EED\u51C6\u5907\u3002")), ms);
      deadline.unref();
    };
    let wakeReply;
    let replyCount = 0;
    const sessionReady = Promise.withResolvers();
    const validationErrors = [];
    const observations = /* @__PURE__ */ new Map();
    let activeVersion;
    const readActiveVersion = () => activeVersion ??= (async () => {
      if (!updating) throw new Error("\u9996\u6B21\u90E8\u7F72\u6CA1\u6709\u53EF\u6CBF\u7528\u7684\u5E94\u7528\u7248\u672C");
      const app = await delivery.platform(`/${job.slug}`, appCtxId);
      if (!app.can_manage) throw new Error("\u6CA1\u6709\u8BFB\u53D6\u6B64\u5E94\u7528\u7248\u672C\u7684\u6743\u9650");
      const { versions } = await delivery.platform(`/${job.slug}/versions`, appCtxId);
      const releases = Array.isArray(versions) ? versions : [];
      const active = releases.find((item) => item.is_active === true && item.status === "running") ?? (app.status === "running" ? releases.find((item) => item.version === app.current_version && item.status === "running") : void 0);
      if (!active) throw new Error("\u627E\u4E0D\u5230\u5F53\u524D\u751F\u6548\u7248\u672C");
      return active;
    })().catch((error) => {
      activeVersion = void 0;
      throw error;
    });
    const rejectedProposals = /* @__PURE__ */ new Set();
    let repeatedProposal = false;
    let draftFileChanges = [];
    try {
      const draftsRaw = JSON.parse(readFileSync2(join4(root, "draft_files.json"), "utf8"));
      if (draftsRaw && typeof draftsRaw === "object") {
        draftFileChanges = Object.values(draftsRaw).map((c) => ({ id: c?.id, path: c?.path, reason: c?.reason }));
      }
    } catch {
    }
    const agentOptions = selection ? { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort } : { ...parent?.options };
    const live = sessions.get(job.id) ?? {};
    const round = {
      tools: /* @__PURE__ */ new Map(),
      ready: sessionReady.promise,
      async reply(text3, turnSignal) {
        if (assessment) return worker({ action: "redact_feedback", root, text: text3.slice(0, 2e4) }, AbortSignal.any([abort, turnSignal]));
        const safeText = await delivery.recordAnalysisReply(job, root, text3, AbortSignal.any([abort, turnSignal]));
        validationErrors.length = 0;
        rejectedProposals.clear();
        repeatedProposal = false;
        replyCount++;
        wakeReply?.();
        return safeText;
      }
    };
    const register = (tool) => round.tools.set(tool.name, tool);
    const output = { schema: { type: "string" }, render: (_, value) => [{ type: "text", text: value }] };
    register(defineTool2({
      name: "opc_delivery_observe",
      description: "\u8BFB\u53D6\u5019\u9009\u7248\u672C\u7684\u5B9E\u9645\u4E8B\u5B9E\u3002state \u8BFB\u53D6\u72B6\u6001\u548C\u65E5\u5FD7\uFF1Brehearsal \u5728\u5DF2\u786E\u8BA4\u7684\u9694\u79BB PostgreSQL \u4E0A\u6F14\u7EC3\uFF1B\u8FD0\u884C\u6001\u53EF\u4F7F\u7528 http \u6216 operation \u8FDB\u884C\u7AD9\u5185\u8BFB\u53D6\u3002",
      parameters: {
        kind: { type: "string", enum: ["state", "http", "operation", "rehearsal"], required: true },
        path: { type: "string" },
        method: { type: "string", enum: ["GET", "HEAD"] },
        expected_statuses: { type: "array", items: { type: "number" } },
        within_seconds: { type: "number" },
        operation: { type: "string" },
        params: { type: "object", additionalProperties: true },
        body: { type: "object", additionalProperties: true }
      },
      output,
      async execute(args) {
        if (!assessment || assessment.result) throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u9A8C\u6536\u7684\u90E8\u7F72\u9636\u6BB5");
        if (observations.size >= 30) throw new Error("\u672C\u8F6E\u4E8B\u5B9E\u8BFB\u53D6\u5DF2\u8FBE\u5230\u4E0A\u9650\uFF0C\u8BF7\u636E\u6B64\u63D0\u4EA4\u7ED3\u8BBA");
        const result = await delivery.observeDeployment(job, root, args, appCtxId, abort);
        const id = randomUUID5();
        observations.set(id, JSON.stringify(result));
        return JSON.stringify({ id, result });
      }
    }));
    register(defineTool2({
      name: "opc_delivery_assess",
      description: "\u6839\u636E\u672C\u8F6E\u5B9E\u9645\u89C2\u5BDF\u63D0\u4EA4\u6784\u5EFA\u6216\u8FD0\u884C\u9A8C\u6536\u7ED3\u8BBA\u3002\u4F7F\u7528 opc_delivery_observe \u8FD4\u56DE\u7684\u8BC1\u636E ID\u3002",
      parameters: {
        outcome: { type: "string", required: true, enum: ["passed", "failed"] },
        report: { type: "string", required: true },
        evidence: { type: "array", items: { type: "string" }, required: true }
      },
      output,
      async execute(args) {
        if (!assessment || assessment.result) throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u63D0\u4EA4\u7684\u90E8\u7F72\u9A8C\u6536");
        const ids = [...new Set(args.evidence)];
        if (!args.report.trim() || args.report.length > 2e3 || !ids.length || ids.length > 12 || ids.some((id) => !observations.has(id))) {
          throw new Error("\u8BF7\u63D0\u4EA4\u7B80\u77ED\u7ED3\u8BBA\u4EE5\u53CA\u672C\u8F6E\u5DE5\u5177\u8BFB\u53D6\u7684\u8BC1\u636E ID");
        }
        assessment.result = {
          phase: assessment.phase,
          outcome: args.outcome,
          report: await worker({ action: "redact_feedback", root, text: args.report }, abort),
          evidence: ids.map((id) => observations.get(id))
        };
        return "\u9A8C\u6536\u7ED3\u8BBA\u4E0E\u8BC1\u636E\u5DF2\u8BB0\u5F55\u3002";
      }
    }));
    register(defineTool2({
      name: "opc_delivery_inspect",
      description: "\u53EA\u8BFB\u68C0\u67E5\u5E94\u7528\u3002inventory \u67E5\u770B\u5BFC\u5165\u6E90\u7801\u6E05\u5355\uFF1Bread\u3001read_failed \u6216 version_file \u4F20 path\uFF08version_file \u8BFB\u53D6\u7EBF\u4E0A\u751F\u6548\u7248\u672C\uFF09\uFF1Bresources \u8BFB\u53D6\u5E73\u53F0\u8D44\u6E90\uFF1Bactive_version \u8BFB\u53D6\u751F\u6548\u7248\u672C\u548C\u4EA4\u4ED8\u6E05\u5355\uFF1Bdatabase_schema \u8BFB\u53D6\u5E94\u7528\u4E13\u5C5E PostgreSQL \u7684\u8868\u548C\u5217\uFF1Breference \u4F20 name\uFF1Btemplate \u4F20 language \u548C version\u3002\u53E6\u53EF\u7528 scan_routes_and_pages\u3001inspect_local_storage\u3001read_go_dependency\u3002",
      parameters: {
        action: { type: "string", required: true },
        path: { type: "string" },
        proposed: { type: "boolean" },
        language: { type: "string" },
        version: { type: "string" },
        name: { type: "string" },
        schema: { type: "string" },
        table: { type: "string" },
        key: { type: "string" },
        source: { type: "object", additionalProperties: true },
        module: { type: "string" },
        start: { type: "number" }
      },
      output,
      async execute(args) {
        const allowedActions = [
          "inventory",
          "scan_routes_and_pages",
          "read",
          "read_failed",
          "reference",
          "template",
          "inspect_local_storage",
          "read_go_dependency",
          "resources",
          "active_version",
          "version_file",
          "database_schema",
          "read_source_connection"
        ];
        if (!allowedActions.includes(args.action)) throw new Error("\u53EA\u5141\u8BB8\u8BFB\u53D6\u6E90\u7801\u4E0E\u89C4\u8303");
        if (args.action === "reference" && !["delivery-files.md", "contract.md", "framework-checks.md"].includes(args.name ?? "")) {
          throw new Error("\u8BF7\u8BFB\u53D6 delivery-files.md\u3001contract.md \u6216 framework-checks.md");
        }
        job.events.push(formatToolStep(args.action, args.path, args.language));
        delivery.core.emit("change");
        if (args.action === "resources") {
          const response = await delivery.platform("/resources", appCtxId, { query: { slug: job.slug } });
          return JSON.stringify((response.resources ?? []).map(({ id, name: name2, type, env_keys, is_default, supports_auto_migration, host, port: port2, database_name }) => ({ id, name: name2, type, env_keys, is_default, supports_auto_migration, host, port: port2, database_name })));
        }
        if (args.action === "active_version") {
          const active = await readActiveVersion();
          const plan = active.download_urls?.["delivery.json"] ? await delivery.platform(`/${job.slug}/versions/${active.version}/artifacts/delivery.json`, appCtxId) : void 0;
          return worker({ action: "redact_feedback", root, text: JSON.stringify({
            version: active.version,
            container_port: active.container_port,
            configs: (active.app_config ?? []).map(({ key, resource_id, resource_key, has_value }) => ({ key, resource_id, resource_key, has_value })),
            mounts: (active.storage_mounts ?? []).map(({ container_path, resource_id, kind, purpose }) => ({ container_path, resource_id, kind, purpose })),
            delivery: plan
          }, null, 2) }, abort);
        }
        if (args.action === "version_file") {
          const active = await readActiveVersion();
          if (!args.path) throw new Error("\u8BF7\u63D0\u4F9B\u4E0A\u4E00\u7248\u4EA4\u4ED8\u6587\u4EF6\u8DEF\u5F84");
          const file = await delivery.platform(`/${job.slug}/versions/${active.version}/artifacts/app.tar`, appCtxId, { query: { file: args.path } });
          if (typeof file?.text !== "string") throw new Error("\u5E73\u53F0\u5C1A\u672A\u63D0\u4F9B\u4E0A\u4E00\u7248\u4EA4\u4ED8\u6587\u4EF6\u8BFB\u53D6\u63A5\u53E3");
          const text3 = await worker({ action: "redact_feedback", root, text: file.text, path: args.path }, abort);
          const start = Math.max(0, (args.start ?? 1) - 1);
          return JSON.stringify({ path: args.path, text: text3.split("\n").slice(start, start + 200).join("\n") });
        }
        if (args.action === "database_schema") {
          await readActiveVersion();
          return JSON.stringify(await delivery.platform(`/${job.slug}/database-schema`, appCtxId, {
            query: {
              ...args.name ? { resource_id: args.name } : {},
              ...job.requestId ? { request_id: job.requestId } : {},
              ...args.table ? { table: args.table } : {},
              ...args.schema ? { schema: args.schema } : {}
            }
          }));
        }
        if (args.action === "template") {
          abort.throwIfAborted();
          const result = await delivery.platform("/dockerfile-templates", appCtxId, { query: { language: args.language ?? "", version: args.version ?? "" } });
          abort.throwIfAborted();
          return JSON.stringify(result.matched_template ?? null);
        }
        return JSON.stringify(await worker({ ...args, root, revision: job.failedRevision || job.revision }, abort));
      }
    }));
    register(defineTool2({
      name: "opc_delivery_propose_file",
      description: "\u6682\u5B58\u6280\u80FD\u89C4\u5B9A\u7684 Dockerfile\u3001\u914D\u7F6E\u6216 SQL \u6587\u4EF6\u3002\u5728 opc_delivery_submit \u7684 changes \u4E2D\u5F15\u7528 ID \u548C\u5B9E\u9645\u90E8\u7F72\u8DEF\u5F84\u3002",
      parameters: {
        id: { type: "string", required: true },
        path: { type: "string", required: true },
        reason: { type: "string", required: true },
        content: { type: "string", required: true },
        executable: { type: "boolean" },
        group: { type: "string" }
      },
      output,
      async execute(args) {
        if (assessment) throw new Error("\u5F53\u524D\u6B63\u5728\u9A8C\u6536\uFF0C\u6539\u9020\u9700\u56DE\u5230\u539F\u4EFB\u52A1\u7EE7\u7EED");
        if (job.status !== "analyzing") throw new Error("\u672C\u8F6E\u5DF2\u63D0\u4EA4\u65B9\u6848");
        job.events.push(formatToolStep("propose_file", args.path));
        delivery.core.emit("change");
        const res = await worker({ action: "propose_file", root, ...args, skill_delivery: true }, abort);
        return JSON.stringify(res);
      }
    }));
    register(defineTool2({
      name: "opc_delivery_submit",
      description: "\u4EE5\u7ED3\u6784\u5316\u5B57\u6BB5\u63D0\u4EA4\u5B8C\u6574\u6539\u9020\u63D0\u6848\u3002\u82E5\u5DF2\u6682\u5B58\u6587\u4EF6\uFF0Cchanges \u53EF\u4EC5\u4F20 {id, path, reason, group}\u3002\u65E7\u7248\u53EF\u7528 proposal JSON \u5B57\u7B26\u4E32\u3002",
      parameters: proposalParameters(port, portLocked),
      output,
      async execute(args) {
        if (job.status !== "analyzing") throw new Error("\u672C\u8F6E\u5DF2\u63D0\u4EA4\u65B9\u6848");
        if (repeatedProposal || validationErrors.length >= MAX_VALIDATION_ERRORS) throw new Error("\u6280\u672F\u65B9\u6848\u8FDE\u7EED\u6821\u9A8C\u672A\u901A\u8FC7\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u91CD\u8BD5");
        job.events.push(formatToolStep("submit"));
        delivery.core.emit("change");
        let candidate;
        try {
          const { proposal, ...fields } = args;
          candidate = proposal ? JSON.parse(proposal) : { issues: [], unresolved: [], changes: [], decisions: [], ...fields };
          if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("\u63D0\u6848\u5FC5\u987B\u662F\u5B8C\u6574\u7684 JSON \u5BF9\u8C61");
          if (candidate && typeof candidate.contract === "object" && candidate.contract !== null) {
            candidate.contract = { ...candidate.contract, slug: job.slug, base_url: job.url };
          }
          candidate.delivery_format = 1;
          if (updating) candidate.base_version = (await readActiveVersion()).version;
          await delivery.submit(job, root, candidate, abort, { dockerfileOnly: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const detail = await worker({ action: "redact_feedback", root, text: message.slice(0, 2e3) }, abort);
          const duplicateError = validationErrors.includes(detail);
          validationErrors.push(detail);
          job.analysisFailure = detail;
          if (candidate) {
            const rej = fingerprint({
              contract: candidate.contract,
              issues: candidate.issues,
              changes: candidate.changes,
              unresolved: candidate.unresolved,
              decisions: candidate.decisions,
              reason: detail
            });
            if (rejectedProposals.has(rej)) {
              repeatedProposal = true;
              cancel();
            }
            rejectedProposals.add(rej);
          }
          if (!duplicateError) job.events.push(`\u63D0\u6848\u6821\u9A8C\u672A\u901A\u8FC7\uFF1A${detail}`);
          delivery.core.emit("change");
          if (validationErrors.length === MAX_VALIDATION_ERRORS) cancel();
          throw new Error(detail);
        }
        const questions = analysisQuestions(job.proposal);
        return questions.length ? `\u65B9\u6848\u5DF2\u4FDD\u5B58\uFF0C\u7B49\u5F85\u7528\u6237\u56DE\u590D\u3002\u8BF7\u5728\u5F53\u524D\u5BF9\u8BDD\u4E2D\u5217\u51FA\u5F85\u786E\u8BA4\u7684\u95EE\u9898\u4E0E\u53EF\u9009\u65B9\u6848\uFF0C\u518D\u7ED3\u675F\u672C\u8F6E\uFF1A
${questions.join("\n")}` : "\u65B9\u6848\u901A\u8FC7\u3002\u53EA\u7528\u51E0\u53E5\u8BDD\u8BF4\u660E\u7AEF\u53E3\u3001\u5FC5\u8981\u6539\u9020\u548C\u6280\u80FD\u8303\u56F4\uFF0C\u7136\u540E\u7ED3\u675F\u672C\u8F6E\u3002OPC \u5C06\u81EA\u52A8\u751F\u6210\u4EA4\u4ED8\u5305\u3002";
      }
    }));
    const options = {
      agentOptions,
      signal: abort,
      setup(child) {
        child.tools.restrict({ allow: [] });
        child.systemPrompt.section({
          name: "opc-delivery",
          order: 1,
          text: skill + "\n" + loadBundledSkillText("references/delivery-files.md") + "\n" + loadBundledSkillText("references/assessment.md"),
          complete: true,
          interpolate: false
        });
        for (const [name2, tool] of round.tools) {
          child.tools.register({ ...tool, execute: (...args) => {
            const current = live.round?.tools.get(name2);
            if (!current) throw new Error("\u8BF7\u5148\u7EE7\u7EED\u5F53\u524D\u5E94\u7528\u51C6\u5907");
            return current.execute(...args);
          } });
        }
        child.on("agent/pre-step", async ({ signal: turnSignal }, next) => {
          const decision = await next();
          if (decision.kind !== "enter" || !decision.messages.length) return decision;
          const messages = [];
          for (const message of decision.messages) {
            if (message.source.kind !== "user" || !("rpcId" in message.source)) {
              messages.push(message);
              continue;
            }
            const text3 = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
            if (!text3) continue;
            if (!live.round) {
              await new Promise((resolve2, reject) => {
                delivery.startAnalysis(job.id, "", appCtxId, void 0, {
                  mode: "resume",
                  fromChat: true,
                  onChatReady: resolve2
                }).catch(reject);
              }).catch(() => {
              });
            }
            const current = live.round;
            if (!current || !await current.ready) continue;
            const safeText = await current.reply(text3, turnSignal);
            if (safeText) messages.push({ ...message, content: [{ type: "text", text: safeText }] });
          }
          return messages.length ? { ...decision, messages } : { kind: "reject" };
        });
      }
    };
    live.round = round;
    sessions.set(job.id, live);
    let analysis;
    try {
      analysis = live.handle ?? (job.analysisSessionId ? await ctx.agents.resume({ ...options, resumeSessionId: job.analysisSessionId }) : await ctx.agents.create({ ...options, sessionId: randomUUID5(), meta: { cwd: root } }));
      live.handle = analysis;
    } catch (error) {
      sessions.delete(job.id);
      sessionReady.resolve(false);
      throw error;
    }
    const turnOutcome = {};
    const getTurnOutcome = () => ({ ...turnOutcome });
    const stopObserving = ctx.on("session/event", (session, event) => {
      if (session !== analysis.agent.session || event.type !== "turn/end") return;
      const reason = event.data.reason;
      turnOutcome.failure = reason.kind === "error" ? reason.error : void 0;
      turnOutcome.truncated = reason.kind === "max-tokens";
      turnOutcome.stopped = reason.kind === "aborted" && reason.reason.kind === "user";
    });
    const cancel = () => {
      analysis.agent.cancel({ kind: "user" });
    };
    const onAbort = () => {
      sessionReady.resolve(false);
      cancel();
      wakeReply?.();
    };
    abort.addEventListener("abort", onAbort, { once: true });
    const send = (text3) => {
      analysis.agent.followup({
        id: randomUUID5(),
        role: "user",
        source: { kind: "user" },
        content: [{
          type: "text",
          text: text3
        }]
      });
    };
    try {
      abort.throwIfAborted();
      setDeadline(ANALYSIS_TIMEOUT_MS);
      const session = analysis.agent.session;
      const titles = ctx.get("sessionTitle");
      if (titles && titles.get(session)?.source.kind !== "user") {
        titles.rename(session, `\u90E8\u7F72${job.name}`);
      }
      const previous = job.published || job.upgrade ? await delivery.platform("/" + job.slug, appCtxId).catch(() => void 0) : void 0;
      const runtimeLogs = job.published ? await delivery.platform("/" + job.slug + "/logs", appCtxId).catch(() => void 0) : void 0;
      if (isRepair || job.published && (previous?.error_message || previous?.build_log || runtimeLogs?.runtime_logs)) {
        const mergedFailure = [
          job.failureContext,
          previous?.error_message,
          previous?.build_log?.slice(-8e3),
          runtimeLogs?.runtime_logs?.slice(-4e3)
        ].filter(Boolean).join("\n");
        if (mergedFailure) {
          job.failureContext = await worker({ action: "redact_feedback", root, text: mergedFailure.slice(-24e3) }, abort);
        }
      }
      const deployedBaseline = job.upgrade && previous ? {
        current_version: previous.current_version,
        container_port: previous.container_port,
        language: previous.language,
        runtime_version: previous.runtime_version,
        storage_mounts: Array.isArray(previous.storage_mounts) ? previous.storage_mounts.map((m) => ({
          id: m.id,
          kind: m.kind,
          container_path: m.container_path,
          resource_id: m.resource_id,
          seed_subpath: m.seed_subpath,
          description: m.description
        })) : [],
        resource_ids: Array.isArray(previous.resource_ids) ? previous.resource_ids : [],
        config_keys: Array.isArray(previous.app_config) ? previous.app_config.map((c) => ({
          key: c.key,
          has_value: Boolean(c.has_value || c.value || c.resource_id),
          resource_id: c.resource_id || void 0
        })) : []
      } : void 0;
      abort.throwIfAborted();
      const waitingForReply = job.status === "review" && analysisQuestions(job.proposal).length > 0;
      const taskContext = JSON.stringify({
        name: job.name,
        description: job.description ?? "",
        slug: job.slug,
        base_url: job.url,
        container_port: port,
        port_policy: portLocked ? "locked" : "prefer_app_default_else_opc_default",
        default_container_port: port,
        upgrade: Boolean(job.upgrade),
        deployed_baseline: deployedBaseline,
        instructions: portInstructions + repairInstructions,
        user_answers: job.feedbackHistory || feedback,
        previous_validation_failure: job.analysisFailure ?? "",
        draft_file_changes: draftFileChanges,
        analysis_mode: isRepair ? "repair" : "analysis",
        existing_deployment: Boolean(job.upgrade || job.published),
        previous_plan: prevPlan,
        failed_snapshot: job.failedSnapshot,
        failure_log: job.failureContext ?? "",
        assessment_phase: assessment?.phase,
        task: waitingForReply ? "\u8BF7\u7ED3\u5408 previous_plan \u4E2D\u7684\u5F85\u786E\u8BA4\u4E8B\u9879\u5904\u7406\u63A5\u4E0B\u6765\u6536\u5230\u7684\u7528\u6237\u56DE\u590D\u3002" : taskInstruction
      });
      analysis.agent.inject({
        id: randomUUID5(),
        role: "user",
        source: { kind: "opc-app-delivery", form: "notice", summary: "OPC \u5E94\u7528\u6539\u9020\u4EFB\u52A1\u5DF2\u8F7D\u5165" },
        content: [{ type: "text", text: taskContext }]
      });
      const pendingQuestions = waitingForReply ? analysisQuestions(job.proposal) : [];
      if (pendingQuestions.length > 0) {
        analysis.agent.inject({
          id: randomUUID5(),
          role: "user",
          source: { kind: "opc-app-delivery", form: "notice", summary: `\u7B49\u5F85\u786E\u8BA4\u7684\u95EE\u9898\uFF1A${pendingQuestions.join("\uFF1B")}` },
          content: [{ type: "text", text: pendingQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n") }]
        });
      }
      await onSessionReady(String(analysis.agent.session.id));
      sessionReady.resolve(true);
      let prompt = taskInstruction;
      for (let attempt = 0; ; attempt++) {
        turnOutcome.failure = void 0;
        turnOutcome.truncated = false;
        turnOutcome.stopped = false;
        const repliesBeforeTurn = replyCount;
        let errorMessage = "";
        try {
          if (job.status === "review") {
            if (!analysisQuestions(job.proposal).length) return;
            setDeadline(REPLY_TIMEOUT_MS);
            if (!abort.aborted) await new Promise((resolve2) => {
              wakeReply = resolve2;
            });
            wakeReply = void 0;
            signal.throwIfAborted();
            if (abort.aborted && replyCount === repliesBeforeTurn) return;
            abort.throwIfAborted();
            if (job.status === "review" && !analysisQuestions(job.proposal).length) return;
            setDeadline(ANALYSIS_TIMEOUT_MS);
          } else {
            abort.throwIfAborted();
            if (!fromChat || attempt > 0) send(prompt);
          }
          await analysis.agent.whenIdle();
          if (assessment?.result) return;
        } catch (err) {
          if (signal.aborted || abort.aborted && !repeatedProposal) throw err;
          errorMessage = err instanceof Error ? err.message : String(err);
        }
        if (job.status === "review") {
          if (!analysisQuestions(job.proposal).length) return;
          attempt = -1;
          continue;
        }
        if (repeatedProposal || validationErrors.length >= MAX_VALIDATION_ERRORS) {
          throw new Error(validationErrors.at(-1) ?? "\u6280\u672F\u65B9\u6848\u8FDE\u7EED\u6821\u9A8C\u672A\u901A\u8FC7\uFF0C\u5DF2\u505C\u6B62\u81EA\u52A8\u91CD\u8BD5");
        }
        abort.throwIfAborted();
        const { failure, truncated, stopped } = getTurnOutcome();
        if (stopped) throw new Error("\u5DF2\u505C\u6B62 AI \u5206\u6790\uFF0C\u539F\u6E90\u7801\u548C\u5DF2\u6709\u56DE\u7B54\u5DF2\u4FDD\u7559\u3002");
        if (replyCount !== repliesBeforeTurn) attempt = 0;
        const providerMessage = failure?.message ?? errorMessage;
        const badToolJson = /tool input is invalid JSON/i.test(providerMessage);
        const invalidOutput = badToolJson || truncated;
        const networkError = /(?:timed?\s*out|timeout|connection\s*reset|ECONNRESET|ETIMEDOUT|fetch failed|network|terminated)/i.test(providerMessage);
        const reason = invalidOutput ? badToolJson ? "\u6A21\u578B\u8FD4\u56DE\u7684\u5DE5\u5177\u53C2\u6570\u4E0D\u662F\u5408\u6CD5 JSON" : "\u6A21\u578B\u8F93\u51FA\u8FBE\u5230\u957F\u5EA6\u4E0A\u9650" : providerMessage ? await worker({ action: "redact_feedback", root, text: providerMessage.slice(0, 2e3) }, abort) : validationErrors.at(-1) || (assessment ? "AI \u5C1A\u672A\u63D0\u4EA4\u9A8C\u6536\u7ED3\u8BBA" : "AI \u5C1A\u672A\u63D0\u4EA4\u5B8C\u6574\u63D0\u6848");
        job.analysisFailure = reason;
        if (providerMessage && !invalidOutput && !networkError) throw new Error(reason);
        if (attempt === 2) {
          if (/(?:timed?\s*out|timeout|AI.*超时)/i.test(reason)) {
            throw new Error("AI \u5206\u6790\u8D85\u65F6\uFF0C\u539F\u6E90\u7801\u548C\u5DF2\u6709\u56DE\u7B54\u5DF2\u4FDD\u7559\u3002\u8BF7\u91CD\u8BD5\u5206\u6790\u3002");
          }
          if (/(?:connection\s*error|connection\s*reset|connect\s*timeout|ECONNRESET|ETIMEDOUT|fetch failed)/i.test(reason)) {
            throw new Error("AI \u670D\u52A1\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u539F\u6E90\u7801\u548C\u5DF2\u6709\u56DE\u7B54\u5DF2\u4FDD\u7559\u3002\u8BF7\u68C0\u67E5\u6A21\u578B\u8FDE\u63A5\u540E\u91CD\u65B0\u5206\u6790\u3002");
          }
          throw new Error(reason);
        }
        job.events.push(invalidOutput ? `\u{1F504} ${reason}\uFF0C\u6B63\u5728\u7F29\u77ED\u63D0\u4EA4\u5185\u5BB9\u540E\u91CD\u8BD5\uFF08${attempt + 1}/2\uFF09` : networkError ? `\u{1F504} AI \u670D\u52A1\u6682\u65F6\u4E2D\u65AD\uFF0C\u6B63\u5728\u7EE7\u7EED\u51C6\u5907\uFF08${attempt + 1}/2\uFF09` : `\u{1F504} \u6B63\u5728\u4FEE\u6B63\u5E94\u7528\u51C6\u5907\u68C0\u67E5\uFF08${attempt + 1}/2\uFF09`);
        delivery.core.emit("change");
        prompt = `\u590D\u7528\u5DF2\u786E\u8BA4\u7684\u4FE1\u606F\uFF0C\u53EA\u4FEE\u6B63\u4EE5\u4E0B\u53CD\u9988\u6D89\u53CA\u7684\u5B57\u6BB5\u540E\u63D0\u4EA4\u3002\u9700\u8981\u8865\u8BC1\u636E\u65F6\u53EA\u91CD\u8BFB\u5BF9\u5E94\u4F4D\u7F6E\uFF1A${reason}`;
      }
    } finally {
      sessionReady.resolve(false);
      clearTimeout(deadline);
      stopObserving();
      abort.removeEventListener("abort", onAbort);
      if (live.round === round) live.round = void 0;
    }
  };
  ctx.effect(() => async () => {
    delivery.analyze = void 0;
    await Promise.allSettled([...sessions.values()].map((session) => session.handle?.dispose()));
    sessions.clear();
  });
}

// src/host/app-skills.ts
import { defineTool as defineTool3 } from "@deepseek-ai/dsh-tools";
var AppSkillProvider = class {
  constructor(delivery, control) {
    this.delivery = delivery;
    const invalidate = () => control.invalidate();
    delivery.core.on("skills-changed", invalidate);
    control.signal.addEventListener("abort", () => delivery.core.off("skills-changed", invalidate), { once: true });
  }
  delivery;
  name = "opc-apps";
  async list(options) {
    const expected = this.delivery.core.auth.contexts.applicationContextId;
    if (!expected) return [];
    const jobs = await this.delivery.list(expected);
    options.signal?.throwIfAborted();
    const seenSlugs = /* @__PURE__ */ new Set();
    const activeVerified = jobs.filter((job) => {
      if (job.status !== "verified" || job.userDisabled || job.superseded) return false;
      if (seenSlugs.has(job.slug)) return false;
      seenSlugs.add(job.slug);
      return true;
    });
    return activeVerified.map((job) => ({
      name: `app-${job.slug}`,
      description: `[OPC \u5E94\u7528] ${job.name}\uFF1A${job.proposal?.contract?.description ?? ""}`,
      source: "opc-apps",
      provider: this.name,
      rank: 350,
      invocation: { modelInvocable: true, userInvocable: true },
      locator: { id: job.id, context: expected, version: job.version }
    }));
  }
  async get(candidate, options) {
    const locator = candidate.locator;
    let job;
    try {
      ({ job } = await this.delivery.verifiedJob(locator.id, locator.context));
    } catch {
      return void 0;
    }
    if (job.version !== locator.version) return void 0;
    options.signal?.throwIfAborted();
    const contract = job.proposal.contract;
    const invokeGuide = `API \u4F7F\u7528 opc_app_invoke\uFF0Cjob_id=${job.id}\u3002\u53C2\u6570 JSON \u4F20 params\uFF0C\u6B63\u6587 JSON \u4F20 body\uFF0C\u5DE5\u5177\u4F1A\u6309\u6280\u80FD\u4E2D\u58F0\u660E\u7684\u65B9\u5F0F\u767B\u5F55\u3002\u9875\u9762\u64CD\u4F5C\u4F7F\u7528\u6D4F\u89C8\u5668\u548C\u672C\u6280\u80FD\u7684\u5E94\u7528\u8D26\u53F7\uFF0C\u907F\u514D\u5728\u56DE\u590D\u4E2D\u56DE\u663E\u8D26\u5BC6\u3002\u975E\u53EA\u8BFB\u64CD\u4F5C\u9700\u7528\u6237\u6279\u51C6\uFF0C\u5931\u8D25\u65F6\u4E0D\u5F97\u91CD\u590D\u6267\u884C\u7ED3\u679C\u672A\u77E5\u7684\u5199\u64CD\u4F5C\u3002`;
    const body = job.skillMarkdown?.trim() ? `${job.skillMarkdown.trim()}

## DSH \u8C03\u7528\u65B9\u5F0F
- ${invokeGuide}
- \u5E94\u7528\u5730\u5740\uFF1A${job.url}
` : `# ${job.name}
${contract.description}
\u5E94\u7528\u5730\u5740\uFF1A${job.url}
\u53EA\u8BFB\u4E1A\u52A1 API \u5DF2\u9A8C\u8BC1\uFF1B\u9875\u9762\u672A\u9A8C\u8BC1\u3002
${invokeGuide}
\u63A5\u53E3\u4E0E\u9875\u9762\uFF1A
${JSON.stringify({ apis: contract.apis, pages: contract.pages, workflows: contract.workflows }, null, 2)}`;
    return { ...candidate, content: body };
  }
};
function registerAppTools(ctx, delivery) {
  ctx.effect(() => ctx.tools.register(defineTool3({
    name: "opc_app_invoke",
    description: "\u8C03\u7528\u5DF2\u90E8\u7F72\u4E14\u4E1A\u52A1\u9A8C\u8BC1\u901A\u8FC7\u7684 OPC \u5E94\u7528\u3002\u5148\u52A0\u8F7D app-* \u6280\u80FD\u83B7\u5F97 job_id \u4E0E operation\u3002\u5199\u5165\u64CD\u4F5C\u9700\u8981\u7528\u6237\u6279\u51C6\uFF0C\u7ED3\u679C\u672A\u77E5\u65F6\u4E0D\u8981\u91CD\u8BD5\u3002",
    parameters: { job_id: { type: "string", required: true }, operation: { type: "string", required: true }, params: { type: "string", required: true }, body: { type: "string" } },
    output: { schema: { type: "string" }, render: (_, value) => [{ type: "text", text: value }] },
    async execute(args, exec) {
      if (!exec.agent) throw new Error("\u9700\u8981\u5BF9\u8BDD\u8EAB\u4EFD");
      const expected = delivery.core.auth.contexts.applicationContextId;
      if (!expected) throw new Error("\u8BF7\u5148\u767B\u5F55\u4F01\u4E1A\u5FAE\u4FE1");
      return JSON.stringify(await delivery.invoke(
        args.job_id,
        args.operation,
        JSON.parse(args.params),
        args.body ? JSON.parse(args.body) : void 0,
        expected,
        async (reason) => await ctx.approval.request({
          agent: exec.agent,
          callId: exec.callId,
          toolName: "opc_app_invoke",
          reason,
          signal: exec.signal
        }) === "allowed-once",
        exec.signal
      ));
    }
  })));
}

// src/remote-contract.ts
import { z } from "zod";
var contribution = { package: "dsh-plugin-opc", descriptors: [
  { id: "dsh-plugin-opc#opc/appList", service: "opc", namespace: "opc", method: "appList", invocation: { kind: "direct" }, parameters: [{ name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appList:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appList:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appJob", service: "opc", namespace: "opc", method: "appJob", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appJob:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appJob:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appJob:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appJobByAnalysisSession", service: "opc", namespace: "opc", method: "appJobByAnalysisSession", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appJobByAnalysisSession:sessionId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appJobByAnalysisSession:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appJobByAnalysisSession:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appCheckSlug", service: "opc", namespace: "opc", method: "appCheckSlug", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCheckSlug:slug", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCheckSlug:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appCheckSlug:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appOpcConfig", service: "opc", namespace: "opc", method: "appOpcConfig", invocation: { kind: "direct" }, parameters: [{ name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appOpcConfig:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appOpcConfig:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appPickSourceFolder", service: "opc", namespace: "opc", method: "appPickSourceFolder", invocation: { kind: "direct" }, parameters: [{ name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appPickSourceFolder:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appPickSourceFolder:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appModels", service: "opc", namespace: "opc", method: "appModels", invocation: { kind: "direct" }, parameters: [{ name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appModels:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appModels:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appCatalog", service: "opc", namespace: "opc", method: "appCatalog", invocation: { kind: "direct" }, parameters: [{ name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCatalog:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appCatalog:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appCreate", service: "opc", namespace: "opc", method: "appCreate", invocation: { kind: "direct" }, parameters: [{ name: "inputJson", wire: "inputJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCreate:inputJson", create: () => z.string() } }, { name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCreate:sessionId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCreate:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appCreate:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appAnalyze", service: "opc", namespace: "opc", method: "appAnalyze", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyze:id", create: () => z.string() } }, { name: "feedback", wire: "feedback", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyze:feedback", create: () => z.string() } }, { name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyze:sessionId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyze:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appAnalyze:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appAnalyzeWithMode", service: "opc", namespace: "opc", method: "appAnalyzeWithMode", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyzeWithMode:id", create: () => z.string() } }, { name: "feedback", wire: "feedback", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyzeWithMode:feedback", create: () => z.string() } }, { name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyzeWithMode:sessionId", create: () => z.string() } }, { name: "mode", wire: "mode", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyzeWithMode:mode", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appAnalyzeWithMode:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appAnalyzeWithMode:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appPrepare", service: "opc", namespace: "opc", method: "appPrepare", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appPrepare:id", create: () => z.string() } }, { name: "proposalHash", wire: "proposalHash", source: "json", codec: { mode: "strict", typeSymbol: "opc/appPrepare:proposalHash", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appPrepare:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appPrepare:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appReopenReview", service: "opc", namespace: "opc", method: "appReopenReview", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appReopenReview:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appReopenReview:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appReopenReview:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appReopenDeployment", service: "opc", namespace: "opc", method: "appReopenDeployment", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appReopenDeployment:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appReopenDeployment:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appReopenDeployment:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appCancelAnalysis", service: "opc", namespace: "opc", method: "appCancelAnalysis", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCancelAnalysis:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appCancelAnalysis:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appCancelAnalysis:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/appConfigDraft", service: "opc", namespace: "opc", method: "appConfigDraft", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appConfigDraft:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appConfigDraft:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appConfigDraft:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appSaveConfigDraft", service: "opc", namespace: "opc", method: "appSaveConfigDraft", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveConfigDraft:id", create: () => z.string() } }, { name: "body", wire: "body", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveConfigDraft:body", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveConfigDraft:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appSaveConfigDraft:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/appLocalArtifact", service: "opc", namespace: "opc", method: "appLocalArtifact", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appLocalArtifact:id", create: () => z.string() } }, { name: "filename", wire: "filename", source: "json", codec: { mode: "strict", typeSymbol: "opc/appLocalArtifact:filename", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appLocalArtifact:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appLocalArtifact:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appSaveLocalArtifact", service: "opc", namespace: "opc", method: "appSaveLocalArtifact", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveLocalArtifact:id", create: () => z.string() } }, { name: "filename", wire: "filename", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveLocalArtifact:filename", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveLocalArtifact:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appSaveLocalArtifact:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appHandoff", service: "opc", namespace: "opc", method: "appHandoff", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appHandoff:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appHandoff:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appHandoff:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appSkillPreview", service: "opc", namespace: "opc", method: "appSkillPreview", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSkillPreview:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSkillPreview:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appSkillPreview:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appConfirmDeployment", service: "opc", namespace: "opc", method: "appConfirmDeployment", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appConfirmDeployment:id", create: () => z.string() } }, { name: "inputJson", wire: "inputJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appConfirmDeployment:inputJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appConfirmDeployment:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appConfirmDeployment:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appPublish", service: "opc", namespace: "opc", method: "appPublish", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appPublish:id", create: () => z.string() } }, { name: "confirmationJson", wire: "confirmationJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appPublish:confirmationJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appPublish:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appPublish:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appVerify", service: "opc", namespace: "opc", method: "appVerify", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appVerify:id", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appVerify:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appVerify:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appVerifyWithOptions", service: "opc", namespace: "opc", method: "appVerifyWithOptions", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appVerifyWithOptions:id", create: () => z.string() } }, { name: "optionsJson", wire: "optionsJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appVerifyWithOptions:optionsJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appVerifyWithOptions:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appVerifyWithOptions:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appSetSkillEnabled", service: "opc", namespace: "opc", method: "appSetSkillEnabled", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSetSkillEnabled:id", create: () => z.string() } }, { name: "enabled", wire: "enabled", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSetSkillEnabled:enabled", create: () => z.boolean() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSetSkillEnabled:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appSetSkillEnabled:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/appResources", service: "opc", namespace: "opc", method: "appResources", invocation: { kind: "direct" }, parameters: [{ name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appResources:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appResources:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appDetails", service: "opc", namespace: "opc", method: "appDetails", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDetails:slug", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDetails:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appDetails:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appVersions", service: "opc", namespace: "opc", method: "appVersions", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appVersions:slug", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appVersions:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appVersions:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appLogs", service: "opc", namespace: "opc", method: "appLogs", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appLogs:slug", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appLogs:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appLogs:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appStorage", service: "opc", namespace: "opc", method: "appStorage", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appStorage:slug", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appStorage:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appStorage:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appDownload", service: "opc", namespace: "opc", method: "appDownload", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDownload:slug", create: () => z.string() } }, { name: "selectionJson", wire: "selectionJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDownload:selectionJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDownload:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appDownload:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appSaveDownload", service: "opc", namespace: "opc", method: "appSaveDownload", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveDownload:slug", create: () => z.string() } }, { name: "selectionJson", wire: "selectionJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveDownload:selectionJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appSaveDownload:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appSaveDownload:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appRecheck", service: "opc", namespace: "opc", method: "appRecheck", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appRecheck:slug", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appRecheck:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appRecheck:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appUpdateConfig", service: "opc", namespace: "opc", method: "appUpdateConfig", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appUpdateConfig:slug", create: () => z.string() } }, { name: "bodyJson", wire: "bodyJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appUpdateConfig:bodyJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appUpdateConfig:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appUpdateConfig:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appDelete", service: "opc", namespace: "opc", method: "appDelete", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDelete:slug", create: () => z.string() } }, { name: "purgeVolumes", wire: "purgeVolumes", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDelete:purgeVolumes", create: () => z.boolean() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appDelete:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appDelete:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/appRollback", service: "opc", namespace: "opc", method: "appRollback", invocation: { kind: "direct" }, parameters: [{ name: "slug", wire: "slug", source: "json", codec: { mode: "strict", typeSymbol: "opc/appRollback:slug", create: () => z.string() } }, { name: "payloadJson", wire: "payloadJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/appRollback:payloadJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/appRollback:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/appRollback:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/opcConfigGet", service: "opc", namespace: "opc", method: "opcConfigGet", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/opcConfigGet:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/opcConfigUpdate", service: "opc", namespace: "opc", method: "opcConfigUpdate", invocation: { kind: "direct" }, parameters: [{ name: "payloadJson", wire: "payloadJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/opcConfigUpdate:payloadJson", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/opcConfigUpdate:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/opcConfigReset", service: "opc", namespace: "opc", method: "opcConfigReset", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/opcConfigReset:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/opcConfigTest", service: "opc", namespace: "opc", method: "opcConfigTest", invocation: { kind: "direct" }, parameters: [{ name: "url", wire: "url", source: "json", codec: { mode: "strict", typeSymbol: "opc/opcConfigTest:url", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/opcConfigTest:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/state", service: "opc", namespace: "opc", method: "state", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/state:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/watchState", service: "opc", namespace: "opc", method: "watchState", invocation: { kind: "direct" }, mode: "stream", cancellation: { parameter: "signal" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/watchState:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/startLogin", service: "opc", namespace: "opc", method: "startLogin", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/startLogin:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/cancelLogin", service: "opc", namespace: "opc", method: "cancelLogin", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/cancelLogin:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/logout", service: "opc", namespace: "opc", method: "logout", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/logout:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/syncSession", service: "opc", namespace: "opc", method: "syncSession", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/syncSession:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/switchTenant", service: "opc", namespace: "opc", method: "switchTenant", invocation: { kind: "direct" }, parameters: [{ name: "tenantId", wire: "tenantId", source: "json", codec: { mode: "strict", typeSymbol: "opc/switchTenant:tenantId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/switchTenant:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/listKnowledgeBases", service: "opc", namespace: "opc", method: "listKnowledgeBases", invocation: { kind: "direct" }, parameters: [{ name: "q", wire: "q", source: "json", codec: { mode: "strict", typeSymbol: "opc/listKnowledgeBases:q", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/listKnowledgeBases:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/listSkillsCatalog", service: "opc", namespace: "opc", method: "listSkillsCatalog", invocation: { kind: "direct" }, parameters: [{ name: "q", wire: "q", source: "json", codec: { mode: "strict", typeSymbol: "opc/listSkillsCatalog:q", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/listSkillsCatalog:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/installSkill", service: "opc", namespace: "opc", method: "installSkill", invocation: { kind: "direct" }, parameters: [{ name: "catalogId", wire: "catalogId", source: "json", codec: { mode: "strict", typeSymbol: "opc/installSkill:catalogId", create: () => z.string() } }, { name: "expectedSha256", wire: "expectedSha256", source: "json", codec: { mode: "strict", typeSymbol: "opc/installSkill:expectedSha256", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/installSkill:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/installSkill:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/setSkillEnabled", service: "opc", namespace: "opc", method: "setSkillEnabled", invocation: { kind: "direct" }, parameters: [{ name: "catalogId", wire: "catalogId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setSkillEnabled:catalogId", create: () => z.string() } }, { name: "enabled", wire: "enabled", source: "json", codec: { mode: "strict", typeSymbol: "opc/setSkillEnabled:enabled", create: () => z.boolean() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setSkillEnabled:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/setSkillEnabled:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/uninstallSkill", service: "opc", namespace: "opc", method: "uninstallSkill", invocation: { kind: "direct" }, parameters: [{ name: "catalogId", wire: "catalogId", source: "json", codec: { mode: "strict", typeSymbol: "opc/uninstallSkill:catalogId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/uninstallSkill:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/uninstallSkill:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/setPinnedKnowledgeScope", service: "opc", namespace: "opc", method: "setPinnedKnowledgeScope", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:sessionId", create: () => z.string() } }, { name: "knowledgeBaseId", wire: "knowledgeBaseId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:knowledgeBaseId", create: () => z.string().nullable() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/searchKnowledge", service: "opc", namespace: "opc", method: "searchKnowledge", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:sessionId", create: () => z.string() } }, { name: "query", wire: "query", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:query", create: () => z.string() } }, { name: "knowledgeBaseId", wire: "knowledgeBaseId", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:knowledgeBaseId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/searchKnowledge:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/readKnowledgeDocument", service: "opc", namespace: "opc", method: "readKnowledgeDocument", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:sessionId", create: () => z.string() } }, { name: "knowledgeId", wire: "knowledgeId", source: "json", codec: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:knowledgeId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/listMcpServices", service: "opc", namespace: "opc", method: "listMcpServices", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/listMcpServices:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/invokeMcpTool", service: "opc", namespace: "opc", method: "invokeMcpTool", invocation: { kind: "direct" }, parameters: [{ name: "serviceId", wire: "serviceId", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:serviceId", create: () => z.string() } }, { name: "toolName", wire: "toolName", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:toolName", create: () => z.string() } }, { name: "argumentsJson", wire: "argumentsJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:argumentsJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/invokeMcpTool:result", create: () => z.string() } },
  { id: "dsh-plugin-opc#opc/mountMcpService", service: "opc", namespace: "opc", method: "mountMcpService", invocation: { kind: "direct" }, parameters: [{ name: "serviceId", wire: "serviceId", source: "json", codec: { mode: "strict", typeSymbol: "opc/mountMcpService:serviceId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/mountMcpService:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/mountMcpService:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/unmountMcpService", service: "opc", namespace: "opc", method: "unmountMcpService", invocation: { kind: "direct" }, parameters: [{ name: "serviceId", wire: "serviceId", source: "json", codec: { mode: "strict", typeSymbol: "opc/unmountMcpService:serviceId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/unmountMcpService:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/unmountMcpService:result", create: () => z.void() } },
  { id: "dsh-plugin-opc#opc/decideDebugInvocation", service: "opc", namespace: "opc", method: "decideDebugInvocation", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:id", create: () => z.string() } }, { name: "allowed", wire: "allowed", source: "json", codec: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:allowed", create: () => z.boolean() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:result", create: () => z.void() } }
] };
var TYPERT = { package: contribution.package, face: "host", schemas: [], invocations: contribution.descriptors, model: { services: [], events: [], objects: [] } };

// src/index.ts
var name = "dsh-plugin-opc";
var inject = ["credentials", "authorization", "skills", "tools", "agents", "approval", "typert", "llm"];
var Config = z2.object({ platformBaseUrl: z2.string().default("https://aiwork.benlai.com"), clientId: z2.string().default("work-desktop"), dataHome: z2.string().default(""), appDomainRoot: z2.string().default(""), appDefaultPort: z2.number().default(8080) });
function apply(ctx, config) {
  const key = credentialKey(name, "enterprise");
  const home = config.dataHome || resolveDshHome();
  const configStore = new OpcConfigStore(home, {
    platformBaseUrl: config.platformBaseUrl,
    appDomainRoot: config.appDomainRoot,
    appDefaultPort: config.appDefaultPort
  });
  const initialConfig = configStore.loadSync();
  const auth = new AuthManager(new PlatformHttp(initialConfig.platform_base), {
    async read() {
      const record2 = await ctx.credentials.readRecord(key);
      if (record2?.kind !== "grant") return void 0;
      const payload = record2.payload;
      if (!payload || typeof payload.refreshToken !== "string" || typeof payload.platformBaseUrl !== "string" || !payload.lastContext) return void 0;
      return payload;
    },
    async write(payload) {
      await ctx.credentials.modifyRecord(key, async () => ({ kind: "grant", payload }));
    },
    async delete() {
      await ctx.credentials.deleteRecord(key);
    }
  }, async (url) => {
    await open(url);
  }, config.clientId);
  const core = new OpcCore(auth, config.dataHome || resolveDshHome());
  const delivery = new AppDelivery(core, config.dataHome || resolveDshHome(), {
    async read(id) {
      const record2 = await ctx.credentials.readRecord(credentialKey(name, `app-${id}`));
      return record2?.kind === "grant" ? record2.payload : {};
    },
    async write(id, payload) {
      await ctx.credentials.modifyRecord(credentialKey(name, `app-${id}`), async () => ({ kind: "grant", payload }));
    }
  }, { appDomainRoot: initialConfig.app_domain_root, appDefaultPort: initialConfig.app_default_port });
  ctx.plugin(OpcRemoteService, { core, delivery, configStore });
  ctx.inject(["systemPrompt"], (child) => attachAppAgent(child, delivery));
  ctx.effect(() => ctx.skills.registerProvider((control) => new AppSkillProvider(delivery, control)));
  registerAppTools(ctx, delivery);
  ctx.effect(() => {
    const changed = () => {
      ctx.emit("plugin-manager/changed", { reason: "plugin" });
    };
    core.on("skills-changed", changed);
    return () => {
      core.off("skills-changed", changed);
    };
  });
  ctx.effect(() => ctx.skills.registerProvider((control) => new EnterpriseSkillProvider(core, control)));
  registerTools(ctx, core);
  ctx.effect(() => ctx.authorization.registerFlow({
    key,
    label: "OPC \u4F01\u4E1A\u5E73\u53F0",
    methods: [{ id: "oauth", label: "\u4F01\u4E1A\u5FAE\u4FE1 / SSO \u767B\u5F55" }],
    async run(session) {
      const login = await auth.startLogin();
      session.notify({ message: "\u8BF7\u5728\u6D4F\u89C8\u5668\u5B8C\u6210\u4F01\u4E1A\u6388\u6743", url: login.authorizeUrl });
      await new Promise((resolve2, reject) => {
        const cleanup = () => {
          auth.off("change", changed);
          session.signal.removeEventListener("abort", cancelled);
        };
        const changed = () => {
          if (auth.state.loginInProgress) return;
          cleanup();
          if (auth.state.signedIn) resolve2();
          else reject(new Error(auth.state.loginError?.code ?? "LOGIN_CANCELLED"));
        };
        const cancelled = () => {
          auth.cancelLogin();
          cleanup();
          reject(new Error("LOGIN_CANCELLED"));
        };
        auth.on("change", changed);
        session.signal.addEventListener("abort", cancelled, { once: true });
        if (session.signal.aborted) cancelled();
        else changed();
      });
    }
  }));
  ctx.effect(() => {
    void auth.restore().catch(() => core.emit("change"));
    return () => auth.dispose();
  });
}
export {
  Config,
  TYPERT,
  apply,
  inject,
  name
};
