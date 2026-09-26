/**
 * dsh-project-mcp-manager —— 项目层装载信任门（`<dshHome>/mcp-trusted.json`）。
 *
 * 项目内配置文件随仓库分发：在没有确认通道的宿主半部里，「克隆恶意仓库 +
 * 在该项目开会话」等价于「仓库作者替你决定 spawn 哪些进程」。信任门要求
 * projectRoot 显式登记后才自动装载项目层行（.dsh/mcp.yml、.dsh/mcp.json、
 * 遗留 .mcp.json）；用户层行不受影响（文件在用户自己的 dshHome 内，信任
 * 模型不同）。`DSH_MCP_TRUST_ALL=1` 关闭整道门（逃生舱，行为回到旧版）。
 *
 * 文件形态：JSON 字符串数组（项目根绝对路径）。键控与 registry 一致用
 * projectKeyOf（Windows 大小写不敏感）；此处统一存 realpath 形式。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./mcp-file.js";
import { projectKeyOf } from "./model.js";

/** 信任清单文件名（位于 dshHome 根，与 mcp.yml 同目录）。 */
export const TRUST_FILE = "mcp-trusted.json";
/** 置为 "1" 时关闭项目层信任门：全部项目视同已信任。 */
export const TRUST_ALL_ENV = "DSH_MCP_TRUST_ALL";

/** 信任清单路径：dshHome 根下（dshHome 由调用方给出，测试可注入）。 */
export function trustFileIn(dshHome: string): string {
  return join(dshHome, TRUST_FILE);
}

/** 读信任清单：缺失/坏文件一律当空清单（首装零信任），绝不抛出。 */
export async function readTrustedProjects(path: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item !== "");
  } catch {
    // V8 的 JSON.parse 错误消息会引用文件内容片段：只按空清单处理，不外带内容。
    return [];
  }
}

/** 整体替换信任清单（原子写；键唯一化 + 码元序排序）。 */
export async function writeTrustedProjects(path: string, projects: string[]): Promise<string[]> {
  const unique = [...new Set(projects)];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  await writeFileAtomic(path, JSON.stringify(unique, null, 2) + "\n");
  return unique;
}

/** 登记一个项目根（幂等；已登记时不改文件）。返回写入后的完整清单（排序同文件）。 */
export async function addTrustedProject(path: string, projectRoot: string): Promise<string[]> {
  const current = await readTrustedProjects(path);
  const key = projectKeyOf(projectRoot);
  const exists = current.some((item) => projectKeyOf(item) === key);
  if (exists) return writeTrustedProjects(path, current);
  return writeTrustedProjects(path, [...current, projectRoot]);
}

/** 移除一个项目根（幂等；不存在时不改文件）。返回写入后的完整清单（排序同文件）。 */
export async function removeTrustedProject(path: string, projectRoot: string): Promise<string[]> {
  const current = await readTrustedProjects(path);
  const key = projectKeyOf(projectRoot);
  const next = current.filter((item) => projectKeyOf(item) !== key);
  if (next.length === current.length) return writeTrustedProjects(path, current);
  return writeTrustedProjects(path, next);
}

/** 信任门是否整体关闭（DSH_MCP_TRUST_ALL=1）。 */
export function trustAllEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[TRUST_ALL_ENV] === "1";
}

/** projectKey 是否已获信任（trustAll 时恒真）。 */
export function isProjectTrusted(trusted: string[], projectKey: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (trustAllEnabled(env)) return true;
  return trusted.some((item) => projectKeyOf(item) === projectKey);
}
