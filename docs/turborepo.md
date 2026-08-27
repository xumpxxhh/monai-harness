# Turborepo 通用搭建指南

把多包仓库做成 **pnpm workspace + Turborepo**：workspace 负责「装依赖、互相引用」；Turbo 负责「按依赖图跑任务、缓存产物」。目录分层按目标仓库的运行/发布边界切。

---

## 1. 什么时候该上 Monorepo

适合：

- 多个应用共享同一套库（UI、SDK、类型、工具函数）
- 希望一次 `install`、一次 `build` / `lint` / `test` 覆盖全仓
- 包之间有明确依赖方向，改底层库要连带验证上层应用

不适合（先别拆）：

- 只有一个可运行应用、没有可复用边界
- 团队对发布/版本/CI 还没有约定，拆包会增加协调成本

**Turborepo 解决的不是「怎么拆包」，而是拆完之后怎么高效地跑脚本。** 先想清楚包边界，再配 `turbo.json`。

---

## 2. 两层工具各管什么

| 层        | 典型选型                               | 职责                                                                       |
| --------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Workspace | **pnpm**（也可用 npm/yarn workspaces） | 工作区声明、内部包 `workspace:*` 链接、统一 lockfile、可选 catalog 锁版本  |
| 任务编排  | **Turborepo 2.x**                      | 按包依赖拓扑执行 `build` / `lint` / `test` / `dev`，本地（及可选远程）缓存 |

不要用 Turbo 替代包管理器；也不要在根 `package.json` 里用裸 `tsc && vite build` 串全仓——那会丢掉拓扑和缓存。

推荐固定：

- Node `>= 20`
- pnpm（`packageManager` 字段锁死版本，配合 Corepack）
- Turbo `^2`

---

## 3. 推荐目录（可裁剪）

通用骨架：

```
<repo>/
├── apps/                 # 可独立运行的应用（web / api / docs 站点）
│   ├── web/
│   └── api/
├── packages/             # 被多个 app 引用的库（不可单独「上线」）
│   ├── ui/
│   └── shared/
├── package.json          # 根：private + turbo scripts + 共享 devDeps
├── pnpm-workspace.yaml   # 工作区 glob
├── turbo.json            # 任务图
├── tsconfig.json         # 可选：根 TS 默认项（各包再 extends）
├── eslint.config.js      # 可选：根 lint（按目录覆盖规则）
├── .npmrc
├── .gitignore
└── pnpm-lock.yaml
```

切包原则：

1. **按发布/运行边界切，不按文件类型切。** 「所有 hooks 一个包」通常过早。
2. **依赖只能向下。** 库不能依赖应用；应用可以依赖库。画一张表钉死方向。
3. **应用包 `private: true`。** 只有准备 npm 发布的库才设 `publishConfig`。
4. **第三类目录按需增加**（例如 `plugins/*`、`tooling/*`，生命周期与 `packages/` 不同时再拆）。不要为了对称硬造空目录。

示例：`apps/web`、`apps/api` 是应用；`packages/ui`、`packages/shared` 是共享库。扩展包若只依赖某个 SDK、且与主应用同仓开发，可以单独一条 workspace glob。

---

## 4. 从现有项目迁过来（推荐路径）

假设原仓库是单包：根目录既有前端又有后端，或一个库被拷贝到多个项目。

### 4.1 先原地变成 workspace，再引入 Turbo

1. 根 `package.json` 改为 `"private": true`，去掉会误发布根包的字段。
2. 把可运行应用挪进 `apps/<name>/`，把共享代码挪进 `packages/<name>/`。
3. 每个目录各自有 `package.json`（`name` 唯一）。
4. 写 `pnpm-workspace.yaml`，根目录执行 `pnpm install`。
5. 内部引用改为 `"@scope/foo": "workspace:*"`，删掉相对路径 `file:../foo` 或复制粘贴。
6. 各包补齐 **同名脚本**：至少 `build`；按需 `dev` / `lint` / `test` / `check-types`。
7. 加 `turbo.json`，根脚本改为 `turbo run <task>`。
8. CI 从「在子目录 npm install」改为根目录一次 `pnpm install` + `pnpm build`。

