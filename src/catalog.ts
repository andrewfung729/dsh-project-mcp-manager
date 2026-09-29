/**
 * dsh-project-mcp-manager —— 配置目录、影子合并与诊断解析（纯函数）。
 *
 * CLI 与装载器共用这一口径。本模块**不得** import `registry.ts` 或
 * `@deepseek-ai/dsh-mcp-client`：`dsh-mcp` 是独立 Node 进程，profile 的
 * `autoInstallPeers: false` 下解析不到宿主 peer。装载才需要客户端，留在 registry。
 */
import { join } from "node:path";
import { MCP_YML_FILE } from "./dsh-paths.js";
import { CC_PROJECT_FILE, JSON_MCP_FILE, type McpRowSource, type SourcedRow } from "./json-file.js";
import { type PatchRow } from "./mcp-file.js";
import { configFromPatchRow } from "./model.js";

/** 变更计划里的一行（纯数据，供装载器与 CLI 共用）。 */
export interface DesiredProjectRow {
  rawName: string;
  row: PatchRow;
  source?: McpRowSource;
}

/** 项目根下原生受管块文件路径。 */
export function projectMcpFile(projectRoot: string): string {
  return join(projectRoot, ".dsh", MCP_YML_FILE);
}

/** 项目根下 DSH 自有 JSON 配置文件路径（`<root>/.dsh/mcp.json`）。 */
export function projectDshJsonFile(projectRoot: string): string {
  return join(projectRoot, ".dsh", JSON_MCP_FILE);
}

/** 项目根下 CC project scope 兼容文件路径（只读）。 */
export function projectMcpJsonFile(projectRoot: string): string {
  return join(projectRoot, CC_PROJECT_FILE);
}

const SOURCE_RANK: Record<McpRowSource, number> = {
  "dsh-project": 0,
  "dsh-project-json": 1,
  "cc-project": 2,
  "dsh-profile-user": 3,
  "dsh-user-yml": 4,
  "dsh-user": 5
};
/** 项目层来源（按项目装载、按会话隔离）与用户层来源（宿主级全局装载）的分界。 */
const PROJECT_LAYER_MAX_RANK = 2;

/** 该来源是否属于项目层；source 缺省（旧调用方）按项目层处理。 */
export function isProjectLayerSource(source: McpRowSource | undefined): boolean {
  return source === undefined || SOURCE_RANK[source] <= PROJECT_LAYER_MAX_RANK;
}

/** 服务身份键：stdio 看「可执行文件 + 参数」，http 看 url。command/url 缺失或为空的行
 * 不注册身份键（disabled 占名行常无 config，只占名字不冒充服务）。Windows 下路径大小写
 * 不敏感，command 统一小写；args 逐项字符串化后以 \0 连接（顺序与内容都要求一致）。 */
function serviceIdentityKey(item: SourcedRow): string | undefined {
  const config = configFromPatchRow(item.row);
  if (config === undefined) return undefined;
  if (config.transport === "streamable-http") {
    return typeof config.url === "string" && config.url !== "" ? "h\0" + config.url : undefined;
  }
  if (config.transport === "stdio") {
    if (typeof config.command !== "string" || config.command === "") return undefined;
    const command = process.platform === "win32" ? config.command.toLowerCase() : config.command;
    const args = Array.isArray(config.args) ? config.args.map(String).join("\0") : "";
    return "s\0" + command + "\0" + args;
  }
  return undefined;
}

/** 归一名键：小写并去掉非字母数字后同名视为同一服务（unityMCP 与 unity-mcp 是一个
 * 服务器的两种写法，真实事故对）；归一后为空串的原始名不注册该键。 */
function normalizedNameKey(rawName: string): string | undefined {
  const norm = rawName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm === "" ? undefined : norm;
}

/** 被身份/归一名去重剔除的行：loser 原名、winner 原名、命中维度、两侧来源。
 *  来源字段用于归因过滤：纯用户层之间的冲突不该记到每个项目的诊断里。 */
export interface IdentityShadow {
  name: string;
  winner: string;
  reason: "identity" | "normname";
  /** 被剔除方（loser）的来源层。 */
  source: McpRowSource;
  /** 胜出方（winner）的来源层。 */
  winnerSource: McpRowSource;
}

