/**
 * 构建信息:xpanda-core / xpanda-web 版本号与项目仓库地址。
 * 版本号直接来自 workspace 的 package.json(dev 与 build 行为一致),避免手工同步。
 * @Author: jmp0
 */
import corePackage from "xpanda-core/package.json";
import webPackage from "../package.json";

export const CORE_VERSION: string = corePackage.version;
export const WEB_VERSION: string = webPackage.version;
export const REPO_URL = "https://github.com/asmjmp0/xpanda";
