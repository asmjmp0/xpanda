/*
* class name:L&feature_core/src/main/ets/e11/i11&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import g50 from "@ohos:file.fs";
import { h50 } from "@normalized:N&&&commons/Index&1.0.0";
import { l786 } from "@normalized:N&&&feature_core/src/main/ets/t11/w11&1.0.0";
import util from "@ohos:util";
export function m1195(p0, p1) {
  if (l786(p1.id) !== p1.id || p1.id.length === 0) {
    throw new Error("MC 安装身份不安全");
  }
  h50(p0 + "/mc-install-work");
  if (g50.lstatSync(p0 + "/mc-install-work").isSymbolicLink()) {
    throw new Error("MC 恢复目录不能是链接");
  }
  n1195(p0 + "/mc-install-work" + "/" + p1.id + ".json", p1);
  return;
}
export function n1195(p0, p1) {
  let v0, v6 /*g50*/, v7, v8 /*g50*/;
  let v2 /*g50*/ = g50.openSync(p0 + ".writing", g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
  try {
    v6 = new util.TextEncoder().encodeInto(JSON.stringify(p1));
    for (v7 = 0; v7 < v6.byteLength; v7 += v8) {
      v8 = g50.writeSync(v2.fd, v6.slice(v7).buffer);
      if (v8 <= 0) {
        throw new Error("安装恢复记录写入不完整");
      }
    }
    g50.fsyncSync(v2.fd);
  } finally {
    g50.closeSync(v2);
  }
  g50.renameSync(p0 + ".writing", p0);
  v0 = g50.openSync(p0.substring(0, p0.lastIndexOf("/")), g50.OpenMode.READ_ONLY);
  try {
    g50.fsyncSync(v0.fd);
  } finally {
    g50.closeSync(v0);
  }
}
export function o1195(p0, p1) {
  let v0 /*g50*/, v1 /*g50*/;
  try {
    v0 = g50.lstatSync(p0);
    v1 = g50.lstatSync(p0 + "/" + l1195);
    return !!v0.isDirectory()
      && !v0.isSymbolicLink()
      && !!v1.isFile()
      && !v1.isSymbolicLink()
      && JSON.parse(g50.readTextSync(p0 + "/" + l1195)).id === p1;
  } catch (catchAcc) {
    return false;
  }
}
export function u996(p0, p1) {
  let v2, v8 /*l786*/, v10 /*g50*/, v11;
  let v0 = [];
  try {
    v2 = v0;
    if (g50.lstatSync(p0 + "/mc-install-work").isSymbolicLink()) {
      return v0;
    }
    for (v8 of g50.listFileSync(p0 + "/mc-install-work")) {
      v2 = v0;
      if (v8.endsWith(".json")) {
        v10 = l786(v8);
        if (v10 === v8) {
          try {
            if (g50.lstatSync(p0 + "/mc-install-work" + "/" + v8).isFile() && !g50.lstatSync(p0 + "/mc-install-work" + "/" + v8).isSymbolicLink()) {
              v10 = JSON.parse(g50.readTextSync(p0 + "/mc-install-work" + "/" + v8));
              v11 = v10 === null
                || v10.schemaVersion !== 1
                || v10.complete !== false
                || v10.mcDir !== p1
                || v8 !== v10.id + ".json";
              if (!v11) {
                v8 = l786(v10.id);
                v11 = v8 !== v10.id;
              }
              if (!v11) {
                v8 = l786(v10.gameVersion);
                v11 = v8 !== v10.gameVersion;
              }
              if (!v11) {
                v8 = l786(v10.versionName);
                v11 = v8 !== v10.versionName;
              }
              if (!v11) {
                v8 = typeof v10.loaderVersion;
                v11 = typeof v10.loaderVersion !== "string";
              }
              if (!v11 && (v8 = ["", "fabric", "forge", "neoforge", "quilt", "optifine"], v8.indexOf.call(v8, v10.loaderType) >= 0)) {
                v0.push(v10);
              }
            }
          } catch (catchAcc) {}
        }
      }
    }
  } catch (catchAcc) {
    v0 = v2;
  }
  return v0;
}
export const l1195 = ".amcl-mc-pending.json";