/** 用户层之间被同名/同服务遮蔽的行（全局层内部冲突，按全局归因）。 */
export interface GlobalShadow {
  name: string;
  winner: string;
  source: McpRowSource;
  winnerSource: McpRowSource;
}

/** 影子键的条件 get：键为 undefined 直接不查，免调用点三元。 */
function getIfDefined<V>(map: Map<string, V>, key: string | undefined): V | undefined {
  return key === undefined ? undefined : map.get(key);
}

function pushUnique(list: string[], name: string): void {
  if (!list.includes(name)) list.push(name);
}

/** 跨层遮蔽诊断的四个收集桶。 */
interface ShadowBuckets {
  shadowedOwnCc: string[];
  shadowedUser: string[];
  shadowedGlobal: GlobalShadow[];
  shadowedIdentity: IdentityShadow[];
}

/**
 * 被遮蔽行归因：
 *  - 项目 cc 行被任一 DSH 项目行遮蔽 → shadowedOwnCc；
 *  - 用户层行被项目层行遮蔽 → shadowedUser（项目侧压制的候选）；
 *  - 用户层行被另一条用户层行遮蔽 → shadowedGlobal（全局层内部冲突，此前零可见性）。
 */
function classifyShadow(item: SourcedRow, winner: SourcedRow, buckets: ShadowBuckets): void {
  if (item.source === "cc-project" && SOURCE_RANK[winner.source] < SOURCE_RANK["cc-project"]) {
    pushUnique(buckets.shadowedOwnCc, item.rawName);
    return;
  }
  if (SOURCE_RANK[item.source] <= PROJECT_LAYER_MAX_RANK) return;
  if (SOURCE_RANK[winner.source] <= PROJECT_LAYER_MAX_RANK) {
    pushUnique(buckets.shadowedUser, item.rawName);
    return;
  }
  if (!buckets.shadowedGlobal.some((shadow) => shadow.name === item.rawName)) {
    buckets.shadowedGlobal.push({ name: item.rawName, winner: winner.rawName, source: item.source, winnerSource: winner.source });
  }
}

/** 单行三键先到先得：命中已有影子键则归因剔除，否则注册进影子表（disabled 占名行也注册）。 */
function mergeOneRow(item: SourcedRow, byName: Map<string, SourcedRow>, byNorm: Map<string, SourcedRow>, byIdentity: Map<string, SourcedRow>, buckets: ShadowBuckets): void {
  const winner = byName.get(item.rawName);
  if (winner !== undefined) {
    classifyShadow(item, winner, buckets);
    return;
  }
  const normKey = normalizedNameKey(item.rawName);
  const idKey = serviceIdentityKey(item);
  const normWinner = getIfDefined(byNorm, normKey);
  const idWinner = getIfDefined(byIdentity, idKey);
  const dupWinner = normWinner ?? idWinner;
  if (dupWinner !== undefined) {
    const reason: IdentityShadow["reason"] = normWinner !== undefined ? "normname" : "identity";
    buckets.shadowedIdentity.push({ name: item.rawName, winner: dupWinner.rawName, reason, source: item.source, winnerSource: dupWinner.source });
    classifyShadow(item, dupWinner, buckets);
    return;
  }
  byName.set(item.rawName, item);
  if (normKey !== undefined) byNorm.set(normKey, item);
  if (idKey !== undefined) byIdentity.set(idKey, item);
}

/**
 * 多来源行按优先序合并（数组顺序=优先序，先到先得；后到重复行为被遮蔽）。
 * 三把遮蔽键同时先到先得：精确原名、归一名（normalizedNameKey）、服务身份
 * （serviceIdentityKey）。disabled 占名行照样注册三键——给低层行提供
 * 「占名退出」手段，但本身不进 rows。
 * shadowedOwnCc：被项目 yml 遮蔽的项目 .mcp.json 行；shadowedUser：被任一项目
 * 自身行遮蔽的用户层行（含身份/归一名命中）；shadowedGlobal：被另一条用户层行
 * 遮蔽的用户层行；shadowedIdentity：被归一名或身份键去重剔除的行明细（带两侧
 * 来源，供归因过滤）。纯函数，供测试。
 */
