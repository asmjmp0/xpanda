/*
* class name:L&entry/src/main/ets/n4/o8&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import abilityAccessCtrl from "@ohos:abilityAccessCtrl";
import deviceInfo from "@ohos:deviceInfo";
import display from "@ohos:display";
import pasteboard from "@ohos:pasteboard";
import r273 from "@normalized:Y&&&libentry.so&";
import window from "@ohos:window";
import { y } from "@normalized:N&&&commons/Index&1.0.0";
import { z31 } from "@normalized:N&&&commons/Index&1.0.0";
let local_0_0;
export function m1163(p0, p1) {
  if (p0.globalDisplayRect !== undefined && p0.globalDisplayRect.width > 0 && p0.globalDisplayRect.height > 0 && Number.isFinite(p0.globalDisplayRect.left) && Number.isFinite(p0.globalDisplayRect.top)) {
    return {
      "x": p0.globalDisplayRect.left + p1.left,
      "y": p0.globalDisplayRect.top + p1.top
    };
  }
  if (p0.displayId === undefined || p0.displayId < 0) {
    throw new Error("Desktop window display ID unavailable");
  }
  return o1164(p0.displayId, {
    "x": p0.windowRect.left + p1.left,
    "y": p0.windowRect.top + p1.top
  });
}
export function m806() {
  return local_0_0;
}
export function o1164(p0, p1) {
  let v0 = p0 < 0;
  if (p0 >= 0) {
    v0 = !Number.isFinite(p1.x);
  }
  if (!v0) {
    if (!Number.isFinite(p1.y)) {
      throw new Error("Desktop display coordinate unavailable");
    }
    try {
      return display.convertRelativeToGlobalCoordinate({
        "displayId": p0,
        "position": p1
      });
    } catch (catchAcc) {
      if (display.getDefaultDisplaySync().id === p0) {
        return p1;
      }
      if (deviceInfo.sdkApiVersion < 26) {
        return p1;
      }
      throw catchAcc;
    }
  } else {
    throw new Error("Desktop display coordinate unavailable");
  }
}
export class q1164 {
  constructor() {
    let local_1_0 = this;
    local_1_0.win = undefined;
    local_1_0.generation = 0;
    local_1_0.draining = false;
    local_1_0.refreshing = false;
    local_1_0.refreshPending = false;
    local_1_0.decorated = true;
    local_1_0.resizable = true;
    local_1_0.limits = {};
    local_1_0.baseLimits = {};
    local_1_0.publishChain = Promise.resolve();
    local_1_0.displays = [];
    local_1_0.enhancedDisplays = false;
    local_1_0.rectListener = function () {
      local_1_0.refresh();
    };
    local_1_0.statusListener = function () {
      local_1_0.refresh();
    };
    local_1_0.displayListener = function () {
      local_1_0.refresh();
    };
    local_1_0.areaListener = function () {
      local_1_0.refresh();
    };
    local_1_0.closeListener = async function () {
      if (!r273.mcIsRunning()) {
        return false;
      }
      r273.desktopRequestClose(true);
      return true;
    };
    return local_1_0;
  }
  async start(p0) {
    let local_1_0 = this;
    if (local_1_0.win !== undefined && local_1_0.generation > 0) {
      try {
        if (local_1_0.win.getWindowProperties().id === p0.getWindowProperties().id) {
          await local_1_0.publish();
          return undefined;
        }
        local_1_0.stop();
        local_1_0.win = p0;
        local_1_0.enhancedDisplays = deviceInfo.sdkApiVersion >= 26;
        local_1_0.baseLimits = p0.getWindowLimits();
        local_1_0.limits = local_1_0.copyBaseLimits();
        local_1_0.decorated = true;
        local_1_0.resizable = true;
        local_1_0.generation = r273.desktopAttach(function () {
          local_1_0.drain();
        });
        if (local_1_0.generation <= 0) {
          local_1_0.win = undefined;
          throw new Error("Desktop system bridge unavailable");
        }
        try {
          p0.on("windowRectChange", local_1_0.rectListener);
          p0.on("windowStatusChange", local_1_0.statusListener);
          p0.on("displayIdChange", local_1_0.displayListener);
          p0.on("windowWillClose", local_1_0.closeListener);
          if (local_1_0.enhancedDisplays) {
            display.on("add", local_1_0.displayListener);
            display.on("remove", local_1_0.displayListener);
            display.on("change", local_1_0.displayListener);
          }
          await local_1_0.publish();
          return undefined;
        } catch (catchAcc) {
          local_1_0.stop();
          throw catchAcc;
        }
      } catch (catchAcc) {
        local_1_0.stop();
      }
    }
    local_1_0.stop();
    local_1_0.win = p0;
    local_1_0.enhancedDisplays = deviceInfo.sdkApiVersion >= 26;
    local_1_0.baseLimits = p0.getWindowLimits();
    local_1_0.limits = local_1_0.copyBaseLimits();
    local_1_0.decorated = true;
    local_1_0.resizable = true;
    local_1_0.generation = r273.desktopAttach(function () {
      local_1_0.drain();
    });
    if (local_1_0.generation <= 0) {
      local_1_0.win = undefined;
      throw new Error("Desktop system bridge unavailable");
    }
    try {
      p0.on("windowRectChange", local_1_0.rectListener);
      p0.on("windowStatusChange", local_1_0.statusListener);
      p0.on("displayIdChange", local_1_0.displayListener);
      p0.on("windowWillClose", local_1_0.closeListener);
      if (local_1_0.enhancedDisplays) {
        display.on("add", local_1_0.displayListener);
        display.on("remove", local_1_0.displayListener);
        display.on("change", local_1_0.displayListener);
      }
      await local_1_0.publish();
      return undefined;
    } catch (catchAcc) {
      local_1_0.stop();
      throw catchAcc;
    }
  }
  stop() {
    if (this.win !== undefined) {
      try {
        this.win.off("windowRectChange", this.rectListener);
      } catch (catchAcc) {}
      try {
        this.win.off("windowStatusChange", this.statusListener);
      } catch (catchAcc) {}
      try {
        this.win.off("displayIdChange", this.displayListener);
      } catch (catchAcc) {}
      try {
        this.win.off("windowWillClose", this.closeListener);
      } catch (catchAcc) {}
    }
    if (this.enhancedDisplays) {
      try {
        display.off("add", this.displayListener);
      } catch (catchAcc) {}
      try {
        display.off("remove", this.displayListener);
      } catch (catchAcc) {}
      try {
        display.off("change", this.displayListener);
      } catch (catchAcc) {}
    }
    this.clearDisplayListeners();
    if (this.generation > 0) {
      r273.desktopDetach(this.generation);
    }
    this.generation = 0;
    this.win = undefined;
  }
  clearDisplayListeners() {
    let v0;
    for (v0 = 0; v0 < this.displays.length; v0 += 1) {
      if (this.enhancedDisplays) {
        try {
          this.displays[v0].off("availableAreaChange", this.areaListener);
        } catch (catchAcc) {}
      }
    }
    this.displays = [];
  }
  refresh() {
    this.refreshPending = true;
    if (!this.refreshing) {
      this.publishLoop();
    }
  }
  async publishLoop() {
    let v5;
    this.refreshing = true;
    while (true) {
      try {
        if (!this.refreshPending || this.win === undefined) {
          this.refreshing = false;
          if (hole == v5) {
            return undefined;
          }
          throw v5;
        }
        this.refreshPending = false;
        await this.publish();
      } catch (catchAcc) {
        y.warn("DesktopWindow", "Window facts refresh failed", catchAcc, z31);
      } finally {
        this.refreshing = false;
      }
    }
  }
  publish() {
    let v0;
    let local_1_0 = this;
    v0 = local_1_0.publishChain.catch(function () {}).then(function () {
      return local_1_0.publishCurrent();
    });
    local_1_0.publishChain = v0;
    return v0;
  }
  async publishCurrent() {
    let v3 /*r273*/, v4, v5, v6, v9, v10 /*display*/, v11 /*y*/, v12 /*display*/, v13, v14, v16, v17, v20 /*z31*/, v21, v24, v25, v28;
    let local_1_0;
    v3 = this.win;
    v4 = this.generation;
    v5 = 0;
    if (this.win === undefined || this.generation === 0) {
      return undefined;
    }
    v6 = this.win.getWindowProperties();
    if (v6.displayId === undefined) {
      throw new Error("Desktop window display ID unavailable");
    }
    v9 = [];
    try {
      v9 = this.enhancedDisplays ? await display.getAllDisplays() : [display.getDefaultDisplaySync()];
    } catch (catchAcc) {
      y.warn("DesktopWindow", "Display enumeration unavailable during refresh", catchAcc, z31);
    }
    local_1_0 = v6.displayId;
    try {
      local_1_0 = display.getDefaultDisplaySync().id;
    } catch (catchAcc) {}
    v9.sort(function (p0, p1) {
      if (p0.id === p1.id) {
        return 0;
      }
      if (p0.id === local_1_0) {
        return -1;
      }
      if (p1.id === local_1_0) {
        return 1;
      }
      return p0.id - p1.id;
    });
    v12 = [];
    v13 = [];
    v14 = v5;
    while (v14 < v9.length && v14 < 16) {
      v16 = {
        "x": 0,
        "y": 0
      };
      try {
        if (v9[v14].id !== local_1_0 /*s1165*/) {
          v16 = display.convertRelativeToGlobalCoordinate({
            "displayId": v9[v14].id,
            "position": {
              "x": 0,
              "y": 0
            }
          });
        }
        v17 = this.enhancedDisplays ? await v9[v14].getAvailableArea() : {
          "left": 0,
          "top": 0,
          "width": v9[v14].width,
          "height": v9[v14].height
        };
        v20 = v16.x;
        v21 = v16.y;
        v24 = v16.x + v17.left;
        v16 = v16.y + v17.top;
        v25 = v17.width;
        v17 = v17.height;
        v28 = v9[v14].xDPI > v5 ? v9[v14].width * 25.4 / v9[v14].xDPI : v5;
        v12.push(v9[v14].id, v20, v21, v9[v14].width, v9[v14].height, v24, v16, v25, v17, v9[v14].densityPixels, v9[v14].refreshRate, v28, v9[v14].yDPI > v5 ? v9[v14].height * 25.4 / v9[v14].yDPI : v5);
        v16 = v13.push;
        v13.push(v9[v14].name);
      } catch (catchAcc) {
        if (v9[v14].id === local_1_0 /*s1165*/) {
          v17 = this.enhancedDisplays ? await v9[v14].getAvailableArea() : {
            "left": 0,
            "top": 0,
            "width": v9[v14].width,
            "height": v9[v14].height
          };
          v20 = v16.x;
          v21 = v16.y;
          v24 = v16.x + v17.left;
          v16 = v16.y + v17.top;
          v25 = v17.width;
          v17 = v17.height;
          v28 = v9[v14].xDPI > v5 ? v9[v14].width * 25.4 / v9[v14].xDPI : v5;
          v12.push(v9[v14].id, v20, v21, v9[v14].width, v9[v14].height, v24, v16, v25, v17, v9[v14].densityPixels, v9[v14].refreshRate, v28, v9[v14].yDPI > v5 ? v9[v14].height * 25.4 / v9[v14].yDPI : v5);
          v13.push(v9[v14].name);
        } else {
          y.warn("DesktopWindow", "Secondary display origin unavailable; retrying later", catchAcc, z31);
        }
      }
      v14 += 1;
    }
    if (v4 !== this.generation || v3 !== this.win) {
      return undefined;
    }
    this.clearDisplayListeners();
    this.displays = v9;
    for (v10 = v5; v10 < v9.length; v10 += 1) {
      if (this.enhancedDisplays) {
        try {
          v9[v10].on("availableAreaChange", this.areaListener);
        } catch (catchAcc) {}
      }
    }
    if (v6.drawableRect.width <= v5 || v6.drawableRect.height <= v5) {
      throw new Error("Window drawable area unavailable");
    }
    v11 = m1163(v6, v6.drawableRect);
    v14 = [v6.id, v6.displayId, v11.x, v11.y, v6.drawableRect.width, v6.drawableRect.height, this.win.getWindowStatus(), this.decorated ? 1 : v5];
    if (this.resizable) {
      v5 = 1;
    }
    v14[8] = v5;
    v14[9] = v6.drawableRect.left;
    v14[10] = v6.drawableRect.top;
    v14[11] = v6.windowRect.width - v6.drawableRect.left - v6.drawableRect.width;
    v14[12] = v6.windowRect.height - v6.drawableRect.top - v6.drawableRect.height;
    if (!r273.desktopPublishState(this.generation, v14, v12, v13)) {
      throw new Error("Desktop window facts rejected");
    }
    return undefined;
  }
  async drain() {
    let v14 /*r273*/, v15, v18, acc;
    if (this.draining) {
      return undefined;
    }
    this.draining = true;
    try {
      while ((v14 = this.win, this.win !== undefined) && (acc = r273.desktopTakeCommand(), v14 = acc, acc !== undefined)) {
        try {
          if (v14.generation !== this.generation) {
            throw new Error("Stale desktop command");
          }
          await this.execute(v14, this.win);
          if (v14.generation !== this.generation) {
            throw new Error("Window detached during command");
          }
          await this.publish();
          v15 = 0;
        } catch (catchAcc) {
          y.warn("DesktopWindow", "Command failed kind=" + v14.kind + " sequence=" + v14.sequence + " code=" + (catchAcc.code || -1), catchAcc, z31);
          v15 = catchAcc.code || -1;
        }
        v18 = v14.generation;
        v14 = v14.sequence;
        r273.desktopCompleteCommand(v18, v14, v15);
      }
    } finally {
      this.draining = false;
    }
  }
  async execute(p0, p1) {
    let v2 /*window*/, v5, v6 /*abilityAccessCtrl*/;
    let v4 /*pasteboard*/ = p1.getWindowStatus();
    if (p0.kind === 1) {
      if (p0.a <= 0 || p0.b <= 0) {
        throw new Error("Invalid window size");
      }
      v2 = p1.getWindowProperties();
      v5 = p0.a + v2.windowRect.width - v2.drawableRect.width;
      v2 = p0.b + v2.windowRect.height - v2.drawableRect.height;
      await p1.resize(v5, v2);
    } else if (p0.kind === 2) {
      v2 = p1.getWindowProperties().drawableRect;
      await p1.moveWindowToGlobal(p0.a - v2.left, p0.b - v2.top);
    } else if (p0.kind !== 3) {
      if (p0.kind === 4 || p0.kind === 8) {
        await p1.minimize();
      } else if (p0.kind === 5) {
        if (v4 === window.WindowStatusType.MINIMIZE) {
          await p1.restore();
        } else if (v4 === window.WindowStatusType.MAXIMIZE || v4 === window.WindowStatusType.FULL_SCREEN) {
          await p1.recover();
        } else {
          await p1.showWindow();
        }
      } else if (p0.kind === 7) {
        if (v4 === window.WindowStatusType.MINIMIZE) {
          await p1.restore();
        } else {
          await p1.showWindow();
        }
      } else if (p0.kind === 6) {
        await p1.maximize(window.MaximizePresentation.EXIT_IMMERSIVE);
      } else if (p0.kind === 9) {
        await p1.setWindowTitle(p0.text);
      } else if (p0.kind === 10) {
        v4 = p1.getWindowProperties();
        v5 = v4.windowRect.width - v4.drawableRect.width;
        v4 = v4.windowRect.height - v4.drawableRect.height;
        this.limits = this.copyBaseLimits();
        if (p0.a > 0) {
          this.limits.minWidth = p0.a + v5;
        }
        if (p0.b > 0) {
          this.limits.minHeight = p0.b + v4;
        }
        if (p0.c > 0) {
          this.limits.maxWidth = p0.c + v5;
        }
        if (p0.d > 0) {
          this.limits.maxHeight = p0.d + v4;
        }
        if (this.resizable) {
          await p1.setWindowLimits(this.limits);
        }
      } else if (p0.kind === 11) {
        p1.setWindowDecorVisible(p0.a !== 0);
        this.decorated = p0.a !== 0;
      } else if (p0.kind === 12) {
        if (p0.a === 0) {
          v4 = p1.getWindowProperties().windowRect;
          await p1.setWindowLimits({
            "minWidth": v4.width,
            "maxWidth": v4.width,
            "minHeight": v4.height,
            "maxHeight": v4.height
          });
        } else {
          await p1.setWindowLimits(this.limits);
        }
        this.resizable = p0.a !== 0;
      } else {
        if (p0.kind !== 13) {
          if (p0.kind !== 14) {
            throw new Error("Unsupported desktop command");
          }
          if (pasteboard.getSystemPasteboard().hasDataType(pasteboard.MIMETYPE_TEXT_PLAIN)) {
            v4 = p1.getUIContext().getHostContext();
            if ((await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(v4, ["ohos.permission.READ_PASTEBOARD"])).authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
              return undefined;
            }
            throw new Error("Clipboard permission denied or missing from signing Profile");
          }
          return undefined;
        }
        if (p0.a > 0 && p0.b > 0) {
          await p1.setAspectRatio(p0.a / p0.b);
        } else {
          await p1.resetAspectRatio();
        }
      }
    } else if (p0.a !== 0) {
      v6 = p1.getWindowProperties().displayId;
      if (p0.b >= 0 && p0.b !== v6) {
        if (v4 === window.WindowStatusType.FULL_SCREEN || v4 === window.WindowStatusType.MAXIMIZE) {
          await p1.recover();
        }
        v2 = o1164(display.getDisplayByIdSync(p0.b).id, {
          "x": 0,
          "y": 0
        });
        await p1.moveWindowToGlobal(v2.x, v2.y);
      }
      if (p1.getWindowStatus() !== window.WindowStatusType.FULL_SCREEN) {
        await p1.maximize(window.MaximizePresentation.ENTER_IMMERSIVE);
      }
    } else if (v4 === window.WindowStatusType.FULL_SCREEN || v4 === window.WindowStatusType.MAXIMIZE) {
      await p1.recover();
    }
    return undefined;
  }
  copyBaseLimits() {
    return {
      "minWidth": this.baseLimits.minWidth,
      "minHeight": this.baseLimits.minHeight,
      "maxWidth": this.baseLimits.maxWidth,
      "maxHeight": this.baseLimits.maxHeight
    };
  }
}
local_0_0 = new q1164();