/*
* class name:L&commons/src/main/ets/h1/w1&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { a52 } from "@normalized:N&&&commons/src/main/ets/h1/u1&1.0.0";
import { a90 } from "@normalized:N&&&commons/src/main/ets/h1/u1&1.0.0";
import { a92 } from "@normalized:N&&&commons/src/main/ets/h1/r1&1.0.0";
import { b51 } from "@normalized:N&&&commons/src/main/ets/h1/t1&1.0.0";
import { b52 } from "@normalized:N&&&commons/src/main/ets/h1/u1&1.0.0";
import { b92 } from "@normalized:N&&&commons/src/main/ets/h1/r1&1.0.0";
import { e92 } from "@normalized:N&&&commons/src/main/ets/h1/t1&1.0.0";
import { f92 } from "@normalized:N&&&commons/src/main/ets/h1/y1&1.0.0";
import g50 from "@ohos:file.fs";
import { g92 } from "@normalized:N&&&commons/src/main/ets/h1/u1&1.0.0";
import { h50 } from "@normalized:N&&&commons/src/main/ets/h1/m1&1.0.0";
import { h92 } from "@normalized:N&&&commons/src/main/ets/h1/u1&1.0.0";
import { i50 } from "@normalized:N&&&commons/src/main/ets/h1/m1&1.0.0";
import { i92 } from "@normalized:N&&&commons/src/main/ets/h1/z1&1.0.0";
import { j50 } from "@normalized:N&&&commons/src/main/ets/h1/c2&1.0.0";
import { j92 } from "@normalized:N&&&commons/src/main/ets/h1/z1&1.0.0";
import { l50 } from "@normalized:N&&&commons/src/main/ets/h1/c2&1.0.0";
import { n50 } from "@normalized:N&&&commons/src/main/ets/h1/c2&1.0.0";
import { n51 } from "@normalized:N&&&commons/src/main/ets/h1/u1&1.0.0";
import { z51 } from "@normalized:N&&&commons/src/main/ets/h1/u1&1.0.0";
let local_0_0, local_0_1, local_0_2;
export function u91(p0) {
  let v2;
  if (p0.startsWith("system/crash-report-")) {
    return "system/crash-report-evidence-" + b52(p0).substring(0, 16) + ".log";
  }
  if (new RegExp("^(game/logs/(latest\\.log|debug\\.log(?:\\..+)?|[0-9-]+\\.log\\.gz)|game/mc_output\\.log|launcher/launcher[-.a-z0-9]*\\.log|jvm/(jvm-stderr\\.log|hs_err_pid[0-9]+\\.log|gc-amcl\\.log[.0-9]*)|crash-reports/crash-[0-9_:.\\-]+-(client|server)\\.txt|render/(renderer(?:-game)?\\.log|frame-summary\\.log|crash-tail\\.log))$").test(p0)) {
    if (p0.endsWith(".gz")) {
      p0 += ".decompressed.log";
    }
    return p0;
  }
  v2 = p0.split("/")[0];
  if (["game", "launcher", "jvm", "crash-reports", "render", "renderer", "system", "input", "audio", "network", "installer", "agent"].indexOf(v2) < 0) {
    v2 = "other";
  }
  return v2 + "/evidence-" + b52(p0).substring(0, 16) + ".log";
}
local_0_1 = async function (p0, p1, p2) {
  let v0, v11 /*g50*/, v14 /*g50*/, v15, v16, v17, v18 /*j50*/;
  let v3 /*g50*/ = new a90();
  let v5 = "";
  await v3.open(p0, p1);
  h50(p2.substring(0, p2.lastIndexOf("/")));
  v11 = await g50.open(p2, g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
  v14 = false;
  v15 = 0;
  do {
    if (v14) {
      g50.fsyncSync(v11.fd);
      await v3.close();
      if (v11 !== undefined) {
        await g50.close(v11);
      }
      return v15;
    }
    v0 = await v3.read();
    v14 = v0.eof;
    v5 += v0.text;
    v16 = v0.eof ? v5.length : v5.lastIndexOf("\n") + 1;
    if (v16 > 0) {
      v17 = v5.substring(0, v16);
      v18 = j50(v17, n50.LOGSHARE, Number.MAX_SAFE_INTEGER);
      if ((await g50.write(v11.fd, v18)) !== l50(v18)) {
        throw new Error("脱敏快照短写");
      }
      v15 += v17.split("\n").length - 1;
      if (v0.eof) {
        if (!v17.endsWith("\n")) {
          v15 += 1;
        }
      }
      v5 = v5.substring(v16);
    }
  } while (v5.length <= 8 * 1024 * 1024);
  throw new Error("单行日志超过 8 MiB，无法安全预览和脱敏");
};
export async function w91(p0, p1, p2, p3) {
  let v0, v4, v6, v21, v22, v23, v25, v31, v34, v35, v36, v44, v45, v50, v54, acc;
  let v3 = p2.selectedFileIds.slice();
  let v5 = {
    "activityId": p2.activityId,
    "revision": p2.revision,
    "createdAt": Date.now(),
    "directory": "",
    "digest": "",
    "redactionVersion": k92,
    "files": []
  };
  let v7 = local_0_0 + 1;
  local_0_0 += 1;
  v5.directory = p1 + "/amcl-share-" + p2.activityId + "-" + v5.createdAt + "-" + v7;
  v6 = [];
  z51(p0, p2.activityId);
  await f92(p0, p2.activityId);
  v22 = e92(p0, p2.activityId);
  if (b92(v22, v3).length === new Set(v3).size) {
    v3 = v3[Symbol.iterator]();
    v23 = v3.next;
    while (true) {
      v25 = v23.call(v3);
      if (v25.done) break;
      v25 = v25.value;
      {
        let local_1_3_0 = v25;
        v25 = v22.find(function (p0) {
          return p0.fileId === local_1_3_0;
        });
        if (v25 === undefined || v25.uploadPolicy === a92.NEVER) {
          throw new Error("所选证据已消失或不可分享，请刷新文件清单");
        }
        if (!v6.some(function (p0) {
          return p0.record.fileId === local_1_3_0;
        })) {
          v44 = g50.openSync(v25.localPath, g50.OpenMode.READ_ONLY);
          v45 = g50.statSync(v44.fd);
          if (!v45.isFile()) {
            g50.closeSync(v44);
            throw new Error("证据不是普通文件");
          }
          v6.push({
            "record": v25,
            "file": v44,
            "size": v45.size,
            "inode": String(v45.ino)
          });
          continue;
        }
      }
    }
    if (v6.length === 0) {
      throw new Error("请至少选择一份证据文件");
    } else {
      h50(v5.directory);
      let local_1_2_0;
      for (v31 = 0; v31 < v6.length; v31 += 1) {
        acc = g50.open(v5.directory + "/.source-" + v31, g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.TRUNC);
        v34 = await acc;
        try {
          v54 = p2;
          v50 = await g92(v6[v31].file.fd, v6[v31].size, v34.fd);
          g50.fsyncSync(v34.fd);
        } finally {
          await g50.close(v34);
        }
        v0 = await g92(v6[v31].file.fd, v6[v31].size);
        if (v50 !== v0 || String(g50.statSync(v6[v31].record.localPath).ino) !== v6[v31].inode) {
          throw new Error("所选证据正在被改写，请稍后重试");
        }
        local_1_2_0 = u91(v6[v31].record.path);
        if (v5.files.some(function (p0) {
          return p0.name === local_1_2_0;
        })) {
          throw new Error("公开文件名冲突");
        }
        acc = local_0_1(v5.directory + "/.source-" + v31, v6[v31].record.path.endsWith(".gz"), v5.directory + "/" + local_1_2_0);
        v35 = await acc;
        g50.unlinkSync(v5.directory + "/.source-" + v31);
        v0 = await g50.open(v5.directory + "/" + local_1_2_0, g50.OpenMode.READ_ONLY);
        v36 = g50.statSync(v0.fd).size;
        try {
          await g92(v0.fd, v36);
          v50 = v5.directory + "/" + local_1_2_0;
          v54 = "";
        } finally {
          await g50.close(v0);
        }
        acc = {
          "name": local_1_2_0,
          "path": v5.directory + "/" + local_1_2_0,
          "role": v6[v31].record.role,
          "bytes": v36,
          "sourceBytes": v6[v31].size,
          "digest": v54,
          "lines": v35,
          "state": v6[v31].record.state,
          "rawSha256": v6[v31].record.rawSha256,
          "captureMode": v6[v31].record.captureMode,
          "verification": v6[v31].record.verification,
          "reason": j50(v6[v31].record.reason, n50.LOGSHARE, 1024)
        };
        v5.files.push(acc);
        let local_1_4_0 = local_1_2_0;
      }
      if (p2.includePublicSummary && p3.length > 0) {
        v21 = j50(p3, n50.LOGSHARE, Number.MAX_SAFE_INTEGER);
        h50(v5.directory + "/_amcl");
        n51(v5.directory + "/" + "_amcl/session-info.txt", v21);
        acc = {
          "name": "_amcl/session-info.txt",
          "path": v5.directory + "/" + "_amcl/session-info.txt",
          "role": "public-summary",
          "bytes": l50(v21),
          "sourceBytes": l50(v21),
          "digest": b52(v21),
          "lines": v21.split("\n").length,
          "state": "complete"
        };
        v5.files.push(acc);
      }
      v21 = i92(p0, p2.activityId);
      if (p2.includePublicSummary) {
        local_0_2(v5, "_amcl/environment.json", j50(JSON.stringify(v21, null, 2), n50.LOGSHARE, Number.MAX_SAFE_INTEGER));
      }
      v23 = b51(p0, p2.activityId);
      acc = v22.filter(function (p0) {
        return p0.state === "partial" || p0.state === "unavailable" || p0.state === "missing";
      });
      v23 = "AMCL_DIAGNOSIS_V2\nlauncher=AMCL\nactivityId=" + p2.activityId + "\nThis is diagnostic context, not the complete game log. Full selected files are attached to this same log ID.\n" + "游戏结局与日志完整性是独立事实；缺少文件不代表没有异常。\n" + "captureIntegrity=" + (v23?.integrityState ?? "unknown") + "\nselectedFiles=" + v5.files.length + "\nuploadCoverage=selected-files\n";
      v4 = (p2.includePublicSummary ? v23 + (j92(v21) + "\n" + j50(p3, n50.LOGSHARE, 1536) + "\n") : v23 + "environment=omitted by user; do not infer unrecorded platform or hardware\n") + "Read _amcl/evidence-manifest.json for file names, source status and omitted/partial ranges.\n";
      for (v25 of acc.slice(0, 8)) {
        v25 = "captureGap=" + v25.path + ": " + v25.reason.substring(0, 100);
        v4 += v25 + "\n";
      }
      for (v23 of v5.files.slice(0, 12)) {
        v23 = "file=" + v23.name + " (" + v23.bytes + " bytes, " + v23.state;
        v4 += v23 + ")\n";
      }
      v4 = j50(v4, n50.LOGSHARE, 11000);
      local_0_2(v5, m92, v4);
      x89(v5);
      for (v23 of v6) {
        g50.closeSync(v23.file);
      }
      a52(p0, p2.activityId);
      return v5;
    }
  }
  throw new Error("所选证据已消失或不属于本次启动，请刷新文件清单");
}
export function x89(p0) {
  let v0;
  p0.digest = b52(l92 + "\n" + k92 + "\n" + p0.files.map(function (p0) {
    return p0.name + ":" + p0.digest;
  }).join("\n"));
  v0 = {
    "schema": 1,
    "activityId": p0.activityId,
    "createdAt": p0.createdAt,
    "digest": p0.digest,
    "redactionVersion": p0.redactionVersion,
    "files": p0.files.map(function (p0) {
      return {
        "name": p0.name,
        "role": p0.role,
        "bytes": p0.bytes,
        "sourceBytes": p0.sourceBytes,
        "sha256": p0.digest,
        "lines": p0.lines,
        "state": p0.state,
        "reason": p0.reason ?? "",
        "rawSha256": p0.rawSha256 ?? "",
        "captureMode": p0.captureMode ?? "legacy",
        "verification": p0.verification ?? "unverified"
      };
    })
  };
  v0 = JSON.stringify(v0, null, 2);
  h50(p0.directory + "/_amcl");
  n51(p0.directory + "/" + "_amcl/evidence-manifest.json", v0);
  p0.files.push({
    "name": "_amcl/evidence-manifest.json",
    "path": p0.directory + "/" + "_amcl/evidence-manifest.json",
    "role": "public-summary",
    "bytes": l50(v0),
    "sourceBytes": l50(v0),
    "digest": b52(v0),
    "lines": v0.split("\n").length,
    "state": "complete"
  });
}
local_0_2 = function (p0, p1, p2) {
  h50(p0.directory + "/_amcl");
  n51(p0.directory + "/" + p1, p2);
  p0.files.push({
    "name": p1,
    "path": p0.directory + "/" + p1,
    "role": "public-summary",
    "bytes": l50(p2),
    "sourceBytes": l50(p2),
    "digest": b52(p2),
    "lines": p2.split("\n").length,
    "state": "complete",
    "captureMode": "derived",
    "verification": "snapshot-verified"
  });
};
export async function y91(p0, p1, p2) {
  let v0, v8;
  let v3 = 0;
  let v4 = p0.files[Symbol.iterator]();
  let v7 = 0;
  while (true) {
    v8 = v4.next();
    if (v8.done) break;
    v8 = v8.value;
    v3 += v8.bytes;
    v7 += v8.lines;
  }
  if (v3 > p1 || v7 > p2) {
    throw new Error("所选日志超过服务限额，请减少所选文件或导出完整 ZIP");
  }
  v3 = [];
  for (v8 of p0.files) {
    v0 = await h92(v8.path, false, Math.max(v8.bytes, 1));
    if (v0) {
      throw v0;
    }
    if (!v0.eof || b52(v0.text) !== v8.digest) {
      throw new Error("冻结快照校验失败");
    }
    v3.push({
      "name": v8.name,
      "content": v0.text
    });
  }
  return v3;
}
export function z91(p0) {
  i50(p0.directory);
}
export const k92 = "game-v3";
export const l92 = "session-diagnosis-v2";
export const m92 = "_amcl/diagnosis.txt";
local_0_0 = 0;