export function mergeSourcedRows(candidates: SourcedRow[][]): {
  rows: DesiredProjectRow[];
  shadowedOwnCc: string[];
  shadowedUser: string[];
  shadowedGlobal: GlobalShadow[];
  shadowedIdentity: IdentityShadow[];
} {
  const byName = new Map<string, SourcedRow>();
  const byNorm = new Map<string, SourcedRow>();
  const byIdentity = new Map<string, SourcedRow>();
  const buckets: ShadowBuckets = { shadowedOwnCc: [], shadowedUser: [], shadowedGlobal: [], shadowedIdentity: [] };
  for (const list of candidates) {
    for (const item of list) mergeOneRow(item, byName, byNorm, byIdentity, buckets);
  }
  return {
    rows: [...byName.values()]
      .filter((item) => item.disabled !== true)
      .map((item) => ({ rawName: item.rawName, row: item.row, source: item.source })),
    shadowedOwnCc: buckets.shadowedOwnCc,
    shadowedUser: buckets.shadowedUser,
    shadowedGlobal: buckets.shadowedGlobal,
    shadowedIdentity: buckets.shadowedIdentity
  };
}

export interface DiagUnhealthy {
  name: string;
  reason: string;
}

/** 对账结束后写入诊断文件的摘要段（`.mcp-diag.json` 的 `summary`）。 */
export interface DiagSummary {
  at: string;
  projects?: number;
  rows: number;
  mounted: number;
  skippedByReason: Record<string, number>;
  unhealthy: DiagUnhealthy[];
  /** 宽限卸载的行（不是故障；`status` 打成「未装载（无会话）」）。 */
  idle?: string[];
  toolBudget?: { name: string; tools: number; bytes: number }[];
}

export interface DiagDocument {
  summary?: DiagSummary;
  events: Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSkippedByReason(raw: unknown): Record<string, number> {
  const skippedByReason: Record<string, number> = {};
  if (!isRecord(raw)) return skippedByReason;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") skippedByReason[key] = value;
  }
  return skippedByReason;
}

function parseUnhealthyList(raw: unknown): DiagUnhealthy[] {
  if (!Array.isArray(raw)) return [];
  const unhealthy: DiagUnhealthy[] = [];
  for (const item of raw) {
    if (isRecord(item) && typeof item.name === "string" && typeof item.reason === "string") {
      unhealthy.push({ name: item.name, reason: item.reason });
    }
  }
  return unhealthy;
}

function parseIdleNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const idle: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") idle.push(item);
  }
  return idle;
}

function parseToolBudgetHits(raw: unknown): { name: string; tools: number; bytes: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((item): item is { name: string; tools: number; bytes: number } =>
    isRecord(item) && typeof item.name === "string" && typeof item.tools === "number" && typeof item.bytes === "number");
}

/** 兼容旧版纯数组诊断文件：数组 → `{ events }`；对象取 `summary` + `events`。 */
export function parseDiagDocument(raw: unknown): DiagDocument {
  if (Array.isArray(raw)) return { events: raw.filter(isRecord) };
  if (!isRecord(raw)) return { events: [] };
  const events = Array.isArray(raw.events) ? raw.events.filter(isRecord) : [];
  const summary = parseDiagSummary(raw.summary);
  return summary === undefined ? { events } : { summary, events };
}

function parseDiagSummary(raw: unknown): DiagSummary | undefined {
  if (!isRecord(raw) || typeof raw.at !== "string" || typeof raw.rows !== "number" || typeof raw.mounted !== "number") return undefined;
  const idle = parseIdleNames(raw.idle);
  const toolBudget = parseToolBudgetHits(raw.toolBudget);
  return {
    at: raw.at,
    ...(typeof raw.projects === "number" ? { projects: raw.projects } : {}),
    rows: raw.rows,
    mounted: raw.mounted,
    skippedByReason: parseSkippedByReason(raw.skippedByReason),
    unhealthy: parseUnhealthyList(raw.unhealthy),
    ...(idle.length > 0 ? { idle } : {}),
    ...(toolBudget === undefined ? {} : { toolBudget })
  };
}
