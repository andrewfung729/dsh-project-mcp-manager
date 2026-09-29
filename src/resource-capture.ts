/**
 * 把项目层 mcp-client 的 resource 注册从宿主全局层截走。
 *
 * dsh-mcp-client 在自己的 fiber 上 `inject(['mcpResources'])` 然后
 * `register(server, provider)`。那个 fiber 若挂在宿主 ctx 上，provider 进
 * global layer，每个会话的系统提示都会看到服务器名。这里先 `isolate` 再
 * `provide` 一个同名捕获器：子 fiber 命中捕获器，宿主自己的 mcpResources
 * 不受影响。调用方再按会话把 provider 挂回 agent scope。
 *
 * 不依赖 cordis 的类型。宿主 ctx 没有 isolate/provide 时原样返回，装载退回
 * 今天的全局注册。
 */
export interface ResourceCaptureHooks {
  note(server: string, provider: unknown): void;
  forget(server: string, provider: unknown): void;
}

export interface ResourceCaptureHost {
  isolate?: (name: string) => ResourceCaptureHost & { provide?: ResourceCaptureHost["provide"] };
  provide?: (name: string, value: unknown) => unknown;
}

/** cordis 用来把方法调用的 this.ctx 绑回调用方 context 的标记。不 import cordis。 */
const CORDIS_TRACKER = Symbol.for("cordis.tracker");

interface CallerCtx {
  effect?: (dispose: () => () => void, label: string) => void;
}

export function installProjectResourceCapture(
  ctx: ResourceCaptureHost,
  hooks: ResourceCaptureHooks
): { ctx: ResourceCaptureHost; captured: boolean } {
  if (typeof ctx.isolate !== "function" || typeof ctx.provide !== "function") {
    return { ctx, captured: false };
  }
  const isolated = ctx.isolate("mcpResources");
  if (typeof isolated.provide !== "function") return { ctx, captured: false };
  const capture = {
    register(this: { ctx?: CallerCtx }, server: string, provider: unknown) {
      hooks.note(server, provider);
      let forgotten = false;
      const forget = () => {
        if (forgotten) return;
        forgotten = true;
        hooks.forget(server, provider);
      };
      // dsh-mcp-client 丢掉 register 的返回值。把撤销挂在调用方 fiber 上，
      // 连接卸载时捕获条目跟着消失，和宿主 Service.register 同一条生命周期。
      const caller = this.ctx;
      if (caller !== undefined && typeof caller.effect === "function") {
        caller.effect(() => forget, `project-mcp.resource(${server})`);
      }
      return forget;
    },
  };
  Object.defineProperty(capture, CORDIS_TRACKER, { value: { property: "ctx" } });
  isolated.provide("mcpResources", capture);
  return { ctx: isolated, captured: true };
}
