/*
* class name:Lcom.example.nga_oh/entry/ets/common/media/VideoSizeUtil;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { ImageSize } from "@bundle:com.example.nga_oh/entry/ets/common/media/ImageSizeUtil";
import { LruCache } from "@bundle:com.example.nga_oh/entry/ets/common/cache/LruCache";
import { RequestQueue } from "@bundle:com.example.nga_oh/entry/ets/common/concurrency/RequestQueue";
import media from "@ohos:multimedia.media";
let local_0_0, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6;
let local_0_1 = function (p0, p1) {
  let v0;
  if (p1 === 90 || p1 === 270) {
    v0 = p0.width;
    p0.width = p0.height;
    p0.height = v0;
  }
  return p0;
};
local_0_4 = async function (p0) {
  let v0 /*queue*/, v9 /*extractor*/, v11, v12, v13 /*ImageSize*/, acc;
  let local_1_0 = null;
  try {
    local_1_0 = await media.createAVMetadataExtractor();
    local_1_0 /*extractor*/.setUrlSource(p0);
    acc = new Promise(function (p0, p1) {
      let local_2_2 = p0;
      let local_2_0 = p1;
      let local_2_1 = setTimeout(function () {
        local_2_0(new Error("获取视频元数据超时"));
      }, local_0_0);
      local_1_0.fetchMetadata().then(function (p0) {
        clearTimeout(local_2_1);
        local_2_2(p0);
      }, function (p0) {
        clearTimeout(local_2_1);
        local_2_0(p0);
      });
    });
    v0 = await acc;
    v9 = 0;
    v11 = Number(v0.videoWidth) || 0;
    v12 = Number(v0.videoHeight) || 0;
    if (v11 > 0 && v12 > 0) {
      v13 = new ImageSize();
      v13.width = v11;
      v13.height = v12;
      acc = Number(v0.videoOrientation);
      if (acc) {
        v9 = acc;
      }
      local_0_1(v13, v9);
      local_0_2.set(p0, v13);
      if (local_1_0 /*extractor*/) {
        try {
          local_1_0 /*extractor*/.release();
        } catch (catchAcc) {}
      }
      local_0_3.done();
      return v13;
    }
    if (local_1_0 /*extractor*/) {
      try {
        local_1_0 /*extractor*/.release();
      } catch (catchAcc) {}
    }
    local_0_3.done();
    return null;
  } catch (catchAcc) {
    if (local_1_0 /*extractor*/) {
      try {
        local_1_0 /*extractor*/.release();
      } catch (catchAcc) {}
    }
    local_0_3.done();
    return null;
  }
};
export async function fetchVideoSize(p0) {
  let v0;
  let v2 /*pending*/ = getCachedVideoSize(p0);
  if (v2) {
    return v2;
  }
  v2 = local_0_5.get(p0);
  if (v2) {
    return v2;
  }
  v2 = local_0_6(p0);
  local_0_5.set(p0, v2);
  v0 = await v2;
  local_0_5.delete(p0);
  return v0;
}
export function getCachedVideoSize(p0) {
  let v0 /*cache*/ = local_0_2.get(p0);
  return v0 || null;
}
local_0_6 = function (p0) {
  let local_1_0 = p0;
  return new Promise(function (p0) {
    let local_2_0 = p0;
    local_0_3.schedule(function () {
      local_0_4(local_1_0).then(function (p0) {
        local_2_0(p0);
      }, function () {
        local_2_0(null);
      });
    });
  });
};
local_0_2 = new LruCache(100);
local_0_5 = new Map();
local_0_0 = 15000;
local_0_3 = new RequestQueue(4);