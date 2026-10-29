/*
* class name:L&launch/src/main/ets/n16&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { a52 } from "@normalized:N&&&commons/Index&1.0.0";
import { b50 } from "@normalized:N&&&commons/Index&1.0.0";
import { c878 } from "@normalized:N&&&launch/src/main/ets/j16&1.0.0";
import { f52 } from "@normalized:N&&&commons/Index&1.0.0";
import { i47 } from "@normalized:N&&&commons/Index&1.0.0";
import { j1502 } from "@normalized:N&&&launch/src/main/ets/l16&1.0.0";
import { j49 } from "@normalized:N&&&commons/Index&1.0.0";
import { l47 } from "@normalized:N&&&commons/Index&1.0.0";
import { l50 } from "@normalized:N&&&commons/Index&1.0.0";
import { m1062 } from "@normalized:N&&&launch/src/main/ets/m16&1.0.0";
import { m47 } from "@normalized:N&&&commons/Index&1.0.0";
import { n1553 } from "@normalized:N&&&launch/src/main/ets/k16&1.0.0";
import { o47 } from "@normalized:N&&&commons/Index&1.0.0";
import { o51 } from "@normalized:N&&&commons/Index&1.0.0";
import { p46 } from "@normalized:N&&&commons/Index&1.0.0";
import { p47 } from "@normalized:N&&&commons/Index&1.0.0";
import { p52 } from "@normalized:N&&&commons/Index&1.0.0";
import { s1555 } from "@normalized:N&&&launch/src/main/ets/m16&1.0.0";
import { s47 } from "@normalized:N&&&commons/Index&1.0.0";
import { s51 } from "@normalized:N&&&commons/Index&1.0.0";
import { t1555 } from "@normalized:N&&&launch/src/main/ets/m16&1.0.0";
import { u1555 } from "@normalized:N&&&launch/src/main/ets/m16&1.0.0";
import util from "@ohos:util";
import { v155 } from "@normalized:N&&&commons/Index&1.0.0";
import { v1555 } from "@normalized:N&&&launch/src/main/ets/m16&1.0.0";
import { w1555 } from "@normalized:N&&&launch/src/main/ets/m16&1.0.0";
import { w49 } from "@normalized:N&&&commons/Index&1.0.0";
import { x1555 } from "@normalized:N&&&launch/src/main/ets/m16&1.0.0";
import { x95 } from "@normalized:N&&&commons/Index&1.0.0";
import { z51 } from "@normalized:N&&&commons/Index&1.0.0";
let local_0_0 = function (p0) {
  let v0 = {
    "schema": 1,
    "activeIds": p0.activeIds.slice(),
    "pendingIds": p0.pendingIds.slice(),
    "resultIds": p0.resultIds.slice(),
    "bootstrapIds": p0.bootstrapIds.slice(),
    "bootstrapCursor": p0.bootstrapCursor,
    "historyIds": null
  };
  let v1 = p0.historyIds ?? [];
  v0.historyIds = v1.slice();
  return v0;
};
let local_0_2 = function (p0) {
  let v2, v3, v4;
  if (p0 === undefined) {
    return "";
  }
  v2 = {
    "state": p0.state,
    "source": p0.source,
    "summary": p0.summary,
    "errorKind": null,
    "endedAt": null
  };
  v3 = p0.errorKind ?? "";
  v4 = 0;
  v2.errorKind = v3;
  if (p0.endedAt !== null && p0.endedAt !== undefined) {
    v4 = p0.endedAt;
  }
  v2.endedAt = v4;
  return JSON.stringify(v2);
};
let local_0_1 = function (p0) {
  let v2 = {
    "activityId": p0.activityId,
    "state": p0.state,
    "source": p0.outcomeSource,
    "summary": p0.outcomeSummary,
    "errorKind": p0.errorKind ?? "",
    "endedAt": p0.endedAt,
    "estimated": p0.endTimeEstimated === true
  };
  return JSON.stringify(v2);
};
export class c1114 {
  constructor(p0, p1) {
    this.queue_ = {
      "schema": 1,
      "activeIds": [],
      "pendingIds": [],
      "resultIds": [],
      "bootstrapIds": [],
      "bootstrapCursor": 0
    };
    this.initialized_ = undefined;
    this.gate_ = Promise.resolve();
    this.draining_ = undefined;
    this.requests_ = new Map();
    this.platformEpoch_ = 1;
    this.platformApplied_ = 0;
    this.platformRetryEpoch_ = 0;
    this.platformRetryApplied_ = 0;
    this.platformPublicationKey_ = "";
    this.candidateInputsChanged_ = false;
    this.deferHistoricalCandidates_ = false;
    this.criticalCandidatesChanged_ = false;
    this.stats_ = {
      "requests": 0,
      "merged": 0,
      "resolverCalls": 0,
      "consumed": 0,
      "retries": 0,
      "staleRejected": 0,
      "pending": 0,
      "active": 0,
      "bootstrapCommits": 0,
      "boundaryLookups": 0,
      "boundaryGeneration": 0
    };
    this.launchOrder_ = [];
    this.launchIdentities_ = new Map();
    this.nextLaunchById_ = new Map();
    this.boundaryGeneration_ = 0;
    this.removedLaunches_ = new Set();
    this.emptyPublicationDigest_ = undefined;
    this.activeRecovery_ = undefined;
    this.admittedLaunches_ = new Set();
    this.splitAdmission_ = false;
    this.migration_ = undefined;
    this.admissionJobs_ = new Map();
    this.admissionTokens_ = new Map();
    this.grantedLaunches_ = new Set();
    this.queuedLeases_ = new Set();
    this.inputRequestGeneration_ = 0;
    this.waking_ = undefined;
    this.wakeGeneration_ = 0;
    this.wakeRequested_ = false;
    this.filesDir_ = p0;
    this.hooks_ = p1;
  }
  stats() {
    return {
      "requests": this.stats_.requests,
      "merged": this.stats_.merged,
      "resolverCalls": this.stats_.resolverCalls,
      "consumed": this.stats_.consumed,
      "retries": this.stats_.retries,
      "staleRejected": this.stats_.staleRejected,
      "pending": this.queue_.pendingIds.length,
      "active": this.queue_.activeIds.length,
      "bootstrapCommits": this.stats_.bootstrapCommits,
      "boundaryLookups": this.stats_.boundaryLookups,
      "boundaryGeneration": this.boundaryGeneration_,
      "historyPending": (this.queue_.historyIds ?? []).length,
      "migrationActive": this.migration_ !== undefined,
      "transactionActive": this.activeRecovery_ !== undefined,
      "gameReservations": this.admittedLaunches_.size,
      "presentationPending": this.queue_.resultIds.length,
      "queuedProtection": this.queuedLeases_.size
    };
  }
  prepareColdAdmission() {
    if (this.initialized_ === undefined) {
      this.splitAdmission_ = true;
    }
    return this.initialize();
  }
  hasHistoricalMigration() {
    return (this.queue_.historyIds ?? []).length > 0;
  }
  observeDeletedActivity(p0) {
    if (this.queuedLeases_.has(p0)) {
      throw new Error("已保护恢复义务不能确认删除");
    }
    if (!this.launchIdentities_.has(p0)) {
      return;
    }
    this.removedLaunches_.add(p0);
    this.boundaryGeneration_ = this.boundaryGeneration_ + 1;
    return;
  }
  initialize() {
    let local_1_0;
    let local_1_1 = this;
    if (local_1_1.initialized_ === undefined) {
      local_1_0 = local_1_1.bootstrap_();
      local_1_1.initialized_ = local_1_0;
      local_1_0.catch(function () {
        if (local_1_1.initialized_ === local_1_0) {
          local_1_1.initialized_ = undefined;
        }
      });
      return local_1_0;
    }
    return local_1_1.initialized_;
  }
  mutate_(p0) {
    let acc;
    let local_1_1 = this;
    let local_1_0 = p0;
    acc = local_1_1.gate_.then(async function () {
      let v2 = local_0_0(local_1_1.queue_);
      local_1_0(v2);
      v2.activeIds = w1555(v2.activeIds);
      v2.pendingIds = w1555(v2.pendingIds);
      v2.resultIds = w1555(v2.resultIds);
      v2.historyIds = w1555(v2.historyIds ?? []);
      await v1555(local_1_1.filesDir_, v2);
      local_1_1.queue_ = v2;
      local_1_1.syncQueuedLeases_();
      return undefined;
    });
    local_1_1.gate_ = acc.catch(function () {});
    return acc;
  }
  protectQueued_(p0) {
    if (this.queuedLeases_.has(p0)) {
      return;
    }
    z51(this.filesDir_, p0);
    this.queuedLeases_.add(p0);
    return;
  }
  syncQueuedLeases_() {
    let v4;
    let acc = this.queue_.activeIds.concat(this.queue_.pendingIds, this.queue_.resultIds, this.queue_.historyIds ?? [], this.queue_.bootstrapIds.slice(this.queue_.bootstrapCursor));
    let v0 = new Set(acc);
    let v1 = v0[Symbol.iterator]();
    while (true) {
      v4 = v1.next();
      if (v4.done) break;
      this.protectQueued_(v4.value);
    }
    for (v4 of Array.from(this.queuedLeases_)) {
      if (!v0.has(v4)) {
        this.queuedLeases_.delete(v4);
        a52(this.filesDir_, v4);
      }
    }
  }
  saveState_(p0) {
    let acc;
    let local_1_1 = this;
    let local_1_0 = p0;
    acc = local_1_1.gate_.then(async function () {
      let v0 = await s1555(local_1_1.filesDir_, local_1_0.session);
      if (v0.outcomeRevision > local_1_0.outcomeRevision) {
        throw new Error("恢复检查点版本变化，旧结果不能提交");
      }
      local_1_0.presentationRevision = Math.max(local_1_0.presentationRevision, Math.min(v0.presentationRevision, local_1_0.outcomeRevision));
      local_1_0.historyRevision = Math.max(local_1_0.historyRevision, Math.min(v0.historyRevision, local_1_0.outcomeRevision));
      if (v0.presentationMode === "auto") {
        local_1_0.presentationMode = "auto";
      }
      await t1555(local_1_1.filesDir_, local_1_0);
      return undefined;
    });
    local_1_1.gate_ = acc.catch(function () {});
    return acc;
  }
  async bootstrap_() {
    let v0, v4, v5, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, acc;
    let local_1_0;
    this.queue_ = await u1555(this.filesDir_);
    this.syncQueuedLeases_();
    v4 = (await l47(this.filesDir_)).sort(function (p0, p1) {
      return p0.startedAt - p1.startedAt;
    });
    v5 = new Map();
    this.launchOrder_ = [];
    this.launchIdentities_.clear();
    this.nextLaunchById_.clear();
    this.removedLaunches_.clear();
    for (v9 of v4) {
      this.protectQueued_(v9.activityId);
      v5.set(v9.activityId, v9);
      this.observeLaunch_(v9);
    }
    for (v9 of this.queue_.activeIds) {
      if (!v5.has(v9)) {
        this.observeIntent_(v9, "");
      }
    }
    if (this.queue_.bootstrapIds.length === 0) {
      v4 = v4.map(function (p0) {
        return p0.activityId;
      });
      local_1_0 = v4.sort(function (p0, p1) {
        return p0 - p1;
      });
      await this.mutate_(function (p0) {
        p0.bootstrapIds = local_1_0;
        p0.bootstrapCursor = 0;
      });
      this.stats_.bootstrapCommits = this.stats_.bootstrapCommits + 1;
    }
    while (this.queue_.bootstrapCursor < this.queue_.bootstrapIds.length) {
      let local_2_0, local_2_1;
      v10 = this.queue_.bootstrapCursor;
      local_2_1 = Math.min(this.queue_.bootstrapCursor + 16, this.queue_.bootstrapIds.length);
      for (local_2_0 = []; v10 < local_2_1; v10 += 1) {
        v12 = v5.get(this.queue_.bootstrapIds[v10]);
        if (v12 === undefined) {
          throw new Error("迁移活动清单丢失或损坏，未处理批次游标保留");
        }
        v0 = await s1555(this.filesDir_, this.session_(v12));
        v13 = v0;
        v14 = v12.state === p52.RUNNING || this.queue_.activeIds.includes(this.queue_.bootstrapIds[v10]);
        v15 = v0.presentationMode !== "history"
          && v0.outcome !== undefined
          && v0.presentationRevision < v0.outcomeRevision;
        if (this.splitAdmission_) {
          v16 = v14
            || v0.presentationMode !== "history"
            && v0.outcome !== undefined
            && v0.presentationRevision < v0.outcomeRevision
            || this.queue_.pendingIds.includes(this.queue_.bootstrapIds[v10]);
          if (!v16 && (v16 = v0.presentationMode !== "history", v0.presentationMode !== "history")) {
            v16 = v0.historyRevision < v0.outcomeRevision;
          }
          v17 = v0.policy !== 3
            || v0.inputKey.length === 0
            || v0.outcome === undefined
            || v0.historyRevision < v0.outcomeRevision;
          if (v16) {
            v12 = v16;
          } else if (!v17) {
            v0 = await this.inputKey_(v12);
            v17 = v0 === v13.inputKey;
            if (!v17) {
              v12 = v0 !== v13.inputKey;
            } else if (!(await this.artifactsMatch_(v12, v13))) {
              v17 = true;
              v12 = v0 !== v13.inputKey;
            } else {
              v17 = false;
              v12 = v0 !== v13.inputKey;
            }
          } else {
            v12 = v16;
          }
          v18 = {
            "id": this.queue_.bootstrapIds[v10],
            "pending": v12,
            "active": v14,
            "result": v15,
            "history": null
          };
          v11 = !v12;
          if (!v11) {
            v17 = v11;
          }
          v18.history = v17;
          local_2_0.push(v18);
        } else {
          v16 = await this.inputKey_(v12);
          v0 = await this.artifactsMatch_(v12, v0);
          v19 = {
            "id": this.queue_.bootstrapIds[v10],
            "pending": null,
            "active": null,
            "result": null
          };
          v11 = v13.inputKey !== v16 || v13.policy !== 3;
          if (v13.inputKey === v16 && v13.policy === 3) {
            v11 = !v0;
          }
          if (!v11) {
            v11 = v13.historyRevision < v13.outcomeRevision;
          }
          v19.pending = v11;
          v19.active = v14;
          v19.result = v15;
          local_2_0.push(v19);
        }
      }
      acc = this.mutate_(function (p0) {
        let v3 /*q1562*/;
        for (v3 of local_2_0) {
          let local_3_2_0 = v3;
          if (local_3_2_0.pending) {
            p0.pendingIds.push(local_3_2_0.id);
          }
          if (local_3_2_0.history) {
            v3 = p0.historyIds;
            switch (p0.historyIds) {
              case null:
              case undefined:
                v3 = [];
                p0.historyIds = v3;
                break;
            }
            v3.push(local_3_2_0.id);
          } else {
            v3 = p0.historyIds ?? [];
            p0.historyIds = v3.filter(function (p0) {
              return p0 !== local_3_2_0.id;
            });
          }
          if (local_3_2_0.active) {
            p0.activeIds.push(local_3_2_0.id);
          }
          if (local_3_2_0.result) {
            p0.resultIds.push(local_3_2_0.id);
          } else {
            p0.resultIds = p0.resultIds.filter(function (p0) {
              return p0 !== local_3_2_0.id;
            });
          }
        }
        p0.bootstrapCursor = local_2_1;
      });
      await acc;
      this.stats_.bootstrapCommits = this.stats_.bootstrapCommits + 1;
    }
    await this.mutate_(function (p0) {
      p0.bootstrapIds = [];
      p0.bootstrapCursor = 0;
    });
    this.stats_.bootstrapCommits = this.stats_.bootstrapCommits + 1;
    return undefined;
  }
  observeLaunch_(p0) {
    let v1, v5;
    let v0 = p0.category !== "launch";
    if (p0.category === "launch") {
      v0 = !Number.isSafeInteger(p0.activityId);
    }
    v1 = 0;
    if (!v0) {
      v0 = p0.activityId <= 0;
    }
    if (v0 || p0.startedAt !== p0.activityId) {
      throw new Error("launch边界身份无效，恢复已停止");
    }
    this.removedLaunches_.delete(p0.activityId);
    v5 = {
      "activityId": p0.activityId,
      "startedAt": p0.startedAt,
      "runNonce": p0.runNonce ?? "",
      "ownerPid": null
    };
    if (p0.ownerPid !== null && p0.ownerPid !== undefined) {
      v1 = p0.ownerPid;
    }
    v5.ownerPid = v1;
    this.observeBoundary_(p0.activityId, JSON.stringify(v5));
    return;
  }
  observeBoundary_(p0, p1) {
    let v1, v3, v4, v5;
    if (this.launchIdentities_.get(p0) === p1) {
      return;
    }
    if (!this.launchIdentities_.has(p0)) {
      v3 = this.launchOrder_.length;
      v4 = 0;
      while (v4 < v3) {
        v5 = Math.floor((v4 + v3) / 2);
        if (this.launchOrder_[v5] < p0) {
          v4 = v5 + 1;
        } else {
          v3 = v5;
        }
      }
      v1 = this.launchOrder_[v4] ?? 0;
      if (v4 > 0) {
        this.nextLaunchById_.set(this.launchOrder_[v4 - 1], p0);
      }
      this.launchOrder_.splice(v4, 0, p0);
      this.nextLaunchById_.set(p0, v1);
    }
    this.launchIdentities_.set(p0, p1);
    this.boundaryGeneration_ = this.boundaryGeneration_ + 1;
    return;
  }
  observeIntent_(p0, p1) {
    let v0 = this.launchIdentities_.get(p0);
    if (v0 === undefined) {
      this.observeBoundary_(p0, "intent:" + p1);
      return;
    }
    if (!v0.startsWith("intent:")) {
      return;
    }
    this.observeBoundary_(p0, "intent:" + p1);
    return;
  }
  withdrawIntentBoundary_(p0) {
    let v1, v2;
    let v0 = this.launchIdentities_.get(p0);
    if (!(v0 == null ? undefined : v0.startsWith("intent:"))) {
      return;
    }
    v1 = this.launchOrder_.indexOf(p0);
    v2 = this.nextLaunchById_.get(p0) ?? 0;
    if (v1 > 0) {
      this.nextLaunchById_.set(this.launchOrder_[v1 - 1], v2);
    }
    if (v1 >= 0) {
      this.launchOrder_.splice(v1, 1);
    }
    this.launchIdentities_.delete(p0);
    this.nextLaunchById_.delete(p0);
    this.boundaryGeneration_ = this.boundaryGeneration_ + 1;
    return;
  }
  boundary_(p0) {
    this.stats_.boundaryLookups = this.stats_.boundaryLookups + 1;
    return {
      "generation": this.boundaryGeneration_,
      "nextLaunchAt": this.nextLaunchById_.get(p0) ?? 0
    };
  }
  boundaryCurrent_(p0, p1) {
    let v2;
    let v0 = p1.generation === this.boundaryGeneration_;
    if (p1.generation === this.boundaryGeneration_) {
      v2 = this.nextLaunchById_.get(p0);
      v0 = p1.nextLaunchAt === (v2 ?? 0);
    }
    return v0;
  }
  session_(p0) {
    return {
      "startedAt": p0.activityId,
      "version": p0.gameVersionId || p0.title,
      "mcDir": p0.mcDir,
      "endedAt": p0.endedAt > 0 && p0.endTimeEstimated !== true ? p0.endedAt : undefined
    };
  }
  async artifactsMatch_(p0, p1) {
    let v0;
    if (p1.committedOutcomeKey === local_0_1(p0)) {
      v0 = await v155(this.filesDir_, p0.activityId);
      return v0 !== undefined
        && v0.revision === p1.committedEvidenceRevision
        && p1.committedEvidenceKey === (await s51(p46(this.filesDir_, p0.activityId) + "/evidence-manifest.json"));
    }
    return false;
  }
  async producerInputKey_(p0) {
    let v0, v5, v8, v10;
    let v3 = p46(this.filesDir_, p0.activityId);
    let v4 = [this.filesDir_ + "/game-exits/" + p0.activityId + ".json", v3 + "/native-io.json", v3 + "/capture-game.json", v3 + "/game-terminal.json", v3 + "/game-metadata.json"];
    v3 = [];
    v5 = 0;
    for (v10 of v4) {
      v0 = await m1062(v10, 65536);
      v10 = v0;
      if (v0) {
        throw v0;
      }
      if (v0.length !== 0 || this.emptyPublicationDigest_ === undefined) {
        v0 = await x1555(v0);
        if (v0) {
          throw v0;
        }
        v3.push(v0);
        if (v10.length === 0) {
          this.emptyPublicationDigest_ = v0;
        }
        continue;
      }
      v3.push(this.emptyPublicationDigest_);
    }
    v8 = {
      "activityId": p0.activityId,
      "runNonce": p0.runNonce ?? "",
      "ownerPid": null,
      "publications": null
    };
    if (p0.ownerPid !== null && p0.ownerPid !== undefined) {
      v5 = p0.ownerPid;
    }
    v8.ownerPid = v5;
    v8.publications = v3;
    return x1555(JSON.stringify(v8));
  }
  async inputKey_(p0) {
    return (await this.inputSnapshot_(p0)).inputKey;
  }
  async inputSnapshot_(p0) {
    let v0, v2, v8;
    if (p0.outcomeSource.startsWith("platform.")) {
      v2 = JSON.stringify({
        "state": p0.state,
        "source": p0.outcomeSource,
        "summary": p0.outcomeSummary,
        "endedAt": p0.endedAt,
        "estimated": p0.endTimeEstimated
      });
    } else {
      v2 = "";
    }
    v0 = await this.producerInputKey_(p0);
    v8 = {
      "producer": v0,
      "platform": v2,
      "platformInputKey": p0.platformInputKey ?? ""
    };
    return {
      "producerKey": v0,
      "inputKey": await x1555(JSON.stringify(v8))
    };
  }
  async trackLaunch(p0, p1) {
    let v4, v5, v7;
    if (p1 === undefined) {
      p1 = "";
    }
    await this.initialize();
    v4 = 0;
    if (!Number.isSafeInteger(p0) || p0 <= 0) {
      throw new Error("启动意图活动身份无效");
    }
    if (p1.length > v4) {
      if (!new RegExp("^[a-zA-Z0-9-]{1,128}$").test(p1)) {
        throw new Error("启动意图token无效");
      }
      v5 = this.admissionJobs_.get(p0);
      if (v5 !== undefined) {
        if (this.admissionTokens_.get(p0) === p1) {
          return v5;
        }
      }
      if (this.admittedLaunches_.size > v4) {
        if (!this.admittedLaunches_.has(p0)) {
          throw new Error("已有另一启动准入意图，等待其派发或同身份撤回");
        }
        if (!this.admittedLaunches_.has(p0)) {
          this.admittedLaunches_.add(p0);
          this.admissionTokens_.set(p0, p1);
          v5 = this.admitLaunch_(p0, p1);
          this.admissionJobs_.set(p0, v5);
          try {
            await v5;
            this.grantedLaunches_.add(p0);
            if (this.admissionJobs_.get(p0) === v5) {
              this.admissionJobs_.delete(p0);
            }
            if (hole == v7) {
              return undefined;
            }
            throw v7;
          } catch (catchAcc) {
            if (!this.queue_.activeIds.includes(p0)) {
              if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
                this.admittedLaunches_.delete(p0);
                this.admissionTokens_.delete(p0);
                this.withdrawIntentBoundary_(p0);
                this.grantedLaunches_.delete(p0);
              }
            }
            throw catchAcc;
          }
        } else if (this.admissionTokens_.get(p0) !== p1) {
          throw new Error("同活动已有不同启动准入token，原意图保留");
        } else if (this.grantedLaunches_.has(p0)) {
          return undefined;
        } else {
          this.admittedLaunches_.add(p0);
          this.admissionTokens_.set(p0, p1);
          v5 = this.admitLaunch_(p0, p1);
          this.admissionJobs_.set(p0, v5);
          try {
            await v5;
            this.grantedLaunches_.add(p0);
            if (this.admissionJobs_.get(p0) === v5) {
              this.admissionJobs_.delete(p0);
            }
            if (hole == v7) {
              return undefined;
            }
            throw v7;
          } catch (catchAcc) {
            if (!this.queue_.activeIds.includes(p0)) {
              if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
                this.admittedLaunches_.delete(p0);
                this.admissionTokens_.delete(p0);
                this.withdrawIntentBoundary_(p0);
                this.grantedLaunches_.delete(p0);
              }
            }
            throw catchAcc;
          }
        }
      } else if (!this.admittedLaunches_.has(p0)) {
        this.admittedLaunches_.add(p0);
        this.admissionTokens_.set(p0, p1);
        v5 = this.admitLaunch_(p0, p1);
        this.admissionJobs_.set(p0, v5);
        try {
          await v5;
          this.grantedLaunches_.add(p0);
          if (this.admissionJobs_.get(p0) === v5) {
            this.admissionJobs_.delete(p0);
          }
          if (hole == v7) {
            return undefined;
          }
          throw v7;
        } catch (catchAcc) {
          if (!this.queue_.activeIds.includes(p0)) {
            if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
              this.admittedLaunches_.delete(p0);
              this.admissionTokens_.delete(p0);
              this.withdrawIntentBoundary_(p0);
              this.grantedLaunches_.delete(p0);
            }
          }
          throw catchAcc;
        }
      } else if (this.admissionTokens_.get(p0) !== p1) {
        throw new Error("同活动已有不同启动准入token，原意图保留");
      } else if (this.grantedLaunches_.has(p0)) {
        return undefined;
      } else {
        this.admittedLaunches_.add(p0);
        this.admissionTokens_.set(p0, p1);
        v5 = this.admitLaunch_(p0, p1);
        this.admissionJobs_.set(p0, v5);
        try {
          await v5;
          this.grantedLaunches_.add(p0);
          if (this.admissionJobs_.get(p0) === v5) {
            this.admissionJobs_.delete(p0);
          }
          if (hole == v7) {
            return undefined;
          }
          throw v7;
        } catch (catchAcc) {
          if (!this.queue_.activeIds.includes(p0)) {
            if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
              this.admittedLaunches_.delete(p0);
              this.admissionTokens_.delete(p0);
              this.withdrawIntentBoundary_(p0);
              this.grantedLaunches_.delete(p0);
            }
          }
          throw catchAcc;
        }
      }
    } else {
      v5 = this.admissionJobs_.get(p0);
      if (v5 !== undefined) {
        if (this.admissionTokens_.get(p0) === p1) {
          return v5;
        }
      }
      if (this.admittedLaunches_.size > v4) {
        if (!this.admittedLaunches_.has(p0)) {
          throw new Error("已有另一启动准入意图，等待其派发或同身份撤回");
        }
        if (!this.admittedLaunches_.has(p0)) {
          this.admittedLaunches_.add(p0);
          this.admissionTokens_.set(p0, p1);
          v5 = this.admitLaunch_(p0, p1);
          this.admissionJobs_.set(p0, v5);
          try {
            await v5;
            this.grantedLaunches_.add(p0);
            if (this.admissionJobs_.get(p0) === v5) {
              this.admissionJobs_.delete(p0);
            }
            if (hole == v7) {
              return undefined;
            }
            throw v7;
          } catch (catchAcc) {
            if (!this.queue_.activeIds.includes(p0)) {
              if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
                this.admittedLaunches_.delete(p0);
                this.admissionTokens_.delete(p0);
                this.withdrawIntentBoundary_(p0);
                this.grantedLaunches_.delete(p0);
              }
            }
            throw catchAcc;
          }
        } else if (this.admissionTokens_.get(p0) !== p1) {
          throw new Error("同活动已有不同启动准入token，原意图保留");
        } else if (this.grantedLaunches_.has(p0)) {
          return undefined;
        } else {
          this.admittedLaunches_.add(p0);
          this.admissionTokens_.set(p0, p1);
          v5 = this.admitLaunch_(p0, p1);
          this.admissionJobs_.set(p0, v5);
          try {
            await v5;
            this.grantedLaunches_.add(p0);
            if (this.admissionJobs_.get(p0) === v5) {
              this.admissionJobs_.delete(p0);
            }
            if (hole == v7) {
              return undefined;
            }
            throw v7;
          } catch (catchAcc) {
            if (!this.queue_.activeIds.includes(p0)) {
              if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
                this.admittedLaunches_.delete(p0);
                this.admissionTokens_.delete(p0);
                this.withdrawIntentBoundary_(p0);
                this.grantedLaunches_.delete(p0);
              }
            }
            throw catchAcc;
          }
        }
      } else if (!this.admittedLaunches_.has(p0)) {
        this.admittedLaunches_.add(p0);
        this.admissionTokens_.set(p0, p1);
        v5 = this.admitLaunch_(p0, p1);
        this.admissionJobs_.set(p0, v5);
        try {
          await v5;
          this.grantedLaunches_.add(p0);
        } catch (catchAcc) {
          if (!this.queue_.activeIds.includes(p0)) {
            if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
              this.admittedLaunches_.delete(p0);
              this.admissionTokens_.delete(p0);
              this.withdrawIntentBoundary_(p0);
              this.grantedLaunches_.delete(p0);
            }
          }
          throw catchAcc;
        } finally {
          if (this.admissionJobs_.get(p0) === v5) {
            this.admissionJobs_.delete(p0);
          }
        }
      } else if (this.admissionTokens_.get(p0) !== p1) {
        throw new Error("同活动已有不同启动准入token，原意图保留");
      } else if (this.grantedLaunches_.has(p0)) {
        return undefined;
      } else {
        this.admittedLaunches_.add(p0);
        this.admissionTokens_.set(p0, p1);
        v5 = this.admitLaunch_(p0, p1);
        this.admissionJobs_.set(p0, v5);
        try {
          await v5;
          this.grantedLaunches_.add(p0);
          if (this.admissionJobs_.get(p0) === v5) {
            this.admissionJobs_.delete(p0);
          }
          if (hole == v7) {
            return undefined;
          }
          throw v7;
        } catch (catchAcc) {
          if (!this.queue_.activeIds.includes(p0)) {
            if ((await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096)).length === v4) {
              this.admittedLaunches_.delete(p0);
              this.admissionTokens_.delete(p0);
              this.withdrawIntentBoundary_(p0);
              this.grantedLaunches_.delete(p0);
            }
          }
          throw catchAcc;
        }
      }
    }
  }
  async admitLaunch_(p0, p1) {
    let v0, v4 /*i47*/, v6 /*s1555*/, acc;
    let local_1_1;
    let local_1_2 = this;
    let local_1_0 = p0;
    if (p1.length > 0) {
      if (!new RegExp("^[a-zA-Z0-9-]{1,128}$").test(p1)) {
        throw new Error("启动意图token无效");
      }
      await f52(local_1_2.filesDir_ + "/logs/recovery/intents");
      v6 = JSON.stringify({
        "schema": 1,
        "activityId": local_1_0,
        "intentToken": p1
      });
      v0 = await m1062(local_1_2.filesDir_ + "/logs/recovery/intents" + "/" + local_1_0 + ".json", 4096);
      if (v0.length > 0 && v0 !== v6) {
        throw new Error("同活动已有不同启动意图，原件保留");
      }
      if (v0.length === 0) {
        await o51(local_1_2.filesDir_ + "/logs/recovery/intents" + "/" + local_1_0 + ".json", v6);
      }
    }
    await local_1_2.mutate_(function (p0) {
      p0.activeIds.push(local_1_0);
    });
    local_1_2.observeIntent_(local_1_0, p1);
    if (local_1_2.activeRecovery_ !== undefined) {
      await local_1_2.activeRecovery_.catch(function () {});
    }
    if (local_1_2.draining_ !== undefined) {
      await local_1_2.draining_.catch(function () {});
    }
    if (local_1_2.waking_ !== undefined) {
      await local_1_2.waking_;
    }
    if (local_1_2.hooks_.beforeGameAdmission !== undefined) {
      await local_1_2.hooks_.beforeGameAdmission();
    }
    if (!local_1_2.hooks_.isIdle()) {
      throw new Error("游戏启动准入时进程活跃或状态未知，意图保留");
    }
    if (local_1_2.splitAdmission_) {
      await local_1_2.drainInternal_(true);
    }
    v4 = local_1_2.launchOrder_.filter(function (p0) {
      return p0 < local_1_0;
    }).pop();
    if (v4 === undefined) {
      v4 = undefined;
    } else if (local_1_2.removedLaunches_.has(v4)) {
      v4 = undefined;
    }
    local_1_1 = v4;
    if (local_1_2.splitAdmission_ && local_1_1 !== undefined) {
      if ((local_1_2.queue_.historyIds ?? []).includes(local_1_1)) {
        v0 = await i47(local_1_2.filesDir_, local_1_1);
        if (v0 === null) {
          throw new Error("新游戏覆盖来源保护清单不可读，启动意图保留");
        }
        v4 = local_1_2.recover_(v0, true, true);
        local_1_2.activeRecovery_ = v4;
        try {
          await v4;
        } finally {
          if (local_1_2.activeRecovery_ === v4) {
            local_1_2.activeRecovery_ = undefined;
          }
        }
        if (local_1_2.queue_.pendingIds.includes(local_1_1)) {
          throw new Error("游戏启动前来源保护出现新输入，需再次恢复");
        }
        acc = local_1_2.mutate_(function (p0) {
          let v0 = p0.historyIds ?? [];
          p0.historyIds = v0.filter(function (p0) {
            return p0 !== local_1_1;
          });
        });
        await acc;
      }
    }
    while (local_1_2.splitAdmission_) {
      let local_2_0, local_2_1, local_2_2, local_2_3;
      if (!local_1_2.hooks_.isIdle()) {
        throw new Error("游戏启动准入期间进程状态变化，意图保留");
      }
      await local_1_2.wake();
      await local_1_2.drainInternal_(true);
      if (local_1_2.hooks_.beforeGameAdmission !== undefined) {
        await local_1_2.hooks_.beforeGameAdmission();
      }
      local_2_1 = local_1_2.inputRequestGeneration_;
      local_2_2 = local_1_2.wakeGeneration_;
      local_2_3 = local_1_2.boundary_(local_1_0);
      if (local_1_1 !== undefined) {
        v0 = await i47(local_1_2.filesDir_, local_1_1);
        if (v0 === null) {
          throw new Error("游戏准入末门无法读取上局保护清单");
        }
        if ((await s1555(local_1_2.filesDir_, local_1_2.session_(v0))).inputKey !== (await local_1_2.inputKey_(v0))) {
          await local_1_2.enqueue(local_1_1);
          continue;
        }
      }
      local_2_0 = false;
      acc = local_1_2.gate_.then(function () {
        let v0 /*i1560*/ = local_2_1 === local_1_2.inputRequestGeneration_
          && local_1_2.queue_.pendingIds.length === 0
          && local_2_2 === local_1_2.wakeGeneration_
          && local_1_2.waking_ === undefined
          && local_1_2.platformApplied_ === local_1_2.platformEpoch_
          && local_1_2.platformRetryApplied_ === local_1_2.platformRetryEpoch_
          && local_1_2.boundaryCurrent_(local_1_0, local_2_3)
          && local_1_2.hooks_.isIdle();
        if (v0 && (v0 = local_1_2.hooks_.admissionBarrierCurrent === undefined, local_1_2.hooks_.admissionBarrierCurrent !== undefined)) {
          v0 = local_1_2.hooks_.admissionBarrierCurrent();
        }
        local_2_0 = v0;
      });
      local_1_2.gate_ = acc.catch(function () {});
      await acc;
      if (local_2_0) {
        break;
      }
    }
    return undefined;
  }
  async recordLaunchDispatchFailure(p0, p1, p2, p3) {
    let v0, v7, acc;
    let local_1_2;
    let local_1_3 = this;
    let local_1_0 = p0;
    let local_1_1 = p1;
    if (!Number.isSafeInteger(local_1_0) || local_1_0 <= 0 || !new RegExp("^[a-zA-Z0-9-]{1,128}$").test(local_1_1) || p2.length === 0 || p2.length > 128 || p3.length > 65536) {
      throw new Error("启动派发失败原件身份或大小无效");
    }
    await f52(local_1_3.filesDir_ + "/logs/recovery/dispatch-failures");
    v7 = JSON.stringify({
      "schema": 1,
      "activityId": local_1_0,
      "intentToken": local_1_1,
      "stage": p2,
      "rawError": p3
    });
    if (l50(v7) > 131072) {
      throw new Error("启动派发失败原件超过持久读取上限，意图保留");
    }
    v0 = await m1062(local_1_3.filesDir_ + "/logs/recovery/dispatch-failures" + "/" + local_1_0 + "-" + local_1_1 + ".json", 131072);
    if (v0.length > 0 && v0 !== v7) {
      await o51(local_1_3.filesDir_ + "/logs/recovery/dispatch-failures" + "/" + local_1_0 + "-" + local_1_1 + "-" + util.generateRandomUUID() + ".json", v7);
      throw new Error("同启动意图已有不同派发失败原件，双方原文已保留等待核实");
    }
    if (v0.length === 0) {
      await o51(local_1_3.filesDir_ + "/logs/recovery/dispatch-failures" + "/" + local_1_0 + "-" + local_1_1 + ".json", v7);
    }
    await local_1_3.initialize();
    local_1_2 = false;
    acc = local_1_3.gate_.then(async function () {
      let v0, v4 /*c878*/, v5 /*v1555*/, v6, v8;
      if (!local_1_3.hooks_.isIdle()) {
        return undefined;
      }
      v0 = await m1062(local_1_3.filesDir_ + "/logs/recovery/intents/" + local_1_0 + ".json", 4096);
      v5 = 0;
      if (v0.length === 0) {
        return undefined;
      }
      v4 = JSON.parse(v0);
      if (v4.schema !== 1 || v4.activityId !== local_1_0 || v4.intentToken !== local_1_1) {
        return undefined;
      }
      v6 = [p46(local_1_3.filesDir_, local_1_0) + "/manifest.json", local_1_3.filesDir_ + "/game-exits/" + local_1_0 + ".json", p46(local_1_3.filesDir_, local_1_0) + "/game-terminal.json"];
      for (v8 of v6) {
        if ((await m1062(v8)).length > v5) return undefined;
      }
      if ((await c878.readPendingAsync(local_1_3.filesDir_))?.startedAt === local_1_0) {
        return undefined;
      }
      if (!local_1_3.hooks_.isIdle()) {
        return undefined;
      }
      v4 = local_0_0(local_1_3.queue_);
      v4.activeIds = v4.activeIds.filter(function (p0) {
        return p0 !== local_1_0;
      });
      v4.pendingIds = v4.pendingIds.filter(function (p0) {
        return p0 !== local_1_0;
      });
      v5 = v4.historyIds ?? [];
      v4.historyIds = v5.filter(function (p0) {
        return p0 !== local_1_0;
      });
      await v1555(local_1_3.filesDir_, v4);
      local_1_3.queue_ = v4;
      local_1_2 = true;
      local_1_3.syncQueuedLeases_();
      local_1_3.withdrawIntentBoundary_(local_1_0);
      local_1_3.admittedLaunches_.delete(local_1_0);
      local_1_3.admissionTokens_.delete(local_1_0);
      local_1_3.grantedLaunches_.delete(local_1_0);
      return undefined;
    });
    local_1_3.gate_ = acc.catch(function () {});
    await acc;
    return local_1_2;
  }
  async reconcileLaunchDispatchFailure_(p0) {
    let v3 /*m1062*/, v5, v6;
    let v0 = await m1062(this.filesDir_ + "/logs/recovery/intents/" + p0 + ".json", 4096);
    if (v0.length === 0) {
      return false;
    }
    v3 = JSON.parse(v0);
    v5 = v3.intentToken;
    v6 = v3.schema !== 1;
    if (v3.schema === 1) {
      v6 = v3.activityId !== p0;
    }
    if (!v6) {
      v6 = typeof v3.intentToken !== "string";
    }
    if (!v6) {
      if (!new RegExp("^[a-zA-Z0-9-]{1,128}$").test(v3.intentToken)) {
        throw new Error("启动意图身份无效，原件保留");
      }
      v0 = await m1062(this.filesDir_ + "/logs/recovery/dispatch-failures/" + p0 + "-" + v3.intentToken + ".json", 131072);
      if (v0.length === 0) {
        return false;
      }
      v3 = JSON.parse(v0);
      if (v3.schema !== 1 || v3.activityId !== p0 || v3.intentToken !== v5 || typeof v3.stage !== "string" || typeof v3.rawError !== "string") {
        throw new Error("启动派发失败原件身份无效，原件保留");
      }
      return this.recordLaunchDispatchFailure(p0, v5, v3.stage, v3.rawError);
    }
    throw new Error("启动意图身份无效，原件保留");
  }
  async enqueue(p0) {
    let v0, v7, acc;
    let local_1_0 = p0;
    this.inputRequestGeneration_ = this.inputRequestGeneration_ + 1;
    await this.initialize();
    v0 = await i47(this.filesDir_, local_1_0);
    if (v0?.category === "launch") {
      this.observeLaunch_(v0);
    }
    this.stats_.requests = this.stats_.requests + 1;
    if (this.queue_.pendingIds.includes(local_1_0)) {
      this.stats_.merged = this.stats_.merged + 1;
    }
    v7 = this.requests_.get(local_1_0);
    this.requests_.set(local_1_0, (v7 ?? 0) + 1);
    acc = this.mutate_(function (p0) {
      let v0;
      p0.pendingIds.push(local_1_0);
      v0 = p0.historyIds ?? [];
      p0.historyIds = v0.filter(function (p0) {
        return p0 !== local_1_0;
      });
    });
    await acc;
    return undefined;
  }
  notifyPlatformPublication() {
    this.platformEpoch_ = this.platformEpoch_ + 1;
  }
  wake() {
    let v0 /*w1558*/;
    let local_1_0;
    let local_1_1 = this;
    if (local_1_1.waking_ === undefined) {
      local_1_1.wakeGeneration_ = local_1_1.wakeGeneration_ + 1;
      local_1_0 = async function () {
        do {
          local_1_1.wakeRequested_ = false;
          await local_1_1.wakeInternal_();
        } while (local_1_1.wakeRequested_);
        return undefined;
      }();
      local_1_1.waking_ = local_1_0;
      v0 = function () {
        if (local_1_1.waking_ === local_1_0) {
          local_1_1.waking_ = undefined;
        }
      };
      local_1_0.then(v0, v0);
      return local_1_0;
    }
    local_1_1.wakeRequested_ = true;
    return local_1_1.waking_;
  }
  async wakeInternal_() {
    let v0, v9, acc;
    let local_1_0;
    let local_1_1 = this;
    await local_1_1.initialize();
    if (!local_1_1.hooks_.isIdle()) {
      return undefined;
    }
    v0 = await m1062(local_1_1.filesDir_ + "/logs/platform-events/publication.json", 4096);
    if (v0 !== local_1_1.platformPublicationKey_) {
      local_1_1.platformPublicationKey_ = v0;
      local_1_1.platformEpoch_ = local_1_1.platformEpoch_ + 1;
    }
    local_1_0 = await c878.readPendingAsync(local_1_1.filesDir_);
    if (local_1_0 !== null) {
      await m47(local_1_1.filesDir_, local_1_0.startedAt, {
        "category": "launch",
        "title": local_1_0.version,
        "gameVersionId": local_1_0.version,
        "mcDir": local_1_0.mcDir
      });
      await local_1_1.enqueue(local_1_0.startedAt);
      acc = local_1_1.gate_.then(async function () {
        if (local_1_1.hooks_.isIdle()) {
          await c878.clearMatchingAsync(local_1_1.filesDir_, local_1_0);
        }
        return undefined;
      });
      local_1_1.gate_ = acc.catch(function () {});
      await acc;
    }
    for (v9 of local_1_1.queue_.activeIds.slice()) {
      if (await local_1_1.reconcileLaunchDispatchFailure_(v9)) {
        continue;
      }
      if (local_1_1.admittedLaunches_.has(v9)) {
        v0 = await i47(local_1_1.filesDir_, v9);
        if (v0 === null) {
          continue;
        }
        if (!local_1_1.hooks_.isIdle()) {
          return undefined;
        }
        if (local_1_0?.startedAt !== v9 && (await m1062(local_1_1.filesDir_ + "/game-exits/" + v9 + ".json", 65536)).length === 0) {
          if ((await m1062(p46(local_1_1.filesDir_, v9) + "/game-terminal.json", 65536)).length === 0) {
            continue;
          }
        }
        local_1_1.observeLaunch_(v0);
        local_1_1.admittedLaunches_.delete(v9);
        local_1_1.admissionTokens_.delete(v9);
        local_1_1.grantedLaunches_.delete(v9);
      }
      await local_1_1.enqueue(v9);
    }
    local_1_1.platformRetryEpoch_ = local_1_1.platformRetryEpoch_ + 1;
    await local_1_1.drain_();
    return undefined;
  }
  drain_() {
    let local_1_0;
    let local_1_1 = this;
    if (local_1_1.draining_ === undefined) {
      local_1_0 = local_1_1.drainInternal_().catch(function (p0) {
        local_1_1.stats_.retries = local_1_1.stats_.retries + 1;
        throw p0;
      });
      local_1_1.draining_ = local_1_0;
      local_1_0.then(function () {
        if (local_1_1.draining_ === local_1_0) {
          local_1_1.draining_ = undefined;
        }
      }, function () {
        if (local_1_1.draining_ === local_1_0) {
          local_1_1.draining_ = undefined;
        }
      });
      return local_1_0;
    }
    return local_1_1.draining_;
  }
  async drainInternal_(p0) {
    let v7, v11, acc;
    let local_1_0 = this;
    if (p0 === undefined) {
      p0 = false;
    }
    while (true) {
      if (!local_1_0.hooks_.isIdle()) {
        if (local_1_0.hooks_.isIdle()) {
          await j49(local_1_0.filesDir_);
        }
        return undefined;
      }
      {
        let local_2_0, local_2_1, local_2_2;
        if (local_1_0.admittedLaunches_.size > 0) {
          if (!p0) {
            break;
          }
        }
        if (local_1_0.activeRecovery_ !== undefined) {
          await local_1_0.activeRecovery_.catch(function () {});
          continue;
        }
        if (local_1_0.platformRetryApplied_ !== local_1_0.platformRetryEpoch_) {
          for (v11 of await b50(local_1_0.filesDir_)) {
            await local_1_0.enqueue(v11);
          }
          local_1_0.platformRetryApplied_ = local_1_0.platformRetryEpoch_;
        }
        if (local_1_0.platformApplied_ !== local_1_0.platformEpoch_) {
          for (v11 of await w49(local_1_0.filesDir_)) {
            await local_1_0.enqueue(v11);
          }
          local_1_0.platformApplied_ = local_1_0.platformEpoch_;
        }
        local_2_0 = local_1_0.queue_.pendingIds[0];
        if (local_2_0 !== undefined) {
          local_2_1 = local_1_0.requests_.get(local_2_0) ?? 0;
          local_2_2 = await i47(local_1_0.filesDir_, local_2_0);
          if (local_2_2 === null) {
            throw new Error("待恢复活动清单丢失或损坏，原件和待办保留等待重试");
          }
          v7 = local_1_0.recover_(local_2_2, false, p0);
          local_1_0.activeRecovery_ = v7;
          try {
            await v7;
          } finally {
            if (local_1_0.activeRecovery_ === v7) {
              local_1_0.activeRecovery_ = undefined;
            }
          }
          acc = local_1_0.mutate_(function (p0) {
            if ((local_1_0.requests_.get(local_2_0) ?? 0) === local_2_1) {
              p0.pendingIds = p0.pendingIds.filter(function (p0) {
                return p0 !== local_2_0;
              });
            }
            if (local_2_2 !== null) {
              p0.activeIds = p0.activeIds.filter(function (p0) {
                return p0 !== local_2_0;
              });
            }
          });
          await acc;
          continue;
        }
        await local_1_0.gate_;
        if (local_1_0.queue_.pendingIds.length !== 0 || !local_1_0.candidateInputsChanged_) break;
        if (local_1_0.deferHistoricalCandidates_ && !local_1_0.criticalCandidatesChanged_ && !p0) {
          break;
        }
        local_1_0.candidateInputsChanged_ = false;
        local_1_0.criticalCandidatesChanged_ = false;
        local_1_0.platformEpoch_ = local_1_0.platformEpoch_ + 1;
      }
    }
    if (local_1_0.queue_.pendingIds.length === 0 && local_1_0.platformApplied_ === local_1_0.platformEpoch_) {}
  }
  backgroundMigration() {
    let v0 /*z1557*/;
    let local_1_0;
    let local_1_1 = this;
    if (local_1_1.migration_ === undefined) {
      local_1_0 = local_1_1.migrateHistory_();
      local_1_1.migration_ = local_1_0;
      v0 = function () {
        if (local_1_1.migration_ === local_1_0) {
          local_1_1.migration_ = undefined;
        }
      };
      local_1_0.then(v0, v0);
      return local_1_0;
    }
    return local_1_1.migration_;
  }
  async migrateHistory_() {
    let v0, v14, acc;
    await this.initialize();
    this.deferHistoricalCandidates_ = true;
    try {
      while (true) {
        v14 = this.hooks_.isIdle();
        if (v14 && (v14 = this.hooks_.canMigrate === undefined, this.hooks_.canMigrate !== undefined)) {
          v14 = this.hooks_.canMigrate();
        }
        if (!v14 || this.admittedLaunches_.size !== 0) {
          break;
        }
        {
          let local_1_0;
          await this.drain_();
          if (!this.hooks_.isIdle() || this.admittedLaunches_.size > 0) break;
          if (this.hooks_.canMigrate !== undefined && !this.hooks_.canMigrate()) {
            break;
          }
          local_1_0 = (this.queue_.historyIds ?? [])[0];
          if (local_1_0 === undefined) {
            break;
          }
          v0 = await i47(this.filesDir_, local_1_0);
          if (v0 === null) {
            throw new Error("历史迁移活动清单不可读，未完成义务保留");
          }
          if (this.activeRecovery_ === undefined && this.queue_.pendingIds.length <= 0) {
            if (this.admittedLaunches_.size <= 0) {
              if (!this.hooks_.isIdle()) {
                break;
              }
              acc = this.recover_(v0, true);
              this.activeRecovery_ = acc;
              try {
                await acc;
              } finally {
                if (this.activeRecovery_ === acc) {
                  this.activeRecovery_ = undefined;
                }
              }
              acc = this.mutate_(function (p0) {
                let v0 = p0.historyIds ?? [];
                p0.historyIds = v0.filter(function (p0) {
                  return p0 !== local_1_0;
                });
              });
              await acc;
              continue;
            }
            break;
          }
        }
      }
    } finally {
      this.deferHistoricalCandidates_ = false;
    }
    await this.drain_();
    this.hooks_.changed();
    return undefined;
  }
  async recover_(p0, p1, p2) {
    let v0, v7 /*x95*/, v8 /*i47*/, v9 /*s51*/, v10 /*v1556*/, v11 /*p46*/, v12, v13, v15 /*v1556*/, v17 /*s47*/, v20, acc;
    let local_1_0, local_1_1;
    let local_1_2 = this;
    if (p1 === undefined) {
      p1 = false;
    }
    if (p2 === undefined) {
      p2 = false;
    }
    z51(local_1_2.filesDir_, p0.activityId);
    try {
      local_1_0 = p0.activityId;
      v7 = await s1555(local_1_2.filesDir_, local_1_2.session_(p0));
      await p47(local_1_2.filesDir_, local_1_0);
      v8 = await i47(local_1_2.filesDir_, local_1_0);
      if (v8 === null) {
        throw new Error("恢复活动清单在准备期间不可读，原件保留");
      }
      local_1_2.observeLaunch_(v8);
      v0 = await local_1_2.inputSnapshot_(v8);
      v10 = v0.inputKey;
      v9 = v0.producerKey;
      v12 = v7.presentationMode;
      v7.presentationMode = !p1 || v7.inputKey.length > 0 && v0.inputKey !== v7.inputKey || v7.presentationMode === "auto" ? "auto" : "history";
      v11 = false;
      if (v0.producerKey !== v7.producerInputKey) {
        local_1_2.candidateInputsChanged_ = true;
        if (!p1) {
          local_1_2.criticalCandidatesChanged_ = true;
        }
      }
      v0 = await local_1_2.artifactsMatch_(v8, v7);
      v13 = v0;
      if (v10 === v7.inputKey && v7.policy === 3) {
        acc = !v0;
        if (acc) {
          local_1_1 = local_1_2.boundary_(local_1_0);
          v11 = local_1_1.nextLaunchAt;
          if (p2) {
            p2 = local_1_2.admittedLaunches_.has(local_1_1.nextLaunchAt);
          }
          if (p2) {
            v15 = local_1_2.launchIdentities_.get(local_1_1.nextLaunchAt);
            v15 = v15 == null ? undefined : v15.startsWith("intent:");
            p2 = v15 === true;
          }
          v0 = await o47(local_1_2.filesDir_, local_1_0);
          local_1_2.stats_.resolverCalls = local_1_2.stats_.resolverCalls + 1;
          try {
            acc = n1553(local_1_2.filesDir_, local_1_0, local_1_1.nextLaunchAt, v0?.outcome, function () {
              return local_1_2.boundaryCurrent_(local_1_0, local_1_1) && local_1_2.hooks_.isIdle();
            }, p2);
            v15 = await acc;
            if (!local_1_2.hooks_.isIdle()) {
              local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
              throw new Error("游戏进程重新活跃或状态未知，恢复提交已延后");
            }
            v0 = await i47(local_1_2.filesDir_, local_1_0);
            v17 = v0 === null ? "" : await local_1_2.inputKey_(v0);
            if (v0 === null || v0.runNonce !== v8.runNonce || v17 !== v10) {
              local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
              await local_1_2.enqueue(local_1_0);
              a52(local_1_2.filesDir_, p0.activityId);
              return undefined;
            }
            if (!local_1_2.boundaryCurrent_(local_1_0, local_1_1)) {
              local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
              await local_1_2.enqueue(local_1_0);
              a52(local_1_2.filesDir_, p0.activityId);
              return undefined;
            }
            try {
              v20 = {
                "nextLaunchAt": local_1_1.nextLaunchAt,
                "inputKey": v10,
                "expectedManifestRevision": v0.revision,
                "capturePrepared": true,
                "repairArtifacts": !v13,
                "commitGuard": function () {
                  return local_1_2.boundaryCurrent_(local_1_0, local_1_1) && local_1_2.hooks_.isIdle();
                }
              };
              v11 = await s47(local_1_2.filesDir_, local_1_0, v15, v20);
              if (local_0_2(v7.outcome) !== local_0_2(v15)) {
                v7.outcomeRevision = v7.outcomeRevision + 1;
              }
              if (v7.outcome === undefined) {
                if (await j1502(local_1_2.filesDir_, local_1_0, v15)) {
                  v7.presentationRevision = v7.outcomeRevision;
                }
              }
              v7.outcome = v15;
              v0 = await i47(local_1_2.filesDir_, local_1_0);
              if (v0 === null) {
                throw new Error("终态提交后无法重新确认活动，保留待办");
              }
              v7.session = local_1_2.session_(v0);
              v7.inputKey = v10;
              v7.producerInputKey = v9;
              v7.policy = 3;
              v7.committedManifestRevision = v11.outcomeRevision;
              v7.committedEvidenceRevision = v11.evidenceRevision;
              v7.committedOutcomeKey = local_0_1(v0);
              v7.committedEvidenceKey = await s51(p46(local_1_2.filesDir_, local_1_0) + "/evidence-manifest.json");
              await local_1_2.saveState_(v7);
              v11 = true;
              local_1_2.stats_.consumed = local_1_2.stats_.consumed + 1;
              if ((await local_1_2.inputKey_(v0)) !== v10) {
                await local_1_2.enqueue(local_1_0);
              }
            } catch (catchAcc) {
              if (catchAcc instanceof x95) {
                if (!local_1_2.boundaryCurrent_(local_1_0, local_1_1)) {
                  local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
                  await local_1_2.enqueue(local_1_0);
                  a52(local_1_2.filesDir_, p0.activityId);
                  return undefined;
                }
              }
              throw catchAcc;
            }
          } catch (catchAcc) {
            if (catchAcc instanceof x95) {
              if (!local_1_2.boundaryCurrent_(local_1_0, local_1_1)) {
                local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
                await local_1_2.enqueue(local_1_0);
                a52(local_1_2.filesDir_, p0.activityId);
                return undefined;
              }
            }
            if (catchAcc instanceof x95) {
              if (!local_1_2.hooks_.isIdle()) {
                local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
                throw new Error("游戏进程重新活跃或状态未知，恢复提交已延后");
              }
            }
            throw catchAcc;
          }
        }
      } else {
        local_1_1 = local_1_2.boundary_(local_1_0);
        v11 = local_1_1.nextLaunchAt;
        if (p2) {
          p2 = local_1_2.admittedLaunches_.has(local_1_1.nextLaunchAt);
        }
        if (p2) {
          v15 = local_1_2.launchIdentities_.get(local_1_1.nextLaunchAt);
          v15 = v15 == null ? undefined : v15.startsWith("intent:");
          p2 = v15 === true;
        }
        v0 = await o47(local_1_2.filesDir_, local_1_0);
        local_1_2.stats_.resolverCalls = local_1_2.stats_.resolverCalls + 1;
        try {
          acc = n1553(local_1_2.filesDir_, local_1_0, local_1_1.nextLaunchAt, v0?.outcome, function () {
            return local_1_2.boundaryCurrent_(local_1_0, local_1_1) && local_1_2.hooks_.isIdle();
          }, p2);
          v15 = await acc;
          if (!local_1_2.hooks_.isIdle()) {
            local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
            throw new Error("游戏进程重新活跃或状态未知，恢复提交已延后");
          }
          v0 = await i47(local_1_2.filesDir_, local_1_0);
          v17 = v0 === null ? "" : await local_1_2.inputKey_(v0);
          if (v0 === null || v0.runNonce !== v8.runNonce || v17 !== v10) {
            local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
            await local_1_2.enqueue(local_1_0);
            a52(local_1_2.filesDir_, p0.activityId);
            return undefined;
          }
          if (!local_1_2.boundaryCurrent_(local_1_0, local_1_1)) {
            local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
            await local_1_2.enqueue(local_1_0);
            a52(local_1_2.filesDir_, p0.activityId);
            return undefined;
          }
          try {
            v11 = await s47(local_1_2.filesDir_, local_1_0, v15, {
              "nextLaunchAt": local_1_1.nextLaunchAt,
              "inputKey": v10,
              "expectedManifestRevision": v0.revision,
              "capturePrepared": true,
              "repairArtifacts": !v13,
              "commitGuard": function () {
                return local_1_2.boundaryCurrent_(local_1_0, local_1_1) && local_1_2.hooks_.isIdle();
              }
            });
            if (local_0_2(v7.outcome) !== local_0_2(v15)) {
              v7.outcomeRevision = v7.outcomeRevision + 1;
            }
            if (v7.outcome === undefined) {
              if (await j1502(local_1_2.filesDir_, local_1_0, v15)) {
                v7.presentationRevision = v7.outcomeRevision;
              }
            }
            v7.outcome = v15;
            v0 = await i47(local_1_2.filesDir_, local_1_0);
            if (v0 === null) {
              throw new Error("终态提交后无法重新确认活动，保留待办");
            }
            v7.session = local_1_2.session_(v0);
            v7.inputKey = v10;
            v7.producerInputKey = v9;
            v7.policy = 3;
            v7.committedManifestRevision = v11.outcomeRevision;
            v7.committedEvidenceRevision = v11.evidenceRevision;
            v7.committedOutcomeKey = local_0_1(v0);
            v7.committedEvidenceKey = await s51(p46(local_1_2.filesDir_, local_1_0) + "/evidence-manifest.json");
            await local_1_2.saveState_(v7);
            v11 = true;
            local_1_2.stats_.consumed = local_1_2.stats_.consumed + 1;
            if ((await local_1_2.inputKey_(v0)) !== v10) {
              await local_1_2.enqueue(local_1_0);
            }
          } catch (catchAcc) {
            if (catchAcc instanceof x95) {
              if (!local_1_2.boundaryCurrent_(local_1_0, local_1_1)) {
                local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
                await local_1_2.enqueue(local_1_0);
                a52(local_1_2.filesDir_, p0.activityId);
                return undefined;
              }
            }
            throw catchAcc;
          }
        } catch (catchAcc) {
          if (catchAcc instanceof x95) {
            if (!local_1_2.boundaryCurrent_(local_1_0, local_1_1)) {
              local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
              await local_1_2.enqueue(local_1_0);
              a52(local_1_2.filesDir_, p0.activityId);
              return undefined;
            }
          }
          if (catchAcc instanceof x95) {
            if (!local_1_2.hooks_.isIdle()) {
              local_1_2.stats_.staleRejected = local_1_2.stats_.staleRejected + 1;
              throw new Error("游戏进程重新活跃或状态未知，恢复提交已延后");
            }
          }
          throw catchAcc;
        }
      }
      if (v7.outcome === undefined) {
        a52(local_1_2.filesDir_, p0.activityId);
        return undefined;
      }
      if (v7.historyRevision < v7.outcomeRevision) {
        await local_1_2.hooks_.applyHistory({
          "session": v7.session,
          "outcome": v7.outcome,
          "revision": v7.outcomeRevision
        });
        v7.historyRevision = v7.outcomeRevision;
        await local_1_2.saveState_(v7);
        v11 = true;
      }
      if (!v11 && v12 !== v7.presentationMode) {
        await local_1_2.saveState_(v7);
      }
      if (v7.presentationMode !== "history" && v7.presentationRevision < v7.outcomeRevision) {
        await local_1_2.mutate_(function (p0) {
          p0.resultIds.push(local_1_0);
        });
        local_1_2.hooks_.changed();
      }
    } finally {
      a52(local_1_2.filesDir_, p0.activityId);
    }
  }
  async results() {
    let v0, v4, v8;
    await this.initialize();
    await this.gate_;
    v4 = [];
    for (v8 of this.queue_.resultIds.slice()) {
      v0 = await i47(this.filesDir_, v8);
      if (v0 === null) {
        throw new Error("已提交待展示活动清单不可读，结果确认已延后");
      }
      v0 = await s1555(this.filesDir_, this.session_(v0));
      if (v0.presentationMode !== "history" && v0.outcome !== undefined && v0.historyRevision === v0.outcomeRevision && v0.presentationRevision < v0.outcomeRevision) {
        v4.push({
          "session": v0.session,
          "outcome": v0.outcome,
          "revision": v0.outcomeRevision
        });
      }
    }
    return v4;
  }
  async acknowledgePresentation(p0, p1) {
    let acc;
    let local_1_2 = this;
    let local_1_0 = p0;
    let local_1_1 = p1;
    acc = local_1_2.gate_.then(async function () {
      let v3 /*i47*/;
      let v0 = await i47(local_1_2.filesDir_, local_1_0);
      if (v0 === null) {
        return undefined;
      }
      v0 = await s1555(local_1_2.filesDir_, local_1_2.session_(v0));
      if (local_1_1 > v0.outcomeRevision) {
        return undefined;
      }
      if (local_1_1 > v0.presentationRevision) {
        v0.presentationRevision = local_1_1;
        await t1555(local_1_2.filesDir_, v0);
      }
      if (local_1_1 === v0.outcomeRevision) {
        v3 = local_0_0(local_1_2.queue_);
        v3.resultIds = v3.resultIds.filter(function (p0) {
          return p0 !== local_1_0;
        });
        await v1555(local_1_2.filesDir_, v3);
        local_1_2.queue_ = v3;
        local_1_2.syncQueuedLeases_();
      }
      return undefined;
    });
    local_1_2.gate_ = acc.catch(function () {});
    await acc;
    return undefined;
  }
}