一次只搬一个包，确认 `pnpm --filter <name> build` 能过再搬下一个。

### 4.2 包名约定

- 应用：短名即可（`web`、`api`），方便 `--filter=web`。
- 库：加 scope，避免和 npm 公共包撞名，例如 `@acme/ui`。
- 全仓 scope 保持一致，后续发 npm / 看依赖图都更清晰。

---

## 5. 必备配置

### 5.1 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  # 按需：- "plugins/*"  - "tooling/*"

# 可选：同一工具链版本只写一处
catalog:
  typescript: "~5.9.3"
```

各包里写 `"typescript": "catalog:"`，根 `package.json` 用 `pnpm.overrides` 再钉死一次，避免幽灵多版本。

### 5.2 根 `package.json`

```json
{
  "name": "acme",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "check-types": "turbo run check-types"
  },
  "devDependencies": {
    "turbo": "^2.5.4",
    "typescript": "catalog:"
  },
  "packageManager": "pnpm@10.18.2",
  "engines": {
    "node": ">=20"
  },
  "pnpm": {
    "overrides": {
      "typescript": "$typescript"
    }
  }
}
```

要点：

- 根脚本只做转发，真正命令写在各包。
- 常用过滤可以加成根别名，例如 `"dev:web": "turbo run dev --filter=web"`。
- `packageManager` 让 Corepack 对齐 pnpm 版本，减少「我这能装你那不能」。

### 5.3 `.npmrc`

最少：

```
auto-install-peers=true
```

按团队需要可再加 `shamefully-hoist`（一般不必）、私有 registry、`strict-peer-dependencies` 等。先保持默认，出现 peer 问题再开 hoist。

### 5.4 `turbo.json`（任务图核心）

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "check-types": {
      "dependsOn": ["^check-types"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    }
  }
}
```

字段含义（迁移时几乎都会用到）：

| 字段                    | 作用                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `dependsOn: ["^build"]` | 先构建**依赖包**（`^` = 上游 workspace 依赖），再构建自己                                                 |
| `outputs`               | 告诉缓存哪些目录是产物；漏配会导致命中缓存后下游拿不到文件                                                |
| `cache: false`          | `dev` 这类长驻进程不要缓存                                                                                |
| `persistent: true`      | 标记为常驻（watch / vite / nest --watch），Turbo 不会当普通任务结束后台杀掉                               |
| `globalPassThroughEnv`  | 本地终端里的 env 透传进任务（密钥、API Key）。**不要**把密钥写进 `globalEnv`——`globalEnv` 会进入缓存 hash |
| `globalEnv`             | 影响缓存的环境变量名列表（例如 `NODE_ENV`）                                                               |
| `globalDependencies`    | 根文件变动则使全仓缓存失效（例如根 `tsconfig.json`）                                                      |

运行时需要、且不应进入缓存键的密钥，用 `globalPassThroughEnv` 列出变量名即可。没有这类变量就不要加该字段。

本仓已为 server / example / adapters 共用的 OpenAI 兼容与 pgvector 变量配置了根级 `globalPassThroughEnv`；`apps/server` 的 `dev` / `start` 在包级 `turbo.json` 再声明一遍 `passThroughEnv`。本地仍可用各包 `.env` 文件（由应用自行读取），但 **Shell / CI 注入必须先出现在上述名单中**，否则 Strict 模式下任务进程看不到。

按仓库增删任务名即可：`format`、`lint:fix` 都只是「各包 `package.json` 里有同名 script，Turbo 才会调度」。

### 5.5 `.gitignore`

至少忽略：

```
node_modules
.turbo
dist
.next
out
coverage
.env
.env.*
!.env.example
```

`.turbo` 是本地缓存目录，必须忽略。

---

## 6. 内部包怎么被应用吃到

### 6.1 依赖声明

应用 / 上游库：

```json
{
  "dependencies": {
    "@acme/shared": "workspace:*"
  }
}
```

`workspace:*` = 永远用工作区内当前版本，不走 npm。发布到 registry 时，pnpm 会在 pack 阶段把协议替换成真实版本（若走 changeset 发版）。

### 6.2 库的出口（TypeScript 库最常见）

