/**
 * 导航纯函数（G10）：前进/后退选择历史与世代门闩。
 *
 * 选择历史是唯一的浏览轨迹（树点击、键盘移动、搜索命中、关联跳转、
 * 面包屑全走 pushSelection）；goBack/goForward 只移动索引、不追加条目，
 * 与浏览器语义一致：后退后选择新路径会截断前进分支。
 */

export interface SelectionHistory {
  /** 按时间序的选择路径链 */
  entries: string[];
  /** 当前位置下标（-1 = 尚无选择） */
  index: number;
}

export function emptyHistory(): SelectionHistory {
  return { entries: [], index: -1 };
}

/** 当前选中的路径（无选择为 null）。 */
export function currentPath(history: SelectionHistory): string | null {
  return history.index >= 0 ? history.entries[history.index] ?? null : null;
}

/** 追加一次选择：与当前相同则原样返回；否则截断前进分支再入链。 */
export function pushSelection(
  history: SelectionHistory,
  path: string,
): SelectionHistory {
  if (currentPath(history) === path) return history;
  const entries = history.entries.slice(0, history.index + 1);
  entries.push(path);
  return { entries, index: entries.length - 1 };
}

export function canGoBack(history: SelectionHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: SelectionHistory): boolean {
  return history.index < history.entries.length - 1;
}

/** 后退一步：已开头则原样返回（不产生新条目）。 */
export function goBack(history: SelectionHistory): SelectionHistory {
  if (!canGoBack(history)) return history;
  return { ...history, index: history.index - 1 };
}

/** 前进一步：已末尾则原样返回。 */
export function goForward(history: SelectionHistory): SelectionHistory {
  if (!canGoForward(history)) return history;
  return { ...history, index: history.index + 1 };
}

/**
 * 世代门闩：刷新换代后作废一切在途异步回调（G12"不混用旧查询响应"
 * 的前端侧保证）。回调捕获发起时的票据，应用结果前用 isCurrent 复核。
 */
export interface EpochGuard {
  /** 作废全部在途票据，返回新世代值。 */
  bump(): number;
  /** 当前世代值（发起异步操作时捕获）。 */
  current(): number;
  /** 票据是否仍属当前世代。 */
  isCurrent(token: number): boolean;
}

export function createEpochGuard(): EpochGuard {
  let generation = 0;
  return {
    bump: () => ++generation,
    current: () => generation,
    isCurrent: (token: number) => token === generation,
  };
}
