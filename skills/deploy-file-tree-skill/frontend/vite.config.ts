import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 构建产物（frontend/build/）经 scripts/assemble_viewer.py 组装到受控入库的
// dist/viewer/（发行资源，随技能部署），由 viewer.py 托管：base 用相对引用，
// 页面可从任意挂载路径加载；frontend/build/ 暂存目录不入库（技能根 .gitignore）。
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "build",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // 开发模式：/api 转发到本地查看器服务（python dist/scripts/viewer.py）
    proxy: {
      "/api": "http://127.0.0.1:8618",
    },
  },
});