被别人 `import` 的包建议构建出 `dist`，用 `exports` 指过去：

```json
{
  "name": "@acme/shared",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "check-types": "tsc --noEmit -p tsconfig.build.json"
  }
}
```

对应 `turbo.json` 的 `build.outputs: ["dist/**"]`。`dev` 若 `dependsOn: ["^build"]`，改共享库后先编库，再跑应用——类型和运行时都指向 `dist`，避免「源码能跳转、运行却是旧 JS」。

可选替代（更适合纯 Vite 前端）：用 TypeScript project references 或打包器 alias 直接吃源码。代价是每个 bundler 都要配一遍，Node 测试跑器往往更痛。通用迁移优先 **库先 build 出 dist**。

### 6.3 依赖方向检查

把「谁可以依赖谁」写成表，例如：

| 包                | 可依赖                                           |
| ----------------- | ------------------------------------------------ |
| `packages/shared` | 第三方库                                         |
| `packages/ui`     | `shared`                                         |
| `apps/api`        | `shared` 以及需要的业务包                        |
| `apps/web`        | `ui`、`shared`（类型与纯函数；服务端能力走 api） |

出现环（A→B→A）时 pnpm 能装上，但 Turbo 拓扑和心智都会坏。用 `pnpm list --filter <pkg> --depth 1` 或画图定期查。

---

## 7. 共享工具链（建议根置一份）

目标：各包 script 名字相同，实现可以不同。

| 工具       | 建议                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript | 根 `catalog` + 各包 `typescript: "catalog:"`；库用自己的 `tsconfig`（NodeNext / bundler 按运行时选），不要强行一个 tsconfig 打天下 |
| ESLint     | 根一份 flat config，用 `files: ['apps/web/**']` 覆盖 React 规则；忽略 `dist`、`.turbo`、`node_modules`                             |
| Prettier   | 根 `.prettierrc` + `.prettierignore`；各包 `format` 指到根 ignore                                                                  |
| Git hooks  | husky + lint-staged；类型检查用 `turbo run check-types --filter=...[HEAD]` 只查本次改动相关包                                      |

`lint-staged` 示例：

```js
export default {
  "*.{ts,tsx}": [
    "eslint",
    "prettier --check",
    () => "pnpm exec turbo run check-types --filter=...[HEAD]",
  ],
  "*.{json,yml,yaml,css}": "prettier --check",
};
```

`--filter=...[HEAD]`：当前 HEAD 相对工作区变更所影响的包及其依赖者。提交前不必全仓 `tsc`。

测试框架不必统一（Jest / Vitest / node:test 可并存）。Turbo 只要求各包都有 `test` 脚本。

---

## 8. 日常命令

在仓库根：

```bash
pnpm install                          # 一次装全仓
pnpm build                            # 按 ^build 拓扑构建
pnpm dev                              # 所有 persistent dev
pnpm turbo run build --filter=web     # 只构建 web 及其上游
pnpm turbo run dev --filter=api       # 只跑某个 app
pnpm turbo run test --filter=...web   # web 及其依赖
pnpm turbo run lint --filter=./packages/*
```

`--filter` 常用：

| 语法                        | 含义                       |
| --------------------------- | -------------------------- |
| `--filter=web`              | 名为 `web` 的包            |
| `--filter=@acme/ui`         | 按包名                     |
| `--filter=./apps/*`         | 按路径                     |
| `--filter=...web`           | web + 它依赖的包           |
| `--filter=web...`           | web + 依赖它的包           |
| `--filter=...[origin/main]` | 相对 main 有变更的包及上游 |

`--dry-run` 可先看任务图再真跑。

---

## 9. 缓存怎么用才不踩坑

1. **`outputs` 必须覆盖真实产物。** Vite 可能是 `dist`，Next 是 `.next`（排除 `.next/cache`），常见 Node 应用也是 `dist`。漏了会「缓存命中但 dist 是空的」。
2. **`dev` / watch 关闭缓存。**
3. **测试若依赖构建产物，让 `test.dependsOn` 包含 `^build`。** 纯单测、不 import 别的包 dist，可以去掉以加快反馈。
4. **环境变量：** 影响构建结果的放 `globalEnv` 或任务级 `env`；仅运行需要、不该进 hash 的放 `globalPassThroughEnv`。
5. 远程缓存（Vercel / 自建）是可选优化，本地 `.turbo` 已经够小团队用。上 CI 再开 remote cache 收益最大。

