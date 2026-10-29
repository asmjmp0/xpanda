/*
* class name:L&entry/src/main/ets/r5/i8&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import cryptoFramework from "@ohos:security.cryptoFramework";
import { d763 } from "@normalized:N&&&entry/src/main/ets/r5/h8&";
import { e763 } from "@normalized:N&&&entry/src/main/ets/r5/h8&";
import { f763 } from "@normalized:N&&&entry/src/main/ets/r5/h8&";
import g50 from "@ohos:file.fs";
import { h13 } from "@normalized:N&&&commons/Index&1.0.0";
import { h763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { i763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { j763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { k763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { l763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { m763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { n763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { o763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { p763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { q763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { r763 } from "@normalized:N&&&feature_core/Index&1.0.0";
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_10, local_0_11;
let local_0_9 = function (p0) {
  if (!p0) {
    throw new Error("归档结构、条目或摘要与文件计划不一致");
  }
  return;
};
export async function b763(p0, p1, p2, p3) {
  let v0, v4, v14, v16, v17, v18, v21, v30, v46, v49, v50, v51, v58, v59, v60, v61, v62, v63, v64;
  local_0_5(p1);
  if (p3 !== undefined) {
    local_0_6(p3, p3.filesDir.replace(new RegExp("\\/+$"), "") + "/" + p3.workRelative + "/snapshot", p0);
  }
  if (await e763(p3, p1, p2)) {
    return undefined;
  }
  v4 = await local_0_3(p0);
  try {
    v0 = await g50.stat(v4.fd);
    v14 = v0;
    v16 = v0.size;
    l763(v0.size);
    local_0_9(v0.size >= 98);
    v17 = new DataView((await local_0_10(v4.fd, v0.size - 98, 98, p2)).buffer);
    v21 = v17.getUint32(0, true) === 101075792
      && m763(v17, 4) === 44
      && v17.getUint16(12, true) === 45
      && v17.getUint16(14, true) === 45
      && v17.getUint32(16, true) === 0
      && v17.getUint32(20, true) === 0
      && m763(v17, 24) === p1.length
      && m763(v17, 32) === p1.length;
    local_0_9(v21);
    v18 = m763(v17, 40);
    v21 = m763(v17, 48);
    v30 = v21 + v18 === v0.size - 98
      && v17.getUint32(56, true) === 117853008
      && v17.getUint32(60, true) === 0
      && m763(v17, 64) === v0.size - 98
      && v17.getUint32(72, true) === 1
      && v17.getUint32(76, true) === 101010256
      && v17.getUint32(80, true) === 0
      && v17.getUint16(84, true) === 65535
      && v17.getUint16(86, true) === 65535
      && v17.getUint32(88, true) === 4294967295
      && v17.getUint32(92, true) === 4294967295;
    if (v30) {
      v17 = v17.getUint16(96, true);
      v30 = v17 === 0;
    }
    local_0_9(v30);
    v46 = p1[Symbol.iterator]();
    v49 = v21;
    v50 = 0;
    while (true) {
      v51 = v46.next();
      if (v51.done) break;
      v51 = v51.value;
      local_0_0(p2);
      local_0_9(v49 + 46 <= v16 - 98);
      v58 = new DataView((await local_0_10(v4.fd, v49, 46, p2)).buffer);
      v59 = v58.getUint16(28, true);
      v60 = v58.getUint16(30, true);
      v62 = v58.getUint32(0, true) === 33639248
        && v58.getUint16(6, true) === 45
        && v58.getUint16(8, true) === j763
        && v58.getUint16(10, true) === 0
        && v58.getUint32(20, true) === 4294967295
        && v58.getUint32(24, true) === 4294967295
        && v60 === 28
        && v58.getUint16(32, true) === 0
        && v58.getUint16(34, true) === 0;
      if (v62) {
        v62 = v58.getUint32(38, true);
        v62 = v62 === (v51.directory ? 16 : 0);
      }
      if (v62) {
        v62 = v58.getUint32(42, true) === 4294967295;
      }
      if (v62) {
        v62 = v49 + 46 + v59 + v60 <= v16 - 98;
      }
      local_0_9(v62);
      v0 = await local_0_10(v4.fd, v49 + 46, v59, p2);
      local_0_9(local_0_11(v0, h13(k763(v51.archivePath, v51.directory))));
      v62 = new DataView((await local_0_10(v4.fd, v49 + 46 + v59, v60, p2)).buffer);
      v64 = v62.getUint16(0, true) === 1
        && v62.getUint16(2, true) === 24
        && m763(v62, 4) === v51.size
        && m763(v62, 12) === v51.size;
      local_0_9(v64);
      v62 = m763(v62, 20);
      v50 = v62 === v50 && v62 + 50 + v59 + v51.size + 24 <= v21;
      local_0_9(v50);
      v50 = new DataView((await local_0_10(v4.fd, v62, 30, p2)).buffer);
      v64 = v50.getUint32(0, true) === 67324752
        && v50.getUint16(4, true) === 45
        && v50.getUint16(6, true) === j763
        && v50.getUint16(8, true) === 0
        && v50.getUint32(14, true) === 0
        && v50.getUint32(18, true) === 4294967295
        && v50.getUint32(22, true) === 4294967295
        && v50.getUint16(26, true) === v59;
      if (v64) {
        v50 = v50.getUint16(28, true);
        v64 = v50 === 20;
      }
      local_0_9(v64);
      local_0_9(local_0_11(await local_0_10(v4.fd, v62 + 30, v59, p2), v0));
      v50 = new DataView((await local_0_10(v4.fd, v62 + 30 + v59, 20, p2)).buffer);
      v63 = v50.getUint16(0, true) === 1 && v50.getUint16(2, true) === 16 && m763(v50, 4) === v51.size;
      if (v63) {
        v50 = m763(v50, 12);
        v63 = v50 === v51.size;
      }
      local_0_9(v63);
      v50 = v62 + 50 + v59;
      v61 = cryptoFramework.createMd("SHA256");
      v62 = 0;
      for (v63 = 0; v62 < v51.size; v62 += v0.length) {
        v0 = await local_0_10(v4.fd, v50 + v62, Math.min(h763, v51.size - v62), p2);
        v63 = n763(v63, v0);
        await v61.update({
          "data": v0
        });
      }
      v58 = v63 === v58.getUint32(16, true);
      local_0_9(v58);
      v58 = local_0_2((await v61.digest()).data);
      if (!v51.directory) {
        local_0_9(v58 === v51.sha256);
      }
      v51 = new DataView((await local_0_10(v4.fd, v50 + v62, 24, p2)).buffer);
      v61 = v51.getUint32(0, true) === 134695760 && v51.getUint32(4, true) === v63 && m763(v51, 8) === v62;
      if (v61) {
        v51 = m763(v51, 16);
        v61 = v51 === v62;
      }
      local_0_9(v61);
      v50 = v50 + v62 + 24;
      v49 += 46 + v59 + v60;
    }
    v16 = v50 === v21 && v49 === v21 + v18 && local_0_1(v14) === local_0_1(await g50.stat(v4.fd));
    if (v16) {
      v14 = local_0_1(v14);
      v16 = v14 === local_0_1(await g50.stat(p0));
    }
    local_0_9(v16);
    local_0_0(p2);
  } finally {
    await g50.close(v4);
  }
}
export async function c763(p0, p1, p2, p3) {
  let v0, v4 /*g50*/, v5 /*g50*/, v6, v11 /*g50*/, v14 /*g50*/, v15 /*cryptoFramework*/, v16 /*g50*/, v17, v18 /*g50*/, v19 /*g50*/, acc;
  local_0_0(p2);
  v4 = await local_0_3(p0);
  v6 = false;
  try {
    v5 = await g50.stat(v4.fd);
    if (!v5.isFile()) {
      throw new Error("导出归档不是普通文件");
    }
    l763(v5.size);
    v0 = await g50.open(p1, g50.OpenMode.READ_WRITE);
    v14 = v0;
    if ((await g50.stat(v0.fd)).size === 0) {
      v15 = cryptoFramework.createMd("SHA256");
      for (v17 = 0; v17 < v5.size; p3(v17)) {
        local_0_0(p2);
        v6 = new ArrayBuffer(Math.min(h763, v5.size - v17));
        v18 = await g50.read(v4.fd, v6, {
          "length": v6.byteLength
        });
        if (v18 <= 0 || v18 > v6.byteLength) {
          throw new Error("归档复制读取不完整");
        }
        v19 = new Uint8Array(v6, 0, v18);
        v6 = true;
        await local_0_8(v14.fd, v19, p2);
        await v15.update({
          "data": v19
        });
        v17 += v18;
      }
      local_0_0(p2);
      await g50.fsync(v14.fd);
      v0 = await g50.stat(v14.fd);
      v16 = v0.size !== v17;
      if (v0.size === v17) {
        v16 = local_0_1(v5) !== local_0_1(await g50.stat(v4.fd));
      }
      if (v16) {
        throw new Error("复制期间归档或目标大小发生变化");
      }
      if (local_0_1(v5) === local_0_1(await g50.stat(p0))) {
        await g50.close(v14);
        v14 = {
          "size": v17,
          "sha256": null,
          "readbackVerified": false
        };
        v11 = v6;
        v14.sha256 = local_0_2((await v15.digest()).data);
        await g50.close(v4);
      } else {
        throw new Error("复制期间归档或目标大小发生变化");
      }
    } else {
      throw new Error("目标文件已有内容，请另选新文件；未覆盖原文件");
    }
  } catch (catchAcc) {
    acc = new Error(catchAcc.message + (v11 ? "；目标可能留下未完成文件，请在文件管理器删除后重新另存" : ""));
    throw acc;
  }
}
local_0_0 = function (p0) {
  if (p0()) {
    throw new Error("已取消导出");
  }
  return;
};
local_0_2 = function (p0) {
  let v6, acc;
  let v0 = "";
  for (v6 of p0) {
    v6 = v6.toString(16);
    acc = v6.padStart;
    v0 += acc.call(v6, 2, "0");
  }
  return v0;
};
local_0_3 = async function (p0) {
  return g50.open(p0, g50.OpenMode.READ_ONLY | (p0.indexOf("://") < 0 ? g50.OpenMode.NOFOLLOW : 0));
};
local_0_8 = async function (p0, p1, p2) {
  let v0, v4, v5;
  for (v4 = 0; v4 < p1.length; v4 += v0) {
    local_0_0(p2);
    v5 = p1.slice(v4, Math.min(p1.length, v4 + h763));
    v0 = await g50.write(p0, v5.buffer);
    if (v0 <= 0 || v0 > v5.length) {
      throw new Error("归档文件写入不完整");
    }
  }
  return undefined;
};
local_0_10 = async function (p0, p1, p2, p3) {
  let v4 /*l763*/, v5, v6, v7 /*g50*/;
  l763(p1);
  l763(p2);
  v4 = new Uint8Array(p2);
  for (v5 = 0; v5 < p2; v5 += v7) {
    local_0_0(p3);
    v6 = new ArrayBuffer(p2 - v5);
    v7 = await g50.read(p0, v6, {
      "offset": p1 + v5,
      "length": v6.byteLength
    });
    if (v7 <= 0 || v7 > v6.byteLength) {
      throw new Error("归档被截断或读取失败");
    }
    v6 = new Uint8Array(v6, 0, v7);
    v4.set(v6, v5);
  }
  return v4;
};
local_0_11 = function (p0, p1) {
  let v0;
  if (p0.length === p1.length) {
    for (v0 = 0; v0 < p0.length; v0 += 1) {
      if (p0[v0] !== p1[v0]) {
        return false;
      }
    }
    return true;
  }
  return false;
};
local_0_5 = function (p0) {
  let v1, v2 /*i763*/, v6, v7, v8, v9 /*k763*/, v10 /*h13*/;
  if (p0.length === 0 || p0.length > i763) {
    throw new Error("归档条目数必须介于1与200000之间");
  }
  v1 = new Map();
  v2 = 65535;
  for (v7 of p0) {
    v9 = k763(v7.archivePath, v7.directory);
    v10 = (v7.directory ? v9.substring(0, v9.length - 1) : v9).toLowerCase();
    if (v1.has(v10)) {
      throw new Error("归档计划包含重复或大小写冲突路径");
    }
    v1.set(v10, v7.directory);
    l763(v7.size);
    if (h13(v9).length > v2) {
      throw new Error("归档UTF-8路径过长");
    }
    if (v7.directory && v7.size !== 0) {
      throw new Error("空目录不能携带文件字节");
    }
    if (v7.directory) {
      continue;
    }
    if (!new RegExp("^[0-9a-f]{64}$").test(v7.sha256)) throw new Error("归档快照缺少可信SHA256");
  }
  for (v6 of v1.keys()) {
    v6 = v6.split("/");
    v8 = "";
    for (v9 = 0; v9 < v6.length - 1; v9 += 1) {
      v10 = v9 === 0 ? "" : "/";
      v8 += v10 + v6[v9];
      if (v1.get(v8) === false) {
        throw new Error("归档中的文件与目录前缀冲突");
      }
    }
  }
  return;
};
local_0_7 = async function (p0, p1, p2) {
  let v0, v3 /*g50*/, v4 /*k763*/;
  local_0_0(p2);
  v0 = await g50.lstat(p0);
  if (!v0.isDirectory() || v0.isSymbolicLink()) {
    throw new Error("导出快照根目录无效");
  }
  v3 = 0;
  for (v4 = k763(p1.archivePath, p1.directory).split("/").filter(function (p0) {
    return p0.length > 0;
  }); v3 < v4.length; v3 += 1) {
    local_0_0(p2);
    p0 += "/" + v4[v3];
    v0 = await g50.lstat(p0);
    if (v0.isSymbolicLink()) {
      throw new Error("导出快照包含符号链接");
    }
    if (v3 >= v4.length - 1 && !p1.directory) {
      if (!v0.isFile()) {
        throw new Error("导出快照包含特殊文件");
      }
    } else if (!v0.isDirectory()) {
      throw new Error("导出快照目录发生变化");
    }
  }
  return p0;
};
local_0_4 = async function (p0, p1, p2, p3, p4) {
  let v0, v3 /*g50*/, v4, v5 /*cryptoFramework*/, v6 /*cryptoFramework*/, v7 /*g50*/, v8 /*g50*/, v9 /*g50*/;
  if (p3 === undefined) {
    p3 = true;
  }
  if (p4 === undefined) {
    p4 = true;
  }
  if (!p3) {
    if (!p4) {
      throw new Error("文件摘要至少需要一种算法");
    }
  }
  v0 = await g50.stat(p0.fd);
  v3 = v0;
  if (!v0.isFile()) {
    throw new Error("摘要输入不是普通文件");
  }
  l763(v0.size);
  if (p1.indexOf("://") < 0) {
    v0 = await f763(p0.fd, v0.size, p3, p2, p4);
    if (v0 === undefined) {
      v5 = p3 ? cryptoFramework.createMd("SHA1") : undefined;
      v6 = p4 ? cryptoFramework.createMd("SHA256") : undefined;
      for (v7 = 0; v7 < v3.size; v7 += v9) {
        local_0_0(p2);
        v8 = new ArrayBuffer(Math.min(h763, v3.size - v7));
        v9 = await g50.read(p0.fd, v8, {
          "length": v8.byteLength
        });
        if (v9 <= 0 || v9 > v8.byteLength) {
          throw new Error("摘要输入被截断");
        }
        v8 = new Uint8Array(v8, 0, v9);
        if (v5 !== undefined) {
          await v5.update({
            "data": v8
          });
        }
        if (v6 !== undefined) {
          await v6.update({
            "data": v8
          });
        }
      }
      local_0_0(p2);
      if (local_0_1(v3) !== local_0_1(await g50.stat(p0.fd))) {
        throw new Error("摘要读取期间文件发生变化");
      }
      if (local_0_1(v3) === local_0_1(await g50.stat(p1))) {
        v3 = {
          "size": v7,
          "sha1": v5 === undefined ? "" : local_0_2((await v5.digest()).data),
          "sha256": v6 === undefined ? "" : local_0_2((await v6.digest()).data)
        };
        return v3;
      }
      throw new Error("摘要读取期间文件发生变化");
    }
    local_0_0(p2);
    v4 = v0.size !== v3.size;
    if (v0.size === v3.size) {
      v4 = local_0_1(v3) !== local_0_1(await g50.stat(p0.fd));
    }
    if (v4) {
      throw new Error("摘要读取期间文件发生变化");
    }
    if (local_0_1(v3) === local_0_1(await g50.stat(p1))) {
      return v0;
    }
    throw new Error("摘要读取期间文件发生变化");
  }
  v5 = p3 ? cryptoFramework.createMd("SHA1") : undefined;
  v6 = p4 ? cryptoFramework.createMd("SHA256") : undefined;
  for (v7 = 0; v7 < v3.size; v7 += v9) {
    local_0_0(p2);
    v8 = new ArrayBuffer(Math.min(h763, v3.size - v7));
    v9 = await g50.read(p0.fd, v8, {
      "length": v8.byteLength
    });
    if (v9 <= 0 || v9 > v8.byteLength) {
      throw new Error("摘要输入被截断");
    }
    v8 = new Uint8Array(v8, 0, v9);
    if (v5 !== undefined) {
      await v5.update({
        "data": v8
      });
    }
    if (v6 !== undefined) {
      await v6.update({
        "data": v8
      });
    }
  }
  local_0_0(p2);
  if (local_0_1(v3) !== local_0_1(await g50.stat(p0.fd))) {
    throw new Error("摘要读取期间文件发生变化");
  }
  if (local_0_1(v3) === local_0_1(await g50.stat(p1))) {
    return {
      "size": v7,
      "sha1": v5 === undefined ? "" : local_0_2((await v5.digest()).data),
      "sha256": v6 === undefined ? "" : local_0_2((await v6.digest()).data)
    };
  }
  throw new Error("摘要读取期间文件发生变化");
};
local_0_1 = function (p0) {
  return String(p0.ino) + ":" + p0.size + ":" + String(p0.mtimeNs ?? p0.mtime) + ":" + String(p0.ctimeNs ?? p0.ctime);
};
export async function w762(p0, p1) {
  let v3, v7;
  local_0_0(p1);
  v3 = await local_0_3(p0);
  try {
    v7 = await local_0_4(v3, p0, p1);
  } finally {
    await g50.close(v3);
  }
  return v7;
}
export async function x762(p0, p1) {
  let v3, v7;
  local_0_0(p1);
  v3 = await local_0_3(p0);
  try {
    v7 = await local_0_4(v3, p0, p1, true, false);
  } finally {
    await g50.close(v3);
  }
  return v7;
}
local_0_6 = function (p0, p1, p2) {
  let v0 = p0.filesDir.replace(new RegExp("\\/+$"), "") + "/" + p0.workRelative;
  if (p1 !== v0 + "/snapshot" || p2 !== v0 + "/export.zip") {
    throw new Error("Native导出工作路径不一致");
  }
  return;
};
export async function z762(p0, p1, p2, p3, p4, p5) {
  let v0, v4, v5, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v30, v31, v32, v33, v34, v35, v36, v37, v38, v40, v41, v42, v43, v44, v45, v46, v47, v48, v49, v50, v51, v52, v74, v75, v76, v77, v78, v79, v89, acc;
  local_0_5(p2);
  local_0_0(p3);
  if (p5 !== undefined) {
    local_0_6(p5, p0, p1);
  }
  if (await d763(p5, p2, p3, p4)) {
    return undefined;
  }
  if (await g50.access(p1)) {
    throw new Error("临时归档目标已存在，拒绝覆盖");
  }
  v4 = await g50.open(p1, g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.NOFOLLOW);
  v5 = undefined;
  try {
    v14 = [];
    v15 = 24;
    v16 = 0;
    v17 = p2[Symbol.iterator]();
    v18 = v17.next;
    v19 = false;
    v20 = 0;
    v21 = 0;
    v22 = 0;
    label_547: while (true) {
      v23 = v18.call(v17);
      if (v23.done) {
        v15 = v16;
        for (v16 = v20; v15 < p2.length; v15 += 1) {
          v21 = h13(k763(p2[v15].archivePath, p2[v15].directory));
          v22 = p2[v15].size;
          v23 = v14[v15].crc;
          v17 = q763(v21, p2[v15].size, v14[v15].crc, v14[v15].offset, p2[v15].directory);
          v19 = v4.fd;
          await local_0_8(v4.fd, v17, p3);
          v16 += v17.length;
          l763(v16);
        }
        v17 = r763;
        v18 = p2.length;
        v16 = r763(p2.length, v16 - v20, v20);
        await local_0_8(v4.fd, v16, p3);
        local_0_0(p3);
        v15 = g50.fsync;
        v16 = v4.fd;
        v14 = await g50.fsync(v4.fd);
      }
      v23 = v23.value;
      local_0_0(p3);
      v30 = await local_0_7(p0, v23, p3);
      v34 = v23.directory;
      v31 = o763(h13(k763(v23.archivePath, v23.directory)), v23.size);
      await local_0_8(v4.fd, v31, p3);
      v31 = v20 + v31.length;
      acc = !v23.directory;
      if (acc) {
        v32 = await local_0_3(v30);
        v33 = undefined;
        try {
          v0 = await g50.stat(v32.fd);
          v74 = v0;
          if (!v0.isFile() || (v34 = p0, v35 = p2, v36 = p3, v37 = p4, v38 = v4, v40 = v5, v41 = v14, v42 = v31, v43 = v21, v44 = v22, v45 = v19, v0.size !== v23.size)) {
            throw new Error("导出快照大小变化");
          }
          v75 = cryptoFramework.createMd("SHA256");
          v76 = v16;
          for (v77 = v16; v77 < v23.size; p4(v22, v21)) {
            local_0_0(p3);
            v78 = new ArrayBuffer(Math.min(h763, v23.size - v77));
            v79 = await g50.read(v32.fd, v78, {
              "length": v78.byteLength
            });
            if (v79 <= v16 || (acc = !(v79 > v78.byteLength), v34 = p0, v35 = p2, v36 = p3, v37 = p4, v38 = v4, v40 = v5, v41 = v14, v42 = v31, v43 = v21, v44 = v22, v45 = v19, v79 > v78.byteLength)) {
              throw new Error("导出快照读取不完整");
            }
            v78 = new Uint8Array(v78, v16, v79);
            v76 = n763(v76, v78);
            await v75.update({
              "data": v78
            });
            await local_0_8(v4.fd, v78, p3);
            v77 += v79;
            v31 += v79;
            v21 += v79;
            l763(v31);
          }
          v23 = local_0_2((await v75.digest()).data) !== v23.sha256
            || local_0_1(v74) !== local_0_1(await g50.stat(v32.fd));
          if (v23) {
            throw new Error("导出快照在打包期间发生变化");
          }
          v34 = p0;
          v35 = p2;
          v36 = p3;
          v37 = p4;
          v38 = v4;
          v40 = v5;
          v41 = v14;
          v42 = v31;
          v43 = v21;
          v44 = v22;
          v45 = v19;
          v46 = v18;
          v47 = v17;
          v48 = v20;
          v49 = v76;
          v50 = v77;
          v51 = v32;
          v52 = undefined;
          if (local_0_1(v74) !== local_0_1(await g50.stat(v30))) {
            throw new Error("导出快照在打包期间发生变化");
          }
          v30 = v77;
          v23 = v76;
          v89 = v20;
          v20 = v21;
          v21 = v22;
          v22 = v89;
        } catch (catchAcc) {
          p0 = v34;
          p2 = v35;
          p3 = v36;
          p4 = v37;
          v4 = v38;
          v5 = v40;
          v14 = v41;
          v31 = v42;
          v20 = v43;
          v21 = v44;
          v19 = v45;
          v18 = v46;
          v17 = v47;
          v22 = v48;
          v23 = v49;
          v30 = v50;
          v32 = v51;
          v33 = v52;
        }
        if (v33 == undefined) {
          await g50.close(v32);
        }
      } else {
        v23 = v16;
        v30 = v16;
        v89 = v20;
        v20 = v21;
        v21 = v22;
        v22 = v89;
      }
      v30 = p763(v23, v30);
      await local_0_8(v4.fd, v30, p3);
      v14.push({
        "offset": v22,
        "crc": v23
      });
      v21 += 1;
      p4(v21, v20);
      v22 = v21;
      v21 = v20;
      v20 = v31 + v15;
    }
  } finally {
    if (v5 == undefined) {
      await g50.close(v4);
    }
  }
}