/**
 * 刷新后浏览状态协调（G12）：仍存在的尽量保留、已删除的按明确规则回退。
 *
 * 回退规则（对选中路径）：
 * 1. 选中路径仍存在 → 原样保留，无提示；
 * 2. 已删除 → 回退到"最近的仍存在祖先目录"（沿路径自浅到深最后一个
 *    存在的祖先段），生成提示；
 * 3. 祖先链全被删（含顶层被删）→ 清除选中，生成提示；不保留失效详情。
 *
 * 展开目录：仍存在的保留，已删除的直接丢弃（不逐条提示）。
 * exists 回调由调用方提供——基于刷新后重建的子项缓存沿树下探判定，
 * 未加载层视为不存在（保守方向：宁可回退也不保留失效详情）。
 */

export interface ReconcileInput {
  expanded: Iterable<string>;
  selected: string | null;
  exists: (path: string) => boolean;
}

export interface ReconcileResult {
  /** 仍存在的展开目录（原顺序） */
  keptExpanded: string[];
  /** 已被删除的展开目录 */
  droppedExpanded: string[];
  /** 回退规则产出的新选中（null = 清除） */
  selected: string | null;
  /** 原选中是否已删除 */
  originalSelectedDeleted: boolean;
  /** 需要展示给用户的提示；无需提示为 null */
  notice: string | null;
}

/** 选中路径的祖先目录链（自浅到深，不含自身、不含根空串）。 */
function ancestorChain(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const chain: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    chain.push(parts.slice(0, i).join("/"));
  }
  return chain;
}

export function reconcileAfterRefresh(input: ReconcileInput): ReconcileResult {
  const keptExpanded: string[] = [];
  const droppedExpanded: string[] = [];
  for (const dir of input.expanded) {
    if (dir === "" || input.exists(dir)) keptExpanded.push(dir);
    else droppedExpanded.push(dir);
  }

  let selected = input.selected;
  let originalSelectedDeleted = false;
  let notice: string | null = null;
  if (input.selected !== null && !input.exists(input.selected)) {
    originalSelectedDeleted = true;
    const fallback = ancestorChain(input.selected)
      .filter((p) => input.exists(p))
      .pop();
    if (fallback !== undefined) {
      selected = fallback;
      notice = `刷新后原选中条目 ${input.selected} 已不存在，已回退到仍存在的目录 ${fallback}`;
    } else {
      selected = null;
      notice = `刷新后原选中条目 ${input.selected} 及其祖先均不存在，已清除选中`;
    }
  }

  return { keptExpanded, droppedExpanded, selected, originalSelectedDeleted, notice };
}

/**
 * 基于刷新后重建的子项缓存判定路径是否可达（沿段下探；未加载层视为不存在）。
 */
export function existsInCache(
  cache: ReadonlyMap<string, import("./types").ChildEntry[]>,
  path: string,
): boolean {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return true;
  let children = cache.get("");
  for (let i = 0; i < parts.length; i++) {
    if (!children) return false;
    const hit = children.find((c) => c.name === parts[i]);
    if (!hit) return false;
    if (i === parts.length - 1) return true;
    children = cache.get(hit.path);
  }
  return false;
}
