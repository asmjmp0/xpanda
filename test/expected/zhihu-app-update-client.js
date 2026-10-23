/*
* class name:L&data/src/main/ets/update/AppUpdateClient&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AppReleaseDetailStatus } from "@normalized:N&&&data/src/main/ets/update/AppUpdateModels&1.0.0";
import { decodeLatestRelease } from "@normalized:N&&&data/src/main/ets/update/AppUpdateParser&1.0.0";
import { decodeLatestReleaseAtom } from "@normalized:N&&&data/src/main/ets/update/AppUpdateParser&1.0.0";
import { decodeReleaseDetail } from "@normalized:N&&&data/src/main/ets/update/AppUpdateParser&1.0.0";
import http from "@ohos:net.http";
import { proxiedCatalogUrls } from "@normalized:N&&&data/src/main/ets/update/AppUpdateSources&1.0.0";
import { resolveAppUpdateCheck } from "@normalized:N&&&data/src/main/ets/update/AppUpdateParser&1.0.0";
let AppUpdateClient, GITHUB_RELEASES_ATOM, catalogUrlWaves;
let acc;
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6;
catalogUrlWaves = function (p0) {
  let v0, v1;
  v0 = local_0_2(p0);
  v1 = [v0];
  v0 = v0[0];
  v1[1] = proxiedCatalogUrls(v0);
  return v1;
};
local_0_6 = function (p0) {
  return {
    "status": AppReleaseDetailStatus.FAILED,
    "detail": undefined,
    "message": p0
  };
};
local_0_2 = function (p0) {
  let v1;
  v1 = Math.floor(Date.now() / local_0_0);
  return ["https://raw.githubusercontent.com/" + local_0_1 + "/main/" + ("assets/update/" + p0 + "") + "?v=" + v1 + "", "https://cdn.jsdelivr.net/gh/" + local_0_1 + "@main/" + ("assets/update/" + p0 + "") + "?v=" + v1 + "", "https://fastly.jsdelivr.net/gh/" + local_0_1 + "@main/" + ("assets/update/" + p0 + "") + "?v=" + v1 + ""];
};
GITHUB_RELEASES_ATOM = "https://github.com/zhuoyi233/zhihu-plus-plus-HMOS/releases.atom";
local_0_3 = 8000;
local_0_4 = 10000;
local_0_0 = 10 * 60 * 1000;
local_0_1 = "zhuoyi233/zhihu-plus-plus-HMOS";
local_0_5 = 4000;
{
  let local_1_0;
  acc = class panda_jmp0_reserved_anonymous_0 {
    constructor() {
      this.requestHandle = http.createHttp();
    }
    async checkLatestRelease(p0, p1) {
      let v0, v3 /*resolveAppUpdateCheck*/, v4 /*resolveAppUpdateCheck*/;
      if (p1 === undefined) {
        p1 = false;
      }
      v4 = decodeLatestRelease(await this.latestCatalog(p1));
      if (v4 === undefined) {
        v0 = await this.requestAtomFallback();
        if (v0 === undefined) {
          v3 = decodeLatestRelease(local_1_0.bundledLatestJson);
          return v3 !== undefined && v3.versionName === p0 ? resolveAppUpdateCheck(p0, v3, "") : resolveAppUpdateCheck(p0, undefined, "检查更新失败：静态更新源与 Releases 备用源均不可用");
        } else {
          v3 = decodeLatestRelease(local_1_0.bundledLatestJson);
          return v3 !== undefined && v3.versionName === v0.versionName ? resolveAppUpdateCheck(p0, v3, "") : resolveAppUpdateCheck(p0, v0, "");
        }
      } else {
        this.enrichSha256FromBundled(v4);
        return resolveAppUpdateCheck(p0, v4, "");
      }
    }
    enrichSha256FromBundled(p0) {
      let v0 /*decodeLatestRelease*/;
      if (p0.assetSha256 !== undefined && p0.assetSha256.length > 0) {
        return;
      } else {
        v0 = decodeLatestRelease(local_1_0.bundledLatestJson);
        if (v0 !== undefined && v0.versionName === p0.versionName && v0.assetSha256 !== undefined) {
          p0.assetSha256 = v0.assetSha256;
        }
        return;
      }
    }
    async requestStatic(p0) {
      let v0, v2 /*http*/, v7;
      v2 = http.createHttp();
      v7 = {
        "method": http.RequestMethod.GET,
        "header": {
          "Accept": "application/json",
          "User-Agent": "zhihu-plus-plus-hmos"
        },
        "expectDataType": http.HttpDataType.STRING,
        "connectTimeout": local_0_3,
        "readTimeout": local_0_4,
        "usingCache": true
      };
      v0 = await v2.request(p0, v7);
      Number(v0.responseCode);
      if (v0 !== 200 || typeof v0.result !== "string") {
        throw new Error("静态源响应码 " + v0.responseCode + "");
      } else {
        v2.destroy();
        return v0.result;
      }
    }
    fetchStatic(p0, p1) {
      let acc;
      let local_2_0, local_2_1, local_2_2;
      local_2_2 = this;
      local_2_1 = p1;
      local_2_0 = catalogUrlWaves(p0);
      acc = new Promise(function (p0, p1) {
        let v3;
        let local_3_0, local_3_1, local_3_2, local_3_3, local_3_4, local_3_5, local_3_6, local_3_7, local_3_8, local_3_9;
        local_3_7 = p0;
        local_3_4 = p1;
        local_3_1 = 0;
        local_3_2 = local_2_0[0].length;
        local_3_5 = 0;
        local_3_0 = false;
        local_3_3 = false;
        local_3_6 = function () {
          let v1 /*total*/;
          if (local_3_0 /*settled*/ || local_3_1 < local_3_2) {
            return;
          } else if (!local_3_3 && local_2_0[1].length > 0) {
            return;
          } else {
            local_3_0 = true;
            v1 = local_3_5 > 0 ? "静态更新数据格式错误" : "静态更新源不可用";
            v1 = new Error(v1);
            local_3_4(v1);
            return;
          }
        };
        local_3_8 = function () {
          local_3_1 += 1;
          local_3_6();
        };
        local_3_9 = function (p0) {
          let acc;
          acc = local_2_2.requestStatic(p0).then(function (p0) {
            if (local_3_0 /*settled*/) {
              return;
            } else if (local_2_1(p0)) {
              local_3_0 = true;
              local_3_7(p0);
              return;
            } else {
              local_3_5 += 1;
              local_3_8();
              return;
            }
          });
          acc.catch(function (p0) {
            local_3_8();
          });
        };
        for (v3 of local_2_0[0]) {
          local_3_9(v3);
        }
        setTimeout(function () {
          let v3;
          if (local_3_0) {
            return;
          } else {
            local_3_2 += local_2_0[1].length;
            local_3_3 = true;
            for (v3 of local_2_0[1]) {
              local_3_9(v3);
            }
            local_3_6();
            return;
          }
        }, local_0_5);
      });
      return acc;
    }
    async latestCatalog(p0) {
      let v0, v2 /*AppUpdateClient*/, acc;
      v2 = !p0 && local_1_0.latestJson.length > 0;
      if (v2 && (acc = Date.now(), !v2 - local_1_0.latestFetchedAt < local_0_0)) {
        return local_1_0.latestJson;
      } else {
        v0 = await this.fetchStatic("version.json", function (p0) {
          return decodeLatestRelease(p0) !== undefined;
        });
        local_1_0.latestJson = v0;
        local_1_0.latestFetchedAt = Date.now();
        return v0;
      }
    }
    async releasesCatalog() {
      let v0, acc;
      if (local_1_0.releasesJson.length > 0 && (acc = Date.now(), !(local_1_0.releasesJson.length > 0) - local_1_0.releasesFetchedAt < local_0_0)) {
        return local_1_0.releasesJson;
      } else {
        v0 = await this.fetchStatic("releases.json", function (p0) {
          return Array.isArray(JSON.parse(p0));
        });
        local_1_0.releasesJson = v0;
        local_1_0.releasesFetchedAt = Date.now();
        return v0;
      }
    }
    async requestAtomFallback() {
      let v0, v5;
      v5 = {
        "method": http.RequestMethod.GET,
        "header": {
          "Accept": "application/atom+xml",
          "User-Agent": "zhihu-plus-plus-hmos"
        },
        "expectDataType": http.HttpDataType.STRING,
        "connectTimeout": local_0_3,
        "readTimeout": local_0_4,
        "usingCache": false
      };
      v0 = await this.requestHandle.request(GITHUB_RELEASES_ATOM, v5);
      Number(v0.responseCode);
      return v0 !== 200 || typeof v0.result !== "string" ? undefined : decodeLatestReleaseAtom(v0.result);
    }
    async fetchReleaseDetail(p0) {
      let v0, v3, v5, v6, v7, v8, acc;
      v0 = await this.releasesCatalog();
      acc = JSON.parse(v0)[Symbol.iterator]();
      v5 = JSON.parse(v0)[Symbol.iterator]();
      v6 = v5.next;
      v7 = false;
      do {
        v8 = v6.call(v5);
        if (v8.done) {
          if (local_1_0.bundledReleasesJson.length <= 0) {
            return local_0_6("静态更新清单中暂无 HMOSv" + p0 + " 的发布说明");
          }
          v3 = JSON.parse(local_1_0.bundledReleasesJson)[Symbol.iterator]();
          do {
            v6 = v3.next();
            if (v6.done) {
              return local_0_6("静态更新清单中暂无 HMOSv" + p0 + " 的发布说明");
            }
            acc = v6.value;
            v6 = v6.value;
          } while ((acc = JSON.stringify(v6), acc = decodeReleaseDetail(acc), v6 = acc, acc = !(acc !== undefined), v7 = v0, v8 = false, v6 === undefined) || (acc = !(v6.versionName === p0), v7 = v0, v8 = false, v6.versionName !== p0));
          if (v3.return != undefined) {
            v3.return();
          }
          return {
            "status": AppReleaseDetailStatus.OK,
            "detail": v6,
            "message": ""
          };
        }
        acc = v8.value;
        v8 = v8.value;
      } while ((acc = JSON.stringify(v8), acc = decodeReleaseDetail(acc), v8 = acc, acc = !(acc !== undefined), v3 = p0, v8 === undefined) || (acc = !(v8.versionName === p0), v3 = p0, v8.versionName !== p0));
      if (v7) {} else if (v5.return != undefined) {
        v5.return();
      }
      return {
        "status": AppReleaseDetailStatus.OK,
        "detail": v8,
        "message": ""
      };
    }
    destroy() {
      this.requestHandle.destroy();
    }
    static seedBundledCatalog(p0, p1) {
      if (decodeLatestRelease(p0) !== undefined) {
        local_1_0.bundledLatestJson = p0;
      }
      if (Array.isArray(JSON.parse(p1))) {
        local_1_0.bundledReleasesJson = p1;
      }
    }
  };
  local_1_0 = acc;
  (function () {
    this.latestJson = "";
    this.latestFetchedAt = 0;
    this.releasesJson = "";
    this.releasesFetchedAt = 0;
    this.bundledLatestJson = "";
    this.bundledReleasesJson = "";
  }).call(acc);
}
AppUpdateClient = acc;
export { AppUpdateClient };
export { GITHUB_RELEASES_ATOM };
export { catalogUrlWaves };