缓存失效常见原因：漏了 `outputs`、源文件在 `outputs` 里被误忽略、根配置改了却没进 `globalDependencies`。

---

## 10. 各包 `package.json` 脚本清单（最小集）

每个 workspace 包按角色选配，**名字与 `turbo.json` 的 task 对齐**：

| script        | 应用     | 库                 | 说明                                                   |
| ------------- | -------- | ------------------ | ------------------------------------------------------ |
| `build`       | 必有     | 必有（要被引用时） | 产出 `dist` / `.next`                                  |
| `dev`         | 必有     | 可选               | watch；库若被 dist 引用，应用 `dev` 依赖 `^build` 即可 |
| `lint`        | 建议     | 建议               |                                                        |
| `test`        | 有测才写 | 有测才写           | 没有该 script 的包会被 Turbo 跳过                      |
| `check-types` | 建议     | 建议               | `tsc --noEmit`，与 `build` 分开便于 hooks              |

没有 `dev` 的包不会出现在 `pnpm dev` 里，这是正常的。

---

## 11. 迁移检查清单

- [ ] 根包 `private: true`，`packageManager` + `engines` 已写
- [ ] `pnpm-workspace.yaml` glob 覆盖所有会 `pnpm install` 的目录
- [ ] 内部依赖全部 `workspace:*`，无残留 `file:` 或拷贝代码
- [ ] 依赖方向无环，应用不反向被库依赖
- [ ] 每个被引用的库有 `build` + `exports`/`main`/`types` 指向产物
- [ ] `turbo.json` 的 `build.outputs` 与真实产物目录一致
- [ ] `dev` 为 `cache: false` + `persistent: true`；若应用吃库的 dist，则 `dependsOn: ["^build"]`
- [ ] `.gitignore` 含 `node_modules`、`.turbo`、`dist`、`.env`（保留 `!.env.example`）
- [ ] 运行时密钥已进 `globalPassThroughEnv`（或任务级 `passThroughEnv`），**未**误写入 `globalEnv` / `env`
- [ ] 根脚本均为 `turbo run ...`；本地验证：
  - `pnpm install`
  - `pnpm build`
  - `pnpm --filter <app> dev`
  - `pnpm test`（若已接）
- [ ] CI 改为根目录安装与 `pnpm build` / `pnpm test`，不要再进子目录单独 install
- [ ] （可选）catalog 锁 TypeScript；根 ESLint/Prettier；husky + lint-staged

把本清单跑通，就完成了可用的 Turborepo 搭建。框架、扩展包体系和目录名都可以按目标仓库自行选择。

---

## 12. 常见问题

**Q: 改了库，应用 dev 没变化？**  
A: 应用跑的是库的 `dist`。需要重新 `^build`，或给库加 `dev`（`tsc -w`）并把应用 `dev` 的 `dependsOn` 改成能等到类型/JS 更新。采用「dev 前先 build 上游」最简单，但改库后要再触发一次构建。

**Q: `turbo run build` 提示某些包没有 `build`？**  
A: 可以忽略（Turbo 会 skip），或给空包补一个 no-op。更干净的做法是不把工具目录放进 workspace glob。

**Q: 能不能 npm / yarn？**  
A: 能。Turbo 不绑 pnpm。但 `workspace:*`、catalog、严格 node_modules 是 pnpm 的优势；换管理器时协议和 hoist 行为要重测。

**Q: 要不要每个包都放一份 `turbo` 依赖？**  
A: 不要。只装在根 `devDependencies`。

**Q: Next.js / Vite / Nest 混在一个仓？**  
A: 可以。Turbo 不管框架，只跑 script。注意各自 `outputs` 和 `dev` persistent。Next 的 `^build` 对纯前端库同样适用。

**Q: 插件/扩展包要不要进 workspace？**  
A: 若与主应用同仓开发、需要 `workspace:*` 链接，就加一条 glob。若完全独立发版、版本落后主仓，做成独立仓库更合适。
