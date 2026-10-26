/*
* class name:L&entry/src/main/ets/common/AppLog&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import deviceInfo from "@ohos:deviceInfo";
import fs from "@ohos:file.fs";
import hilog from "@ohos:hilog";
let acc;
let local_0_0, local_0_1, local_0_2;
local_0_0 = 0;
local_0_1 = "HX360E";
local_0_2 = 2 * 1024 * 1024;
class AppLog {
  static dir = "";
  static file = "";
  static prevFile = "";
  static started = false;
  constructor() {}
  static init(p0) {
    if (AppLog.started) {
      return;
    }
    AppLog.started = true;
    AppLog.dir = "" + p0 + "/logs";
    AppLog.file = "" + AppLog.dir + "/app.log";
    AppLog.prevFile = "" + AppLog.dir + "/app.prev.log";
    if (!fs.accessSync(AppLog.dir)) {
      fs.mkdirSync(AppLog.dir, true);
    }
    AppLog.rotateIfNeeded();
    AppLog.i("app", "=== HX360E start === api=" + deviceInfo.sdkApiVersion + " model=" + deviceInfo.productModel + " os=" + deviceInfo.osFullName + "" + (" display=" + deviceInfo.displayVersion + ""));
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
    AppLog.e(p0, "" + p1 + ": " + JSON.stringify(p2) + "");
  }
  static append(p0, p1, p2) {
    let v0 /*fs*/, v1 /*fs*/;
    if (AppLog.file === "") {
      return;
    }
    v0 = "" + AppLog.now() + " " + p0 + " " + p1 + ": " + p2 + "\n";
    v1 = fs.openSync(AppLog.file, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.APPEND);
    try {
      fs.writeSync(v1.fd, v0);
    } finally {
      fs.closeSync(v1);
    }
  }
  static now() {
    let v0, v1, v2, v3;
    v0 = new Date();
    v1 = function (p0, p1) {
      return p0.toString().padStart(p1, "0");
    };
    v2 = "" + v0.getFullYear() + "-" + v1(v0.getMonth() + 1, 2) + "-" + v1(v0.getDate(), 2) + " ";
    v3 = "" + v1(v0.getHours(), 2) + ":" + v1(v0.getMinutes(), 2) + ":" + v1(v0.getSeconds(), 2);
    v2 += v3 + ".";
    v0 = v0.getMilliseconds();
    v0 = "" + v1(v0, 3);
    return v2 + (v0 + "");
  }
  static rotateIfNeeded() {
    if (!fs.accessSync(AppLog.file)) {
      return;
    }
    if (fs.statSync(AppLog.file).size <= local_0_2) {
      return;
    }
    fs.copyFileSync(AppLog.file, AppLog.prevFile);
    fs.truncateSync(AppLog.file, 0);
    return;
  }
}
export { AppLog };