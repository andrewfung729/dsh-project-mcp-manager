/**
 * dsh-project-mcp-manager —— 项目锚点解析。
 *
 * 与 dsh 官方 skills 发现（@deepseek-ai/dsh-skill-filesystem）的项目根规则
 * 一致：向上找最近的含 .git 的祖先目录，找不到就退回 cwd 本身。
 *
 * 返回值一律经 realpath 归一（macOS 的 /var → /private/var、以及任意符号
 * 链接工作区）：projectKeyOf 的键控必须与 process.cwd()（物理路径）一致，
 * 否则同一项目会被 Lexical/物理两种写法键控成两个项目——目录里同名行
 * 全部误判冲突、装载时被改名成 p<hash>_ 前缀。
 */
import { access, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** 判断文件系统路径是否存在。 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 路径不存在等场景退回词法解析结果。 */
async function realpathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** 项目锚点：向上找最近的含 .git 的祖先目录；找不到就退回 cwd 本身。 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd);
  while (true) {
    if (await pathExists(join(current, ".git"))) return realpathOrSelf(current);
    const parent = dirname(current);
    if (parent === current) return realpathOrSelf(resolve(cwd));
    current = parent;
  }
}
