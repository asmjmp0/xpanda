/*
* class name:Lcom.example.nga_oh/entry/ets/pages/SettingsPanel;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AppColors } from "@bundle:com.example.nga_oh/entry/ets/common/constants/Constants";
import { CredentialPasswordContent } from "@bundle:com.example.nga_oh/entry/ets/common/dialogs/Dialogs";
import { CustomContentDialog } from "@ohos:arkui.advanced.Dialog";
import { ImageLoadStrategy } from "@bundle:com.example.nga_oh/entry/ets/common/constants/Constants";
import { PanelNavBar } from "@bundle:com.example.nga_oh/entry/ets/common/components/PanelNavBar";
import { Screen } from "@bundle:com.example.nga_oh/entry/ets/store/RouterStore";
import { SelectDialog } from "@ohos:arkui.advanced.Dialog";
import { SelectRadioResult } from "@bundle:com.example.nga_oh/entry/ets/common/dialogs/Dialogs";
import { SettingPickerRow } from "@bundle:com.example.nga_oh/entry/ets/common/components/SettingRow";
import { SettingRow } from "@bundle:com.example.nga_oh/entry/ets/common/components/SettingRow";
import { SettingToggleRow } from "@bundle:com.example.nga_oh/entry/ets/common/components/SettingRow";
import { SettingsIconColors } from "@bundle:com.example.nga_oh/entry/ets/common/constants/Constants";
import { THEME_OPTIONS } from "@bundle:com.example.nga_oh/entry/ets/common/constants/Constants";
import { ThreadNavMode } from "@bundle:com.example.nga_oh/entry/ets/common/constants/Constants";
import { TipsDialog } from "@ohos:arkui.advanced.Dialog";
import { TitleScrollEffect } from "@bundle:com.example.nga_oh/entry/ets/common/utils/TitleScrollEffect";
import { UIMaterialManager } from "@bundle:com.example.nga_oh/entry/ets/common/managers/UIMaterialManager";
import { appStore } from "@bundle:com.example.nga_oh/entry/ets/store/AppStore";
import contextConstant from "@ohos:app.ability.contextConstant";
import { draftMediaStore } from "@bundle:com.example.nga_oh/entry/ets/common/media/DraftMediaStore";
import { draftStore } from "@bundle:com.example.nga_oh/entry/ets/common/managers/DraftStore";
import fileIo from "@ohos:file.fs";
import { logoutOrchestrator } from "@bundle:com.example.nga_oh/entry/ets/service/LogoutOrchestrator";
import { movingPhotoCacheDir } from "@bundle:com.example.nga_oh/entry/ets/common/media/MovingPhotoCache";
import picker from "@ohos:file.picker";
import { removeDirRecursively } from "@bundle:com.example.nga_oh/entry/ets/common/utils/FileUtils";
import { routerStore } from "@bundle:com.example.nga_oh/entry/ets/store/RouterStore";
import { serializeCredentialExport } from "@bundle:com.example.nga_oh/entry/ets/common/security/CredentialExportCrypto";
import storageStatistics from "@ohos:file.storageStatistics";
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
export class SettingsPanel extends ViewPU {
  constructor(p0, p1, p2, p3, p4, p5) {
    let local_0_0 = this;
    if (p3 === undefined) {
      p3 = -1;
    }
    if (p4 === undefined) {
      p4 = undefined;
    }
    local_0_0 = super(p0, p2, p3, p5);
    if (typeof p4 === "function") {
      local_0_0.paramsGenerator_ = p4;
    }
    local_0_0.__themeName = local_0_0.createStorageProp("themeName", "light", "themeName");
    local_0_0.__statusBarHeight = local_0_0.createStorageProp("statusBarHeight", 0, "statusBarHeight");
    local_0_0.__aiConfigVersion = local_0_0.createStorageProp("aiConfigVersion", 0, "aiConfigVersion");
    local_0_0.__contentFontSize = local_0_0.createStorageProp("contentFontSize", 15, "contentFontSize");
    local_0_0.__cacheSizeText = new ObservedPropertySimplePU("", local_0_0, "cacheSizeText");
    local_0_0.__clearingCache = new ObservedPropertySimplePU(false, local_0_0, "clearingCache");
    local_0_0.__imageStrategyBadge = new ObservedPropertySimplePU("始终加载", local_0_0, "imageStrategyBadge");
    local_0_0.__threadNavBadge = new ObservedPropertySimplePU("无缝加载", local_0_0, "threadNavBadge");
    local_0_0.__prefetchPageBadge = new ObservedPropertySimplePU("1 页", local_0_0, "prefetchPageBadge");
    local_0_0.__aiProviderBadge = new ObservedPropertySimplePU("未配置 AI", local_0_0, "aiProviderBadge");
    local_0_0.__titleScrollEffectProgress = new ObservedPropertySimplePU(0, local_0_0, "titleScrollEffectProgress");
    local_0_0.__scrollViewportHeight = new ObservedPropertySimplePU(1, local_0_0, "scrollViewportHeight");
    local_0_0.__exportPassword = new ObservedPropertySimplePU("", local_0_0, "exportPassword");
    local_0_0.scroller = new Scroller();
    local_0_0.clearCacheDialogController = new CustomDialogController({
      "backgroundColor": Color.Transparent,
      "systemMaterial": UIMaterialManager.dialogMaterial,
      "maskColor": UIMaterialManager.scrim,
      "builder": function () {
        let acc = new TipsDialog(local_0_0, {
          "imageRes": {
            "id": 16777352,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "title": "清除缓存",
          "content": "确定要清除所有缓存吗？\n清除后图片等资源需要重新加载\n未发送的草稿与草稿中的图片也会被删除",
          "primaryButton": {
            "value": "清除",
            "fontColor": AppColors.white,
            "background": AppColors.destructive,
            "action": function () {
              local_0_0.clearCache();
            }
          },
          "secondaryButton": {
            "value": "取消"
          }
        }, undefined, -1, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 71,
          "col": 14
        });
        acc.setController(local_0_0.clearCacheDialogController);
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "imageRes": {
              "id": 16777352,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "title": "清除缓存",
            "content": "确定要清除所有缓存吗？\n清除后图片等资源需要重新加载\n未发送的草稿与草稿中的图片也会被删除",
            "primaryButton": {
              "value": "清除",
              "fontColor": AppColors.white,
              "background": AppColors.destructive,
              "action": function () {
                local_0_0.clearCache();
              }
            },
            "secondaryButton": {
              "value": "取消"
            }
          };
        };
      },
      "autoCancel": true
    }, local_0_0);
    local_0_0.imageStrategyDialogController = undefined;
    local_0_0.threadNavDialogController = undefined;
    local_0_0.prefetchPageDialogController = undefined;
    local_0_0.exportCredentialDialogController = undefined;
    local_0_0.logoutDialogController = new CustomDialogController({
      "backgroundColor": Color.Transparent,
      "systemMaterial": UIMaterialManager.dialogMaterial,
      "maskColor": UIMaterialManager.scrim,
      "builder": function () {
        let acc = new TipsDialog(local_0_0, {
          "imageRes": {
            "id": 16777359,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "title": "退出登录",
          "content": "确定要退出登录吗？\n退出后需要重新输入账号密码登录",
          "primaryButton": {
            "value": "退出",
            "fontColor": AppColors.white,
            "background": AppColors.destructive,
            "action": async function () {
              await logoutOrchestrator.logout(local_0_0.getUIContext());
              return undefined;
            }
          },
          "secondaryButton": {
            "value": "取消"
          }
        }, undefined, -1, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 101,
          "col": 14
        });
        acc.setController(local_0_0.logoutDialogController);
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "imageRes": {
              "id": 16777359,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "title": "退出登录",
            "content": "确定要退出登录吗？\n退出后需要重新输入账号密码登录",
            "primaryButton": {
              "value": "退出",
              "fontColor": AppColors.white,
              "background": AppColors.destructive,
              "action": async function () {
                await logoutOrchestrator.logout(local_0_0.getUIContext());
                return undefined;
              }
            },
            "secondaryButton": {
              "value": "取消"
            }
          };
        };
      },
      "autoCancel": true
    }, local_0_0);
    local_0_0.setInitiallyProvidedValue(p1);
    local_0_0.declareWatch("aiConfigVersion", local_0_0.onAiConfigVersionChange);
    local_0_0.finalizeConstruction();
    return local_0_0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.cacheSizeText !== undefined) {
      this.cacheSizeText = p0.cacheSizeText;
    }
    if (p0.clearingCache !== undefined) {
      this.clearingCache = p0.clearingCache;
    }
    if (p0.imageStrategyBadge !== undefined) {
      this.imageStrategyBadge = p0.imageStrategyBadge;
    }
    if (p0.threadNavBadge !== undefined) {
      this.threadNavBadge = p0.threadNavBadge;
    }
    if (p0.prefetchPageBadge !== undefined) {
      this.prefetchPageBadge = p0.prefetchPageBadge;
    }
    if (p0.aiProviderBadge !== undefined) {
      this.aiProviderBadge = p0.aiProviderBadge;
    }
    if (p0.titleScrollEffectProgress !== undefined) {
      this.titleScrollEffectProgress = p0.titleScrollEffectProgress;
    }
    if (p0.scrollViewportHeight !== undefined) {
      this.scrollViewportHeight = p0.scrollViewportHeight;
    }
    if (p0.exportPassword !== undefined) {
      this.exportPassword = p0.exportPassword;
    }
    if (p0.scroller !== undefined) {
      this.scroller = p0.scroller;
    }
    if (p0.clearCacheDialogController !== undefined) {
      this.clearCacheDialogController = p0.clearCacheDialogController;
    }
    if (p0.imageStrategyDialogController !== undefined) {
      this.imageStrategyDialogController = p0.imageStrategyDialogController;
    }
    if (p0.threadNavDialogController !== undefined) {
      this.threadNavDialogController = p0.threadNavDialogController;
    }
    if (p0.prefetchPageDialogController !== undefined) {
      this.prefetchPageDialogController = p0.prefetchPageDialogController;
    }
    if (p0.exportCredentialDialogController !== undefined) {
      this.exportCredentialDialogController = p0.exportCredentialDialogController;
    }
    if (p0.logoutDialogController !== undefined) {
      this.logoutDialogController = p0.logoutDialogController;
    }
  }
  updateStateVars(p0) {}
  purgeVariableDependenciesOnElmtId(p0) {
    this.__themeName.purgeDependencyOnElmtId(p0);
    this.__statusBarHeight.purgeDependencyOnElmtId(p0);
    this.__aiConfigVersion.purgeDependencyOnElmtId(p0);
    this.__contentFontSize.purgeDependencyOnElmtId(p0);
    this.__cacheSizeText.purgeDependencyOnElmtId(p0);
    this.__clearingCache.purgeDependencyOnElmtId(p0);
    this.__imageStrategyBadge.purgeDependencyOnElmtId(p0);
    this.__threadNavBadge.purgeDependencyOnElmtId(p0);
    this.__prefetchPageBadge.purgeDependencyOnElmtId(p0);
    this.__aiProviderBadge.purgeDependencyOnElmtId(p0);
    this.__titleScrollEffectProgress.purgeDependencyOnElmtId(p0);
    this.__scrollViewportHeight.purgeDependencyOnElmtId(p0);
    this.__exportPassword.purgeDependencyOnElmtId(p0);
  }
  aboutToBeDeleted() {
    this.__themeName.aboutToBeDeleted();
    this.__statusBarHeight.aboutToBeDeleted();
    this.__aiConfigVersion.aboutToBeDeleted();
    this.__contentFontSize.aboutToBeDeleted();
    this.__cacheSizeText.aboutToBeDeleted();
    this.__clearingCache.aboutToBeDeleted();
    this.__imageStrategyBadge.aboutToBeDeleted();
    this.__threadNavBadge.aboutToBeDeleted();
    this.__prefetchPageBadge.aboutToBeDeleted();
    this.__aiProviderBadge.aboutToBeDeleted();
    this.__titleScrollEffectProgress.aboutToBeDeleted();
    this.__scrollViewportHeight.aboutToBeDeleted();
    this.__exportPassword.aboutToBeDeleted();
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  get themeName() {
    return this.__themeName.get();
  }
  set themeName(p0) {
    this.__themeName.set(p0);
  }
  get statusBarHeight() {
    return this.__statusBarHeight.get();
  }
  set statusBarHeight(p0) {
    this.__statusBarHeight.set(p0);
  }
  get aiConfigVersion() {
    return this.__aiConfigVersion.get();
  }
  set aiConfigVersion(p0) {
    this.__aiConfigVersion.set(p0);
  }
  get contentFontSize() {
    return this.__contentFontSize.get();
  }
  set contentFontSize(p0) {
    this.__contentFontSize.set(p0);
  }
  get cacheSizeText() {
    return this.__cacheSizeText.get();
  }
  set cacheSizeText(p0) {
    this.__cacheSizeText.set(p0);
  }
  get clearingCache() {
    return this.__clearingCache.get();
  }
  set clearingCache(p0) {
    this.__clearingCache.set(p0);
  }
  get imageStrategyBadge() {
    return this.__imageStrategyBadge.get();
  }
  set imageStrategyBadge(p0) {
    this.__imageStrategyBadge.set(p0);
  }
  get threadNavBadge() {
    return this.__threadNavBadge.get();
  }
  set threadNavBadge(p0) {
    this.__threadNavBadge.set(p0);
  }
  get prefetchPageBadge() {
    return this.__prefetchPageBadge.get();
  }
  set prefetchPageBadge(p0) {
    this.__prefetchPageBadge.set(p0);
  }
  get aiProviderBadge() {
    return this.__aiProviderBadge.get();
  }
  set aiProviderBadge(p0) {
    this.__aiProviderBadge.set(p0);
  }
  get titleScrollEffectProgress() {
    return this.__titleScrollEffectProgress.get();
  }
  set titleScrollEffectProgress(p0) {
    this.__titleScrollEffectProgress.set(p0);
  }
  get scrollViewportHeight() {
    return this.__scrollViewportHeight.get();
  }
  set scrollViewportHeight(p0) {
    this.__scrollViewportHeight.set(p0);
  }
  get exportPassword() {
    return this.__exportPassword.get();
  }
  set exportPassword(p0) {
    this.__exportPassword.set(p0);
  }
  syncTitleScrollEffect() {
    let v0 /*TitleScrollEffect*/ = TitleScrollEffect.getProgress(this.scroller.currentOffset().yOffset, this.statusBarHeight);
    if (TitleScrollEffect.shouldUpdateProgress(this.titleScrollEffectProgress, v0)) {
      this.titleScrollEffectProgress = v0;
    }
  }
  exportPasswordContent(p0) {
    let local_0_0 = this;
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*CredentialPasswordContent*/;
      if (p1) {
        v0 = new CredentialPasswordContent(local_0_0, {
          "password": local_0_0.exportPassword,
          "minLength": 8,
          "confirmLabel": "导出",
          "onPasswordChange": function (p0) {
            local_0_0.exportPassword = p0;
          },
          "onConfirm": function (p0) {
            if (local_0_0.exportCredentialDialogController !== null && local_0_0.exportCredentialDialogController !== undefined) {
              local_0_0.exportCredentialDialogController.close();
            }
            local_0_0.exportEncryptedCredential(p0);
          },
          "onCancel": function () {
            if (local_0_0.exportCredentialDialogController !== null && local_0_0.exportCredentialDialogController !== undefined) {
              local_0_0.exportCredentialDialogController.close();
            }
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 123,
          "col": 5
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "password": local_0_0.exportPassword,
            "minLength": 8,
            "confirmLabel": "导出",
            "onPasswordChange": function (p0) {
              local_0_0.exportPassword = p0;
            },
            "onConfirm": function (p0) {
              if (local_0_0.exportCredentialDialogController !== null && local_0_0.exportCredentialDialogController !== undefined) {
                local_0_0.exportCredentialDialogController.close();
              }
              local_0_0.exportEncryptedCredential(p0);
            },
            "onCancel": function () {
              if (local_0_0.exportCredentialDialogController !== null && local_0_0.exportCredentialDialogController !== undefined) {
                local_0_0.exportCredentialDialogController.close();
              }
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "password": local_0_0.exportPassword,
          "minLength": 8,
          "confirmLabel": "导出"
        });
      }
    }, {
      "name": "CredentialPasswordContent"
    });
  }
  buildRadioContent(p0, p1, p2) {
    let v0 /*SelectRadioResult*/, v2;
    let local_0_0 = p2;
    v0 = new SelectRadioResult();
    {
      let local_1_0;
      for (v2 = 0; v2 < p0.length; v2 += 1) {
        local_1_0 = p0[v2];
        if (local_1_0.value === p1) {
          v0.selectedIndex = v2;
        }
        v0.items.push({
          "title": local_1_0.label,
          "action": function () {
            local_0_0(local_1_0.value);
          }
        });
        let local_1_2_0 = local_1_0;
      }
    }
    return v0;
  }
  aboutToAppear() {
    this.refreshCacheSize();
    this.imageStrategyBadge = this.imageStrategyLabel(appStore.settings.imageLoadStrategy);
    this.threadNavBadge = this.threadNavLabel(appStore.settings.threadNavMode);
    this.prefetchPageBadge = this.prefetchPageLabel(appStore.settings.prefetchPageCount);
    this.updateAiBadge();
  }
  aboutToDisappear() {
    this.clearCacheDialogController = undefined;
    this.logoutDialogController = undefined;
    this.imageStrategyDialogController = undefined;
    this.threadNavDialogController = undefined;
    this.prefetchPageDialogController = undefined;
    this.exportCredentialDialogController = undefined;
  }
  onAiConfigVersionChange() {
    this.updateAiBadge();
  }
  formatSize(p0) {
    if (p0 < 1024) {
      return p0 + " B";
    }
    if (p0 / 1024 < 1024) {
      return (p0 / 1024).toFixed(1) + " KB";
    }
    if (p0 / 1024 / 1024 < 1024) {
      return (p0 / 1024 / 1024).toFixed(1) + " MB";
    }
    return (p0 / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }
  refreshCacheSize() {
    let local_0_0 = this;
    storageStatistics.getCurrentBundleStats(function (p0, p1) {
      let v0 = local_0_0.draftBytes();
      if (!p0) {
        local_0_0.cacheSizeText = v0 > 0 ? local_0_0.formatSize(p1.cacheSize + v0) + " · 草稿 " + local_0_0.formatSize(v0) : local_0_0.formatSize(p1.cacheSize + v0);
      } else {
        local_0_0.cacheSizeText = v0 > 0 ? "未知 · 草稿 " + local_0_0.formatSize(v0) : "未知";
      }
    });
  }
  draftBytes() {
    return draftStore.totalBytes() + draftMediaStore.totalBytes();
  }
  async clearCache() {
    let v3 /*appStore*/, v4, v11, v12, v13, v14, v15 /*appStore*/, v17, v18 /*draftMediaStore*/, v21;
    if (this.clearingCache) {
      return undefined;
    }
    this.clearingCache = true;
    v3 = null;
    v4 = null;
    try {
      v15 = 0;
      v13 = this.getUIContext().getHostContext();
      v4 = v13.area;
      v17 = [];
      v13.area = contextConstant.AreaMode.EL1;
      v17.push(v13.cacheDir);
      v13.area = contextConstant.AreaMode.EL2;
      v17.push(v13.cacheDir);
      v17.push(movingPhotoCacheDir(v13.filesDir));
      v17.push(draftStore.directory);
      v17.push(draftMediaStore.directory);
      v14 = v13.getApplicationContext();
      v18 = v14.area;
      v14.area = contextConstant.AreaMode.EL1;
      v17.push(v14.cacheDir);
      v14.area = contextConstant.AreaMode.EL2;
      for (v17.push(v14.cacheDir); v15 < v17.length; v15 += 1) {
        removeDirRecursively(v17[v15]);
      }
      draftStore.reloadAfterClear();
      draftMediaStore.reloadAfterClear();
      this.refreshCacheSize();
      appStore.showToast("缓存已清除");
      v11 = v18;
      v12 = v4;
      v4 = v13;
      v3 = v14;
    } catch (catchAcc) {
      appStore.showToast("清除缓存失败");
      v3 = v14;
      v4 = v13;
      v21 = v11;
      v11 = v12;
      v12 = v21;
    } finally {
      if (v4) {
        v4.area = v12;
      }
      if (v3) {
        v3.area = v11;
      }
      this.clearingCache = false;
    }
  }
  async handleExport() {
    let local_0_0 = this;
    if (!appStore.getSession(appStore.auth.token)) {
      appStore.showToast("未找到登录会话");
      return undefined;
    }
    local_0_0.exportPassword = "";
    local_0_0.exportCredentialDialogController = new CustomDialogController({
      "backgroundColor": Color.Transparent,
      "systemMaterial": UIMaterialManager.dialogMaterial,
      "maskColor": UIMaterialManager.scrim,
      "builder": function () {
        let acc = new CustomContentDialog(local_0_0, {
          "primaryTitle": "加密导出凭证",
          "secondaryTitle": "导出的文件将使用此密码加密，导入时需要再次输入（至少 8 位）。",
          "contentBuilder": function () {
            local_0_0.exportPasswordContent();
          }
        }, undefined, -1, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 315,
          "col": 16
        });
        acc.setController(local_0_0.exportCredentialDialogController);
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "primaryTitle": "加密导出凭证",
            "secondaryTitle": "导出的文件将使用此密码加密，导入时需要再次输入（至少 8 位）。",
            "contentBuilder": function () {
              local_0_0.exportPasswordContent();
            }
          };
        };
      },
      "autoCancel": true
    }, local_0_0);
    if (local_0_0.exportCredentialDialogController !== null && local_0_0.exportCredentialDialogController !== undefined) {
      local_0_0.exportCredentialDialogController.open();
    }
    return undefined;
  }
  async exportEncryptedCredential(p0) {
    let v0, v4 /*appStore*/, v5 /*appStore*/, v6 /*fileIo*/, v8 /*serializeCredentialExport*/;
    try {
      v4 = appStore.getSession(appStore.auth.token);
      if (!v4) {
        appStore.showToast("未找到登录会话");
        return undefined;
      }
      v5 = this.getUIContext().getHostContext();
      v6 = v4?.nickName;
      if (!v6) {
        v6 = "User" + (v4?.uid ?? "") + "";
      }
      v8 = new picker.DocumentSaveOptions();
      v8.newFileNames = ["nga_" + v6 + ".ngacred"];
      v8.fileSuffixChoices = ["NGA 凭证|.ngacred"];
      v5 = await new picker.DocumentViewPicker(v5).save(v8);
      if (v5.length === 0) {
        return undefined;
      }
      v0 = await serializeCredentialExport({
        "uid": v4.uid,
        "cid": v4.cid
      }, p0);
      v5 = fileIo.openSync(v5[0], fileIo.OpenMode.READ_WRITE);
      fileIo.writeSync(v5.fd, v0);
      fileIo.closeSync(v5);
      appStore.showToast("账号凭证已加密导出");
    } catch (catchAcc) {
      appStore.showToast(catchAcc.message || "导出失败");
    }
    return undefined;
  }
  imageStrategyLabel(p0) {
    if (p0 === ImageLoadStrategy.MANUAL) {
      return "手动加载";
    }
    if (p0 === ImageLoadStrategy.WIFI_ONLY) {
      return "WiFi下加载";
    }
    return "始终加载";
  }
  imageStrategyOptions() {
    return [{
      "label": "始终加载（主动式）",
      "value": 0
    }, {
      "label": "手动加载（被动式）",
      "value": 1
    }, {
      "label": "只在WiFi下加载",
      "value": 2
    }];
  }
  threadNavLabel(p0) {
    return p0 === ThreadNavMode.PAGE ? "传统翻页" : "无缝加载";
  }
  threadNavOptions() {
    return [{
      "label": "无缝加载（连续滚动）",
      "value": parseInt(ThreadNavMode.SEAMLESS)
    }, {
      "label": "传统翻页（跳转器换页）",
      "value": parseInt(ThreadNavMode.PAGE)
    }];
  }
  showThreadNavPicker() {
    let v4 /*appStore*/;
    let local_0_0;
    let local_0_1 = this;
    v4 = function (p0) {
      appStore.settingsStore.setThreadNavMode(String(p0));
      local_0_1.threadNavBadge = local_0_1.threadNavLabel(String(p0));
    };
    local_0_0 = local_0_1.buildRadioContent(local_0_1.threadNavOptions(), parseInt(appStore.settings.threadNavMode), v4);
    local_0_1.threadNavDialogController = new CustomDialogController({
      "backgroundColor": Color.Transparent,
      "systemMaterial": UIMaterialManager.dialogMaterial,
      "maskColor": UIMaterialManager.scrim,
      "builder": function () {
        let acc = new SelectDialog(local_0_1, {
          "title": "帖子楼层导航",
          "selectedIndex": local_0_0.selectedIndex,
          "radioContent": local_0_0.items,
          "confirm": {
            "value": "确定"
          }
        }, undefined, -1, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 404,
          "col": 16
        });
        acc.setController(local_0_1.threadNavDialogController);
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "title": "帖子楼层导航",
            "selectedIndex": local_0_0.selectedIndex,
            "radioContent": local_0_0.items,
            "confirm": {
              "value": "确定"
            }
          };
        };
      },
      "autoCancel": true
    }, local_0_1);
    if (local_0_1.threadNavDialogController !== null && local_0_1.threadNavDialogController !== undefined) {
      local_0_1.threadNavDialogController.open();
    }
  }
  prefetchPageLabel(p0) {
    return p0 <= 0 ? "关闭" : "" + p0 + " 页";
  }
  prefetchPageOptions() {
    let v3;
    let v2 = [];
    for (v3 = 0; v3 <= 5; v3 += 1) {
      v2.push({
        "label": v3 === 0 ? "关闭（不预加载）" : "" + v3 + " 页",
        "value": v3
      });
    }
    return v2;
  }
  showPrefetchPagePicker() {
    let v4;
    let local_0_0;
    let local_0_1 = this;
    v4 = function (p0) {
      appStore.settingsStore.setPrefetchPageCount(p0);
      local_0_1.prefetchPageBadge = local_0_1.prefetchPageLabel(p0);
    };
    local_0_0 = local_0_1.buildRadioContent(local_0_1.prefetchPageOptions(), appStore.settings.prefetchPageCount, v4);
    local_0_1.prefetchPageDialogController = new CustomDialogController({
      "backgroundColor": Color.Transparent,
      "systemMaterial": UIMaterialManager.dialogMaterial,
      "maskColor": UIMaterialManager.scrim,
      "builder": function () {
        let acc = new SelectDialog(local_0_1, {
          "title": "预加载页数",
          "selectedIndex": local_0_0.selectedIndex,
          "radioContent": local_0_0.items,
          "confirm": {
            "value": "确定"
          }
        }, undefined, -1, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 446,
          "col": 16
        });
        acc.setController(local_0_1.prefetchPageDialogController);
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "title": "预加载页数",
            "selectedIndex": local_0_0.selectedIndex,
            "radioContent": local_0_0.items,
            "confirm": {
              "value": "确定"
            }
          };
        };
      },
      "autoCancel": true
    }, local_0_1);
    if (local_0_1.prefetchPageDialogController !== null && local_0_1.prefetchPageDialogController !== undefined) {
      local_0_1.prefetchPageDialogController.open();
    }
  }
  showImageStrategyPicker() {
    let v4 /*appStore*/;
    let local_0_0;
    let local_0_1 = this;
    v4 = function (p0) {
      appStore.settingsStore.setImageLoadStrategy(String(p0));
      local_0_1.imageStrategyBadge = local_0_1.imageStrategyLabel(String(p0));
    };
    local_0_0 = local_0_1.buildRadioContent(local_0_1.imageStrategyOptions(), parseInt(appStore.settings.imageLoadStrategy), v4);
    local_0_1.imageStrategyDialogController = new CustomDialogController({
      "backgroundColor": Color.Transparent,
      "systemMaterial": UIMaterialManager.dialogMaterial,
      "maskColor": UIMaterialManager.scrim,
      "builder": function () {
        let acc = new SelectDialog(local_0_1, {
          "title": "图片加载模式",
          "selectedIndex": local_0_0.selectedIndex,
          "radioContent": local_0_0.items,
          "confirm": {
            "value": "确定"
          }
        }, undefined, -1, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 470,
          "col": 16
        });
        acc.setController(local_0_1.imageStrategyDialogController);
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "title": "图片加载模式",
            "selectedIndex": local_0_0.selectedIndex,
            "radioContent": local_0_0.items,
            "confirm": {
              "value": "确定"
            }
          };
        };
      },
      "autoCancel": true
    }, local_0_1);
    if (local_0_1.imageStrategyDialogController !== null && local_0_1.imageStrategyDialogController !== undefined) {
      local_0_1.imageStrategyDialogController.open();
    }
  }
  updateAiBadge() {
    let v0 /*appStore*/ = appStore.settingsStore.getActiveAiProfile();
    if (v0) {
      this.aiProviderBadge = v0.name;
    } else if (appStore.settings.aiProfiles.length > 0) {
      this.aiProviderBadge = "未选择 AI";
    } else {
      this.aiProviderBadge = "未配置 AI";
    }
  }
  initialRender() {
    let local_0_0 = this;
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Stack.create();
      Stack.width("100%");
      Stack.height("100%");
    }, Stack);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.height("100%");
      Column.backgroundColor(AppColors.bg);
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Scroll.create(local_0_0.scroller);
      Scroll.layoutWeight(1);
      Scroll.scrollBar(BarState.Off);
      Scroll.align(Alignment.Top);
      Scroll.contentStartOffset(TitleScrollEffect.getContentStartOffset(local_0_0.statusBarHeight));
      Scroll.linearGradientBlur(TitleScrollEffect.getBlurRadius(local_0_0.titleScrollEffectProgress), {
        "fractionStops": TitleScrollEffect.getBlurStops(local_0_0.scrollViewportHeight, local_0_0.statusBarHeight),
        "direction": GradientDirection.Bottom
      });
      Scroll.onAreaChange(function (p0, p1) {
        if (typeof p1.height === "number" && p1.height !== local_0_0.scrollViewportHeight) {
          local_0_0.scrollViewportHeight = p1.height;
        }
      });
      Scroll.onDidScroll(function () {
        local_0_0.syncTitleScrollEffect();
      });
      Scroll.onAppear(function () {
        local_0_0.syncTitleScrollEffect();
      });
    }, Scroll);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.alignItems(HorizontalAlign.Center);
      Column.padding({
        "bottom": 32
      });
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("92%");
      Column.backgroundColor(AppColors.bgTertiary);
      Column.borderRadius(12);
      Column.padding(12);
      Column.margin({
        "top": 16
      });
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Text.create("主题选择");
      Text.fontSize(15);
      Text.fontColor(AppColors.textSecondary);
      Text.width("100%");
      Text.padding({
        "bottom": 10
      });
    }, Text);
    Text.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.width("100%");
    }, Row);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      ForEach.create();
      local_0_0.forEachUpdateFunction(p0, THEME_OPTIONS, function (p0) {
        local_0_0.ThemeCard.bind(local_0_0)(p0);
      }, function (p0) {
        return p0.name;
      }, false, false);
    }, ForEach);
    ForEach.pop();
    Row.pop();
    Column.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("92%");
      Column.backgroundColor(AppColors.bgTertiary);
      Column.borderRadius(12);
      Column.margin({
        "top": 12
      });
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingRow*/;
      if (p1) {
        v0 = new SettingRow(local_0_0, {
          "iconRes": {
            "id": 16777351,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.blacklist,
          "label": "黑名单管理",
          "onAction": function () {
            routerStore.navigateActivity(Screen.blacklist());
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 517,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777351,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.blacklist,
            "label": "黑名单管理",
            "onAction": function () {
              routerStore.navigateActivity(Screen.blacklist());
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777351,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.blacklist,
          "label": "黑名单管理"
        });
      }
    }, {
      "name": "SettingRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingRow*/;
      if (p1) {
        v0 = new SettingRow(local_0_0, {
          "iconRes": {
            "id": 16777367,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.userNotes,
          "label": "用户备注",
          "onAction": function () {
            routerStore.navigateActivity(Screen.notes());
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 526,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777367,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.userNotes,
            "label": "用户备注",
            "onAction": function () {
              routerStore.navigateActivity(Screen.notes());
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777367,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.userNotes,
          "label": "用户备注"
        });
      }
    }, {
      "name": "SettingRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingRow*/;
      if (p1) {
        v0 = new SettingRow(local_0_0, {
          "iconRes": {
            "id": 16777358,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.keywordFilter,
          "label": "关键词屏蔽",
          "onAction": function () {
            routerStore.navigateActivity(Screen.filterKeywords());
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 535,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777358,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.keywordFilter,
            "label": "关键词屏蔽",
            "onAction": function () {
              routerStore.navigateActivity(Screen.filterKeywords());
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777358,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.keywordFilter,
          "label": "关键词屏蔽"
        });
      }
    }, {
      "name": "SettingRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingToggleRow*/;
      if (p1) {
        v0 = new SettingToggleRow(local_0_0, {
          "iconRes": {
            "id": 16777350,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.autoCheckin,
          "label": "自动签到",
          "isOn": appStore.settings.autoCheckin,
          "onChange": function (p0) {
            appStore.settingsStore.setAutoCheckin(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 544,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777350,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.autoCheckin,
            "label": "自动签到",
            "isOn": appStore.settings.autoCheckin,
            "onChange": function (p0) {
              appStore.settingsStore.setAutoCheckin(p0);
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777350,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.autoCheckin,
          "label": "自动签到",
          "isOn": appStore.settings.autoCheckin
        });
      }
    }, {
      "name": "SettingToggleRow"
    });
    Column.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("92%");
      Column.backgroundColor(AppColors.bgTertiary);
      Column.borderRadius(12);
      Column.margin({
        "top": 12
      });
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingPickerRow*/;
      if (p1) {
        v0 = new SettingPickerRow(local_0_0, {
          "iconRes": {
            "id": 16777349,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.aiConfig,
          "label": "AI 配置",
          "badgeText": local_0_0.aiProviderBadge,
          "onAction": function () {
            routerStore.navigateActivity(Screen.aiSettings());
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 560,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777349,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.aiConfig,
            "label": "AI 配置",
            "badgeText": local_0_0.aiProviderBadge,
            "onAction": function () {
              routerStore.navigateActivity(Screen.aiSettings());
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777349,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.aiConfig,
          "label": "AI 配置",
          "badgeText": local_0_0.aiProviderBadge
        });
      }
    }, {
      "name": "SettingPickerRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingToggleRow*/;
      if (p1) {
        v0 = new SettingToggleRow(local_0_0, {
          "iconRes": {
            "id": 16777363,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.smartGrip,
          "label": "智感握姿",
          "isOn": appStore.settings.smartGrip,
          "onChange": function (p0) {
            appStore.settingsStore.setSmartGrip(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 570,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777363,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.smartGrip,
            "label": "智感握姿",
            "isOn": appStore.settings.smartGrip,
            "onChange": function (p0) {
              appStore.settingsStore.setSmartGrip(p0);
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777363,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.smartGrip,
          "label": "智感握姿",
          "isOn": appStore.settings.smartGrip
        });
      }
    }, {
      "name": "SettingToggleRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingRow*/;
      if (p1) {
        v0 = new SettingRow(local_0_0, {
          "iconRes": {
            "id": 16777366,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.tts,
          "label": "语音朗读",
          "onAction": function () {
            routerStore.navigateActivity(Screen.ttsSettings());
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 580,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777366,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.tts,
            "label": "语音朗读",
            "onAction": function () {
              routerStore.navigateActivity(Screen.ttsSettings());
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777366,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.tts,
          "label": "语音朗读"
        });
      }
    }, {
      "name": "SettingRow"
    });
    Column.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("92%");
      Column.backgroundColor(AppColors.bgTertiary);
      Column.borderRadius(12);
      Column.margin({
        "top": 12
      });
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingToggleRow*/;
      if (p1) {
        v0 = new SettingToggleRow(local_0_0, {
          "iconRes": {
            "id": 16777362,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.signature,
          "label": "显示签名",
          "isOn": appStore.settings.showSignature,
          "onChange": function (p0) {
            appStore.settingsStore.setShowSignature(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 594,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777362,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.signature,
            "label": "显示签名",
            "isOn": appStore.settings.showSignature,
            "onChange": function (p0) {
              appStore.settingsStore.setShowSignature(p0);
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777362,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.signature,
          "label": "显示签名",
          "isOn": appStore.settings.showSignature
        });
      }
    }, {
      "name": "SettingToggleRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingPickerRow*/;
      if (p1) {
        v0 = new SettingPickerRow(local_0_0, {
          "iconRes": {
            "id": 16777356,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.imageLoading,
          "label": "图片加载模式",
          "badgeText": local_0_0.imageStrategyBadge,
          "onAction": function () {
            local_0_0.showImageStrategyPicker();
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 604,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777356,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.imageLoading,
            "label": "图片加载模式",
            "badgeText": local_0_0.imageStrategyBadge,
            "onAction": function () {
              local_0_0.showImageStrategyPicker();
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777356,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.imageLoading,
          "label": "图片加载模式",
          "badgeText": local_0_0.imageStrategyBadge
        });
      }
    }, {
      "name": "SettingPickerRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingToggleRow*/;
      if (p1) {
        v0 = new SettingToggleRow(local_0_0, {
          "iconRes": {
            "id": 16777365,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.topicPreview,
          "label": "显示帖子预览图",
          "isOn": appStore.settings.showTopicPreview,
          "onChange": function (p0) {
            appStore.settingsStore.setShowTopicPreview(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 617,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777365,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.topicPreview,
            "label": "显示帖子预览图",
            "isOn": appStore.settings.showTopicPreview,
            "onChange": function (p0) {
              appStore.settingsStore.setShowTopicPreview(p0);
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777365,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.topicPreview,
          "label": "显示帖子预览图",
          "isOn": appStore.settings.showTopicPreview
        });
      }
    }, {
      "name": "SettingToggleRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingPickerRow*/;
      if (p1) {
        v0 = new SettingPickerRow(local_0_0, {
          "iconRes": {
            "id": 16777355,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.fontSize,
          "label": "字体大小",
          "badgeText": "" + local_0_0.contentFontSize + "",
          "onAction": function () {
            routerStore.navigateActivity(Screen.fontSizeSettings());
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 628,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777355,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.fontSize,
            "label": "字体大小",
            "badgeText": "" + local_0_0.contentFontSize + "",
            "onAction": function () {
              routerStore.navigateActivity(Screen.fontSizeSettings());
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777355,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.fontSize,
          "label": "字体大小",
          "badgeText": "" + local_0_0.contentFontSize + ""
        });
      }
    }, {
      "name": "SettingPickerRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingPickerRow*/;
      if (p1) {
        v0 = new SettingPickerRow(local_0_0, {
          "iconRes": {
            "id": 16777364,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.threadNavigation,
          "label": "帖子楼层导航",
          "badgeText": local_0_0.threadNavBadge,
          "onAction": function () {
            local_0_0.showThreadNavPicker();
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 638,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777364,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.threadNavigation,
            "label": "帖子楼层导航",
            "badgeText": local_0_0.threadNavBadge,
            "onAction": function () {
              local_0_0.showThreadNavPicker();
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777364,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.threadNavigation,
          "label": "帖子楼层导航",
          "badgeText": local_0_0.threadNavBadge
        });
      }
    }, {
      "name": "SettingPickerRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingPickerRow*/;
      if (p1) {
        v0 = new SettingPickerRow(local_0_0, {
          "iconRes": {
            "id": 16777360,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.pagePrefetch,
          "label": "预加载页数",
          "badgeText": local_0_0.prefetchPageBadge,
          "onAction": function () {
            local_0_0.showPrefetchPagePicker();
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 648,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777360,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.pagePrefetch,
            "label": "预加载页数",
            "badgeText": local_0_0.prefetchPageBadge,
            "onAction": function () {
              local_0_0.showPrefetchPagePicker();
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777360,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.pagePrefetch,
          "label": "预加载页数",
          "badgeText": local_0_0.prefetchPageBadge
        });
      }
    }, {
      "name": "SettingPickerRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingToggleRow*/;
      if (p1) {
        v0 = new SettingToggleRow(local_0_0, {
          "iconRes": {
            "id": 16777361,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.readingProgress,
          "label": "记录阅读进度",
          "isOn": appStore.settings.recordReadingProgress,
          "onChange": function (p0) {
            appStore.settingsStore.setRecordReadingProgress(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 658,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777361,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.readingProgress,
            "label": "记录阅读进度",
            "isOn": appStore.settings.recordReadingProgress,
            "onChange": function (p0) {
              appStore.settingsStore.setRecordReadingProgress(p0);
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777361,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.readingProgress,
          "label": "记录阅读进度",
          "isOn": appStore.settings.recordReadingProgress
        });
      }
    }, {
      "name": "SettingToggleRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingToggleRow*/;
      if (p1) {
        v0 = new SettingToggleRow(local_0_0, {
          "iconRes": {
            "id": 16777357,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.internalBrowser,
          "label": "内置网页浏览",
          "isOn": appStore.settings.useInternalWebView,
          "onChange": function (p0) {
            appStore.settingsStore.setUseInternalWebView(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 668,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777357,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.internalBrowser,
            "label": "内置网页浏览",
            "isOn": appStore.settings.useInternalWebView,
            "onChange": function (p0) {
              appStore.settingsStore.setUseInternalWebView(p0);
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777357,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.internalBrowser,
          "label": "内置网页浏览",
          "isOn": appStore.settings.useInternalWebView
        });
      }
    }, {
      "name": "SettingToggleRow"
    });
    Column.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("92%");
      Column.backgroundColor(AppColors.bgTertiary);
      Column.borderRadius(12);
      Column.margin({
        "top": 12
      });
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingToggleRow*/;
      if (p1) {
        v0 = new SettingToggleRow(local_0_0, {
          "iconRes": {
            "id": 16777354,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.debugMode,
          "label": "调试模式",
          "isOn": appStore.settings.debugMode,
          "onChange": function (p0) {
            appStore.settingsStore.setDebugMode(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 684,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777354,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.debugMode,
            "label": "调试模式",
            "isOn": appStore.settings.debugMode,
            "onChange": function (p0) {
              appStore.settingsStore.setDebugMode(p0);
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777354,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.debugMode,
          "label": "调试模式",
          "isOn": appStore.settings.debugMode
        });
      }
    }, {
      "name": "SettingToggleRow"
    });
    Column.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("92%");
      Column.backgroundColor(AppColors.bgTertiary);
      Column.borderRadius(12);
      Column.margin({
        "top": 12
      });
    }, Column);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingRow*/;
      if (p1) {
        v0 = new SettingRow(local_0_0, {
          "iconRes": {
            "id": 16777353,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.credentialExport,
          "label": "导出账号凭证",
          "onAction": function () {
            local_0_0.handleExport();
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 699,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777353,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.credentialExport,
            "label": "导出账号凭证",
            "onAction": function () {
              local_0_0.handleExport();
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777353,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.credentialExport,
          "label": "导出账号凭证"
        });
      }
    }, {
      "name": "SettingRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*SettingPickerRow*/;
      if (p1) {
        v0 = new SettingPickerRow(local_0_0, {
          "iconRes": {
            "id": 16777352,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.clearCache,
          "label": "清除缓存",
          "badgeText": local_0_0.cacheSizeText,
          "onAction": function () {
            if (local_0_0.clearCacheDialogController !== null && local_0_0.clearCacheDialogController !== undefined) {
              local_0_0.clearCacheDialogController.open();
            }
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 708,
          "col": 15
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "iconRes": {
              "id": 16777352,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            },
            "iconColor": SettingsIconColors.clearCache,
            "label": "清除缓存",
            "badgeText": local_0_0.cacheSizeText,
            "onAction": function () {
              if (local_0_0.clearCacheDialogController !== null && local_0_0.clearCacheDialogController !== undefined) {
                local_0_0.clearCacheDialogController.open();
              }
            }
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "iconRes": {
            "id": 16777352,
            "type": 20000,
            "params": [],
            "bundleName": "com.example.nga_oh",
            "moduleName": "entry"
          },
          "iconColor": SettingsIconColors.clearCache,
          "label": "清除缓存",
          "badgeText": local_0_0.cacheSizeText
        });
      }
    }, {
      "name": "SettingPickerRow"
    });
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Divider.create();
      Divider.margin({
        "left": 60
      });
      Divider.color(AppColors.separator);
    }, Divider);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.width("100%");
      Row.height(44);
      Row.padding({
        "left": 16,
        "right": 16
      });
      Row.alignItems(VerticalAlign.Center);
      Row.onClick(function () {
        if (local_0_0.logoutDialogController !== null && local_0_0.logoutDialogController !== undefined) {
          local_0_0.logoutDialogController.open();
        }
      });
    }, Row);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Stack.create();
      Stack.width(29);
      Stack.height(29);
      Stack.borderRadius(6);
      Stack.backgroundColor(AppColors.destructive);
      Stack.margin({
        "right": 12
      });
    }, Stack);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Image.create({
        "id": 16777359,
        "type": 20000,
        "params": [],
        "bundleName": "com.example.nga_oh",
        "moduleName": "entry"
      });
      Image.width(17);
      Image.height(17);
      Image.fillColor(AppColors.white);
    }, Image);
    Stack.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      Text.create("退出登录");
      Text.fontSize(17);
      Text.fontColor(AppColors.destructive);
      Text.layoutWeight(1);
    }, Text);
    Text.pop();
    Row.pop();
    Column.pop();
    Column.pop();
    Scroll.pop();
    Column.pop();
    local_0_0.observeComponentCreation2(function (p0, p1) {
      __Common__.create();
      __Common__.width("100%");
      __Common__.position({
        "x": 0,
        "y": 0
      });
    }, __Common__);
    local_0_0.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new PanelNavBar(local_0_0, {
          "title": "设置",
          "scrollEffectProgress": local_0_0.titleScrollEffectProgress
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/SettingsPanel.ets",
          "line": 761,
          "col": 7
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "title": "设置",
            "scrollEffectProgress": local_0_0.titleScrollEffectProgress
          };
        };
      } else {
        local_0_0.updateStateVarsOfChildByElmtId(p0, {
          "title": "设置",
          "scrollEffectProgress": local_0_0.titleScrollEffectProgress
        });
      }
    }, {
      "name": "PanelNavBar"
    });
    __Common__.pop();
    Stack.pop();
  }
  ThemeCard(p0, p1) {
    let local_0_1 = this;
    let local_0_0 = p0;
    local_0_1.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.layoutWeight(1);
      Column.margin({
        "left": 4,
        "right": 4
      });
      Column.padding(8);
      Column.backgroundColor(AppColors.bgSecondary);
      Column.borderRadius(10);
      Column.onClick(function () {
        if (local_0_0.name !== local_0_1.themeName) {
          appStore.settingsStore.setTheme(local_0_0.name);
        }
      });
    }, Column);
    local_0_1.observeComponentCreation2(function (p0, p1) {
      Stack.create();
      Stack.width("100%");
      Stack.height(90);
      Stack.borderRadius(8);
      Stack.clip(true);
      Stack.border({
        "width": local_0_1.themeName === local_0_0.name ? 2 : 1,
        "color": local_0_1.themeName === local_0_0.name ? AppColors.primary : AppColors.separator
      });
    }, Stack);
    local_0_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_0_0.name === "system") {
        local_0_1.ifElseBranchUpdateFunction(0, function () {
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("100%");
            Column.height("100%");
          }, Column);
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Stack.create();
            Stack.width("100%");
            Stack.layoutWeight(1);
            Stack.backgroundColor("#FEFAF6");
          }, Stack);
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.padding(8);
            Column.alignItems(HorizontalAlign.Start);
            Column.width("100%");
          }, Column);
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("80%");
            Row.height(3);
            Row.backgroundColor("#C08A4A");
            Row.borderRadius(2);
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("60%");
            Row.height(3);
            Row.backgroundColor("#3E2A1D");
            Row.borderRadius(2);
            Row.opacity(0.5);
            Row.margin({
              "top": 5
            });
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("45%");
            Row.height(3);
            Row.backgroundColor("#3E2A1D");
            Row.borderRadius(2);
            Row.opacity(0.25);
            Row.margin({
              "top": 4
            });
          }, Row);
          Row.pop();
          Column.pop();
          Stack.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Stack.create();
            Stack.width("100%");
            Stack.layoutWeight(1);
            Stack.backgroundColor("#1A1A1E");
          }, Stack);
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.padding(8);
            Column.alignItems(HorizontalAlign.Start);
            Column.width("100%");
          }, Column);
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("80%");
            Row.height(3);
            Row.backgroundColor("#D4A85A");
            Row.borderRadius(2);
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("60%");
            Row.height(3);
            Row.backgroundColor("#EAE2D8");
            Row.borderRadius(2);
            Row.opacity(0.5);
            Row.margin({
              "top": 5
            });
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("45%");
            Row.height(3);
            Row.backgroundColor("#EAE2D8");
            Row.borderRadius(2);
            Row.opacity(0.25);
            Row.margin({
              "top": 4
            });
          }, Row);
          Row.pop();
          Column.pop();
          Stack.pop();
          Column.pop();
        });
      } else {
        local_0_1.ifElseBranchUpdateFunction(1, function () {
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("100%");
            Column.height("100%");
            Column.backgroundColor(local_0_0.bgColor);
          }, Column);
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("100%");
            Row.height(2);
            Row.backgroundColor(local_0_0.primaryColor);
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.padding(8);
            Column.alignItems(HorizontalAlign.Start);
            Column.width("100%");
          }, Column);
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("55%");
            Row.height(3);
            Row.backgroundColor(local_0_0.textColor);
            Row.borderRadius(2);
            Row.opacity(0.55);
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("35%");
            Row.height(3);
            Row.backgroundColor(local_0_0.textColor);
            Row.borderRadius(2);
            Row.opacity(0.25);
            Row.margin({
              "top": 5
            });
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("70%");
            Row.height(3);
            Row.backgroundColor(local_0_0.textColor);
            Row.borderRadius(2);
            Row.opacity(0.35);
            Row.margin({
              "top": 5
            });
          }, Row);
          Row.pop();
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Row.create();
            Row.width("45%");
            Row.height(3);
            Row.backgroundColor(local_0_0.textColor);
            Row.borderRadius(2);
            Row.opacity(0.15);
            Row.margin({
              "top": 5
            });
          }, Row);
          Row.pop();
          Column.pop();
          Column.pop();
        });
      }
    }, If);
    If.pop();
    Stack.pop();
    local_0_1.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.width("100%");
      Row.margin({
        "top": 8
      });
    }, Row);
    local_0_1.observeComponentCreation2(function (p0, p1) {
      Text.create(local_0_0.label);
      Text.fontSize(13);
      Text.fontColor(AppColors.textPrimary);
      Text.fontWeight(FontWeight.Medium);
    }, Text);
    Text.pop();
    local_0_1.observeComponentCreation2(function (p0, p1) {
      Blank.create();
    }, Blank);
    Blank.pop();
    local_0_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_0_1.themeName === local_0_0.name) {
        local_0_1.ifElseBranchUpdateFunction(0, function () {
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Image.create({
              "id": 16777292,
              "type": 20000,
              "params": [],
              "bundleName": "com.example.nga_oh",
              "moduleName": "entry"
            });
            Image.width(14);
            Image.height(14);
            Image.fillColor(AppColors.primary);
          }, Image);
        });
      } else {
        local_0_1.ifElseBranchUpdateFunction(1, function () {
          local_0_1.observeComponentCreation2(function (p0, p1) {
            Stack.create();
            Stack.width(14);
            Stack.height(14);
            Stack.borderRadius(7);
            Stack.border({
              "width": 1.5,
              "color": AppColors.separator
            });
          }, Stack);
          Stack.pop();
        });
      }
    }, If);
    If.pop();
    Row.pop();
    Column.pop();
  }
  rerender() {
    this.updateDirtyElements();
  }
  __resetStateVarsOnReuse__Internal(p0) {
    this.__themeName.resetSource();
    this.__statusBarHeight.resetSource();
    this.__aiConfigVersion.resetSource();
    this.__contentFontSize.resetSource();
  }
}