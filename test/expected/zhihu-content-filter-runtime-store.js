/*
* class name:L&data/src/main/ets/data/ContentFilterRuntimeStore&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { contentIdentityKey } from "@normalized:N&&&data/src/main/ets/data/BlockingRuleStore&1.0.0";
import relationalStore from "@ohos:data.relationalStore";
let ContentFilterRuntimeStore;
let local_0_0;
local_0_0 = "content_filter_views";
ContentFilterRuntimeStore = class panda_jmp0_reserved_anonymous_0 {
  constructor(p0, p1) {
    this.mutationQueue = Promise.resolve();
    this.database = p0;
    this.history = p1;
  }
  async loadSnapshot(p0) {
    let v0, v3, v4, v5, v6, v7, v8, v11, v20, v46, acc;
    await this.mutationQueue;
    v4 = await this.database.open();
    v5 = {};
    v6 = [];
    v7 = p0 === undefined ? [] : Array.from(new Set(p0));
    v8 = [];
    if (p0 === undefined) {
      v8.push([]);
    }
    for (v11 = 0; v11 < v7.length; v11 += 500) {
      v8.push(v7.slice(v11, v11 + 500));
    }
    v7 = v8[Symbol.iterator]();
    while (true) {
      v11 = v7.next();
      if (v11.done) break;
      v11 = v11.value;
      {
        let local_1_0;
        v20 = p0 === undefined ? "" : " WHERE content_key IN (" + v11.map(function (p0) {
          return "?";
        }).join(",") + ")";
        local_1_0 = [];
        v11.forEach(function (p0) {
          local_1_0.push(p0);
        });
        v0 = await v4.querySql("SELECT content_key, view_count FROM content_filter_views" + v20, local_1_0);
        try {
          acc = !v0.goToFirstRow();
          if (!acc) {
            do {
              v46 = v0.getString(0);
              v5[v46] = v0.getLong(1);
              acc = !v0.goToNextRow();
            } while (!acc);
          }
        } finally {
          v0.close();
        }
        v20 = "SELECT content_key FROM opened_content" + v20;
        v11 = await v4.querySql(v20, local_1_0);
        try {
          acc = !v11.goToFirstRow();
          if (!acc) {
            do {
              v6.push(v11.getString(0));
              acc = !v11.goToNextRow();
            } while (!acc);
          }
        } finally {
          v11.close();
        }
      }
    }
    v3 = {
      "viewCounts": null,
      "openedKeys": null
    };
    v3.viewCounts = v5;
    v3.openedKeys = v6;
    return v3;
  }
  recordOutcomes(p0) {
    let local_1_0, local_1_1;
    local_1_1 = this;
    local_1_0 = p0;
    return local_1_1.enqueue(async function () {
      let v0, v3, v5, v6, v7, v8 /*VIEW_TABLE*/, v9, v10 /*relationalStore*/, v11;
      v3 = await local_1_1.database.open();
      v5 = Date.now();
      for (v6 = 0; v6 < local_1_0.length; v6 += 1) {
        v8 = contentIdentityKey(local_1_0[v6].content);
        if (local_1_0[v6].match === undefined && (v9 = v8.length, v8.length > 0)) {
          v0 = await local_1_1.readViewCount(v3, v8);
          v9 = {
            "content_key": null,
            "view_count": null,
            "last_viewed_at": null
          };
          v9.content_key = v8;
          v9.view_count = v0 + 1;
          v9.last_viewed_at = v5;
          await v3.insert(local_0_0, v9, relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
        } else if (local_1_0[v6].match !== undefined) {
          v8 = local_1_0[v6].content.contentId;
          switch (local_1_0[v6].content.contentId) {
            case null:
            case undefined:
              v8 = "";
              break;
          }
          v8 = v8.length;
          if (v8 > 0) {
            v8 = local_1_0[v6].content.contentKind;
            switch (local_1_0[v6].content.contentKind) {
              case null:
              case undefined:
                v8 = "";
                break;
            }
            v8 = v8.length;
            if (v8 > 0) {
              v10 = {
                "kind": null,
                "ruleId": null,
                "ruleName": null,
                "contentTitle": null,
                "contentKind": null,
                "contentId": null,
                "blockedAt": null
              };
              v10.kind = local_1_0[v6].match.kind;
              v10.ruleId = local_1_0[v6].match.ruleId;
              v10.ruleName = local_1_0[v6].match.reason;
              v10.contentTitle = local_1_0[v6].content.title;
              v11 = local_1_0[v6].content.contentKind;
              switch (local_1_0[v6].content.contentKind) {
                case null:
                case undefined:
                  v11 = "content";
                  break;
              }
              v10.contentKind = v11;
              v7 = local_1_0[v6].content.contentId;
              switch (local_1_0[v6].content.contentId) {
                case null:
                case undefined:
                  v7 = "unknown";
                  break;
              }
              v10.contentId = v7;
              v10.blockedAt = v5;
              await local_1_1.history.insert(v10);
            }
          }
        }
      }
      return undefined;
    });
  }
  async loadStats() {
    await this.mutationQueue;
    return this.readComputedStats(await this.database.open());
  }
  cleanupOldData(p0) {
    let acc;
    let local_1_0, local_1_1;
    local_1_1 = this;
    local_1_0 = p0;
    acc = local_1_1.enqueue(async function () {
      let acc;
      await (await local_1_1.database.open()).delete(new relationalStore.RdbPredicates(local_0_0).lessThan("last_viewed_at", local_1_0));
      acc = local_1_1.history.deleteBefore === null || local_1_1.history.deleteBefore === undefined ? undefined : local_1_1.history.deleteBefore(local_1_0);
      await acc;
      return undefined;
    });
    return acc;
  }
  clearAllData() {
    let local_1_0;
    local_1_0 = this;
    return local_1_0.enqueue(async function () {
      await (await local_1_0.database.open()).delete(new relationalStore.RdbPredicates(local_0_0));
      await local_1_0.history.clear();
      return undefined;
    });
  }
  enqueue(p0) {
    let v0;
    v0 = this.mutationQueue.then(p0, p0);
    this.mutationQueue = v0.then(function () {}, function () {});
    return v0;
  }
  async readViewCount(p0, p1) {
    let v2, v6;
    v2 = await p0.query(new relationalStore.RdbPredicates(local_0_0).equalTo("content_key", p1), ["view_count"]);
    v6 = 0;
    if (v2.goToFirstRow()) {
      v6 = v2.getLong(v2.getColumnIndex("view_count"));
    }
    v2.close();
    return v6;
  }
  async readComputedStats(p0) {
    let v0, v2, v3, v7, v8, v10;
    v0 = await p0.querySql("SELECT COALESCE(SUM(view_count), 0) AS kept_count FROM content_filter_views");
    v3 = v0;
    v7 = 0;
    v8 = v0.goToFirstRow() ? v0.getLong(v0.getColumnIndex("kept_count")) : 0;
    v0 = await this.history.queryRecent();
    v8 += v0.length;
    v10 = {
      "totalSeen": null,
      "totalFiltered": null,
      "filterRate": null,
      "lastFilteredAt": null
    };
    v10.totalSeen = v8;
    v10.totalFiltered = v0.length;
    v2 = v8 > 0 ? v0.length / v8 : 0;
    v10.filterRate = v2;
    if (v0.length !== 0) {
      v7 = v0[0].blockedAt;
    }
    v10.lastFilteredAt = v7;
    v3.close();
    return v10;
  }
};
export { ContentFilterRuntimeStore };