/*
* class name:L&data/src/main/ets/repository/DefaultOnlineHistoryRepository&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { ZhihuHttpMethod } from "@normalized:N&&&data/src/main/ets/network/ZhihuHttpClient&1.0.0";
import { decodeOnlineHistoryPage } from "@normalized:N&&&data/src/main/ets/domain/ZhihuOnlineHistoryDecoder&1.0.0";
let ONLINE_HISTORY_BASE_URL, ONLINE_HISTORY_BATCH_DEL_URL, ONLINE_HISTORY_LIMIT, ONLINE_HISTORY_MAX_OFFSET, OnlineHistoryRepositoryFailureKind, buildBatchDelBody, buildOnlineHistoryUrl, canonicalOnlineHistoryCursorKey, isOnlineHistoryCursorUrl, onlineHistoryDeletePairOf, onlineHistoryOffsetOf;
let local_0_0, local_0_1, local_0_2;
buildBatchDelBody = function (p0, p1) {
  return "{\"pairs\":[" + p0.map(function (p0) {
    return "{\"content_token\":\"" + p0.contentToken + "\",\"content_type\":\"" + p0.contentType + "\"}";
  }).join(",") + "],\"clear\":" + (p1 ? "true" : "false") + "}";
};
buildOnlineHistoryUrl = function (p0) {
  if (!Number.isSafeInteger(p0) || p0 < 0 || p0 > 100000) {
    throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.INVALID_CURSOR);
  }
  return "" + ONLINE_HISTORY_BASE_URL + "?offset=" + p0 + "&limit=" + ONLINE_HISTORY_LIMIT + "";
};
canonicalOnlineHistoryCursorKey = function (p0) {
  return "" + ONLINE_HISTORY_BASE_URL + "?" + p0.substring(p0.indexOf("?") + 1).split("&").slice().sort().join("&") + "";
};
local_0_1 = function (p0) {
  let local_1_0 = new Set();
  p0.forEach(function (p0) {
    local_1_0.add(p0);
  });
  return local_1_0;
};
isOnlineHistoryCursorUrl = function (p0) {
  let v0;
  let v1 = p0.length === 0;
  if (p0.length !== 0) {
    v1 = p0.length > 4096;
  }
  if (v1 || new RegExp("[\\u0000-\\u0020\\u007F-\\uFFFF]").test(p0)) {
    return false;
  }
  if (!p0.startsWith("" + ONLINE_HISTORY_BASE_URL + "?")) {
    return false;
  }
  v1 = p0.substring(p0.indexOf("?") + 1);
  if (v1.length === 0) {
    return false;
  }
  v0 = v1.split("&");
  if (v0.length === 2) {
    v1 = local_0_0(v0, "offset");
    v0 = local_0_0(v0, "limit");
    return v1 !== undefined && v1 <= 100000 && v0 === 10;
  }
  return false;
};
onlineHistoryDeletePairOf = function (p0) {
  let v0 /*OnlineHistoryRepositoryFailure*/;
  let v1 = p0.indexOf(":");
  if (v1 <= 0 || v1 !== p0.lastIndexOf(":")) {
    throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.INVALID_CONTENT_KEY);
  }
  v0 = p0.substring(0, v1);
  v1 = p0.substring(v1 + 1);
  if (new RegExp("^(?:question|answer|article|pin)$").test(v0)) {
    if (!new RegExp("^[1-9][0-9]{0,29}$").test(v1)) {
      throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.INVALID_CONTENT_KEY);
    }
    return {
      "contentToken": v1,
      "contentType": v0
    };
  }
  throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.INVALID_CONTENT_KEY);
};
onlineHistoryOffsetOf = function (p0) {
  if (!isOnlineHistoryCursorUrl(p0)) {
    throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.INVALID_CURSOR);
  }
  return local_0_0(p0.substring(p0.indexOf("?") + 1).split("&"), "offset") ?? 0;
};
local_0_0 = function (p0, p1) {
  let v0, v5, v9, v10;
  let v2 = p0[Symbol.iterator]();
  do {
    v5 = v2.next();
    if (v5.done) {
      return undefined;
    }
    v5 = v5.value;
    if (v5.length === 0) {
      if (v2.return != undefined) {
        v2.return();
      }
      return undefined;
    }
    v9 = v5.indexOf("=");
    if (v9 <= 0 || v9 === v5.length - 1) {
      if (v2.return != undefined) {
        v2.return();
      }
      return undefined;
    }
    v10 = v5.substring(0, v9);
    v5 = v5.substring(v9 + 1);
    v10 = v10.replace(new RegExp("\\+", "g"), "%20");
    v9 = decodeURIComponent(v10);
    v5 = v5.replace(new RegExp("\\+", "g"), "%20");
    v5 = decodeURIComponent(v5);
  } while (v9 !== p1);
  if (!new RegExp("^(?:0|[1-9][0-9]*)$").test(v5)) {
    if (v2.return != undefined) {
      v2.return();
    }
    return undefined;
  }
  v0 = Number(v5);
  if (v2.return != undefined) {
    v2.return();
  }
  return v0;
};
local_0_2 = function (p0) {
  return {
    "items": p0.items,
    "cursor": {
      "isEnd": true,
      "isStart": p0.cursor.isStart,
      "page": p0.cursor.page,
      "total": p0.cursor.total
    }
  };
};
ONLINE_HISTORY_BASE_URL = "https://www.zhihu.com/api/v4/unify-consumption/read_history";
ONLINE_HISTORY_BATCH_DEL_URL = "https://api.zhihu.com/read_history/batch_del";
ONLINE_HISTORY_LIMIT = 10;
ONLINE_HISTORY_MAX_OFFSET = 100000;
OnlineHistoryRepositoryFailureKind = {
  INVALID_CURSOR: "invalid_cursor",
  REPEATED_CURSOR: "repeated_cursor",
  INVALID_CONTENT_KEY: "invalid_content_key",
  CANCELLED: "cancelled"
};
export class OnlineHistoryRepositoryFailure extends Error {
  constructor(p0) {
    let v0 = "在线历史请求已取消";
    switch (p0) {
      case OnlineHistoryRepositoryFailureKind.INVALID_CURSOR:
        v0 = "在线历史分页地址不受信任";
        break;
      case OnlineHistoryRepositoryFailureKind.REPEATED_CURSOR:
        v0 = "在线历史分页游标已被请求";
        break;
      case OnlineHistoryRepositoryFailureKind.INVALID_CONTENT_KEY:
        v0 = "在线历史记录标识无效";
        break;
    }
    v0 = super(v0);
    v0.name = "OnlineHistoryRepositoryFailure";
    v0.kind = p0;
    return v0;
  }
}
export class DefaultOnlineHistoryRepository {
  constructor(p0, p1) {
    this.requestedCursors = new Set();
    this.deliveredIdentities = new Set();
    this.generation = 0;
    this.httpClient = p0;
    this.onClear = p1;
  }
  cancel() {
    this.generation = this.generation + 1;
    this.httpClient.cancel();
  }
  async loadPage(p0) {
    let v0, v2 /*OnlineHistoryRepositoryFailure*/, v3 /*decodeOnlineHistoryPage*/, v4 /*nextDelivered*/, v5 /*items*/, v6, v7 /*items*/;
    let local_1_0, local_1_1;
    if (p0 === undefined) {
      v4 = p0 === undefined ? 0 : onlineHistoryOffsetOf(p0);
      v5 = p0 === undefined ? buildOnlineHistoryUrl(0) : p0;
      v6 = canonicalOnlineHistoryCursorKey(v5);
      if (p0 !== undefined && this.requestedCursors.has(v6)) {
        throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.REPEATED_CURSOR);
      }
      v0 = await this.httpClient.execute({
        "url": v5,
        "accept": "application/json",
        "useSession": true,
        "signWithZse": true
      });
      if (this.generation === this.generation) {
        v3 = decodeOnlineHistoryPage(v0.body);
        v5 = p0 === undefined ? new Set() : local_0_1(this.requestedCursors);
        local_1_0 = p0 === undefined ? new Set() : local_0_1(this.deliveredIdentities);
        v5.add(v6);
        local_1_1 = [];
        v3.items.forEach(function (p0) {
          if (local_1_0.has(p0.contentKey)) {
            return;
          }
          local_1_0.add(p0.contentKey);
          local_1_1.push(p0);
          return;
        });
        v2 = !v3.cursor.isEnd && local_1_1.length > 0 ? buildOnlineHistoryUrl(v4 + 10) : undefined;
        v4 = v2 === undefined ? undefined : canonicalOnlineHistoryCursorKey(v2);
        v7 = v2 === undefined && !v3.cursor.isEnd || v4 === v6;
        if (!v7 && (v7 = v4 !== undefined, v4 !== undefined)) {
          v7 = v5.has(v4);
        }
        this.requestedCursors = v5;
        this.deliveredIdentities = local_1_0;
        v4 = {
          "items": local_1_1,
          "cursor": {
            "isEnd": v3.cursor.isEnd,
            "isStart": v3.cursor.isStart,
            "next": v2,
            "page": v3.cursor.page,
            "total": v3.cursor.total
          }
        };
        if (v7) {
          v4 = local_0_2(v4);
        }
        return v4;
      }
      throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.CANCELLED);
    }
    if (!isOnlineHistoryCursorUrl(p0)) {
      throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.INVALID_CURSOR);
    }
    v4 = p0 === undefined ? 0 : onlineHistoryOffsetOf(p0);
    v5 = p0 === undefined ? buildOnlineHistoryUrl(0) : p0;
    v6 = canonicalOnlineHistoryCursorKey(v5);
    if (p0 !== undefined && this.requestedCursors.has(v6)) {
      throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.REPEATED_CURSOR);
    }
    v0 = await this.httpClient.execute({
      "url": v5,
      "accept": "application/json",
      "useSession": true,
      "signWithZse": true
    });
    if (this.generation === this.generation) {
      v3 = decodeOnlineHistoryPage(v0.body);
      v5 = p0 === undefined ? new Set() : local_0_1(this.requestedCursors);
      local_1_0 = p0 === undefined ? new Set() : local_0_1(this.deliveredIdentities);
      v5.add(v6);
      local_1_1 = [];
      v3.items.forEach(function (p0) {
        if (local_1_0.has(p0.contentKey)) {
          return;
        }
        local_1_0.add(p0.contentKey);
        local_1_1.push(p0);
        return;
      });
      v2 = !v3.cursor.isEnd && local_1_1.length > 0 ? buildOnlineHistoryUrl(v4 + 10) : undefined;
      v4 = v2 === undefined ? undefined : canonicalOnlineHistoryCursorKey(v2);
      v7 = v2 === undefined && !v3.cursor.isEnd || v4 === v6;
      if (!v7 && (v7 = v4 !== undefined, v4 !== undefined)) {
        v7 = v5.has(v4);
      }
      this.requestedCursors = v5;
      this.deliveredIdentities = local_1_0;
      v4 = {
        "items": local_1_1,
        "cursor": {
          "isEnd": v3.cursor.isEnd,
          "isStart": v3.cursor.isStart,
          "next": v2,
          "page": v3.cursor.page,
          "total": v3.cursor.total
        }
      };
      if (v7) {
        v4 = local_0_2(v4);
      }
      return v4;
    }
    throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.CANCELLED);
  }
  async clearAll() {
    let acc;
    await this.httpClient.execute({
      "url": ONLINE_HISTORY_BATCH_DEL_URL,
      "method": ZhihuHttpMethod.POST,
      "body": buildBatchDelBody([], true),
      "accept": "application/json",
      "useSession": true,
      "signWithZse": true
    });
    if (this.generation === this.generation) {
      this.requestedCursors = new Set();
      this.deliveredIdentities = new Set();
      acc = this.onClear === null || this.onClear === undefined ? undefined : this.onClear();
      await acc;
      return undefined;
    }
    throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.CANCELLED);
  }
  async deleteEntry(p0) {
    let v6 = {
      "url": ONLINE_HISTORY_BATCH_DEL_URL,
      "method": ZhihuHttpMethod.POST,
      "body": buildBatchDelBody([onlineHistoryDeletePairOf(p0)], false),
      "accept": "application/json",
      "useSession": true,
      "signWithZse": true
    };
    await this.httpClient.execute(v6);
    if (this.generation === this.generation) {
      return undefined;
    }
    throw new OnlineHistoryRepositoryFailure(OnlineHistoryRepositoryFailureKind.CANCELLED);
  }
}
export { ONLINE_HISTORY_BASE_URL };
export { ONLINE_HISTORY_BATCH_DEL_URL };
export { ONLINE_HISTORY_LIMIT };
export { ONLINE_HISTORY_MAX_OFFSET };
export { OnlineHistoryRepositoryFailureKind };
export { buildBatchDelBody };
export { buildOnlineHistoryUrl };
export { canonicalOnlineHistoryCursorKey };
export { isOnlineHistoryCursorUrl };
export { onlineHistoryDeletePairOf };
export { onlineHistoryOffsetOf };