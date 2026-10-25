/*
* class name:L&entry/src/main/ets/features/player/PlayQueueManager&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AppLog } from "@normalized:N&&&entry/src/main/ets/common/AppLog&";
import { FeedServiceProvider } from "@normalized:N&&&entry/src/main/ets/common/FeedServiceProvider&";
let PlayQueueManager, QueueChangeListener, QueueSourceType;
let local_0_0;
QueueSourceType = undefined;
local_0_0 = AppLog.getInstance("PlayQueueManager");
QueueSourceType = {
  NONE: "none",
  REMOTE: "remote",
  LOCAL: "local",
  ADHOC: "adhoc"
};
QueueChangeListener = class panda_jmp0_reserved_anonymous_0 {
  constructor() {}
  onQueueChanged() {}
  onCurrentIndexChanged(p0) {}
};
let local_1_0;
try {
  local_1_0 = class panda_jmp0_reserved_anonymous_1 {
    constructor() {
      this.queue = [];
      this.currentIndex = -1;
      this.sourceType = QueueSourceType.NONE;
      this.sourceId = "";
      this.sourceName = "";
      this.QUEUE_BATCH_SIZE = 12;
      this.pendingQueueItems = [];
      this.nextPageToken = null;
      this.visitorData = "";
      this.isLoadingMore = false;
      this.listeners = [];
      this.onSwitchVideo = null;
      this.autoQueueCandidates = [];
      this.autoQueueUsedUrls = new Set();
      this.autoQueueLocked = false;
    }
    addListener(p0) {
      if (!this.listeners.includes(p0)) {
        this.listeners.push(p0);
      }
    }
    removeListener(p0) {
      let v4;
      v4 = this.listeners.indexOf(p0);
      if (v4 >= 0) {
        this.listeners.splice(v4, 1);
      }
    }
    notifyQueueChanged() {
      this.listeners.forEach(function (p0) {
        try {
          p0.onQueueChanged();
        } catch (catchAcc) {}
      });
    }
    notifyCurrentIndexChanged(p0) {
      let local_2_0;
      local_2_0 = p0;
      this.listeners.forEach(function (p0) {
        try {
          p0.onCurrentIndexChanged(local_2_0);
        } catch (catchAcc) {}
      });
    }
    resetAutoQueueState() {
      this.autoQueueCandidates = [];
      this.autoQueueUsedUrls = new Set();
      this.autoQueueLocked = false;
    }
    applyLazyQueue(p0, p1) {
      let v6, acc;
      if (!p0 || p0.length === 0) {
        this.queue = [];
        this.pendingQueueItems = [];
        this.currentIndex = -1;
        return;
      }
      acc = p1 >= 0 && p1 < p0.length ? p1 : 0;
      v6 = Math.min(p0.length, Math.max(this.QUEUE_BATCH_SIZE, acc + 1));
      this.queue = p0.slice(0, v6);
      this.pendingQueueItems = p0.slice(v6);
      this.currentIndex = acc;
      return;
    }
    appendPendingQueueItems(p0) {
      let v3, v4, v5;
      v3 = p0 === undefined ? this.QUEUE_BATCH_SIZE : p0;
      if (this.pendingQueueItems.length === 0) {
        return 0;
      }
      v4 = Math.min(v3, this.pendingQueueItems.length);
      v5 = this.pendingQueueItems.slice(0, v4);
      this.pendingQueueItems = this.pendingQueueItems.slice(v4);
      this.queue = this.queue.concat(v5);
      local_0_0 /*logger*/.info("appendPendingQueueItems: +" + v4 + " pending=" + this.pendingQueueItems.length + "");
      this.notifyQueueChanged();
      return v4;
    }
    setAdhocQueue(p0, p1) {
      this.applyLazyQueue(p0, p1);
      this.sourceType = QueueSourceType.ADHOC;
      this.sourceId = "";
      this.sourceName = "";
      this.nextPageToken = null;
      this.visitorData = "";
      this.resetAutoQueueState();
      local_0_0 /*logger*/.info("setAdhocQueue: total=" + p0.length + " shown=" + this.queue.length + " pending=" + this.pendingQueueItems.length + " start=" + this.currentIndex + "");
      this.notifyQueueChanged();
      this.notifyCurrentIndexChanged(this.currentIndex);
    }
    async loadFromRemotePlaylist(p0, p1, p2) {
      let v5, v6, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20, v21, v22, v23, v24, v25, v26, v27, v29;
      v5 = p2 === undefined ? "" : p2;
      v17 = Date.now();
      local_0_0 /*logger*/.info("loadFromRemotePlaylist start: playlist=" + p0 + " start=" + p1 + "");
      v13 = this.queue.slice();
      v10 = this.currentIndex;
      v15 = this.sourceType;
      v9 = this.sourceId;
      v11 = this.sourceName;
      v14 = this.nextPageToken;
      v16 = this.visitorData;
      v12 = this.pendingQueueItems.slice();
      v6 = this.autoQueueCandidates.slice();
      v8 = new Set(this.autoQueueUsedUrls);
      this.sourceType = QueueSourceType.REMOTE;
      this.sourceId = p0;
      this.sourceName = v5;
      this.queue = [];
      this.currentIndex = -1;
      this.pendingQueueItems = [];
      this.nextPageToken = null;
      this.visitorData = "";
      this.resetAutoQueueState();
      try {
        v23 = FeedServiceProvider.getInstance().getPlaylistService();
        v18 = await v23.fetchPlaylistInitial(p0, 1);
        v22 = v18;
        v20 = v22.items ? v22.items.slice() : [];
        v21 = v22.nextPageToken;
        v24 = v22.visitorData || "";
        v19 = -1;
        for (v26 = 0; v26 < v20.length; v26 += 1) {
          if (v20[v26].videoId === p1) {
            v19 = v26;
            break;
          }
        }
        while (v19 < 0 && v21) {
          v25 = await v23.fetchPlaylistNext(v21, v24, v20.length + 1);
          if (v25.items && v25.items.length > 0) {
            v27 = v20.length;
            v20 = v20.concat(v25.items);
            for (v29 = v27; v29 < v20.length; v29 += 1) {
              if (v20[v29].videoId === p1) {
                v19 = v29;
                break;
              }
            }
          }
          if (v25.visitorData) {
            v24 = v25.visitorData;
          }
          v21 = v25.nextPageToken && v25.nextPageToken !== v21 ? v25.nextPageToken : null;
        }
        this.nextPageToken = v21;
        this.visitorData = v24;
        this.applyLazyQueue(v20, v19 >= 0 ? v19 : 0);
        if (!this.sourceName && v22.totalCountText) {
          this.sourceName = v22.totalCountText;
        }
        v27 = "loadFromRemotePlaylist done: elapsed=" + (Date.now() - v17) + "ms total=" + v20.length + " shown=" + this.queue.length + " pending=" + this.pendingQueueItems.length + " idx=" + this.currentIndex + " found=" + (v19 >= 0) + " token=";
        local_0_0 /*logger*/.info(v27 + !!this.nextPageToken + "");
      } catch (catchAcc) {
        local_0_0 /*logger*/.error("loadFromRemotePlaylist failed, restoring previous queue:", catchAcc);
        this.queue = v13;
        this.currentIndex = v10;
        this.sourceType = v15;
        this.sourceId = v9;
        this.sourceName = v11;
        this.nextPageToken = v14;
        this.visitorData = v16;
        this.pendingQueueItems = v12;
        this.autoQueueCandidates = v6;
        this.autoQueueUsedUrls = v8;
        this.autoQueueLocked = this.autoQueueLocked;
      }
      this.notifyQueueChanged();
      this.notifyCurrentIndexChanged(this.currentIndex);
      return undefined;
    }
    setRemotePlaylistSnapshot(p0, p1, p2, p3, p4, p5, p6) {
      let v6, v7, v8, v9, v11, v13;
      let local_2_0;
      local_2_0 = p2;
      v6 = p3 === undefined ? "" : p3;
      v7 = p4 === undefined ? -1 : p4;
      v8 = p5 === undefined ? null : p5;
      v9 = p6 === undefined ? "" : p6;
      if (!p1 || p1.length === 0) {
        return;
      }
      this.sourceType = QueueSourceType.REMOTE;
      this.sourceId = p0;
      this.sourceName = v6;
      this.nextPageToken = v8;
      this.visitorData = v9;
      this.resetAutoQueueState();
      if (v7 >= 0 && v7 < p1.length && p1[v7].videoId === local_2_0) {
        this.applyLazyQueue(p1, v7);
      } else {
        v11 = p1.findIndex(function (p0) {
          return p0.videoId === local_2_0;
        });
        this.applyLazyQueue(p1, v11 >= 0 ? v11 : 0);
      }
      v13 = "setRemotePlaylistSnapshot: playlist=" + p0 + " total=" + p1.length + " shown=" + this.queue.length + " pending=" + this.pendingQueueItems.length + " idx=" + this.currentIndex + " token=";
      local_0_0 /*logger*/.info(v13 + !!this.nextPageToken + "");
      this.notifyQueueChanged();
      this.notifyCurrentIndexChanged(this.currentIndex);
      return;
    }
    setLocalQueue(p0, p1, p2, p3) {
      let v7, acc;
      let local_2_0;
      local_2_0 = p3;
      this.sourceType = QueueSourceType.LOCAL;
      this.sourceId = p2;
      this.sourceName = p1;
      this.nextPageToken = null;
      this.visitorData = "";
      this.resetAutoQueueState();
      v7 = 0;
      if (local_2_0) {
        acc = p0.findIndex(function (p0) {
          return p0.videoId === local_2_0;
        });
        if (acc < 0) {
          acc = 0;
        }
        v7 = acc;
      }
      this.applyLazyQueue(p0, v7);
      local_0_0 /*logger*/.info("setLocalQueue: total=" + p0.length + " shown=" + this.queue.length + " pending=" + this.pendingQueueItems.length + " startId=" + local_2_0 + ", idx=" + this.currentIndex + "");
      this.notifyQueueChanged();
      this.notifyCurrentIndexChanged(this.currentIndex);
    }
    getCurrent() {
      return this.currentIndex < 0 || this.currentIndex >= this.queue.length ? null : this.queue[this.currentIndex];
    }
    moveTo(p0) {
      if (p0 < 0 || p0 >= this.queue.length) {
        return null;
      }
      this.currentIndex = p0;
      local_0_0 /*logger*/.info("moveTo: idx=" + p0 + " videoId=" + this.queue[p0].videoId + "");
      this.notifyCurrentIndexChanged(p0);
      if (this.onSwitchVideo) {
        this.onSwitchVideo(this.queue[p0]);
      }
      return this.queue[p0];
    }
    next() {
      return this.currentIndex + 1 >= this.queue.length ? null : this.moveTo(this.currentIndex + 1);
    }
    async nextOrLoadMore() {
      if (!this.hasNext() && this.hasMorePages) {
        await this.loadMore();
      }
      return this.next();
    }
    prev() {
      return this.moveTo(this.currentIndex - 1);
    }
    hasNext() {
      return this.currentIndex + 1 < this.queue.length;
    }
    peekNext() {
      return this.hasNext() ? this.queue[this.currentIndex + 1] : null;
    }
    hasPrev() {
      return this.currentIndex - 1 >= 0;
    }
    async loadMore() {
      let v6, v9, acc;
      if (this.isLoadingMore) {
        return false;
      }
      if (!this.hasMorePages) {
        return false;
      }
      this.isLoadingMore = true;
      this.notifyQueueChanged();
      try {
        try {
          if (this.appendPendingQueueItems() > 0) {
            this.isLoadingMore = false;
            this.notifyQueueChanged();
            return true;
          }
          if (this.sourceType === QueueSourceType.ADHOC) {
            v9 = this.appendAutoQueueNext(this.QUEUE_BATCH_SIZE) > 0;
            this.isLoadingMore = false;
            this.notifyQueueChanged();
            return v9;
          }
          if (this.sourceType === QueueSourceType.REMOTE) {
            if (!this.nextPageToken) {
              this.isLoadingMore = false;
              this.notifyQueueChanged();
              return false;
            }
            v6 = await FeedServiceProvider.getInstance().getPlaylistService().fetchPlaylistNext(this.nextPageToken, this.visitorData, this.queue.length + 1);
            if (v6.items && v6.items.length > 0) {
              v9 = this.queue.length;
              this.queue = this.queue.concat(v6.items);
              local_0_0 /*logger*/.info("loadMore: +" + v6.items.length + " items (" + v9 + " → " + this.queue.length + ")");
            }
            if (v6.visitorData) {
              this.visitorData = v6.visitorData;
            }
            if (v6.nextPageToken && v6.nextPageToken !== this.nextPageToken) {
              this.nextPageToken = v6.nextPageToken;
            } else {
              this.nextPageToken = null;
            }
            this.notifyQueueChanged();
            acc = v6.items && v6.items.length > 0;
            this.isLoadingMore = false;
            this.notifyQueueChanged();
            return acc;
          }
          this.isLoadingMore = false;
          this.notifyQueueChanged();
          return false;
        } finally {
          {
            this.isLoadingMore = false;
            this.notifyQueueChanged();
          }
        }
      } catch (catchAcc) {
        local_0_0 /*logger*/.error("loadMore failed:", catchAcc);
        this.isLoadingMore = false;
        this.notifyQueueChanged();
        return false;
      }
    }
    static getInstance() {
      if (!local_1_0 /*PlayQueueManager*/.instance) {
        local_1_0 /*PlayQueueManager*/.instance = new local_1_0 /*PlayQueueManager*/();
      }
      return local_1_0 /*PlayQueueManager*/.instance;
    }
    get isLoadingNextPage() {
      return this.isLoadingMore;
    }
    get hasMorePages() {
      return this.pendingQueueItems.length > 0
        || this.sourceType === QueueSourceType.REMOTE
        && this.nextPageToken !== null
        || this.sourceType === QueueSourceType.ADHOC
        && this.hasUnusedAutoQueueCandidates();
    }
    get hasMoreRemotePages() {
      return this.hasMorePages;
    }
    addToQueue(p0) {
      let local_2_0;
      local_2_0 = p0;
      if (this.queue.some(function (p0) {
        return p0.videoId === local_2_0.videoId;
      })) {
        return;
      }
      this.queue.push(local_2_0);
      this.notifyQueueChanged();
      return;
    }
    removeAt(p0) {
      if (p0 < 0 || p0 >= this.queue.length) {
        return;
      }
      this.queue.splice(p0, 1);
      if (p0 < this.currentIndex) {
        this.currentIndex = this.currentIndex - 1;
      } else if (p0 === this.currentIndex) {
        if (this.currentIndex >= this.queue.length) {
          this.currentIndex = this.queue.length - 1;
        }
        this.notifyCurrentIndexChanged(this.currentIndex);
      }
      this.notifyQueueChanged();
      return;
    }
    reorder(p0, p1) {
      if ((p0 >= 0 ? p0 >= this.queue.length : p0 < 0) || p1 < 0 || p1 >= this.queue.length) {
        return;
      }
      this.queue.splice(p1, 0, this.queue.splice(p0, 1)[0]);
      if (p0 === this.currentIndex) {
        this.currentIndex = p1;
      } else if (p0 < this.currentIndex && p1 >= this.currentIndex) {
        this.currentIndex = this.currentIndex - 1;
      } else if (p0 > this.currentIndex && p1 <= this.currentIndex) {
        this.currentIndex = this.currentIndex + 1;
      }
      this.notifyQueueChanged();
      this.notifyCurrentIndexChanged(this.currentIndex);
      return;
    }
    clear() {
      this.queue = [];
      this.currentIndex = -1;
      this.sourceType = QueueSourceType.NONE;
      this.sourceId = "";
      this.sourceName = "";
      this.pendingQueueItems = [];
      this.nextPageToken = null;
      this.visitorData = "";
      this.resetAutoQueueState();
      this.notifyQueueChanged();
      this.notifyCurrentIndexChanged(-1);
    }
    hasUnusedAutoQueueCandidates() {
      let acc;
      let local_2_0;
      local_2_0 = this;
      if (local_2_0.autoQueueCandidates.length === 0) {
        return false;
      }
      acc = local_2_0.autoQueueCandidates.some(function (p0) {
        let v5;
        v5 = !!p0.videoId;
        return v5 && !local_2_0.autoQueueUsedUrls.has(p0.videoId);
      });
      return acc;
    }
    setAutoQueueCandidates(p0) {
      let v10;
      if (this.sourceType !== QueueSourceType.ADHOC) {
        local_0_0 /*logger*/.info("setAutoQueueCandidates ignored: sourceType=" + this.sourceType + " items=" + p0.length + "");
        return;
      }
      if (this.autoQueueLocked) {
        local_0_0 /*logger*/.info("setAutoQueueCandidates ignored: adhoc queue already locked items=" + p0.length + "");
        return;
      }
      local_0_0 /*logger*/.info("setAutoQueueCandidates: items=" + p0.length + "");
      this.autoQueueCandidates = p0;
      this.autoQueueUsedUrls = new Set();
      for (v10 of this.queue) {
        if (v10.videoId) {
          this.autoQueueUsedUrls.add(v10.videoId);
        }
      }
      this.autoQueueLocked = true;
      this.appendAutoQueueNext(this.QUEUE_BATCH_SIZE);
      this.notifyQueueChanged();
      return;
    }
    appendAutoQueueNext(p0) {
      let v3, v4, v10, v11;
      v3 = p0 === undefined ? this.QUEUE_BATCH_SIZE : p0;
      if (this.sourceType !== QueueSourceType.ADHOC) {
        return 0;
      }
      if (this.autoQueueCandidates.length === 0) {
        return 0;
      }
      v4 = 0;
      v10 = this.autoQueueCandidates[Symbol.iterator]();
      while (true) {
        v11 = v10.next();
        if (v11.done) break;
        if (v4 >= v3) {
          if (v10.return != undefined) {
            v10.return();
          }
          break;
        }
        if (v11.value.videoId) {
          if (!this.autoQueueUsedUrls.has(v11.value.videoId)) {
            this.autoQueueUsedUrls.add(v11.value.videoId);
            this.pendingQueueItems.push(v11.value);
            v4 += 1;
          }
        }
      }
      if (v4 > 0) {
        local_0_0 /*logger*/.info("appendAutoQueueNext: staged " + v4 + " videos pending=" + this.pendingQueueItems.length + "");
        this.appendPendingQueueItems(v3);
      }
      return v4;
    }
    saveAsLocal(p0) {
      let v5, v8;
      v5 = "local_";
      for (v8 = 0; v8 < 16; v8 += 1) {
        v5 += "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * "abcdefghijklmnopqrstuvwxyz0123456789".length));
      }
      return {
        "id": v5,
        "name": p0,
        "videos": this.queue.slice(),
        "createdAt": Date.now()
      };
    }
    exportSnapshot(p0) {
      let v3;
      v3 = p0 === undefined ? 50 : p0;
      return {
        "items": this.queue.slice(0, v3 > 0 ? v3 : 50),
        "currentIndex": this.currentIndex,
        "sourceType": this.sourceType,
        "sourceId": this.sourceId,
        "sourceName": this.sourceName
      };
    }
    restoreSnapshot(p0) {
      let v4;
      if (!p0 || !p0.items || p0.items.length === 0) {
        return;
      }
      v4 = p0.currentIndex >= 0 && p0.currentIndex < p0.items.length ? p0.currentIndex : 0;
      this.sourceType = p0.sourceType;
      this.sourceId = p0.sourceId || "";
      this.sourceName = p0.sourceName || "";
      this.nextPageToken = null;
      this.visitorData = "";
      this.resetAutoQueueState();
      this.applyLazyQueue(p0.items, v4);
      local_0_0 /*logger*/.info("restoreSnapshot: type=" + this.sourceType + " total=" + p0.items.length + " shown=" + this.queue.length + " idx=" + this.currentIndex + "");
      this.notifyQueueChanged();
      this.notifyCurrentIndexChanged(this.currentIndex);
      return;
    }
  };
  (function () {
    this.instance = undefined;
  }).call(local_1_0);
  PlayQueueManager = local_1_0;
} catch (catchAcc) {
  throw catchAcc;
}
export { PlayQueueManager };
export { QueueChangeListener };
export { QueueSourceType };