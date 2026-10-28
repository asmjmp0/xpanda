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
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6;
export function catalogUrlWaves(p0) {
  let v0 = local_0_2(p0);
  return [v0, proxiedCatalogUrls(v0[0])];
}
local_0_6 = function (p0) {
  return {
    "status": AppReleaseDetailStatus.FAILED,
    "detail": undefined,
    "message": p0
  };
};
local_0_2 = function (p0) {
  let v1 = Math.floor(Date.now() / local_0_0);
  return ["https://raw.githubusercontent.com/" + local_0_1 + "/main/" + ("assets/update/" + p0 + "") + "?v=" + v1 + "", "https://cdn.jsdelivr.net/gh/" + local_0_1 + "@main/" + ("assets/update/" + p0 + "") + "?v=" + v1 + "", "https://fastly.jsdelivr.net/gh/" + local_0_1 + "@main/" + ("assets/update/" + p0 + "") + "?v=" + v1 + ""];
};
export const GITHUB_RELEASES_ATOM = "https://github.com/zhuoyi233/zhihu-plus-plus-HMOS/releases.atom";
local_0_3 = 8000;
local_0_4 = 10000;
local_0_0 = 10 * 60 * 1000;
local_0_1 = "zhuoyi233/zhihu-plus-plus-HMOS";
local_0_5 = 4000;
export class AppUpdateClient {
  static latestJson = "";
  static latestFetchedAt = 0;
  static releasesJson = "";
  static releasesFetchedAt = 0;
  static bundledLatestJson = "";
  static bundledReleasesJson = "";
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
        v3 = decodeLatestRelease(AppUpdateClient.bundledLatestJson);
        return v3 !== undefined && v3.versionName === p0 ? resolveAppUpdateCheck(p0, v3, "") : resolveAppUpdateCheck(p0, undefined, "检查更新失败：静态更新源与 Releases 备用源均不可用");
      }
      v3 = decodeLatestRelease(AppUpdateClient.bundledLatestJson);
      return v3 !== undefined && v3.versionName === v0.versionName ? resolveAppUpdateCheck(p0, v3, "") : resolveAppUpdateCheck(p0, v0, "");
    }
    this.enrichSha256FromBundled(v4);
    return resolveAppUpdateCheck(p0, v4, "");
  }
  enrichSha256FromBundled(p0) {
    let v0 /*decodeLatestRelease*/;
    if (p0.assetSha256 !== undefined && p0.assetSha256.length > 0) {
      return;
    }
    v0 = decodeLatestRelease(AppUpdateClient.bundledLatestJson);
    if (v0 !== undefined && v0.versionName === p0.versionName && v0.assetSha256 !== undefined) {
      p0.assetSha256 = v0.assetSha256;
    }
    return;
  }
  async requestStatic(p0) {
    let v0;
    let v2 /*http*/ = http.createHttp();
    try {
      v0 = await v2.request(p0, {
        "method": http.RequestMethod.GET,
        "header": {
          "Accept": "application/json",
          "User-Agent": "zhihu-plus-plus-hmos"
        },
        "expectDataType": http.HttpDataType.STRING,
        "connectTimeout": local_0_3,
        "readTimeout": local_0_4,
        "usingCache": true
      });
      Number(v0.responseCode);
      if (v0 !== 200 || typeof v0.result !== "string") {
        throw new Error("静态源响应码 " + v0.responseCode + "");
      }
      return v0.result;
    } finally {
      v2.destroy();
    }
  }
  fetchStatic(p0, p1) {
    let acc;
    let local_2_2 = this;
    let local_2_1 = p1;
    let local_2_0 = catalogUrlWaves(p0);
    acc = new Promise(function (p0, p1) {
      let v3;
      let local_3_7 = p0;
      let local_3_4 = p1;
      let local_3_1 = 0;
      let local_3_2 = local_2_0[0].length;
      let local_3_5 = 0;
      let local_3_0 = false;
      let local_3_3 = false;
      let local_3_6 = function () {
        let v1 /*total*/;
        if (!local_3_0 /*settled*/ && local_3_1 >= local_3_2) {
          if (!local_3_3 && local_2_0[1].length > 0) {
            return;
          }
          local_3_0 = true;
          v1 = new Error(local_3_5 > 0 ? "静态更新数据格式错误" : "静态更新源不可用");
          local_3_4(v1);
        }
        return;
      };
      let local_3_8 = function () {
        local_3_1 += 1;
        local_3_6();
      };
      let local_3_9 = function (p0) {
        let acc = local_2_2.requestStatic(p0).then(function (p0) {
          if (local_3_0 /*settled*/) {
            return;
          }
          if (local_2_1(p0)) {
            local_3_0 = true;
            local_3_7(p0);
            return;
          }
          local_3_5 += 1;
          local_3_8();
          return;
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
        }
        local_3_2 += local_2_0[1].length;
        local_3_3 = true;
        for (v3 of local_2_0[1]) {
          local_3_9(v3);
        }
        local_3_6();
        return;
      }, local_0_5);
    });
    return acc;
  }
  async latestCatalog(p0) {
    let v0, acc;
    let v2 /*AppUpdateClient*/ = !p0 && AppUpdateClient.latestJson.length > 0;
    if (v2 && (acc = Date.now(), !v2 - AppUpdateClient.latestFetchedAt < local_0_0)) {
      return AppUpdateClient.latestJson;
    }
    v0 = await this.fetchStatic("version.json", function (p0) {
      return decodeLatestRelease(p0) !== undefined;
    });
    AppUpdateClient.latestJson = v0;
    AppUpdateClient.latestFetchedAt = Date.now();
    return v0;
  }
  async releasesCatalog() {
    let v0, acc;
    if (AppUpdateClient.releasesJson.length > 0 && (acc = Date.now(), !(AppUpdateClient.releasesJson.length > 0) - AppUpdateClient.releasesFetchedAt < local_0_0)) {
      return AppUpdateClient.releasesJson;
    }
    acc = this.fetchStatic("releases.json", function (p0) {
      try {
        return Array.isArray(JSON.parse(p0));
      } catch (catchAcc) {
        return false;
      }
    });
    v0 = await acc;
    AppUpdateClient.releasesJson = v0;
    AppUpdateClient.releasesFetchedAt = Date.now();
    return v0;
  }
  async requestAtomFallback() {
    let v0;
    try {
      v0 = await this.requestHandle.request(GITHUB_RELEASES_ATOM, {
        "method": http.RequestMethod.GET,
        "header": {
          "Accept": "application/atom+xml",
          "User-Agent": "zhihu-plus-plus-hmos"
        },
        "expectDataType": http.HttpDataType.STRING,
        "connectTimeout": local_0_3,
        "readTimeout": local_0_4,
        "usingCache": false
      });
      Number(v0.responseCode);
      return v0 !== 200 || typeof v0.result !== "string" ? undefined : decodeLatestReleaseAtom(v0.result);
    } catch (catchAcc) {
      return undefined;
    }
  }
  async fetchReleaseDetail(p0) {
    let v8;
    let v5 = JSON.parse(await this.releasesCatalog())[Symbol.iterator]();
    let v6 = v5.next;
    do {
      v8 = v6.call(v5);
      if (v8.done) {
        if (AppUpdateClient.bundledReleasesJson.length <= 0) {
          return local_0_6("静态更新清单中暂无 HMOSv" + p0 + " 的发布说明");
        }
        for (v6 of JSON.parse(AppUpdateClient.bundledReleasesJson)) {
          if ((v6 = decodeReleaseDetail(JSON.stringify(v6)), v6 !== undefined) && v6.versionName === p0) return {
            "status": AppReleaseDetailStatus.OK,
            "detail": v6,
            "message": ""
          };
        }
        return local_0_6("静态更新清单中暂无 HMOSv" + p0 + " 的发布说明");
      }
      v8 = v8.value;
    } while ((v8 = decodeReleaseDetail(JSON.stringify(v8)), v8 === undefined) || v8.versionName !== p0);
    if (v5.return != undefined) {
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
      AppUpdateClient.bundledLatestJson = p0;
    }
    try {
      if (Array.isArray(JSON.parse(p1))) {
        AppUpdateClient.bundledReleasesJson = p1;
      }
    } catch (catchAcc) {}
  }
}