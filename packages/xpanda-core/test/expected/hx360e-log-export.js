/*
* class name:L&entry/src/main/ets/common/LogExport&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import fs from "@ohos:file.fs";
import hilog from "@ohos:hilog";
import picker from "@ohos:file.picker";
import util from "@ohos:util";
let LogExport;
let acc;
let local_0_0, local_0_1;
local_0_0 = 0;
local_0_1 = "HX360E";
{
  let local_1_0;
  local_1_0 = class panda_jmp0_reserved_anonymous_0 {
    constructor() {}
    static readLogTail(p0, p1) {
      let v1 /*hilog*/, v5, v6 /*fs*/, v7, v8 /*util*/, v10, v11, v12, v13, v14, v18, acc;
      try {
        if (!fs.accessSync(p0)) {
          return "(no such file: " + p0 + ")\n";
        }
        v1 = fs.openSync(p0, fs.OpenMode.READ_ONLY);
        try {
          v6 = fs.statSync(v1.fd).size;
          v7 = Math.min(p1, v6);
          v8 = util.TextDecoder.create("utf-8");
          v10 = new ArrayBuffer(64 * 1024);
          v11 = [];
          v12 = v6 - v7;
          v13 = 0;
          while (v13 < v7 && (v14 = Math.min(64 * 1024, v7 - v13), v18 = {
            "offset": null,
            "length": null
          }, v18.offset = v12, v18.length = v14, acc = fs.readSync(v1.fd, v10, v18), v14 = acc, acc > 0)) {
            v11.push(v8.decodeToString(new Uint8Array(v10, 0, v14)));
            v13 += v14;
            v12 += v14;
          }
          v5 = "# " + p0 + " size=" + v6 + " tail=" + v13 + "\n" + v11.join("") + "";
          return v5;
        } finally {
          fs.closeSync(v1);
        }
      } catch (catchAcc) {
        hilog.error(local_0_0, local_0_1, "readLogTail failed: %{public}s", JSON.stringify(catchAcc));
        return "(read failed: " + p0 + ")\n";
      }
    }
    static buildText(p0) {
      return "HX360E logs " + new Date().toISOString() + "\n" + "\n===== app.prev.log (上一份应用日志，tail 256KB) =====\n" + local_1_0.readLogTail("" + ("" + p0 + "/logs") + "/app.prev.log", 256 * 1024) + "\n===== app.log (应用日志，tail 512KB) =====\n" + local_1_0.readLogTail("" + ("" + p0 + "/logs") + "/app.log", 512 * 1024) + "\n===== native_fault.prev.log (上次运行，崩溃现场) =====\n" + local_1_0.readLogTail("" + ("" + p0 + "/logs") + "/native_fault.prev.log", 256 * 1024) + "\n===== native_fault.log (tail 256KB) =====\n" + local_1_0.readLogTail("" + ("" + p0 + "/logs") + "/native_fault.log", 256 * 1024) + "\n===== xe.log (tail 4MB) =====\n" + local_1_0.readLogTail("" + ("" + p0 + "/logs") + "/xe.log", 4 * 1024 * 1024);
    }
    static async exportLogs(p0, p1) {
      let v0 /*hilog*/, v5 /*LogExport*/, v6 /*DOMAIN*/, v8 /*hilog*/;
      try {
        v5 = local_1_0.buildText(p1);
        v6 = new picker.DocumentSaveOptions();
        v6.newFileNames = ["hx360e-log-" + Date.now() + ".txt"];
        v0 = await new picker.DocumentViewPicker(p0).save(v6);
        if (v0.length === 0) {
          return "已取消导出";
        }
        v8 = fs.openSync(v0[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        try {
          fs.writeSync(v8.fd, v5);
        } finally {
          fs.closeSync(v8);
        }
        hilog.info(local_0_0, local_0_1, "exportLogs: %{public}s", v0[0]);
        return "已导出 " + v5.length + " 字符 → " + v0[0] + "";
      } catch (catchAcc) {
        hilog.error(local_0_0, local_0_1, "exportLogs failed: %{public}s", JSON.stringify(catchAcc));
        return "导出失败（见 hilog）";
      }
    }
  };
}
LogExport = acc;
export { LogExport };