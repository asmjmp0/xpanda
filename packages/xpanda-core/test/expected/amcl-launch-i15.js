/*
* class name:L&launch/src/main/ets/i15&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { c771 } from "@normalized:N&&&feature_core/Index&1.0.0";
import cryptoFramework from "@ohos:security.cryptoFramework";
import { d1482 } from "@normalized:N&&&launch/src/main/ets/q16&1.0.0";
import { e133 as d1484 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { d398 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { d133 as e1484 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { f1484 } from "@normalized:N&&&launch/src/main/ets/e15&1.0.0";
import { g1484 } from "@normalized:N&&&launch/src/main/ets/e15&1.0.0";
import g50 from "@ohos:file.fs";
import { h1484 } from "@normalized:N&&&launch/src/main/ets/e15&1.0.0";
import { h50 } from "@normalized:N&&&commons/Index&1.0.0";
import { h84 } from "@normalized:N&&&commons/Index&1.0.0";
import { i1484 } from "@normalized:N&&&launch/src/main/ets/e15&1.0.0";
import { i50 } from "@normalized:N&&&commons/Index&1.0.0";
import { j1481 } from "@normalized:N&&&launch/src/main/ets/p16&1.0.0";
import { l786 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { o30 } from "@normalized:N&&&commons/Index&1.0.0";
import { v1267 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { x876 } from "@normalized:N&&&launch/src/main/ets/f15&1.0.0";
import { z31 } from "@normalized:N&&&commons/Index&1.0.0";
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5;
local_0_4 = function (p0) {
  if (p0.length === 0 || p0.length > 4096) {
    return false;
  }
  return !local_0_0(p0) && !new RegExp("\\s").test(p0) && new RegExp("^https?:\\/\\/[^\\/?#]+(?:[\\/?#].*)?$").test(p0);
};
local_0_0 = function (p0) {
  let v2, v3;
  for (v2 = 0; v2 < p0.length; v2 += 1) {
    v3 = p0.charCodeAt(v2);
    if (v3 <= 31 || v3 === 127) {
      return true;
    }
  }
  return false;
};
local_0_2 = function (p0) {
  return new RegExp("^[0-9a-fA-F]{64}$").test(p0);
};
local_0_5 = function (p0) {
  let v1 = p0.lastIndexOf("/");
  return v1 > 0 ? p0.substring(0, v1) : "";
};
local_0_3 = function (p0, p1) {
  let v0;
  if (local_0_0(p0) || p0.indexOf("\\") >= 0) {
    return false;
  }
  if (!p1.endsWith("/")) {
    p1 += "/";
  }
  if (!p0.startsWith(p1)) {
    return false;
  }
  v0 = p0.substring(p1.length);
  return c771(v0) === v0;
};
local_0_1 = "JdkInstaller";
export class n1484 {
  constructor(p0) {
    this.activityId = 0;
    this.alogCache_ = new h84(0);
    this.forceReinstall_ = false;
    this.downloading_ = false;
    this.cancelRequested_ = false;
    this.currentDmTaskId_ = 0;
    this.giteeTaskIds_ = [];
    this.ownedDmTaskIds_ = [];
    this.deferredDownloadCleanup_ = [];
    this.onDownload_ = null;
    this.onStatus_ = null;
    this.peakBytesDone_ = 0;
    this.lastMessage_ = "";
    this.context_ = p0.context;
    this.version_ = p0.version;
    this.config_ = JSON.parse(JSON.stringify(p0.config));
    this.targetDir_ = p0.targetDir;
    this.isInstalledFn_ = p0.isInstalledFn;
    this.forceReinstall_ = p0.forceReinstall === true;
  }
  alog() {
    if (this.alogCache_.id() !== this.activityId) {
      this.alogCache_ = new h84(this.activityId);
    }
    return this.alogCache_;
  }
  setDownloadCallback(p0) {
    this.onDownload_ = p0;
  }
  setStatusCallback(p0) {
    this.onStatus_ = p0;
  }
  isDownloading() {
    return this.downloading_;
  }
  isCancelRequested() {
    return this.cancelRequested_;
  }
  rememberDmTask_(p0) {
    if (p0 <= 0) {
      return;
    }
    if (this.ownedDmTaskIds_.indexOf(p0) < 0) {
      this.ownedDmTaskIds_.push(p0);
    }
    return;
  }
  purgeNativeOwners() {
    let v2, v5;
    let v0 = [];
    let v1 /*d398*/ = d398.instance();
    for (v5 of this.ownedDmTaskIds_) {
      if (!v1.purgeTask(v5)) {
        v0.push(v5);
      }
    }
    this.ownedDmTaskIds_ = v0;
    if (v0.length === 0 && this.deferredDownloadCleanup_.length > 0) {
      v2 = this.deferredDownloadCleanup_;
      this.deferredDownloadCleanup_ = [];
      for (v5 of v2) {
        try {
          i50(v5);
        } catch (catchAcc) {
          this.deferredDownloadCleanup_.push(v5);
        }
      }
    }
    return v0.length === 0;
  }
  async waitForNativeOwners_(p0) {
    let v6, v7;
    if (p0 === undefined) {
      p0 = true;
    }
    if (!p0) {
      for (v6 = 0; v6 < 50; v6 += 1) {
        if (this.purgeNativeOwners()) {
          return true;
        }
        if (v6 < 49) {
          await new Promise(function (p0) {
            let local_1_0 = p0;
            setTimeout(function () {
              return local_1_0();
            }, 100);
          });
        }
      }
      return false;
    }
    if (this.purgeNativeOwners()) {
      return true;
    }
    for (v7 of this.ownedDmTaskIds_.slice()) {
      await d398.instance().awaitTaskReleased(v7, true);
    }
    return this.purgeNativeOwners();
  }
  requestCancel() {
    if (!this.downloading_) {
      return;
    }
    this.cancelRequested_ = true;
    if (this.currentDmTaskId_ > 0) {
      try {
        d398.instance().cancel(this.currentDmTaskId_);
        this.alog().info(local_0_1, "requestCancel: cancelled DM task " + this.currentDmTaskId_ + "", z31);
      } catch (catchAcc) {}
    }
    this.cancelAllGiteeTasks();
    return;
  }
  cancelAllGiteeTasks() {
    let v4;
    for (v4 of this.giteeTaskIds_) {
      if (v4 > 0) {
        d398.instance().cancel(v4);
      }
    }
  }
  report(p0, p1) {
    this.lastMessage_ = p1;
    if (this.onStatus_) {
      this.onStatus_({
        "ready": p0,
        "progress": p1
      });
    }
  }
  reportDownload(p0, p1, p2, p3) {
    this.lastMessage_ = p3;
    if (this.onDownload_) {
      this.onDownload_({
        "version": this.version_,
        "phase": p0,
        "percent": p1,
        "speedKBs": p2,
        "message": p3
      });
    }
  }
  getFailureReason() {
    return this.lastMessage_;
  }
  validateInputs() {
    let v2 /*l786*/, v4, v5;
    if (!o30(this.version_)) {
      return "JDK version 不是有效数字槽位";
    }
    if (l786(this.config_.tag).length === 0) {
      return "JDK tag 不是安全路径段";
    }
    if (l786(this.config_.dataFile).length === 0) {
      return "JDK asset 文件名不安全";
    }
    if (this.config_.sha256 === undefined) {
      return "JDK SHA-256 格式非法";
    }
    if (!local_0_2(this.config_.sha256)) {
      return "JDK SHA-256 格式非法";
    }
    v2 = this.config_.sizeBytes === undefined;
    if (this.config_.sizeBytes !== undefined) {
      v2 = !Number.isSafeInteger(this.config_.sizeBytes);
    }
    if (v2 || this.config_.sizeBytes <= 0) {
      return "JDK sizeBytes 非法";
    }
    if (this.config_.giteeParts !== undefined) {
      for (v5 of this.config_.giteeParts) {
        v5 = l786(v5).length;
        if (v5 === 0) return "JDK Gitee 分卷文件名不安全";
      }
    }
    if (this.config_.giteePartSizes === undefined) {
      if (!local_0_3(this.targetDir_, this.context_.filesDir + "/jdk")) {
        return "JDK targetDir 超出受控安装根目录";
      }
      if (this.targetDir_ === this.context_.filesDir + "/jdk" + "/" + this.version_) {
        return "";
      }
      return "JDK 目标目录与租约槽位不一致";
    }
    if (this.config_.giteeParts === undefined || this.config_.giteePartSizes.length !== this.config_.giteeParts.length) {
      return "JDK Gitee 分卷大小列表不匹配";
    }
    for (v4 of this.config_.giteePartSizes) {
      if (v4 <= 0) return "JDK Gitee 分卷大小非法";
    }
    if (!local_0_3(this.targetDir_, this.context_.filesDir + "/jdk")) {
      return "JDK targetDir 超出受控安装根目录";
    }
    if (this.targetDir_ === this.context_.filesDir + "/jdk" + "/" + this.version_) {
      return "";
    }
    return "JDK 目标目录与租约槽位不一致";
  }
  async downloadAndInstall() {
    let v4, v8 /*z31*/, v9, v11 /*j1481*/, v22, v25;
    this.lastMessage_ = "";
    if (this.downloading_) {
      this.alog().warn(local_0_1, "downloadAndInstall rejected: already downloading (JDK " + this.version_ + ")", null, z31);
      this.report(false, "已有下载任务进行中");
      return false;
    }
    this.alog().info(local_0_1, "downloadAndInstall start: JDK " + this.version_ + "", z31);
    if (!this.config_.available) {
      this.report(false, "JDK " + this.version_ + " 尚未发布，敬请期待");
      return false;
    }
    v4 = this.validateInputs();
    if (v4.length > 0) {
      this.report(false, "JDK " + this.version_ + " 配置非法: " + v4);
      this.alog().error(local_0_1, v4, null, z31);
      return false;
    }
    this.downloading_ = true;
    this.cancelRequested_ = false;
    this.currentDmTaskId_ = 0;
    this.peakBytesDone_ = 0;
    v8 = this.version_ + "-" + Date.now().toString() + "-" + Math.floor(Math.random() * 1000000000).toString();
    v9 = this.context_.cacheDir + "/jdk-install-staging/" + v8;
    v8 = this.context_.filesDir + "/jdk" + "/.staging-" + v8;
    try {
      v22 = null;
      if (!this.forceReinstall_) {
        if (!this.isInstalledFn_()) {
          v11 = j1481.writer(this.context_.filesDir, this.version_);
          v22 = v11;
          this.report(false, "准备安全安装目录...");
          h50(v9);
          h50(this.context_.filesDir + "/jdk");
          try {
            i50(v8);
          } catch (catchAcc) {}
          v22 = v11;
          if (!(await this.downloadJdkArchive(v9 + "/archive.zip", "JDK " + this.version_))) {
            if (await this.waitForNativeOwners_()) {
              try {
                i50(v9);
              } catch (catchAcc) {}
            } else {
              this.deferredDownloadCleanup_.push(v9);
              this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
            }
            if (v11 !== null) {
              v11.release();
            }
            this.currentDmTaskId_ = 0;
            this.giteeTaskIds_ = [];
            try {
              i50(v8);
            } catch (catchAcc) {}
            this.downloading_ = false;
            return false;
          }
          if (!(await this.completeJdkInstall(v9 + "/archive.zip", this.targetDir_, v8, "JDK " + this.version_))) {
            if (await this.waitForNativeOwners_()) {
              try {
                i50(v9);
              } catch (catchAcc) {}
            } else {
              this.deferredDownloadCleanup_.push(v9);
              this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
            }
            if (v11 !== null) {
              v11.release();
            }
            this.currentDmTaskId_ = 0;
            this.giteeTaskIds_ = [];
            try {
              i50(v8);
            } catch (catchAcc) {}
            this.downloading_ = false;
            return false;
          }
          v22 = v11;
          if (this.isInstalledFn_()) {
            this.reportDownload("verifying", 100, 0, "JDK " + this.version_ + " 安装完成 ✅");
            this.report(true, "JDK " + this.version_ + " 安装完成 ✅");
            if (await this.waitForNativeOwners_()) {
              try {
                i50(v9);
              } catch (catchAcc) {}
            } else {
              this.deferredDownloadCleanup_.push(v9);
              this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
            }
            if (v11 !== null) {
              v11.release();
            }
            this.currentDmTaskId_ = 0;
            this.giteeTaskIds_ = [];
            try {
              i50(v8);
            } catch (catchAcc) {}
            this.downloading_ = false;
            return true;
          }
          this.report(false, "❌ " + ("JDK " + this.version_) + " 安装验证失败");
          if (await this.waitForNativeOwners_()) {
            try {
              i50(v9);
            } catch (catchAcc) {}
          } else {
            this.deferredDownloadCleanup_.push(v9);
            this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
          }
          if (v11 !== null) {
            v11.release();
          }
          this.currentDmTaskId_ = 0;
          this.giteeTaskIds_ = [];
          try {
            i50(v8);
          } catch (catchAcc) {}
          this.downloading_ = false;
          return false;
        }
        v22 = null;
        if (this.isInstalledFn_()) {
          this.reportDownload("verifying", 100, 0, "JDK " + this.version_ + " 安装完成 ✅");
          this.report(true, "JDK " + this.version_ + " 安装完成 ✅");
          if (await this.waitForNativeOwners_()) {
            try {
              i50(v9);
            } catch (catchAcc) {}
          } else {
            this.deferredDownloadCleanup_.push(v9);
            this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
          }
          this.currentDmTaskId_ = 0;
          this.giteeTaskIds_ = [];
          try {
            i50(v8);
          } catch (catchAcc) {}
          this.downloading_ = false;
          return true;
        }
        this.report(false, "❌ " + ("JDK " + this.version_) + " 安装验证失败");
        if (await this.waitForNativeOwners_()) {
          try {
            i50(v9);
          } catch (catchAcc) {}
        } else {
          this.deferredDownloadCleanup_.push(v9);
          this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
        }
        this.currentDmTaskId_ = 0;
        this.giteeTaskIds_ = [];
        try {
          i50(v8);
        } catch (catchAcc) {}
        this.downloading_ = false;
        return false;
      }
      v11 = j1481.writer(this.context_.filesDir, this.version_);
      v22 = v11;
      this.report(false, "准备安全安装目录...");
      h50(v9);
      h50(this.context_.filesDir + "/jdk");
      try {
        i50(v8);
      } catch (catchAcc) {}
      v22 = v11;
      if (!(await this.downloadJdkArchive(v9 + "/archive.zip", "JDK " + this.version_))) {
        if (await this.waitForNativeOwners_()) {
          try {
            i50(v9);
          } catch (catchAcc) {}
        } else {
          this.deferredDownloadCleanup_.push(v9);
          this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
        }
        if (v11 !== null) {
          v11.release();
        }
        this.currentDmTaskId_ = 0;
        this.giteeTaskIds_ = [];
        try {
          i50(v8);
        } catch (catchAcc) {}
        this.downloading_ = false;
        return false;
      }
      if (!(await this.completeJdkInstall(v9 + "/archive.zip", this.targetDir_, v8, "JDK " + this.version_))) {
        if (await this.waitForNativeOwners_()) {
          try {
            i50(v9);
          } catch (catchAcc) {}
        } else {
          this.deferredDownloadCleanup_.push(v9);
          this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
        }
        if (v11 !== null) {
          v11.release();
        }
        this.currentDmTaskId_ = 0;
        this.giteeTaskIds_ = [];
        try {
          i50(v8);
        } catch (catchAcc) {}
        this.downloading_ = false;
        return false;
      }
      v22 = v11;
      if (this.isInstalledFn_()) {
        this.reportDownload("verifying", 100, 0, "JDK " + this.version_ + " 安装完成 ✅");
        this.report(true, "JDK " + this.version_ + " 安装完成 ✅");
        if (await this.waitForNativeOwners_()) {
          try {
            i50(v9);
          } catch (catchAcc) {}
        } else {
          this.deferredDownloadCleanup_.push(v9);
          this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
        }
        if (v11 !== null) {
          v11.release();
        }
        this.currentDmTaskId_ = 0;
        this.giteeTaskIds_ = [];
        try {
          i50(v8);
        } catch (catchAcc) {}
        this.downloading_ = false;
        return true;
      }
      this.report(false, "❌ " + ("JDK " + this.version_) + " 安装验证失败");
      if (await this.waitForNativeOwners_()) {
        try {
          i50(v9);
        } catch (catchAcc) {}
      } else {
        this.deferredDownloadCleanup_.push(v9);
        this.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
      }
      if (v11 !== null) {
        v11.release();
      }
      this.currentDmTaskId_ = 0;
      this.giteeTaskIds_ = [];
      try {
        i50(v8);
      } catch (catchAcc) {}
      this.downloading_ = false;
      return false;
    } catch (catchAcc) {
      v25.alog().error(local_0_1, "Download failed", catchAcc, z31);
      v25.reportDownload("downloading", 0, 0, "下载失败: " + catchAcc.message);
      if (await v25.waitForNativeOwners_()) {
        try {
          i50(v9);
        } catch (catchAcc) {}
      } else {
        v25.deferredDownloadCleanup_.push(v9);
        v25.alog().warn(local_0_1, "原生下载仍在结束，暂时保留独占目录：" + v9, null, z31);
      }
      if (v22 !== null) {
        v22.release();
      }
      v25.currentDmTaskId_ = 0;
      v25.giteeTaskIds_ = [];
      try {
        i50(v8);
      } catch (catchAcc) {}
      v25.downloading_ = false;
      return false;
    }
  }
  async tryGiteeDownload(p0, p1) {
    let v8;
    let v5 = 0;
    if (this.config_.giteeParts === undefined || this.config_.giteeParts.length === 0) {
      return false;
    }
    if (this.config_.giteePartSizes !== undefined && this.config_.giteePartSizes.length === this.config_.giteeParts.length) {
      for (v8 of this.config_.giteePartSizes) {
        v5 += v8;
      }
    } else if (this.config_.sizeBytes !== undefined) {
      v5 = this.config_.sizeBytes;
    }
    return this.config_.giteeParts.length === 1 ? await this.downloadGiteeSingle(p0, p1, v5) : await this.downloadGiteeParallel(p0, p1, v5);
  }
  async downloadGiteeSingle(p0, p1, p2) {
    let v4, v5, v6 /*a1*/, v7 /*a1*/, v10 /*h1484*/, acc;
    let local_1_1;
    let local_1_2 = this;
    let local_1_0 = p2;
    v7 = d398.instance();
    try {
      if (local_1_2.cancelRequested_) {
        return false;
      }
      if (!local_0_4(h1484 + "/" + local_1_2.config_.tag + "/" + local_1_2.config_.giteeParts[0])) {
        throw new Error("Unsafe Gitee JDK URL");
      }
      v5 = local_1_2.config_.giteePartSizes === undefined ? 0 : local_1_2.config_.giteePartSizes.length > 0 ? local_1_2.config_.giteePartSizes[0] : 0;
      v6 = local_0_5(p0);
      v10 = v5 > 0 ? {
        "localPath": p0,
        "urls": [h1484 + "/" + local_1_2.config_.tag + "/" + local_1_2.config_.giteeParts[0]],
        "allowedRoot": v6,
        "maxConnections": 1,
        "check": {
          "size": v5
        }
      } : {
        "localPath": p0,
        "urls": [h1484 + "/" + local_1_2.config_.tag + "/" + local_1_2.config_.giteeParts[0]],
        "allowedRoot": v6,
        "maxConnections": 1
      };
      local_1_1 = p1 + " Gitee";
      acc = v7.createAndWait({
        "name": "JDK " + local_1_2.version_ + " Gitee",
        "files": [v10],
        "activityId": local_1_2.activityId
      }, function (p0) {
        let v1, v2 /*i1492*/;
        if (p0.taskId > 0) {
          local_1_2.currentDmTaskId_ = p0.taskId;
          local_1_2.rememberDmTask_(p0.taskId);
        }
        if (local_1_0 > 0) {
          v1 = Math.max(0, p0.bytesDone);
          v2 = Math.min(99, Math.max(0, Math.round(v1 / local_1_0 * 100)));
          v1 = local_1_1 + " " + v2 + "% " + e1484(v1) + "/" + e1484(local_1_0) + " [" + d1484(p0.speedBps) + "]";
          local_1_2.reportDownload("downloading", v2, Math.max(0, Math.round(p0.speedBps / 1024)), v1);
        } else {
          local_1_2.bridgeProgress(local_1_1, p0);
        }
      });
      v4 = await acc;
      local_1_2.currentDmTaskId_ = 0;
      if (!(await local_1_2.waitForNativeOwners_())) {
        throw new Error("JDK 下载资源仍在结束，请稍后重试");
      }
      if (local_1_2.cancelRequested_) {
        return false;
      }
      v4 = "JDK " + local_1_2.version_ + " Gitee single ok: " + v4.bytesDone + " bytes";
      local_1_2.alog().info(local_0_1, v4, z31);
      return true;
    } catch (catchAcc) {
      local_1_2.alog().warn(local_0_1, "JDK " + local_1_2.version_ + " Gitee single download error", catchAcc, z31);
      if (!(await local_1_2.waitForNativeOwners_())) {
        throw new Error("JDK 下载资源仍在结束，已保留下载现场，请稍后重试");
      }
      try {
        g50.unlinkSync(p0);
      } catch (catchAcc) {}
      try {
        g50.unlinkSync(p0 + ".download-meta");
      } catch (catchAcc) {}
      return false;
    }
  }
  async downloadGiteeParallel(p0, p1, p2) {
    let v0, v4, v5, v6, v7, v9, v10, v11, v12, v13, v14, v18, v21, v22, acc;
    {
      let local_1_0, local_1_1;
      let local_1_4 = this;
      let local_1_2 = p1;
      let local_1_3 = p2;
      v5 = local_1_4.config_.giteeParts;
      v7 = d398.instance();
      v9 = [];
      local_1_0 = [];
      local_1_1 = [];
      for (v10 = 0; v10 < local_1_4.config_.giteeParts.length; v10 += 1) {
        v12 = p0 + ".p" + v10;
        v9.push(p0 + ".p" + v10);
        local_1_0.push(0);
        local_1_1.push(0);
      }
      local_1_4.giteeTaskIds_ = [];
      v11 = [];
      try {
        v12 = p0;
        v13 = v9;
        v14 = v11;
        v18 = 0;
      } catch (catchAcc) {
        local_1_4.alog().warn(local_0_1, "JDK " + local_1_4.version_ + " Gitee parallel download error", catchAcc, z31);
        local_1_4.cancelAllGiteeTasks();
        await Promise.allSettled(v14);
        if (!(await local_1_4.waitForNativeOwners_())) {
          throw new Error("JDK 分卷资源仍在结束，已保留下载现场，请稍后重试");
        }
        local_1_4.giteeTaskIds_ = [];
        v0 = v13[Symbol.iterator]();
        while (true) {
          v5 = v0.next();
          if (v5.done) break;
          g50.unlinkSync(v5.value);
        }
        try {
          g50.unlinkSync(v12);
        } catch (catchAcc) {}
        try {
          g50.unlinkSync(v12 + ".download-meta");
        } catch (catchAcc) {}
        return false;
      }
      while (v18 < local_1_4.config_.giteeParts.length) {
        local_2_0 = v18;
        if (!local_0_4(h1484 + "/" + local_1_4.config_.tag + "/" + v5[local_2_0])) {
          throw new Error("Unsafe Gitee JDK part URL");
        }
        v21 = local_1_4.config_.giteePartSizes === undefined ? 0 : local_2_0 < local_1_4.config_.giteePartSizes.length ? local_1_4.config_.giteePartSizes[local_2_0] : 0;
        v22 = local_0_5(p0);
        acc = v7.createAndWait({
          "name": "JDK " + local_1_4.version_ + " Gitee " + (local_2_0 + 1) + "/" + local_1_4.config_.giteeParts.length,
          "files": [v21 > 0 ? {
            "localPath": v9[local_2_0],
            "urls": [h1484 + "/" + local_1_4.config_.tag + "/" + v5[local_2_0]],
            "allowedRoot": v22,
            "maxConnections": 1,
            "check": {
              "size": v21
            }
          } : {
            "localPath": v9[local_2_0],
            "urls": [h1484 + "/" + local_1_4.config_.tag + "/" + v5[local_2_0]],
            "allowedRoot": v22,
            "maxConnections": 1
          }],
          "activityId": local_1_4.activityId
        }, function (p0) {
          if (p0.taskId > 0) {
            if (local_1_4.giteeTaskIds_.indexOf(p0.taskId) < 0) {
              local_1_4.giteeTaskIds_.push(p0.taskId);
            }
            local_1_4.rememberDmTask_(p0.taskId);
          }
          local_1_0[local_2_0] = Math.max(0, p0.bytesDone);
          local_1_1[local_2_0] = Math.max(0, p0.speedBps);
          local_1_4.reportGiteeAggregate(local_1_2, local_1_0, local_1_1, local_1_3);
        });
        v11.push(acc);
        let local_2_2_0 = local_2_0;
        v18 += 1;
      }
    }
    v4 = await Promise.all(v11);
    if (!(await local_1_4.waitForNativeOwners_())) {
      throw new Error("JDK 分卷资源仍在结束，请稍后重试");
    }
    local_1_4.giteeTaskIds_ = [];
    if (local_1_4.cancelRequested_) {
      for (v6 of v9) {
        g50.unlinkSync(v6);
      }
      return false;
    }
    for (v5 = 0; v5 < v4.length; v5 += 1) {
      local_1_4.alog().info(local_0_1, "JDK " + local_1_4.version_ + " Gitee part " + (v5 + 1) + "/" + local_1_4.config_.giteeParts.length + " ok: " + v4[v5].bytesDone + " bytes", z31);
    }
    local_1_4.reportDownload("downloading", 99, 0, local_1_2 + " 合并分卷…");
    local_1_4.concatParts(v9, p0);
    for (v6 of v9) {
      g50.unlinkSync(v6);
    }
    return true;
  }
  reportGiteeAggregate(p0, p1, p2, p3) {
    let v1, v4, v5, v6 /*d1484*/;
    if (p3 <= 0) {
      return;
    }
    v4 = 0;
    for (v5 of p1) {
      v4 += v5;
    }
    v5 = 0;
    for (v6 of p2) {
      v5 += v6;
    }
    v1 = Math.min(99, Math.max(0, Math.round(v4 / p3 * 100)));
    v4 = p0 + " 步骤 1/3：下载（Gitee 分卷并行）" + v1 + "% " + e1484(v4) + "/" + e1484(p3) + " [" + d1484(v5) + "]";
    this.reportDownload("downloading", v1, Math.max(0, Math.round(v5 / 1024)), v4);
    return;
  }
  concatParts(p0, p1) {
    let v0 /*g50*/, v2, v8, v10, v13, v19, v27;
    try {
      v0 = g50.openSync(p1, g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
      v8 = new ArrayBuffer(1024 * 1024);
      v10 = p0[Symbol.iterator]();
      v2 = v0;
      do {
        v13 = v10.next();
        v2 = v0;
        if (v13.done) {
          break;
        }
        v13 = v13.value;
        v19 = null;
        v2 = v0;
        try {
          v27 = null;
          v2 = v0;
          v13 = g50.openSync(v13, g50.OpenMode.READ_ONLY);
          while ((v27 = v13, v2 = v0, true) && (v19 = g50.readSync(v13.fd, v8), v27 = v13, v19 > 0)) {
            v27 = v13;
            v2 = v0;
            g50.writeSync(v0.fd, v8, {
              "length": v19
            });
          }
        } finally {
          if (v2 = v0, v27) {
            try {
              v2 = v0;
              g50.closeSync(v27);
            } catch (catchAcc) {}
          }
        }
      } while (true);
    } finally {
      if (v2) {
        try {
          g50.closeSync(v2);
        } catch (catchAcc) {}
      }
    }
  }
  buildGithubUrls(p0, p1) {
    let v0 /*m1489*/, v1, v4;
    let local_1_0;
    if (!local_0_4(p0)) {
      throw new Error("Unsafe GitHub JDK URL");
    }
    local_1_0 = [];
    v0 = function (p0) {
      if (!local_0_4(p0)) {
        throw new Error("Unsafe JDK mirror URL");
      }
      if (local_1_0.indexOf(p0) < 0) {
        local_1_0.push(p0);
      }
      return;
    };
    if (p1 === "github") {
      v0(p0);
    } else if (p1 === "mirror") {
      v1 = g1484[Symbol.iterator]();
      while (true) {
        v4 = v1.next();
        if (v4.done) break;
        v4 = v4.value;
        if (v4 !== "{url}") {
          v4 = v4.replace("{url}", p0);
          v0(v4);
        }
      }
    } else {
      v1 = g1484[Symbol.iterator]();
      while (true) {
        v4 = v1.next();
        if (v4.done) break;
        v4 = v4.value.replace("{url}", p0);
        v0(v4);
      }
    }
    return local_1_0;
  }
  async downloadJdkArchive(p0, p1) {
    let v3 /*g50*/, v4 /*z31*/, v6 /*a1*/, v8, acc;
    let local_1_1 = this;
    let local_1_0 = p1;
    v4 = local_1_1.config_.downloadSource === undefined ? i1484() : local_1_1.config_.downloadSource;
    if (local_1_1.config_.downloads === undefined) {
      v6 = local_1_1.config_.giteeParts !== undefined && local_1_1.config_.giteeParts.length > 0;
      if (local_1_1.config_.giteeParts !== undefined && local_1_1.config_.giteeParts.length > 0 && (v6 = v4 === "auto", v4 !== "auto")) {
        v6 = v4 === "gitee";
      }
      if (v6) {
        if (await local_1_1.tryGiteeDownload(p0, local_1_0)) {
          return true;
        }
        if (local_1_1.cancelRequested_) {
          return false;
        }
        local_1_1.alog().warn(local_0_1, "JDK " + local_1_1.version_ + " Gitee download failed (source=" + v4 + "), fallback to GitHub mirrors", null, z31);
        local_1_1.reportDownload("downloading", 0, 0, local_1_0 + " Gitee 不可用，改用 GitHub 镜像…");
      }
      v4 = local_1_1.buildGithubUrls(f1484 + "/" + local_1_1.config_.tag + "/" + local_1_1.config_.dataFile, v4);
      v6 = local_0_5(p0);
      if (v6.length === 0) {
        throw new Error("Invalid JDK download staging root");
      }
      v8 = v4.length > 1 ? 16 : 6;
      v6 = {
        "name": "JDK " + local_1_1.version_ + " (" + local_1_1.config_.dataFile + ")",
        "files": [local_1_1.config_.sizeBytes !== undefined && local_1_1.config_.sizeBytes > 0 ? {
          "localPath": p0,
          "urls": v4,
          "allowedRoot": v6,
          "check": {
            "size": local_1_1.config_.sizeBytes
          },
          "maxConnections": v8
        } : {
          "localPath": p0,
          "urls": v4,
          "allowedRoot": v6,
          "maxConnections": v8
        }],
        "activityId": local_1_1.activityId
      };
      local_1_1.reportDownload("downloading", 0, 0, local_1_0 + (v4.length > 1 ? " 连接下载引擎中（多镜像并行）..." : " 连接 GitHub 源站中..."));
      v3 = d398.instance();
      try {
        v3.initializeCaBundle(local_1_1.context_);
      } catch (catchAcc) {}
      try {
        acc = v3.createAndWait(v6, function (p0) {
          if (p0.taskId > 0) {
            local_1_1.currentDmTaskId_ = p0.taskId;
            local_1_1.rememberDmTask_(p0.taskId);
          }
          local_1_1.bridgeProgress(local_1_0, p0);
        });
        v3 = await acc;
        local_1_1.currentDmTaskId_ = 0;
        if (!(await local_1_1.waitForNativeOwners_())) {
          throw new Error("JDK 下载资源仍在结束，请稍后重试");
        }
        v3 = "JDK " + local_1_1.version_ + " downloaded: " + v3.bytesDone + " bytes via " + v4.length + " mirror(s)";
        local_1_1.alog().info(local_0_1, v3, z31);
        return true;
      } catch (catchAcc) {
        local_1_1.alog().error(local_0_1, "JDK download via DownloadManager failed", catchAcc, z31);
        local_1_1.reportDownload("downloading", 0, 0, local_1_0 + " 下载失败：" + catchAcc.message);
        if (!(await local_1_1.waitForNativeOwners_())) {
          throw new Error("JDK 下载资源仍在结束，已保留下载现场，请稍后重试");
        }
        try {
          g50.unlinkSync(p0);
        } catch (catchAcc) {}
        try {
          g50.unlinkSync(p0 + ".download-meta");
        } catch (catchAcc) {}
        return false;
      }
    } else {
      return local_1_1.downloadCatalogArchive(p0, local_1_0, v4);
    }
  }
  async downloadCatalogArchive(p0, p1, p2) {
    let v0, v3, v7, v8, v9, v10, v19, v22, v25, v28, v29, v30, v31, v32, v33, v34, v36, v37, v39, v41, v42, v44, v46, v47, v48, v72, acc;
    let local_1_1;
    let local_1_3 = this;
    let local_1_2 = p1;
    let local_1_0 = p2;
    v3 = [];
    for (v7 of local_1_3.config_.downloads) {
      if (v7.sourceId === "web" && local_1_3.config_.webEnabled !== true && local_1_0 === "web" && v7.sourceId !== "web") {
        if (local_1_0 !== "github" && local_1_0 !== "mirror" || v7.sourceId === "github") {
          v3.push(v7);
        }
      }
    }
    v3.sort(function (p0, p1) {
      let v0 = local_1_0 === "web" ? ["web"] : ["gitee", "github", "web"];
      return v0.indexOf(p0.sourceId) - v0.indexOf(p1.sourceId);
    });
    local_1_1 = d398.instance();
    local_1_1.initializeCaBundle(local_1_3.context_);
    v3 = v3[Symbol.iterator]();
    v8 = v3.next;
    v9 = false;
    while (true) {
      v10 = v8.call(v3);
      if (v10.done) break;
      v10 = v10.value;
      let local_2_2_0, local_2_2_1;
      let local_2_2_2 = v10;
      v10 = [];
      v19 = undefined;
      try {
        if (local_1_3.cancelRequested_) {
          local_1_3.giteeTaskIds_ = [];
          v37 = local_1_3.purgeNativeOwners();
          for (v41 of v10) {
            if (v37) {
              if (v41 !== p0) {
                g50.unlinkSync(v41);
                g50.unlinkSync(v41 + ".download-meta");
              }
            }
          }
          if (!v9) {
            v9 = true;
            v8 = v3.return;
            if (v3.return != undefined) {
              v3.return();
            }
          }
          v22 = v9;
          v25 = v10;
          return false;
        }
        v36 = local_2_2_2.transport === "single-file" ? [{
          "url": local_2_2_2.url,
          "sizeBytes": local_1_3.config_.sizeBytes,
          "sha256": local_1_3.config_.sha256
        }] : local_2_2_2.parts;
        local_2_2_0 = v36.map(function () {
          return 0;
        });
        local_2_2_1 = v36.map(function () {
          return 0;
        });
        v37 = [];
        local_1_3.giteeTaskIds_ = [];
        {
          let local_3_0, local_3_1, local_3_2, local_3_3;
          v46 = 0;
          while (true) {
            v39 = v0;
            v42 = v3;
            if (v46 >= v36.length) break;
            local_3_3 = v36[v46];
            local_3_2 = local_2_2_2.transport === "single-file" ? p0 : p0 + ".p" + v46;
            v10.push(local_3_2);
            v47 = local_2_2_2.sourceId === "github" ? local_1_3.buildGithubUrls(local_3_3.url, local_1_0) : [local_3_3.url];
            v48 = {
              "localPath": local_3_2,
              "urls": v47,
              "allowedRoot": local_0_5(p0),
              "maxConnections": null,
              "check": null
            };
            if (local_2_2_2.sourceId === "gitee") {
              v47 = 1;
            } else {
              v47 = v47.length > 1 ? 16 : 6;
            }
            v48.maxConnections = v47;
            v48.check = {
              "size": local_3_3.sizeBytes
            };
            local_3_0 = {
              "name": local_1_2 + " " + local_2_2_2.sourceId + " " + (v46 + 1) + "/" + v36.length,
              "files": [v48],
              "activityId": local_1_3.activityId
            };
            local_3_1 = v46;
            acc = async function () {
              let v4 /*g50*/, acc;
              let local_4_0;
              if (local_1_3.cancelRequested_) {
                throw new Error("已取消");
              }
              v4 = 0;
              local_4_0 = 0;
              try {
                acc = local_1_1.createAndWait(local_3_0, function (p0) {
                  let v1 /*r1487*/, v4, v5;
                  let v0 = 0;
                  if (p0.taskId > 0) {
                    local_1_3.currentDmTaskId_ = p0.taskId;
                    local_1_3.rememberDmTask_(p0.taskId);
                    if (local_1_3.giteeTaskIds_.indexOf(p0.taskId) < 0) {
                      local_1_3.giteeTaskIds_.push(p0.taskId);
                    }
                  }
                  local_2_2_0[local_3_1] = Math.max(0, p0.bytesDone);
                  local_2_2_1[local_3_1] = Math.max(0, p0.speedBps);
                  v4 = 0;
                  for (v5 of local_2_2_0) {
                    v4 += v5;
                  }
                  for (v5 of local_2_2_1) {
                    v0 += v5;
                  }
                  v4 = v4 / local_1_3.config_.sizeBytes * 100;
                  v1 = Math.min(99, Math.floor(v4));
                  v0 = Math.round(v0 / 1024);
                  local_1_3.reportDownload("downloading", v1, v0, local_1_2 + " " + local_2_2_2.sourceId + " " + v1 + "%");
                });
                await acc;
              } finally {
                if (local_4_0 > 0) {
                  v4 = false;
                  try {
                    v4 = local_1_1.purgeTask(local_4_0);
                  } catch (catchAcc) {}
                  if (!v4) {
                    await local_1_1.awaitTaskReleased(local_4_0, true);
                  }
                }
              }
              if (g50.statSync(local_3_2).size !== local_3_3.sizeBytes) {
                throw new Error("下载文件身份不符：" + local_2_2_2.sourceId + " 分卷 " + (local_3_1 + 1));
              }
              if ((await local_1_3.computeFileSha256(local_3_2)) === local_3_3.sha256) {
                return undefined;
              }
              throw new Error("下载文件身份不符：" + local_2_2_2.sourceId + " 分卷 " + (local_3_1 + 1));
            }();
            v37.push(acc);
            let local_3_2_0 = local_3_0;
            let local_3_2_1 = local_3_1;
            let local_3_2_2 = local_3_2;
            let local_3_2_3 = local_3_3;
            v39 = v0;
            v42 = v3;
            v46 += 1;
          }
          v28 = p0;
          v30 = v9;
          v31 = v8;
          v32 = v3;
          v33 = v10;
          v34 = undefined;
          v22 = v9;
          v25 = v10;
        }
        v44 = v37;
        try {
          await Promise.all(v37);
          v0 = await local_1_3.waitForNativeOwners_();
          if (!v0) {
            local_1_3.report(false, "JDK 下载资源仍在结束，已保留下载现场，请稍后重试");
            local_1_3.giteeTaskIds_ = [];
            v37 = local_1_3.purgeNativeOwners();
            for (v41 of v10) {
              if (v37) {
                if (v41 !== p0) {
                  g50.unlinkSync(v41);
                  g50.unlinkSync(v41 + ".download-meta");
                }
              }
            }
            if (!v9) {
              v9 = true;
              v8 = v3.return;
              if (v3.return != undefined) {
                v3.return();
              }
            }
            v22 = v9;
            v25 = v10;
            return false;
          }
          local_1_3.currentDmTaskId_ = 0;
          local_1_3.giteeTaskIds_ = [];
          if (!local_1_3.cancelRequested_) {
            if (local_2_2_2.transport === "concat-parts") {
              local_1_3.concatParts(v10, p0);
            }
            local_1_3.giteeTaskIds_ = [];
            v37 = local_1_3.purgeNativeOwners();
            for (v41 of v10) {
              if (v37) {
                if (v41 !== p0) {
                  g50.unlinkSync(v41);
                  g50.unlinkSync(v41 + ".download-meta");
                }
              }
            }
            if (!v9) {
              v9 = true;
              v8 = v3.return;
              if (v3.return != undefined) {
                v3.return();
              }
            }
            v22 = v9;
            v25 = v10;
            return true;
          }
          local_1_3.giteeTaskIds_ = [];
          v37 = local_1_3.purgeNativeOwners();
          for (v41 of v10) {
            if (v37) {
              if (v41 !== p0) {
                g50.unlinkSync(v41);
                g50.unlinkSync(v41 + ".download-meta");
              }
            }
          }
          if (!v9) {
            v9 = true;
            v8 = v3.return;
            if (v3.return != undefined) {
              v3.return();
            }
          }
          v22 = v9;
          v25 = v10;
          return false;
        } catch (catchAcc) {
          local_1_3.cancelAllGiteeTasks();
          v0 = await Promise.allSettled(v44);
          v22 = v39;
          v25 = v42;
          throw catchAcc;
        }
      } catch (catchAcc) {
        v3 = local_1_3.alog().warn;
        v8 = local_0_1;
        v9 = "目录下载来源失败：" + local_2_2_2.sourceId;
        v10 = z31;
        v3.call(local_1_3.alog(), local_0_1, "目录下载来源失败：" + local_2_2_2.sourceId, catchAcc, z31);
        v29 = await local_1_3.waitForNativeOwners_();
        v0 = v29;
        if (!v29) {
          local_1_3.report(false, "JDK 下载资源仍在结束，已保留下载现场，请稍后重试");
          local_1_3.giteeTaskIds_ = [];
          v3 = local_1_3.purgeNativeOwners();
          v9 = v33[Symbol.iterator]().next;
          v19 = v33;
          p0 = v28;
          v28 = v34;
          v0 = v29;
          v72 = v3;
          v3 = v32;
          v32 = v33[Symbol.iterator]();
          v8 = v31;
          v31 = v9;
          v9 = v30;
          while (true) {
            v33 = v31.call(v32);
            if (v33.done) break;
            v33 = v33.value;
            if (v72) {
              if (v33 !== p0) {
                g50.unlinkSync(v33);
                g50.unlinkSync(v33 + ".download-meta");
              }
            }
          }
          if (!v30) {
            v9 = true;
            v8 = v3.return;
            if (v3.return == undefined) {
              v10 = v19;
              v19 = v28;
              v28 = false;
            } else {
              v3.return();
              v10 = v19;
              v19 = v28;
              v28 = false;
            }
          } else {
            v10 = v19;
            v19 = v28;
            v28 = false;
          }
          v22 = v9;
          v25 = v10;
          return v28;
        }
        try {
          p0 = v28;
          p0 = v28;
          p0 = v28;
          p0 = v28;
          g50.unlinkSync(v28);
          p0 = v28;
          v0 = v29;
          v9 = v30;
          v8 = v31;
          v3 = v32;
          v10 = v33;
          v19 = v34;
        } catch (catchAcc) {}
        v28 = p0;
        v30 = v9;
        v31 = v8;
        v32 = v3;
        v33 = v10;
        v34 = v19;
        v22 = v9;
        v25 = v10;
        g50.unlinkSync(p0 + ".download-meta");
      } finally {
        v28 = hole;
        v25 = v10;
        if (v19 == undefined) {
          local_1_3.giteeTaskIds_ = [];
          v10 = local_1_3.purgeNativeOwners();
          v19 = v25[Symbol.iterator]();
          while (true) {
            v22 = v19.next();
            if (v22.done) break;
            v22 = v22.value;
            v28 = v19;
            if (v10) {
              v28 = v19;
              if (v22 !== p0) {
                g50.unlinkSync(v22);
                v22 += ".download-meta";
                v30 = p0;
                v31 = v0;
                v32 = v9;
                v33 = v8;
                v34 = v3;
                v39 = v19;
                v28 = v19;
                g50.unlinkSync(v22);
              }
            }
          }
        }
      }
    }
    local_1_3.report(false, "❌ " + local_1_2 + " 所选来源不可用，旧安装已保留");
    return false;
  }
  bridgeProgress(p0, p1) {
    let v0, v1, v2, v4 /*e1484*/, v5 /*d1484*/, v6;
    if (p1.finished) {
      return;
    }
    if (p1.bytesTotal <= 0 && p1.bytesDone <= 0) {
      this.reportDownload("downloading", 0, 0, p0 + " 步骤 1/3：正在测试下载源可用性…");
      return;
    }
    v2 = Math.min(99, Math.max(0, Math.round(p1.progress * 100)));
    v4 = p1.bytesTotal > 0 ? e1484(p1.bytesDone) + "/" + e1484(p1.bytesTotal) : e1484(p1.bytesDone);
    v5 = d1484(p1.speedBps);
    v6 = p1.etaSeconds > 0 ? "剩 " + p1.etaSeconds + "s " : "";
    if (p1.bytesDone > this.peakBytesDone_) {
      this.peakBytesDone_ = p1.bytesDone;
    }
    v1 = this.peakBytesDone_ - p1.bytesDone > 256 * 1024 ? " · 有分段重下 " + e1484(this.peakBytesDone_ - p1.bytesDone) : "";
    v0 = p1.activeThreads > 0 ? " · " + p1.activeThreads + " 线程" : "";
    v4 = p0 + " 步骤 1/3：下载 " + v2 + "% " + v4 + " [" + v5 + "] " + v6;
    v0 = v4 + v0 + v1;
    this.reportDownload("downloading", v2, Math.max(0, Math.round(p1.speedBps / 1024)), v0);
    return;
  }
  expectedZipBytes_() {
    return this.config_.sizeBytes !== undefined && this.config_.sizeBytes > 0 ? this.config_.sizeBytes : this.config_.dataSizeMB * 1024 * 1024;
  }
  async completeJdkInstall(p0, p1, p2, p3) {
    let v5 /*g50*/, v6 /*a1*/, v7 /*a1*/, v8 /*z31*/, v9 /*z31*/, v12 /*z31*/, v20, v21, acc;
    let local_1_0, local_1_2;
    let local_1_4 = this;
    let local_1_1 = p2;
    let local_1_3 = p3;
    if (local_1_4.cancelRequested_) {
      local_1_4.reportDownload("verifying", 0, 0, local_1_3 + " 已取消");
      return false;
    }
    if (!(await local_1_4.verifyArchiveIntegrity(p0, local_1_3))) {
      return false;
    }
    if (local_1_4.cancelRequested_) {
      local_1_4.reportDownload("extracting", 0, 0, local_1_3 + " 已取消");
      return false;
    }
    local_1_4.reportDownload("extracting", 0, 0, local_1_3 + " 步骤 3/3：解压安装（无进度可报，可能需要 2-5 分钟，请勿关闭）...");
    try {
      i50(local_1_1);
    } catch (catchAcc) {}
    h50(local_1_1);
    local_1_0 = 0;
    local_1_2 = Date.now();
    acc = setInterval(function () {
      let v2;
      let v1 /*g50*/ = local_1_0 /*n1485*/ + 1;
      local_1_0 += 1;
      try {
        v1 = g50.listFileSync(local_1_1).length;
      } catch (catchAcc) {
        v1 = 0;
      }
      v2 = local_1_3 + " 步骤 3/3：解压安装中… 已用 " + Math.round((Date.now() - local_1_2) / 1000) + "s";
      local_1_4.reportDownload("extracting", Math.min(99, local_1_0 /*n1485*/ * 3), 0, v2 + (v1 > 0 ? "（已展开 " + v1 + " 个顶层条目）" : "") + "，请勿关闭");
    }, 2000);
    try {
      await v1267(p0, local_1_1, 300000);
    } catch (catchAcc) {
      local_1_4.alog().error(local_0_1, "Extract failed", catchAcc, z31);
      local_1_4.report(false, "❌ " + local_1_3 + " 解压失败: " + catchAcc.message);
      try {
        i50(local_1_1);
      } catch (catchAcc) {}
      clearInterval(acc);
      return false;
    } finally {
      clearInterval(acc);
    }
    if (local_1_4.cancelRequested_) {
      local_1_4.alog().info(local_0_1, "JDK " + local_1_4.version_ + " extract finished but cancel requested; cleaning staging", z31);
      local_1_4.reportDownload("extracting", 100, 0, local_1_3 + " 已取消，清理中...");
      try {
        i50(local_1_1);
      } catch (catchAcc) {}
      return false;
    }
    v7 = local_1_4.version_;
    v5 = d1482(local_1_1, local_1_4.version_);
    v6 = v5.length;
    if (v5.length > 0) {
      local_1_4.alog().error(local_0_1, "JDK staging content invalid: " + v5, null, z31);
      local_1_4.report(false, "❌ " + local_1_3 + " 内容校验失败：" + v5);
      try {
        i50(local_1_1);
      } catch (catchAcc) {}
      return false;
    }
    if (local_1_4.config_.runtime !== undefined && local_1_4.config_.build !== undefined) {
      if (!x876.instance(local_1_4.context_).isBuildAllowed(local_1_4.config_.build.id)) {
        local_1_4.report(false, "该 JDK 构建已撤回或被回退指令停止发布，旧安装已保留");
        return false;
      }
      acc = {
        "schemaVersion": 1,
        "runtimeId": local_1_4.config_.runtime.id,
        "javaMajor": Number(local_1_4.version_),
        "buildId": local_1_4.config_.build.id,
        "recommendationRevision": local_1_4.config_.runtime.recommendationRevision,
        "archiveSha256": local_1_4.config_.sha256,
        "archiveSizeBytes": local_1_4.config_.sizeBytes,
        "installedAt": new Date().toISOString(),
        "origin": "catalog",
        "runtime": local_1_4.config_.runtime,
        "build": local_1_4.config_.build
      };
      v6 = g50.openSync(local_1_1 + "/.amcl-runtime-receipt.json", g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
      v7 = undefined;
      try {
        v12 = v6.fd;
        g50.writeSync(v6.fd, JSON.stringify(acc));
        g50.fsyncSync(v6.fd);
      } finally {
        g50.closeSync(v6);
      }
    }
    try {
      v6 = p1;
      v7 = p0;
      v12 = g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC;
      v9 = g50.openSync(local_1_1 + "/.amcl_release_tag", g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
      try {
        g50.writeSync(v9.fd, local_1_4.config_.tag);
      } finally {
        v6 = p1;
        v7 = p0;
        g50.closeSync(v9);
      }
    } catch (catchAcc) {
      v12 = z31;
      local_1_4.alog().warn(local_0_1, "JDK " + local_1_4.version_ + " stamp write failed (non-fatal)", catchAcc, z31);
      p0 = v7;
      p1 = v6;
    }
    v5 = p1 + ".backup-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
    v6 = false;
    v7 = false;
    try {
      try {
        v8 = j1481.publication(local_1_4.context_.filesDir, local_1_4.version_);
        try {
          g50.statSync(p1);
          v6 = true;
        } catch (catchAcc) {}
        v20 = v8;
        v12 = v8;
        if (v6) {
          g50.renameSync(p1, v5);
          v7 = true;
        }
        v21 = v7;
        g50.renameSync(local_1_1, p1);
      } finally {
        if (v12 !== null) {
          v12.release();
        }
      }
      if (v7) {
        try {
          i50(v5);
        } catch (catchAcc) {
          local_1_4.alog().warn(local_0_1, "JDK old-version backup cleanup failed: " + v5, catchAcc, z31);
        }
      }
      try {
        g50.unlinkSync(p0);
      } catch (catchAcc) {}
      local_1_4.alog().info(local_0_1, "JDK " + local_1_4.version_ + " published to " + p1 + "", z31);
      local_1_4.reportDownload("extracting", 100, 0, local_1_3 + " 完成 ✅");
      return true;
    } catch (catchAcc) {
      local_1_4.alog().error(local_0_1, "JDK staging publish failed", catchAcc, z31);
      if (v21) {
        try {
          g50.renameSync(v5, p1);
        } catch (catchAcc) {
          local_1_4.alog().error(local_0_1, "JDK publish rollback failed; backup retained at " + v5, catchAcc, z31);
          local_1_4.report(false, "❌ " + local_1_3 + " 安装发布失败：" + catchAcc.message);
          try {
            i50(local_1_1);
          } catch (catchAcc) {}
          if (v20 !== null) {
            v20.release();
          }
          return false;
        }
        local_1_4.report(false, "❌ " + local_1_3 + " 安装发布失败：" + catchAcc.message);
        try {
          i50(local_1_1);
        } catch (catchAcc) {}
        if (v20 !== null) {
          v20.release();
        }
        return false;
      }
      local_1_4.report(false, "❌ " + local_1_3 + " 安装发布失败：" + catchAcc.message);
      try {
        i50(local_1_1);
      } catch (catchAcc) {}
      if (v20 !== null) {
        v20.release();
      }
      return false;
    }
  }
  async verifyArchiveIntegrity(p0, p1) {
    let v0, acc;
    let v3 = 0;
    if (!this.config_.sha256 || this.config_.sha256.length === 0) {
      this.alog().warn(local_0_1, "JDK " + this.version_ + " 缺少可信 SHA-256，拒绝安装并保留旧版本", null, z31);
      return false;
    }
    if (!local_0_2(this.config_.sha256)) {
      this.alog().error(local_0_1, "Invalid configured JDK SHA-256", null, z31);
      return false;
    }
    this.reportDownload("verifying", v3, v3, p1 + " 步骤 2/3：校验文件完整性（SHA-256，约 " + e1484(this.expectedZipBytes_()) + "）...");
    this.alog().debug(local_0_1, "Computing SHA-256 for " + p0 + " (expected=" + this.config_.sha256 + ")", z31);
    try {
      v0 = await this.computeFileSha256(p0);
      acc = this.config_.sha256.toLowerCase();
      if (v0 === acc) {
        this.alog().info(local_0_1, "✅ SHA-256 verified for JDK " + this.version_ + "", z31);
        return true;
      }
      this.alog().error(local_0_1, "❌ SHA-256 mismatch for JDK " + this.version_ + ": expected=" + acc + " actual=" + v0 + "", null, z31);
      this.report(false, "❌ " + p1 + " 校验和不匹配，可能镜像被劫持");
      return false;
    } catch (catchAcc) {
      this.alog().error(local_0_1, "Failed to compute SHA-256", catchAcc, z31);
      this.report(false, "❌ " + p1 + " SHA-256 计算失败");
      return false;
    }
  }
  async computeFileSha256(p0) {
    let v3 /*g50*/, v4 /*a1*/, v13, v14, v16, v17 /*g50*/, v18 /*g50*/, v20, acc;
    try {
      v16 = 0;
      v4 = cryptoFramework.createMd("SHA256");
      v17 = g50.openSync(p0, g50.OpenMode.READ_ONLY);
      v18 = ArrayBuffer;
      acc = new ArrayBuffer(256 * 1024);
      v3 = acc;
      while (true && (acc = g50.readSync(v17.fd, v3), v18 = acc, acc > 0)) {
        v4.updateSync({
          "data": new Uint8Array(v3, 0, v18)
        });
      }
      v4 = v4.digestSync();
      for (v18 = ""; v16 < v4.data.length; v16 += 1) {
        v20 = v4.data[v16] < 16 ? "0" : "";
        v18 += v20 + v4.data[v16].toString(16);
      }
      if (v17) {
        try {
          g50.closeSync(v17);
        } catch (catchAcc) {}
      }
      return v18;
    } catch (catchAcc) {
      v14.alog().warn(local_0_1, "computeFileSha256 " + v13 + " failed", catchAcc, z31);
      throw catchAcc;
    }
  }
}