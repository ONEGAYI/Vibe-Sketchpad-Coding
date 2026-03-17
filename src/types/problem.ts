/**
 * 公式格式问题项
 */
export interface ProblemItem {
  line: number;        // 行号（1-based）
  column: number;      // 列号（1-based）
  symbol: '<' | '>';   // 问题符号
  replacement: string; // 替换内容 ('\lt' 或 '\gt')
  context: string;     // 上下文（截断后，用于显示）
  fullLine: string;    // 完整行内容
  startIndex: number;  // 问题符号在行内的起始位置
  endIndex: number;    // 问题符号在行内的结束位置
}

/**
 * 检测结果
 */
export interface CheckResult {
  hasProblems: boolean;
  problems: ProblemItem[];
  filePath: string;
}