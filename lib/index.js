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
  get current() {
    return this.#context && structuredClone(this.#context);
  }
  get epoch() {
    return this.#epoch;
  }
  replace(context) {
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
var PlatformHttp = class {
  constructor(base, timeoutMs = 15e3, fetcher = fetch) {
    this.timeoutMs = timeoutMs;
    this.fetcher = fetcher;
    this.base = new URL(base);
    if (this.base.username || this.base.password || this.base.search || this.base.hash) throw new OpcError("INVALID_PLATFORM_URL");
    if (this.base.protocol !== "https:" && !(this.base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(this.base.hostname))) throw new OpcError("INSECURE_PLATFORM_URL");
  }
  timeoutMs;
  fetcher;
  base;
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
  async accept(body, revision, newLogin = false) {
    if (revision !== this.#revision) throw new OpcError("CONTEXT_CHANGED");
    const access = text(body.access_token), refresh = text(body.refresh_token);
    if (!access || !refresh || typeof body.expires_in !== "number" || body.expires_in <= 0) throw new OpcError("INVALID_TOKEN_RESPONSE");
    let view = body;
    if (!text(view.subject) || !Array.isArray(view.spaces)) view = { ...body, ...check(await this.http.request("/integration/v1/session", { token: access })) };
    if (revision !== this.#revision) throw new OpcError("CONTEXT_CHANGED");
    const subject = text(view.subject);
    if (!subject || !Array.isArray(view.spaces) || !view.spaces.every((s) => typeof s === "string")) throw new OpcError("INVALID_SESSION_RESPONSE");
    const old = this.contexts.current;
    const spaces = view.spaces;
    const tenant = old?.subject === subject && spaces.includes(old.tenant) ? old.tenant : spaces.includes(text(view.tenant)) ? text(view.tenant) : spaces[0] ?? "";
    const context = {
      issuer: this.http.base.origin,
      subject,
      tenant,
      spaces,
      generation: newLogin || !old ? this.contexts.epoch + 1 : old.generation,
      displayName: text(view.name) || old?.displayName || "",
      email: text(view.email) || old?.email || "",
      spacesDetail: spaces.map((id) => {
        const details = Array.isArray(view.spaces_detail) ? view.spaces_detail : [];
        const detail = details.find((item) => item && typeof item === "object" && item.id === id);
        return { id, name: detail && typeof detail.name === "string" ? detail.name : id };
      })
    };
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
      if (revision === this.#revision && error instanceof OpcError && ["REFRESH_REUSE_DETECTED", "SESSION_REVOKED"].includes(error.code)) await this.clear();
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
      const code = url.searchParams.get("code");
      void (async () => {
        try {
          if (!code) throw new OpcError("AUTHORIZATION_DENIED");
          const result = check(await this.http.request("/integration/v1/auth/token", { signal: controller.signal, body: { grant_type: "authorization_code", client_id: this.clientId, code, code_verifier: verifier, device: this.device, audience: "work" } }));
          if (controller.signal.aborted) throw new OpcError("LOGIN_CANCELLED");
          await this.accept(result, revision, true);
          response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("\u767B\u5F55\u6210\u529F\uFF0C\u8BF7\u8FD4\u56DE DSH\u3002");
        } catch (error) {
          if (revision === this.#revision) this.#error = { code: error instanceof OpcError ? error.code : "LOGIN_FAILED", message: "\u4F01\u4E1A\u767B\u5F55\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002" };
          response.writeHead(400).end("Login failed");
        } finally {
          if (this.#login?.server === server) this.cancelLogin();
        }
      })();
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
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
    if (cached && cached.expires > Date.now()) return;
    const items = await list();
    captured.assertCurrent();
    const item = items.find((item2) => item2.tenant_id === tenant && item2.knowledge_base_id === id && item2.availability === "available");
    if (!item) {
      this.#entries.delete(key);
      throw new OpcError("RESOURCE_NOT_ACCESSIBLE");
    }
    this.#entries.set(key, { item, expires: Date.now() + 3e4 });
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
  const zip = await new Promise((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error || !value ? reject(error) : resolve(value)));
  const names = /* @__PURE__ */ new Set(), skillPaths = [];
  let entries = 0, files = 0, total = 0;
  try {
    await new Promise((resolve, reject) => {
      const fail = (error) => {
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("end", resolve);
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
  begin(session, turn) {
    const scope = this.#pins.get(session);
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
    const captured = this.auth.contexts.capture();
    const items = [];
    let offset = 0, complete = true;
    for (; ; ) {
      const page = await this.request(`/integration/v1/resources/${kind}?tenant_id=${encodeURIComponent(captured.context.tenant)}&q=${encodeURIComponent(q)}&offset=${offset}&limit=100`);
      captured.assertCurrent();
      if (!Array.isArray(page.items) || typeof page.total !== "number") throw new OpcError("INVALID_PLATFORM_RESPONSE");
      complete &&= page.complete === true && (!Array.isArray(page.failures) || page.failures.length === 0);
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
        return items;
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
    if (scope.knowledge_base_id) {
      await this.authz.knowledge(captured.context.tenant, scope.knowledge_base_id, () => this.catalog("knowledge-bases"));
    }
    captured.assertCurrent();
    const result = await this.request("/integration/v1/knowledge/search", { query, ...scope });
    captured.assertCurrent();
    if (!Array.isArray(result.results)) throw new OpcError("INVALID_PLATFORM_RESPONSE");
    const ids = result.results.map((hit) => {
      if (!hit || typeof hit !== "object" || typeof hit.knowledge_id !== "string") throw new OpcError("INVALID_PLATFORM_RESPONSE");
      if (scope.knowledge_base_id && ((hit.source_tenant ?? hit.tenant_id) !== scope.tenant_id || hit.knowledge_base_id !== scope.knowledge_base_id)) throw new OpcError("SCOPE_MISMATCH");
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
    if (scope) await this.authz.knowledge(captured.context.tenant, scope.knowledgeBaseId, () => this.catalog("knowledge-bases"));
    captured.assertCurrent();
    const result = await this.request(`/integration/v1/knowledge/${encodeURIComponent(knowledgeId)}?include_content=true&tenant=${encodeURIComponent(captured.context.tenant)}${scope ? `&knowledge_base_id=${encodeURIComponent(scope.knowledgeBaseId)}` : ""}`);
    captured.assertCurrent();
    const data = result.data;
    this.scopes.verifyDocument(session, turn, String(result.source_tenant ?? ""), data?.knowledge_base_id ?? "");
    if (result.source_tenant !== captured.context.tenant || !data?.knowledge_base_id) throw new OpcError("SCOPE_MISMATCH");
    await this.authz.knowledge(captured.context.tenant, data.knowledge_base_id, () => this.catalog("knowledge-bases"));
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
  constructor(core, register, approve) {
    this.core = core;
    this.register = register;
    this.approve = approve;
    core.auth.on("change", this.changed);
  }
  core;
  register;
  approve;
  #mounts = /* @__PURE__ */ new Map();
  changed = () => {
    for (const [id, mount] of this.#mounts) if (mount.epoch !== this.core.auth.contexts.epoch) this.unmount(id);
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
  async mount(serviceId, expectedContextId) {
    const captured = this.core.auth.contexts.capture(expectedContextId);
    if (this.#mounts.has(serviceId)) return;
    const body = await this.core.request(`/integration/v1/mcp/services?include_schema=true&tenant=${encodeURIComponent(captured.context.tenant)}`);
    captured.assertCurrent();
    const data = body.data;
    const service = data?.services?.find((item) => item.service_id === serviceId);
    if (!service || !Array.isArray(service.tools)) throw new OpcError("RESOURCE_NOT_ACCESSIBLE");
    const tools = service.tools.map((item) => {
      if (typeof item === "string") return { name: item, inputSchema: { type: "object", additionalProperties: true } };
      if (!item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string") throw new OpcError("INVALID_TOOL_CATALOG");
      const tool = item;
      return { name: item.name, description: typeof tool.description === "string" ? tool.description : "", inputSchema: tool.input_schema ?? tool.inputSchema ?? { type: "object", additionalProperties: true } };
    });
    const secret = randomBytes2(32).toString("hex");
    const expected = Buffer.from(`Bearer ${secret}`);
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
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
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
  dispose() {
    this.core.auth.off("change", this.changed);
    for (const id of this.list()) this.unmount(id);
  }
};

// src/host/remote-service.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
var _decideDebugInvocation_dec, _unmountMcpService_dec, _mountMcpService_dec, _invokeMcpTool_dec, _listMcpServices_dec, _readKnowledgeDocument_dec, _searchKnowledge_dec, _setPinnedKnowledgeScope_dec, _uninstallSkill_dec, _setSkillEnabled_dec, _installSkill_dec, _listSkillsCatalog_dec, _listKnowledgeBases_dec, _switchTenant_dec, _logout_dec, _cancelLogin_dec, _startLogin_dec, _watchState_dec, _state_dec, _a, _init;
var OpcRemoteService = class extends (_a = TypertRemoteService, _state_dec = [Remote], _watchState_dec = [Remote({ mode: "stream" })], _startLogin_dec = [Remote], _cancelLogin_dec = [Remote], _logout_dec = [Remote], _switchTenant_dec = [Remote], _listKnowledgeBases_dec = [Remote], _listSkillsCatalog_dec = [Remote], _installSkill_dec = [Remote], _setSkillEnabled_dec = [Remote], _uninstallSkill_dec = [Remote], _setPinnedKnowledgeScope_dec = [Remote], _searchKnowledge_dec = [Remote], _readKnowledgeDocument_dec = [Remote], _listMcpServices_dec = [Remote], _invokeMcpTool_dec = [Remote], _mountMcpService_dec = [Remote], _unmountMcpService_dec = [Remote], _decideDebugInvocation_dec = [Remote], _a) {
  constructor(ctx, core) {
    super(ctx, "opc");
    this.core = core;
    __runInitializers(_init, 5, this);
    __publicField(this, "pendingApprovals", /* @__PURE__ */ new Map());
    __publicField(this, "mounts");
    __publicField(this, "manager");
    __publicField(this, "requestApproval", (prompt) => new Promise((resolve) => {
      const expectedContextId = contextId(this.core.auth.contexts.capture().context);
      const id = randomUUID3();
      const finish = (outcome) => {
        prompt.signal.removeEventListener("abort", abort);
        this.pendingApprovals.delete(id);
        this.core.emit("change");
        resolve(outcome);
      };
      const abort = () => finish("cancelled");
      this.pendingApprovals.set(id, { contextId: expectedContextId, prompt: { serviceId: prompt.serviceId, toolName: prompt.toolName, arguments: prompt.arguments }, resolve: finish });
      prompt.signal.addEventListener("abort", abort, { once: true });
      if (prompt.signal.aborted) abort();
      else this.core.emit("change");
    }));
    ctx.inject(["mcpManager"], (child) => {
      const manager = child.mcpManager;
      const mounts = new ManagedMcpMounts(core, (name2, entry) => manager.register(name2, entry), this.requestApproval);
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
  core;
  async state() {
    const state = this.core.auth.state;
    const mounted = this.mounts?.list() ?? [];
    return JSON.stringify({ ...state, mountAvailable: !!this.mounts, mcpConnections: Object.fromEntries(mounted.map((id) => {
      const status = this.manager?.list().find((item) => item.name === mcpMountName(id))?.status;
      return [id, { state: status?.state ?? "connecting", toolCount: status?.state === "connected" ? status.toolCount : 0 }];
    })), pinnedScopes: this.core.scopes.pins(), mountedServices: mounted, approvals: [...this.pendingApprovals].map(([id, pending]) => ({ id, contextId: pending.contextId, ...pending.prompt })), context: state.context ? { ...state.context, contextId: contextId(state.context), epoch: this.core.auth.contexts.epoch } : null });
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
        if (!dirty && !signal.aborted) await new Promise((resolve) => {
          wake = resolve;
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
  async switchTenant(tenantId) {
    this.core.auth.switchTenant(tenantId);
  }
  async listKnowledgeBases(q) {
    return JSON.stringify(await this.core.catalog("knowledge-bases", q));
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
    this.mounts?.unmount(serviceId);
  }
  async decideDebugInvocation(id, allowed, expectedContextId) {
    this.core.auth.contexts.capture(expectedContextId);
    const pending = this.pendingApprovals.get(id);
    if (!pending || pending.contextId !== expectedContextId) throw new OpcError("CONTEXT_CHANGED");
    pending.resolve(allowed ? "allowed-once" : "rejected");
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "state", _state_dec, OpcRemoteService);
__decorateElement(_init, 1, "watchState", _watchState_dec, OpcRemoteService);
__decorateElement(_init, 1, "startLogin", _startLogin_dec, OpcRemoteService);
__decorateElement(_init, 1, "cancelLogin", _cancelLogin_dec, OpcRemoteService);
__decorateElement(_init, 1, "logout", _logout_dec, OpcRemoteService);
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
    if (turns.get(session) !== turn) {
      const old = turns.get(session);
      if (old) core.scopes.end(session, old);
      core.scopes.begin(session, turn);
      turns.set(session, turn);
    }
    return { session, turn };
  };
  const output = { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] };
  ctx.effect(() => ctx.tools.register(defineTool({
    name: "opc_knowledge_search",
    description: "\u68C0\u7D22\u5F53\u524D\u4F01\u4E1A\u7A7A\u95F4\u77E5\u8BC6\u5E93\uFF1B\u9075\u5B88\u7528\u6237\u9650\u5B9A\u7684\u77E5\u8BC6\u5E93\u8303\u56F4\u3002",
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
      return JSON.stringify(await core.mcp.invoke({ serviceId: args.service_id, toolName: args.tool_name, arguments: args.arguments }, (prompt) => ctx.approval.request({ agent, callId: exec.callId, toolName: "opc_mcp_invoke", reason: `\u4F01\u4E1A\u64CD\u4F5C ${prompt.serviceId}/${prompt.toolName}
${JSON.stringify(prompt.arguments)}`, signal: prompt.signal }), exec.signal));
    }
  })));
}

// src/remote-contract.ts
import { z } from "zod";
var contribution = { package: "@opc/dsh-plugin-opc", descriptors: [
  { id: "@opc/dsh-plugin-opc#opc/state", service: "opc", namespace: "opc", method: "state", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/state:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/watchState", service: "opc", namespace: "opc", method: "watchState", invocation: { kind: "direct" }, mode: "stream", cancellation: { parameter: "signal" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/watchState:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/startLogin", service: "opc", namespace: "opc", method: "startLogin", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/startLogin:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/cancelLogin", service: "opc", namespace: "opc", method: "cancelLogin", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/cancelLogin:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/logout", service: "opc", namespace: "opc", method: "logout", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/logout:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/switchTenant", service: "opc", namespace: "opc", method: "switchTenant", invocation: { kind: "direct" }, parameters: [{ name: "tenantId", wire: "tenantId", source: "json", codec: { mode: "strict", typeSymbol: "opc/switchTenant:tenantId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/switchTenant:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/listKnowledgeBases", service: "opc", namespace: "opc", method: "listKnowledgeBases", invocation: { kind: "direct" }, parameters: [{ name: "q", wire: "q", source: "json", codec: { mode: "strict", typeSymbol: "opc/listKnowledgeBases:q", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/listKnowledgeBases:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/listSkillsCatalog", service: "opc", namespace: "opc", method: "listSkillsCatalog", invocation: { kind: "direct" }, parameters: [{ name: "q", wire: "q", source: "json", codec: { mode: "strict", typeSymbol: "opc/listSkillsCatalog:q", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/listSkillsCatalog:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/installSkill", service: "opc", namespace: "opc", method: "installSkill", invocation: { kind: "direct" }, parameters: [{ name: "catalogId", wire: "catalogId", source: "json", codec: { mode: "strict", typeSymbol: "opc/installSkill:catalogId", create: () => z.string() } }, { name: "expectedSha256", wire: "expectedSha256", source: "json", codec: { mode: "strict", typeSymbol: "opc/installSkill:expectedSha256", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/installSkill:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/installSkill:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/setSkillEnabled", service: "opc", namespace: "opc", method: "setSkillEnabled", invocation: { kind: "direct" }, parameters: [{ name: "catalogId", wire: "catalogId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setSkillEnabled:catalogId", create: () => z.string() } }, { name: "enabled", wire: "enabled", source: "json", codec: { mode: "strict", typeSymbol: "opc/setSkillEnabled:enabled", create: () => z.boolean() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setSkillEnabled:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/setSkillEnabled:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/uninstallSkill", service: "opc", namespace: "opc", method: "uninstallSkill", invocation: { kind: "direct" }, parameters: [{ name: "catalogId", wire: "catalogId", source: "json", codec: { mode: "strict", typeSymbol: "opc/uninstallSkill:catalogId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/uninstallSkill:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/uninstallSkill:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/setPinnedKnowledgeScope", service: "opc", namespace: "opc", method: "setPinnedKnowledgeScope", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:sessionId", create: () => z.string() } }, { name: "knowledgeBaseId", wire: "knowledgeBaseId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:knowledgeBaseId", create: () => z.string().nullable() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/setPinnedKnowledgeScope:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/searchKnowledge", service: "opc", namespace: "opc", method: "searchKnowledge", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:sessionId", create: () => z.string() } }, { name: "query", wire: "query", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:query", create: () => z.string() } }, { name: "knowledgeBaseId", wire: "knowledgeBaseId", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:knowledgeBaseId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/searchKnowledge:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/searchKnowledge:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/readKnowledgeDocument", service: "opc", namespace: "opc", method: "readKnowledgeDocument", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:sessionId", create: () => z.string() } }, { name: "knowledgeId", wire: "knowledgeId", source: "json", codec: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:knowledgeId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/readKnowledgeDocument:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/listMcpServices", service: "opc", namespace: "opc", method: "listMcpServices", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "opc/listMcpServices:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/invokeMcpTool", service: "opc", namespace: "opc", method: "invokeMcpTool", invocation: { kind: "direct" }, parameters: [{ name: "serviceId", wire: "serviceId", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:serviceId", create: () => z.string() } }, { name: "toolName", wire: "toolName", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:toolName", create: () => z.string() } }, { name: "argumentsJson", wire: "argumentsJson", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:argumentsJson", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/invokeMcpTool:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/invokeMcpTool:result", create: () => z.string() } },
  { id: "@opc/dsh-plugin-opc#opc/mountMcpService", service: "opc", namespace: "opc", method: "mountMcpService", invocation: { kind: "direct" }, parameters: [{ name: "serviceId", wire: "serviceId", source: "json", codec: { mode: "strict", typeSymbol: "opc/mountMcpService:serviceId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/mountMcpService:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/mountMcpService:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/unmountMcpService", service: "opc", namespace: "opc", method: "unmountMcpService", invocation: { kind: "direct" }, parameters: [{ name: "serviceId", wire: "serviceId", source: "json", codec: { mode: "strict", typeSymbol: "opc/unmountMcpService:serviceId", create: () => z.string() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/unmountMcpService:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/unmountMcpService:result", create: () => z.void() } },
  { id: "@opc/dsh-plugin-opc#opc/decideDebugInvocation", service: "opc", namespace: "opc", method: "decideDebugInvocation", invocation: { kind: "direct" }, parameters: [{ name: "id", wire: "id", source: "json", codec: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:id", create: () => z.string() } }, { name: "allowed", wire: "allowed", source: "json", codec: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:allowed", create: () => z.boolean() } }, { name: "expectedContextId", wire: "expectedContextId", source: "json", codec: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:expectedContextId", create: () => z.string() } }], result: { mode: "strict", typeSymbol: "opc/decideDebugInvocation:result", create: () => z.void() } }
] };
var TYPERT = { package: contribution.package, face: "host", schemas: [], invocations: contribution.descriptors, model: { services: [], events: [], objects: [] } };

// src/index.ts
var name = "dsh-plugin-opc";
var inject = ["credentials", "authorization", "skills", "tools", "agents", "approval", "typert"];
var Config = z2.object({ platformBaseUrl: z2.string().default("https://shtokendance.benlai.com"), clientId: z2.string().default("work-desktop"), dataHome: z2.string().default("") });
function apply(ctx, config) {
  const key = credentialKey(name, "enterprise");
  const auth = new AuthManager(new PlatformHttp(config.platformBaseUrl), {
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
  ctx.plugin(OpcRemoteService, core);
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
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          auth.off("change", changed);
          session.signal.removeEventListener("abort", cancelled);
        };
        const changed = () => {
          if (auth.state.loginInProgress) return;
          cleanup();
          if (auth.state.signedIn) resolve();
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
