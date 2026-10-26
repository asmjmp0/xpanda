/*
* class name:L&entry/src/main/ets/common/components/MediaThumb&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
class MediaThumb extends ViewPU {
  constructor(p0, p1, p2, p3, p4, p5) {
    let v2, v6, v7;
    v6 = p3 === undefined ? -1 : p3;
    v7 = p4 === undefined ? undefined : p4;
    v2 = super(p0, p2, v6, p5);
    if (typeof v7 === "function") {
      v2.paramsGenerator_ = v7;
    }
    v2.__imageUrl = new SynchedPropertySimpleOneWayPU(p1.imageUrl, v2, "imageUrl");
    v2.__placeholderColor = new SynchedPropertySimpleOneWayPU(p1.placeholderColor, v2, "placeholderColor");
    v2.__thumbId = new SynchedPropertySimpleOneWayPU(p1.thumbId, v2, "thumbId");
    v2.__widthVp = new SynchedPropertySimpleOneWayPU(p1.widthVp, v2, "widthVp");
    v2.__heightVp = new SynchedPropertySimpleOneWayPU(p1.heightVp, v2, "heightVp");
    v2.__fillParent = new SynchedPropertySimpleOneWayPU(p1.fillParent, v2, "fillParent");
    v2.__useAspectRatio = new SynchedPropertySimpleOneWayPU(p1.useAspectRatio, v2, "useAspectRatio");
    v2.__useCoverBackdrop = new SynchedPropertySimpleOneWayPU(p1.useCoverBackdrop, v2, "useCoverBackdrop");
    v2.__borderRadiusVp = new SynchedPropertySimpleOneWayPU(p1.borderRadiusVp, v2, "borderRadiusVp");
    v2.__showLive = new SynchedPropertySimpleOneWayPU(p1.showLive, v2, "showLive");
    v2.__isLive = new SynchedPropertySimpleOneWayPU(p1.isLive, v2, "isLive");
    v2.__isPremium = new SynchedPropertySimpleOneWayPU(p1.isPremium, v2, "isPremium");
    v2.__requiresMembership = new SynchedPropertySimpleOneWayPU(p1.requiresMembership, v2, "requiresMembership");
    v2.__typeLabel = new SynchedPropertySimpleOneWayPU(p1.typeLabel, v2, "typeLabel");
    v2.__displayUrl = new ObservedPropertySimplePU("", v2, "displayUrl");
    v2.__fallbackIndex = new ObservedPropertySimplePU(0, v2, "fallbackIndex");
    v2.fallbackUrls = [];
    v2.setInitiallyProvidedValue(p1);
    v2.declareWatch("imageUrl", v2.onImageUrlPropChange);
    v2.finalizeConstruction();
    return v2;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.imageUrl === undefined) {
      this.__imageUrl.set("");
    }
    if (p0.placeholderColor === undefined) {
      this.__placeholderColor.set("");
    }
    if (p0.thumbId === undefined) {
      this.__thumbId.set("");
    }
    if (p0.widthVp === undefined) {
      this.__widthVp.set(160);
    }
    if (p0.heightVp === undefined) {
      this.__heightVp.set(90);
    }
    if (p0.fillParent === undefined) {
      this.__fillParent.set(false);
    }
    if (p0.useAspectRatio === undefined) {
      this.__useAspectRatio.set(false);
    }
    if (p0.useCoverBackdrop === undefined) {
      this.__useCoverBackdrop.set(false);
    }
    if (p0.borderRadiusVp === undefined) {
      this.__borderRadiusVp.set(6);
    }
    if (p0.showLive === undefined) {
      this.__showLive.set(false);
    }
    if (p0.isLive === undefined) {
      this.__isLive.set(false);
    }
    if (p0.isPremium === undefined) {
      this.__isPremium.set(false);
    }
    if (p0.requiresMembership === undefined) {
      this.__requiresMembership.set(false);
    }
    if (p0.typeLabel === undefined) {
      this.__typeLabel.set("");
    }
    if (p0.displayUrl !== undefined) {
      this.displayUrl = p0.displayUrl;
    }
    if (p0.fallbackIndex !== undefined) {
      this.fallbackIndex = p0.fallbackIndex;
    }
    if (p0.fallbackUrls !== undefined) {
      this.fallbackUrls = p0.fallbackUrls;
    }
  }
  updateStateVars(p0) {
    this.__imageUrl.reset(p0.imageUrl);
    this.__placeholderColor.reset(p0.placeholderColor);
    this.__thumbId.reset(p0.thumbId);
    this.__widthVp.reset(p0.widthVp);
    this.__heightVp.reset(p0.heightVp);
    this.__fillParent.reset(p0.fillParent);
    this.__useAspectRatio.reset(p0.useAspectRatio);
    this.__useCoverBackdrop.reset(p0.useCoverBackdrop);
    this.__borderRadiusVp.reset(p0.borderRadiusVp);
    this.__showLive.reset(p0.showLive);
    this.__isLive.reset(p0.isLive);
    this.__isPremium.reset(p0.isPremium);
    this.__requiresMembership.reset(p0.requiresMembership);
    this.__typeLabel.reset(p0.typeLabel);
  }
  purgeVariableDependenciesOnElmtId(p0) {
    this.__imageUrl.purgeDependencyOnElmtId(p0);
    this.__placeholderColor.purgeDependencyOnElmtId(p0);
    this.__thumbId.purgeDependencyOnElmtId(p0);
    this.__widthVp.purgeDependencyOnElmtId(p0);
    this.__heightVp.purgeDependencyOnElmtId(p0);
    this.__fillParent.purgeDependencyOnElmtId(p0);
    this.__useAspectRatio.purgeDependencyOnElmtId(p0);
    this.__useCoverBackdrop.purgeDependencyOnElmtId(p0);
    this.__borderRadiusVp.purgeDependencyOnElmtId(p0);
    this.__showLive.purgeDependencyOnElmtId(p0);
    this.__isLive.purgeDependencyOnElmtId(p0);
    this.__isPremium.purgeDependencyOnElmtId(p0);
    this.__requiresMembership.purgeDependencyOnElmtId(p0);
    this.__typeLabel.purgeDependencyOnElmtId(p0);
    this.__displayUrl.purgeDependencyOnElmtId(p0);
    this.__fallbackIndex.purgeDependencyOnElmtId(p0);
  }
  aboutToBeDeleted() {
    this.__imageUrl.aboutToBeDeleted();
    this.__placeholderColor.aboutToBeDeleted();
    this.__thumbId.aboutToBeDeleted();
    this.__widthVp.aboutToBeDeleted();
    this.__heightVp.aboutToBeDeleted();
    this.__fillParent.aboutToBeDeleted();
    this.__useAspectRatio.aboutToBeDeleted();
    this.__useCoverBackdrop.aboutToBeDeleted();
    this.__borderRadiusVp.aboutToBeDeleted();
    this.__showLive.aboutToBeDeleted();
    this.__isLive.aboutToBeDeleted();
    this.__isPremium.aboutToBeDeleted();
    this.__requiresMembership.aboutToBeDeleted();
    this.__typeLabel.aboutToBeDeleted();
    this.__displayUrl.aboutToBeDeleted();
    this.__fallbackIndex.aboutToBeDeleted();
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  get imageUrl() {
    return this.__imageUrl.get();
  }
  set imageUrl(p0) {
    this.__imageUrl.set(p0);
  }
  get placeholderColor() {
    return this.__placeholderColor.get();
  }
  set placeholderColor(p0) {
    this.__placeholderColor.set(p0);
  }
  get thumbId() {
    return this.__thumbId.get();
  }
  set thumbId(p0) {
    this.__thumbId.set(p0);
  }
  get widthVp() {
    return this.__widthVp.get();
  }
  set widthVp(p0) {
    this.__widthVp.set(p0);
  }
  get heightVp() {
    return this.__heightVp.get();
  }
  set heightVp(p0) {
    this.__heightVp.set(p0);
  }
  get fillParent() {
    return this.__fillParent.get();
  }
  set fillParent(p0) {
    this.__fillParent.set(p0);
  }
  get useAspectRatio() {
    return this.__useAspectRatio.get();
  }
  set useAspectRatio(p0) {
    this.__useAspectRatio.set(p0);
  }
  get useCoverBackdrop() {
    return this.__useCoverBackdrop.get();
  }
  set useCoverBackdrop(p0) {
    this.__useCoverBackdrop.set(p0);
  }
  get borderRadiusVp() {
    return this.__borderRadiusVp.get();
  }
  set borderRadiusVp(p0) {
    this.__borderRadiusVp.set(p0);
  }
  get showLive() {
    return this.__showLive.get();
  }
  set showLive(p0) {
    this.__showLive.set(p0);
  }
  get isLive() {
    return this.__isLive.get();
  }
  set isLive(p0) {
    this.__isLive.set(p0);
  }
  get isPremium() {
    return this.__isPremium.get();
  }
  set isPremium(p0) {
    this.__isPremium.set(p0);
  }
  get requiresMembership() {
    return this.__requiresMembership.get();
  }
  set requiresMembership(p0) {
    this.__requiresMembership.set(p0);
  }
  get typeLabel() {
    return this.__typeLabel.get();
  }
  set typeLabel(p0) {
    this.__typeLabel.set(p0);
  }
  get displayUrl() {
    return this.__displayUrl.get();
  }
  set displayUrl(p0) {
    this.__displayUrl.set(p0);
  }
  get fallbackIndex() {
    return this.__fallbackIndex.get();
  }
  set fallbackIndex(p0) {
    this.__fallbackIndex.set(p0);
  }
  aboutToAppear() {
    this.resetImageChain(this.imageUrl);
  }
  onImageUrlPropChange() {
    this.resetImageChain(this.imageUrl);
  }
  bgColor() {
    return this.placeholderColor && this.placeholderColor.length > 0 ? this.placeholderColor : {
      "id": 16778159,
      "type": 10001,
      "params": [],
      "bundleName": "com.talon.yourpipe",
      "moduleName": "entry"
    };
  }
  resetImageChain(p0) {
    this.fallbackUrls = MediaThumb.buildFallbackChain(p0);
    this.fallbackIndex = 0;
    this.displayUrl = this.fallbackUrls.length > 0 ? this.fallbackUrls[0] : "";
  }
  static firstChoiceUrl(p0) {
    let v4;
    v4 = MediaThumb.buildFallbackChain(p0);
    return v4.length > 0 ? v4[0] : "";
  }
  static buildFallbackChain(p0) {
    let v5, v6, v8, v11, acc;
    v5 = (p0 || "").trim();
    if (v5.length === 0) {
      return [];
    }
    v6 = new RegExp("(?:^https?:\\/\\/)?(?:i\\d*\\.)?ytimg\\.com\\/vi(?:_webp)?\\/([^/]+)\\/", "i").exec(v5);
    if (v6) {
      if (!v6[1]) {
        return [v5];
      }
      v11 = ["https://i.ytimg.com/vi/" + v6[1] + "/maxresdefault.jpg", "https://i.ytimg.com/vi/" + v6[1] + "/hq720.jpg", "https://i.ytimg.com/vi/" + v6[1] + "/sddefault.jpg", "https://i.ytimg.com/vi/" + v6[1] + "/hqdefault.jpg", "https://i.ytimg.com/vi/" + v6[1] + "/mqdefault.jpg"];
      acc = v5.startsWith("//") ? "https:" + v5 + "" : v5.startsWith("http://") ? "https://" + v5.slice("http://".length) + "" : v5;
      if (v11.indexOf(acc) < 0) {
        return [acc].concat(v11);
      }
      v8 = v11.indexOf(acc);
      return v11.slice(v8 >= 0 ? v8 : 0);
    }
    return [v5];
  }
  onImageError() {
    if (this.fallbackIndex + 1 < this.fallbackUrls.length) {
      this.fallbackIndex = this.fallbackIndex + 1;
      this.displayUrl = this.fallbackUrls[this.fallbackIndex];
    } else {
      this.displayUrl = "";
    }
  }
  initialRender() {
    let local_1_0;
    local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let acc;
      Stack.create({
        "alignContent": Alignment.BottomEnd
      });
      Stack.width(local_1_0.fillParent ? "100%" : local_1_0.widthVp);
      if (local_1_0.fillParent) {
        acc = local_1_0.useAspectRatio ? local_1_0.fillParent ? undefined : local_1_0.heightVp : "100%";
      } else acc = local_1_0.fillParent ? undefined : local_1_0.heightVp;
      Stack.height(acc);
      Stack.aspectRatio(local_1_0.fillParent && local_1_0.useAspectRatio ? 16 / 9 : undefined);
      Stack.borderRadius(local_1_0.borderRadiusVp);
      Stack.clip(true);
      Stack.backgroundColor(local_1_0.bgColor());
    }, Stack);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.displayUrl && local_1_0.displayUrl.length > 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.useCoverBackdrop) {
              local_1_0.ifElseBranchUpdateFunction(0, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Image.create(local_1_0.displayUrl);
                  Image.width(local_1_0.fillParent ? "100%" : local_1_0.widthVp);
                  Image.height(local_1_0.fillParent ? "100%" : local_1_0.heightVp);
                  Image.objectFit(ImageFit.Cover);
                  Image.borderRadius(local_1_0.borderRadiusVp);
                }, Image);
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Rect.create();
                  Rect.width(local_1_0.fillParent ? "100%" : local_1_0.widthVp);
                  Rect.height(local_1_0.fillParent ? "100%" : local_1_0.heightVp);
                  Rect.fill("#73000000");
                  Rect.radius(local_1_0.borderRadiusVp);
                }, Rect);
              });
            } else {
              local_1_0.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.thumbId.length > 0) {
              local_1_0.ifElseBranchUpdateFunction(0, function () {
                if (!If.canRetake(local_1_0.thumbId)) {
                  local_1_0.observeComponentCreation2(function (p0, p1) {
                    Image.create(local_1_0.displayUrl);
                    Image.id(local_1_0.thumbId);
                    Image.width(local_1_0.fillParent ? "100%" : local_1_0.widthVp);
                    Image.height(local_1_0.fillParent ? "100%" : local_1_0.heightVp);
                    Image.objectFit(ImageFit.Contain);
                    Image.borderRadius(local_1_0.borderRadiusVp);
                    Image.onError(function () {
                      local_1_0.onImageError();
                    });
                  }, Image);
                }
              });
            } else {
              local_1_0.ifElseBranchUpdateFunction(1, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Image.create(local_1_0.displayUrl);
                  Image.width(local_1_0.fillParent ? "100%" : local_1_0.widthVp);
                  Image.height(local_1_0.fillParent ? "100%" : local_1_0.heightVp);
                  Image.objectFit(ImageFit.Contain);
                  Image.borderRadius(local_1_0.borderRadiusVp);
                  Image.onError(function () {
                    local_1_0.onImageError();
                  });
                }, Image);
              });
            }
          }, If);
          If.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Rect.create();
            Rect.width(local_1_0.fillParent ? "100%" : local_1_0.widthVp);
            Rect.height(local_1_0.fillParent ? "100%" : local_1_0.heightVp);
            Rect.fill(local_1_0.bgColor());
            Rect.radius(local_1_0.borderRadiusVp);
          }, Rect);
        });
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.showLive && local_1_0.isLive) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 4
            });
            Row.padding({
              "left": 5,
              "right": 5,
              "top": 2,
              "bottom": 2
            });
            Row.backgroundColor({
              "id": 16778150,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Row.borderRadius({
              "topLeft": 4,
              "bottomRight": 6
            });
          }, Row);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Circle.create({
              "width": 6,
              "height": 6
            });
            Circle.fill({
              "id": 16778169,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
          }, Circle);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create({
              "id": 16777746,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.fontSize(8);
            Text.fontWeight(FontWeight.Medium);
            Text.fontColor({
              "id": 16778175,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
          }, Text);
          Text.pop();
          Row.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.isPremium) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create({
              "id": 16777753,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.fontSize(8);
            Text.fontColor({
              "id": 16778175,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.backgroundColor("#FFD700");
            Text.padding({
              "left": 4,
              "right": 4,
              "top": 2,
              "bottom": 2
            });
            Text.borderRadius({
              "topLeft": 6,
              "bottomRight": 6
            });
            Text.position({
              "x": 0,
              "y": 0
            });
          }, Text);
          Text.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.requiresMembership) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create({
              "id": 16777749,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.fontSize(8);
            Text.fontColor({
              "id": 16778175,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.backgroundColor("#1DB954");
            Text.padding({
              "left": 4,
              "right": 4,
              "top": 2,
              "bottom": 2
            });
            Text.borderRadius({
              "topLeft": 4,
              "bottomRight": 6
            });
            Text.position({
              "x": 0,
              "y": local_1_0.isPremium ? 20 : 0
            });
          }, Text);
          Text.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.typeLabel.length > 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_1_0.typeLabel);
            Text.fontSize(8);
            Text.fontColor({
              "id": 16778175,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.backgroundColor({
              "id": 16778155,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.padding({
              "left": 4,
              "right": 4,
              "top": 2,
              "bottom": 2
            });
            Text.borderRadius({
              "topLeft": 6,
              "bottomRight": 6
            });
            Text.position({
              "x": 0,
              "y": 0
            });
          }, Text);
          Text.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Stack.pop();
  }
  rerender() {
    this.updateDirtyElements();
  }
}
export { MediaThumb };