/*
* class name:L&entry/src/main/ets/pages/GamePage&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AppLog } from "@normalized:N&&&entry/src/main/ets/common/AppLog&";
import { Orientation } from "@normalized:N&&&entry/src/main/ets/common/Orientation&";
import { PadButton } from "@normalized:N&&&entry/src/main/ets/common/VirtualStick&";
import { SettingsStore } from "@normalized:N&&&entry/src/main/ets/common/SettingsStore&";
import { VirtualDpad } from "@normalized:N&&&entry/src/main/ets/common/VirtualStick&";
import { VirtualStick } from "@normalized:N&&&entry/src/main/ets/common/VirtualStick&";
import { XPadKey } from "@normalized:N&&&entry/src/main/ets/common/PadKey&";
import display from "@ohos:display";
import fs from "@ohos:file.fs";
import gamePerformance from "@hms:core.gameservice.gameperformance";
import gamePlayer from "@hms:core.gameservice.gameplayer";
import hilog from "@ohos:hilog";
import inputDevice from "@ohos:multimodalInput.inputDevice";
import router from "@ohos:router";
import testNapi from "@normalized:Y&&&libentry.so&";
import window from "@ohos:window";
let acc;
let local_0_0, local_0_1;
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
local_0_0 = 0;
local_0_1 = "HX360E";
class GamePage extends ViewPU {
  constructor(p0, p1, p2, p3, p4, p5) {
    let local_2_0;
    local_2_0 = this;
    if (p3 === undefined) {
      p3 = -1;
    }
    if (p4 === undefined) {
      p4 = undefined;
    }
    local_2_0 = super(p0, p2, p3, p5);
    if (typeof p4 === "function") {
      local_2_0.paramsGenerator_ = p4;
    }
    local_2_0.__promptKind = new ObservedPropertySimplePU("", local_2_0, "promptKind");
    local_2_0.__promptTitle = new ObservedPropertySimplePU("", local_2_0, "promptTitle");
    local_2_0.__promptMessage = new ObservedPropertySimplePU("", local_2_0, "promptMessage");
    local_2_0.__promptInput = new ObservedPropertySimplePU("", local_2_0, "promptInput");
    local_2_0.__promptButtons = new ObservedPropertyObjectPU([], local_2_0, "promptButtons");
    local_2_0.__promptDiscLabels = new ObservedPropertyObjectPU([], local_2_0, "promptDiscLabels");
    local_2_0.__promptDiscPaths = new ObservedPropertyObjectPU([], local_2_0, "promptDiscPaths");
    local_2_0.promptId = BigInt(0);
    local_2_0.quitAfterLeave = false;
    local_2_0.lastSurfaceId = "";
    local_2_0.promptTimer = -1;
    local_2_0.attachTimer = -1;
    local_2_0.xcompController = new XComponentController();
    local_2_0.__scaleX = new ObservedPropertySimplePU(1, local_2_0, "scaleX");
    local_2_0.__scaleY = new ObservedPropertySimplePU(1, local_2_0, "scaleY");
    local_2_0.letterbox = true;
    local_2_0.__showPad = new ObservedPropertySimplePU(true, local_2_0, "showPad");
    local_2_0.__showDebug = new ObservedPropertySimplePU(false, local_2_0, "showDebug");
    local_2_0.__exitDialogVisible = new ObservedPropertySimplePU(false, local_2_0, "exitDialogVisible");
    local_2_0.__padSwitchOn = new ObservedPropertySimplePU(true, local_2_0, "padSwitchOn");
    local_2_0.__dbgFps = new ObservedPropertySimplePU("FPS --", local_2_0, "dbgFps");
    local_2_0.__dbgX = new ObservedPropertySimplePU(12, local_2_0, "dbgX");
    local_2_0.__dbgY = new ObservedPropertySimplePU(12, local_2_0, "dbgY");
    local_2_0.dbgPanX = 0;
    local_2_0.dbgPanY = 0;
    local_2_0.debugTimer = -1;
    local_2_0.bootProbeTimer = -1;
    local_2_0.deviceWatcher = function (p0) {
      hilog.info(local_0_0, local_0_1, "input device %{public}s (id=%{public}d)", p0.type, p0.deviceId);
      local_2_0.rearmPhysicalPad(p0.type);
    };
    local_2_0.setInitiallyProvidedValue(p1);
    local_2_0.finalizeConstruction();
    return local_2_0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.promptKind !== undefined) {
      this.promptKind = p0.promptKind;
    }
    if (p0.promptTitle !== undefined) {
      this.promptTitle = p0.promptTitle;
    }
    if (p0.promptMessage !== undefined) {
      this.promptMessage = p0.promptMessage;
    }
    if (p0.promptInput !== undefined) {
      this.promptInput = p0.promptInput;
    }
    if (p0.promptButtons !== undefined) {
      this.promptButtons = p0.promptButtons;
    }
    if (p0.promptDiscLabels !== undefined) {
      this.promptDiscLabels = p0.promptDiscLabels;
    }
    if (p0.promptDiscPaths !== undefined) {
      this.promptDiscPaths = p0.promptDiscPaths;
    }
    if (p0.promptId !== undefined) {
      this.promptId = p0.promptId;
    }
    if (p0.quitAfterLeave !== undefined) {
      this.quitAfterLeave = p0.quitAfterLeave;
    }
    if (p0.lastSurfaceId !== undefined) {
      this.lastSurfaceId = p0.lastSurfaceId;
    }
    if (p0.promptTimer !== undefined) {
      this.promptTimer = p0.promptTimer;
    }
    if (p0.attachTimer !== undefined) {
      this.attachTimer = p0.attachTimer;
    }
    if (p0.xcompController !== undefined) {
      this.xcompController = p0.xcompController;
    }
    if (p0.scaleX !== undefined) {
      this.scaleX = p0.scaleX;
    }
    if (p0.scaleY !== undefined) {
      this.scaleY = p0.scaleY;
    }
    if (p0.letterbox !== undefined) {
      this.letterbox = p0.letterbox;
    }
    if (p0.showPad !== undefined) {
      this.showPad = p0.showPad;
    }
    if (p0.showDebug !== undefined) {
      this.showDebug = p0.showDebug;
    }
    if (p0.exitDialogVisible !== undefined) {
      this.exitDialogVisible = p0.exitDialogVisible;
    }
    if (p0.padSwitchOn !== undefined) {
      this.padSwitchOn = p0.padSwitchOn;
    }
    if (p0.dbgFps !== undefined) {
      this.dbgFps = p0.dbgFps;
    }
    if (p0.dbgX !== undefined) {
      this.dbgX = p0.dbgX;
    }
    if (p0.dbgY !== undefined) {
      this.dbgY = p0.dbgY;
    }
    if (p0.dbgPanX !== undefined) {
      this.dbgPanX = p0.dbgPanX;
    }
    if (p0.dbgPanY !== undefined) {
      this.dbgPanY = p0.dbgPanY;
    }
    if (p0.debugTimer !== undefined) {
      this.debugTimer = p0.debugTimer;
    }
    if (p0.bootProbeTimer !== undefined) {
      this.bootProbeTimer = p0.bootProbeTimer;
    }
    if (p0.deviceWatcher !== undefined) {
      this.deviceWatcher = p0.deviceWatcher;
    }
  }
  updateStateVars(p0) {}
  purgeVariableDependenciesOnElmtId(p0) {
    this.__promptKind.purgeDependencyOnElmtId(p0);
    this.__promptTitle.purgeDependencyOnElmtId(p0);
    this.__promptMessage.purgeDependencyOnElmtId(p0);
    this.__promptInput.purgeDependencyOnElmtId(p0);
    this.__promptButtons.purgeDependencyOnElmtId(p0);
    this.__promptDiscLabels.purgeDependencyOnElmtId(p0);
    this.__promptDiscPaths.purgeDependencyOnElmtId(p0);
    this.__scaleX.purgeDependencyOnElmtId(p0);
    this.__scaleY.purgeDependencyOnElmtId(p0);
    this.__showPad.purgeDependencyOnElmtId(p0);
    this.__showDebug.purgeDependencyOnElmtId(p0);
    this.__exitDialogVisible.purgeDependencyOnElmtId(p0);
    this.__padSwitchOn.purgeDependencyOnElmtId(p0);
    this.__dbgFps.purgeDependencyOnElmtId(p0);
    this.__dbgX.purgeDependencyOnElmtId(p0);
    this.__dbgY.purgeDependencyOnElmtId(p0);
  }
  aboutToBeDeleted() {
    this.__promptKind.aboutToBeDeleted();
    this.__promptTitle.aboutToBeDeleted();
    this.__promptMessage.aboutToBeDeleted();
    this.__promptInput.aboutToBeDeleted();
    this.__promptButtons.aboutToBeDeleted();
    this.__promptDiscLabels.aboutToBeDeleted();
    this.__promptDiscPaths.aboutToBeDeleted();
    this.__scaleX.aboutToBeDeleted();
    this.__scaleY.aboutToBeDeleted();
    this.__showPad.aboutToBeDeleted();
    this.__showDebug.aboutToBeDeleted();
    this.__exitDialogVisible.aboutToBeDeleted();
    this.__padSwitchOn.aboutToBeDeleted();
    this.__dbgFps.aboutToBeDeleted();
    this.__dbgX.aboutToBeDeleted();
    this.__dbgY.aboutToBeDeleted();
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  get promptKind() {
    return this.__promptKind.get();
  }
  set promptKind(p0) {
    this.__promptKind.set(p0);
  }
  get promptTitle() {
    return this.__promptTitle.get();
  }
  set promptTitle(p0) {
    this.__promptTitle.set(p0);
  }
  get promptMessage() {
    return this.__promptMessage.get();
  }
  set promptMessage(p0) {
    this.__promptMessage.set(p0);
  }
  get promptInput() {
    return this.__promptInput.get();
  }
  set promptInput(p0) {
    this.__promptInput.set(p0);
  }
  get promptButtons() {
    return this.__promptButtons.get();
  }
  set promptButtons(p0) {
    this.__promptButtons.set(p0);
  }
  get promptDiscLabels() {
    return this.__promptDiscLabels.get();
  }
  set promptDiscLabels(p0) {
    this.__promptDiscLabels.set(p0);
  }
  get promptDiscPaths() {
    return this.__promptDiscPaths.get();
  }
  set promptDiscPaths(p0) {
    this.__promptDiscPaths.set(p0);
  }
  get scaleX() {
    return this.__scaleX.get();
  }
  set scaleX(p0) {
    this.__scaleX.set(p0);
  }
  get scaleY() {
    return this.__scaleY.get();
  }
  set scaleY(p0) {
    this.__scaleY.set(p0);
  }
  get showPad() {
    return this.__showPad.get();
  }
  set showPad(p0) {
    this.__showPad.set(p0);
  }
  get showDebug() {
    return this.__showDebug.get();
  }
  set showDebug(p0) {
    this.__showDebug.set(p0);
  }
  get exitDialogVisible() {
    return this.__exitDialogVisible.get();
  }
  set exitDialogVisible(p0) {
    this.__exitDialogVisible.set(p0);
  }
  get padSwitchOn() {
    return this.__padSwitchOn.get();
  }
  set padSwitchOn(p0) {
    this.__padSwitchOn.set(p0);
  }
  get dbgFps() {
    return this.__dbgFps.get();
  }
  set dbgFps(p0) {
    this.__dbgFps.set(p0);
  }
  get dbgX() {
    return this.__dbgX.get();
  }
  set dbgX(p0) {
    this.__dbgX.set(p0);
  }
  get dbgY() {
    return this.__dbgY.get();
  }
  set dbgY(p0) {
    this.__dbgY.set(p0);
  }
  static readMemMb() {
    let v0, v3 /*fs*/, v4;
    v0 = [0, 0, 0];
    v3 = fs.readTextSync("/proc/self/status");
    v4 = new RegExp("VmRSS:\\s+(\\d+)").exec(v3);
    v3 = new RegExp("VmSize:\\s+(\\d+)").exec(v3);
    if (v4 !== null) {
      v4 = Number(v4[1]) / 1024;
      v0[0] = Math.round(v4);
    }
    if (v3 !== null) {
      v3 = Number(v3[1]) / 1024;
      v0[1] = Math.round(v3);
    }
    v3 = fs.readTextSync("/proc/meminfo");
    v3 = new RegExp("MemAvailable:\\s+(\\d+)").exec(v3);
    if (v3 !== null) {
      v0[2] = Math.round(Number(v3[1]) / 1024);
    }
    return v0;
  }
  static getEntryName() {
    return "GamePage";
  }
  updateFitScale(p0, p1) {
    let acc;
    if (p0 <= 0 || p1 <= 0) {
      return;
    }
    if (this.letterbox) {
      acc = Math.min(p0 / 1280, p1 / 720);
      this.scaleX = acc;
      this.scaleY = acc;
    } else {
      this.scaleX = p0 / 1280;
      this.scaleY = p1 / 720;
    }
    return;
  }
  setImmersive(p0) {
    let acc;
    let local_2_0;
    local_2_0 = p0;
    try {
      acc = window.getLastWindow(getContext(this)).then(function (p0) {
        let v1, v2;
        v1 = local_2_0 ? [] : ["status", "navigation"];
        p0.setWindowSystemBarEnable(v1).catch(function (p0) {
          hilog.error(local_0_0, local_0_1, "setWindowSystemBarEnable failed: %{public}s", p0.message);
        });
        v2 = !local_2_0;
        p0.setSpecificSystemBarEnabled("navigationIndicator", v2).catch(function (p0) {
          hilog.error(local_0_0, local_0_1, "setSpecificSystemBarEnabled failed: %{public}s", p0.message);
        });
      });
      acc.catch(function (p0) {
        hilog.error(local_0_0, local_0_1, "getLastWindow failed: %{public}s", p0.message);
      });
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "immersive failed: %{public}s", JSON.stringify(catchAcc));
    }
  }
  declareGameScene() {
    let acc;
    try {
      gamePlayer.init(getContext(this)).then(function () {
        hilog.info(local_0_0, local_0_1, "gamePlayer.init ok");
      }).catch(function (p0) {
        hilog.error(local_0_0, local_0_1, "gamePlayer.init failed: %{public}d %{public}s", p0.code, p0.message);
      });
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "gamePlayer unavailable: %{public}s", JSON.stringify(catchAcc));
    }
    try {
      acc = gamePerformance.init({
        "messageType": 0,
        "bundleName": "com.sddswsf.hx360e",
        "appVersion": "1.0.0"
      }).then(function () {
        hilog.info(local_0_0, local_0_1, "gamePerformance.init ok");
      });
      acc.catch(function (p0) {
        hilog.error(local_0_0, local_0_1, "gamePerformance.init failed: %{public}d %{public}s", p0.code, p0.message);
      });
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "gamePerformance unavailable: %{public}s", JSON.stringify(catchAcc));
    }
  }
  aboutToAppear() {
    let local_2_0;
    local_2_0 = this;
    try {
      Orientation.autoLandscape(getContext(local_2_0));
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "landscape failed: %{public}s", JSON.stringify(catchAcc));
    }
    local_2_0.setImmersive(true);
    local_2_0.declareGameScene();
    local_2_0.rearmPhysicalPad("enter");
    try {
      inputDevice.on("change", local_2_0.deviceWatcher);
      hilog.info(local_0_0, local_0_1, "gamepad hot-plug watcher registered");
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "gamepad watcher failed: %{public}s", JSON.stringify(catchAcc));
    }
    local_2_0.showPad = testNapi.emulator.showTouchOverlayEnabled();
    local_2_0.refreshDebugEnabled();
    local_2_0.debugTimer = setInterval(function () {
      return local_2_0.refreshDebugText();
    }, 600);
    local_2_0.attachTimer = setInterval(function () {
      return local_2_0.tryAttach();
    }, 200);
    local_2_0.promptTimer = setInterval(function () {
      return local_2_0.pollPrompt();
    }, 150);
    local_2_0.startBootProbe();
  }
  refreshDebugEnabled() {
    let v0 /*testNapi*/, v1;
    v0 = SettingsStore.shared();
    v0.open(getContext(this).filesDir);
    v1 = v0.raw("Display|show_debug_overlay") === "true";
    v0 = v0.raw("Display|present_letterbox");
    this.letterbox = v0 !== "false";
    if (!v1) {
      v1 = testNapi.emulator.showDebugOverlayEnabled();
    }
    this.showDebug = v1;
  }
  refreshDebugText() {
    let v0 /*testNapi*/, v1 /*testNapi*/;
    if (!this.showDebug) {
      return;
    }
    v0 = testNapi.emulator.averageFps();
    v1 = testNapi.emulator.lastFrameTimeMs();
    v0 = "FPS " + v0.toFixed(1) + " · " + v1.toFixed(1);
    this.dbgFps = v0 + "ms";
    return;
  }
  rearmPhysicalPad(p0) {
    try {
      testNapi.emulator.padStopPhysical();
      testNapi.emulator.padStartPhysical();
      hilog.info(local_0_0, local_0_1, "physical pad monitors re-armed (%{public}s)", p0);
    } catch (catchAcc) {
      hilog.warn(local_0_0, local_0_1, "re-arm physical pad failed: %{public}s", JSON.stringify(catchAcc));
    }
  }
  onBackPress() {
    this.padSwitchOn = this.showPad;
    this.exitDialogVisible = true;
    return true;
  }
  toggleDebugOverlay(p0) {
    this.showDebug = p0;
    if (p0) {
      this.refreshDebugText();
    }
    hilog.info(local_0_0, local_0_1, "debug overlay %{public}s", p0 ? "on" : "off");
  }
  exitGame() {
    this.exitDialogVisible = false;
    this.quitAfterLeave = true;
    AppLog.i("game", "exit game by user");
    try {
      router.back();
    } catch (catchAcc) {
      AppLog.exception("game", "exitGame back failed", catchAcc);
    }
  }
  aboutToDisappear() {
    inputDevice.off("change", this.deviceWatcher);
    if (this.quitAfterLeave) {
      this.quitAfterLeave = false;
      setTimeout(function () {
        try {
          hilog.info(local_0_0, local_0_1, "game quit after leaving page");
          testNapi.emulator.quit();
        } catch (catchAcc) {
          hilog.warn(local_0_0, local_0_1, "quit after leave failed: %{public}s", JSON.stringify(catchAcc));
        }
      }, 400);
    }
    Orientation.portrait(getContext(this));
    this.setImmersive(false);
    if (this.debugTimer >= 0) {
      clearInterval(this.debugTimer);
      this.debugTimer = -1;
    }
    if (this.attachTimer >= 0) {
      clearInterval(this.attachTimer);
      this.attachTimer = -1;
    }
    if (this.promptTimer >= 0) {
      clearInterval(this.promptTimer);
      this.stopBootProbe();
      this.promptTimer = -1;
    }
    testNapi.emulator.padReleaseAll();
    this.cancelAllPrompts();
  }
  tryAttach() {
    let v1 /*hilog*/, v4 /*TAG*/;
    try {
      v1 = this.xcompController.getXComponentSurfaceId();
      switch (v1) {
        case "":
        case "0":
        case this.lastSurfaceId:
          return;
      }
      v4 = testNapi.attachSurface(v1);
      this.lastSurfaceId = v1;
      hilog.info(local_0_0, local_0_1, "attachSurface(%{public}s) -> %{public}d", v1, v4 ? 1 : 0);
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "attach failed: %{public}s", JSON.stringify(catchAcc));
    }
  }
  pollPrompt() {
    let v0 /*testNapi*/;
    if (this.promptKind === "") {
      v0 = testNapi.prompt.keyboardRequest();
      if (v0 === null) {
        v0 = testNapi.prompt.msgboxRequest();
        if (v0 === null) {
          v0 = testNapi.prompt.discRequest();
          if (v0 !== null) {
            this.promptId = v0.id;
            this.promptTitle = "请更换光盘";
            this.promptMessage = v0.message;
            this.promptDiscLabels = v0.discLabels;
            this.promptDiscPaths = v0.discPaths;
            this.promptKind = "disc";
          }
          return;
        }
        this.promptId = v0.id;
        this.promptTitle = v0.title;
        this.promptMessage = v0.text;
        this.promptButtons = v0.buttons;
        this.promptKind = "msgbox";
        return;
      }
      this.promptId = v0.id;
      this.promptTitle = v0.title;
      this.promptMessage = v0.description;
      this.promptInput = v0.defaultText;
      this.promptKind = "keyboard";
    }
    return;
  }
  clearPrompt() {
    this.promptKind = "";
    this.promptTitle = "";
    this.promptMessage = "";
    this.promptInput = "";
    this.promptButtons = [];
    this.promptDiscLabels = [];
    this.promptDiscPaths = [];
  }
  submitKeyboard(p0) {
    try {
      testNapi.prompt.keyboardSubmit(this.promptId, p0, this.promptInput);
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "keyboardSubmit failed: %{public}s", JSON.stringify(catchAcc));
    }
    this.clearPrompt();
  }
  submitMsgbox(p0) {
    try {
      testNapi.prompt.msgboxSubmit(this.promptId, p0);
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "msgboxSubmit failed: %{public}s", JSON.stringify(catchAcc));
    }
    this.clearPrompt();
  }
  submitDisc(p0, p1) {
    try {
      testNapi.prompt.discSubmit(this.promptId, p0, p1);
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "discSubmit failed: %{public}s", JSON.stringify(catchAcc));
    }
    this.clearPrompt();
  }
  cancelAllPrompts() {
    testNapi.prompt.keyboardCancelAll();
    testNapi.prompt.msgboxCancelAll();
    testNapi.prompt.discCancelAll();
    this.clearPrompt();
  }
  startBootProbe() {
    let local_2_0, local_2_1;
    local_2_1 = this;
    local_2_0 = 0;
    local_2_1.bootProbeTimer = setInterval(function () {
      let v1 /*GamePage*/;
      local_2_0 += 1;
      v1 = GamePage.readMemMb();
      AppLog.i("probe", "t=" + local_2_0 /*ticks*/ * 200 + "ms rss=" + v1[0] + "MB vm=" + v1[1] + "MB avail=" + v1[2] + "MB frames=" + testNapi.vulkanStatus().frames + "");
      if (local_2_0 /*ticks*/ >= 300) {
        local_2_1.stopBootProbe();
      }
    }, 200);
  }
  stopBootProbe() {
    if (this.bootProbeTimer >= 0) {
      clearInterval(this.bootProbeTimer);
      this.bootProbeTimer = -1;
    }
  }
  keyValue(p0) {
    switch (p0) {
      case XPadKey.LTrigger:
      case XPadKey.RTrigger:
        return 255;
      case XPadKey.LThumbLeft:
      case XPadKey.LThumbDown:
      case XPadKey.RThumbLeft:
      case XPadKey.RThumbDown:
        return -32767;
      case XPadKey.LThumbRight:
      case XPadKey.LThumbUp:
      case XPadKey.RThumbRight:
      case XPadKey.RThumbUp:
        return 32767;
      default:
        return 0;
    }
  }
  padPress(p0, p1) {
    try {
      testNapi.emulator.keyEvent(p0, p1, this.keyValue(p0));
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "keyEvent failed: %{public}s", JSON.stringify(catchAcc));
    }
  }
  stickToKeys(p0, p1, p2) {
    let v2 /*DOMAIN*/, v3 /*TAG*/, v4 /*testNapi*/, v5 /*XPadKey*/, v6 /*XPadKey*/, v7 /*XPadKey*/;
    v2 = Math.round(Math.abs(p1) * 32767);
    v3 = Math.round(Math.abs(p2) * 32767);
    v4 = p0 ? XPadKey.LThumbLeft : XPadKey.RThumbLeft;
    v5 = p0 ? XPadKey.LThumbRight : XPadKey.RThumbRight;
    v6 = p0 ? XPadKey.LThumbUp : XPadKey.RThumbUp;
    v7 = p0 ? XPadKey.LThumbDown : XPadKey.RThumbDown;
    try {
      testNapi.emulator.keyEvent(v4, p1 < -0.12, p1 < -0.12 ? -v2 : 0);
      if (p1 <= 0.12) {
        v2 = 0;
      }
      testNapi.emulator.keyEvent(v5, p1 > 0.12, v2);
      testNapi.emulator.keyEvent(v6, p2 > 0.12, p2 > 0.12 ? v3 : 0);
      testNapi.emulator.keyEvent(v7, p2 < -0.12, p2 < -0.12 ? -v3 : 0);
    } catch (catchAcc) {
      hilog.error(local_0_0, local_0_1, "stick keyEvent failed: %{public}s", JSON.stringify(catchAcc));
    }
  }
  dpadToKeys(p0, p1, p2, p3) {
    this.padPress(XPadKey.DpadUp, p0);
    this.padPress(XPadKey.DpadDown, p1);
    this.padPress(XPadKey.DpadLeft, p2);
    this.padPress(XPadKey.DpadRight, p3);
  }
  physicalPadKey(p0) {
    switch (p0) {
      case 2301:
        return XPadKey.A;
      case 2302:
        return XPadKey.B;
      case 2304:
        return XPadKey.X;
      case 2305:
        return XPadKey.Y;
      case 2307:
        return XPadKey.LShoulder;
      case 2308:
        return XPadKey.RShoulder;
      case 2309:
        return XPadKey.LTrigger;
      case 2310:
        return XPadKey.RTrigger;
      case 2311:
        return XPadKey.Back;
      case 2312:
        return XPadKey.Start;
      case 2313:
        return XPadKey.Back;
      case 2314:
        return XPadKey.LThumbPress;
      case 2315:
        return XPadKey.RThumbPress;
      case 2012:
        return XPadKey.DpadUp;
      case 2013:
        return XPadKey.DpadDown;
      case 2014:
        return XPadKey.DpadLeft;
      case 2015:
        return XPadKey.DpadRight;
      default:
        return -1;
    }
  }
  handlePhysicalAxis(p0) {
    let v1, v2;
    v1 = p0.getHorizontalAxisValue();
    v2 = -p0.getVerticalAxisValue();
    if (v1 !== 0 || v2 !== 0) {
      this.stickToKeys(true, v1, v2);
    }
  }
  handlePhysicalKey(p0) {
    let v0;
    v0 = this.physicalPadKey(p0.keyCode);
    if (v0 < 0) {
      return false;
    }
    this.padPress(v0, p0.type === KeyType.Down);
    hilog.info(local_0_0, local_0_1, "physical pad keyCode=%{public}d -> %{public}d %{public}s", p0.keyCode, v0, p0.type === KeyType.Down ? "down" : "up");
    return true;
  }
  roundBtn(p0, p1, p2, p3, p4, p5) {
    let local_2_0, local_2_1, local_2_2, local_2_3, local_2_4, local_2_5;
    local_2_5 = this;
    local_2_0 = p0;
    local_2_4 = p1;
    local_2_1 = p2;
    local_2_2 = p3;
    local_2_3 = p4;
    local_2_5.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new PadButton(local_2_5, {
          "label": local_2_0,
          "btnWidth": local_2_1,
          "btnHeight": local_2_1,
          "round": true,
          "fontSize": local_2_1 * 0.4,
          "fill": local_2_2,
          "pressedFill": local_2_3,
          "onPress": function (p0) {
            local_2_5.padPress(local_2_4, p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/GamePage.ets",
          "line": 611,
          "col": 5
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "label": local_2_0,
            "btnWidth": local_2_1,
            "btnHeight": local_2_1,
            "round": true,
            "fontSize": local_2_1 * 0.4,
            "fill": local_2_2,
            "pressedFill": local_2_3,
            "onPress": function (p0) {
              local_2_5.padPress(local_2_4, p0);
            }
          };
        };
      } else {
        local_2_5.updateStateVarsOfChildByElmtId(p0, {
          "label": local_2_0,
          "btnWidth": local_2_1,
          "btnHeight": local_2_1,
          "round": true,
          "fontSize": local_2_1 * 0.4
        });
      }
    }, {
      "name": "PadButton"
    });
  }
  rectBtn(p0, p1, p2, p3, p4) {
    let local_2_0, local_2_1, local_2_2, local_2_3, local_2_4;
    local_2_4 = this;
    local_2_0 = p0;
    local_2_3 = p1;
    local_2_1 = p2;
    local_2_2 = p3;
    local_2_4.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new PadButton(local_2_4, {
          "label": local_2_0,
          "btnWidth": local_2_1,
          "btnHeight": local_2_2,
          "round": false,
          "fontSize": 15,
          "fill": "#59000000",
          "pressedFill": "#8C000000",
          "onPress": function (p0) {
            local_2_4.padPress(local_2_3, p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/GamePage.ets",
          "line": 628,
          "col": 5
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "label": local_2_0,
            "btnWidth": local_2_1,
            "btnHeight": local_2_2,
            "round": false,
            "fontSize": 15,
            "fill": "#59000000",
            "pressedFill": "#8C000000",
            "onPress": function (p0) {
              local_2_4.padPress(local_2_3, p0);
            }
          };
        };
      } else {
        local_2_4.updateStateVarsOfChildByElmtId(p0, {
          "label": local_2_0,
          "btnWidth": local_2_1,
          "btnHeight": local_2_2,
          "round": false,
          "fontSize": 15
        });
      }
    }, {
      "name": "PadButton"
    });
  }
  abxyPad(p0) {
    this.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": 0
      });
      Column.width(124);
    }, Column);
    this.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.justifyContent(FlexAlign.Center);
      Row.width("100%");
    }, Row);
    this.roundBtn.bind(this)("Y", XPadKey.Y, 44, "#8A7A2E", "#C9B03A");
    Row.pop();
    this.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 0
      });
    }, Row);
    this.roundBtn.bind(this)("X", XPadKey.X, 44, "#2F5DA8", "#4E86D8");
    this.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width(36);
      Column.height(44);
    }, Column);
    Column.pop();
    this.roundBtn.bind(this)("B", XPadKey.B, 44, "#8E2B2B", "#C24242");
    Row.pop();
    this.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.justifyContent(FlexAlign.Center);
      Row.width("100%");
    }, Row);
    this.roundBtn.bind(this)("A", XPadKey.A, 44, "#2E7D32", "#49A44F");
    Row.pop();
    Column.pop();
  }
  exitDialog(p0) {
    let local_2_0;
    local_2_0 = this;
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.height("100%");
      Column.justifyContent(FlexAlign.Center);
      Column.backgroundColor("#66000000");
      Column.onClick(function () {});
    }, Column);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": 18
      });
      Column.width("80%");
      Column.padding(18);
      Column.backgroundColor("#ee202020");
      Column.borderRadius(14);
    }, Column);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Text.create("游戏菜单");
      Text.fontSize(17);
      Text.fontWeight(FontWeight.Medium);
      Text.fontColor("#FFFFFF");
      Text.width("100%");
    }, Text);
    Text.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.width("100%");
    }, Row);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Text.create("屏幕手柄");
      Text.fontSize(15);
      Text.fontColor("#FFFFFF");
    }, Text);
    Text.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Blank.create();
    }, Blank);
    Blank.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Toggle.create({
        "type": ToggleType.Switch,
        "isOn": local_2_0.padSwitchOn
      });
      Toggle.selectedColor("#2E7D32");
      Toggle.onChange(function (p0) {
        local_2_0.padSwitchOn = p0;
        local_2_0.showPad = p0;
        try {
          testNapi.emulator.setShowTouchOverlay(p0);
        } catch (catchAcc) {
          hilog.error(local_0_0, local_0_1, "setShowTouchOverlay failed: %{public}s", JSON.stringify(catchAcc));
        }
      });
    }, Toggle);
    Toggle.pop();
    Row.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.color("#33FFFFFF");
    }, Divider);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.width("100%");
    }, Row);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Text.create("调试信息");
      Text.fontSize(15);
      Text.fontColor("#FFFFFF");
    }, Text);
    Text.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Blank.create();
    }, Blank);
    Blank.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Toggle.create({
        "type": ToggleType.Switch,
        "isOn": local_2_0.showDebug
      });
      Toggle.selectedColor("#2E7D32");
      Toggle.onChange(function (p0) {
        local_2_0.toggleDebugOverlay(p0);
      });
    }, Toggle);
    Toggle.pop();
    Row.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 12
      });
      Row.width("100%");
    }, Row);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("继续游戏");
      Button.fontSize(15);
      Button.height(40);
      Button.layoutWeight(1);
      Button.fontColor("#FFFFFF");
      Button.backgroundColor("#33FFFFFF");
      Button.onClick(function () {
        local_2_0.exitDialogVisible = false;
      });
    }, Button);
    Button.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("退出游戏");
      Button.fontSize(15);
      Button.height(40);
      Button.layoutWeight(1);
      Button.fontColor("#FFFFFF");
      Button.backgroundColor("#C24242");
      Button.onClick(function () {
        local_2_0.exitGame();
      });
    }, Button);
    Button.pop();
    Row.pop();
    Column.pop();
    Column.pop();
  }
  initialRender() {
    let local_2_0;
    local_2_0 = this;
    local_2_0.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Center
      });
      Stack.width("100%");
      Stack.height("100%");
      Stack.backgroundColor("#000000");
      Stack.onKeyEvent(function (p0) {
        return local_2_0.handlePhysicalKey(p0);
      });
      Stack.onAxisEvent(function (p0) {
        local_2_0.handlePhysicalAxis(p0);
      });
      Stack.onAreaChange(function (p0, p1) {
        let v0, v2, v3 /*display*/, v4, v5 /*hilog*/;
        v3 = display.getDefaultDisplaySync();
        v4 = v3.densityPixels;
        v5 = v3.width;
        v3 = v3.height;
        v0 = v4;
        v2 = v3;
        v3 = Math.round(p1.width * v4);
        v4 = Math.round(p1.height * v4);
        local_2_0.updateFitScale(v3, v4);
        v2 = Math.round(v2);
        v0 = Math.round(v0 * 1000);
        hilog.info(local_0_0, local_0_1, "stage %{public}d x %{public}d px; screen %{public}d x %{public}d density=%{public}d", v3, v4, Math.round(v5), v2, v0);
      });
    }, Stack);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      XComponent.create({
        "id": "hx360e_surface_game",
        "type": XComponentType.SURFACE,
        "libraryname": "entry",
        "controller": local_2_0.xcompController
      }, "com.sddswsf.hx360e/entry");
      XComponent.width("1280px");
      XComponent.height("720px");
      XComponent.scale({
        "x": local_2_0.scaleX,
        "y": local_2_0.scaleY,
        "centerX": "50%",
        "centerY": "50%"
      });
      XComponent.onSizeChange(function (p0, p1) {
        hilog.info(local_0_0, local_0_1, "xcomponent size %{public}d x %{public}d (was %{public}d x %{public}d)", Math.round(p1.width), Math.round(p1.height), Math.round(p0.width), Math.round(p0.height));
      });
    }, XComponent);
    local_2_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_2_0.showPad) {
        local_2_0.ifElseBranchUpdateFunction(0, function () {
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("100%");
            Row.height("100%");
            Row.alignItems(VerticalAlign.Top);
            Row.padding({
              "left": 10,
              "right": 10,
              "top": 6
            });
            Row.hitTestBehavior(HitTestMode.None);
          }, Row);
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": 6
            });
            Column.alignItems(HorizontalAlign.Start);
          }, Column);
          local_2_0.rectBtn.bind(local_2_0)("LT", XPadKey.LTrigger, 104, 44);
          local_2_0.rectBtn.bind(local_2_0)("LB", XPadKey.LShoulder, 92, 38);
          Column.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Blank.create();
          }, Blank);
          Blank.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": 6
            });
            Column.alignItems(HorizontalAlign.End);
          }, Column);
          local_2_0.rectBtn.bind(local_2_0)("RT", XPadKey.RTrigger, 104, 44);
          local_2_0.rectBtn.bind(local_2_0)("RB", XPadKey.RShoulder, 92, 38);
          Column.pop();
          Row.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 56
            });
            Row.width("100%");
            Row.height("100%");
            Row.justifyContent(FlexAlign.Center);
            Row.alignItems(VerticalAlign.Bottom);
            Row.padding({
              "bottom": 14
            });
            Row.hitTestBehavior(HitTestMode.None);
          }, Row);
          local_2_0.roundBtn.bind(local_2_0)("◀", XPadKey.Back, 40, "#59000000", "#8C000000");
          local_2_0.roundBtn.bind(local_2_0)("▶", XPadKey.Start, 40, "#59000000", "#8C000000");
          Row.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": 34
            });
            Column.width("100%");
            Column.height("100%");
            Column.alignItems(HorizontalAlign.Start);
            Column.justifyContent(FlexAlign.Start);
            Column.padding({
              "left": 12,
              "top": 104,
              "bottom": 40
            });
            Column.hitTestBehavior(HitTestMode.None);
          }, Column);
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 10
            });
            Row.alignItems(VerticalAlign.Center);
          }, Row);
          local_2_0.observeComponentCreation2(function (p0, p1) {
            let acc;
            if (p1) {
              acc = new VirtualStick(local_2_0, {
                "diameter": 118,
                "knobDiameter": 48,
                "onStick": function (p0, p1) {
                  local_2_0.stickToKeys(true, p0, p1);
                }
              }, undefined, p0, function () {}, {
                "page": "entry/src/main/ets/pages/GamePage.ets",
                "line": 824,
                "col": 13
              });
              ViewPU.create(acc);
              acc.paramsGenerator_ = function () {
                return {
                  "diameter": 118,
                  "knobDiameter": 48,
                  "onStick": function (p0, p1) {
                    local_2_0.stickToKeys(true, p0, p1);
                  }
                };
              };
            } else {
              local_2_0.updateStateVarsOfChildByElmtId(p0, {
                "diameter": 118,
                "knobDiameter": 48
              });
            }
          }, {
            "name": "VirtualStick"
          });
          local_2_0.roundBtn.bind(local_2_0)("L3", XPadKey.LThumbPress, 40, "#59000000", "#8C000000");
          Row.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            let acc;
            if (p1) {
              acc = new VirtualDpad(local_2_0, {
                "diameter": 118,
                "onDir": function (p0, p1, p2, p3) {
                  local_2_0.dpadToKeys(p0, p1, p2, p3);
                }
              }, undefined, p0, function () {}, {
                "page": "entry/src/main/ets/pages/GamePage.ets",
                "line": 835,
                "col": 11
              });
              ViewPU.create(acc);
              acc.paramsGenerator_ = function () {
                return {
                  "diameter": 118,
                  "onDir": function (p0, p1, p2, p3) {
                    local_2_0.dpadToKeys(p0, p1, p2, p3);
                  }
                };
              };
            } else {
              local_2_0.updateStateVarsOfChildByElmtId(p0, {
                "diameter": 118
              });
            }
          }, {
            "name": "VirtualDpad"
          });
          Column.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": 20
            });
            Column.width("100%");
            Column.height("100%");
            Column.alignItems(HorizontalAlign.End);
            Column.justifyContent(FlexAlign.Start);
            Column.padding({
              "right": 12,
              "top": 104,
              "bottom": 40
            });
            Column.hitTestBehavior(HitTestMode.None);
          }, Column);
          local_2_0.abxyPad.bind(local_2_0)();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 10
            });
            Row.alignItems(VerticalAlign.Center);
          }, Row);
          local_2_0.roundBtn.bind(local_2_0)("R3", XPadKey.RThumbPress, 40, "#59000000", "#8C000000");
          local_2_0.observeComponentCreation2(function (p0, p1) {
            let acc;
            if (p1) {
              acc = new VirtualStick(local_2_0, {
                "diameter": 118,
                "knobDiameter": 48,
                "onStick": function (p0, p1) {
                  local_2_0.stickToKeys(false, p0, p1);
                }
              }, undefined, p0, function () {}, {
                "page": "entry/src/main/ets/pages/GamePage.ets",
                "line": 854,
                "col": 13
              });
              ViewPU.create(acc);
              acc.paramsGenerator_ = function () {
                return {
                  "diameter": 118,
                  "knobDiameter": 48,
                  "onStick": function (p0, p1) {
                    local_2_0.stickToKeys(false, p0, p1);
                  }
                };
              };
            } else {
              local_2_0.updateStateVarsOfChildByElmtId(p0, {
                "diameter": 118,
                "knobDiameter": 48
              });
            }
          }, {
            "name": "VirtualStick"
          });
          Row.pop();
          Column.pop();
        });
      } else {
        local_2_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_2_0.showDebug) {
        local_2_0.ifElseBranchUpdateFunction(0, function () {
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.TopStart
            });
            Stack.width("100%");
            Stack.height("100%");
            Stack.hitTestBehavior(HitTestMode.None);
          }, Stack);
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 12
            });
            Row.padding({
              "left": 10,
              "right": 10,
              "top": 6,
              "bottom": 6
            });
            Row.backgroundColor("#8C000000");
            Row.borderRadius(8);
            Row.position({
              "x": local_2_0.dbgX,
              "y": local_2_0.dbgY
            });
            globalThis.Gesture.create(GesturePriority.Low);
            PanGesture.create();
            PanGesture.onActionStart(function () {
              local_2_0.dbgPanX = local_2_0.dbgX;
              local_2_0.dbgPanY = local_2_0.dbgY;
            });
            PanGesture.onActionUpdate(function (p0) {
              local_2_0.dbgX = Math.max(0, local_2_0.dbgPanX + p0.offsetX);
              local_2_0.dbgY = Math.max(0, local_2_0.dbgPanY + p0.offsetY);
            });
            PanGesture.pop();
            globalThis.Gesture.pop();
          }, Row);
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_2_0.dbgFps);
            Text.fontSize(12);
            Text.fontColor("#E6FFFFFF");
          }, Text);
          Text.pop();
          Row.pop();
          Stack.pop();
        });
      } else {
        local_2_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_2_0.promptKind === "") {
        local_2_0.ifElseBranchUpdateFunction(1, function () {});
      } else {
        local_2_0.ifElseBranchUpdateFunction(0, function () {
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("100%");
            Column.height("100%");
            Column.justifyContent(FlexAlign.Center);
            Column.backgroundColor("#66000000");
          }, Column);
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": 10
            });
            Column.width("80%");
            Column.padding(16);
            Column.backgroundColor("#ee202020");
            Column.borderRadius(10);
          }, Column);
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_2_0.promptTitle);
            Text.fontSize(16);
            Text.fontColor("#fff");
            Text.width("100%");
          }, Text);
          Text.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_2_0.promptMessage);
            Text.fontSize(13);
            Text.fontColor("#ddd");
            Text.width("100%");
          }, Text);
          Text.pop();
          local_2_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_2_0.promptKind === "keyboard") {
              local_2_0.ifElseBranchUpdateFunction(0, function () {
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  TextInput.create({
                    "placeholder": "请输入…",
                    "text": local_2_0.promptInput
                  });
                  TextInput.width("100%");
                  TextInput.fontColor("#FFFFFF");
                  TextInput.backgroundColor("#26FFFFFF");
                  TextInput.placeholderColor("#80FFFFFF");
                  TextInput.onChange(function (p0) {
                    local_2_0.promptInput = p0;
                  });
                }, TextInput);
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  Row.create({
                    "space": 8
                  });
                  Row.width("100%");
                }, Row);
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  Button.createWithLabel("确定");
                  Button.layoutWeight(1);
                  Button.fontColor("#FFFFFF");
                  Button.backgroundColor("#33FFFFFF");
                  Button.onClick(function () {
                    return local_2_0.submitKeyboard(true);
                  });
                }, Button);
                Button.pop();
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  Button.createWithLabel("取消");
                  Button.layoutWeight(1);
                  Button.fontColor("#FFFFFF");
                  Button.backgroundColor("#33FFFFFF");
                  Button.onClick(function () {
                    return local_2_0.submitKeyboard(false);
                  });
                }, Button);
                Button.pop();
                Row.pop();
              });
            } else if (local_2_0.promptKind === "msgbox") {
              local_2_0.ifElseBranchUpdateFunction(1, function () {
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  Flex.create({
                    "wrap": FlexWrap.Wrap,
                    "justifyContent": FlexAlign.Center
                  });
                  Flex.width("100%");
                }, Flex);
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  ForEach.create();
                  local_2_0.forEachUpdateFunction(p0, local_2_0.promptButtons, function (p0, p1) {
                    let local_3_0, local_3_1;
                    local_3_1 = p1;
                    local_3_0 = p0;
                    local_2_0.observeComponentCreation2(function (p0, p1) {
                      Button.createWithLabel(local_3_0);
                      Button.margin(4);
                      Button.fontColor("#FFFFFF");
                      Button.backgroundColor("#33FFFFFF");
                      Button.onClick(function () {
                        return local_2_0.submitMsgbox(local_3_1);
                      });
                    }, Button);
                    Button.pop();
                  }, undefined, true, false);
                }, ForEach);
                ForEach.pop();
                Flex.pop();
              });
            } else {
              local_2_0.ifElseBranchUpdateFunction(2, function () {
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  Column.create({
                    "space": 6
                  });
                  Column.width("100%");
                }, Column);
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  ForEach.create();
                  local_2_0.forEachUpdateFunction(p0, local_2_0.promptDiscLabels, function (p0, p1) {
                    let local_3_0, local_3_1;
                    local_3_1 = p1;
                    local_3_0 = p0;
                    local_2_0.observeComponentCreation2(function (p0, p1) {
                      Button.createWithLabel(local_3_0);
                      Button.width("100%");
                      Button.fontColor("#FFFFFF");
                      Button.backgroundColor("#33FFFFFF");
                      Button.onClick(function () {
                        return local_2_0.submitDisc(true, local_2_0.promptDiscPaths[local_3_1]);
                      });
                    }, Button);
                    Button.pop();
                  }, undefined, true, false);
                }, ForEach);
                ForEach.pop();
                local_2_0.observeComponentCreation2(function (p0, p1) {
                  Button.createWithLabel("取消");
                  Button.width("100%");
                  Button.fontColor("#FFFFFF");
                  Button.backgroundColor("#33FFFFFF");
                  Button.onClick(function () {
                    return local_2_0.submitDisc(false, "");
                  });
                }, Button);
                Button.pop();
                Column.pop();
              });
            }
          }, If);
          If.pop();
          Column.pop();
          Column.pop();
        });
      }
    }, If);
    If.pop();
    local_2_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_2_0.exitDialogVisible) {
        local_2_0.ifElseBranchUpdateFunction(0, function () {
          local_2_0.exitDialog.bind(local_2_0)();
        });
      } else {
        local_2_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Stack.pop();
  }
  rerender() {
    this.updateDirtyElements();
  }
}
registerNamedRoute(function () {
  return new GamePage(undefined, {});
}, "", {
  "bundleName": "com.sddswsf.hx360e",
  "moduleName": "entry",
  "pagePath": "pages/GamePage",
  "pageFullPath": "entry/src/main/ets/pages/GamePage",
  "integratedHsp": "false",
  "moduleType": "followWithHap"
});