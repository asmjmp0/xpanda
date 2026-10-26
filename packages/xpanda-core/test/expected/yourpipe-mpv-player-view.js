/*
* class name:L&@yourpipe/libmpv-napi/src/main/ets/components/MpvPlayerView&0.2.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { MpvPlayerController } from "@normalized:N&&&@yourpipe/libmpv-napi/src/main/ets/controller/MpvPlayerController&0.2.0";
let VideoFit;
VideoFit = undefined;
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
VideoFit = {
  Contain: 0,
  0: "Contain",
  Cover: 1,
  1: "Cover",
  Fill: 2,
  2: "Fill"
};
class MpvPlayerView extends ViewPU {
  constructor(p0, p1, p2, p3, p4, p5) {
    let v2, v6, v7;
    v6 = p3 === undefined ? -1 : p3;
    v7 = p4 === undefined ? undefined : p4;
    v2 = super(p0, p2, v6, p5);
    if (typeof v7 === "function") {
      v2.paramsGenerator_ = v7;
    }
    v2.controller = new MpvPlayerController();
    v2.playerBgColor = Color.Black;
    v2.__videoFit = new SynchedPropertySimpleOneWayPU(p1.videoFit, v2, "videoFit");
    v2.xComponentController = new XComponentController();
    v2.__videoW = new ObservedPropertySimplePU(0, v2, "videoW");
    v2.__videoH = new ObservedPropertySimplePU(0, v2, "videoH");
    v2.__areaW = new ObservedPropertySimplePU(0, v2, "areaW");
    v2.__areaH = new ObservedPropertySimplePU(0, v2, "areaH");
    v2.sized = false;
    v2.sizeTimer = -1;
    v2.setInitiallyProvidedValue(p1);
    v2.finalizeConstruction();
    return v2;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.controller !== undefined) {
      this.controller = p0.controller;
    }
    if (p0.playerBgColor !== undefined) {
      this.playerBgColor = p0.playerBgColor;
    }
    if (p0.videoFit === undefined) {
      this.__videoFit.set(VideoFit.Contain);
    }
    if (p0.xComponentController !== undefined) {
      this.xComponentController = p0.xComponentController;
    }
    if (p0.videoW !== undefined) {
      this.videoW = p0.videoW;
    }
    if (p0.videoH !== undefined) {
      this.videoH = p0.videoH;
    }
    if (p0.areaW !== undefined) {
      this.areaW = p0.areaW;
    }
    if (p0.areaH !== undefined) {
      this.areaH = p0.areaH;
    }
    if (p0.sized !== undefined) {
      this.sized = p0.sized;
    }
    if (p0.sizeTimer !== undefined) {
      this.sizeTimer = p0.sizeTimer;
    }
  }
  updateStateVars(p0) {
    this.__videoFit.reset(p0.videoFit);
  }
  purgeVariableDependenciesOnElmtId(p0) {
    this.__videoFit.purgeDependencyOnElmtId(p0);
    this.__videoW.purgeDependencyOnElmtId(p0);
    this.__videoH.purgeDependencyOnElmtId(p0);
    this.__areaW.purgeDependencyOnElmtId(p0);
    this.__areaH.purgeDependencyOnElmtId(p0);
  }
  aboutToBeDeleted() {
    this.__videoFit.aboutToBeDeleted();
    this.__videoW.aboutToBeDeleted();
    this.__videoH.aboutToBeDeleted();
    this.__areaW.aboutToBeDeleted();
    this.__areaH.aboutToBeDeleted();
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  get videoFit() {
    return this.__videoFit.get();
  }
  set videoFit(p0) {
    this.__videoFit.set(p0);
  }
  get videoW() {
    return this.__videoW.get();
  }
  set videoW(p0) {
    this.__videoW.set(p0);
  }
  get videoH() {
    return this.__videoH.get();
  }
  set videoH(p0) {
    this.__videoH.set(p0);
  }
  get areaW() {
    return this.__areaW.get();
  }
  set areaW(p0) {
    this.__areaW.set(p0);
  }
  get areaH() {
    return this.__areaH.get();
  }
  set areaH(p0) {
    this.__areaH.set(p0);
  }
  fitScale() {
    if ((this.videoW > 0 ? this.videoH <= 0 : this.videoW <= 0) || this.areaW <= 0 || this.areaH <= 0) {
      return 1;
    }
    if (this.videoFit === VideoFit.Cover) {
      return Math.max(this.areaW / this.videoW, this.areaH / this.videoH);
    }
    return Math.min(this.areaW / this.videoW, this.areaH / this.videoH);
  }
  fitScaleX() {
    return this.videoFit === VideoFit.Fill && this.videoW > 0 && this.areaW > 0 ? this.areaW / this.videoW : this.fitScale();
  }
  fitScaleY() {
    return this.videoFit === VideoFit.Fill && this.videoH > 0 && this.areaH > 0 ? this.areaH / this.videoH : this.fitScale();
  }
  tryFixVideoSize() {
    let v3, v4, v5, v6;
    if (this.sized) {
      return;
    }
    v4 = this.controller.getMediaInfo();
    v5 = v4 && v4.video && v4.video.length > 0 ? v4.video[0] : undefined;
    v6 = v5 ? v5.width : 0;
    v3 = v5 ? v5.height : 0;
    if (v6 > 0 && v3 > 0) {
      this.videoW = v6;
      this.videoH = v3;
      this.sized = true;
      if (this.sizeTimer !== -1) {
        clearInterval(this.sizeTimer);
        this.sizeTimer = -1;
      }
    }
    return;
  }
  startSizePolling() {
    let local_0_0;
    local_0_0 = this;
    if (local_0_0.sized || local_0_0.sizeTimer !== -1) {
      return;
    }
    local_0_0.tryFixVideoSize();
    if (!local_0_0.sized) {
      local_0_0.sizeTimer = setInterval(function () {
        return local_0_0.tryFixVideoSize();
      }, 100);
    }
    return;
  }
  aboutToDisappear() {
    if (this.sizeTimer !== -1) {
      clearInterval(this.sizeTimer);
      this.sizeTimer = -1;
    }
  }
  initialRender() {
    let local_0_0;
    local_0_0 = this;
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Stack.create();
      Stack.width("100%");
      Stack.height("100%");
      Stack.clip(true);
      Stack.alignContent(Alignment.Center);
      Stack.onAreaChange(function (p0, p1) {
        let v5, v6;
        v6 = vp2px(p1.width);
        v5 = vp2px(p1.height);
        if (v6 > 0 && v5 > 0) {
          local_0_0.areaW = v6;
          local_0_0.areaH = v5;
        }
      });
    }, Stack);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let acc;
      XComponent.create({
        "id": local_0_0.controller.playerId,
        "type": XComponentType.SURFACE,
        "libraryname": "mpv_napi",
        "controller": local_0_0.xComponentController
      }, "com.talon.yourpipe/entry");
      XComponent.onLoad(function () {
        local_0_0.controller.setVideoSurfaceId(local_0_0.xComponentController.getXComponentSurfaceId());
        local_0_0.startSizePolling();
      });
      acc = local_0_0.sized ? px2vp(local_0_0.videoW) : "100%";
      XComponent.width(acc);
      acc = local_0_0.sized ? px2vp(local_0_0.videoH) : "100%";
      XComponent.height(acc);
      acc = local_0_0.sized ? {
        "x": local_0_0.fitScaleX(),
        "y": local_0_0.fitScaleY(),
        "centerX": "50%",
        "centerY": "50%"
      } : {
        "x": 1,
        "y": 1
      };
      XComponent.scale(acc);
      XComponent.backgroundColor(local_0_0.playerBgColor);
    }, XComponent);
    Stack.pop();
  }
  rerender() {
    this.updateDirtyElements();
  }
}
export { MpvPlayerView };
export { VideoFit };