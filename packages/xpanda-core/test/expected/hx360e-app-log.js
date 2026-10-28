/*
* class name:L&entry/src/main/ets/common/AppLog&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import deviceInfo from "@ohos:deviceInfo";
import fs from "@ohos:file.fs";
import hilog from "@ohos:hilog";
let local_0_0 = 0;
let local_0_1 = "HX360E";
let local_0_2 = 2 * 1024 * 1024;
export class AppLog {
  static dir = "";
  static file = "";
  static prevFile = "";
  static started = false;
  constructor() {}
  static init(p0) {
    let v2 /*AppLog*/, v3, v4, v5;
    if (AppLog.started) {
      return;
    }
    AppLog.started = true;
    AppLog.dir = "" + p0 + "/logs";
    AppLog.file = "" + AppLog.dir + "/app.log";
    AppLog.prevFile = "" + AppLog.dir + "/app.prev.log";
    try {
      if (!fs.accessSync(AppLog.dir)) {
        v3 = true;
        fs.mkdirSync(AppLog.dir, true);
      }
    } catch (catchAcc) {}
    AppLog.rotateIfNeeded();
    v2 = "?";
    try {
      v3 = "?";
      v4 = "?";
      v5 = 0;
      v5 = deviceInfo.sdkApiVersion;
      v4 = deviceInfo.productModel;
      v3 = deviceInfo.osFullName;
      v2 = deviceInfo.displayVersion;
    } catch (catchAcc) {}
    AppLog.i("app", "=== HX360E start === api=" + v5 + " model=" + v4 + " os=" + v3 + "" + (" display=" + v2 + ""));
    return;
  }
  static i(p0, p1) {
    hilog.info(local_0_0, local_0_1, "[%{public}s] %{public}s", p0, p1);
    AppLog.append("I", p0, p1);
  }
  static w(p0, p1) {
    hilog.warn(local_0_0, local_0_1, "[%{public}s] %{public}s", p0, p1);
    AppLog.append("W", p0, p1);
  }
  static e(p0, p1) {
    hilog.error(local_0_0, local_0_1, "[%{public}s] %{public}s", p0, p1);
    AppLog.append("E", p0, p1);
  }
  static exception(p0, p1, p2) {
    let v0;
    try {
      v0 = JSON.stringify(p2);
    } catch (catchAcc) {
      v0 = "" + p2 + "";
    }
    AppLog.e(p0, "" + p1 + ": " + v0 + "");
  }
  static append(p0, p1, p2) {
    let v0 /*fs*/, v1 /*fs*/;
    if (AppLog.file === "") {
      return;
    }
    v0 = "" + AppLog.now() + " " + p0 + " " + p1 + ": " + p2 + "\n";
    try {
      v1 = fs.openSync(AppLog.file, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.APPEND);
      try {
        fs.writeSync(v1.fd, v0);
      } finally {
        fs.closeSync(v1);
      }
    } catch (catchAcc) {
      return;
    }
  }
  static now() {
    let v0 = new Date();
    let v1 = function (p0, p1) {
      return p0.toString().padStart(p1, "0");
    };
    let v2 = "" + v0.getFullYear() + "-" + v1(v0.getMonth() + 1, 2) + "-" + v1(v0.getDate(), 2) + " ";
    let v3 = "" + v1(v0.getHours(), 2) + ":" + v1(v0.getMinutes(), 2) + ":" + v1(v0.getSeconds(), 2);
    v2 += v3 + ".";
    v0 = v0.getMilliseconds();
    v0 = "" + v1(v0, 3);
    return v2 + (v0 + "");
  }
  static rotateIfNeeded() {
    try {
      if (!fs.accessSync(AppLog.file)) {
        return;
      }
      if (fs.statSync(AppLog.file).size <= local_0_2) {
        return;
      }
      fs.copyFileSync(AppLog.file, AppLog.prevFile);
      fs.truncateSync(AppLog.file, 0);
    } catch (catchAcc) {}
  }
}