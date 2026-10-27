/*
* class name:L&feature_core/src/main/ets/t11/d12&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { a104 } from "@normalized:N&&&commons/Index&1.0.0";
import { a32 } from "@normalized:N&&&commons/Index&1.0.0";
import { d771 } from "@normalized:N&&&feature_core/src/main/ets/t11/w11&1.0.0";
import { f1286 } from "@normalized:N&&&feature_core/src/main/ets/e11/h11&1.0.0";
import { f771 } from "@normalized:N&&&feature_core/src/main/ets/t11/b12&1.0.0";
import g50 from "@ohos:file.fs";
import { i50 } from "@normalized:N&&&commons/Index&1.0.0";
import { v1267 } from "@normalized:N&&&feature_core/src/main/ets/t11/a12&1.0.0";
import { y } from "@normalized:N&&&commons/Index&1.0.0";
let local_0_0 = "ForgelikeProcRunner";
export class h1286 {
  constructor(p0, p1, p2, p3) {
    if (p3 === undefined) {
      p3 = "";
    }
    this.success = false;
    this.error = "";
    this.ranCount = 0;
    this.patchedClientPath = "";
    this.success = p0;
    this.error = p1;
    this.ranCount = p2;
    this.patchedClientPath = p3;
  }
}
export class g771 {
  constructor() {}
  static async run(p0, p1, p2, p3, p4, p5, p6, p7, p8, p9) {
    let v1, v4, v5, v6, v7, v10, v13, v14, v15, v18, acc;
    let local_2_1;
    let local_2_5 = p2;
    let local_2_2 = p4;
    let local_2_3 = p6;
    let local_2_4 = p7;
    let local_2_0 = p9;
    try {
      v5 = JSON.parse(g50.readTextSync(p0));
    } catch (catchAcc) {
      return new h1286(false, "install_profile.json 解析失败: " + catchAcc.message, 0);
    }
    if (!v5) {
      return new h1286(false, "install_profile.json 为空", 0);
    }
    v4 = new Map();
    acc = v4.set("SIDE", "client");
    acc = v4.set("ROOT", local_2_5);
    acc = v4.set("MINECRAFT_JAR", local_2_5 + "/versions/" + p5 + "/" + p5 + ".jar");
    acc = v4.set("LIBRARY_DIR", p3);
    acc = v4.set("MINECRAFT_VERSION", p5);
    acc = v4.set("INSTALLER", p1);
    if (v5.data) {
      v7 = Object.keys(v5.data)[Symbol.iterator]();
      while (true) {
        v10 = v7.next();
        if (v10.done) break;
        v10 = v10.value;
        if (v5.data[v10] && v5.data[v10].client !== undefined && v5.data[v10].client !== null) {
          v15 = g771.resolveDataValue(v15, p1, p3);
          acc = v4.set(v10, v15);
        }
      }
    }
    v6 = v4.has("PATCHED") ? v4.get("PATCHED") : "";
    v5 = v5.processors;
    if (!v5 || v5.length === 0) {
      return new h1286(false, "install_profile.json 无 processors", 0);
    }
    local_2_1 = [];
    for (v10 of v5) {
      if (g771.shouldRunForClient(v10)) {
        acc = local_2_1.push(v10);
      }
    }
    v5 = "processors total=" + v5.length + " client-run=" + local_2_1.length + "";
    acc = y.info(local_0_0, v5, a32);
    v5 = new Map();
    try {
      acc = i50(local_2_5 + "/forge-proc-tmp");
    } catch (catchAcc) {}
    {
      let local_3_1, local_3_2, local_3_3;
      let local_3_0 = 0;
      v13 = 0;
      while (local_3_0 < local_2_1.length) {
        v14 = local_2_1[local_3_0];
        try {
          v1 = await g771.resolveProcessor(local_2_1[local_3_0], v4, p3, local_2_5 + "/forge-proc-tmp", v5);
          v18 = v1;
          if (!v1) {
            return new h1286(false, "processor 解析失败（缺 jar/Main-Class）", v13);
          }
          local_3_1 = "运行 " + p8 + " 安装步骤 " + (local_3_0 + 1) + "/" + local_2_1.length + "（" + g771.shortMain(v1.mainClass) + "）...";
          acc = g771.report(local_2_0, "installing", 5 + local_3_0 / local_2_1.length, 8, local_3_1);
          acc = "run processor #" + local_3_0 + " main=" + v1.mainClass + " jar=" + v1.jarCoord + " args=[" + v1.args.join(" ");
          acc = y.info(local_0_0, acc + "]", a32);
          local_3_3 = local_2_5 + "/forge-installer.log";
          local_3_2 = v1;
          try {
            acc = f1286(async function () {
              g771.report(local_2_0, "installing", 5 + local_3_0 / local_2_1.length, 8, local_3_1);
              return f771().runJavaProcessor(local_2_2, local_2_3, local_2_4, local_3_2.classpath, local_3_2.mainClass, local_3_2.args, local_2_5, local_3_3);
            });
            v1 = await acc;
            acc = y.info(local_0_0, "processor #" + local_3_0 + " returned rc=" + v1 + "", a32);
            if (v1 !== 0) {
              v14 = g771.tailLog(local_3_3);
              acc = p8 + " 安装步骤 " + (local_3_0 + 1) + "/" + local_2_1.length + "（" + g771.shortMain(v18.mainClass) + "）失败 (rc=";
              return new h1286(false, acc + v1 + ")" + (v14.length > 0 ? "\n" + v14 : ""), v13);
            }
            acc = g771.checkOutputs(v14, v4, p3);
            if (acc.length > 0) {
              return new h1286(false, p8 + " 安装步骤 " + (local_3_0 + 1) + " 未产出预期文件: " + acc, v13);
            }
            v13 += 1;
            let local_3_2_0 = local_3_0;
            let local_3_2_1 = local_3_1;
            let local_3_2_2 = local_3_2;
            let local_3_2_3 = local_3_3;
            local_3_2_0 += 1;
          } catch (catchAcc) {
            return new h1286(false, local_2_5 + " 安装步骤 " + (local_3_0 + 1) + " 执行异常: " + catchAcc.message, y.info);
          }
        } catch (catchAcc) {
          return new h1286(false, "processor 解析失败: " + catchAcc.message, local_3_0);
        }
      }
    }
    acc = i50(local_2_5 + "/forge-proc-tmp");
    return new h1286(true, "", v13, v6);
  }
  static shouldRunForClient(p0) {
    let v3;
    if (!p0.sides || p0.sides.length === 0) {
      return true;
    }
    for (v3 of p0.sides) {
      if (v3 === "client") return true;
    }
    return false;
  }
  static resolveDataValue(p0, p1, p2) {
    let v1;
    if (p0.length === 0) {
      return p0;
    }
    if (p0.charAt(0) === "[" && p0.charAt(p0.length - 1) === "]") {
      v1 = d771(p0.substring(1, p0.length - 1));
      if (v1.length > 0) {
        p0 = p2 + "/" + v1;
      }
      return p0;
    }
    if (p0.charAt(0) === "'" && p0.charAt(p0.length - 1) === "'") {
      return p0.substring(1, p0.length - 1);
    }
    if (p0.charAt(0) === "/") {
      return p1 + p0;
    }
    return p0;
  }
  static resolveArg(p0, p1, p2) {
    let v2 /*p1288*/, acc;
    let local_2_0 = p0;
    if (local_2_0.indexOf("{") >= 0) {
      p1.forEach(function (p0, p1) {
        if (local_2_0 /*p1288*/.indexOf("{" + p1 + "}") >= 0) {
          local_2_0 = local_2_0 /*p1288*/.split("{" + p1 + "}").join(p0);
        }
      });
    }
    if (local_2_0.length >= 2 && local_2_0.charAt(0) === "[" && local_2_0.charAt(local_2_0.length - 1) === "]") {
      acc = local_2_0.substring(1, local_2_0.length - 1);
      acc = d771(acc);
      v2 = acc;
      if (acc.length > 0) {
        return p2 + "/" + v2;
      }
    }
    if (local_2_0.length >= 2 && local_2_0.charAt(0) === "'" && local_2_0.charAt(local_2_0.length - 1) === "'") {
      return local_2_0.substring(1, local_2_0.length - 1);
    }
    return local_2_0;
  }
  static async resolveProcessor(p0, p1, p2, p3, p4) {
    let v5, v6, v7, v10, acc;
    let v4 = 0;
    if (!p0.jar || p0.jar.length === 0) {
      return null;
    }
    v5 = d771(p0.jar);
    if (v5.length === v4) {
      return null;
    }
    v5 = p2 + "/" + v5;
    if (!a104(v5)) {
      v5 = "processor jar missing: " + v5 + "";
      y.error(local_0_0, v5, null, a32);
      return null;
    }
    v6 = [];
    if (p0.classpath) {
      for (v10 of p0.classpath) {
        acc = d771(v10);
        v10 = acc;
        if (acc.length !== v4 && (v10 = p2 + "/" + acc, v6.indexOf(p2 + "/" + acc) < v4)) {
          v6.push(v10);
        }
      }
    }
    if (v6.indexOf(v5) < v4) {
      v6.push(v5);
    }
    v6 = v6.join(":");
    v7 = p4.get(v5) || "";
    if (v7.length === v4) {
      v7 = await g771.readJarMainClass(v5, p3);
      if (v7.length === v4) {
        v5 = "cannot read Main-Class from " + v5 + "";
        y.error(local_0_0, v5, null, a32);
        return null;
      }
      p4.set(v5, v7);
    }
    v5 = [];
    if (p0.args) {
      for (v10 of p0.args) {
        v10 = g771.resolveArg(v10, p1, p2);
        v5.push(v10);
      }
    }
    return {
      "mainClass": v7,
      "classpath": v6,
      "args": v5,
      "jarCoord": p0.jar
    };
  }
  static async readJarMainClass(p0, p1) {
    let v3 /*g50*/ = 1;
    let v4 /*g771*/ = p1 + "/mf_" + p0.substring(p0.lastIndexOf("/") + 1).replace(new RegExp("[^A-Za-z0-9._-]", "g"), "_");
    if (!a104(v4 + "/META-INF/MANIFEST.MF")) {
      try {
        g50.mkdirSync(v4, true);
      } catch (catchAcc) {}
      try {
        await v1267(p0, v4);
      } catch (catchAcc) {
        y.warn(local_0_0, "decompress for manifest failed " + p0 + ": " + catchAcc.message + "", null, a32);
        return "";
      }
    }
    try {
      v3 = g50.readTextSync(v4 + "/META-INF/MANIFEST.MF");
    } catch (catchAcc) {
      return "";
    }
    return g771.parseManifestMainClass(v3);
  }
  static parseManifestMainClass(p0) {
    let v2, v3;
    let v1 = p0.split("\n");
    for (v2 = 0; v2 < v1.length; v2 += 1) {
      v3 = v1[v2].replace(new RegExp("\\r$"), "");
      if (v3.indexOf("Main-Class:") === 0) {
        v3 = v3.substring("Main-Class:".length).trim();
        v2 += 1;
        while (v2 < v1.length && v1[v2].length > 0 && v1[v2].charAt(0) === " ") {
          v3 += v1[v2].replace(new RegExp("\\r$"), "").substring(1);
          v2 += 1;
        }
        return v3.trim();
      }
    }
    return "";
  }
  static checkOutputs(p0, p1, p2) {
    let v1, v4;
    if (!p0.outputs) {
      return "";
    }
    v1 = [];
    for (v4 of Object.keys(p0.outputs)) {
      v4 = g771.resolveArg(v4, p1, p2);
      if (!a104(v4)) {
        v1.push(v4);
      }
    }
    return v1.join(", ");
  }
  static shortMain(p0) {
    let v0 = p0.lastIndexOf(".");
    if (v0 >= 0) {
      p0 = p0.substring(v0 + 1);
    }
    return p0;
  }
  static tailLog(p0) {
    let v3 /*g50*/, v4, v5, v6;
    try {
      v3 = g50.readTextSync(p0).split("\n");
      v4 = [];
      v5 = v3.length - 1;
      while (v5 >= 0 && v4.length < 6) {
        v6 = v3[v5].trim();
        if (v6.length !== 0) {
          if (v6.length > 200) {
            v6 = v6.substring(0, 200) + "...";
          }
          v4.unshift(v6);
        }
        v5 -= 1;
      }
      return v4.join("\n");
    } catch (catchAcc) {
      return "";
    }
  }
  static report(p0, p1, p2, p3, p4) {
    if (p0) {
      p0({
        "phase": p1,
        "current": p2,
        "total": p3,
        "message": p4
      });
    }
  }
}