/*
* class name:L&entry/src/main/ets/r2/l3&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { a90 } from "@normalized:N&&&commons/Index&1.0.0";
import { h115 } from "@normalized:N&&&commons/Index&1.0.0";
import { k115 } from "@normalized:N&&&commons/Index&1.0.0";
import { q51 } from "@normalized:N&&&commons/Index&1.0.0";
import { r115 } from "@normalized:N&&&commons/Index&1.0.0";
let e190, u189, v189;
let local_0_1, local_0_2, local_0_3;
local_0_1 = function (p0, p1, p2, p3) {
  let v1, v2, v3;
  if (p2 === undefined) {
    p2 = 0;
  }
  if (p3 === undefined) {
    p3 = p0.length;
  }
  v1 = [];
  if (p1.length === 0) {
    return [];
  }
  v2 = p0.toLowerCase();
  v3 = v2.indexOf(p1);
  while (v3 >= 0 && v3 < p3) {
    if (v3 + p1.length > p2) {
      v1.push({
        "start": Math.max(p2, v3) - p2,
        "end": Math.min(p3, v3 + p1.length) - p2
      });
    }
    v3 = v2.indexOf(p1, v3 + p1.length);
  }
  return v1;
};
u189 = function (p0) {
  return h115(p0);
};
local_0_2 = class panda_jmp0_reserved_anonymous_0 {
  constructor() {
    this.sourceIndex = 0;
    this.cursor = undefined;
    this.pending = "";
    this.eof = false;
    this.lineNumber = 0;
    this.sourceLineNumber = 0;
    this.matched = 0;
    this.nextSkip = 0;
    this.parser = new r115();
    this.queued = undefined;
  }
};
local_0_3 = class panda_jmp0_reserved_anonymous_1 {
  constructor() {
    this.path = "";
    this.cursor = new a90();
    this.parser = new r115();
    this.pending = "";
    this.lineNumber = 0;
    this.events = [];
    this.characters = 0;
  }
};
new RegExp("\\b\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?\\b|\\b(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\\b|\\[[DIWEF]\\]|[\\w.$]+(?:Exception|Error)\\b|[\\w$]+\\.java:\\d+", "g");
e190 = class panda_jmp0_reserved_anonymous_2 {
  constructor() {
    this.rows = [];
    this.visible = [];
    this.filtered = [];
    this.listeners = [];
    this.generation = 0;
    this.lineCount = 0;
    this.matchingLines = 0;
    this.matchingEvents = 0;
    this.hasNextPage = false;
    this.pageStart = 0;
    this.activeCursor = undefined;
    this.scanKey = "";
    this.idleScan = undefined;
    this.pageCache = new Map();
    this.collapsed = false;
    this.expanded = new Set();
    this.individuallyCollapsed = new Set();
    this.live = undefined;
    this.liveBytesRead = 0;
  }
  totalCount() {
    return this.visible.length;
  }
  getData(p0) {
    return this.rows[this.visible[p0]];
  }
  registerDataChangeListener(p0) {
    this.listeners.push(p0);
  }
  unregisterDataChangeListener(p0) {
    let v0;
    v0 = this.listeners.indexOf(p0);
    if (v0 >= 0) {
      this.listeners.splice(v0, 1);
    }
  }
  notify() {
    let v3;
    for (v3 of this.listeners) {
      v3.onDataReloaded();
    }
  }
  cancel() {
    this.generation = this.generation + 1;
    if (this.activeCursor !== null && this.activeCursor !== undefined) {
      this.activeCursor.cancel();
    }
    this.discardIdle_();
    this.releaseLive_();
    this.scanKey = "";
    this.pageCache.clear();
  }
  discardIdle_() {
    let v0;
    v0 = this.idleScan === null || this.idleScan === undefined ? undefined : this.idleScan.cursor;
    this.idleScan = undefined;
    if (v0 !== undefined) {
      v0.cancel();
      v0 = v0.close();
      v0.catch(function () {});
    }
  }
  setCollapsed(p0) {
    this.collapsed = p0;
    this.expanded.clear();
    this.individuallyCollapsed.clear();
    this.applyVisibility_();
  }
  toggleEvent(p0) {
    if (this.isEventExpanded(p0)) {
      this.expanded.delete(p0);
      this.individuallyCollapsed.add(p0);
    } else {
      this.individuallyCollapsed.delete(p0);
      this.expanded.add(p0);
    }
    this.applyVisibility_();
  }
  isEventExpanded(p0) {
    let v0, acc;
    acc = this.expanded.has(p0);
    v0 = acc;
    if (!acc) {
      v0 = !this.collapsed && !this.individuallyCollapsed.has(p0);
    }
    return v0;
  }
  maxLineLength() {
    return this.rows.reduce(function (p0, p1) {
      return Math.max(p0, p1.text.length);
    }, 0);
  }
  applyVisibility_() {
    let v5, v8, acc;
    this.visible = [];
    for (v5 of this.filtered) {
      if (!this.isEventExpanded(this.rows[v5].eventId ?? "") && this.rows[v5].eventStart !== true) {
        v8 = this.rows[v5].event === null || this.rows[v5].event === undefined ? undefined : this.rows[v5].event.format;
        acc = v8 !== "xml";
        v8 = v8 !== "xml";
        acc = !acc;
        if (!acc) {
          v8 = ((this.rows[v5].event === null || this.rows[v5].event === undefined ? undefined : this.rows[v5].event.lines.length) ?? 0) <= 4;
        }
        if (v8) {
          this.visible.push(v5);
        }
      } else {
        this.visible.push(v5);
      }
    }
    this.notify();
  }
  publishPage_(p0) {
    this.rows = p0.rows;
    this.filtered = p0.rows.map(function (p0, p1) {
      return p1;
    });
    this.lineCount = p0.lineCount;
    this.matchingLines = p0.matchingLines;
    this.matchingEvents = p0.matchingEvents;
    this.hasNextPage = p0.hasNext;
    this.pageStart = p0.pageStart;
    this.applyVisibility_();
  }
  appendEvent_(p0, p1, p2, p3) {
    let v9, v11, v12, v13;
    for (v9 of p1.lines) {
      for (v11 = 0; v11 < Math.max(1, v9.text.length); v11 = Math.max(v11 + 1, v12)) {
        v12 = Math.min(v9.text.length, v11 + 2048);
        v13 = v9.text.charCodeAt(v12 - 1);
        if (v12 < v9.text.length && v13 >= 55296 && v13 <= 56319) {
          v12 -= 1;
        }
        p0.push({
          "key": p0.length,
          "lineNumber": v9.number,
          "continuation": v11 > 0,
          "sourcePath": p2,
          "sourceLineNumber": v9.number,
          "sourceStart": p0.length === 0 || p0[p0.length - 1].sourcePath !== p2,
          "text": v9.text.substring(v11, v12),
          "level": p1.level,
          "event": p1,
          "eventId": p2 + "#" + p1.startLine,
          "eventStart": v9.number === p1.startLine && v11 === 0,
          "matches": local_0_1(v9.text, p3, v11, v12),
          "matchKeyword": p3
        });
      }
    }
  }
  async nextEvent_(p0, p1) {
    let v0, v7, v8;
    if (p0.cursor === undefined) {
      return undefined;
    }
    while (true) {
      if (p0.eof && p0.pending.length <= 0) break;
      if (p1 !== this.generation) {
        return undefined;
      }
      if (p0.pending.indexOf("\n") < 0) {
        if (!p0.eof) {
          v0 = await p0.cursor.read();
          if (p1 !== this.generation) {
            return undefined;
          }
          p0.pending = p0.pending + v0.text;
          p0.eof = v0.eof;
          if (p0.pending.length > 8 * 1024 * 1024) {
            throw new Error("单行超过 8 MiB，请导出完整 ZIP 查看");
          }
          if (!p0.eof && p0.pending.indexOf("\n") < 0) {
            continue;
          }
        }
      }
      if (p0.pending.length === 0) {
        break;
      }
      v7 = p0.pending.indexOf("\n");
      v8 = v7 >= 0 ? p0.pending.substring(0, v7) : p0.pending;
      p0.pending = v7 >= 0 ? p0.pending.substring(v7 + 1) : "";
      if (v8.endsWith("\r")) {
        v8 = v8.substring(0, v8.length - 1);
      }
      p0.lineNumber = p0.lineNumber + 1;
      p0.sourceLineNumber = p0.sourceLineNumber + 1;
      v7 = p0.parser.feed(v8, p0.sourceLineNumber);
      if (p0.sourceLineNumber % 1024 === 0) {
        await new Promise(function (p0) {
          setTimeout(p0, 0);
        });
      }
      if (v7 !== undefined) {
        return v7;
      }
    }
    return p0.parser.finish();
  }
  async loadEvidence(p0, p1, p2, p3, p4) {
    let v3, v4, v5 /*a190*/, v6, v7, v10, v11, v12, v14, v15, v16, v19 /*r115*/, v20 /*a90*/, acc;
    v3 = p3 === undefined ? 0 : p3;
    if (p4 === undefined) {
      p4 = 0;
    }
    this.releaseLive_();
    v4 = this.generation + 1;
    this.generation = this.generation + 1;
    if (this.activeCursor !== null && this.activeCursor !== undefined) {
      this.activeCursor.cancel();
    }
    acc = p0.map(function (p0) {
      return p0.path + ":" + p0.compressed + ":" + q51(p0.path);
    });
    v6 = JSON.stringify(acc) + ":" + p1 + ":" + p2.toLowerCase() + ":" + p4;
    if (v6 !== this.scanKey) {
      this.discardIdle_();
      this.pageCache.clear();
      this.scanKey = v6;
    }
    v5 = this.pageCache.get(v3);
    if (v5 === undefined) {
      if (this.idleScan !== undefined && this.idleScan.nextSkip === v3) {
        v5 = this.idleScan;
        this.idleScan = undefined;
      } else {
        this.discardIdle_();
        v5 = new local_0_2();
      }
      v10 = [];
      v11 = p2.toLowerCase();
      v12 = false;
      v14 = 0;
      v15 = 0;
      for (v16 = 0; v5.sourceIndex < p0.length; this.appendEvent_(v10, v20, v19.path, v11)) {
        v19 = p0[v5.sourceIndex];
        if (v5.cursor === undefined) {
          v5.cursor = new a90();
          this.activeCursor = v5.cursor;
          await v5.cursor.open(p0[v5.sourceIndex].path, p0[v5.sourceIndex].compressed);
        }
        this.activeCursor = v5.cursor;
        v20 = v5.queued ?? (await this.nextEvent_(v5, v4));
        v5.queued = undefined;
        if (v4 !== this.generation) {
          if (this.activeCursor === v5.cursor) {
            this.activeCursor = undefined;
          }
          if (this.idleScan !== v5 && v5.cursor !== undefined) {
            await v5.cursor.close();
          }
          return false;
        }
        if (v20 === undefined) {
          await v5.cursor.close();
          v5.cursor = undefined;
          this.activeCursor = undefined;
          v5.sourceIndex = v5.sourceIndex + 1;
          v5.sourceLineNumber = 0;
          v5.pending = "";
          v5.eof = false;
          v5.parser = new r115();
          continue;
        }
        if (v20.endLine < p4) {
          continue;
        }
        if (!k115(v20, p1, v11)) {
          continue;
        }
        if (v14 >= 300) {
          v5.queued = v20;
          v12 = true;
          break;
        }
        v5.matched = v5.matched + 1;
        if (v5.matched <= v3) {
          continue;
        }
        v16 += v20.lines.reduce(function (p0, p1) {
          return p0 + p1.text.length;
        }, 0);
        if (v16 > 16 * 1024 * 1024) {
          throw new Error("本页完整事件超过阅读预算，请缩小搜索范围或导出 ZIP");
        }
        v14 += 1;
        v15 += v20.lines.length;
      }
      if (v4 === this.generation) {
        v7 = {
          "rows": v10,
          "lineCount": v5.lineNumber,
          "matchingLines": v15,
          "matchingEvents": v14,
          "hasNext": v12,
          "pageStart": v3
        };
        if (v16 <= 1024 * 1024) {
          if (this.pageCache.size >= 4) {
            this.pageCache.delete(Array.from(this.pageCache.keys())[0]);
          }
          this.pageCache.set(v3, v7);
        }
        this.publishPage_(v7);
        if (v12) {
          v5.nextSkip = v3 + v14;
          this.idleScan = v5;
        }
        if (this.activeCursor === v5.cursor) {
          this.activeCursor = undefined;
        }
        if (this.idleScan !== v5 && v5.cursor !== undefined) {
          await v5.cursor.close();
        }
        return true;
      }
      if (this.activeCursor === v5.cursor) {
        this.activeCursor = undefined;
      }
      if (this.idleScan !== v5 && v5.cursor !== undefined) {
        await v5.cursor.close();
      }
      return false;
    }
    this.publishPage_(v5);
    return true;
  }
  releaseLive_() {
    let v0;
    v0 = this.live;
    this.live = undefined;
    if (v0 === undefined) {
      return;
    }
    v0.cursor.cancel();
    if (this.activeCursor !== v0.cursor) {
      v0 = v0.cursor.close();
      v0.catch(function () {});
    }
    return;
  }
  async loadLive(p0, p1, p2) {
    let v0, v4, v5, v6, v19, v20, v21, v23, v24, v25, v27;
    if (p0.compressed) {
      throw new Error("压缩归档不能跟随，请选择正在写入的日志");
    }
    v4 = 0;
    v5 = this.generation + 1;
    this.generation = this.generation + 1;
    this.discardIdle_();
    this.pageCache.clear();
    this.scanKey = "";
    if (this.live === undefined || this.live.path !== p0.path) {
      this.releaseLive_();
      v6 = new local_0_3();
      v6.path = p0.path;
      this.live = v6;
      this.liveBytesRead = 0;
      this.activeCursor = v6.cursor;
      await v6.cursor.open(p0.path, false, true);
      if (v5 !== this.generation || this.live !== v6) {
        await v6.cursor.close();
        if (this.activeCursor === v6.cursor) {
          this.activeCursor = undefined;
        }
        return false;
      }
    }
    if (this.live === undefined) {
      return false;
    }
    this.activeCursor = this.live.cursor;
    await this.live.cursor.refreshLive();
    v19 = 4;
    v20 = 299;
    v21 = 1024;
    v0 = await this.live.cursor.read();
    v23 = v0.eof;
    if (v5 !== this.generation) {
      if (this.activeCursor === this.live.cursor) {
        this.activeCursor = undefined;
      }
      if (this.live !== this.live) {
        await this.live.cursor.close();
      }
      return false;
    }
    this.liveBytesRead = this.liveBytesRead + v0.bytesRead;
    this.live.pending = this.live.pending + v0.text;
    if (this.live.pending.length > 8 * v21 * v21) {
      throw new Error("追加日志单行过长，请导出 ZIP 查看");
    }
    v24 = this.live.pending.indexOf("\n");
    while (true) {
      if (v24 >= v4) {
        v25 = this.live.pending.substring(v4, v24);
        this.live.pending = this.live.pending.substring(v24 + 1);
        if (v25.endsWith("\r")) {
          v25 = v25.substring(v4, v25.length - 1);
        }
        v27 = this.live.lineNumber + 1;
        this.live.lineNumber = this.live.lineNumber + 1;
        v24 = this.live.parser.feed(v25, v27);
        if (v24 !== undefined) {
          this.live.events.push(v24);
          this.live.characters = this.live.characters + v24.lines.reduce(function (p0, p1) {
            return p0 + p1.text.length;
          }, v4);
          while (true) {
            if (this.live.events.length > v20) {
              v24 = this.live.events.shift();
              if (v24 !== undefined) {
                this.live.characters = this.live.characters - v24.lines.reduce(function (p0, p1) {
                  return p0 + p1.text.length;
                }, v4);
              }
              continue;
            }
            if (this.live.events.length > 1 && this.live.characters > v19 * v21 * v21) {
              v24 = this.live.events.shift();
              if (v24 !== undefined) {
                this.live.characters = this.live.characters - v24.lines.reduce(function (p0, p1) {
                  return p0 + p1.text.length;
                }, v4);
              }
              continue;
            }
            break;
          }
        }
        if (this.live.lineNumber % v21 === v4) {
          await new Promise(function (p0) {
            setTimeout(p0, 0);
          });
        }
        if (v5 !== this.generation) {
          if (this.activeCursor === this.live.cursor) {
            this.activeCursor = undefined;
          }
          if (this.live !== this.live) {
            await this.live.cursor.close();
          }
          return false;
        }
        v24 = this.live.pending.indexOf("\n");
      } else {
        if (v23) {
          v19 = this.live.events.slice();
          v20 = this.live.parser.snapshot(this.live.pending, this.live.lineNumber + 1);
          if (v20 !== undefined) {
            v19.push(v20);
          }
          v20 = [];
          v19 = v19[Symbol.iterator]();
          v21 = v19.next;
          v23 = v4;
          while (true) {
            v24 = v21.call(v19);
            if (v24.done) break;
            v24 = v24.value;
            if (k115(v24, p1, p2)) {
              this.appendEvent_(v20, v24, p0.path, p2.toLowerCase());
              v4 += 1;
              v23 += v24.lines.length;
            }
          }
          this.publishPage_({
            "rows": v20,
            "lineCount": this.live.lineNumber,
            "matchingLines": v23,
            "matchingEvents": v4,
            "hasNext": false,
            "pageStart": 0
          });
          if (this.activeCursor === this.live.cursor) {
            this.activeCursor = undefined;
          }
          if (this.live !== this.live) {
            await this.live.cursor.close();
          }
          return true;
        }
        v0 = await this.live.cursor.read();
        if (v5 !== this.generation) {
          if (this.activeCursor === this.live.cursor) {
            this.activeCursor = undefined;
          }
          if (this.live !== this.live) {
            await this.live.cursor.close();
          }
          return false;
        }
        this.liveBytesRead = this.liveBytesRead + v0.bytesRead;
        this.live.pending = this.live.pending + v0.text;
        if (this.live.pending.length > 8 * v21 * v21) {
          throw new Error("追加日志单行过长，请导出 ZIP 查看");
        }
        v24 = this.live.pending.indexOf("\n");
      }
    }
  }
  async setText(p0) {
    let v2, v5, v6 /*r115*/, v7, v8, v9, v10, acc;
    v2 = 1000;
    this.cancel();
    v5 = this.generation + 1;
    this.generation = this.generation + 1;
    v6 = new r115();
    acc = [];
    v7 = acc;
    v8 = 0;
    v9 = 0;
    do {
      if (v8 >= p0.length) {
        v2 = v6.finish();
        if (v2 !== undefined) {
          this.appendEvent_(v7, v2, "", "");
        }
        if (v5 === this.generation) {
          this.rows = v7;
          this.lineCount = v9;
          this.filter(0, "");
          return true;
        }
        return false;
      }
      v10 = p0.indexOf("\n", v8);
      if (v10 < 0) {
        v10 = p0.length;
      }
      acc = p0.substring(v8, v10);
      v8 = acc.endsWith("\r") ? acc.substring(0, acc.length - 1) : acc;
      v9 += 1;
      v8 = v6.feed(v8, v9);
      if (v8 !== undefined) {
        this.appendEvent_(v7, v8, "", "");
      }
      v8 = v10 + 1;
      acc = v9 % v2 === 0;
      if (v9 % v2 !== 0) {
        continue;
      }
      await new Promise(function (p0) {
        setTimeout(p0, 0);
      });
      acc = v5 !== this.generation;
    } while (!acc);
    return false;
  }
  filter(p0, p1) {
    let v1, v2, v3, v4, v5, v6, v7 /*k115*/, v8, v9, v10;
    v1 = p1.toLowerCase();
    v2 = [];
    v3 = 0;
    v4 = 0;
    v5 = 0;
    while (v5 < this.rows.length) {
      v6 = this.rows[v5].event;
      v7 = this.rows[v5].eventId ?? "";
      v8 = v5;
      while (v8 < this.rows.length && this.rows[v8].eventId === v7) {
        v8 += 1;
      }
      if (this.rows[v5].event === undefined) {
        v5 = v8;
      } else if (k115(this.rows[v5].event, p0, v1)) {
        v3 += 1;
        v4 += this.rows[v5].event.lines.length;
        {
          let local_1_0;
          while (v5 < v8) {
            local_1_0 = this.rows[v5].sourceLineNumber ?? 0;
            v9 = v6.lines.find(function (p0) {
              return p0.number === local_1_0;
            })?.text ?? "";
            v10 = 0;
            while (v5 < v8 && this.rows[v5].sourceLineNumber === local_1_0) {
              this.rows[v5].matches = local_0_1(v9, v1, v10, v10 + this.rows[v5].text.length);
              this.rows[v5].matchKeyword = v1;
              v10 += this.rows[v5].text.length;
              v2.push(v5);
              v5 += 1;
            }
            let local_1_2_0;
            local_1_2_0 = local_1_0;
          }
        }
        v5 = v8;
      } else {
        v5 = v8;
      }
    }
    this.filtered = v2;
    this.matchingEvents = v3;
    this.matchingLines = v4;
    this.applyVisibility_();
  }
  firstErrorIndex() {
    let v1;
    for (v1 = 0; v1 < this.visible.length; v1 += 1) {
      if (this.getData(v1).level === 2) {
        return v1;
      }
    }
    return -1;
  }
};
export { e190 };
export { u189 };
export { v189 };