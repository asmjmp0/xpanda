/*
* class name:Lcom.example.nga_oh/entry/ets/common/dialogs/SaveThreadDialogs;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AppColors } from "@bundle:com.example.nga_oh/entry/ets/common/constants/Constants";
import { UIMaterialManager } from "@bundle:com.example.nga_oh/entry/ets/common/managers/UIMaterialManager";
import { appStore } from "@bundle:com.example.nga_oh/entry/ets/store/AppStore";
import { getThread } from "@bundle:com.example.nga_oh/entry/ets/service/api/ThreadApi";
import { resolveKeyboardAppearance } from "@bundle:com.example.nga_oh/entry/ets/common/utils/KeyboardAppearanceUtils";
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
export class SaveThreadContent extends ViewPU {
  constructor(p0, p1, p2, p3, p4, p5) {
    let v0;
    if (p3 === undefined) {
      p3 = -1;
    }
    if (p4 === undefined) {
      p4 = undefined;
    }
    v0 = super(p0, p2, p3, p5);
    if (typeof p4 === "function") {
      v0.paramsGenerator_ = p4;
    }
    v0.__tid = new SynchedPropertySimpleOneWayPU(p1.tid, v0, "tid");
    v0.__initialSubject = new SynchedPropertySimpleOneWayPU(p1.initialSubject, v0, "initialSubject");
    v0.onRangeChange = undefined;
    v0.__loading = new ObservedPropertySimplePU(true, v0, "loading");
    v0.__loadError = new ObservedPropertySimplePU("", v0, "loadError");
    v0.__subject = new ObservedPropertySimplePU("", v0, "subject");
    v0.__totalPages = new ObservedPropertySimplePU(0, v0, "totalPages");
    v0.__startText = new ObservedPropertySimplePU("1", v0, "startText");
    v0.__endText = new ObservedPropertySimplePU("", v0, "endText");
    v0.__effectiveColorMode = v0.createStorageProp("effectiveColorMode", "light", "effectiveColorMode");
    v0.setInitiallyProvidedValue(p1);
    v0.finalizeConstruction();
    return v0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.tid === undefined) {
      this.__tid.set("");
    }
    if (p0.initialSubject === undefined) {
      this.__initialSubject.set("");
    }
    if (p0.onRangeChange !== undefined) {
      this.onRangeChange = p0.onRangeChange;
    }
    if (p0.loading !== undefined) {
      this.loading = p0.loading;
    }
    if (p0.loadError !== undefined) {
      this.loadError = p0.loadError;
    }
    if (p0.subject !== undefined) {
      this.subject = p0.subject;
    }
    if (p0.totalPages !== undefined) {
      this.totalPages = p0.totalPages;
    }
    if (p0.startText !== undefined) {
      this.startText = p0.startText;
    }
    if (p0.endText !== undefined) {
      this.endText = p0.endText;
    }
  }
  updateStateVars(p0) {
    this.__tid.reset(p0.tid);
    this.__initialSubject.reset(p0.initialSubject);
  }
  purgeVariableDependenciesOnElmtId(p0) {
    this.__tid.purgeDependencyOnElmtId(p0);
    this.__initialSubject.purgeDependencyOnElmtId(p0);
    this.__loading.purgeDependencyOnElmtId(p0);
    this.__loadError.purgeDependencyOnElmtId(p0);
    this.__subject.purgeDependencyOnElmtId(p0);
    this.__totalPages.purgeDependencyOnElmtId(p0);
    this.__startText.purgeDependencyOnElmtId(p0);
    this.__endText.purgeDependencyOnElmtId(p0);
    this.__effectiveColorMode.purgeDependencyOnElmtId(p0);
  }
  aboutToBeDeleted() {
    this.__tid.aboutToBeDeleted();
    this.__initialSubject.aboutToBeDeleted();
    this.__loading.aboutToBeDeleted();
    this.__loadError.aboutToBeDeleted();
    this.__subject.aboutToBeDeleted();
    this.__totalPages.aboutToBeDeleted();
    this.__startText.aboutToBeDeleted();
    this.__endText.aboutToBeDeleted();
    this.__effectiveColorMode.aboutToBeDeleted();
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  get tid() {
    return this.__tid.get();
  }
  set tid(p0) {
    this.__tid.set(p0);
  }
  get initialSubject() {
    return this.__initialSubject.get();
  }
  set initialSubject(p0) {
    this.__initialSubject.set(p0);
  }
  get loading() {
    return this.__loading.get();
  }
  set loading(p0) {
    this.__loading.set(p0);
  }
  get loadError() {
    return this.__loadError.get();
  }
  set loadError(p0) {
    this.__loadError.set(p0);
  }
  get subject() {
    return this.__subject.get();
  }
  set subject(p0) {
    this.__subject.set(p0);
  }
  get totalPages() {
    return this.__totalPages.get();
  }
  set totalPages(p0) {
    this.__totalPages.set(p0);
  }
  get startText() {
    return this.__startText.get();
  }
  set startText(p0) {
    this.__startText.set(p0);
  }
  get endText() {
    return this.__endText.get();
  }
  set endText(p0) {
    this.__endText.set(p0);
  }
  get effectiveColorMode() {
    return this.__effectiveColorMode.get();
  }
  set effectiveColorMode(p0) {
    this.__effectiveColorMode.set(p0);
  }
  aboutToAppear() {
    this.fetchThreadInfo();
  }
  async fetchThreadInfo() {
    let v0, v7 /*appStore*/;
    this.loading = true;
    this.loadError = "";
    this.syncOutput();
    try {
      v0 = await getThread(appStore.auth.token, this.tid, "", "", "1");
      if (!v0.ok || (v7 = 0, v0.error.length > 0)) {
        this.loadError = v0.error || "无法加载该帖子";
      } else if (v0.posts.length === v7) {
        this.loadError = "帖子不存在或已被删除";
      } else {
        if (v0.threadInfo && v0.threadInfo.subject.length > v7) {
          this.subject = v0.threadInfo.subject;
        } else {
          this.subject = v0.posts[v7].subject || this.initialSubject;
        }
        this.totalPages = Math.max(1, v0.pagination.totalPages);
        this.endText = String(this.totalPages);
      }
    } catch (catchAcc) {
      this.loadError = "无法加载该帖子";
    } finally {
      this.loading = false;
      this.syncOutput();
    }
  }
  parseStart() {
    let v0 = this.startText.trim();
    let v1 = Number(v0);
    return v0.length === 0 || isNaN(v1) || v1 < 1 ? -1 : Math.floor(v1);
  }
  parseEnd() {
    let v0 = this.endText.trim();
    let v1 = Number(v0);
    return v0.length === 0 || isNaN(v1) || v1 < 1 ? -1 : Math.floor(v1);
  }
  syncOutput() {
    let v1 = this.parseStart();
    let v2 = this.parseEnd();
    let v3 = v1 >= 1 && v2 >= v1 && v2 <= this.totalPages;
    let v4 = !this.loading
      && this.loadError.length === 0
      && this.totalPages > 0
      && v1 >= 1
      && v2 >= v1
      && v2 <= this.totalPages;
    if (this.onRangeChange) {
      if (v1 < 1 || v2 < v1 || v2 > this.totalPages) {
        v1 = -1;
      }
      if (!v3) {
        v2 = -1;
      }
      this.onRangeChange(v4, v1, v2);
    }
  }
  pageCount() {
    let v1 = this.parseStart();
    let v2 = this.parseEnd();
    if (v1 < 1 || v2 < v1 || v2 > this.totalPages) {
      return 0;
    }
    return v2 - v1 + 1;
  }
  initialRender() {
    let local_0_0 = this;
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_0_0.loading) {
        local_0_0.ifElseBranchUpdateFunction(0, function () {
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 10
            });
            Row.margin({
              "top": 8,
              "bottom": 12
            });
          }, Row);
          local_0_0.observeComponentCreation2(function (p0, p1) {
            LoadingProgress.create();
            LoadingProgress.width(22);
            LoadingProgress.height(22);
            LoadingProgress.color(AppColors.primary);
          }, LoadingProgress);
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Text.create("正在确认帖子信息…");
            Text.fontSize(13);
            Text.fontColor(UIMaterialManager.adaptiveSecondaryForeground);
          }, Text);
          Text.pop();
          Row.pop();
        });
      } else if (local_0_0.loadError.length > 0) {
        local_0_0.ifElseBranchUpdateFunction(1, function () {
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_0_0.loadError);
            Text.fontSize(13);
            Text.fontColor(AppColors.destructive);
            Text.alignSelf(ItemAlign.Start);
          }, Text);
          Text.pop();
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Text.create("该帖子可能已被删除或已过期，无法保存。");
            Text.fontSize(12);
            Text.fontColor(UIMaterialManager.adaptiveSecondaryForeground);
            Text.margin({
              "top": 4
            });
            Text.alignSelf(ItemAlign.Start);
          }, Text);
          Text.pop();
        });
      } else {
        local_0_0.ifElseBranchUpdateFunction(2, function () {
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_0_0.subject);
            Text.fontSize(14);
            Text.fontColor(UIMaterialManager.adaptiveForeground);
            Text.maxLines(2);
            Text.textOverflow({
              "overflow": TextOverflow.Ellipsis
            });
            Text.alignSelf(ItemAlign.Start);
          }, Text);
          Text.pop();
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Text.create("共 " + String(local_0_0.totalPages) + " 页，请选择要保存的页范围");
            Text.fontSize(12);
            Text.fontColor(UIMaterialManager.adaptiveSecondaryForeground);
            Text.margin({
              "top": 2,
              "bottom": 14
            });
            Text.alignSelf(ItemAlign.Start);
          }, Text);
          Text.pop();
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 10
            });
            Row.width("100%");
            Row.alignItems(VerticalAlign.Top);
          }, Row);
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.layoutWeight(1);
          }, Column);
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Text.create("起始页");
            Text.fontSize(12);
            Text.fontColor(UIMaterialManager.adaptiveSecondaryForeground);
            Text.margin({
              "bottom": 6
            });
            Text.alignSelf(ItemAlign.Start);
          }, Text);
          Text.pop();
          local_0_0.observeComponentCreation2(function (p0, p1) {
            TextInput.create({
              "text": local_0_0.startText,
              "placeholder": "1"
            });
            TextInput.type(InputType.Number);
            TextInput.height(40);
            TextInput.fontSize(15);
            TextInput.borderRadius(10);
            TextInput.width("100%");
            TextInput.fontColor(UIMaterialManager.inputForeground);
            TextInput.placeholderColor(UIMaterialManager.adaptiveSecondaryForeground);
            TextInput.caretColor(UIMaterialManager.inputForeground);
            TextInput.keyboardAppearance(resolveKeyboardAppearance(local_0_0.effectiveColorMode));
            TextInput.attributeModifier.bind(local_0_0)(UIMaterialManager.dialogFieldMaterial);
            TextInput.onChange(function (p0) {
              local_0_0.startText = p0;
              local_0_0.syncOutput();
            });
          }, TextInput);
          Column.pop();
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.layoutWeight(1);
          }, Column);
          local_0_0.observeComponentCreation2(function (p0, p1) {
            Text.create("结束页");
            Text.fontSize(12);
            Text.fontColor(UIMaterialManager.adaptiveSecondaryForeground);
            Text.margin({
              "bottom": 6
            });
            Text.alignSelf(ItemAlign.Start);
          }, Text);
          Text.pop();
          local_0_0.observeComponentCreation2(function (p0, p1) {
            TextInput.create({
              "text": local_0_0.endText,
              "placeholder": String(local_0_0.totalPages)
            });
            TextInput.type(InputType.Number);
            TextInput.height(40);
            TextInput.fontSize(15);
            TextInput.borderRadius(10);
            TextInput.width("100%");
            TextInput.fontColor(UIMaterialManager.inputForeground);
            TextInput.placeholderColor(UIMaterialManager.adaptiveSecondaryForeground);
            TextInput.caretColor(UIMaterialManager.inputForeground);
            TextInput.keyboardAppearance(resolveKeyboardAppearance(local_0_0.effectiveColorMode));
            TextInput.attributeModifier.bind(local_0_0)(UIMaterialManager.dialogFieldMaterial);
            TextInput.onChange(function (p0) {
              local_0_0.endText = p0;
              local_0_0.syncOutput();
            });
          }, TextInput);
          Column.pop();
          Row.pop();
          local_0_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_0_0.totalPages > 1) {
              local_0_0.ifElseBranchUpdateFunction(0, function () {
                local_0_0.observeComponentCreation2(function (p0, p1) {
                  Text.create("将保存 " + String(local_0_0.pageCount()) + " 页内容");
                  Text.fontSize(12);
                  Text.fontColor(AppColors.warning);
                  Text.margin({
                    "top": 8
                  });
                  Text.alignSelf(ItemAlign.Start);
                }, Text);
                Text.pop();
                local_0_0.observeComponentCreation2(function (p0, p1) {
                  If.create();
                  if (local_0_0.pageCount() > 50) {
                    local_0_0.ifElseBranchUpdateFunction(0, function () {
                      local_0_0.observeComponentCreation2(function (p0, p1) {
                        Text.create("页数较多，预计耗时较长，保存中可随时取消");
                        Text.fontSize(12);
                        Text.fontColor(UIMaterialManager.adaptiveSecondaryForeground);
                        Text.margin({
                          "top": 4
                        });
                        Text.alignSelf(ItemAlign.Start);
                      }, Text);
                      Text.pop();
                    });
                  } else {
                    local_0_0.ifElseBranchUpdateFunction(1, function () {});
                  }
                }, If);
                If.pop();
              });
            } else {
              local_0_0.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
        });
      }
    }, If);
    If.pop();
    Column.pop();
  }
  rerender() {
    this.updateDirtyElements();
  }
  __resetStateVarsOnReuse__Internal(p0) {
    this.__effectiveColorMode.resetSource();
  }
}