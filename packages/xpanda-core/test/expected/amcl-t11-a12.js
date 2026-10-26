/*
* class name:L&feature_core/src/main/ets/t11/a12&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { a104 } from "@normalized:N&&&commons/Index&1.0.0";
import { a32 } from "@normalized:N&&&commons/Index&1.0.0";
import { c771 } from "@normalized:N&&&feature_core/src/main/ets/t11/w11&1.0.0";
import { d32 } from "@normalized:N&&&commons/Index&1.0.0";
import { d398 } from "@normalized:N&&&feature_core/src/main/ets/k10/l10&1.0.0";
import { d771 } from "@normalized:N&&&feature_core/src/main/ets/t11/w11&1.0.0";
import { e32 } from "@normalized:N&&&commons/Index&1.0.0";
import { f1097 } from "@normalized:N&&&feature_core/src/main/ets/t11/w11&1.0.0";
import { f32 } from "@normalized:N&&&commons/Index&1.0.0";
import g50 from "@ohos:file.fs";
import { l786 } from "@normalized:N&&&feature_core/src/main/ets/t11/w11&1.0.0";
import { m1205 } from "@normalized:N&&&feature_core/src/main/ets/k10/r10&1.0.0";
import { p1205 } from "@normalized:N&&&feature_core/src/main/ets/t11/w11&1.0.0";
import { q36 } from "@normalized:N&&&commons/Index&1.0.0";
import { y } from "@normalized:N&&&commons/Index&1.0.0";
import zlib from "@ohos:zlib";
let b1268, c1268, d1268, e1268, e771, f1268, r1267, s1267, t1267, u1267, v1267;
let local_0_0, local_0_1, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_10, local_0_11, local_0_12;
let local_0_9 = function (p0) {
  return p0.downloads
    && p0.downloads.artifact
    && p0.downloads.artifact.url
    && p0.downloads.artifact.url.length > 0
    || p0.url !== undefined
    && p0.url.length > 0;
};
b1268 = function (p0, p1, p2, p3) {
  let v8, v9, v10, v11, v12 /*c771*/;
  let v3 = [];
  let v4 = new Set();
  let v5 /*a32*/ = local_0_8(p0);
  let v6 = local_0_8(p1);
  if (v5 && v5.libraries) {
    for (v9 of v5.libraries) {
      v11 = v9.name || "";
      if ((v9.name || "").length === 0 || v4.has(v9.name || "")) {
        continue;
      }
      if ((v9.name || "").indexOf("net.minecraftforge:forge:" + p2) >= 0) {
        if (!local_0_9(v9)) {
          continue;
        }
      }
      if (p3 && p3.length > 0 && (v9.name || "").indexOf(p3) >= 0) {
        continue;
      }
      v4.add(v9.name || "");
      v12 = {
        "name": v9.name || ""
      };
      if (v9.url) {
        v12.url = v9.url;
      }
      v9 = v9.downloads;
      if (v9 && v9.artifact) {
        v9 = v9.artifact;
        if (v9.url && v9.url.length > 0) {
          v12.directUrl = v9.url;
          v11 = d771(v11);
          if (v11 && v9.url.endsWith(v11)) {
            v11 = v9.url.length - v11.length;
            v9.url.substring(0, v11);
            v12.url = v9.url.substring(0, v11);
          } else if (v11 && v9.url.endsWith("/" + v11)) {
            v11 = v9.url.length - v11.length - 1;
            v9.url.substring(0, v11);
            v12.url = v9.url.substring(0, v11);
          }
        }
        if (v9.path && v9.path.length > 0) {
          v11 = c771(v9.path);
          if (v11.length === 0) {
            throw new Error("install_profile artifact.path 不安全");
          }
          v12.storagePath = v11;
        }
        if (v9.sha1 && v9.sha1.length === 40) {
          v12.sha1 = v9.sha1;
        }
        v9 = v9.size;
        if (v9 && v9 > 0) {
          v12.size = v9;
        }
      }
      v3.push(v12);
    }
  }
  if (v6 && v6.libraries) {
    for (v8 of v6.libraries) {
      v10 = v8.name || "";
      if ((v8.name || "").length === 0 || v4.has(v8.name || "")) {
        continue;
      }
      if ((v8.name || "").indexOf("net.minecraftforge:forge:" + p2) >= 0) {
        if (!local_0_9(v8)) {
          continue;
        }
      }
      if (p3 && p3.length > 0 && (v8.name || "").indexOf(p3) >= 0) {
        continue;
      }
      v4.add(v8.name || "");
      v11 = {
        "name": v8.name || ""
      };
      if (v8.url) {
        v11.url = v8.url;
      }
      v8 = v8.downloads;
      if (v8 && v8.artifact) {
        v8 = v8.artifact;
        if (v8.url && v8.url.length > 0) {
          v11.directUrl = v8.url;
          v10 = d771(v10);
          if (v10 && v8.url.endsWith(v10)) {
            v10 = v8.url.length - v10.length;
            v8.url.substring(0, v10);
            v11.url = v8.url.substring(0, v10);
          } else if (v10 && v8.url.endsWith("/" + v10)) {
            v10 = v8.url.length - v10.length - 1;
            v8.url.substring(0, v10);
            v11.url = v8.url.substring(0, v10);
          }
        }
        if (v8.path && v8.path.length > 0) {
          v10 = c771(v8.path);
          if (v10.length === 0) {
            throw new Error("version.json artifact.path 不安全");
          }
          v11.storagePath = v10;
        }
        if (v8.sha1 && v8.sha1.length === 40) {
          v11.sha1 = v8.sha1;
        }
        v8 = v8.size;
        if (v8 && v8 > 0) {
          v11.size = v8;
        }
      }
      v3.push(v11);
    }
  }
  y.info(local_0_0, "Extracted " + v3.length + " libraries from installer JSON", a32);
  return v3;
};
c1268 = async function (p0, p1, p2, p3) {
  let v3, v6, v7, v8, v9, v11, v12, v19, v20, v29, v30, v31, v33, acc;
  let local_1_0, local_1_2, local_1_3;
  let local_1_1 = p3;
  v3 = local_0_8(p0);
  if (!v3) {
    return undefined;
  }
  v3 = v3.data;
  if (!v3) {
    return undefined;
  }
  v3 = v3.MOJMAPS;
  if (!v3) {
    return undefined;
  }
  v3 = v3.client || "";
  if (v3.length === 0) {
    return undefined;
  }
  v6 = v3.replace(new RegExp("^\\["), "").replace(new RegExp("\\]$"), "");
  v7 = v6.indexOf("@");
  v8 = v7 >= 0 ? v6.substring(v7 + 1) : "jar";
  if (v7 >= 0) {
    v6 = v6.substring(0, v7);
  }
  v6 = v6 + "@" + v8;
  acc = d771(v6);
  if (acc.length === 0) {
    v3 = "Cannot parse MOJMAPS coord: " + v3 + "";
    y.warn(local_0_0, v3, null, a32);
    return undefined;
  }
  v3 = p2 + "/" + acc;
  y.info(local_0_0, "Downloading version manifest to get client_mappings URL...", a32);
  v6 = "";
  v7 = "";
  local_1_3 = d398.instance();
  v8 = [local_0_10, local_0_11][Symbol.iterator]();
  v9 = v8.next;
  acc = false;
  v11 = 0;
  do {
    v12 = v9.call(v8);
    if (v12.done) {
      if (v6.length === 0) {
        y.warn(local_0_0, "Could not find client_mappings URL for " + p1 + "", null, a32);
        return undefined;
      }
      if (!new RegExp("^[0-9a-f]{40}$").test(v7) || !Number.isSafeInteger(v11) || v11 <= 0) {
        throw new Error("client_mappings 缺少可信SHA1/大小，不能把未知映射交给处理器");
      }
      y.info(local_0_0, "Downloading mappings: " + v6 + " → " + v3 + "", a32);
      g50.mkdirSync(v3.substring(0, v3.lastIndexOf("/")), true);
      local_1_0 = 0;
      local_1_2 = [];
      v19 = {
        "name": "Forge client mappings " + p1,
        "files": null
      };
      v20 = [];
      v20[0] = {
        "localPath": v3,
        "allowedRoot": p2,
        "urls": m1205(v6.replace("piston-data.mojang.com", d32).replace("launcher.mojang.com", d32), v6),
        "check": {
          "sha1": v7,
          "size": v11
        }
      };
      v19.files = v20;
      acc = local_1_3.createAndWait(v19, function (p0) {
        local_1_0 = p0.taskId;
        try {
          if (local_1_1 != null) {
            local_1_1(p0);
          }
        } catch (catchAcc) {
          if (local_1_2.length === 0) {
            local_1_2.push(catchAcc);
          }
          if (local_1_0 /*p1272*/ > 0) {
            local_1_3.cancel(local_1_0 /*p1272*/);
          }
        }
      });
      await acc;
      if (local_1_2.length > 0) {
        throw local_1_2[0];
      }
      if (local_1_0 > 0) {
        await local_1_3.awaitTaskReleased(local_1_0, true);
      }
      if (hole == v6) {
        y.info(local_0_0, "Mappings download verified", a32);
        return undefined;
      }
      throw v6;
    }
    v30 = "";
    for (v33 of JSON.parse(await local_1_3.fetchText(v12.value)).versions) {
      if (v33.id === p1) {
        v30 = v33.url || "";
        break;
      }
    }
    acc = v30.length === 0;
    if (v30.length === 0) {
      continue;
    }
    v33 = d32;
    v29 = v30.replace("piston-meta.mojang.com", d32).replace("launchermeta.mojang.com", d32);
    v31 = [];
    if (v29 !== v30) {
      v31.push(v30);
    }
    v29 = JSON.parse(await local_1_3.fetchText(v29, v31)).downloads;
    if (v29 && v29.client_mappings) {
      v29 = v29.client_mappings;
      v6 = typeof v29.url === "string" ? v29.url : "";
      v7 = typeof v29.sha1 === "string" ? v29.sha1.toLowerCase() : "";
      v11 = typeof v29.size === "number" ? v29.size : 0;
    }
    acc = v6.length > 0;
  } while (!acc);
  if (v8.return == undefined) {
    v8 = v11;
  } else {
    v8.return();
    v8 = v11;
  }
  if (v6.length === 0) {
    y.warn(local_0_0, "Could not find client_mappings URL for " + p1 + "", null, a32);
    return undefined;
  }
  if (!new RegExp("^[0-9a-f]{40}$").test(v7) || !Number.isSafeInteger(v8) || v8 <= 0) {
    throw new Error("client_mappings 缺少可信SHA1/大小，不能把未知映射交给处理器");
  }
  y.info(local_0_0, "Downloading mappings: " + v6 + " → " + v3 + "", a32);
  g50.mkdirSync(v3.substring(0, v3.lastIndexOf("/")), true);
  v9 = v6.replace("piston-data.mojang.com", d32).replace("launcher.mojang.com", d32);
  local_1_0 = 0;
  local_1_2 = [];
  try {
    acc = local_1_3.createAndWait({
      "name": "Forge client mappings " + p1,
      "files": [{
        "localPath": v3,
        "allowedRoot": p2,
        "urls": m1205(v9, v6),
        "check": {
          "sha1": v7,
          "size": v8
        }
      }]
    }, function (p0) {
      local_1_0 = p0.taskId;
      try {
        if (local_1_1 != null) {
          local_1_1(p0);
        }
      } catch (catchAcc) {
        if (local_1_2.length === 0) {
          local_1_2.push(catchAcc);
        }
        if (local_1_0 /*p1272*/ > 0) {
          local_1_3.cancel(local_1_0 /*p1272*/);
        }
      }
    });
    await acc;
    if (local_1_2.length > 0) {
      throw local_1_2[0];
    }
  } finally {
    if (local_1_0 > 0) {
      await local_1_3.awaitTaskReleased(local_1_0, true);
    }
  }
};
d1268 = function (p0, p1) {
  g50.statSync(p0);
  y.info(local_0_0, "Copied " + local_0_12(p0, p1) + " files from maven/ to libraries/", a32);
};
e1268 = async function (p0, p1, p2, p3) {
  let v0, v6, v9, v14, v15, v16, v19, v21, v22;
  let v3 = local_0_8(p2);
  if (v3 === null) {
    throw new Error("无法读取旧版 Forge 内嵌库来源清单");
  }
  v3 = v3.install;
  v6 = p0[Symbol.iterator]();
  while (true) {
    v9 = v6.next();
    if (v9.done) {
      return undefined;
    }
    v9 = v9.value;
    v14 = d771(v9.name);
    v15 = c771(v9.storagePath ?? v14);
    if (v14.length === 0 || v15.length === 0) {
      continue;
    }
    if (v3 === undefined) {
      v14 = p1 + "/maven/" + v15;
      if (!a104(p1 + "/maven/" + v15)) {
        continue;
      }
    } else {
      if (v9.name !== v3.path) {
        continue;
      }
      v16 = r1267(v3.filePath ?? "");
      if (v16.length === 0 || v15 !== v14) {
        v9 = "旧版 Forge 内嵌库来源或目标路径不匹配：" + v9.name;
        throw new Error(v9);
      }
      v14 = p1 + "/" + v16;
    }
    v15 = p3 + "/" + v15;
    try {
      v21 = g50.lstatSync(v14);
      v22 = g50.lstatSync(v15);
      if (!v21.isFile() || v21.isSymbolicLink() || !v22.isFile() || v22.isSymbolicLink() || v21.size !== v22.size || !p1205(v14)) {
        throw new Error("源或复制后的 JAR 不完整");
      }
      if (!p1205(v15)) {
        throw new Error("源或复制后的 JAR 不完整");
      }
      v14 = await f1097(v14);
      v0 = await f1097(v15);
      if (!new RegExp("^[0-9a-fA-F]{40}$").test(v14) || v14 !== v0) {
        throw new Error("复制前后 SHA-1 不一致或无法取得来源摘要");
      }
      if (v9.sha1 !== undefined && v9.sha1.length > 0 && v9.sha1.toLowerCase() !== v14) {
        throw new Error("声明的摘要或大小与已验证内嵌工件冲突");
      }
      if (v9.size !== undefined && v9.size > 0 && v9.size !== v21.size) {
        throw new Error("声明的摘要或大小与已验证内嵌工件冲突");
      }
      v9.sha1 = v14;
      v9.size = v21.size;
      v14 = "Legacy bundled library verified: " + v9.name + " size=" + v9.size + " sha1=" + v14;
      v19 = v9;
      y.info(local_0_0, v14, a32);
    } catch (catchAcc) {
      throw new Error("旧版 Forge 内嵌库校验失败：" + v19.name + "；" + catchAcc.message);
    }
  }
};
e771 = function (p0) {
  let v4, v6, v7 /*a104*/;
  let v0 = [];
  for (v4 of local_0_1) {
    v7 = a104(p0 + "/jdk/" + v4 + "/release");
    v6 = a104(p0 + "/jdk/" + v4 + "/lib/server/libjvm.so");
    if (v7 && v6) {
      v0.push(v4);
    }
  }
  return v0;
};
f1268 = function (p0, p1, p2, p3, p4, p5, p6, p7) {
  let v0 /*n1268*/, v2 /*a1*/, v3 /*y*/, v4 /*a32*/, v5 /*a32*/, v6 /*a32*/, v7 /*g50*/, acc;
  y.info(local_0_0, "Installing legacy Forge: " + p2 + "", a32);
  v0 = l786(p0);
  if (v0 !== p0 || (acc = l786(p3), v0 !== p0 !== p3)) {
    return new n1268(false, p3, "版本标识包含不安全路径字符");
  }
  v0 = local_0_8(p6);
  if (!v0) {
    return new n1268(false, p3, "无法读取 install_profile.json");
  }
  g50.mkdirSync(p4 + "/versions/" + p3, true);
  g50.mkdirSync(p4 + "/libraries", true);
  v4 = !v0.install;
  v5 = 0;
  if (v4) {
    y.info(local_0_0, "Legacy method 1: extracting version.json from json field", a32);
    v0 = v0.json || "";
    v3 = r1267(v0);
    if (v0.length > 0 && v3.length === 0) {
      return new n1268(false, p3, "install_profile.json 的 json 路径不安全: " + v0);
    }
    if (v3.length > 0) {
      p7 = p5 + "/" + v3;
    }
    v0 = local_0_8(p7);
    if (!v0) {
      return new n1268(false, p3, "无法读取版本 JSON: " + p7);
    }
    v0.id = p3;
    try {
      v5 = g50.openSync(p4 + "/versions/" + p3 + "/" + p3 + ".json", g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
      v0 = JSON.stringify(v0);
      g50.writeSync(v5.fd, v0);
    } finally {
      if (v5) {
        g50.closeSync(v5);
      }
    }
  } else {
    y.info(local_0_0, "Legacy method 2: extracting jar from install.filePath", a32);
    v6 = d771(v0.install.path || "");
    v7 = r1267(v0.install.filePath || "");
    if (v6.length !== 0 && v7.length !== 0) {
      if (!a104(p5 + "/" + v7)) {
        return new n1268(false, p3, "旧版 Forge 安装器缺少有效的内嵌加载器 JAR");
      }
      if ((v0.install.path || "").length > 0 && (v3 = d771(v0.install.path || ""), v3.length > 0)) {
        v2 = p4 + "/libraries" + "/" + v3;
        v3 = (p4 + "/libraries" + "/" + v3).substring(0, (p4 + "/libraries" + "/" + v3).lastIndexOf("/"));
        g50.mkdirSync(v3, true);
        v3 = r1267(v0.install.filePath || "");
        if ((v0.install.filePath || "").length > 0 && v3.length === 0) {
          return new n1268(false, p3, "install.filePath 不安全: " + (v0.install.filePath || ""));
        }
        v3 = v3.length > 0 ? p5 + "/" + v3 : "";
        if (v3.length > 0 && a104(v3)) {
          try {
            g50.copyFileSync(v3, v2);
            v3 = y;
            v2 = "Copied forge jar: " + v2 + "";
            y.info(local_0_0, v2, a32);
          } catch (catchAcc) {
            v3 = "copyFileSync " + v3 + " -> ";
            v2 = v3 + v2 + " failed";
            y.error(local_0_0, v2, catchAcc, a32);
            throw catchAcc;
          }
        }
      }
      v0 = v0.versionInfo;
      if (!v0) {
        y.error(local_0_0, "Legacy method 2 failed: install_profile.json has \"install\" field but no \"versionInfo\"", null, a32);
        return new n1268(false, p3, "旧版 Forge 安装器缺少 versionInfo 字段，无法生成 version.json");
      }
      v0.id = p3;
      if (!v0.inheritsFrom) {
        v0.inheritsFrom = p0;
      }
      acc = g50.openSync(p4 + "/versions/" + p3 + "/" + p3 + ".json", g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
      try {
        v0 = JSON.stringify(v0);
        g50.writeSync(acc.fd, v0);
      } finally {
        g50.closeSync(acc);
      }
    } else {
      return new n1268(false, p3, "旧版 Forge 安装器缺少有效的内嵌加载器 JAR");
    }
  }
};
local_0_12 = function (p0, p1, p2) {
  let v1 /*g50*/, v5, v6, v10 /*l786*/, v11 /*g50*/, v12 /*g50*/, v14 /*g50*/;
  if (p2 === undefined) {
    p2 = 0;
  }
  if (p2 > 32) {
    throw new Error("copyDirRecursive 目录层级超限");
  }
  v1 = g50.lstatSync(p0);
  if (!v1.isSymbolicLink()) {
    if (!v1.isDirectory()) {
      throw new Error("复制源不是普通目录: " + p0);
    }
    g50.mkdirSync(p1, true);
    v1 = g50.lstatSync(p1);
    if (!v1.isSymbolicLink()) {
      if (!v1.isDirectory()) {
        throw new Error("复制目标不是普通目录: " + p1);
      }
      v1 = g50.listFileSync(p0)[Symbol.iterator]();
      v5 = 0;
      while (true) {
        v6 = v1.next();
        if (v6.done) break;
        v6 = v6.value;
        if (l786(v6) !== v6) {
          throw new Error("复制源包含非法文件名");
        }
        v10 = p0 + "/" + v6;
        v6 = p1 + "/" + v6;
        v11 = g50.lstatSync(v10);
        if (v11.isSymbolicLink()) {
          throw new Error("拒绝复制符号链接: " + v10);
        }
        if (!v11.isDirectory()) {
          if (v11.isFile()) {
            v12 = true;
            try {
              v14 = g50.lstatSync(v6);
              if (!v14.isSymbolicLink()) {
                if (!v14.isFile()) {
                  throw new Error("复制目标存在非普通文件: " + v6);
                }
                if (v14.size === v11.size && v14.size > 0) {
                  v12 = false;
                }
                if (v12) {
                  g50.mkdirSync(v6.substring(0, v6.lastIndexOf("/")), true);
                  g50.copyFileSync(v10, v6);
                  v5 += 1;
                }
                continue;
              }
              throw new Error("复制目标存在非普通文件: " + v6);
            } catch (catchAcc) {
              if (catchAcc.message.indexOf("复制目标存在非普通文件") >= 0) {
                throw catchAcc;
              }
              {
                g50.mkdirSync(v6.substring(0, v6.lastIndexOf("/")), true);
                g50.copyFileSync(v10, v6);
                v5 += 1;
              }
              continue;
            }
          } else {
            throw new Error("拒绝复制非普通文件: " + v10);
          }
        }
        v5 += local_0_12(v10, v6, p2 + 1);
      }
      return v5;
    }
    throw new Error("复制目标不是普通目录: " + p1);
  }
  throw new Error("复制源不是普通目录: " + p0);
};
r1267 = function (p0) {
  let acc;
  if (p0.length === 0) {
    return "";
  }
  while (p0.length > 0 && (acc = p0.charAt(0), acc === "/")) {
    acc = p0.substring(1);
    p0 = acc;
  }
  return p0.length === 0 ? "" : c771(p0);
};
s1267 = async function (p0) {
  let v5, v6, v11, acc;
  let v3 = 0;
  let v4 = new m1268();
  if (p0.length === 0) {
    return v4;
  }
  v5 = d398.instance();
  v6 = [];
  for (v11 of p0) {
    {
      let local_1_2_0 = v11;
      acc = v5.fetchText(local_1_2_0 + ".sha1", [], 6).then(function (p0) {
        let v1 = "([0-9a-fA-F]{40})";
        let v0 = new RegExp("([0-9a-fA-F]{40})").exec(p0);
        return v0 && (v1 = 1, v0[1]) ? v0[v1].toLowerCase() : "";
      });
      acc = acc.catch(function (p0) {
        let v4 /*b1277*/ = p0?.message ?? String(p0);
        y.warn(local_0_0, "installer sha1 probe failed: " + local_1_2_0 + ".sha1 err=" + v4 + "", null, a32);
        return "";
      });
      v6.push(acc);
    }
  }
  for (v5 = await Promise.all(v6); v3 < v5.length; v3 += 1) {
    if (v5[v3].length === 40) {
      v4.sha1 = v5[v3];
      v4.sourceIndex = v3;
      return v4;
    }
  }
  return v4;
};
t1267 = function (p0, p1) {
  let v1;
  let v0 = 0;
  if (p1 <= 0 || p1 >= p0.length) {
    return p0;
  }
  for (v1 = [p0[p1]]; v0 < p0.length; v0 += 1) {
    if (v0 !== p1) {
      v1.push(p0[v0]);
    }
  }
  return v1;
};
u1267 = function (p0) {
  let v0;
  let v1 = p0.indexOf(".");
  if (v1 >= 0) {
    p0 = p0.substring(0, v1);
  }
  v0 = parseInt(p0);
  return isNaN(v0) || v0 >= 20;
};
(function (p0, p1) {
  let v2 /*p1268*/;
  let v1 /*g50*/ = Math.min(local_0_4, Math.max(local_0_5, g50.statSync(p1).size * 200));
  while (p0.length > 1 && p0.endsWith("/")) {
    p0 = p0.substring(0, p0.length - 1);
  }
  v2 = g50.lstatSync(p0);
  if (!v2.isSymbolicLink()) {
    if (!v2.isDirectory()) {
      throw new Error("解压目标不是普通目录");
    }
    local_0_7(p0, p0, new local_0_6(), v1, 0);
    return;
  }
  throw new Error("解压目标不是普通目录");
});
local_0_7 = function (p0, p1, p2, p3, p4) {
  let v6, v8 /*l786*/, v9 /*g50*/, acc;
  if (p4 > 64) {
    throw new Error("解压目录层级过深");
  }
  for (v6 of g50.listFileSync(p1)) {
    if (l786(v6) !== v6) {
      throw new Error("解压产物包含非法文件名");
    }
    acc = p1 + "/" + v6;
    v6 = p1 + "/" + v6;
    if (!acc.startsWith.call(v6, p0 + "/")) {
      throw new Error("解压产物越过目标目录");
    }
    v8 = v6.substring(p0.length + 1);
    if (c771(v8) !== v8) {
      throw new Error("解压产物包含非法相对路径");
    }
    p2.entries = p2.entries + 1;
    if (p2.entries > 200000) {
      throw new Error("解压文件或目录数量超限");
    }
    v9 = g50.lstatSync(v6);
    if (v9.isSymbolicLink()) {
      v8 = "解压产物包含符号链接: " + v8;
      throw new Error(v8);
    }
    if (!v9.isDirectory()) {
      if (!v9.isFile()) {
        throw new Error("解压产物包含非普通文件: " + v8);
      }
      if (v9.size < 0) {
        v8 = "解压产物文件大小无效: " + v8;
        throw new Error(v8);
      }
      p2.bytes = p2.bytes + v9.size;
      if (p2.bytes <= p3) {
        continue;
      }
      throw new Error("解压后总大小超限");
    }
    local_0_7(p0, v6, p2, p3, p4 + 1);
  }
  return;
};
(function (p0) {
  return Math.min(120000 + Math.round(g50.statSync(p0).size / (1024 * 1024) / 100) * 60000, 1200000);
});
local_0_8 = function (p0) {
  return JSON.parse(g50.readTextSync(p0));
};
local_0_0 = q36.MOD_FORGE_INSTALLER;
local_0_11 = f32 + "/mc/game/version_manifest_v2.json";
local_0_10 = e32 + "/mc/game/version_manifest_v2.json";
export class m1268 {
  constructor() {
    this.sha1 = "";
    this.sourceIndex = -1;
  }
}
export class n1268 {
  constructor(p0, p1, p2) {
    if (p2 === undefined) {
      p2 = "";
    }
    this.success = false;
    this.versionId = "";
    this.error = "";
    this.success = p0;
    this.versionId = p1;
    this.error = p2;
  }
}
local_0_1 = [17, 21, 25];
local_0_6 = class p1268 {
  constructor() {
    this.entries = 0;
    this.bytes = 0;
  }
};
local_0_4 = 16 * 1024 * 1024 * 1024;
local_0_5 = 2 * 1024 * 1024 * 1024;
export { b1268 };
export { c1268 };
export { d1268 };
export { e1268 };
export { e771 };
export { f1268 };
export { r1267 };
export { s1267 };
export { t1267 };
export { u1267 };
export { v1267 };
export { a104 } from "@normalized:N&&&commons/Index&1.0.0";