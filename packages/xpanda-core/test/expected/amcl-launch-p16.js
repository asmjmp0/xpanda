/*
* class name:L&launch/src/main/ets/p16&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import g50 from "@ohos:file.fs";
import { h50 } from "@normalized:N&&&commons/Index&1.0.0";
import { y } from "@normalized:N&&&commons/Index&1.0.0";
import { z31 } from "@normalized:N&&&commons/Index&1.0.0";
export class j1481 {
  constructor(p0) {
    this.file = null;
    this.file = p0;
  }
  release() {
    let v0 /*y*/ = this.file;
    this.file = null;
    if (v0 === null) {
      return;
    }
    try {
      v0.unlock();
    } catch (catchAcc) {
      y.warn("JdkDirectoryLease", "unlock failed; closing owned fd", catchAcc, z31);
    }
    try {
      g50.closeSync(v0);
    } catch (catchAcc) {
      y.warn("JdkDirectoryLease", "close lease fd failed", catchAcc, z31);
    }
    return;
  }
  static writer(p0, p1) {
    return j1481.acquire(p0, p1, "writer");
  }
  static publication(p0, p1) {
    return j1481.acquire(p0, p1, "use");
  }
  static acquire(p0, p1, p2) {
    let v0, v1 /*g50*/, acc;
    if (!new RegExp("^[0-9]{1,3}$").test(p1)) {
      throw new Error("JDK 槽位标识无效");
    }
    h50(p0 + "/jdk/.locks");
    acc = g50.openSync(p0 + "/jdk/.locks" + "/" + p1 + "." + p2, g50.OpenMode.CREATE | g50.OpenMode.READ_WRITE);
    v0 = acc;
    try {
      acc = acc.tryLock;
      acc.call(v0, true);
      return new j1481(v0);
    } catch (catchAcc) {
      try {
        g50.closeSync(v0);
      } catch (catchAcc) {}
      if (catchAcc.code === 13900034) {
        v1 = p2 === "use" ? "JDK " + p1 + " 正在使用，请关闭游戏或安装器后重试" : "JDK " + p1 + " 已有安装、导入或删除任务";
        throw new Error(v1);
      }
      throw new Error("无法锁定 JDK " + p1 + "：" + catchAcc.message);
    }
  }
}