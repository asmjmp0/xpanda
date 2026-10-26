/*
* class name:Lpkg_modules/.ohpm/webview_flutter_ohos@63rxyovf6soepjs+sja1e6+fkzygj1xf5z4crizkc8u=/pkg_modules/webview_flutter_ohos/src/main/ets/io.flutter.plugins/webview_flutter/WebChromeClientHostApiImpl;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import Log from "@package:pkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/util/Log";
import { WebChromeClientHostApi } from "@package:pkg_modules/.ohpm/webview_flutter_ohos@63rxyovf6soepjs+sja1e6+fkzygj1xf5z4crizkc8u=/pkg_modules/webview_flutter_ohos/src/main/ets/io.flutter.plugins/webview_flutter/GeneratedOhosWebView";
import web_webview from "@ohos:web.webview";
let local_0_0, local_0_2;
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
local_0_2 = "WebChromeClientHostApiImpl";
export class WebChromeClientHostApiImpl extends WebChromeClientHostApi {
  constructor(p0, p1, p2) {
    let v0 = super();
    v0.instanceManager = p0;
    v0.webChromeClientCreator = p1;
    v0.flutterApi = p2;
    return v0;
  }
  create(p0) {
    this.instanceManager.addDartCreatedInstance(this.webChromeClientCreator.createWebChromeClient(this.flutterApi), p0);
  }
  setSynchronousReturnValueForOnShowFileChooser(p0, p1) {
    this.instanceManager.getInstance(p0).setReturnValueForOnShowFileChooser(p1);
  }
  setSynchronousReturnValueForOnConsoleMessage(p0, p1) {
    this.instanceManager.getInstance(p0).setReturnValueForOnConsoleMessage(p1);
  }
  setSynchronousReturnValueForOnJsAlert(p0, p1) {
    this.instanceManager.getInstance(p0).setReturnValueForOnJsAlert(p1);
  }
  setSynchronousReturnValueForOnJsConfirm(p0, p1) {
    this.instanceManager.getInstance(p0).setReturnValueForOnJsConfirm(p1);
  }
  setSynchronousReturnValueForOnJsPrompt(p0, p1) {
    this.instanceManager.getInstance(p0).setReturnValueForOnJsPrompt(p1);
  }
}
export class WebChromeClientCreator {
  constructor() {}
  createWebChromeClient(p0) {
    return new local_0_0(p0);
  }
}
class NewWebView extends ViewPU {
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
    v0.controller = undefined;
    v0.webViewController = new web_webview.WebviewController();
    v0.setInitiallyProvidedValue(p1);
    v0.finalizeConstruction();
    return v0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.controller !== undefined) {
      this.controller = p0.controller;
    }
    if (p0.webViewController !== undefined) {
      this.webViewController = p0.webViewController;
    }
  }
  updateStateVars(p0) {}
  purgeVariableDependenciesOnElmtId(p0) {}
  aboutToBeDeleted() {
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  setController(p0) {
    this.controller = p0;
  }
  initialRender() {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Web.create({
        "src": "",
        "controller": local_1_0.webViewController
      });
      Web.javaScriptAccess(true);
      Web.multiWindowAccess(false);
      Web.onWindowExit(function () {
        if (local_1_0.controller) {
          local_1_0.controller.close();
        }
      });
    }, Web);
  }
  rerender() {
    this.updateDirtyElements();
  }
}
local_0_0 = class WebChromeClientImpl {
  constructor(p0) {
    this.returnValueForOnShowFileChooser = false;
    this.returnValueForOnConsoleMessage = false;
    this.returnValueForOnJsAlert = false;
    this.returnValueForOnJsConfirm = false;
    this.returnValueForOnJsPrompt = false;
    this.emptyReply = {
      "reply": function reply(p0) {}
    };
    this.flutterApi = p0;
  }
  onCreateWindow(p0, p1, p2, p3) {
    let v0 /*web_webview*/, acc;
    let local_1_0;
    let local_1_1 = this;
    v0 = p0.getDialogController();
    if (v0 != null && (v0 = p0.getDialogController(), v0 !== null) && v0 !== undefined) {
      v0.close();
    }
    local_1_0 = new web_webview.WebviewController();
    acc = new CustomDialogController({
      "builder": function builder() {
        let v0 /*NewWebView*/ = new NewWebView(local_1_1, {
          "webViewController": local_1_0
        }, undefined, -1, function () {}, {
          "page": "oh_modules/.ohpm/webview_flutter_ohos@63rxyovf6soepjs+sja1e6+fkzygj1xf5z4crizkc8u=/oh_modules/webview_flutter_ohos/src/main/ets/io.flutter.plugins/webview_flutter/WebChromeClientHostApiImpl.ets",
          "line": 142,
          "col": 16
        });
        v0.setController(local_1_1.dialogController);
        ViewPU.create(v0);
        v0.paramsGenerator_ = function o64() {
          return {
            "webViewController": local_1_0
          };
        };
      }
    }, local_1_1);
    acc.open();
    p3.setWebController(local_1_0);
  }
  onProgressChanged(p0, p1) {
    this.flutterApi.onProgressChangedImpl(this, p0, p1, this.emptyReply);
  }
  onShowCustomView(p0, p1) {
    this.flutterApi.onShowCustomViewImpl(this, p0, p1, this.emptyReply);
  }
  onHideCustomView() {
    this.flutterApi.onHideCustomViewImpl(this, this.emptyReply);
  }
  onGeolocationPermissionsShowPrompt(p0, p1) {
    this.flutterApi.onGeolocationPermissionsShowPromptImpl(this, p0, p1, this.emptyReply);
  }
  onGeolocationPermissionsHidePrompt() {
    this.flutterApi.onGeolocationPermissionsHidePromptImpl(this, this.emptyReply);
  }
  onShowFileChooser(p0, p1, p2) {
    let local_1_1 = p1;
    let local_1_0 = this.returnValueForOnShowFileChooser;
    this.flutterApi.onShowFileChooserImpl(this, p0, p2, {
      "reply": function (p0) {
        if (local_1_0 && p0) {
          local_1_1.handleFileList(p0);
        }
      }
    });
    return local_1_0;
  }
  onPermissionRequest(p0) {
    this.flutterApi.onPermissionRequestImpl(this, p0, this.emptyReply);
  }
  onConsoleMessage(p0) {
    this.flutterApi.onConsoleMessageImpl(this, p0, this.emptyReply);
    return this.returnValueForOnConsoleMessage;
  }
  setReturnValueForOnShowFileChooser(p0) {
    this.returnValueForOnShowFileChooser = p0;
  }
  setReturnValueForOnConsoleMessage(p0) {
    this.returnValueForOnConsoleMessage = p0;
  }
  setReturnValueForOnJsAlert(p0) {
    this.returnValueForOnJsAlert = p0;
  }
  setReturnValueForOnJsConfirm(p0) {
    this.returnValueForOnJsConfirm = p0;
  }
  setReturnValueForOnJsPrompt(p0) {
    this.returnValueForOnJsPrompt = p0;
  }
  onJsAlert(p0, p1, p2, p3) {
    let local_1_0 = p3;
    if (this.returnValueForOnJsAlert) {
      this.flutterApi.onJsAlertImpl(this, p1, p2, {
        "reply": function () {
          local_1_0.handleConfirm();
        }
      });
      return true;
    }
    return false;
  }
  onJsConfirm(p0, p1, p2, p3) {
    let local_1_0 = p3;
    if (this.returnValueForOnJsConfirm) {
      this.flutterApi.onJsConfirmImpl(this, p1, p2, {
        "reply": function (p0) {
          if (p0) {
            local_1_0.handleConfirm();
          } else {
            local_1_0.handleCancel();
          }
        }
      });
      return true;
    }
    return false;
  }
  onJsPrompt(p0, p1, p2, p3, p4) {
    let local_1_0 = p4;
    if (this.returnValueForOnJsPrompt) {
      this.flutterApi.onJsPromptImpl(this, p1, p2, p3, {
        "reply": function (p0) {
          if (p0 == null) {
            local_1_0.handleCancel();
          } else {
            local_1_0.handlePromptConfirm(p0);
          }
        }
      });
      return true;
    }
    return false;
  }
};
class newWindowWebViewClient {
  constructor() {}
  onReceivedHttpError(p0, p1, p2) {
    throw new Error("Method not implemented.");
  }
  onPageStarted(p0, p1) {
    Log.i(local_0_2, "onPageStarted");
  }
  onPageFinished(p0, p1) {
    Log.i(local_0_2, "onPageFinished");
  }
  onReceivedError(p0, p1, p2) {
    Log.i(local_0_2, "onReceivedError");
  }
  doUpdateVisitedHistory(p0, p1, p2) {
    Log.i(local_0_2, "doUpdateVisitedHistory");
  }
  shouldOverrideUrlLoading(p0, p1) {
    p0.getController().loadUrl(p1.getRequestUrl());
    return true;
  }
  onReceivedHttpAuthRequest(p0, p1, p2, p3) {
    Log.i(local_0_2, "onReceivedHttpAuthRequest");
  }
}