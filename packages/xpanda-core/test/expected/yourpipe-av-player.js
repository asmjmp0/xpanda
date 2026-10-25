/*
* class name:L&entry/src/main/ets/features/player/components/AVPlayer&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AICaptionController } from "@bundle:com.huawei.hmsapp.hiai.hsp/aiCaptionHsp/Index";
import { CommonConstants } from "@normalized:N&&&mediaservice/Index&1.0.0";
import ConfigurationConstant from "@ohos:app.ability.ConfigurationConstant";
import { LengthMetrics } from "@ohos:arkui.node";
import { LlmTranslateConfig } from "@normalized:N&&&entry/src/main/ets/common/LlmTranslateConfig&";
import { Logger } from "@normalized:N&&&mediaservice/Index&1.0.0";
import { MediaThumb } from "@normalized:N&&&entry/src/main/ets/common/components/MediaThumb&";
import { PiPManager } from "@normalized:N&&&entry/src/main/ets/features/player/pip/PiPManager&";
import { PlaybackConfig } from "@normalized:N&&&entry/src/main/ets/common/PlaybackConfig&";
import { PlayerEnvironmentService } from "@normalized:N&&&entry/src/main/ets/features/player/PlayerEnvironmentService&";
import { PlayerPresentation } from "@normalized:N&&&entry/src/main/ets/common/PlayerPresentation&";
import { PlayerSession } from "@normalized:N&&&entry/src/main/ets/common/PlayerSession&";
import { PlayerState } from "@normalized:N&&&mediaservice/Index&1.0.0";
import { PreferencesStore } from "@normalized:N&&&entry/src/main/ets/common/PreferencesStore&";
import { SUBTITLE_BACKGROUND_VALUES } from "@normalized:N&&&entry/src/main/ets/common/PlaybackConfig&";
import { SUBTITLE_FONT_COLOR_VALUES } from "@normalized:N&&&entry/src/main/ets/common/PlaybackConfig&";
import { SubtitleTranslationService } from "@normalized:N&&&entry/src/main/ets/features/player/translate/SubtitleTranslationService&";
import { SymbolGlyphModifier } from "@ohos:arkui.modifier";
import { ThemeColorUtil } from "@normalized:N&&&entry/src/main/ets/common/ThemeColorUtil&";
import { TranslationService } from "@normalized:N&&&entry/src/main/ets/common/TranslationService&";
import { UIConfig } from "@normalized:N&&&entry/src/main/ets/common/AppState&";
import deviceInfo from "@ohos:deviceInfo";
import i18n from "@ohos:i18n";
import { secondToTime } from "@normalized:N&&&mediaservice/Index&1.0.0";
let VideoPlayer;
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_9, local_0_10, local_0_11, local_0_12, local_0_13, local_0_14, local_0_15, local_0_16, local_0_17, local_0_18, local_0_19, local_0_20, local_0_21, local_0_22, local_0_23, local_0_24, local_0_25, local_0_26, local_0_27, local_0_28, local_0_29, local_0_30, local_0_31, local_0_32;
local_0_2 = undefined;
local_0_3 = undefined;
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
local_0_1 = "[PlayerLog][VideoPlayer]";
local_0_14 = 12;
local_0_15 = 1.25;
local_0_4 = 3000;
local_0_17 = 800;
local_0_16 = 200;
local_0_6 = 800;
local_0_5 = 300;
local_0_26 = 40;
local_0_31 = 24;
local_0_18 = 44;
local_0_25 = 48;
local_0_20 = 24;
local_0_19 = 36;
local_0_21 = 12;
local_0_23 = 16;
local_0_22 = 20;
local_0_24 = 360;
local_0_32 = 32;
local_0_28 = 480;
local_0_29 = 240;
local_0_8 = 0.1;
local_0_7 = 12;
local_0_9 = 8;
local_0_10 = 0.6;
local_0_30 = 0.35;
local_0_27 = 0.5;
local_0_13 = 4;
local_0_11 = 10;
local_0_12 = 0.08;
local_0_2 = {
  IDLE: "idle",
  PENDING: "pending",
  IGNORED: "ignored",
  SEEK: "seek",
  BRIGHTNESS: "brightness",
  VOLUME: "volume"
};
local_0_3 = {
  NONE: "none",
  PAN: "pan",
  SLIDER: "slider",
  MENU: "menu"
};
VideoPlayer = class panda_jmp0_reserved_anonymous_0 extends ViewPU {
  constructor(p0, p1, p2, p3, p4, p5) {
    let v6, v7;
    let local_1_0;
    local_1_0 = this;
    v6 = p3 === undefined ? -1 : p3;
    v7 = p4 === undefined ? undefined : p4;
    local_1_0 = super(p0, p2, v6, p5);
    if (typeof v7 === "function") {
      local_1_0.paramsGenerator_ = v7;
    }
    local_1_0.__themePrimary = local_1_0.createStorageProp("themePrimaryColor", "#E53935", "themePrimary");
    local_1_0.__uiConfig = local_1_0.createStorageLink("uiConfig", new UIConfig(), "uiConfig");
    local_1_0.__actionHub = local_1_0.initializeConsume("actionHub", "actionHub");
    local_1_0.__navBarHeight = local_1_0.createStorageProp("navBarHeight", 0, "navBarHeight");
    local_1_0.__statusBarHeight = local_1_0.createStorageProp("statusBarHeight", 0, "statusBarHeight");
    local_1_0.__playerGestureSafeTop = local_1_0.createStorageProp("playerGestureSafeTop", 24, "playerGestureSafeTop");
    local_1_0.__playerGestureSafeBottom = local_1_0.createStorageProp("playerGestureSafeBottom", 16, "playerGestureSafeBottom");
    local_1_0.__playerGestureSafeLeft = local_1_0.createStorageProp("playerGestureSafeLeft", 16, "playerGestureSafeLeft");
    local_1_0.__playerGestureSafeRight = local_1_0.createStorageProp("playerGestureSafeRight", 16, "playerGestureSafeRight");
    local_1_0.__playerControlAvoidTop = local_1_0.createStorageProp("playerControlAvoidTop", 0, "playerControlAvoidTop");
    local_1_0.__playerControlAvoidBottom = local_1_0.createStorageProp("playerControlAvoidBottom", 0, "playerControlAvoidBottom");
    local_1_0.__playerControlAvoidLeft = local_1_0.createStorageProp("playerControlAvoidLeft", 0, "playerControlAvoidLeft");
    local_1_0.__playerControlAvoidRight = local_1_0.createStorageProp("playerControlAvoidRight", 0, "playerControlAvoidRight");
    local_1_0.__safeAreaTop = local_1_0.initializeConsume("safeAreaTop", "safeAreaTop", 0);
    local_1_0.__currentColorMode = local_1_0.createStorageProp("currentColorMode", ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET, "currentColorMode");
    local_1_0.__isFullLandscapeScreen = new SynchedPropertySimpleOneWayPU(p1.isFullLandscapeScreen, local_1_0, "isFullLandscapeScreen");
    local_1_0.__showFullscreenButton = new SynchedPropertySimpleOneWayPU(p1.showFullscreenButton, local_1_0, "showFullscreenButton");
    local_1_0.__isPageShow = local_1_0.createStorageProp("playerPageVisible", false, "isPageShow");
    local_1_0.__isAppBackground = local_1_0.createStorageProp("isAppBackground", false, "isAppBackground");
    local_1_0.__isAudioOnlyMode = local_1_0.createStorageLink("isAudioOnlyMode", false, "isAudioOnlyMode");
    local_1_0.__isLocalMode = local_1_0.createStorageLink("isLocalMode", false, "isLocalMode");
    local_1_0.__playbackConfig = local_1_0.createStorageLink("playbackConfig", new PlaybackConfig(), "playbackConfig");
    local_1_0.__selectedVideo = local_1_0.createStorageProp("selectedVideo", null, "selectedVideo");
    local_1_0.__index = new SynchedPropertySimpleOneWayPU(p1.index, local_1_0, "index");
    local_1_0.__curSource = new SynchedPropertyObjectTwoWayPU(p1.curSource, local_1_0, "curSource");
    local_1_0.__chapters = new SynchedPropertyObjectOneWayPU(p1.chapters, local_1_0, "chapters");
    local_1_0.__curIndex = new SynchedPropertySimpleOneWayPU(p1.curIndex, local_1_0, "curIndex");
    local_1_0.__surfaceWidth = new ObservedPropertySimplePU(CommonConstants.SURFACE_WIDTH, local_1_0, "surfaceWidth");
    local_1_0.__surfaceHeight = new ObservedPropertySimplePU(CommonConstants.SURFACE_HEIGHT, local_1_0, "surfaceHeight");
    local_1_0.__containerWidthPX = new ObservedPropertySimplePU(0, local_1_0, "containerWidthPX");
    local_1_0.__containerHeightPX = new ObservedPropertySimplePU(0, local_1_0, "containerHeightPX");
    local_1_0.__trackThicknessSize = new ObservedPropertySimplePU(CommonConstants.TRACK_SIZE_MIN, local_1_0, "trackThicknessSize");
    local_1_0.__controller = new SynchedPropertyObjectTwoWayPU(p1.controller, local_1_0, "controller");
    local_1_0.__vm = new SynchedPropertyObjectTwoWayPU(p1.vm, local_1_0, "vm");
    local_1_0.lastController = undefined;
    local_1_0.__hasStreams = new ObservedPropertySimplePU(false, local_1_0, "hasStreams");
    local_1_0.__hasError = new ObservedPropertySimplePU(false, local_1_0, "hasError");
    local_1_0.__playbackStarted = new ObservedPropertySimplePU(false, local_1_0, "playbackStarted");
    local_1_0.__isWaitingForDualBuffer = new ObservedPropertySimplePU(false, local_1_0, "isWaitingForDualBuffer");
    local_1_0.__currentTime = new ObservedPropertySimplePU(0, local_1_0, "currentTime");
    local_1_0.__durationTime = new ObservedPropertySimplePU(0, local_1_0, "durationTime");
    local_1_0.keepScreenListener = new local_0_0 /*KeepScreenOnStateListener*/(local_1_0);
    local_1_0.progressListener = function (p0, p1) {
      let acc;
      local_1_0.currentTime = p0;
      local_1_0.durationTime = p1;
      if (!local_1_0.playbackStarted) {
        if (p0 <= 0) {
          acc = local_1_0.vm.isReady && local_1_0.vm.isPlaying && !local_1_0.vm.isBuffering;
        } else {
          acc = p0 > 0;
        }
        if (acc) {
          local_1_0.playbackStarted = true;
        }
      }
    };
    local_1_0.playbackStateListener = function (p0) {
      local_1_0.envService.setKeepScreenOn(p0.isPlaying || p0.isBuffering || p0.engineState === "buffering");
      if (!local_1_0.playbackStarted && p0.isReady && p0.isPlaying) {
        if (!p0.isBuffering) {
          local_1_0.playbackStarted = true;
          Logger.info(local_0_1 /*TAG*/, "Playback started; startup cover dismissed");
        }
      }
    };
    local_1_0.lastLoggedError = "";
    local_1_0.errorListener = function (p0) {
      if (p0.length > 0 && p0 !== local_1_0.lastLoggedError) {
        Logger.info(local_0_1 /*TAG*/, "Error received: " + p0 + "");
        local_1_0.lastLoggedError = p0;
      } else if (p0.length === 0) {
        local_1_0.lastLoggedError = "";
      }
      local_1_0.hasError = p0.length > 0;
      if (local_1_0.hasError) {
        local_1_0.clearHideTimer();
        local_1_0.showControls = true;
      }
    };
    local_1_0.waitingForBufferListener = function (p0) {
      Logger.debug(local_0_1 /*TAG*/, "Waiting for dual buffer: " + p0 + "");
      local_1_0.isWaitingForDualBuffer = p0;
    };
    local_1_0.__sliderStyle = new ObservedPropertySimplePU(SliderStyle.NONE, local_1_0, "sliderStyle");
    local_1_0.__isSliderDragging = new ObservedPropertySimplePU(false, local_1_0, "isSliderDragging");
    local_1_0.__sliderDragValue = new ObservedPropertySimplePU(0, local_1_0, "sliderDragValue");
    local_1_0.sliderTouchCanceled = false;
    local_1_0.__showControls = new ObservedPropertySimplePU(true, local_1_0, "showControls");
    local_1_0.controlsHideTimerId = -1;
    local_1_0.__containerVpWidth = new ObservedPropertySimplePU(0, local_1_0, "containerVpWidth");
    local_1_0.__containerVpHeight = new ObservedPropertySimplePU(0, local_1_0, "containerVpHeight");
    local_1_0.__subtitleDragLiftRatio = new ObservedPropertySimplePU(0, local_1_0, "subtitleDragLiftRatio");
    local_1_0.__subtitleDragOffsetXRatio = new ObservedPropertySimplePU(0, local_1_0, "subtitleDragOffsetXRatio");
    local_1_0.__aiTranslateProgress = new ObservedPropertySimplePU("", local_1_0, "aiTranslateProgress");
    local_1_0.__aiCaptionShown = new ObservedPropertySimplePU(false, local_1_0, "aiCaptionShown");
    local_1_0.__subtitleDragging = new ObservedPropertySimplePU(false, local_1_0, "subtitleDragging");
    local_1_0.aiCaptionController = new AICaptionController();
    local_1_0.aiCaptionOptions = undefined;
    local_1_0.aiCaptionSupported = false;
    local_1_0.__videoAspectMode = new ObservedPropertySimplePU("fit", local_1_0, "videoAspectMode");
    local_1_0.__videoPinchScale = new ObservedPropertySimplePU(1, local_1_0, "videoPinchScale");
    local_1_0.__videoPanXVp = new ObservedPropertySimplePU(0, local_1_0, "videoPanXVp");
    local_1_0.__videoPanYVp = new ObservedPropertySimplePU(0, local_1_0, "videoPanYVp");
    local_1_0.videoPinching = false;
    local_1_0.pinchStartScale = 1;
    local_1_0.__bottomControlBarVpH = new ObservedPropertySimplePU(0, local_1_0, "bottomControlBarVpH");
    local_1_0.__isGestureSeek = new ObservedPropertySimplePU(false, local_1_0, "isGestureSeek");
    local_1_0.__gestureSeekTime = new ObservedPropertySimplePU(0, local_1_0, "gestureSeekTime");
    local_1_0.gestureSeekStartTime = 0;
    local_1_0.panEndTime = 0;
    local_1_0.gestureMode = local_0_2.IDLE;
    local_1_0.activeInteraction = local_0_3.NONE;
    local_1_0.gestureStartX = 0;
    local_1_0.gestureStartY = 0;
    local_1_0.interactionEpoch = 0;
    local_1_0.seekHintHideTimerId = -1;
    local_1_0.lastTapAtMs = 0;
    local_1_0.pendingSingleTapTimerId = -1;
    local_1_0.__showBrightnessHint = new ObservedPropertySimplePU(false, local_1_0, "showBrightnessHint");
    local_1_0.__showVolumeHint = new ObservedPropertySimplePU(false, local_1_0, "showVolumeHint");
    local_1_0.__gestureBrightnessValue = new ObservedPropertySimplePU(0, local_1_0, "gestureBrightnessValue");
    local_1_0.__gestureVolumeValue = new ObservedPropertySimplePU(0, local_1_0, "gestureVolumeValue");
    local_1_0.__gestureBrightnessIcon = new ObservedPropertyObjectPU({
      "id": 125831497,
      "type": 40000,
      "params": [],
      "bundleName": "com.talon.yourpipe",
      "moduleName": "entry"
    }, local_1_0, "gestureBrightnessIcon");
    local_1_0.__gestureVolumeIcon = new ObservedPropertyObjectPU({
      "id": 125831511,
      "type": 40000,
      "params": [],
      "bundleName": "com.talon.yourpipe",
      "moduleName": "entry"
    }, local_1_0, "gestureVolumeIcon");
    local_1_0.gestureInitValue = 0;
    local_1_0.maxVolume = 15;
    local_1_0.volHideTimerId = -1;
    local_1_0.brightnessHideTimerId = -1;
    local_1_0.cacheCanvasSettings = new RenderingContextSettings(true);
    local_1_0.cacheCanvasCtx = new CanvasRenderingContext2D(local_1_0.cacheCanvasSettings);
    local_1_0.seekableRangesListener = function () {
      local_1_0.drawCacheRanges();
    };
    local_1_0.__showForwardHint = new ObservedPropertySimplePU(false, local_1_0, "showForwardHint");
    local_1_0.__showBackwardHint = new ObservedPropertySimplePU(false, local_1_0, "showBackwardHint");
    local_1_0.forwardHintTimerId = -1;
    local_1_0.backwardHintTimerId = -1;
    local_1_0.__showSpeedBoostHint = new ObservedPropertySimplePU(false, local_1_0, "showSpeedBoostHint");
    local_1_0.speedBoostActive = false;
    local_1_0.speedBoostPreviousSpeed = 1;
    local_1_0.speedBoostTarget = 2;
    local_1_0.x_componentController = new XComponentController();
    local_1_0.envService = new PlayerEnvironmentService();
    local_1_0.onFullScreenClick = function () {};
    local_1_0.onRetry = function () {};
    local_1_0.onSurfaceReady = undefined;
    local_1_0.onShowInfoPanel = undefined;
    local_1_0.subtitleDragStartLiftRatio = 0;
    local_1_0.subtitleDragStartOffsetXRatio = 0;
    local_1_0.pinchStartDistanceVp = 0;
    local_1_0.pinchLastMidXVp = 0;
    local_1_0.pinchLastMidYVp = 0;
    local_1_0.pinchStartMidXVp = 0;
    local_1_0.pinchStartMidYVp = 0;
    local_1_0.pinchAppliedScale = 1;
    local_1_0.pinchGestureMode = "undecided";
    local_1_0.hiddenUiSeekOnly = false;
    local_1_0.controlMenuDepth = 0;
    local_1_0.aiTranslateProgressListener = function (p0) {
      if (!p0) {
        local_1_0.aiTranslateProgress = "";
        return;
      }
      local_1_0.aiTranslateProgress = "" + p0.doneBatches + "/" + p0.totalBatches + "";
      return;
    };
    local_1_0.setInitiallyProvidedValue(p1);
    local_1_0.declareWatch("isFullLandscapeScreen", local_1_0.onFullscreenModeChange);
    local_1_0.declareWatch("isPageShow", local_1_0.onPageVisibilityChange);
    local_1_0.declareWatch("isAppBackground", local_1_0.onPageVisibilityChange);
    local_1_0.declareWatch("curSource", local_1_0.onSourceChange);
    local_1_0.declareWatch("curIndex", local_1_0.onIndexChange);
    local_1_0.declareWatch("controller", local_1_0.onControllerChanged);
    local_1_0.finalizeConstruction();
    return local_1_0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.isFullLandscapeScreen === undefined) {
      this.__isFullLandscapeScreen.set(false);
    }
    if (p0.showFullscreenButton === undefined) {
      this.__showFullscreenButton.set(true);
    }
    if (p0.index === undefined) {
      this.__index.set(0);
    }
    if (p0.chapters === undefined) {
      this.__chapters.set([]);
    }
    if (p0.curIndex === undefined) {
      this.__curIndex.set(CommonConstants.CURINDEX_DEFAULT_NUM);
    }
    if (p0.surfaceWidth !== undefined) {
      this.surfaceWidth = p0.surfaceWidth;
    }
    if (p0.surfaceHeight !== undefined) {
      this.surfaceHeight = p0.surfaceHeight;
    }
    if (p0.containerWidthPX !== undefined) {
      this.containerWidthPX = p0.containerWidthPX;
    }
    if (p0.containerHeightPX !== undefined) {
      this.containerHeightPX = p0.containerHeightPX;
    }
    if (p0.trackThicknessSize !== undefined) {
      this.trackThicknessSize = p0.trackThicknessSize;
    }
    if (p0.lastController !== undefined) {
      this.lastController = p0.lastController;
    }
    if (p0.hasStreams !== undefined) {
      this.hasStreams = p0.hasStreams;
    }
    if (p0.hasError !== undefined) {
      this.hasError = p0.hasError;
    }
    if (p0.playbackStarted !== undefined) {
      this.playbackStarted = p0.playbackStarted;
    }
    if (p0.isWaitingForDualBuffer !== undefined) {
      this.isWaitingForDualBuffer = p0.isWaitingForDualBuffer;
    }
    if (p0.currentTime !== undefined) {
      this.currentTime = p0.currentTime;
    }
    if (p0.durationTime !== undefined) {
      this.durationTime = p0.durationTime;
    }
    if (p0.keepScreenListener !== undefined) {
      this.keepScreenListener = p0.keepScreenListener;
    }
    if (p0.progressListener !== undefined) {
      this.progressListener = p0.progressListener;
    }
    if (p0.playbackStateListener !== undefined) {
      this.playbackStateListener = p0.playbackStateListener;
    }
    if (p0.lastLoggedError !== undefined) {
      this.lastLoggedError = p0.lastLoggedError;
    }
    if (p0.errorListener !== undefined) {
      this.errorListener = p0.errorListener;
    }
    if (p0.waitingForBufferListener !== undefined) {
      this.waitingForBufferListener = p0.waitingForBufferListener;
    }
    if (p0.sliderStyle !== undefined) {
      this.sliderStyle = p0.sliderStyle;
    }
    if (p0.isSliderDragging !== undefined) {
      this.isSliderDragging = p0.isSliderDragging;
    }
    if (p0.sliderDragValue !== undefined) {
      this.sliderDragValue = p0.sliderDragValue;
    }
    if (p0.sliderTouchCanceled !== undefined) {
      this.sliderTouchCanceled = p0.sliderTouchCanceled;
    }
    if (p0.showControls !== undefined) {
      this.showControls = p0.showControls;
    }
    if (p0.controlsHideTimerId !== undefined) {
      this.controlsHideTimerId = p0.controlsHideTimerId;
    }
    if (p0.containerVpWidth !== undefined) {
      this.containerVpWidth = p0.containerVpWidth;
    }
    if (p0.containerVpHeight !== undefined) {
      this.containerVpHeight = p0.containerVpHeight;
    }
    if (p0.subtitleDragLiftRatio !== undefined) {
      this.subtitleDragLiftRatio = p0.subtitleDragLiftRatio;
    }
    if (p0.subtitleDragOffsetXRatio !== undefined) {
      this.subtitleDragOffsetXRatio = p0.subtitleDragOffsetXRatio;
    }
    if (p0.aiTranslateProgress !== undefined) {
      this.aiTranslateProgress = p0.aiTranslateProgress;
    }
    if (p0.aiCaptionShown !== undefined) {
      this.aiCaptionShown = p0.aiCaptionShown;
    }
    if (p0.subtitleDragging !== undefined) {
      this.subtitleDragging = p0.subtitleDragging;
    }
    if (p0.aiCaptionController !== undefined) {
      this.aiCaptionController = p0.aiCaptionController;
    }
    if (p0.aiCaptionOptions !== undefined) {
      this.aiCaptionOptions = p0.aiCaptionOptions;
    }
    if (p0.aiCaptionSupported !== undefined) {
      this.aiCaptionSupported = p0.aiCaptionSupported;
    }
    if (p0.videoAspectMode !== undefined) {
      this.videoAspectMode = p0.videoAspectMode;
    }
    if (p0.videoPinchScale !== undefined) {
      this.videoPinchScale = p0.videoPinchScale;
    }
    if (p0.videoPanXVp !== undefined) {
      this.videoPanXVp = p0.videoPanXVp;
    }
    if (p0.videoPanYVp !== undefined) {
      this.videoPanYVp = p0.videoPanYVp;
    }
    if (p0.videoPinching !== undefined) {
      this.videoPinching = p0.videoPinching;
    }
    if (p0.pinchStartScale !== undefined) {
      this.pinchStartScale = p0.pinchStartScale;
    }
    if (p0.bottomControlBarVpH !== undefined) {
      this.bottomControlBarVpH = p0.bottomControlBarVpH;
    }
    if (p0.isGestureSeek !== undefined) {
      this.isGestureSeek = p0.isGestureSeek;
    }
    if (p0.gestureSeekTime !== undefined) {
      this.gestureSeekTime = p0.gestureSeekTime;
    }
    if (p0.gestureSeekStartTime !== undefined) {
      this.gestureSeekStartTime = p0.gestureSeekStartTime;
    }
    if (p0.panEndTime !== undefined) {
      this.panEndTime = p0.panEndTime;
    }
    if (p0.gestureMode !== undefined) {
      this.gestureMode = p0.gestureMode;
    }
    if (p0.activeInteraction !== undefined) {
      this.activeInteraction = p0.activeInteraction;
    }
    if (p0.gestureStartX !== undefined) {
      this.gestureStartX = p0.gestureStartX;
    }
    if (p0.gestureStartY !== undefined) {
      this.gestureStartY = p0.gestureStartY;
    }
    if (p0.interactionEpoch !== undefined) {
      this.interactionEpoch = p0.interactionEpoch;
    }
    if (p0.seekHintHideTimerId !== undefined) {
      this.seekHintHideTimerId = p0.seekHintHideTimerId;
    }
    if (p0.lastTapAtMs !== undefined) {
      this.lastTapAtMs = p0.lastTapAtMs;
    }
    if (p0.pendingSingleTapTimerId !== undefined) {
      this.pendingSingleTapTimerId = p0.pendingSingleTapTimerId;
    }
    if (p0.showBrightnessHint !== undefined) {
      this.showBrightnessHint = p0.showBrightnessHint;
    }
    if (p0.showVolumeHint !== undefined) {
      this.showVolumeHint = p0.showVolumeHint;
    }
    if (p0.gestureBrightnessValue !== undefined) {
      this.gestureBrightnessValue = p0.gestureBrightnessValue;
    }
    if (p0.gestureVolumeValue !== undefined) {
      this.gestureVolumeValue = p0.gestureVolumeValue;
    }
    if (p0.gestureBrightnessIcon !== undefined) {
      this.gestureBrightnessIcon = p0.gestureBrightnessIcon;
    }
    if (p0.gestureVolumeIcon !== undefined) {
      this.gestureVolumeIcon = p0.gestureVolumeIcon;
    }
    if (p0.gestureInitValue !== undefined) {
      this.gestureInitValue = p0.gestureInitValue;
    }
    if (p0.maxVolume !== undefined) {
      this.maxVolume = p0.maxVolume;
    }
    if (p0.volHideTimerId !== undefined) {
      this.volHideTimerId = p0.volHideTimerId;
    }
    if (p0.brightnessHideTimerId !== undefined) {
      this.brightnessHideTimerId = p0.brightnessHideTimerId;
    }
    if (p0.cacheCanvasSettings !== undefined) {
      this.cacheCanvasSettings = p0.cacheCanvasSettings;
    }
    if (p0.cacheCanvasCtx !== undefined) {
      this.cacheCanvasCtx = p0.cacheCanvasCtx;
    }
    if (p0.seekableRangesListener !== undefined) {
      this.seekableRangesListener = p0.seekableRangesListener;
    }
    if (p0.showForwardHint !== undefined) {
      this.showForwardHint = p0.showForwardHint;
    }
    if (p0.showBackwardHint !== undefined) {
      this.showBackwardHint = p0.showBackwardHint;
    }
    if (p0.forwardHintTimerId !== undefined) {
      this.forwardHintTimerId = p0.forwardHintTimerId;
    }
    if (p0.backwardHintTimerId !== undefined) {
      this.backwardHintTimerId = p0.backwardHintTimerId;
    }
    if (p0.showSpeedBoostHint !== undefined) {
      this.showSpeedBoostHint = p0.showSpeedBoostHint;
    }
    if (p0.speedBoostActive !== undefined) {
      this.speedBoostActive = p0.speedBoostActive;
    }
    if (p0.speedBoostPreviousSpeed !== undefined) {
      this.speedBoostPreviousSpeed = p0.speedBoostPreviousSpeed;
    }
    if (p0.speedBoostTarget !== undefined) {
      this.speedBoostTarget = p0.speedBoostTarget;
    }
    if (p0.x_componentController !== undefined) {
      this.x_componentController = p0.x_componentController;
    }
    if (p0.envService !== undefined) {
      this.envService = p0.envService;
    }
    if (p0.onFullScreenClick !== undefined) {
      this.onFullScreenClick = p0.onFullScreenClick;
    }
    if (p0.onRetry !== undefined) {
      this.onRetry = p0.onRetry;
    }
    if (p0.onSurfaceReady !== undefined) {
      this.onSurfaceReady = p0.onSurfaceReady;
    }
    if (p0.onShowInfoPanel !== undefined) {
      this.onShowInfoPanel = p0.onShowInfoPanel;
    }
    if (p0.subtitleDragStartLiftRatio !== undefined) {
      this.subtitleDragStartLiftRatio = p0.subtitleDragStartLiftRatio;
    }
    if (p0.subtitleDragStartOffsetXRatio !== undefined) {
      this.subtitleDragStartOffsetXRatio = p0.subtitleDragStartOffsetXRatio;
    }
    if (p0.pinchStartDistanceVp !== undefined) {
      this.pinchStartDistanceVp = p0.pinchStartDistanceVp;
    }
    if (p0.pinchLastMidXVp !== undefined) {
      this.pinchLastMidXVp = p0.pinchLastMidXVp;
    }
    if (p0.pinchLastMidYVp !== undefined) {
      this.pinchLastMidYVp = p0.pinchLastMidYVp;
    }
    if (p0.pinchStartMidXVp !== undefined) {
      this.pinchStartMidXVp = p0.pinchStartMidXVp;
    }
    if (p0.pinchStartMidYVp !== undefined) {
      this.pinchStartMidYVp = p0.pinchStartMidYVp;
    }
    if (p0.pinchAppliedScale !== undefined) {
      this.pinchAppliedScale = p0.pinchAppliedScale;
    }
    if (p0.pinchGestureMode !== undefined) {
      this.pinchGestureMode = p0.pinchGestureMode;
    }
    if (p0.hiddenUiSeekOnly !== undefined) {
      this.hiddenUiSeekOnly = p0.hiddenUiSeekOnly;
    }
    if (p0.controlMenuDepth !== undefined) {
      this.controlMenuDepth = p0.controlMenuDepth;
    }
    if (p0.aiTranslateProgressListener !== undefined) {
      this.aiTranslateProgressListener = p0.aiTranslateProgressListener;
    }
  }
  updateStateVars(p0) {
    this.__isFullLandscapeScreen.reset(p0.isFullLandscapeScreen);
    this.__showFullscreenButton.reset(p0.showFullscreenButton);
    this.__index.reset(p0.index);
    this.__chapters.reset(p0.chapters);
    this.__curIndex.reset(p0.curIndex);
  }
  purgeVariableDependenciesOnElmtId(p0) {
    this.__themePrimary.purgeDependencyOnElmtId(p0);
    this.__uiConfig.purgeDependencyOnElmtId(p0);
    this.__actionHub.purgeDependencyOnElmtId(p0);
    this.__navBarHeight.purgeDependencyOnElmtId(p0);
    this.__statusBarHeight.purgeDependencyOnElmtId(p0);
    this.__playerGestureSafeTop.purgeDependencyOnElmtId(p0);
    this.__playerGestureSafeBottom.purgeDependencyOnElmtId(p0);
    this.__playerGestureSafeLeft.purgeDependencyOnElmtId(p0);
    this.__playerGestureSafeRight.purgeDependencyOnElmtId(p0);
    this.__playerControlAvoidTop.purgeDependencyOnElmtId(p0);
    this.__playerControlAvoidBottom.purgeDependencyOnElmtId(p0);
    this.__playerControlAvoidLeft.purgeDependencyOnElmtId(p0);
    this.__playerControlAvoidRight.purgeDependencyOnElmtId(p0);
    this.__safeAreaTop.purgeDependencyOnElmtId(p0);
    this.__currentColorMode.purgeDependencyOnElmtId(p0);
    this.__isFullLandscapeScreen.purgeDependencyOnElmtId(p0);
    this.__showFullscreenButton.purgeDependencyOnElmtId(p0);
    this.__isPageShow.purgeDependencyOnElmtId(p0);
    this.__isAppBackground.purgeDependencyOnElmtId(p0);
    this.__isAudioOnlyMode.purgeDependencyOnElmtId(p0);
    this.__isLocalMode.purgeDependencyOnElmtId(p0);
    this.__playbackConfig.purgeDependencyOnElmtId(p0);
    this.__selectedVideo.purgeDependencyOnElmtId(p0);
    this.__index.purgeDependencyOnElmtId(p0);
    this.__curSource.purgeDependencyOnElmtId(p0);
    this.__chapters.purgeDependencyOnElmtId(p0);
    this.__curIndex.purgeDependencyOnElmtId(p0);
    this.__surfaceWidth.purgeDependencyOnElmtId(p0);
    this.__surfaceHeight.purgeDependencyOnElmtId(p0);
    this.__containerWidthPX.purgeDependencyOnElmtId(p0);
    this.__containerHeightPX.purgeDependencyOnElmtId(p0);
    this.__trackThicknessSize.purgeDependencyOnElmtId(p0);
    this.__controller.purgeDependencyOnElmtId(p0);
    this.__vm.purgeDependencyOnElmtId(p0);
    this.__hasStreams.purgeDependencyOnElmtId(p0);
    this.__hasError.purgeDependencyOnElmtId(p0);
    this.__playbackStarted.purgeDependencyOnElmtId(p0);
    this.__isWaitingForDualBuffer.purgeDependencyOnElmtId(p0);
    this.__currentTime.purgeDependencyOnElmtId(p0);
    this.__durationTime.purgeDependencyOnElmtId(p0);
    this.__sliderStyle.purgeDependencyOnElmtId(p0);
    this.__isSliderDragging.purgeDependencyOnElmtId(p0);
    this.__sliderDragValue.purgeDependencyOnElmtId(p0);
    this.__showControls.purgeDependencyOnElmtId(p0);
    this.__containerVpWidth.purgeDependencyOnElmtId(p0);
    this.__containerVpHeight.purgeDependencyOnElmtId(p0);
    this.__subtitleDragLiftRatio.purgeDependencyOnElmtId(p0);
    this.__subtitleDragOffsetXRatio.purgeDependencyOnElmtId(p0);
    this.__aiTranslateProgress.purgeDependencyOnElmtId(p0);
    this.__aiCaptionShown.purgeDependencyOnElmtId(p0);
    this.__subtitleDragging.purgeDependencyOnElmtId(p0);
    this.__videoAspectMode.purgeDependencyOnElmtId(p0);
    this.__videoPinchScale.purgeDependencyOnElmtId(p0);
    this.__videoPanXVp.purgeDependencyOnElmtId(p0);
    this.__videoPanYVp.purgeDependencyOnElmtId(p0);
    this.__bottomControlBarVpH.purgeDependencyOnElmtId(p0);
    this.__isGestureSeek.purgeDependencyOnElmtId(p0);
    this.__gestureSeekTime.purgeDependencyOnElmtId(p0);
    this.__showBrightnessHint.purgeDependencyOnElmtId(p0);
    this.__showVolumeHint.purgeDependencyOnElmtId(p0);
    this.__gestureBrightnessValue.purgeDependencyOnElmtId(p0);
    this.__gestureVolumeValue.purgeDependencyOnElmtId(p0);
    this.__gestureBrightnessIcon.purgeDependencyOnElmtId(p0);
    this.__gestureVolumeIcon.purgeDependencyOnElmtId(p0);
    this.__showForwardHint.purgeDependencyOnElmtId(p0);
    this.__showBackwardHint.purgeDependencyOnElmtId(p0);
    this.__showSpeedBoostHint.purgeDependencyOnElmtId(p0);
  }
  aboutToBeDeleted() {
    this.__themePrimary.aboutToBeDeleted();
    this.__uiConfig.aboutToBeDeleted();
    this.__actionHub.aboutToBeDeleted();
    this.__navBarHeight.aboutToBeDeleted();
    this.__statusBarHeight.aboutToBeDeleted();
    this.__playerGestureSafeTop.aboutToBeDeleted();
    this.__playerGestureSafeBottom.aboutToBeDeleted();
    this.__playerGestureSafeLeft.aboutToBeDeleted();
    this.__playerGestureSafeRight.aboutToBeDeleted();
    this.__playerControlAvoidTop.aboutToBeDeleted();
    this.__playerControlAvoidBottom.aboutToBeDeleted();
    this.__playerControlAvoidLeft.aboutToBeDeleted();
    this.__playerControlAvoidRight.aboutToBeDeleted();
    this.__safeAreaTop.aboutToBeDeleted();
    this.__currentColorMode.aboutToBeDeleted();
    this.__isFullLandscapeScreen.aboutToBeDeleted();
    this.__showFullscreenButton.aboutToBeDeleted();
    this.__isPageShow.aboutToBeDeleted();
    this.__isAppBackground.aboutToBeDeleted();
    this.__isAudioOnlyMode.aboutToBeDeleted();
    this.__isLocalMode.aboutToBeDeleted();
    this.__playbackConfig.aboutToBeDeleted();
    this.__selectedVideo.aboutToBeDeleted();
    this.__index.aboutToBeDeleted();
    this.__curSource.aboutToBeDeleted();
    this.__chapters.aboutToBeDeleted();
    this.__curIndex.aboutToBeDeleted();
    this.__surfaceWidth.aboutToBeDeleted();
    this.__surfaceHeight.aboutToBeDeleted();
    this.__containerWidthPX.aboutToBeDeleted();
    this.__containerHeightPX.aboutToBeDeleted();
    this.__trackThicknessSize.aboutToBeDeleted();
    this.__controller.aboutToBeDeleted();
    this.__vm.aboutToBeDeleted();
    this.__hasStreams.aboutToBeDeleted();
    this.__hasError.aboutToBeDeleted();
    this.__playbackStarted.aboutToBeDeleted();
    this.__isWaitingForDualBuffer.aboutToBeDeleted();
    this.__currentTime.aboutToBeDeleted();
    this.__durationTime.aboutToBeDeleted();
    this.__sliderStyle.aboutToBeDeleted();
    this.__isSliderDragging.aboutToBeDeleted();
    this.__sliderDragValue.aboutToBeDeleted();
    this.__showControls.aboutToBeDeleted();
    this.__containerVpWidth.aboutToBeDeleted();
    this.__containerVpHeight.aboutToBeDeleted();
    this.__subtitleDragLiftRatio.aboutToBeDeleted();
    this.__subtitleDragOffsetXRatio.aboutToBeDeleted();
    this.__aiTranslateProgress.aboutToBeDeleted();
    this.__aiCaptionShown.aboutToBeDeleted();
    this.__subtitleDragging.aboutToBeDeleted();
    this.__videoAspectMode.aboutToBeDeleted();
    this.__videoPinchScale.aboutToBeDeleted();
    this.__videoPanXVp.aboutToBeDeleted();
    this.__videoPanYVp.aboutToBeDeleted();
    this.__bottomControlBarVpH.aboutToBeDeleted();
    this.__isGestureSeek.aboutToBeDeleted();
    this.__gestureSeekTime.aboutToBeDeleted();
    this.__showBrightnessHint.aboutToBeDeleted();
    this.__showVolumeHint.aboutToBeDeleted();
    this.__gestureBrightnessValue.aboutToBeDeleted();
    this.__gestureVolumeValue.aboutToBeDeleted();
    this.__gestureBrightnessIcon.aboutToBeDeleted();
    this.__gestureVolumeIcon.aboutToBeDeleted();
    this.__showForwardHint.aboutToBeDeleted();
    this.__showBackwardHint.aboutToBeDeleted();
    this.__showSpeedBoostHint.aboutToBeDeleted();
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  get themePrimary() {
    return this.__themePrimary.get();
  }
  set themePrimary(p0) {
    this.__themePrimary.set(p0);
  }
  get uiConfig() {
    return this.__uiConfig.get();
  }
  set uiConfig(p0) {
    this.__uiConfig.set(p0);
  }
  get actionHub() {
    return this.__actionHub.get();
  }
  set actionHub(p0) {
    this.__actionHub.set(p0);
  }
  get navBarHeight() {
    return this.__navBarHeight.get();
  }
  set navBarHeight(p0) {
    this.__navBarHeight.set(p0);
  }
  get statusBarHeight() {
    return this.__statusBarHeight.get();
  }
  set statusBarHeight(p0) {
    this.__statusBarHeight.set(p0);
  }
  get playerGestureSafeTop() {
    return this.__playerGestureSafeTop.get();
  }
  set playerGestureSafeTop(p0) {
    this.__playerGestureSafeTop.set(p0);
  }
  get playerGestureSafeBottom() {
    return this.__playerGestureSafeBottom.get();
  }
  set playerGestureSafeBottom(p0) {
    this.__playerGestureSafeBottom.set(p0);
  }
  get playerGestureSafeLeft() {
    return this.__playerGestureSafeLeft.get();
  }
  set playerGestureSafeLeft(p0) {
    this.__playerGestureSafeLeft.set(p0);
  }
  get playerGestureSafeRight() {
    return this.__playerGestureSafeRight.get();
  }
  set playerGestureSafeRight(p0) {
    this.__playerGestureSafeRight.set(p0);
  }
  get playerControlAvoidTop() {
    return this.__playerControlAvoidTop.get();
  }
  set playerControlAvoidTop(p0) {
    this.__playerControlAvoidTop.set(p0);
  }
  get playerControlAvoidBottom() {
    return this.__playerControlAvoidBottom.get();
  }
  set playerControlAvoidBottom(p0) {
    this.__playerControlAvoidBottom.set(p0);
  }
  get playerControlAvoidLeft() {
    return this.__playerControlAvoidLeft.get();
  }
  set playerControlAvoidLeft(p0) {
    this.__playerControlAvoidLeft.set(p0);
  }
  get playerControlAvoidRight() {
    return this.__playerControlAvoidRight.get();
  }
  set playerControlAvoidRight(p0) {
    this.__playerControlAvoidRight.set(p0);
  }
  get safeAreaTop() {
    return this.__safeAreaTop.get();
  }
  set safeAreaTop(p0) {
    this.__safeAreaTop.set(p0);
  }
  get currentColorMode() {
    return this.__currentColorMode.get();
  }
  set currentColorMode(p0) {
    this.__currentColorMode.set(p0);
  }
  get isFullLandscapeScreen() {
    return this.__isFullLandscapeScreen.get();
  }
  set isFullLandscapeScreen(p0) {
    this.__isFullLandscapeScreen.set(p0);
  }
  get showFullscreenButton() {
    return this.__showFullscreenButton.get();
  }
  set showFullscreenButton(p0) {
    this.__showFullscreenButton.set(p0);
  }
  get isPageShow() {
    return this.__isPageShow.get();
  }
  set isPageShow(p0) {
    this.__isPageShow.set(p0);
  }
  get isAppBackground() {
    return this.__isAppBackground.get();
  }
  set isAppBackground(p0) {
    this.__isAppBackground.set(p0);
  }
  get isAudioOnlyMode() {
    return this.__isAudioOnlyMode.get();
  }
  set isAudioOnlyMode(p0) {
    this.__isAudioOnlyMode.set(p0);
  }
  get isLocalMode() {
    return this.__isLocalMode.get();
  }
  set isLocalMode(p0) {
    this.__isLocalMode.set(p0);
  }
  get playbackConfig() {
    return this.__playbackConfig.get();
  }
  set playbackConfig(p0) {
    this.__playbackConfig.set(p0);
  }
  get selectedVideo() {
    return this.__selectedVideo.get();
  }
  set selectedVideo(p0) {
    this.__selectedVideo.set(p0);
  }
  get index() {
    return this.__index.get();
  }
  set index(p0) {
    this.__index.set(p0);
  }
  get curSource() {
    return this.__curSource.get();
  }
  set curSource(p0) {
    this.__curSource.set(p0);
  }
  get chapters() {
    return this.__chapters.get();
  }
  set chapters(p0) {
    this.__chapters.set(p0);
  }
  get curIndex() {
    return this.__curIndex.get();
  }
  set curIndex(p0) {
    this.__curIndex.set(p0);
  }
  get surfaceWidth() {
    return this.__surfaceWidth.get();
  }
  set surfaceWidth(p0) {
    this.__surfaceWidth.set(p0);
  }
  get surfaceHeight() {
    return this.__surfaceHeight.get();
  }
  set surfaceHeight(p0) {
    this.__surfaceHeight.set(p0);
  }
  get containerWidthPX() {
    return this.__containerWidthPX.get();
  }
  set containerWidthPX(p0) {
    this.__containerWidthPX.set(p0);
  }
  get containerHeightPX() {
    return this.__containerHeightPX.get();
  }
  set containerHeightPX(p0) {
    this.__containerHeightPX.set(p0);
  }
  get trackThicknessSize() {
    return this.__trackThicknessSize.get();
  }
  set trackThicknessSize(p0) {
    this.__trackThicknessSize.set(p0);
  }
  get controller() {
    return this.__controller.get();
  }
  set controller(p0) {
    this.__controller.set(p0);
  }
  get vm() {
    return this.__vm.get();
  }
  set vm(p0) {
    this.__vm.set(p0);
  }
  get hasStreams() {
    return this.__hasStreams.get();
  }
  set hasStreams(p0) {
    this.__hasStreams.set(p0);
  }
  get hasError() {
    return this.__hasError.get();
  }
  set hasError(p0) {
    this.__hasError.set(p0);
  }
  get playbackStarted() {
    return this.__playbackStarted.get();
  }
  set playbackStarted(p0) {
    this.__playbackStarted.set(p0);
  }
  get isWaitingForDualBuffer() {
    return this.__isWaitingForDualBuffer.get();
  }
  set isWaitingForDualBuffer(p0) {
    this.__isWaitingForDualBuffer.set(p0);
  }
  get currentTime() {
    return this.__currentTime.get();
  }
  set currentTime(p0) {
    this.__currentTime.set(p0);
  }
  get durationTime() {
    return this.__durationTime.get();
  }
  set durationTime(p0) {
    this.__durationTime.set(p0);
  }
  get sliderStyle() {
    return this.__sliderStyle.get();
  }
  set sliderStyle(p0) {
    this.__sliderStyle.set(p0);
  }
  get isSliderDragging() {
    return this.__isSliderDragging.get();
  }
  set isSliderDragging(p0) {
    this.__isSliderDragging.set(p0);
  }
  get sliderDragValue() {
    return this.__sliderDragValue.get();
  }
  set sliderDragValue(p0) {
    this.__sliderDragValue.set(p0);
  }
  get showControls() {
    return this.__showControls.get();
  }
  set showControls(p0) {
    this.__showControls.set(p0);
  }
  get containerVpWidth() {
    return this.__containerVpWidth.get();
  }
  set containerVpWidth(p0) {
    this.__containerVpWidth.set(p0);
  }
  get containerVpHeight() {
    return this.__containerVpHeight.get();
  }
  set containerVpHeight(p0) {
    this.__containerVpHeight.set(p0);
  }
  get subtitleDragLiftRatio() {
    return this.__subtitleDragLiftRatio.get();
  }
  set subtitleDragLiftRatio(p0) {
    this.__subtitleDragLiftRatio.set(p0);
  }
  get subtitleDragOffsetXRatio() {
    return this.__subtitleDragOffsetXRatio.get();
  }
  set subtitleDragOffsetXRatio(p0) {
    this.__subtitleDragOffsetXRatio.set(p0);
  }
  get aiTranslateProgress() {
    return this.__aiTranslateProgress.get();
  }
  set aiTranslateProgress(p0) {
    this.__aiTranslateProgress.set(p0);
  }
  get aiCaptionShown() {
    return this.__aiCaptionShown.get();
  }
  set aiCaptionShown(p0) {
    this.__aiCaptionShown.set(p0);
  }
  get subtitleDragging() {
    return this.__subtitleDragging.get();
  }
  set subtitleDragging(p0) {
    this.__subtitleDragging.set(p0);
  }
  get videoAspectMode() {
    return this.__videoAspectMode.get();
  }
  set videoAspectMode(p0) {
    this.__videoAspectMode.set(p0);
  }
  get videoPinchScale() {
    return this.__videoPinchScale.get();
  }
  set videoPinchScale(p0) {
    this.__videoPinchScale.set(p0);
  }
  get videoPanXVp() {
    return this.__videoPanXVp.get();
  }
  set videoPanXVp(p0) {
    this.__videoPanXVp.set(p0);
  }
  get videoPanYVp() {
    return this.__videoPanYVp.get();
  }
  set videoPanYVp(p0) {
    this.__videoPanYVp.set(p0);
  }
  get bottomControlBarVpH() {
    return this.__bottomControlBarVpH.get();
  }
  set bottomControlBarVpH(p0) {
    this.__bottomControlBarVpH.set(p0);
  }
  get isGestureSeek() {
    return this.__isGestureSeek.get();
  }
  set isGestureSeek(p0) {
    this.__isGestureSeek.set(p0);
  }
  get gestureSeekTime() {
    return this.__gestureSeekTime.get();
  }
  set gestureSeekTime(p0) {
    this.__gestureSeekTime.set(p0);
  }
  get showBrightnessHint() {
    return this.__showBrightnessHint.get();
  }
  set showBrightnessHint(p0) {
    this.__showBrightnessHint.set(p0);
  }
  get showVolumeHint() {
    return this.__showVolumeHint.get();
  }
  set showVolumeHint(p0) {
    this.__showVolumeHint.set(p0);
  }
  get gestureBrightnessValue() {
    return this.__gestureBrightnessValue.get();
  }
  set gestureBrightnessValue(p0) {
    this.__gestureBrightnessValue.set(p0);
  }
  get gestureVolumeValue() {
    return this.__gestureVolumeValue.get();
  }
  set gestureVolumeValue(p0) {
    this.__gestureVolumeValue.set(p0);
  }
  get gestureBrightnessIcon() {
    return this.__gestureBrightnessIcon.get();
  }
  set gestureBrightnessIcon(p0) {
    this.__gestureBrightnessIcon.set(p0);
  }
  get gestureVolumeIcon() {
    return this.__gestureVolumeIcon.get();
  }
  set gestureVolumeIcon(p0) {
    this.__gestureVolumeIcon.set(p0);
  }
  get showForwardHint() {
    return this.__showForwardHint.get();
  }
  set showForwardHint(p0) {
    this.__showForwardHint.set(p0);
  }
  get showBackwardHint() {
    return this.__showBackwardHint.get();
  }
  set showBackwardHint(p0) {
    this.__showBackwardHint.set(p0);
  }
  get showSpeedBoostHint() {
    return this.__showSpeedBoostHint.get();
  }
  set showSpeedBoostHint(p0) {
    this.__showSpeedBoostHint.set(p0);
  }
  _onKeepScreenStateChanged(p0) {
    this.envService.setKeepScreenOn(p0 === PlayerState.PLAYING || p0 === PlayerState.BUFFERING || p0 === PlayerState.READY);
    if (p0 === PlayerState.PLAYING || p0 === PlayerState.BUFFERING) {
      this.scheduleHideControls();
    } else {
      this.clearHideTimer();
      this.showControls = true;
    }
  }
  syncPlaybackStateFromController() {
    if (!this.controller) {
      return;
    }
    this.currentTime = this.vm.currentTime;
    this.durationTime = this.vm.durationTime;
    return;
  }
  getErrorDisplay(p0) {
    let v4, v5;
    v4 = this.getUIContext().getHostContext();
    if (!p0) {
      return v4 ? "[Player] " + v4.resourceManager.getStringSync({
        "id": 16777658,
        "type": 10003,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      }.id) : "[Player] Playback error, please retry";
    }
    if (!v4) {
      return p0;
    }
    v5 = p0.match(new RegExp("^\\[(API|PLAYER)\\]\\s*(.+)"));
    if (v5) {
      try {
        if (v5[1] !== "API") {
          return p0;
        }
        if (v5[2] === "NO_PLAYABLE_STREAM") {
          return "[API] " + v4.resourceManager.getStringSync({
            "id": 16777654,
            "type": 10003,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          }.id);
        }
        if (v5[2] === "NO_SUPPORTED_STREAM") {
          return "[API] " + v4.resourceManager.getStringSync({
            "id": 16777655,
            "type": 10003,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          }.id);
        }
        return p0;
      } catch (catchAcc) {
        Logger.warn(local_0_1 /*TAG*/, "getErrorDisplay localization failed: " + catchAcc + "");
        return p0;
      }
    } else if (p0 === "NO_PLAYABLE_STREAM") {
      return "[API] " + v4.resourceManager.getStringSync({
        "id": 16777654,
        "type": 10003,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      }.id);
    } else if (p0 === "NO_SUPPORTED_STREAM") {
      return "[API] " + v4.resourceManager.getStringSync({
        "id": 16777655,
        "type": 10003,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      }.id);
    } else {
      return p0;
    }
  }
  onSourceChange() {
    this.resetTransientUi("source-change");
    this.hasStreams = !!(this.curSource.streams && this.curSource.streams.length > 0);
    this.playbackStarted = false;
    this.syncPlaybackStateFromController();
    this.calculateSurfaceSize();
  }
  onControllerChanged() {
    let v5, acc;
    this.resetTransientUi("controller-change");
    if (this.lastController && this.lastController !== this.controller) {
      this.lastController.unsubscribeProgress(this.progressListener);
      this.lastController.unsubscribePlaybackState(this.playbackStateListener);
      this.lastController.removeErrorListener(this.errorListener);
      this.lastController.removeWaitingForBufferListener(this.waitingForBufferListener);
      this.lastController.removeSeekableRangesListener(this.seekableRangesListener);
    }
    if (this.controller) {
      this.controller.subscribeProgress(this.progressListener);
      this.controller.subscribePlaybackState(this.playbackStateListener);
      this.controller.addErrorListener(this.errorListener);
      this.controller.addWaitingForBufferListener(this.waitingForBufferListener);
      this.controller.addSeekableRangesListener(this.seekableRangesListener);
      this.currentTime = this.vm.currentTime;
      this.durationTime = this.vm.durationTime;
      this.hasError = this.vm.userVisibleErrorMsg.length > 0;
      this.hasStreams = this.vm.playerModel
        && this.vm.playerModel.categorizedStreams.audio.length + this.vm.playerModel.categorizedStreams.video.length + this.vm.playerModel.categorizedStreams.dashManifest.length + this.vm.playerModel.categorizedStreams.hlsManifest.length + this.vm.playerModel.categorizedStreams.progressive.length > 0;
      this.syncPlaybackStateFromController();
      this.playbackStateListener(this.controller.getPlaybackState());
      try {
        acc = !!this.controller.surfaceID;
        if (!acc && (v5 = this.x_componentController.getXComponentSurfaceId(), acc)) {
          this.controller.setSurfaceID(v5);
          Logger.debug(local_0_1 /*TAG*/, "SurfaceID re-injected after controller change: " + v5 + "");
        }
      } catch (catchAcc) {}
    }
    this.lastController = this.controller;
  }
  onPageVisibilityChange() {
    let v4, v6, acc;
    v4 = PlayerSession.getInstance();
    acc = this.isPageShow && !this.isAppBackground;
    PlayerPresentation.onPlayerPageVisibility(acc);
    acc = !acc;
    if (acc) {
      this.resetTransientUi("page-hidden");
      return;
    }
    if (v4.playerState === PlayerState.RELEASED) {
      v4.ensureInitialized().catch(function () {});
    }
    if (!this.controller.surfaceID) {
      try {
        v6 = this.x_componentController.getXComponentSurfaceId();
        if (v6) {
          this.controller.setSurfaceID(v6);
          Logger.info(local_0_1 /*TAG*/, "SurfaceID re-bound on visibility change: " + v6 + "");
        }
      } catch (catchAcc) {
        Logger.warn(local_0_1 /*TAG*/, "Failed to get surfaceId on visibility change");
      }
    }
    this.syncPlaybackStateFromController();
    this.showControls = true;
    this.scheduleHideControls();
    return;
  }
  aboutToAppear() {
    let v3, v11, acc;
    v3 = this.getUIContext().getHostContext();
    this.vm.errorMsg = "";
    this.hasError = false;
    this.isWaitingForDualBuffer = false;
    this.curSource.error = undefined;
    this.initializePlayerEnvironment(v3);
    try {
      this.aiCaptionSupported = canIUse("SystemCapability.AI.AICaption");
    } catch (catchAcc) {
      this.aiCaptionSupported = false;
    }
    if (this.aiCaptionSupported) {
      if (!this.aiCaptionOptions) {
        acc = this.playbackConfig.systemAiCaptionSource === "zh" ? "zh" : "en";
        v11 = {
          "initialOpacity": 1,
          "onPrepared": function () {
            Logger.info(local_0_1 /*TAG*/, "AICaption prepared");
          },
          "onError": function (p0) {
            Logger.warn(local_0_1 /*TAG*/, "AICaption error code=" + p0.code + " msg=" + p0.message + "");
          }
        };
        if (deviceInfo.sdkApiVersion >= 24) {
          v11.sourceLanguage = acc;
          v11.targetLanguage = acc === "en" ? "zh-en" : "zh";
        }
        this.aiCaptionOptions = v11;
      }
    }
    this.aiCaptionShown = this.playbackConfig.systemAiCaption && this.aiCaptionSupported;
    this.controller.subscribeProgress(this.progressListener);
    this.controller.subscribePlaybackState(this.playbackStateListener);
    this.controller.addErrorListener(this.errorListener);
    this.controller.addWaitingForBufferListener(this.waitingForBufferListener);
    this.controller.addSeekableRangesListener(this.seekableRangesListener);
    SubtitleTranslationService.getInstance().addProgressListener(this.aiTranslateProgressListener);
    this.controller.addStateListener(this.keepScreenListener);
    this.envService.setKeepScreenOn(this.vm.isPlaying || this.vm.isBuffering);
    PiPManager.getInstance().updatePlayPauseStatus(this.vm.isPlaying);
    this.hasStreams = !!(this.curSource.streams && this.curSource.streams.length > 0);
    this.calculateSurfaceSize();
    PlayerSession.getInstance().ensureInitialized().catch(function (p0) {
      Logger.warn(local_0_1 /*TAG*/, "Deferred engine initialization failed: " + (p0.message || p0) + "");
    });
    PiPManager.getInstance().setComponentController(this.x_componentController);
    this.envService.subscribeScreenEvents(function () {}, function () {
      Logger.info(local_0_1 /*TAG*/, "Screen on → keep current playback intent");
    });
  }
  async initializePlayerEnvironment(p0) {
    let v6;
    try {
      await this.envService.init(p0);
      this.gestureBrightnessValue = await this.envService.getBrightness(p0);
      v6 = this.envService.getVolume();
      this.gestureVolumeValue = v6.volume / v6.maxVolume;
    } catch (catchAcc) {
      Logger.warn(local_0_1 /*TAG*/, "Player environment initialization failed: " + catchAcc + "");
    }
    return undefined;
  }
  drawCacheRanges() {
    let v14, v17, v19;
    this.cacheCanvasCtx.clearRect(0, 0, this.cacheCanvasCtx.width, this.cacheCanvasCtx.height);
    if ((this.durationTime > 0 ? this.vm.seekableRanges.length === 0 : this.durationTime <= 0) || this.cacheCanvasCtx.width <= 0) {
      return;
    }
    this.cacheCanvasCtx.fillStyle = "rgba(255,255,255,0.5)";
    for (v14 of this.vm.seekableRanges) {
      v19 = Math.max(0, v14[0]);
      v17 = Math.min(this.durationTime, v14[1]);
      if (v17 > v19) {
        this.cacheCanvasCtx.fillRect(v19 / this.durationTime * this.cacheCanvasCtx.width, 0, (v17 - v19) / this.durationTime * this.cacheCanvasCtx.width, this.cacheCanvasCtx.height);
      }
    }
    return;
  }
  scheduleHideControls() {
    let local_1_0, local_1_1;
    local_1_1 = this;
    local_1_1.clearHideTimer();
    if (local_1_1.showControls && local_1_1.activeInteraction === local_0_3.NONE && local_1_1.isPageShow && !local_1_1.isAppBackground) {
      if (!local_1_1.canAutoHideControls()) {
        return;
      }
      local_1_0 = local_1_1.interactionEpoch;
      local_1_1.controlsHideTimerId = setTimeout(function () {
        local_1_1.controlsHideTimerId = -1;
        if (local_1_0 /*epoch*/ === local_1_1.interactionEpoch && local_1_1.activeInteraction === local_0_3.NONE && local_1_1.isPageShow && !local_1_1.isAppBackground && local_1_1.canAutoHideControls()) {
          local_1_1.showControls = false;
          local_1_1.clearGestureHints();
        }
      }, local_0_4 /*CONTROLS_HIDE_DELAY*/);
    }
    return;
  }
  clearHideTimer() {
    if (this.controlsHideTimerId >= 0) {
      clearTimeout(this.controlsHideTimerId);
      this.controlsHideTimerId = -1;
    }
  }
  onCenterTap(p0) {
    let v4;
    let local_1_0;
    local_1_0 = this;
    if (local_1_0.activeInteraction !== local_0_3.NONE) {
      return;
    }
    if (local_1_0.isCenterButtonTap(p0)) {
      local_1_0.lastTapAtMs = 0;
      local_1_0.clearPendingSingleTap();
      local_1_0.interactionEpoch = local_1_0.interactionEpoch + 1;
      local_1_0.clearHideTimer();
      local_1_0.scheduleHideControls();
      return;
    }
    v4 = Date.now();
    if (local_1_0.lastTapAtMs > 0 && v4 - local_1_0.lastTapAtMs <= local_0_5 /*DOUBLE_TAP_WINDOW_MS*/) {
      local_1_0.lastTapAtMs = 0;
      local_1_0.clearPendingSingleTap();
      local_1_0.performDoubleTap(p0);
      return;
    }
    local_1_0.lastTapAtMs = v4;
    local_1_0.clearPendingSingleTap();
    local_1_0.pendingSingleTapTimerId = setTimeout(function () {
      local_1_0.pendingSingleTapTimerId = -1;
      local_1_0.lastTapAtMs = 0;
      local_1_0.applySingleTapToggle();
    }, local_0_5 /*DOUBLE_TAP_WINDOW_MS*/);
    return;
  }
  clearPendingSingleTap() {
    if (this.pendingSingleTapTimerId >= 0) {
      clearTimeout(this.pendingSingleTapTimerId);
      this.pendingSingleTapTimerId = -1;
    }
  }
  applySingleTapToggle() {
    this.interactionEpoch = this.interactionEpoch + 1;
    this.clearHideTimer();
    if (!this.canAutoHideControls()) {
      this.showControls = true;
      return;
    }
    this.showControls = !this.showControls;
    if (this.showControls) {
      this.scheduleHideControls();
    } else {
      this.clearHideTimer();
      this.clearGestureHints();
    }
    return;
  }
  performDoubleTap(p0) {
    let v5;
    let local_1_0;
    local_1_0 = this;
    local_1_0.registerDoubleTapActivity();
    if (local_1_0.playbackConfig.doubleTapAction === "off") {
      return;
    }
    if (local_1_0.playbackConfig.doubleTapAction === "playpause") {
      local_1_0.togglePlayback();
      return;
    }
    v5 = local_1_0.playbackConfig.doubleTapSeekSeconds > 0 ? local_1_0.playbackConfig.doubleTapSeekSeconds : 15;
    if (((p0.fingerList[0] !== null && p0.fingerList[0] !== undefined ? p0.fingerList[0].localX : undefined) ?? 0) > local_1_0.containerVpWidth / 2) {
      Logger.info(local_0_1 /*TAG*/, "Double-tap forward +" + v5 + "s");
      local_1_0.controller.syncSeek(Math.min(local_1_0.currentTime + v5, local_1_0.durationTime) * 1000);
      local_1_0.showForwardHint = true;
      local_1_0.forwardHintTimerId = setTimeout(function () {
        local_1_0.forwardHintTimerId = -1;
        local_1_0.showForwardHint = false;
      }, local_0_6 /*DOUBLE_TAP_HINT_HIDE_DELAY*/);
    } else {
      Logger.info(local_0_1 /*TAG*/, "Double-tap backward -" + v5 + "s");
      local_1_0.controller.syncSeek(Math.max(local_1_0.currentTime - v5, 0) * 1000);
      local_1_0.showBackwardHint = true;
      local_1_0.backwardHintTimerId = setTimeout(function () {
        local_1_0.backwardHintTimerId = -1;
        local_1_0.showBackwardHint = false;
      }, local_0_6 /*DOUBLE_TAP_HINT_HIDE_DELAY*/);
    }
    return;
  }
  canAutoHideControls() {
    let v3;
    if (!this.controller || this.hasError) {
      return false;
    }
    v3 = this.controller.getPlaybackState();
    return v3.isPlaying || v3.isBuffering || v3.engineState === "buffering";
  }
  beginInteraction(p0) {
    this.interactionEpoch = this.interactionEpoch + 1;
    this.clearHideTimer();
    this.clearTransientHintTimers();
    this.showBrightnessHint = false;
    this.showVolumeHint = false;
    this.isGestureSeek = false;
    this.showForwardHint = false;
    this.showBackwardHint = false;
    this.activeInteraction = p0;
    this.showControls = true;
  }
  clearTransientHintTimers() {
    if (this.seekHintHideTimerId >= 0) {
      clearTimeout(this.seekHintHideTimerId);
      this.seekHintHideTimerId = -1;
    }
    if (this.volHideTimerId >= 0) {
      clearTimeout(this.volHideTimerId);
      this.volHideTimerId = -1;
    }
    if (this.brightnessHideTimerId >= 0) {
      clearTimeout(this.brightnessHideTimerId);
      this.brightnessHideTimerId = -1;
    }
    if (this.forwardHintTimerId >= 0) {
      clearTimeout(this.forwardHintTimerId);
      this.forwardHintTimerId = -1;
    }
    if (this.backwardHintTimerId >= 0) {
      clearTimeout(this.backwardHintTimerId);
      this.backwardHintTimerId = -1;
    }
    this.clearPendingSingleTap();
  }
  clearGestureHints() {
    this.clearTransientHintTimers();
    this.isGestureSeek = false;
    this.showBrightnessHint = false;
    this.showVolumeHint = false;
    this.showForwardHint = false;
    this.showBackwardHint = false;
    this.showSpeedBoostHint = false;
  }
  resetTransientUi(p0) {
    this.interactionEpoch = this.interactionEpoch + 1;
    this.onHoldSpeedEnd("reset-ui");
    this.clearHideTimer();
    this.clearTransientHintTimers();
    this.gestureMode = local_0_2.IDLE;
    this.activeInteraction = local_0_3.NONE;
    this.isGestureSeek = false;
    this.showBrightnessHint = false;
    this.showVolumeHint = false;
    this.showForwardHint = false;
    this.showBackwardHint = false;
    this.isSliderDragging = false;
    this.subtitleDragging = false;
    this.trackThicknessSize = CommonConstants.TRACK_SIZE_MIN;
    this.sliderStyle = SliderStyle.NONE;
    this.showControls = true;
    Logger.debug(local_0_1 /*TAG*/, "Transient UI reset reason=" + p0 + "");
  }
  videoLayoutVp() {
    if (!(this.containerVpWidth > 0 ? this.containerVpHeight <= 0 : this.containerVpWidth <= 0) && this.curSource.width) {
      if (!this.curSource.height) {
        return {
          "letterboxVp": 0,
          "videoHVp": this.containerVpHeight,
          "videoWVp": this.containerVpWidth
        };
      }
      if (this.curSource.width / this.curSource.height > this.containerVpWidth / this.containerVpHeight) {
        return {
          "letterboxVp": (this.containerVpHeight - this.containerVpWidth / (this.curSource.width / this.curSource.height)) / 2,
          "videoHVp": this.containerVpWidth / (this.curSource.width / this.curSource.height),
          "videoWVp": this.containerVpWidth
        };
      }
      return {
        "letterboxVp": 0,
        "videoHVp": this.containerVpHeight,
        "videoWVp": this.containerVpHeight * (this.curSource.width / this.curSource.height)
      };
    }
    return {
      "letterboxVp": 0,
      "videoHVp": this.containerVpHeight,
      "videoWVp": this.containerVpWidth
    };
  }
  subtitleBottomVp() {
    let v5, v8;
    if (this.containerVpWidth <= 0 || this.containerVpHeight <= 0) {
      return Number(this.playbackConfig.subtitleBottomMarginVp);
    }
    v5 = this.displayLayoutVp();
    v8 = v5.letterboxVp + Math.min(Math.max(local_0_7 /*SUBTITLE_MARGIN_MIN_VP*/, v5.videoHVp * local_0_8 /*SUBTITLE_VIDEO_MARGIN_RATIO*/), Number(this.playbackConfig.subtitleBottomMarginVp));
    return Math.min(Math.max(Math.max(v8, !(this.subtitleDragLiftRatio === 0 ? this.subtitleDragOffsetXRatio !== 0 : this.subtitleDragLiftRatio !== 0) && this.showControls ? this.bottomControlBarVpH + local_0_9 /*SUBTITLE_BAR_GAP_VP*/ : 0) + this.subtitleDragLiftRatio * v5.videoHVp, v5.letterboxVp + 8), v5.letterboxVp + v5.videoHVp * local_0_10 /*SUBTITLE_DRAG_MAX_RATIO*/);
  }
  resetSubtitleDrag() {
    if (this.subtitleDragLiftRatio !== 0 || this.subtitleDragOffsetXRatio !== 0) {
      this.subtitleDragLiftRatio = 0;
      this.subtitleDragOffsetXRatio = 0;
    }
    this.subtitleDragging = false;
  }
  displayLayoutVp() {
    return this.videoAspectMode === "fit" ? this.videoLayoutVp() : {
      "letterboxVp": 0,
      "videoHVp": this.containerVpHeight,
      "videoWVp": this.containerVpWidth
    };
  }
  videoScaleXY() {
    let v7, v8, v9;
    v7 = this.videoLayoutVp();
    v8 = 1;
    v9 = 1;
    if (this.videoAspectMode === "fill") {
      v9 = Math.max(Math.max(1, this.containerVpWidth) / Math.max(1, v7.videoWVp), Math.max(1, this.containerVpHeight) / Math.max(1, v7.videoHVp));
    } else if (this.videoAspectMode === "stretch") {
      v8 = Math.max(1, this.containerVpWidth) / Math.max(1, v7.videoWVp);
      v9 = Math.max(1, this.containerVpHeight) / Math.max(1, v7.videoHVp);
    }
    return {
      "sx": v8 * this.videoPinchScale,
      "sy": v9 * this.videoPinchScale
    };
  }
  clampVideoPan() {
    let v3, v4, v5, v6;
    v3 = this.videoLayoutVp();
    v6 = this.videoScaleXY();
    v4 = Math.max(0, (v3.videoWVp * v6.sx - this.containerVpWidth) / 2);
    v5 = Math.max(0, (v3.videoHVp * v6.sy - this.containerVpHeight) / 2);
    this.videoPanXVp = Math.min(Math.max(this.videoPanXVp, -v4), v4);
    this.videoPanYVp = Math.min(Math.max(this.videoPanYVp, -v5), v5);
  }
  resetVideoZoom() {
    this.videoPinchScale = 1;
    this.videoPanXVp = 0;
    this.videoPanYVp = 0;
  }
  aspectModeLabel() {
    let v4;
    v4 = {
      "id": undefined,
      "type": null,
      "params": null,
      "bundleName": "com.talon.yourpipe",
      "moduleName": "entry"
    };
    v4.__defineGetter__("id", function () {
      return typeof globalThis.__getResourceId__ === "function" ? __getResourceId__(this) : -1;
    });
    v4.type = -1;
    v4.params = ["app.string.yt_aspect_" + this.videoAspectMode + ""];
    return v4;
  }
  selectAspectMode(p0) {
    this.videoAspectMode = p0;
    this.resetVideoZoom();
  }
  AspectMenu(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Menu.create();
      Menu.onAppear(function () {
        return local_1_0.onControlMenuAppear();
      });
      Menu.onDisAppear(function () {
        return local_1_0.onControlMenuDisappear();
      });
      Menu.backgroundColor({
        "id": 16778153,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Menu.borderRadius(12);
      Menu.menuItemDivider({
        "strokeWidth": LengthMetrics.vp(0.5),
        "color": {
          "id": 125831013,
          "type": 10001,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      Menu.width(220);
    }, Menu);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if ((local_1_0.videoPinchScale <= 1 ? local_1_0.videoPanXVp !== 0 : local_1_0.videoPinchScale > 1) || local_1_0.videoPanYVp !== 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            MenuItem.create({
              "content": {
                "id": 16777310,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }
            });
            MenuItem.contentFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            MenuItem.contentFont({
              "size": 14
            });
            MenuItem.onClick(function () {
              return local_1_0.resetVideoZoom();
            });
          }, MenuItem);
          MenuItem.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      ForEach.create();
      local_1_0.forEachUpdateFunction(p0, ["fit", "fill", "stretch"], function (p0) {
        let local_2_0;
        local_2_0 = p0;
        local_1_0.observeComponentCreation2(function (p0, p1) {
          let v8, v9, acc;
          v8 = {
            "content": null,
            "endIcon": null
          };
          v9 = {
            "id": undefined,
            "type": null,
            "params": null,
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          };
          v9.__defineGetter__("id", function () {
            return typeof globalThis.__getResourceId__ === "function" ? __getResourceId__(this) : -1;
          });
          v9.type = -1;
          v9.params = ["app.string.yt_aspect_" + local_2_0 /*mode*/ + ""];
          v8.content = v9;
          v8.endIcon = local_1_0.videoAspectMode === local_2_0 /*mode*/ ? {
            "id": 125831490,
            "type": 40000,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          } : "";
          MenuItem.create(v8);
          MenuItem.contentFontColor({
            "id": 125830982,
            "type": 10001,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          });
          MenuItem.contentFont({
            "size": 14
          });
          acc = local_1_0.videoAspectMode === local_2_0 /*mode*/ ? local_1_0.getSelectedMenuBackground() : Color.Transparent;
          MenuItem.backgroundColor(acc);
          MenuItem.onClick(function () {
            return local_1_0.selectAspectMode(local_2_0 /*mode*/);
          });
        }, MenuItem);
        MenuItem.pop();
      }, function (p0) {
        return p0;
      }, false, false);
    }, ForEach);
    ForEach.pop();
    Menu.pop();
  }
  onPinchTouch(p0) {
    let v7, v12, acc;
    if (!this.showControls) {
      return;
    }
    if (p0.touches.length === 2) {
      v7 = Math.sqrt((p0.touches[0].x - p0.touches[1].x) * (p0.touches[0].x - p0.touches[1].x) + (p0.touches[0].y - p0.touches[1].y) * (p0.touches[0].y - p0.touches[1].y));
      if (!this.videoPinching) {
        this.videoPinching = true;
        this.pinchStartDistanceVp = Math.max(1, v7);
        this.pinchStartScale = this.videoPinchScale;
        this.pinchAppliedScale = this.videoPinchScale;
        this.pinchStartMidXVp = (p0.touches[0].x + p0.touches[1].x) / 2;
        this.pinchStartMidYVp = (p0.touches[0].y + p0.touches[1].y) / 2;
        this.pinchLastMidXVp = this.pinchStartMidXVp;
        this.pinchLastMidYVp = this.pinchStartMidYVp;
        this.pinchGestureMode = "undecided";
        this.clearHideTimer();
        this.ignorePlayerPan("pinch-start");
        this.subtitleDragging = false;
        return;
      }
      if (p0.type === TouchType.Move) {
        if (this.pinchGestureMode === "undecided") {
          v12 = Math.abs(v7 - this.pinchStartDistanceVp);
          acc = Math.hypot((p0.touches[0].x + p0.touches[1].x) / 2 - this.pinchStartMidXVp, (p0.touches[0].y + p0.touches[1].y) / 2 - this.pinchStartMidYVp);
          if (acc > local_0_11 /*PINCH_DECIDE_VP*/ && acc > v12 * 1.5) {
            this.pinchGestureMode = "pan";
          } else if (v12 / this.pinchStartDistanceVp > local_0_12 /*PINCH_DECIDE_SCALE_RATIO*/ && v12 > acc * 1.5) {
            this.pinchGestureMode = "scale";
          }
        }
        if (this.pinchGestureMode === "scale") {
          v12 = Math.min(Math.max(this.pinchStartScale * (v7 / this.pinchStartDistanceVp), 1), local_0_13 /*VIDEO_PINCH_MAX_SCALE*/);
          if (Math.abs(v12 - this.pinchAppliedScale) / this.pinchAppliedScale >= 0.01) {
            this.pinchAppliedScale = v12;
            this.videoPinchScale = v12;
            this.clampVideoPan();
          }
        } else if (this.pinchGestureMode === "pan") {
          this.videoPanXVp = this.videoPanXVp + ((p0.touches[0].x + p0.touches[1].x) / 2 - this.pinchLastMidXVp);
          this.videoPanYVp = this.videoPanYVp + ((p0.touches[0].y + p0.touches[1].y) / 2 - this.pinchLastMidYVp);
          this.clampVideoPan();
        }
        this.pinchLastMidXVp = (p0.touches[0].x + p0.touches[1].x) / 2;
        this.pinchLastMidYVp = (p0.touches[0].y + p0.touches[1].y) / 2;
      }
      return;
    }
    if (this.videoPinching) {
      if (p0.type === TouchType.Up || p0.type === TouchType.Cancel) {
        this.videoPinching = false;
        if (this.videoPinchScale <= 1.05) {
          this.resetVideoZoom();
        }
        this.scheduleHideControls();
      }
    }
    return;
  }
  onFullscreenModeChange() {
    this.resetTransientUi("fullscreen-change");
    this.resetSubtitleDrag();
    this.resetVideoZoom();
    this.calculateSurfaceSize();
  }
  isInFullscreenGestureSafeEdge(p0, p1) {
    if (!this.isFullLandscapeScreen) {
      return false;
    }
    return (p0 > this.playerGestureSafeLeft ? p0 >= this.containerVpWidth - this.playerGestureSafeRight : p0 <= this.playerGestureSafeLeft)
      || p1 <= Math.max(this.playerGestureSafeTop, this.safeAreaTop)
      || p1 >= this.containerVpHeight - this.playerGestureSafeBottom;
  }
  ignorePlayerPan(p0) {
    this.gestureMode = local_0_2.IGNORED;
    this.isGestureSeek = false;
    this.showBrightnessHint = false;
    this.showVolumeHint = false;
    Logger.debug(local_0_1 /*TAG*/, "Player pan ignored reason=" + p0 + "");
  }
  onPlayerPanStart(p0) {
    this.hiddenUiSeekOnly = false;
    if (this.subtitleDragging || this.videoPinching) {
      this.ignorePlayerPan(this.subtitleDragging ? "subtitle-dragging" : "pinching");
      return;
    }
    if (this.isSliderDragging) {
      this.gestureMode = local_0_2.IGNORED;
      Logger.debug(local_0_1 /*TAG*/, "Player pan ignored reason=slider-dragging-start");
      return;
    }
    this.gestureStartX = ((p0.fingerList[0] !== null && p0.fingerList[0] !== undefined ? p0.fingerList[0].localX : undefined) ?? 0) - p0.offsetX;
    this.gestureStartY = ((p0.fingerList[0] !== null && p0.fingerList[0] !== undefined ? p0.fingerList[0].localY : undefined) ?? 0) - p0.offsetY;
    this.gestureSeekStartTime = this.currentTime;
    this.gestureSeekTime = this.currentTime;
    this.panEndTime = this.currentTime;
    if (!this.showControls) {
      this.hiddenUiSeekOnly = true;
      this.gestureMode = local_0_2.PENDING;
      if (p0.fingerList.length !== 1) {
        this.ignorePlayerPan("finger-count");
      }
      return;
    }
    this.beginInteraction(local_0_3.PAN);
    this.gestureMode = local_0_2.PENDING;
    if (p0.fingerList.length !== 1) {
      this.ignorePlayerPan("finger-count");
    } else if (this.isInFullscreenGestureSafeEdge(this.gestureStartX, this.gestureStartY)) {
      this.ignorePlayerPan("system-safe-edge");
    }
    return;
  }
  lockPlayerPanMode(p0) {
    let v4, v5, v7;
    v4 = Math.abs(p0.offsetX);
    v5 = Math.abs(p0.offsetY);
    if (Math.max(v4, v5) < local_0_14 /*GESTURE_LOCK_DISTANCE*/) {
      return;
    }
    if (this.hiddenUiSeekOnly && v4 < v5 * local_0_15 /*GESTURE_AXIS_DOMINANCE*/) {
      this.ignorePlayerPan("controls-hidden-vertical");
      return;
    }
    if (v4 >= v5 * local_0_15 /*GESTURE_AXIS_DOMINANCE*/) {
      v7 = this.controller.getPlaybackState();
      if (this.playbackConfig.gestureSeekEnabled && !this.curSource.isLive && this.durationTime > 0) {
        if (!v7.isSeekable) {
          this.ignorePlayerPan(this.playbackConfig.gestureSeekEnabled ? "seek-unavailable" : "seek-disabled");
          return;
        }
        this.gestureMode = local_0_2.SEEK;
        this.isGestureSeek = true;
        Logger.debug(local_0_1 /*TAG*/, "Player pan locked mode=seek");
        return;
      }
      this.ignorePlayerPan(this.playbackConfig.gestureSeekEnabled ? "seek-unavailable" : "seek-disabled");
      return;
    }
    if (v5 < v4 * local_0_15 /*GESTURE_AXIS_DOMINANCE*/) {
      return;
    }
    if (this.gestureStartX < this.containerVpWidth / 2) {
      if (!this.playbackConfig.gestureBrightnessEnabled) {
        this.ignorePlayerPan("brightness-disabled");
        return;
      }
      try {
        this.gestureBrightnessValue = this.envService.getBrightnessSync(this.getUIContext().getHostContext());
      } catch (catchAcc) {
        Logger.warn(local_0_1 /*TAG*/, "Brightness gesture baseline fallback reason=" + catchAcc + "");
      }
      this.gestureInitValue = this.gestureBrightnessValue;
      this.gestureMode = local_0_2.BRIGHTNESS;
      this.showBrightnessHint = true;
      Logger.debug(local_0_1 /*TAG*/, "Player pan locked mode=brightness");
    } else {
      if (!this.playbackConfig.gestureVolumeEnabled) {
        this.ignorePlayerPan("volume-disabled");
        return;
      }
      try {
        v7 = this.envService.getVolume();
        this.maxVolume = v7.maxVolume;
        this.gestureVolumeValue = v7.maxVolume > 0 ? v7.volume / v7.maxVolume : 0;
      } catch (catchAcc) {
        Logger.warn(local_0_1 /*TAG*/, "Volume gesture baseline fallback reason=" + catchAcc + "");
      }
      this.gestureInitValue = this.gestureVolumeValue;
      this.gestureMode = local_0_2.VOLUME;
      this.showVolumeHint = true;
      Logger.debug(local_0_1 /*TAG*/, "Player pan locked mode=volume");
    }
    return;
  }
  onPlayerPanUpdate(p0) {
    let v5;
    if (this.isSliderDragging || this.activeInteraction === local_0_3.SLIDER) {
      this.ignorePlayerPan("slider-dragging-update");
      return;
    }
    if (p0.fingerList.length === 1) {
      if (this.gestureMode === local_0_2.PENDING) {
        this.lockPlayerPanMode(p0);
      }
      switch (this.gestureMode) {
        case local_0_2.SEEK:
          this.gestureSeekTime = Math.min(Math.max(0, this.gestureSeekStartTime + p0.offsetX / Math.max(1, this.containerVpWidth) * this.durationTime), this.durationTime);
          this.panEndTime = this.gestureSeekTime;
          break;
        case local_0_2.BRIGHTNESS:
          v5 = Math.min(1, Math.max(0, this.gestureInitValue + -p0.offsetY / 200));
          this.gestureBrightnessValue = v5;
          this.envService.setBrightness(v5);
          this.gestureBrightnessIcon = v5 > 0.3 ? {
            "id": 125831497,
            "type": 40000,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          } : {
            "id": 125831541,
            "type": 40000,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          };
          break;
        case local_0_2.VOLUME:
          v5 = Math.min(1, Math.max(0, this.gestureInitValue + -p0.offsetY / 200));
          this.gestureVolumeValue = v5;
          this.envService.setVolume(Math.round(v5 * this.maxVolume));
          this.gestureVolumeIcon = v5 > 0.5 ? {
            "id": 125831511,
            "type": 40000,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          } : v5 > 0 ? {
            "id": 125831508,
            "type": 40000,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          } : {
            "id": 125831505,
            "type": 40000,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          };
          break;
      }
      return;
    }
    this.ignorePlayerPan("finger-count-update");
    return;
  }
  onPlayerPanEnd(p0) {
    let v4;
    let local_1_0;
    local_1_0 = this;
    v4 = local_1_0.gestureMode;
    local_1_0.hiddenUiSeekOnly = false;
    if (!p0 && local_1_0.gestureMode === local_0_2.SEEK) {
      local_1_0.controller.syncSeek(local_1_0.panEndTime * 1000);
      Logger.debug(local_0_1 /*TAG*/, "Player pan seek committed positionMs=" + Math.round(local_1_0.panEndTime * 1000) + "");
    } else if (p0 && local_1_0.gestureMode !== local_0_2.IDLE) {
      Logger.debug(local_0_1 /*TAG*/, "Player pan canceled mode=" + local_1_0.gestureMode + "");
    }
    local_1_0.gestureMode = local_0_2.IDLE;
    if (local_1_0.activeInteraction === local_0_3.PAN) {
      local_1_0.activeInteraction = local_0_3.NONE;
    }
    if (v4 !== local_0_2.SEEK) {
      if (v4 !== local_0_2.BRIGHTNESS) {
        if (v4 === local_0_2.VOLUME) {
          if (p0) {
            local_1_0.showVolumeHint = false;
          } else {
            local_1_0.volHideTimerId = setTimeout(function () {
              local_1_0.volHideTimerId = -1;
              local_1_0.showVolumeHint = false;
            }, local_0_17 /*SIDE_HINT_HIDE_DELAY*/);
          }
        }
      } else if (p0) {
        local_1_0.showBrightnessHint = false;
      } else {
        local_1_0.brightnessHideTimerId = setTimeout(function () {
          local_1_0.brightnessHideTimerId = -1;
          local_1_0.showBrightnessHint = false;
        }, local_0_17 /*SIDE_HINT_HIDE_DELAY*/);
      }
    } else if (p0) {
      local_1_0.isGestureSeek = false;
    } else {
      local_1_0.seekHintHideTimerId = setTimeout(function () {
        local_1_0.seekHintHideTimerId = -1;
        local_1_0.isGestureSeek = false;
      }, local_0_16 /*SEEK_HINT_HIDE_DELAY*/);
    }
    local_1_0.scheduleHideControls();
  }
  registerDoubleTapActivity() {
    this.interactionEpoch = this.interactionEpoch + 1;
    this.clearHideTimer();
    this.clearTransientHintTimers();
    this.showForwardHint = false;
    this.showBackwardHint = false;
    this.activeInteraction = local_0_3.NONE;
    this.scheduleHideControls();
    return this.interactionEpoch;
  }
  onHoldSpeedStart() {
    if (this.speedBoostActive) {
      return;
    }
    if (!this.playbackConfig.holdSpeedEnabled) {
      Logger.debug(local_0_1 /*TAG*/, "Hold speed boost ignored reason=disabled");
      return;
    }
    if (this.curSource.isLive || !this.vm.isPlaying || this.isSliderDragging || this.hasError) {
      Logger.debug(local_0_1 /*TAG*/, "Hold speed boost ignored live=" + this.curSource.isLive + " " + ("playing=" + this.vm.isPlaying + " slider=" + this.isSliderDragging + " error=" + this.hasError + ""));
      return;
    }
    if (Math.abs(this.vm.playbackSpeed - this.playbackConfig.holdSpeedValue) < 0.001) {
      return;
    }
    this.speedBoostActive = true;
    this.speedBoostPreviousSpeed = this.vm.playbackSpeed;
    this.speedBoostTarget = this.playbackConfig.holdSpeedValue;
    this.controller.setPlaybackSpeed(this.playbackConfig.holdSpeedValue);
    this.showSpeedBoostHint = true;
    Logger.debug(local_0_1 /*TAG*/, "Hold speed boost start " + this.speedBoostPreviousSpeed + "x -> " + this.playbackConfig.holdSpeedValue + "x");
    return;
  }
  onHoldSpeedEnd(p0) {
    if (!this.speedBoostActive) {
      return;
    }
    this.speedBoostActive = false;
    this.showSpeedBoostHint = false;
    this.controller.setPlaybackSpeed(this.speedBoostPreviousSpeed);
    Logger.debug(local_0_1 /*TAG*/, "Hold speed boost end reason=" + p0 + " restored=" + this.speedBoostPreviousSpeed + "x");
    return;
  }
  registerControlActivity() {
    this.beginInteraction(local_0_3.NONE);
    this.scheduleHideControls();
  }
  onControlMenuAppear() {
    this.controlMenuDepth = this.controlMenuDepth + 1;
    this.beginInteraction(local_0_3.MENU);
  }
  onControlMenuDisappear() {
    this.controlMenuDepth = Math.max(0, this.controlMenuDepth - 1);
    if (this.controlMenuDepth > 0) {
      return;
    }
    if (this.activeInteraction === local_0_3.MENU) {
      this.activeInteraction = local_0_3.NONE;
    }
    this.interactionEpoch = this.interactionEpoch + 1;
    this.scheduleHideControls();
    return;
  }
  calculateSurfaceSizeByArea(p0, p1) {
    if (this.curSource.width && this.curSource.height) {
      if (this.curSource.width / this.curSource.height > p0 / p1) {
        this.surfaceWidth = p0;
        this.surfaceHeight = p0 / (this.curSource.width / this.curSource.height);
      } else {
        this.surfaceHeight = p1;
        this.surfaceWidth = p1 * (this.curSource.width / this.curSource.height);
      }
      Logger.debug(local_0_1 /*TAG*/, "DEBUG - Layout Update: Container[" + Math.round(p0) + "x" + Math.round(p1) + "], " + ("Surface[" + this.surfaceWidth + "x" + this.surfaceHeight + "], ") + ("LandscapeState: " + this.isFullLandscapeScreen + ""));
    } else {
      this.surfaceWidth = p0;
      this.surfaceHeight = p1;
    }
  }
  calculateSurfaceSize() {
    let v4, v5, v6, v7;
    if (this.containerWidthPX > 0) {
      if (this.containerHeightPX > 0) {
        this.calculateSurfaceSizeByArea(this.containerWidthPX, this.containerHeightPX);
        return;
      }
    }
    try {
      v5 = this.getUIContext().getComponentUtils();
      v7 = v5;
      v4 = v7.getRectangleById("PlayerContainer");
      if (v4 && v4.size && (v7 = Number(v4.size.width), v6 = Number(v4.size.height), v7 > 0) && v6 > 0) {
        this.calculateSurfaceSizeByArea(v7, v6);
        return;
      }
      if (this.curSource.width && this.curSource.height) {
        v5 = AppStorage.get("deviceWidth") || 0;
        v4 = AppStorage.get("deviceHeight") || 0;
        if (v5 > 0 && v4 > 0) {
          this.calculateSurfaceSizeByArea(v5, this.isFullLandscapeScreen ? v4 : v5 / (this.curSource.width / this.curSource.height));
        }
      }
      return;
    } catch (catchAcc) {
      Logger.warn(local_0_1 /*TAG*/, "Failed to get component info via componentUtils");
      if (this.curSource.width && this.curSource.height) {
        v5 = AppStorage.get("deviceWidth") || 0;
        v4 = AppStorage.get("deviceHeight") || 0;
        if (v5 > 0 && v4 > 0) {
          this.calculateSurfaceSizeByArea(v5, this.isFullLandscapeScreen ? v4 : v5 / (this.curSource.width / this.curSource.height));
        }
      }
      return;
    }
  }
  onIndexChange() {
    this.controller.setCurIndex(this.curIndex);
    if (this.curIndex !== this.index) {
      this.controller.syncPause();
    } else if (this.vm.isReady && this.isPageShow) {
      this.controller.syncPlay();
    }
  }
  togglePlayback() {
    this.registerControlActivity();
    if (this.vm.isReady) {
      if (!this.hasStreams) {
        Logger.warn(local_0_1 /*TAG*/, "togglePlayback ignored: isReady=" + this.vm.isReady + ", hasStreams=" + this.hasStreams + "");
        return;
      }
      if (this.vm.isPlaying) {
        this.controller.syncPause();
      } else {
        this.controller.syncPlay();
      }
      this.syncPlaybackStateFromController();
      return;
    }
    Logger.warn(local_0_1 /*TAG*/, "togglePlayback ignored: isReady=" + this.vm.isReady + ", hasStreams=" + this.hasStreams + "");
    return;
  }
  showCenterPlayButton() {
    let v4;
    if (!this.uiConfig.showCenterPlayButton) {
      return false;
    }
    v4 = this.vm.isReady && !this.vm.isPlaying && !this.vm.isBuffering && !this.isSliderDragging;
    return v4 && !this.hasError;
  }
  isCenterButtonTap(p0) {
    let v6, v9, acc;
    if (!this.showCenterPlayButton()) {
      return false;
    }
    v6 = (p0.fingerList[0] !== null && p0.fingerList[0] !== undefined ? p0.fingerList[0].localX : undefined) ?? -1;
    acc = (p0.fingerList[0] !== null && p0.fingerList[0] !== undefined ? p0.fingerList[0].localY : undefined) ?? -1;
    if (v6 < 0 || acc < 0) {
      return false;
    }
    v9 = Math.abs(v6 - this.containerVpWidth / 2) <= local_0_18 /*CENTER_PLAY_BUTTON_HIT_RADIUS*/;
    return v9 && Math.abs(acc - this.containerVpHeight / 2) <= local_0_18 /*CENTER_PLAY_BUTTON_HIT_RADIUS*/;
  }
  SpeedMenu(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Menu.create();
      Menu.onAppear(function () {
        return local_1_0.onControlMenuAppear();
      });
      Menu.onDisAppear(function () {
        return local_1_0.onControlMenuDisappear();
      });
      Menu.backgroundColor({
        "id": 16778153,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Menu.borderRadius(12);
      Menu.menuItemDivider({
        "strokeWidth": LengthMetrics.vp(0.5),
        "color": {
          "id": 125831013,
          "type": 10001,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      Menu.width(180);
    }, Menu);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      ForEach.create();
      local_1_0.forEachUpdateFunction(p0, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3], function (p0) {
        let local_2_0;
        local_2_0 = p0;
        local_1_0.observeComponentCreation2(function (p0, p1) {
          let acc;
          MenuItem.create({
            "content": local_2_0 /*speed*/ + "x",
            "endIcon": local_1_0.vm.playbackSpeed === local_2_0 /*speed*/ ? {
              "id": 125831490,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            } : ""
          });
          MenuItem.contentFontColor({
            "id": 125830982,
            "type": 10001,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          });
          MenuItem.contentFont({
            "size": 14
          });
          acc = local_1_0.vm.playbackSpeed === local_2_0 /*speed*/ ? local_1_0.getSelectedMenuBackground() : Color.Transparent;
          MenuItem.backgroundColor(acc);
          MenuItem.onClick(function () {
            local_1_0.controller.setPlaybackSpeed(local_2_0 /*speed*/);
          });
        }, MenuItem);
        MenuItem.pop();
      });
    }, ForEach);
    ForEach.pop();
    Menu.pop();
  }
  SubtitleMenu(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Menu.create();
      Menu.onAppear(function () {
        return local_1_0.onControlMenuAppear();
      });
      Menu.onDisAppear(function () {
        return local_1_0.onControlMenuDisappear();
      });
      Menu.backgroundColor({
        "id": 16778153,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Menu.borderRadius(12);
      Menu.menuItemDivider({
        "strokeWidth": LengthMetrics.vp(0.5),
        "color": {
          "id": 125831013,
          "type": 10001,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      Menu.width(220);
    }, Menu);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let acc;
      MenuItem.create({
        "content": {
          "id": 16777909,
          "type": 10003,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        },
        "endIcon": local_1_0.vm.currentSubtitleUrl === "" ? {
          "id": 125831490,
          "type": 40000,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        } : ""
      });
      MenuItem.contentFontColor({
        "id": 125830982,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      MenuItem.contentFont({
        "size": 14
      });
      acc = local_1_0.vm.currentSubtitleUrl === "" ? local_1_0.getSelectedMenuBackground() : Color.Transparent;
      MenuItem.backgroundColor(acc);
      MenuItem.onClick(function () {
        local_1_0.controller.switchSubtitle("");
        PreferencesStore.setString("cfg_subtitle_preferred_lang", "");
      });
    }, MenuItem);
    MenuItem.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      ForEach.create();
      local_1_0.forEachUpdateFunction(p0, local_1_0.vm.subtitleTracks, function (p0) {
        let local_2_0;
        local_2_0 = p0;
        local_1_0.observeComponentCreation2(function (p0, p1) {
          let acc;
          MenuItem.create({
            "content": local_1_0.getSubtitleLabel(local_2_0 /*track*/),
            "endIcon": local_1_0.vm.currentSubtitleUrl === local_2_0 /*track*/.url ? {
              "id": 125831490,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            } : ""
          });
          MenuItem.contentFontColor({
            "id": 125830982,
            "type": 10001,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          });
          MenuItem.contentFont({
            "size": 14
          });
          acc = local_1_0.vm.currentSubtitleUrl === local_2_0 /*track*/.url ? local_1_0.getSelectedMenuBackground() : Color.Transparent;
          MenuItem.backgroundColor(acc);
          MenuItem.onClick(function () {
            local_1_0.controller.switchSubtitle(local_2_0 /*track*/.url);
            PreferencesStore.setString("cfg_subtitle_preferred_lang", local_2_0 /*track*/.languageCode || "");
          });
        }, MenuItem);
        MenuItem.pop();
      }, function (p0) {
        return p0.url;
      }, false, false);
    }, ForEach);
    ForEach.pop();
    Menu.pop();
  }
  ChapterMenu(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Menu.create();
      Menu.onAppear(function () {
        return local_1_0.onControlMenuAppear();
      });
      Menu.onDisAppear(function () {
        return local_1_0.onControlMenuDisappear();
      });
      Menu.backgroundColor({
        "id": 16778153,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Menu.borderRadius(12);
      Menu.menuItemDivider({
        "strokeWidth": LengthMetrics.vp(0.5),
        "color": {
          "id": 125831013,
          "type": 10001,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      Menu.width(280);
    }, Menu);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      ForEach.create();
      local_1_0.forEachUpdateFunction(p0, local_1_0.chapters, function (p0, p1) {
        let local_2_0, local_2_1;
        local_2_1 = p1;
        local_2_0 = p0;
        local_1_0.observeComponentCreation2(function (p0, p1) {
          let acc;
          MenuItem.create({
            "content": "" + secondToTime(Math.floor(local_2_0 /*chapter*/.startTimeSeconds)) + " · " + local_2_0 /*chapter*/.title + "",
            "endIcon": local_1_0.getCurrentChapterIndex() === local_2_1 ? {
              "id": 125831490,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            } : ""
          });
          MenuItem.contentFontColor({
            "id": 125830982,
            "type": 10001,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          });
          MenuItem.contentFont({
            "size": 14
          });
          acc = local_1_0.getCurrentChapterIndex() === local_2_1 ? local_1_0.getSelectedMenuBackground() : Color.Transparent;
          MenuItem.backgroundColor(acc);
          MenuItem.onClick(function () {
            Logger.info(local_0_1 /*TAG*/, "Chapter seek: index=" + local_2_1 + " start=" + local_2_0 /*chapter*/.startTimeSeconds + "s");
            local_1_0.controller.syncSeek(local_2_0 /*chapter*/.startTimeSeconds * 1000);
          });
        }, MenuItem);
        MenuItem.pop();
      }, function (p0, p1) {
        return "" + p0.startTimeSeconds + "_" + p1 + "";
      }, true, true);
    }, ForEach);
    ForEach.pop();
    Menu.pop();
  }
  AudioMenu(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Menu.create();
      Menu.onAppear(function () {
        return local_1_0.onControlMenuAppear();
      });
      Menu.onDisAppear(function () {
        return local_1_0.onControlMenuDisappear();
      });
      Menu.backgroundColor({
        "id": 16778153,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Menu.borderRadius(12);
      Menu.menuItemDivider({
        "strokeWidth": LengthMetrics.vp(0.5),
        "color": {
          "id": 125831013,
          "type": 10001,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      Menu.width(220);
    }, Menu);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v5, v12;
      ForEach.create();
      v5 = function (p0, p1) {
        let local_2_0, local_2_1;
        local_2_1 = p1;
        local_2_0 = p0;
        local_1_0.observeComponentCreation2(function (p0, p1) {
          let acc;
          MenuItem.create({
            "content": local_1_0.getAudioLabel(local_2_0 /*stream*/),
            "endIcon": local_1_0.getSelectedAudioIndex() === local_2_1 ? {
              "id": 125831490,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            } : ""
          });
          MenuItem.contentFontColor({
            "id": 125830982,
            "type": 10001,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          });
          MenuItem.contentFont({
            "size": 14
          });
          acc = local_1_0.getSelectedAudioIndex() === local_2_1 ? local_1_0.getSelectedMenuBackground() : Color.Transparent;
          MenuItem.backgroundColor(acc);
          MenuItem.onClick(function () {
            local_1_0.controller.switchToAudioIndex(local_2_1);
          });
        }, MenuItem);
        MenuItem.pop();
      };
      v12 = function (p0, p1) {
        return "" + (p0.itag ?? "") + "_" + (p0.audioTrackId || "") + "_" + (p0.sourceClient || "") + "_" + p1 + "";
      };
      local_1_0.forEachUpdateFunction(p0, local_1_0.controller.getAudioStreamList(), v5, v12, true, true);
    }, ForEach);
    ForEach.pop();
    Menu.pop();
  }
  VideoMenu(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Menu.create();
      Menu.onAppear(function () {
        return local_1_0.onControlMenuAppear();
      });
      Menu.onDisAppear(function () {
        return local_1_0.onControlMenuDisappear();
      });
      Menu.backgroundColor({
        "id": 16778153,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Menu.borderRadius(12);
      Menu.menuItemDivider({
        "strokeWidth": LengthMetrics.vp(0.5),
        "color": {
          "id": 125831013,
          "type": 10001,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      Menu.width(220);
    }, Menu);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v5, v12;
      ForEach.create();
      v5 = function (p0, p1) {
        let local_2_0, local_2_1;
        local_2_1 = p1;
        local_2_0 = p0;
        local_1_0.observeComponentCreation2(function (p0, p1) {
          let acc;
          MenuItem.create({
            "content": local_1_0.getVideoLabel(local_2_0 /*entry*/.stream),
            "endIcon": local_1_0.getSelectedVideoIndex() === local_2_1 ? {
              "id": 125831490,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            } : ""
          });
          MenuItem.contentFontColor({
            "id": 125830982,
            "type": 10001,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          });
          MenuItem.contentFont({
            "size": 14
          });
          acc = local_1_0.getSelectedVideoIndex() === local_2_1 ? local_1_0.getSelectedMenuBackground() : Color.Transparent;
          MenuItem.backgroundColor(acc);
          MenuItem.onClick(function () {
            local_1_0.controller.switchToVideoEntry(local_2_0 /*entry*/);
          });
        }, MenuItem);
        MenuItem.pop();
      };
      v12 = function (p0, p1) {
        return "" + (p0.stream.itag ?? "") + "_" + (p0.stream.audioTrackId || "") + "_" + (p0.stream.sourceClient || "") + "_" + p1 + "";
      };
      local_1_0.forEachUpdateFunction(p0, local_1_0.controller.getMergedVideoList(), v5, v12, true, true);
    }, ForEach);
    ForEach.pop();
    Menu.pop();
  }
  getSelectedVideoIndex() {
    let acc;
    let local_1_0;
    local_1_0 = this.vm.playerModel.currentVideoStream;
    acc = this.controller.getMergedVideoList().findIndex(function (p0) {
      return p0.stream === local_1_0 /*current*/;
    });
    if (acc < 0) {
      acc = 0;
    }
    return acc;
  }
  getSubtitleLabel(p0) {
    let v5, acc;
    if (p0.isAutoTranslated) {
      v5 = p0.languageCode;
      try {
        v5 = i18n.System.getDisplayLanguage(p0.languageCode, p0.languageCode);
      } catch (catchAcc) {}
      return "" + v5 + " · " + getContext().resourceManager.getStringSync({
        "id": 16777908,
        "type": 10003,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      }.id) + "";
    }
    acc = [p0.name, p0.languageCode, p0.kind].filter(function (p0) {
      let v5;
      v5 = !!p0;
      return v5 && p0.trim().length > 0;
    });
    return acc.join(" · ");
  }
  getAiTranslateLabel() {
    let v3, v4, v5;
    v3 = getContext().resourceManager.getStringSync({
      "id": 16777299,
      "type": 10003,
      "params": [],
      "bundleName": "com.talon.yourpipe",
      "moduleName": "entry"
    }.id);
    if (this.aiTranslateProgress.length > 0) {
      return "" + v3 + " " + this.aiTranslateProgress + "";
    }
    v5 = TranslationService.targetLanguage();
    v4 = v5;
    try {
      v4 = i18n.System.getDisplayLanguage(v5, v5);
    } catch (catchAcc) {}
    return "" + v3 + " · " + v4 + "";
  }
  onAiTranslateClick() {
    let v3, v4, v5, acc;
    let local_1_0, local_1_1;
    local_1_1 = this;
    v4 = SubtitleTranslationService.getInstance();
    if (v4.isRunning()) {
      v4.cancel();
      local_1_1.aiTranslateProgress = "";
      return;
    }
    acc = local_1_1.curSource.videoId ?? "";
    v5 = acc;
    if (v5.length === 0 || local_1_1.vm.subtitleTracks.length === 0) {
      return;
    }
    v3 = LlmTranslateConfig.get();
    if (v3.engine === "llm") {
      if (!v3.isLlmReady()) {
        local_1_1.getUIContext().getPromptAction().showToast({
          "message": {
            "id": 16777297,
            "type": 10003,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          },
          "duration": 2500
        });
        return;
      }
      local_1_0 = TranslationService.targetLanguage();
      v4.translateAndApply(v5, local_1_1.vm.subtitleTracks, local_1_1.vm.currentSubtitleUrl, local_1_1.controller).then(function (p0) {
        if (p0.ok) {
          PreferencesStore.setString("cfg_subtitle_preferred_lang", "ai:" + local_1_0 /*target*/ + "");
          if (p0.partial) {
            local_1_1.getUIContext().getPromptAction().showToast({
              "message": {
                "id": 16777302,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              },
              "duration": 2500
            });
          }
        } else if (!p0.cancelled) {
          Logger.warn(local_0_1 /*TAG*/, "AI translate failed: " + (p0.error || "-") + "");
          local_1_1.getUIContext().getPromptAction().showToast({
            "message": {
              "id": 16777296,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            },
            "duration": 2500
          });
        }
      });
      return;
    }
    local_1_0 = TranslationService.targetLanguage();
    v4.translateAndApply(acc, local_1_1.vm.subtitleTracks, local_1_1.vm.currentSubtitleUrl, local_1_1.controller).then(function (p0) {
      if (p0.ok) {
        PreferencesStore.setString("cfg_subtitle_preferred_lang", "ai:" + local_1_0 /*target*/ + "");
        if (p0.partial) {
          local_1_1.getUIContext().getPromptAction().showToast({
            "message": {
              "id": 16777302,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            },
            "duration": 2500
          });
        }
      } else if (!p0.cancelled) {
        Logger.warn(local_0_1 /*TAG*/, "AI translate failed: " + (p0.error || "-") + "");
        local_1_1.getUIContext().getPromptAction().showToast({
          "message": {
            "id": 16777296,
            "type": 10003,
            "params": [],
            "bundleName": "com.talon.yourpipe",
            "moduleName": "entry"
          },
          "duration": 2500
        });
      }
    });
    return;
  }
  getAudioLabel(p0) {
    return (p0.audioTrackName !== null && p0.audioTrackName !== undefined ? p0.audioTrackName.trim() : undefined)
      || (p0.audioLanguage !== null && p0.audioLanguage !== undefined ? p0.audioLanguage.trim() : undefined)
      || (p0.audioTrackId !== null && p0.audioTrackId !== undefined ? p0.audioTrackId.trim() : undefined)
      || (p0.codecs !== null && p0.codecs !== undefined ? p0.codecs.trim() : undefined)
      || "Audio";
  }
  getVideoLabel(p0) {
    let v4;
    if ((p0.kind || "") === "manifest_hls") {
      return {
        "id": 16777950,
        "type": 10003,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      };
    }
    v4 = [];
    if (p0.quality !== null && p0.quality !== undefined ? p0.quality.trim() : undefined) {
      v4.push(p0.quality);
    }
    if (p0.codecs !== null && p0.codecs !== undefined ? p0.codecs.trim() : undefined) {
      v4.push(p0.codecs);
    }
    return v4.join(" · ");
  }
  getSelectedMenuBackground() {
    return ThemeColorUtil.selectedBackground(this.themePrimary);
  }
  getSelectedAudioIndex() {
    return this.controller.getCurrentAudioIndex();
  }
  getCurrentChapterIndex() {
    let v3, v6;
    v3 = -1;
    v6 = 0;
    while (v6 >= this.chapters.length || this.chapters[v6].startTimeSeconds > this.currentTime) {
      v3 = v6;
      v6 += 1;
    }
    return v3;
  }
  getControlComfortSidePad() {
    return Math.min(local_0_19 /*CONTROL_SIDE_MAX*/, Math.max(local_0_20 /*CONTROL_SIDE_MIN*/, Math.round(this.containerVpWidth * 0.035)));
  }
  getControlLeftPad() {
    let v3;
    v3 = this.getControlComfortSidePad();
    return this.isFullLandscapeScreen ? Math.max(v3, this.playerControlAvoidLeft + local_0_21 /*CONTROL_SAFE_GAP*/) : v3;
  }
  getControlRightPad() {
    let v3;
    v3 = this.getControlComfortSidePad();
    return this.isFullLandscapeScreen ? Math.max(v3, this.playerControlAvoidRight + local_0_21 /*CONTROL_SAFE_GAP*/) : v3;
  }
  getControlTopPad() {
    return this.isFullLandscapeScreen ? Math.max(local_0_22 /*FULLSCREEN_VERTICAL_INSET*/, this.playerControlAvoidTop + local_0_21 /*CONTROL_SAFE_GAP*/) : local_0_23 /*CONTROL_VERTICAL_INSET*/;
  }
  getControlBottomPad() {
    return this.isFullLandscapeScreen ? Math.max(local_0_22 /*FULLSCREEN_VERTICAL_INSET*/, this.navBarHeight + local_0_21 /*CONTROL_SAFE_GAP*/, this.playerControlAvoidBottom + local_0_21 /*CONTROL_SAFE_GAP*/) : local_0_23 /*CONTROL_VERTICAL_INSET*/;
  }
  getControlItemGap() {
    return this.containerVpWidth > 0 && this.containerVpWidth < local_0_24 /*COMPACT_CONTROL_WIDTH*/ ? 4 : 8;
  }
  getTopToolCount() {
    let v3;
    v3 = this.curSource.isLive ? 0 : 1;
    if (!this.isLocalMode && this.chapters.length > 0) {
      v3 += 1;
    }
    if (!this.curSource.isLive) {
      if (!this.isLocalMode) {
        v3 += 1;
      }
    }
    if (!this.curSource.isLive && !this.isLocalMode && this.controller.getAudioStreamList().length > 1) {
      v3 += 1;
    }
    if (!this.isLocalMode && this.controller.getMergedVideoList().length > 0) {
      if (!this.curSource.isLive || this.vm.playerModel.liveQualityReady) {
        v3 += 1;
      }
    }
    return v3 + 1;
  }
  estimateTopToolsWidthVp() {
    let v3, v4;
    v4 = this.getControlItemGap();
    v3 = this.getTopToolCount();
    return v3 <= 0 ? 0 : v3 * local_0_25 /*SPEED_CONTROL_WIDTH*/ + Math.max(0, v3 - 1) * v4;
  }
  shouldCollapseTopTools() {
    let v3;
    if (!this.isFullLandscapeScreen) {
      return true;
    }
    if (this.containerVpWidth <= 0) {
      return false;
    }
    v3 = Math.max(0, this.containerVpWidth - this.getControlLeftPad() - this.getControlRightPad() - local_0_26 /*CONTROL_SLOT_SIZE*/);
    return this.estimateTopToolsWidthVp() > v3 * local_0_27 /*TOP_TOOLS_HALF_RATIO*/;
  }
  getTimeLabelWidth() {
    let v3;
    v3 = secondToTime(Math.floor(Math.max(0, this.durationTime)));
    if (v3.length > 8) {
      return 80;
    }
    if (v3.length > 5) {
      return 64;
    }
    return 48;
  }
  getCombinedTimeLabelWidth() {
    return this.getTimeLabelWidth() * 2 + 12;
  }
  shouldShowTimelineText() {
    let v4;
    v4 = !this.curSource.isLive && this.containerVpWidth >= local_0_28 /*TIMELINE_TEXT_MIN_WIDTH*/;
    return v4 && this.containerVpHeight >= local_0_29 /*TIMELINE_TEXT_MIN_HEIGHT*/;
  }
  AudioOnlyCoverLayer(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Center
      });
      Stack.width("100%");
      Stack.height("100%");
      Stack.hitTestBehavior(HitTestMode.None);
      Stack.zIndex(CommonConstants.Z_INDEX_BASE + 0.5);
    }, Stack);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.selectedVideo) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            __Common__.create();
            __Common__.brightness(0.4);
          }, __Common__);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            let v6;
            if (p1) {
              v6 = new MediaThumb(local_1_0, {
                "imageUrl": local_1_0.selectedVideo.thumbnailUrl || "",
                "placeholderColor": local_1_0.selectedVideo.thumbnailColor || "#000000",
                "thumbId": "audio_only_thumb_" + local_1_0.selectedVideo.id,
                "fillParent": true,
                "borderRadiusVp": 0
              }, undefined, p0, function () {}, {
                "page": "entry/src/main/ets/features/player/components/AVPlayer.ets",
                "line": 1952,
                "col": 9
              });
              ViewPU.create(v6);
              v6.paramsGenerator_ = function () {
                return {
                  "imageUrl": local_1_0.selectedVideo.thumbnailUrl || "",
                  "placeholderColor": local_1_0.selectedVideo.thumbnailColor || "#000000",
                  "thumbId": "audio_only_thumb_" + local_1_0.selectedVideo.id,
                  "fillParent": true,
                  "borderRadiusVp": 0
                };
              };
            } else {
              local_1_0.updateStateVarsOfChildByElmtId(p0, {
                "imageUrl": local_1_0.selectedVideo.thumbnailUrl || "",
                "placeholderColor": local_1_0.selectedVideo.thumbnailColor || "#000000",
                "thumbId": "audio_only_thumb_" + local_1_0.selectedVideo.id,
                "fillParent": true,
                "borderRadiusVp": 0
              });
            }
          }, {
            "name": "MediaThumb"
          });
          __Common__.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Rect.create();
            Rect.width("100%");
            Rect.height("100%");
            Rect.fill(Color.Black);
          }, Rect);
        });
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125832068,
        "type": 40000,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(48);
      SymbolGlyph.fontColor([Color.White]);
    }, SymbolGlyph);
    Stack.pop();
  }
  initialRender() {
    let local_1_0;
    local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Center
      });
      Stack.width(CommonConstants.WIDTH_FULL_PERCENT);
      Stack.height(CommonConstants.HEIGHT_FULL_PERCENT);
      Stack.id("PlayerContainer");
      Stack.backgroundColor(Color.Black);
      Stack.clip(true);
      Stack.onSizeChange(function (p0, p1) {
        if (local_1_0.containerVpWidth > 0 && local_1_0.containerVpHeight > 0) {
          if (local_1_0.containerVpWidth === p1.width ? local_1_0.containerVpHeight !== p1.height : local_1_0.containerVpWidth !== p1.width) {
            local_1_0.resetTransientUi("container-size-change");
            local_1_0.resetSubtitleDrag();
            local_1_0.resetVideoZoom();
          }
        }
        local_1_0.containerVpWidth = p1.width;
        local_1_0.containerVpHeight = p1.height;
        local_1_0.clampVideoPan();
        Logger.debug(local_0_1 /*TAG*/, "Control layout size=" + Math.round(p1.width) + "x" + Math.round(p1.height) + " fullscreen=" + local_1_0.isFullLandscapeScreen + "");
      });
      Stack.onTouch(function (p0) {
        return local_1_0.onPinchTouch(p0);
      });
    }, Stack);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      XComponent.create({
        "id": "PlayerXComponent",
        "type": XComponentType.SURFACE,
        "controller": local_1_0.x_componentController
      }, "com.talon.yourpipe/entry");
      XComponent.onLoad(function () {
        let v3;
        v3 = local_1_0.x_componentController.getXComponentSurfaceId();
        Logger.info(local_0_1 /*TAG*/, "XComponent onLoad, surfaceId=" + v3 + "");
        local_1_0.controller.setSurfaceID(v3);
        if (local_1_0.onSurfaceReady) {
          local_1_0.onSurfaceReady(local_1_0.x_componentController);
        }
      });
      XComponent.onDestroy(function () {
        Logger.info(local_0_1 /*TAG*/, "XComponent onDestroy");
      });
      XComponent.aspectRatio(local_1_0.curSource.width && local_1_0.curSource.height ? local_1_0.curSource.width / local_1_0.curSource.height : 16 / 9);
      XComponent.scale({
        "x": local_1_0.videoScaleXY().sx,
        "y": local_1_0.videoScaleXY().sy,
        "centerX": "50%",
        "centerY": "50%"
      });
      XComponent.translate({
        "x": local_1_0.videoPanXVp,
        "y": local_1_0.videoPanYVp
      });
      XComponent.onAreaChange(function (p0, p1) {
        let v5, v6;
        v6 = Math.round(local_1_0.getUIContext().vp2px(Number(p1.width)));
        v5 = Math.round(local_1_0.getUIContext().vp2px(Number(p1.height)));
        if (v6 > 0 && v5 > 0) {
          Logger.debug(local_0_1 /*TAG*/, "XComponent onAreaChange: " + v6 + "x" + v5 + " px");
          local_1_0.controller.resizeSurface(v6, v5);
        }
      });
      XComponent.zIndex(CommonConstants.Z_INDEX_BASE);
    }, XComponent);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.playbackStarted) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else if (!local_1_0.hasError) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width("100%");
            Stack.height("100%");
            Stack.backgroundColor(Color.Black);
            Stack.hitTestBehavior(HitTestMode.None);
            Stack.zIndex(CommonConstants.Z_INDEX_BASE + 1);
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            __Common__.create();
            __Common__.brightness(0.4);
          }, __Common__);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            let v6;
            if (p1) {
              v6 = new MediaThumb(local_1_0, {
                "imageUrl": local_1_0.curSource.thumbnailUrl
                  || (local_1_0.selectedVideo !== null && local_1_0.selectedVideo !== undefined ? local_1_0.selectedVideo.thumbnailUrl : undefined)
                  || "",
                "placeholderColor": (local_1_0.selectedVideo !== null && local_1_0.selectedVideo !== undefined ? local_1_0.selectedVideo.thumbnailColor : undefined)
                  || "#000000",
                "fillParent": true,
                "useAspectRatio": false,
                "borderRadiusVp": 0
              }, undefined, p0, function () {}, {
                "page": "entry/src/main/ets/features/player/components/AVPlayer.ets",
                "line": 2021,
                "col": 11
              });
              ViewPU.create(v6);
              v6.paramsGenerator_ = function () {
                return {
                  "imageUrl": local_1_0.curSource.thumbnailUrl
                    || (local_1_0.selectedVideo !== null && local_1_0.selectedVideo !== undefined ? local_1_0.selectedVideo.thumbnailUrl : undefined)
                    || "",
                  "placeholderColor": (local_1_0.selectedVideo !== null && local_1_0.selectedVideo !== undefined ? local_1_0.selectedVideo.thumbnailColor : undefined)
                    || "#000000",
                  "fillParent": true,
                  "useAspectRatio": false,
                  "borderRadiusVp": 0
                };
              };
            } else {
              local_1_0.updateStateVarsOfChildByElmtId(p0, {
                "imageUrl": local_1_0.curSource.thumbnailUrl
                  || (local_1_0.selectedVideo !== null && local_1_0.selectedVideo !== undefined ? local_1_0.selectedVideo.thumbnailUrl : undefined)
                  || "",
                "placeholderColor": (local_1_0.selectedVideo !== null && local_1_0.selectedVideo !== undefined ? local_1_0.selectedVideo.thumbnailColor : undefined)
                  || "#000000",
                "fillParent": true,
                "useAspectRatio": false,
                "borderRadiusVp": 0
              });
            }
          }, {
            "name": "MediaThumb"
          });
          __Common__.pop();
          local_1_0.observeComponentCreation2(function (p0, p1) {
            LoadingProgress.create();
            LoadingProgress.width(48);
            LoadingProgress.height(48);
            LoadingProgress.color(Color.White);
          }, LoadingProgress);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.isAudioOnlyMode) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.AudioOnlyCoverLayer.bind(local_1_0)();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0.playbackStarted) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else if (local_1_0.vm.isBuffering || local_1_0.vm.isSourceSwitching) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("100%");
            Column.height("100%");
            Column.justifyContent(FlexAlign.Center);
            Column.hitTestBehavior(HitTestMode.None);
            Column.zIndex(CommonConstants.Z_INDEX_BASE + 1);
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            LoadingProgress.create();
            LoadingProgress.width(48);
            LoadingProgress.height(48);
            LoadingProgress.color(Color.White);
          }, LoadingProgress);
          Column.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.curSource.error || local_1_0.hasError) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": 16
            });
            Column.width("100%");
            Column.height("100%");
            Column.backgroundColor("#B3000000");
            Column.justifyContent(FlexAlign.Center);
            Column.zIndex(CommonConstants.Z_INDEX_BASE + 2);
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125832995,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(56);
            SymbolGlyph.fontColor([Color.White]);
            SymbolGlyph.opacity(0.9);
          }, SymbolGlyph);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create({
              "id": 16777659,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Text.fontColor(Color.White);
            Text.fontSize(18);
            Text.fontWeight(FontWeight.Bold);
            Text.textAlign(TextAlign.Center);
          }, Text);
          Text.pop();
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_1_0.getErrorDisplay(local_1_0.curSource.error || local_1_0.vm.userVisibleErrorMsg));
            Text.fontColor("#CCFFFFFF");
            Text.fontSize(13);
            Text.textAlign(TextAlign.Center);
            Text.maxLines(3);
            Text.textOverflow({
              "overflow": TextOverflow.Ellipsis
            });
            Text.padding({
              "left": 32,
              "right": 32
            });
          }, Text);
          Text.pop();
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Button.createWithLabel({
              "id": 16777277,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Button.height(36);
            Button.padding({
              "left": 20,
              "right": 20
            });
            Button.backgroundColor(local_1_0.themePrimary);
            Button.borderRadius(18);
            Button.margin({
              "top": 8
            });
            Button.onClick(function () {
              local_1_0.registerControlActivity();
              local_1_0.hasError = false;
              local_1_0.isWaitingForDualBuffer = false;
              if (local_1_0.onRetry) {
                local_1_0.onRetry();
              } else {
                local_1_0.curSource.error = undefined;
                local_1_0.vm.errorMsg = "";
                local_1_0.controller.updateVideoSource(ObservedObject.GetRawObject(local_1_0.curSource));
              }
            });
          }, Button);
          Button.pop();
          Column.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.subtitleDragging) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("92%");
            Column.height(Math.max(0, local_1_0.displayLayoutVp().videoHVp - 16));
            Column.position({
              "x": local_1_0.containerVpWidth * 0.04,
              "y": local_1_0.displayLayoutVp().letterboxVp + 8
            });
            Column.border({
              "width": 1,
              "color": "#80FFFFFF",
              "style": BorderStyle.Dashed,
              "radius": 8
            });
            Column.zIndex(CommonConstants.Z_INDEX_BASE + 2.4);
            Column.hitTestBehavior(HitTestMode.None);
          }, Column);
          Column.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.vm.currentSubtitleUrl.length > 0 && local_1_0.vm.subtitleText.length > 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("100%");
            Column.alignItems(HorizontalAlign.Center);
            Column.position({
              "bottom": local_1_0.subtitleBottomVp()
            });
            Column.offset({
              "x": local_1_0.subtitleDragOffsetXRatio * local_1_0.containerVpWidth,
              "y": 0
            });
            Column.zIndex(CommonConstants.Z_INDEX_BASE + 2.5);
            Column.hitTestBehavior(HitTestMode.Transparent);
            globalThis.Gesture.create(GesturePriority.Low);
            PanGesture.create({
              "direction": PanDirection.All,
              "fingers": 1,
              "distance": 4
            });
            PanGesture.onActionStart(function () {
              if (!local_1_0.showControls) {
                return;
              }
              local_1_0.subtitleDragging = true;
              local_1_0.subtitleDragStartLiftRatio = local_1_0.subtitleDragLiftRatio;
              local_1_0.subtitleDragStartOffsetXRatio = local_1_0.subtitleDragOffsetXRatio;
              local_1_0.clearHideTimer();
              return;
            });
            PanGesture.onActionUpdate(function (p0) {
              if (!local_1_0.subtitleDragging) {
                return;
              }
              local_1_0.subtitleDragLiftRatio = Math.min(Math.max(local_1_0.subtitleDragStartLiftRatio - p0.offsetY / Math.max(1, local_1_0.displayLayoutVp().videoHVp), -0.5), local_0_10 /*SUBTITLE_DRAG_MAX_RATIO*/);
              local_1_0.subtitleDragOffsetXRatio = Math.min(Math.max(local_1_0.subtitleDragStartOffsetXRatio + p0.offsetX / Math.max(1, local_1_0.containerVpWidth), -local_0_30 /*SUBTITLE_DRAG_X_MAX_RATIO*/), local_0_30 /*SUBTITLE_DRAG_X_MAX_RATIO*/);
              return;
            });
            PanGesture.onActionEnd(function () {
              if (!local_1_0.subtitleDragging) {
                return;
              }
              local_1_0.subtitleDragging = false;
              local_1_0.scheduleHideControls();
              return;
            });
            PanGesture.onActionCancel(function () {
              if (!local_1_0.subtitleDragging) {
                return;
              }
              local_1_0.subtitleDragging = false;
              local_1_0.scheduleHideControls();
              return;
            });
            PanGesture.pop();
            globalThis.Gesture.pop();
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            let v8;
            Text.create(local_1_0.vm.subtitleText);
            Text.fontColor(SUBTITLE_FONT_COLOR_VALUES[local_1_0.playbackConfig.subtitleFontColor]);
            Text.fontSize((local_1_0.isFullLandscapeScreen ? 18 : 14) * Number(local_1_0.playbackConfig.subtitleFontScale));
            Text.textAlign(TextAlign.Center);
            Text.constraintSize({
              "maxWidth": "90%"
            });
            Text.textShadow({
              "radius": 4,
              "color": Color.Black
            });
            Text.padding({
              "left": 12,
              "right": 12,
              "top": 4,
              "bottom": 4
            });
            Text.backgroundColor(local_1_0.subtitleDragging ? "#B3000000" : SUBTITLE_BACKGROUND_VALUES[local_1_0.playbackConfig.subtitleBackground]);
            Text.borderRadius(local_1_0.subtitleDragging ? 12 : 4);
            v8 = {
              "width": local_1_0.subtitleDragging ? 1.5 : 0,
              "color": local_1_0.subtitleDragging ? local_1_0.themePrimary : Color.Transparent,
              "radius": 12
            };
            Text.border(v8);
            v8 = {
              "x": local_1_0.subtitleDragging ? 1.03 : 1,
              "y": local_1_0.subtitleDragging ? 1.03 : 1
            };
            Text.scale(v8);
          }, Text);
          Text.pop();
          Column.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      RelativeContainer.create();
      RelativeContainer.width("100%");
      RelativeContainer.height("100%");
      RelativeContainer.zIndex(CommonConstants.Z_INDEX_BASE + 2.1);
    }, RelativeContainer);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.isGestureSeek) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            let v8;
            v8 = "" + secondToTime(Math.floor(local_1_0.gestureSeekTime)) + " / " + secondToTime(Math.floor(local_1_0.durationTime)) + "";
            Text.create(v8);
            Text.fontColor(Color.White);
            Text.fontSize(26);
            Text.fontWeight(FontWeight.Medium);
            Text.textShadow({
              "radius": 8,
              "color": Color.Black
            });
            Text.alignRules({
              "middle": {
                "anchor": "__container__",
                "align": HorizontalAlign.Center
              },
              "center": {
                "anchor": "__container__",
                "align": VerticalAlign.Center
              }
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
      if (local_1_0.showBackwardHint) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("50%");
            Column.height("100%");
            Column.justifyContent(FlexAlign.Center);
            Column.alignItems(HorizontalAlign.Center);
            Column.alignRules({
              "top": {
                "anchor": "__container__",
                "align": VerticalAlign.Top
              },
              "start": {
                "anchor": "__container__",
                "align": HorizontalAlign.Start
              }
            });
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create("‹ " + local_1_0.playbackConfig.doubleTapSeekSeconds + "s");
            Text.fontColor(Color.White);
            Text.fontSize(26);
            Text.fontWeight(FontWeight.Medium);
            Text.textShadow({
              "radius": 8,
              "color": Color.Black
            });
          }, Text);
          Text.pop();
          Column.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.showForwardHint) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("50%");
            Column.height("100%");
            Column.justifyContent(FlexAlign.Center);
            Column.alignItems(HorizontalAlign.Center);
            Column.alignRules({
              "top": {
                "anchor": "__container__",
                "align": VerticalAlign.Top
              },
              "end": {
                "anchor": "__container__",
                "align": HorizontalAlign.End
              }
            });
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create("" + local_1_0.playbackConfig.doubleTapSeekSeconds + "s ›");
            Text.fontColor(Color.White);
            Text.fontSize(26);
            Text.fontWeight(FontWeight.Medium);
            Text.textShadow({
              "radius": 8,
              "color": Color.Black
            });
          }, Text);
          Text.pop();
          Column.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.showSpeedBoostHint) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create("" + local_1_0.speedBoostTarget + "x");
            Text.fontColor(Color.White);
            Text.fontSize(22);
            Text.fontWeight(FontWeight.Medium);
            Text.padding({
              "left": 16,
              "right": 16,
              "top": 6,
              "bottom": 6
            });
            Text.backgroundColor("#80000000");
            Text.borderRadius(16);
            Text.margin({
              "top": 24
            });
            Text.alignRules({
              "middle": {
                "anchor": "__container__",
                "align": HorizontalAlign.Center
              },
              "top": {
                "anchor": "__container__",
                "align": VerticalAlign.Top
              }
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
      if (local_1_0.showBrightnessHint) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Bottom
            });
            Stack.width("auto");
            Stack.height("auto");
            Stack.alignRules({
              "center": {
                "anchor": "__container__",
                "align": VerticalAlign.Center
              },
              "start": {
                "anchor": "__container__",
                "align": HorizontalAlign.Start
              },
              "end": {
                "anchor": "__container__",
                "align": HorizontalAlign.Center
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Slider.create({
              "value": local_1_0.gestureBrightnessValue,
              "max": 1,
              "min": 0,
              "reverse": true,
              "style": SliderStyle.NONE,
              "direction": Axis.Vertical
            });
            Slider.trackThickness(40);
            Slider.selectedColor(Color.White);
            Slider.height(160);
            Slider.width(40);
          }, Slider);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create(local_1_0.gestureBrightnessIcon);
            SymbolGlyph.fontColor([Color.Gray]);
            SymbolGlyph.margin({
              "bottom": 8
            });
            SymbolGlyph.fontSize(22);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.showVolumeHint) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Bottom
            });
            Stack.width("auto");
            Stack.height("auto");
            Stack.alignRules({
              "center": {
                "anchor": "__container__",
                "align": VerticalAlign.Center
              },
              "start": {
                "anchor": "__container__",
                "align": HorizontalAlign.Center
              },
              "end": {
                "anchor": "__container__",
                "align": HorizontalAlign.End
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Slider.create({
              "value": local_1_0.gestureVolumeValue,
              "max": 1,
              "min": 0,
              "reverse": true,
              "style": SliderStyle.NONE,
              "direction": Axis.Vertical
            });
            Slider.trackThickness(40);
            Slider.selectedColor(Color.White);
            Slider.height(160);
            Slider.width(40);
          }, Slider);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create(local_1_0.gestureVolumeIcon);
            SymbolGlyph.fontColor([Color.Gray]);
            SymbolGlyph.margin({
              "bottom": 8
            });
            SymbolGlyph.fontSize(22);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    RelativeContainer.pop();
    local_1_0.GestureLayer.bind(local_1_0)();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.showCenterPlayButton()) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width("100%");
            Stack.height("100%");
            Stack.hitTestBehavior(HitTestMode.Transparent);
            Stack.zIndex(CommonConstants.Z_INDEX_MAX);
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(72);
            Stack.height(72);
            Stack.borderRadius(36);
            Stack.backgroundColor("#66000000");
            Stack.border({
              "width": 1,
              "color": "#33FFFFFF"
            });
            Stack.onClick(function () {
              local_1_0.togglePlayback();
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create(local_1_0.vm.isEnded ? {
              "id": 125831551,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            } : {
              "id": 125831175,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(34);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.height("100%");
      Column.opacity(local_1_0.showControls ? 1 : 0);
      Column.hitTestBehavior(local_1_0.showControls ? HitTestMode.Transparent : HitTestMode.BLOCK_DESCENDANTS);
      Column.zIndex(CommonConstants.Z_INDEX_MAX);
    }, Column);
    local_1_0.TopControl.bind(local_1_0)();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Blank.create();
      Blank.width("100%");
      Blank.layoutWeight(1);
      Blank.hitTestBehavior(HitTestMode.None);
    }, Blank);
    Blank.pop();
    local_1_0.PlayControl.bind(local_1_0)();
    Column.pop();
    Stack.pop();
  }
  GestureLayer(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.height("100%");
      Column.backgroundColor(Color.Transparent);
      Column.zIndex(CommonConstants.Z_INDEX_BASE + 2.2);
      globalThis.Gesture.create(GesturePriority.Parallel);
      GestureGroup.create(GestureMode.Exclusive);
      TapGesture.create({
        "count": 1,
        "fingers": 1
      });
      TapGesture.onAction(function (p0) {
        local_1_0.onCenterTap(p0);
      });
      TapGesture.pop();
      PanGesture.create({
        "direction": PanDirection.All,
        "fingers": 1,
        "distance": 8
      });
      PanGesture.onActionStart(function (p0) {
        local_1_0.onPlayerPanStart(p0);
      });
      PanGesture.onActionUpdate(function (p0) {
        local_1_0.onPlayerPanUpdate(p0);
      });
      PanGesture.onActionEnd(function (p0) {
        local_1_0.onPlayerPanEnd(false);
      });
      PanGesture.onActionCancel(function (p0) {
        local_1_0.onPlayerPanEnd(true);
      });
      PanGesture.pop();
      LongPressGesture.create({
        "fingers": 1,
        "duration": local_1_0.playbackConfig.holdSpeedDelayMs,
        "repeat": false
      });
      LongPressGesture.onAction(function (p0) {
        local_1_0.onHoldSpeedStart();
      });
      LongPressGesture.onActionEnd(function (p0) {
        local_1_0.onHoldSpeedEnd("release");
      });
      LongPressGesture.onActionCancel(function (p0) {
        local_1_0.onHoldSpeedEnd("cancel");
      });
      LongPressGesture.pop();
      GestureGroup.pop();
      globalThis.Gesture.pop();
    }, Column);
    Column.pop();
  }
  menuSymbol(p0) {
    return new SymbolGlyphModifier(p0).fontSize("22vp");
  }
  TopToolsCollapsedMenu(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Menu.create();
      Menu.onAppear(function () {
        return local_1_0.onControlMenuAppear();
      });
      Menu.onDisAppear(function () {
        return local_1_0.onControlMenuDisappear();
      });
      Menu.backgroundColor({
        "id": 16778153,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Menu.borderRadius(12);
      Menu.menuItemDivider({
        "strokeWidth": LengthMetrics.vp(0.5),
        "color": {
          "id": 125831013,
          "type": 10001,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      Menu.subMenuExpandingMode(SubMenuExpandingMode.EMBEDDED_EXPAND);
      Menu.width(260);
    }, Menu);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.isFullLandscapeScreen && local_1_0.onShowInfoPanel) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            MenuItem.create({
              "symbolStartIcon": local_1_0.menuSymbol({
                "id": 125832646,
                "type": 40000,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }),
              "content": {
                "id": 16777896,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }
            });
            MenuItem.contentFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            MenuItem.contentFont({
              "size": 14
            });
            MenuItem.onClick(function () {
              return local_1_0.onShowInfoPanel !== null && local_1_0.onShowInfoPanel !== undefined ? local_1_0.onShowInfoPanel() : undefined;
            });
          }, MenuItem);
          MenuItem.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0.isLocalMode && local_1_0.chapters.length > 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            MenuItem.create({
              "symbolStartIcon": local_1_0.menuSymbol({
                "id": 125831926,
                "type": 40000,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }),
              "content": {
                "id": 16777894,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              },
              "builder": function () {
                local_1_0.ChapterMenu();
              }
            });
            MenuItem.contentFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            MenuItem.contentFont({
              "size": 14
            });
          }, MenuItem);
          MenuItem.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.curSource.isLive) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else if (!local_1_0.isLocalMode) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            MenuItem.create({
              "symbolStartIcon": local_1_0.menuSymbol({
                "id": 125832924,
                "type": 40000,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }),
              "content": {
                "id": 16777910,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              },
              "builder": function () {
                local_1_0.SubtitleMenu();
              }
            });
            MenuItem.contentFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            MenuItem.contentFont({
              "size": 14
            });
          }, MenuItem);
          MenuItem.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0.curSource.isLive && !local_1_0.isLocalMode && local_1_0.controller.getAudioStreamList().length > 1) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            MenuItem.create({
              "symbolStartIcon": local_1_0.menuSymbol({
                "id": 125831509,
                "type": 40000,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }),
              "content": {
                "id": 16777893,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              },
              "builder": function () {
                local_1_0.AudioMenu();
              }
            });
            MenuItem.contentFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            MenuItem.contentFont({
              "size": 14
            });
          }, MenuItem);
          MenuItem.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.isLocalMode || local_1_0.controller.getMergedVideoList().length <= 0) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else if (!local_1_0.curSource.isLive || local_1_0.vm.playerModel.liveQualityReady) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            MenuItem.create({
              "symbolStartIcon": local_1_0.menuSymbol({
                "id": 125831321,
                "type": 40000,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }),
              "content": {
                "id": 16777912,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              },
              "builder": function () {
                local_1_0.VideoMenu();
              }
            });
            MenuItem.contentFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            MenuItem.contentFont({
              "size": 14
            });
          }, MenuItem);
          MenuItem.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0.curSource.isLive) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            MenuItem.create({
              "symbolStartIcon": local_1_0.menuSymbol({
                "id": 125831173,
                "type": 40000,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              }),
              "content": {
                "id": 16777902,
                "type": 10003,
                "params": [],
                "bundleName": "com.talon.yourpipe",
                "moduleName": "entry"
              },
              "labelInfo": "" + local_1_0.vm.playbackSpeed + "x",
              "builder": function () {
                local_1_0.SpeedMenu();
              }
            });
            MenuItem.contentFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            MenuItem.contentFont({
              "size": 14
            });
            MenuItem.labelFont({
              "size": 14,
              "weight": FontWeight.Medium
            });
            MenuItem.labelFontColor({
              "id": 125830982,
              "type": 10001,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
          }, MenuItem);
          MenuItem.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      MenuItem.create({
        "symbolStartIcon": local_1_0.menuSymbol({
          "id": 125831321,
          "type": 40000,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }),
        "content": {
          "id": 16777891,
          "type": 10003,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        },
        "labelInfo": local_1_0.aspectModeLabel(),
        "builder": function () {
          local_1_0.AspectMenu();
        }
      });
      MenuItem.contentFontColor({
        "id": 125830982,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      MenuItem.contentFont({
        "size": 14
      });
      MenuItem.labelFont({
        "size": 14,
        "weight": FontWeight.Medium
      });
      MenuItem.labelFontColor({
        "id": 125830982,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
    }, MenuItem);
    MenuItem.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      MenuItem.create({
        "symbolStartIcon": local_1_0.menuSymbol({
          "id": 125831488,
          "type": 40000,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }),
        "content": {
          "id": 16777907,
          "type": 10003,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }
      });
      MenuItem.contentFontColor({
        "id": 125830982,
        "type": 10001,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      MenuItem.contentFont({
        "size": 14
      });
      MenuItem.onClick(function () {
        PlayerSession.getInstance().stopPlayback();
        local_1_0.actionHub.closePage();
      });
    }, MenuItem);
    MenuItem.pop();
    Menu.pop();
  }
  TopToolsExpandedRow(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": local_1_0.getControlItemGap()
      });
      Row.alignItems(VerticalAlign.Center);
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.isFullLandscapeScreen && local_1_0.onShowInfoPanel) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(local_0_25 /*SPEED_CONTROL_WIDTH*/);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.accessibilityText({
              "id": 16777896,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Stack.onClick(function () {
              return local_1_0.onShowInfoPanel !== null && local_1_0.onShowInfoPanel !== undefined ? local_1_0.onShowInfoPanel() : undefined;
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125832646,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0.isLocalMode && local_1_0.chapters.length > 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(local_0_25 /*SPEED_CONTROL_WIDTH*/);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.accessibilityText({
              "id": 16777894,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Stack.bindMenu({
              "builder": function () {
                local_1_0.ChapterMenu();
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125831926,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.curSource.isLive) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else if (!local_1_0.isLocalMode) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(local_0_25 /*SPEED_CONTROL_WIDTH*/);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.bindMenu({
              "builder": function () {
                local_1_0.SubtitleMenu();
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125832924,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0.curSource.isLive && !local_1_0.isLocalMode && local_1_0.controller.getAudioStreamList().length > 1) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(local_0_25 /*SPEED_CONTROL_WIDTH*/);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.bindMenu({
              "builder": function () {
                local_1_0.AudioMenu();
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125831509,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.isLocalMode || local_1_0.controller.getMergedVideoList().length <= 0) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else if (!local_1_0.curSource.isLive || local_1_0.vm.playerModel.liveQualityReady) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(local_0_25 /*SPEED_CONTROL_WIDTH*/);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.bindMenu({
              "builder": function () {
                local_1_0.VideoMenu();
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125831321,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0.curSource.isLive) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create(local_1_0.vm.playbackSpeed + "x");
            Text.fontSize(16);
            Text.fontColor(Color.White);
            Text.fontWeight(FontWeight.Medium);
            Text.width(local_0_25 /*SPEED_CONTROL_WIDTH*/);
            Text.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Text.maxLines(1);
            Text.textAlign(TextAlign.Center);
            Text.bindMenu({
              "builder": function () {
                local_1_0.SpeedMenu();
              }
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
      Text.create(local_1_0.aspectModeLabel());
      Text.fontSize(13);
      Text.fontColor(Color.White);
      Text.fontWeight(FontWeight.Medium);
      Text.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
      Text.padding({
        "left": 8,
        "right": 8
      });
      Text.textAlign(TextAlign.Center);
      Text.accessibilityText({
        "id": 16777891,
        "type": 10003,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      Text.bindMenu({
        "builder": function () {
          local_1_0.AspectMenu();
        }
      });
    }, Text);
    Text.pop();
    Row.pop();
  }
  TopControl(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.width("100%");
      Row.alignItems(VerticalAlign.Center);
      Row.padding({
        "left": local_1_0.getControlLeftPad(),
        "right": local_1_0.getControlRightPad(),
        "top": local_1_0.getControlTopPad(),
        "bottom": local_0_23 /*CONTROL_VERTICAL_INSET*/
      });
      Row.linearGradient({
        "direction": GradientDirection.Bottom,
        "colors": [["#66000000", 0], ["#00000000", 1]]
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Center
      });
      Stack.width(local_0_26 /*CONTROL_SLOT_SIZE*/);
      Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
      Stack.onClick(function () {
        PlayerSession.getInstance().release(true);
        local_1_0.actionHub.closePage();
      });
    }, Stack);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125831487,
        "type": 40000,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
      SymbolGlyph.fontWeight(FontWeight.Medium);
      SymbolGlyph.fontColor([Color.White]);
    }, SymbolGlyph);
    Stack.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Blank.create();
    }, Blank);
    Blank.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.shouldCollapseTopTools()) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.accessibilityText({
              "id": 16777901,
              "type": 10003,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            Stack.bindMenu({
              "builder": function () {
                local_1_0.TopToolsCollapsedMenu();
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125831665,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {
          local_1_0.TopToolsExpandedRow.bind(local_1_0)();
        });
      }
    }, If);
    If.pop();
    Row.pop();
  }
  PlayControl(p0) {
    let local_1_0;
    local_1_0 = this;
    if (p0 === undefined) {}
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": local_1_0.getControlItemGap()
      });
      Row.width("100%");
      Row.alignItems(VerticalAlign.Center);
      Row.padding({
        "left": local_1_0.getControlLeftPad(),
        "right": local_1_0.getControlRightPad(),
        "bottom": local_1_0.getControlBottomPad()
      });
      Row.linearGradient({
        "direction": GradientDirection.Bottom,
        "colors": [["#00000000", 0], ["#66000000", 1]]
      });
      Row.onAreaChange(function (p0, p1) {
        local_1_0.bottomControlBarVpH = Number(p1.height);
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Center
      });
      Stack.width(local_0_26 /*CONTROL_SLOT_SIZE*/);
      Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
      Stack.opacity(local_1_0.vm.isReady && local_1_0.hasStreams ? 1 : 0.4);
      Stack.enabled(local_1_0.vm.isReady && local_1_0.hasStreams);
      Stack.onClick(function () {
        return local_1_0.togglePlayback();
      });
    }, Stack);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create(local_1_0.vm.isPlaying ? {
        "id": 125831176,
        "type": 40000,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      } : {
        "id": 125831175,
        "type": 40000,
        "params": [],
        "bundleName": "com.talon.yourpipe",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
      SymbolGlyph.fontColor([Color.White]);
    }, SymbolGlyph);
    Stack.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.curSource.isLive) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": 6
            });
            Row.layoutWeight(1);
            Row.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Row.justifyContent(FlexAlign.Center);
            Row.alignItems(VerticalAlign.Center);
          }, Row);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Circle.create({
              "width": 8,
              "height": 8
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
            Text.fontColor(Color.White);
            Text.fontSize(13);
            Text.fontWeight(FontWeight.Medium);
          }, Text);
          Text.pop();
          Row.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.layoutWeight(1);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.constraintSize({
              "minWidth": local_0_32 /*PROGRESS_MIN_WIDTH*/
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Slider.create({
              "value": 0,
              "max": 100,
              "style": local_1_0.sliderStyle
            });
            Slider.width("100%");
            Slider.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Slider.trackColor("#33FFFFFF");
            Slider.selectedColor(Color.Transparent);
            Slider.blockColor(Color.Transparent);
            Slider.trackThickness(local_1_0.trackThicknessSize);
            Slider.hitTestBehavior(HitTestMode.None);
          }, Slider);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Canvas.create(local_1_0.cacheCanvasCtx);
            Canvas.width("100%");
            Canvas.height(local_1_0.trackThicknessSize);
            Canvas.hitTestBehavior(HitTestMode.None);
            Canvas.onReady(function () {
              local_1_0.drawCacheRanges();
            });
          }, Canvas);
          Canvas.pop();
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Slider.create({
              "value": local_1_0.isSliderDragging ? local_1_0.sliderDragValue : local_1_0.isGestureSeek ? local_1_0.gestureSeekTime : local_1_0.currentTime,
              "max": local_1_0.durationTime,
              "style": local_1_0.sliderStyle
            });
            Slider.width("100%");
            Slider.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Slider.trackColor(Color.Transparent);
            Slider.selectedColor(Color.White);
            Slider.trackThickness(local_1_0.trackThicknessSize);
            Slider.enabled(!!(local_1_0.vm.isReady && local_1_0.hasStreams));
            Slider.onTouch(function (p0) {
              return local_1_0.onSliderTouch(p0);
            });
            Slider.onChange(function (p0, p1) {
              return local_1_0.sliderOnchange(p0, p1);
            });
          }, Slider);
          Stack.pop();
        });
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.shouldShowTimelineText()) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Text.create("" + secondToTime(Math.floor(local_1_0.isSliderDragging ? local_1_0.sliderDragValue : local_1_0.isGestureSeek ? local_1_0.gestureSeekTime : local_1_0.currentTime)) + " / " + secondToTime(Math.floor(local_1_0.durationTime)) + "");
            Text.fontColor("#DDFFFFFF");
            Text.fontSize(13);
            Text.width(local_1_0.getCombinedTimeLabelWidth());
            Text.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Text.maxLines(1);
            Text.textOverflow({
              "overflow": TextOverflow.Clip
            });
            Text.textAlign(TextAlign.Center);
            Text.flexShrink(0);
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
      if (local_1_0.showFullscreenButton) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.Center
            });
            Stack.width(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.height(local_0_26 /*CONTROL_SLOT_SIZE*/);
            Stack.onClick(function () {
              local_1_0.registerControlActivity();
              if (local_1_0.onFullScreenClick !== null && local_1_0.onFullScreenClick !== undefined) {
                local_1_0.onFullScreenClick(!local_1_0.isFullLandscapeScreen);
              }
            });
          }, Stack);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create(local_1_0.isFullLandscapeScreen ? {
              "id": 125832701,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            } : {
              "id": 125832700,
              "type": 40000,
              "params": [],
              "bundleName": "com.talon.yourpipe",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(local_0_31 /*CONTROL_ICON_SIZE*/);
            SymbolGlyph.fontColor([Color.White]);
          }, SymbolGlyph);
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Row.pop();
  }
  sliderOnchange(p0, p1) {
    switch (p1) {
      case SliderChangeMode.Begin:
        this.sliderTouchCanceled = false;
        this.gestureMode = local_0_2.IGNORED;
        this.beginInteraction(local_0_3.SLIDER);
        this.isSliderDragging = true;
        this.sliderDragValue = this.currentTime;
        this.trackThicknessSize = CommonConstants.TRACK_SIZE_MAX;
        this.sliderStyle = SliderStyle.InSet;
        break;
      case SliderChangeMode.Moving:
        this.sliderDragValue = p0;
        this.isSliderDragging = true;
        this.trackThicknessSize = CommonConstants.TRACK_SIZE_MAX;
        this.sliderStyle = SliderStyle.InSet;
        break;
      case SliderChangeMode.End:
        if (!this.sliderTouchCanceled) {
          this.controller.syncSeekFast(p0 * 1000);
        } else {
          Logger.debug(local_0_1 /*TAG*/, "Slider seek canceled; final value not committed");
        }
        this.isSliderDragging = false;
        this.sliderDragValue = p0;
        this.trackThicknessSize = CommonConstants.TRACK_SIZE_MIN;
        this.sliderStyle = SliderStyle.NONE;
        this.gestureMode = local_0_2.IDLE;
        this.activeInteraction = local_0_3.NONE;
        this.sliderTouchCanceled = false;
        this.scheduleHideControls();
        break;
    }
  }
  onSliderTouch(p0) {
    if (p0.type === TouchType.Down) {
      this.sliderTouchCanceled = false;
    } else if (p0.type === TouchType.Cancel) {
      this.sliderTouchCanceled = true;
      this.isSliderDragging = false;
      this.trackThicknessSize = CommonConstants.TRACK_SIZE_MIN;
      this.sliderStyle = SliderStyle.NONE;
      this.gestureMode = local_0_2.IDLE;
      if (this.activeInteraction === local_0_3.SLIDER) {
        this.activeInteraction = local_0_3.NONE;
      }
      Logger.debug(local_0_1 /*TAG*/, "Slider touch canceled");
      this.scheduleHideControls();
    }
  }
  aboutToDisappear() {
    this.resetTransientUi("component-disappear");
    this.controller.removeStateListener(this.keepScreenListener);
    this.envService.release();
    this.controller.unsubscribeProgress(this.progressListener);
    this.controller.unsubscribePlaybackState(this.playbackStateListener);
    this.controller.removeErrorListener(this.errorListener);
    this.controller.removeWaitingForBufferListener(this.waitingForBufferListener);
    this.controller.removeSeekableRangesListener(this.seekableRangesListener);
    SubtitleTranslationService.getInstance().removeProgressListener(this.aiTranslateProgressListener);
  }
  rerender() {
    this.updateDirtyElements();
  }
};
local_0_0 = class panda_jmp0_reserved_anonymous_1 {
  constructor(p0) {
    this.owner = p0;
  }
  onStateChange(p0, p1) {
    this.owner._onKeepScreenStateChanged(p1);
  }
};
export { VideoPlayer };