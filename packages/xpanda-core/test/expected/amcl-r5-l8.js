/*
* class name:L&entry/src/main/ets/r5/l8&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import g50 from "@ohos:file.fs";
import { i13 } from "@normalized:N&&&commons/Index&1.0.0";
import { n763 } from "@normalized:N&&&feature_core/Index&1.0.0";
import util from "@ohos:util";
import zlib from "@ohos:zlib";
let local_0_2, local_0_3, local_0_5, local_0_6, local_0_10, local_0_13, local_0_14, local_0_15, local_0_16, local_0_17;
let local_0_1 = function (p0) {
  if (p0()) {
    throw new Error("已取消生成 JAR 校验");
  }
  return;
};
let local_0_0 = function (p0, p1) {
  if (!p0) {
    throw new Error("生成 JAR 无效：" + p1);
  }
  return;
};
let local_0_12 = function (p0) {
  return String(p0.ino) + ":" + p0.size + ":" + String(p0.mtimeNs ?? p0.mtime) + ":" + String(p0.ctimeNs ?? p0.ctime);
};
let local_0_4 = async function (p0, p1, p2, p3) {
  let v3, v4, v6, v7 /*g50*/;
  local_0_0(Number.isSafeInteger(p1) && p1 >= 0 && Number.isSafeInteger(p2) && p2 >= 0 && p2 <= 65536, "元数据读取越界");
  v3 = new Uint8Array(p2);
  for (v4 = 0; v4 < p2; v4 += v7) {
    local_0_1(p3);
    v6 = new ArrayBuffer(p2 - v4);
    v7 = await g50.read(p0, v6, {
      "offset": p1 + v4,
      "length": v6.byteLength
    });
    local_0_0(v7 > 0 && v7 <= v6.byteLength, "归档被截断");
    v6 = new Uint8Array(v6, 0, v7);
    v3.set(v6, v4);
  }
  return v3;
};
let local_0_11 = function (p0, p1) {
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
let local_0_7 = function (p0, p1) {
  let v22, v23, v24, v25, v26, acc;
  for (v22 = 0; v22 < p0.length; v22 += 1) {
    if (p0[v22] >= 128) {
      local_0_0(p1, "非ASCII名称缺少UTF-8标记");
      if (p0[v22] >= 194 && p0[v22] <= 223) {
        v23 = p0[v22] & 31;
        v24 = 1;
        v25 = 128;
      } else if (p0[v22] >= 224 && p0[v22] <= 239) {
        v23 = p0[v22] & 15;
        v24 = 2;
        v25 = 2048;
      } else {
        if (p0[v22] < 240 || p0[v22] > 244) {
          throw new Error("生成 JAR 无效：文件名不是规范UTF-8");
        }
        v23 = p0[v22] & 7;
        v24 = 3;
        v25 = 65536;
      }
      local_0_0(v22 + v24 < p0.length, "UTF-8名称被截断");
      for (v26 = 0; v26 < v24; v26 += 1) {
        acc = v22 + 1;
        v22 += 1;
        acc = p0[acc];
        local_0_0((acc & 192) === 128, "UTF-8名称含非法延续字节");
        v23 = v23 * 64 + (acc & 63);
      }
      v25 = v23 >= v25 && v23 <= 1114111;
      if (v25 && (v25 = v23 < 55296, v23 >= 55296)) {
        v25 = v23 > 57343;
      }
      local_0_0(v25, "文件名不是规范UTF-8");
    }
  }
  return i13(p0);
};
let local_0_8 = function (p0, p1) {
  let v2, v4;
  if (p1) {
    p0 = p0.substring(0, p0.length - 1);
  }
  v2 = p0.length > 0
    && p0.length <= 4096
    && !p0.startsWith("/")
    && !new RegExp("[\\\\:\\u0000-\\u001f\\u007f]").test(p0);
  local_0_0(v2, "条目名称不安全");
  for (v4 of p0.split("/")) {
    local_0_0(v4.length > 0 && v4 !== "." && v4 !== "..", "条目路径越界");
  }
  return p0;
};
let local_0_9 = function (p0) {
  let v5, v6, v7;
  let v4 = 0;
  for (v5 = new DataView(p0.buffer, p0.byteOffset, p0.byteLength); v4 < p0.length; v4 += 4 + v7) {
    local_0_0(v4 + 4 <= p0.length, "ZIP扩展字段被截断");
    v6 = v5.getUint16(v4, true);
    v7 = v5.getUint16(v4 + 2, true);
    local_0_0(v6 !== 1, "生成JAR暂不支持ZIP64");
    local_0_0(v6 !== 28789, "不支持第二套Unicode替代文件名");
    local_0_0(v4 + 4 + v7 <= p0.length, "ZIP扩展字段越界");
  }
};
local_0_15 = async function (p0, p1) {
  let v16, v17 /*s776*/, v21 /*w776*/, v22, v23, v26, v27, v28, v29, v31, v33, v34, v36, v37, v38, v46, v47, v48, v49, v50, v51, v52, v53, v54, v55, v56, v57, v58, v59 /*s776*/, v60, v61, v62 /*t776*/, v64, acc;
  let v4 /*g50*/ = await g50.open(p0, g50.OpenMode.READ_ONLY | g50.OpenMode.NOFOLLOW);
  let v0 /*g50*/ = await g50.stat(v4.fd);
  let v14 /*g50*/ = v0.size;
  local_0_0(v0.size >= 22 && v0.size <= local_0_2, "JAR大小超出限制");
  v16 = Math.min(v0.size, local_0_3);
  v0 = await local_0_4(v4.fd, v0.size - v16, v16, p1);
  v17 = new DataView(v0.buffer);
  v21 = -1;
  for (v22 = v16 - 22; v22 >= 0; v22 -= 1) {
    v23 = v17.getUint32(v22, true);
    if (v23 === 101010256) {
      acc = v17.getUint16(v22 + 20, true);
      if (v22 + 22 + acc === v16) {
        v21 = v22;
        break;
      }
    }
  }
  local_0_0(v21 >= 0, "未找到完整中央目录尾");
  v26 = v17.getUint16(v21 + 10, true);
  v27 = v17.getUint32(v21 + 12, true);
  v28 = v17.getUint32(v21 + 16, true);
  v14 = v14 - v16 + v21;
  v29 = v17.getUint16(v21 + 4, true) === 0 && v17.getUint16(v21 + 6, true) === 0;
  if (v29) {
    v17 = v17.getUint16(v21 + 8, true);
    v29 = v17 === v26;
  }
  local_0_0(v29, "不支持多磁盘JAR");
  local_0_0(v26 !== 65535 && v27 !== 4294967295 && v28 !== 4294967295, "生成JAR暂不支持ZIP64");
  local_0_0(v26 > 0 && v26 <= 60000 && v27 <= local_0_5 && v28 + v27 === v14, "中央目录数量、尺寸或范围异常");
  v16 = [];
  v21 = new Map();
  v46 = v28;
  v47 = 0;
  for (v48 = 0; v48 < v26; v48 += 1) {
    local_0_0(v46 + 46 <= v14, "中央目录被截断");
    v49 = new DataView((await local_0_4(v4.fd, v46, 46, p1)).buffer);
    local_0_0(v49.getUint32(0, true) === 33639248, "中央目录签名错误");
    v50 = v49.getUint16(28, true);
    v51 = v49.getUint16(30, true);
    v52 = v49.getUint16(32, true);
    v53 = v49.getUint16(8, true);
    v54 = v49.getUint16(10, true);
    v55 = v49.getUint32(42, true);
    v56 = v49.getUint32(20, true);
    v57 = v49.getUint32(24, true);
    v59 = (v53 & ~2062) === 0;
    if ((v53 & ~2062) === 0) {
      v59 = v54 === 0;
      if (v54 !== 0) {
        v59 = v54 === 8;
      }
    }
    local_0_0(v59, "不支持加密、压缩方法或ZIP标记");
    v59 = v49.getUint16(34, true) === 0 && v50 > 0 && v50 <= 4096 && v51 <= 16384 && v46 + 46 + v50 + v51 + v52 <= v14;
    local_0_0(v59, "中央目录条目越界");
    local_0_0(v56 !== 4294967295 && v57 !== 4294967295 && v55 !== 4294967295, "生成JAR暂不支持ZIP64");
    v59 = v57 <= local_0_6 && v56 <= local_0_2;
    if (v57 <= local_0_6 && v56 <= local_0_2) {
      v59 = v56 > 0;
      if (v56 <= 0) {
        v59 = v57 === 0;
      }
    }
    if (v59) {
      v59 = v57 <= 65536;
      if (v57 > 65536) {
        v59 = v57 <= v56 * 1024;
      }
    }
    local_0_0(v59, "条目大小或膨胀比例超限");
    if (v54 === 0) {
      local_0_0(v56 === v57, "STORE条目长度不一致");
    }
    v58 = v49.getUint32(38, true) >>> 16 & 61440;
    local_0_0(v58 === 0 || v58 === 32768 || v58 === 16384, "JAR含链接或特殊文件");
    v0 = await local_0_4(v4.fd, v46 + 46, v50, p1);
    v60 = local_0_7(v0, (v53 & 2048) !== 0);
    v61 = v60.endsWith("/");
    v62 = local_0_8(v60, v61);
    v64 = !v21.has(v62);
    local_0_0(v64, "JAR含重复条目");
    v21.set(v62, v61);
    v58 = v58 !== 16384 || v61;
    if (v58) {
      v58 = !v61 || v57 === 0;
    }
    local_0_0(v58, "目录属性或长度异常");
    local_0_9(await local_0_4(v4.fd, v46 + 46 + v50, v51, p1));
    v47 += v57;
    local_0_0(v47 <= local_0_10, "JAR展开总大小超限");
    acc = {
      "name": v60,
      "nameBytes": v0,
      "directory": v61,
      "method": v54,
      "flags": v53,
      "crc": v49.getUint32(16, true),
      "compressed": v56,
      "size": v57,
      "localOffset": v55
    };
    v16.push(acc);
    v46 += 46 + v50 + v51 + v52;
  }
  local_0_0(v46 === v14, "中央目录长度不匹配");
  for (v23 of v21.keys()) {
    v23 = v23.split("/");
    v26 = "";
    for (v27 = 0; v27 < v23.length - 1; v27 += 1) {
      v29 = v27 === 0 ? "" : "/";
      v26 += v29 + v23[v27];
      local_0_0(v21.get(v26) !== false, "文件与目录路径冲突");
    }
  }
  v29 = 0;
  for (v31 of v16.slice().sort(function (p0, p1) {
    return p0.localOffset - p1.localOffset;
  })) {
    local_0_0(v31.localOffset === v29 && v29 + 30 <= v28, "local条目重叠或含隐藏载荷");
    v33 = new DataView((await local_0_4(v4.fd, v29, 30, p1)).buffer);
    v34 = v33.getUint16(26, true);
    v36 = v33.getUint16(28, true);
    v38 = v33.getUint32(0, true) === 67324752
      && v33.getUint16(6, true) === v31.flags
      && v33.getUint16(8, true) === v31.method
      && v34 === v31.nameBytes.length
      && v36 <= 16384;
    local_0_0(v38, "local与中央目录不一致");
    v37 = v29 + 30 + v34 + v36 + v31.compressed;
    local_0_0(v29 + 30 + v34 + v36 + v31.compressed <= v28, "条目数据越界");
    local_0_0(local_0_11(v31.nameBytes, await local_0_4(v4.fd, v29 + 30, v34, p1)), "local文件名不同");
    v29 = v29 + 30 + v34;
    local_0_9(await local_0_4(v4.fd, v29, v36, p1));
    if ((v31.flags & 8) === 0) {
      v34 = v33.getUint32(14, true) === v31.crc && v33.getUint32(18, true) === v31.compressed;
      if (v34) {
        v33 = v33.getUint32(22, true);
        v34 = v33 === v31.size;
      }
      local_0_0(v34, "local校验字段不一致");
      v29 = v37;
    } else {
      v34 = v33.getUint32(14, true) === 0 || v33.getUint32(14, true) === v31.crc;
      if (v34) {
        acc = v33.getUint32(18, true);
        v34 = acc;
        acc = acc === 0;
        v34 = v34 === 0;
        if (!acc) {
          v33.getUint32(18, true) === v31.compressed;
          v34 = v33.getUint32(18, true) === v31.compressed;
        }
      }
      if (v34) {
        acc = v33.getUint32(22, true);
        v34 = acc;
        acc = acc === 0;
        v34 = v34 === 0;
        if (!acc) {
          v33 = v33.getUint32(22, true);
          v34 = v33 === v31.size;
        }
      }
      local_0_0(v34, "local描述符前置字段不一致");
      local_0_0(v37 + 12 <= v28, "数据描述符被截断");
      v29 = new DataView((await local_0_4(v4.fd, v37, 4, p1)).buffer).getUint32(0, true) === 134695760 ? 4 : 0;
      v29 = v37 + v29;
      local_0_0(v29 + 12 <= v28, "数据描述符越界");
      v33 = new DataView((await local_0_4(v4.fd, v29, 12, p1)).buffer);
      v36 = v33.getUint32(0, true) === v31.crc && v33.getUint32(4, true) === v31.compressed;
      if (v36) {
        v33 = v33.getUint32(8, true);
        v36 = v33 === v31.size;
      }
      local_0_0(v36, "数据描述符不一致");
      v29 += 12;
    }
  }
  local_0_0(v29 === v28, "中央目录前含额外数据");
  await g50.close(v4);
  return v16;
};
local_0_14 = async function (p0, p1, p2) {
  let v11 /*g50*/, v13 /*g50*/, v14 /*g50*/, v15 /*g50*/, v16;
  let v4 /*g50*/ = await g50.open(p0, g50.OpenMode.READ_ONLY | g50.OpenMode.NOFOLLOW);
  let v0 = await g50.stat(v4.fd);
  let v5 /*g50*/ = v0;
  local_0_0(v0.isFile() && v0.size >= 22 && v0.size <= local_0_2, "源JAR不是受支持的普通文件");
  v11 = await g50.open(p1, g50.OpenMode.CREATE | g50.OpenMode.WRITE_ONLY | g50.OpenMode.NOFOLLOW);
  for (v13 = 0; v13 < v5.size; v13 += v15) {
    local_0_1(p2);
    v14 = new ArrayBuffer(Math.min(local_0_3, v5.size - v13));
    v0 = await g50.read(v4.fd, v14, {
      "length": v14.byteLength
    });
    v15 = v0;
    local_0_0(v0 > 0 && v0 <= v14.byteLength, "源JAR被截断");
    for (v16 = 0; v16 < v15; v16 += v0) {
      local_0_1(p2);
      v0 = await g50.write(v11.fd, v14.slice(v16, v15));
      local_0_0(v0 > 0 && v0 <= v15 - v16, "JAR工作副本短写");
    }
  }
  v13 = local_0_12(v5) === local_0_12(await g50.stat(v4.fd));
  if (v13) {
    v5 = local_0_12(v5);
    v13 = v5 === local_0_12(await g50.stat(p0));
  }
  local_0_0(v13, "复制期间源JAR变化");
  await g50.fsync(v11.fd);
  try {
    if (v11 !== undefined) {
      await g50.close(v11);
    }
  } finally {
    await g50.close(v4);
  }
};
local_0_13 = async function (p0) {
  let v8, v11;
  let v0 = await g50.lstat(p0);
  if (!v0.isSymbolicLink()) {
    if (!v0.isDirectory()) {
      await g50.unlink(p0);
      return undefined;
    }
    for (v8 of await g50.listFile(p0)) {
      v11 = v8.length > 0 && v8 !== "." && v8 !== ".." && !new RegExp("[\\\\/\\u0000]").test(v8);
      local_0_0(v11, "临时目录名称异常");
      await local_0_13(p0 + "/" + v8);
    }
    await g50.rmdir(p0);
    return undefined;
  }
  await g50.unlink(p0);
  return undefined;
};
local_0_16 = async function (p0, p1) {
  let v0, v4, v5 /*g50*/, v7;
  let v3 = 0;
  for (v4 = local_0_8(p1.name, p1.directory).split("/"); v3 < v4.length; v3 += 1) {
    p0 += "/" + v4[v3];
    v0 = await g50.lstat(p0);
    v7 = !v0.isSymbolicLink();
    local_0_0(v7, "解压输出包含链接");
    v5 = v3 < v4.length - 1 || p1.directory ? v0.isDirectory() : v0.isFile();
    local_0_0(v5, "解压输出类型不同");
  }
  return p0;
};
local_0_17 = async function (p0, p1, p2, p3, p4, p5) {
  let v0, v3, v4, v8, v9, v15, v18, v19, v25, v37, v49, v50, v51, v52, v53, acc;
  local_0_1(p4);
  v4 = p1.startsWith("/") && !p1.split("/").some(function (p0) {
    return p0 === "." || p0 === "..";
  });
  local_0_0(v4, "校验临时目录不安全");
  v3 = false;
  try {
    v0 = await g50.lstat(p1);
    v8 = v0.isDirectory() && !v0.isSymbolicLink();
    local_0_0(v8, "校验父目录不是普通目录");
    v3 = true;
  } catch (catchAcc) {
    if (catchAcc.code !== 13900002) {
      throw catchAcc;
    }
  }
  if (!v3) {
    await g50.mkdir(p1, true);
  }
  v3 = p1 + "/jar-" + util.generateRandomUUID();
  await g50.mkdir(v3);
  await local_0_14(p0, v3 + "/input.zip", p4);
  v0 = await local_0_15(v3 + "/input.zip", p4);
  for (v19 of p2) {
    let local_1_3_0 = v19;
    local_0_8(local_1_3_0, false);
    acc = v0.some(function (p0) {
      return !p0.directory && p0.name === local_1_3_0 && p0.size > 0;
    });
    local_0_0(acc, "缺少必需条目 " + local_1_3_0);
  }
  for (v19 of p3) {
    let local_1_4_0 = local_0_8(v19.endsWith("/") ? v19 : v19 + "/", true) + "/";
    acc = v0.some(function (p0) {
      return !p0.directory && p0.name.startsWith(local_1_4_0) && p0.size > 0;
    });
    local_0_0(acc, "缺少必需资源前缀 " + v19);
  }
  local_0_1(p4);
  if (p5 == null) {
    p5 = v3 + "/contents";
  }
  await g50.mkdir(p5);
  await zlib.decompressFile(v3 + "/input.zip", p5);
  local_0_1(p4);
  v15 = v0[Symbol.iterator]();
  acc = false;
  do {
    v18 = v15.next();
    if (v18.done) {
      local_0_1(p4);
      await local_0_13(v3);
      if (hole == v9) {
        return undefined;
      }
      throw v9;
    }
    v18 = v18.value;
    local_0_1(p4);
    v0 = await local_0_16(p5, v18);
    acc = !v18.directory;
    if (v18.directory) {
      continue;
    }
    v25 = await g50.open(v0, g50.OpenMode.READ_ONLY | g50.OpenMode.NOFOLLOW);
    v0 = await g50.stat(v25.fd);
    v49 = v0;
    local_0_0(v0.size === v18.size, "解压条目长度不同");
    v50 = 0;
    for (v51 = 0; v50 < v18.size; v50 += v53) {
      local_0_1(p4);
      v52 = new ArrayBuffer(Math.min(local_0_3, v18.size - v50));
      v53 = await g50.read(v25.fd, v52, {
        "length": v52.byteLength
      });
      local_0_0(v53 > 0 && v53 <= v52.byteLength, "解压条目被截断");
      v52 = new Uint8Array(v52, 0, v53);
      v51 = n763(v51, v52);
    }
    v18 = v51 === v18.crc && local_0_12(v49) === local_0_12(await g50.stat(v25.fd));
    local_0_0(v18, "解压条目CRC或身份不符");
    v37 = hole;
    await g50.close(v25);
    acc = hole != hole;
  } while (!acc);
  throw v37;
};
export async function s771(p0, p1, p2, p3, p4) {
  await local_0_17(p0, p1, p2, p3, p4);
  return undefined;
}
export async function t771(p0, p1, p2, p3, p4) {
  let v3, v4;
  local_0_1(p4);
  v4 = p1.startsWith("/") && !p1.endsWith("/") && p1.lastIndexOf("/") > 0 && !p1.split("/").some(function (p0) {
    return p0 === "." || p0 === "..";
  });
  local_0_0(v4, "解压目标不安全");
  v3 = false;
  try {
    await g50.lstat(p1);
    v3 = true;
  } catch (catchAcc) {
    if (catchAcc.code !== 13900002) {
      throw catchAcc;
    }
  }
  v3 = !v3;
  local_0_0(v3, "解压目标已存在，拒绝接管");
  await local_0_17(p0, p1.substring(0, p1.lastIndexOf("/")), p2, p3, p4, p1);
  return undefined;
}
local_0_3 = 65536;
local_0_2 = 1024 * 1024 * 1024;
local_0_10 = 2 * 1024 * 1024 * 1024;
local_0_6 = 512 * 1024 * 1024;
local_0_5 = 32 * 1024 * 1024;