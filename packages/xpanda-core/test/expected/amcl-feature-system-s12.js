/*
* class name:L&feature_system/src/main/ets/s12&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import Environment from "@ohos:file.environment";
import abilityAccessCtrl from "@ohos:abilityAccessCtrl";
import fileUri from "@ohos:file.fileuri";
import g50 from "@ohos:file.fs";
import picker from "@ohos:file.picker";
import { y } from "@normalized:N&&&commons/Index&1.0.0";
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4;
export function f877(p0) {
  return p0 === e877.EXTERNAL ? e877.EXTERNAL : e877.SANDBOX;
}
local_0_1 = "GameStorage";
local_0_3 = "ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY";
local_0_0 = "SystemCapability.FileManagement.File.Environment.FolderObtain";
local_0_2 = "com.amcl.launcher";
local_0_4 = "AMCL";
export const e877 = {
  SANDBOX: "sandbox",
  EXTERNAL: "external"
};
export class o759 {
  static cachedDownloadDir = null;
  static downloadDirTried = false;
  static phoneExternalDir = "";
  static legacyFolderMigrated = false;
  constructor() {}
  static setPhoneExternalDir(p0) {
    if (!p0 || p0.length <= 0) {
      p0 = "";
    }
    o759.phoneExternalDir = p0;
  }
  static isTabletSilent() {
    return canIUse(local_0_0);
  }
  static downloadDir() {
    let v1 /*y*/;
    if (!o759.downloadDirTried) {
      o759.downloadDirTried = true;
      try {
        v1 = Environment.getUserDownloadDir();
        if (!v1 || v1.length <= 0) {
          v1 = null;
        }
        o759.cachedDownloadDir = v1;
      } catch (catchAcc) {
        y.warn(local_0_1, "getUserDownloadDir failed", catchAcc);
        o759.cachedDownloadDir = null;
      }
    }
    return o759.cachedDownloadDir === null ? "" : o759.cachedDownloadDir;
  }
  static sandboxMcDir(p0) {
    return p0.filesDir + "/.minecraft";
  }
  static externalAppDir() {
    let v0 /*o759*/;
    if (o759.isTabletSilent()) {
      v0 = o759.downloadDir();
      return v0.length > 0 ? v0 + "/" + local_0_2 : "";
    }
    return o759.phoneExternalDir;
  }
  static externalMcDir() {
    let v0 /*o759*/ = o759.externalAppDir();
    return v0.length > 0 ? v0 + "/.minecraft" : "";
  }
  static resolveMcDir(p0, p1) {
    let v0 /*o759*/;
    if (p1 === e877.EXTERNAL) {
      v0 = o759.externalMcDir();
      if (v0.length > 0) {
        return v0;
      }
      y.warn(local_0_1, "EXTERNAL selected but unavailable; fallback to sandbox .minecraft");
    }
    return o759.sandboxMcDir(p0);
  }
  static isExternalAvailable() {
    return o759.externalAppDir().length > 0;
  }
  static isExternalSupported() {
    return !o759.isTabletSilent() || o759.downloadDir().length > 0;
  }
  static needsPhoneLearn() {
    return !o759.isTabletSilent() && o759.phoneExternalDir.length === 0;
  }
  static async learnPhoneExternalDir(p0) {
    let v0, v3 /*y*/, v4 /*picker*/;
    try {
      v3 = new picker.DocumentSaveOptions();
      v3.pickerMode = picker.DocumentPickerMode.DOWNLOAD;
      v4 = new picker.DocumentViewPicker(p0);
      v0 = await v4.save(v3);
      return !v0 || (v4 = 0, v0.length === 0) ? "" : new fileUri.FileUri(v0[v4]).path;
    } catch (catchAcc) {
      y.warn(local_0_1, "learnPhoneExternalDir failed", catchAcc);
      return "";
    }
  }
  static async ensurePhoneExternalDir(p0, p1) {
    let v0;
    if (o759.phoneExternalDir.length > 0) {
      return o759.phoneExternalDir;
    }
    v0 = await o759.learnPhoneExternalDir(p0);
    if (v0.length === 0) {
      return "";
    }
    try {
      g50.mkdirSync(v0 + "/.minecraft", true);
    } catch (catchAcc) {}
    try {
      if (!g50.statSync(v0 + "/.minecraft").isDirectory()) {
        y.warn(local_0_1, "ensurePhoneExternalDir: .minecraft exists but not a directory");
        return "";
      }
      p1.phoneExternalDir = v0;
      o759.setPhoneExternalDir(v0);
      y.info(local_0_1, "learned phone external dir: " + v0 + "");
      return v0;
    } catch (catchAcc) {
      y.warn(local_0_1, "ensurePhoneExternalDir verify failed", catchAcc);
      return "";
    }
  }
  static isDownloadPermissionGranted(p0) {
    try {
      return abilityAccessCtrl.createAtManager().checkAccessTokenSync(p0.applicationInfo.accessTokenId, local_0_3) === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    } catch (catchAcc) {
      y.warn(local_0_1, "checkAccessTokenSync failed", catchAcc);
      return false;
    }
  }
  static hasVersions(p0) {
    try {
      return g50.listFileSync(p0 + "/versions").length > 0;
    } catch (catchAcc) {
      return false;
    }
  }
  static async migrate(p0, p1) {
    let v0, v3, v5, v6, v7, v13, v14, v15, v16, v17, v18, v19;
    try {
      v3 = g50;
      g50.mkdirSync(p1, true);
    } catch (catchAcc) {}
    try {
      v3 = g50.listFileSync(p0);
    } catch (catchAcc) {
      return undefined;
    }
    v3 = v3[Symbol.iterator]();
    v5 = v3.next;
    v6 = false;
    while (true) {
      v7 = v5.call(v3);
      if (v7.done) break;
      v7 = v7.value;
      try {
        if (g50.statSync(p0 + "/" + v7).isDirectory()) {
          v0 = await g50.copyDir(p0 + "/" + v7, p1, 1);
          v13 = p0;
          v14 = p1;
          v15 = v0;
          v16 = v6;
          v17 = v5;
          v18 = v3;
          v19 = v7;
        } else {
          v13 = p0;
          v14 = p1;
          v15 = v0;
          v16 = v6;
          v17 = v5;
          v18 = v3;
          v19 = v7;
          g50.copyFileSync(p0 + "/" + v7, p1 + "/" + v7);
        }
      } catch (catchAcc) {
        y.warn(local_0_1, "migrate skip " + v19 + "", catchAcc);
        p0 = v13;
        p1 = v14;
        v0 = v15;
        v6 = v16;
        v5 = v17;
        v3 = v18;
      }
    }
    y.info(local_0_1, "migrated game data: " + p0 + " -> " + p1 + "");
    return undefined;
  }
  static migrateLegacyExternalFolder() {
    let v0 /*o759*/, v1;
    if (o759.legacyFolderMigrated) {
      return;
    }
    o759.legacyFolderMigrated = true;
    v0 = o759.downloadDir();
    if (v0.length === 0) {
      return;
    }
    v1 = v0 + "/" + local_0_2;
    v0 = v0 + "/" + local_0_4;
    try {
      g50.statSync(v1);
      return;
    } catch (catchAcc) {
      try {
        g50.statSync(v0);
        g50.renameSync(v0, v1);
        v0 = "migrated external folder " + v0 + " -> " + v1 + "";
        y.info(local_0_1, v0);
      } catch (catchAcc) {}
      return;
    }
  }
  static writeExternalHint() {
    let v3 /*a1*/;
    let v0 /*y*/ = o759.externalAppDir();
    if (v0.length === 0) {
      return;
    }
    try {
      g50.mkdirSync(v0, true);
    } catch (catchAcc) {}
    try {
      g50.statSync(v0 + "/请开启“显示隐藏文件”查看游戏数据.txt");
      return;
    } catch (catchAcc) {
      try {
        v3 = g50.openSync(v0 + "/请开启“显示隐藏文件”查看游戏数据.txt", g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
        try {
          g50.writeSync(v3.fd, "AMCL 游戏数据说明\n" + "====================\n\n" + "你的 Minecraft 游戏数据（版本 versions / 存档 saves / 模组 mods / 资源 assets 等）\n" + "都保存在本文件夹下的  .minecraft  文件夹里。\n\n" + "由于 .minecraft 以点(.)开头，文件管理器默认会把它当作\"隐藏文件夹\"而不显示。\n" + "这是 Linux/鸿蒙文件系统的命名约定，不是出了问题。\n\n" + "查看 / 管理这些文件的方法：\n" + "  打开文件管理器右上角菜单 → 开启\"显示隐藏文件 / 显示隐藏项\"\n" + "  即可看到本目录下的 .minecraft 文件夹及其中内容。\n\n" + "提示：本文件夹在公共下载目录里，卸载 AMCL 也不会被删除。\n" + "此说明文件由 AMCL 自动生成，可以删除。\n");
        } finally {
          g50.closeSync(v3);
        }
        y.info(local_0_1, "wrote external hint file: " + (v0 + "/请开启“显示隐藏文件”查看游戏数据.txt") + "");
      } catch (catchAcc) {
        y.warn(local_0_1, "writeExternalHint failed", catchAcc);
      }
      return;
    }
  }
  static writeSandboxHint(p0) {
    let v1 /*y*/, acc;
    try {
      g50.statSync(p0.filesDir + "/请开启“显示隐藏文件”查看游戏数据.txt");
      return;
    } catch (catchAcc) {
      v1 = "AMCL 游戏数据说明（应用内 / 沙箱）\n" + "================================\n\n" + "这是 AMCL 的\"沙箱内\"存储目录。你的 Minecraft 游戏数据\n" + "（版本 versions / 存档 saves / 模组 mods / 资源 assets 等）保存在本目录下的\n" + ".minecraft 文件夹里。\n\n" + "由于 .minecraft 以点(.)开头，文件管理器默认会把它当作\"隐藏文件夹\"而不显示。\n" + "这是 Linux/鸿蒙文件系统的命名约定，不是出了问题。\n\n" + "查看 / 管理这些文件的方法：\n" + "  打开文件管理器右上角菜单 → 开启\"显示隐藏文件 / 显示隐藏项\"\n" + "  即可看到本目录下的 .minecraft 文件夹及其中内容。\n\n" + "注意：沙箱目录会随 AMCL 卸载一并删除（不保留）。\n" + "若想让游戏数据卸载不丢，请到 AMCL 设置 → \"游戏数据位置\" 切换到 \"外部\"\n" + "（数据会存到 下载目录 里的 AMCL 文件夹，卸载不丢）。\n\n" + "此说明文件由 AMCL 自动生成，可以删除。\n";
      try {
        acc = g50.openSync(p0.filesDir + "/请开启“显示隐藏文件”查看游戏数据.txt", g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
        try {
          g50.writeSync(acc.fd, v1);
        } finally {
          g50.closeSync(acc);
        }
        y.info(local_0_1, "wrote sandbox hint file: " + (p0.filesDir + "/请开启“显示隐藏文件”查看游戏数据.txt") + "");
      } catch (catchAcc) {
        y.warn(local_0_1, "writeSandboxHint failed", catchAcc);
      }
      return;
    }
  }
  static async requestDownloadPermission(p0) {
    let v0;
    try {
      v0 = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(p0, [local_0_3]);
      return (v0.authResults && v0.authResults.length > 0 ? v0.authResults[0] : -1) === 0;
    } catch (catchAcc) {
      y.warn(local_0_1, "requestPermissionsFromUser failed", catchAcc);
      return false;
    }
  }
}