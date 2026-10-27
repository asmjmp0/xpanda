/*
* class name:L&entry/src/main/ets/pages/ContentDetailPages&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AnswerDoubleTapAction } from "@normalized:N&&&data/Index&1.0.0";
import { AnswerTitleBar } from "@normalized:N&&&entry/src/main/ets/pages/AnswerTitleBar&";
import { AppDestinationName } from "@normalized:N&&&core/Index&1.0.0";
import { AppPageStatusKind } from "@normalized:N&&&entry/src/main/ets/pages/AppPageChrome&";
import { AppPageStatusPanel } from "@normalized:N&&&entry/src/main/ets/pages/AppPageChrome&";
import { AppPreferencesStore } from "@normalized:N&&&data/Index&1.0.0";
import { BlockingActionController } from "@normalized:N&&&entry/src/main/ets/pages/BlockingActionState&";
import { CollectionDialogComponent } from "@normalized:N&&&entry/src/main/ets/pages/CollectionDialogComponent&";
import { ContentDetailController } from "@normalized:N&&&entry/src/main/ets/pages/ContentDetailState&";
import { ContentDetailKind } from "@normalized:N&&&data/Index&1.0.0";
import { ContentDetailPhase } from "@normalized:N&&&entry/src/main/ets/pages/ContentDetailState&";
import { ContentImagePreview } from "@normalized:N&&&entry/src/main/ets/pages/NativeContentDocument&";
import { ContentVoteController } from "@normalized:N&&&entry/src/main/ets/pages/ContentInteractionState&";
import { ContentVoteState } from "@normalized:N&&&data/Index&1.0.0";
import { DEFAULT_THEME_COLOR } from "@normalized:N&&&data/Index&1.0.0";
import { FLOATING_TITLE_BAR_OFFSET } from "@normalized:N&&&entry/src/main/ets/pages/AppPageChrome&";
import { FeedContentSummary } from "@normalized:N&&&entry/src/main/ets/pages/components/FeedContentSummary&";
import { FeedPullDownIndicatorHost } from "@normalized:N&&&entry/src/main/ets/pages/AppPageChrome&";
import { FollowController } from "@normalized:N&&&entry/src/main/ets/pages/ContentInteractionState&";
import { GlassCapsule } from "@normalized:N&&&entry/src/main/ets/pages/components/MaterialCanvas&";
import { NativeContentDocument } from "@normalized:N&&&entry/src/main/ets/pages/NativeContentDocument&";
import { OpenedRecordPhase } from "@normalized:N&&&entry/src/main/ets/pages/ContentDetailState&";
import { QuestionAnswerDataSource } from "@normalized:N&&&entry/src/main/ets/pages/QuestionAnswerDataSource&";
import { QuestionAnswerNavigator } from "@normalized:N&&&entry/src/main/ets/pages/QuestionAnswerNavigator&";
import { QuestionAnswerSortOrder } from "@normalized:N&&&data/Index&1.0.0";
import { QuestionAnswersController } from "@normalized:N&&&entry/src/main/ets/pages/QuestionAnswersState&";
import { QuestionAnswersPhase } from "@normalized:N&&&entry/src/main/ets/pages/QuestionAnswersState&";
import { SegmentButton } from "@ohos:arkui.advanced.SegmentButton";
import { SegmentButtonOptions } from "@ohos:arkui.advanced.SegmentButton";
import { SegmentPill } from "@normalized:N&&&entry/src/main/ets/pages/components/SegmentPill&";
import { SessionStatus } from "@normalized:N&&&data/Index&1.0.0";
import { ShareOutcome } from "@normalized:N&&&entry/src/main/ets/platform/ShareContracts&";
import { SharePayloadKind } from "@normalized:N&&&entry/src/main/ets/platform/ShareContracts&";
import { SpeechPlaybackStatus } from "@normalized:N&&&entry/src/main/ets/platform/SpeechPlaybackService&";
import { acceptsContentDocumentEvent } from "@normalized:N&&&entry/src/main/ets/pages/ContentDetailState&";
import { accumulateAnswerSwitchDrag } from "@normalized:N&&&entry/src/main/ets/pages/AnswerSwitchGesture&";
import { answerDoubleTapActionLabel } from "@normalized:N&&&data/Index&1.0.0";
import { contentLinkDestination } from "@normalized:N&&&entry/src/main/ets/pages/NotificationLinkResolver&";
import { createSystemShareService } from "@normalized:N&&&entry/src/main/ets/platform/SystemShareService&";
import curves from "@native:ohos.curves";
import { defaultSpeechPreferences } from "@normalized:N&&&data/Index&1.0.0";
import { effectiveSegmentMeta } from "@normalized:N&&&data/Index&1.0.0";
import { feedItemIdentity } from "@normalized:N&&&data/Index&1.0.0";
import { getAbilityContext } from "@normalized:N&&&entry/src/main/ets/entryability/AbilityContextHolder&";
import { getSpeechPlaybackService } from "@normalized:N&&&entry/src/main/ets/platform/SpeechPlaybackService&";
import { hdsMaterial } from "@hms:hds.hdsMaterial";
import hilog from "@ohos:hilog";
import motion from "@ohos:multimodalAwareness.motion";
import { onThemeColor } from "@normalized:N&&&data/Index&1.0.0";
import { parseZhihuHtml } from "@normalized:N&&&reader/Index&1.0.0";
import pasteboard from "@ohos:pasteboard";
import { performConfirmHaptic } from "@normalized:N&&&entry/src/main/ets/platform/HapticFeedback&";
import { publishAnswerTitle } from "@normalized:N&&&entry/src/main/ets/pages/AnswerTitleBar&";
import { publishArticleTitle } from "@normalized:N&&&entry/src/main/ets/pages/ArticleTitleBar&";
import { publishQuestionTitle } from "@normalized:N&&&entry/src/main/ets/pages/QuestionTitleBar&";
import { readerBodyFontSize } from "@normalized:N&&&entry/src/main/ets/pages/ReaderTypography&";
import { readerBodyLineHeight } from "@normalized:N&&&entry/src/main/ets/pages/ReaderTypography&";
import { setStatusBarHidden } from "@normalized:N&&&entry/src/main/ets/platform/SystemBars&";
import { stageAnswerEditSeed } from "@normalized:N&&&entry/src/main/ets/pages/AnswerEditSeedStore&";
import { stageQuestionAnswerNavigator } from "@normalized:N&&&entry/src/main/ets/pages/QuestionAnswerNavigator&";
import { stageVideoPlaybackContext } from "@normalized:N&&&entry/src/main/ets/pages/VideoPlaybackHandoff&";
import { takeQuestionAnswerNavigator } from "@normalized:N&&&entry/src/main/ets/pages/QuestionAnswerNavigator&";
import { themeColorContainerColor } from "@normalized:N&&&data/Index&1.0.0";
let local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_9, local_0_11;
let local_0_12 = function (p0, p1) {
  let v0 = Math.min(1, Math.max(0, p1));
  if (v0 >= 1) {
    return p0;
  }
  return "" + p0 + "" + Math.round(v0 * 255).toString(16).padStart(2, "0") + "";
};
let local_0_0 = function (p0) {
  let v2 = {
    "buttons": [{
      "text": "默认"
    }, {
      "text": "最新"
    }],
    "backgroundColor": {
      "id": 50331657,
      "type": 10001,
      "params": [],
      "bundleName": "com.github.zhuoyi233.zhplus",
      "moduleName": "entry"
    },
    "fontColor": {
      "id": 50331664,
      "type": 10001,
      "params": [],
      "bundleName": "com.github.zhuoyi233.zhplus",
      "moduleName": "entry"
    },
    "selectedBackgroundColor": themeColorContainerColor(p0),
    "selectedFontColor": p0
  };
  return SegmentButtonOptions.tab(v2);
};
export function contentAuthorAvatarUrl(p0) {
  let v0 = (p0.value.author === null || p0.value.author === undefined ? undefined : p0.value.author.avatarUrl === null || p0.value.author.avatarUrl === undefined ? undefined : p0.value.author.avatarUrl.trim())
    ?? "";
  if (v0.startsWith("http://")) {
    v0 = "https://" + v0.substring(7) + "";
  }
  return new RegExp("^https:\\/\\/[A-Za-z0-9.-]+").test(v0) ? v0 : "";
}
export function contentAuthorBadge(p0) {
  let v1;
  let v0 = p0.value.author === null || p0.value.author === undefined ? undefined : p0.value.author.badge;
  if (v0 === undefined || v0.iconUrl.trim().length === 0) {
    return undefined;
  }
  v1 = v0.iconUrl.startsWith("http://") ? "https://" + v0.iconUrl.substring(7) + "" : v0.iconUrl;
  return new RegExp("^https:\\/\\/[A-Za-z0-9.-]+").test(v1) ? {
    "title": v0.title,
    "description": v0.description,
    "iconUrl": v1
  } : undefined;
}
export function contentAuthorHeadline(p0) {
  return (p0.value.author === null || p0.value.author === undefined ? undefined : p0.value.author.headline === null || p0.value.author.headline === undefined ? undefined : p0.value.author.headline.trim())
    ?? "";
}
export function contentAuthorName(p0) {
  return (p0.value.author === null || p0.value.author === undefined ? undefined : p0.value.author.name) ?? "";
}
export function contentBlockingTitle(p0) {
  let v0;
  if (p0.kind === ContentDetailKind.QUESTION || p0.kind === ContentDetailKind.ARTICLE) {
    return p0.value.title;
  }
  v0 = p0.value.excerpt.trim();
  if (v0.length <= 0) {
    v0 = "回答";
  }
  return v0;
}
export function contentContextTitle(p0) {
  if (p0.kind === ContentDetailKind.ANSWER) {
    return (p0.value.questionTitle === null || p0.value.questionTitle === undefined ? undefined : p0.value.questionTitle.trim())
      ?? "";
  }
  return contentTitle(p0).trim();
}
export function contentCreatedAtText(p0) {
  let v0;
  if (p0.kind !== ContentDetailKind.ANSWER && p0.kind !== ContentDetailKind.ARTICLE) {
    return "";
  }
  v0 = formatContentDateTime(p0.value.createdAt);
  return v0.length > 0 ? "发布于 " + v0 + "" : "";
}
export function contentDetailPageTitle(p0) {
  switch (p0) {
    case ContentDetailKind.QUESTION:
      return "问题";
    case ContentDetailKind.ANSWER:
      return "回答";
    case ContentDetailKind.ARTICLE:
      return "文章";
    default:
      return;
  }
}
export function contentEmptyMessage(p0) {
  let v0;
  if (p0.kind === ContentDetailKind.QUESTION) {
    return "问题暂时没有补充说明";
  }
  v0 = p0.value.excerpt.trim();
  if (v0.length <= 0) {
    v0 = "正文为空";
  }
  return v0;
}
export function contentEndorsements(p0) {
  if (p0.kind === ContentDetailKind.QUESTION) {
    return [];
  }
  return p0.value.endorsements ?? [];
}
export function contentHtml(p0) {
  if (p0.kind === ContentDetailKind.QUESTION) {
    return p0.value.detailHtml;
  }
  if (p0.kind !== ContentDetailKind.ANSWER && p0.kind !== ContentDetailKind.ARTICLE) {
    return;
  }
  return p0.value.contentHtml;
}
export function contentIpInfo(p0) {
  if (p0.kind === ContentDetailKind.QUESTION) {
    return "";
  }
  return (p0.value.ipInfo ?? "").trim();
}
export function contentShareSummary(p0) {
  let v0;
  return p0.kind !== ContentDetailKind.ANSWER && p0.kind !== ContentDetailKind.ARTICLE && (v0 = p0.value.excerpt.trim(), v0.length > 0) ? v0 : "来自知乎++的受信内容链接";
}
export function contentShareThumbnailUrl(p0) {
  let v0 = contentAuthorAvatarUrl(p0);
  if (!new RegExp("^https:\\/\\/(?:pic|pica|picx|pic[0-9]+)\\.zhimg\\.com\\/").test(v0)) {
    v0 = undefined;
  }
  return v0;
}
export function contentSpeechText(p0) {
  let v1 /*parseZhihuHtml*/, acc;
  let local_1_0 = [];
  v1 = contentContextTitle(p0);
  if (v1.length > 0) {
    local_1_0.push(v1);
  }
  acc = contentAuthorName(p0).trim();
  if (acc.length > 0) {
    local_1_0.push("作者 " + acc + "");
  }
  v1 = parseZhihuHtml(contentHtml(p0));
  v1.forEach(function (p0) {
    let v0 = p0.text.trim();
    if (v0.length > 0) {
      local_1_0.push(v0);
    }
  });
  if (v1.length === 0) {
    v1 = p0.kind === ContentDetailKind.ANSWER;
    if (p0.kind !== ContentDetailKind.ANSWER) {
      v1 = p0.kind === ContentDetailKind.ARTICLE;
    }
    if (v1 && (v1 = p0.value.excerpt.trim(), v1.length > 0)) {
      local_1_0.push(v1);
    }
  }
  return local_1_0.join("。\n");
}
export function contentStatistics(p0, p1, p2) {
  if (p0.kind === ContentDetailKind.QUESTION) {
    if (p2 == null) {
      p2 = p0.value.followerCount;
    }
    return "" + p0.value.answerCount + " 个回答 · " + p2 + " 人关注 · " + ("" + p0.value.commentCount + " 条评论");
  }
  if (p0.kind !== ContentDetailKind.ANSWER && p0.kind !== ContentDetailKind.ARTICLE) {
    return;
  }
  if (p1 == null) {
    p1 = p0.value.voteupCount;
  }
  return "" + p1 + " 赞同 · " + p0.value.commentCount + " 条评论";
}
export function contentTitle(p0) {
  switch (p0.kind) {
    case ContentDetailKind.QUESTION:
      return p0.value.title;
    case ContentDetailKind.ANSWER:
      return "回答";
    case ContentDetailKind.ARTICLE:
      return p0.value.title;
    default:
      return;
  }
}
export function contentUpdatedAtText(p0) {
  let v1 /*ContentDetailKind*/;
  if (p0.kind !== ContentDetailKind.ANSWER && p0.kind !== ContentDetailKind.ARTICLE) {
    return "";
  }
  if (p0.value.updatedAt <= 0 || p0.value.updatedAt === p0.value.createdAt) {
    return "";
  }
  v1 = formatContentDateTime(p0.value.updatedAt);
  return v1.length > 0 ? "编辑于 " + v1 + "" : "";
}
local_0_2 = function (p0, p1, p2) {
  return (p0 < 0 ? -1 : 1) * p1 * Math.tanh(Math.abs(p0) / (p1 * p2));
};
local_0_8 = function (p0) {
  let v0 = p0.backgroundColorGroup ?? "";
  if (v0.startsWith("GBK") || v0.startsWith("GBL") || v0.startsWith("GRD") || v0.startsWith("GYL")) {
    v0 = local_0_11(v0);
    return local_0_12(v0, p0.backgroundColorAlpha);
  }
  return {
    "id": 50331657,
    "type": 10001,
    "params": [],
    "bundleName": "com.github.zhuoyi233.zhplus",
    "moduleName": "entry"
  };
};
local_0_11 = function (p0) {
  switch (p0) {
    case "GBK02A":
      return "#191B1F";
    case "GBK03A":
      return "#373A40";
    case "GBK06A":
    case "GBK06B":
    case "GBK07A":
      return "#9196A1";
    case "GBK10A":
    case "GBK10B":
    case "GBK12A":
      return "#F8F8FA";
    case "GBL01A":
      return "#1772F6";
    case "GRD01A":
    case "GRD03A":
      return "#F05159";
    case "GRD10A":
      return "#FF501A";
    case "GYL01A":
      return "#F77A31";
    default:
      return "#0066FF";
  }
};
local_0_9 = function (p0) {
  let v0 /*DEFAULT_THEME_COLOR*/ = p0.textColorGroup ?? "";
  if (v0.startsWith("GBK") || v0.startsWith("GBL") || v0.startsWith("GRD") || v0.startsWith("GYL")) {
    return local_0_11(v0);
  }
  return AppStorage.get("resolvedThemeColor") ?? DEFAULT_THEME_COLOR;
};
export function formatContentDateTime(p0) {
  let v0, v1, v2, v3;
  if (!Number.isFinite(p0) || p0 <= 0) {
    return "";
  }
  v0 = new Date(p0 * 1000);
  v1 = function (p0) {
    return p0 < 10 ? "0" + p0 + "" : "" + p0 + "";
  };
  v2 = "" + v0.getFullYear() + "-" + v1(v0.getMonth() + 1) + "-" + v1(v0.getDate()) + " ";
  v3 = "" + v1(v0.getHours()) + ":";
  v0 = v0.getMinutes();
  v0 = v3 + v1(v0);
  return v2 + (v0 + "");
}
local_0_1 = function (p0) {
  let acc = p0.map(function (p0) {
    let local_1_0, local_1_1;
    if (p0.marks.length <= 1) {
      return p0;
    }
    local_1_0 = new Map();
    p0.marks.forEach(function (p0) {
      let v1 /*groups*/ = local_1_0.get("" + p0.startIndex + ":" + p0.endIndex + "");
      if (v1 === undefined) {
        local_1_0.set("" + p0.startIndex + ":" + p0.endIndex + "", [p0]);
      } else {
        v1.push(p0);
      }
    });
    local_1_1 = [];
    local_1_0.forEach(function (p0) {
      let v0 /*merged*/;
      let local_2_0, local_2_1, local_2_2, local_2_3, local_2_4, local_2_5;
      v0 = p0.filter(function (p0) {
        return p0.masterSegInfo !== undefined;
      }).concat(p0.filter(function (p0) {
        return p0.masterSegInfo === undefined;
      }));
      local_2_0 = [];
      v0.forEach(function (p0) {
        let v0 /*effectiveSegmentMeta*/ = effectiveSegmentMeta(p0);
        if (v0 === undefined) {
          return;
        }
        v0.segIds.forEach(function (p0) {
          if (!local_2_0.includes(p0)) {
            local_2_0.push(p0);
          }
        });
        return;
      });
      local_2_1 = 0;
      local_2_2 = 0;
      local_2_3 = 0;
      local_2_4 = false;
      local_2_5 = false;
      v0.forEach(function (p0) {
        let v0 /*effectiveSegmentMeta*/ = effectiveSegmentMeta(p0);
        if (v0 === undefined) {
          return;
        }
        local_2_1 = Math.max(local_2_1 /*likeCount*/, v0.likeCount);
        local_2_2 = Math.max(local_2_2 /*commentCount*/, v0.commentCount);
        local_2_3 = Math.max(local_2_3 /*myCommentCount*/, v0.myCommentCount);
        local_2_4 = local_2_4 /*isLike*/ || v0.isLike;
        local_2_5 = local_2_5 /*isSpan*/ || v0.isSpan;
        return;
      });
      local_1_1.push({
        "startIndex": p0[0].startIndex,
        "endIndex": p0[0].endIndex,
        "segInfo": {
          "segIds": local_2_0,
          "isLike": local_2_4,
          "likeCount": local_2_1,
          "commentCount": local_2_2,
          "myCommentCount": local_2_3,
          "isSpan": local_2_5
        }
      });
    });
    local_1_1.sort(function (p0, p1) {
      return p0.startIndex - p1.startIndex;
    });
    return {
      "pid": p0.pid,
      "text": p0.text,
      "marks": local_1_1
    };
  });
  return acc;
};
if (!("finalizeConstruction" in ViewPU.prototype)) {
  Reflect.set(ViewPU.prototype, "finalizeConstruction", function () {});
}
class ContentDetailPage extends ViewPU {
  constructor(p0, p1, p2, p3, p4, p5) {
    let v3 /*DEFAULT_THEME_COLOR*/;
    let local_1_0 = this;
    if (p3 === undefined) {
      p3 = -1;
    }
    if (p4 === undefined) {
      p4 = undefined;
    }
    local_1_0 = super(p0, p2, p3, p5);
    if (typeof p4 === "function") {
      local_1_0.paramsGenerator_ = p4;
    }
    local_1_0.kind = ContentDetailKind.QUESTION;
    local_1_0.contentId = "";
    local_1_0.__activeContentId = new ObservedPropertySimplePU("", local_1_0, "activeContentId");
    local_1_0.__refreshingAnswers = new ObservedPropertySimplePU(false, local_1_0, "refreshingAnswers");
    local_1_0.__navigatorBusy = new ObservedPropertySimplePU(false, local_1_0, "navigatorBusy");
    local_1_0.__navigatorRevision = new ObservedPropertySimplePU(0, local_1_0, "navigatorRevision");
    local_1_0.__answerOverscrollOffset = new ObservedPropertySimplePU(0, local_1_0, "answerOverscrollOffset");
    local_1_0.__answerViewportWidthVp = new ObservedPropertySimplePU(0, local_1_0, "answerViewportWidthVp");
    local_1_0.__contentAtBottom = new ObservedPropertySimplePU(false, local_1_0, "contentAtBottom");
    local_1_0.__contentAtTop = new ObservedPropertySimplePU(true, local_1_0, "contentAtTop");
    local_1_0.overscrollRawDrag = 0;
    local_1_0.bodyTextSelectionActive = false;
    local_1_0.__previewFontSizePercent = local_1_0.createStorageProp("contentFontSize", 100, "previewFontSizePercent");
    local_1_0.__previewLineHeightPercent = local_1_0.createStorageProp("contentLineHeight", 160, "previewLineHeightPercent");
    local_1_0.__resolvedThemeColor = local_1_0.createStorageProp("resolvedThemeColor", DEFAULT_THEME_COLOR, "resolvedThemeColor");
    local_1_0.overscrollPanPrevY = 0;
    local_1_0.__answerFabOffsetX = new ObservedPropertySimplePU(0, local_1_0, "answerFabOffsetX");
    local_1_0.__answerFabOffsetY = new ObservedPropertySimplePU(0, local_1_0, "answerFabOffsetY");
    local_1_0.answerFabPanPrevX = 0;
    local_1_0.answerFabPanPrevY = 0;
    local_1_0.answerFabDragging = false;
    local_1_0.answerFabWidthVp = 0;
    local_1_0.answerFabOverlayWidthVp = 0;
    local_1_0.answerFabOverlayHeightVp = 0;
    local_1_0.answerFabPositionLoaded = false;
    local_1_0.__answerFabPositionReady = new ObservedPropertySimplePU(false, local_1_0, "answerFabPositionReady");
    local_1_0.answerFabPositionApplied = false;
    local_1_0.savedAnswerFabPosition = undefined;
    local_1_0.answerFabPreferences = undefined;
    local_1_0.bottomActionBarHeightVp = 0;
    local_1_0.__loginTick = local_1_0.createStorageProp("loginFeedReloadTick", 0, "loginTick");
    local_1_0.__imagePreviewUrl = local_1_0.createStorageProp("imagePreviewUrl", "", "imagePreviewUrl");
    local_1_0.__authenticated = new ObservedPropertySimplePU(false, local_1_0, "authenticated");
    local_1_0.answerNavigator = undefined;
    local_1_0.answerDataSource = new QuestionAnswerDataSource();
    local_1_0.indicator = undefined;
    local_1_0.questionScrolled = false;
    local_1_0.answerQuestionScrolled = false;
    local_1_0.articleTitleScrolled = false;
    local_1_0.contentTitleHeightVp = 0;
    local_1_0.pageActive = false;
    local_1_0.repository = undefined;
    local_1_0.linkCardMetaRepository = undefined;
    local_1_0.openedContentStore = undefined;
    local_1_0.historyUploader = undefined;
    local_1_0.rules = undefined;
    local_1_0.history = undefined;
    local_1_0.voteRepository = undefined;
    local_1_0.segmentReactionRepository = undefined;
    local_1_0.followRepository = undefined;
    local_1_0.collectionRepository = undefined;
    local_1_0.commentRepository = undefined;
    local_1_0.session = undefined;
    local_1_0.navigate = function (p0) {};
    local_1_0.questionAnswerFeedFactory = function () {
      return undefined;
    };
    local_1_0.onBack = function () {};
    local_1_0.__phase = new ObservedPropertySimplePU(ContentDetailPhase.IDLE, local_1_0, "phase");
    local_1_0.__content = new ObservedPropertyObjectPU(undefined, local_1_0, "content");
    local_1_0.__errorMessage = new ObservedPropertySimplePU("", local_1_0, "errorMessage");
    local_1_0.__requiresLogin = new ObservedPropertySimplePU(false, local_1_0, "requiresLogin");
    local_1_0.__openedRecordPhase = new ObservedPropertySimplePU(OpenedRecordPhase.NOT_CONFIGURED, local_1_0, "openedRecordPhase");
    local_1_0.__pendingUserBlock = new ObservedPropertyObjectPU(undefined, local_1_0, "pendingUserBlock");
    local_1_0.__keywordBlockVisible = new ObservedPropertySimplePU(false, local_1_0, "keywordBlockVisible");
    local_1_0.__keywordBlockInput = new ObservedPropertySimplePU("", local_1_0, "keywordBlockInput");
    local_1_0.__blockingMessage = new ObservedPropertySimplePU("", local_1_0, "blockingMessage");
    local_1_0.__blockingBusy = new ObservedPropertySimplePU(false, local_1_0, "blockingBusy");
    local_1_0.__voteState = new ObservedPropertySimplePU(ContentVoteState.NEUTRAL, local_1_0, "voteState");
    local_1_0.__voteupCount = new ObservedPropertySimplePU(0, local_1_0, "voteupCount");
    local_1_0.__thanked = new ObservedPropertySimplePU(false, local_1_0, "thanked");
    local_1_0.__thanksCount = new ObservedPropertySimplePU(0, local_1_0, "thanksCount");
    local_1_0.__following = new ObservedPropertySimplePU(false, local_1_0, "following");
    local_1_0.__followerCount = new ObservedPropertySimplePU(0, local_1_0, "followerCount");
    local_1_0.__interactionPending = new ObservedPropertySimplePU(false, local_1_0, "interactionPending");
    local_1_0.__interactionErrorMessage = new ObservedPropertySimplePU("", local_1_0, "interactionErrorMessage");
    local_1_0.__interactionRequiresLogin = new ObservedPropertySimplePU(false, local_1_0, "interactionRequiresLogin");
    local_1_0.__favoriteDialogShown = new ObservedPropertySimplePU(false, local_1_0, "favoriteDialogShown");
    local_1_0.__contentFavorited = new ObservedPropertySimplePU(false, local_1_0, "contentFavorited");
    local_1_0.favoriteStateContentId = "";
    local_1_0.__answerDoubleTapAction = local_1_0.createStorageProp("answerDoubleTapAction", AnswerDoubleTapAction.ASK, "answerDoubleTapAction");
    local_1_0.__titleAutoHide = local_1_0.createStorageProp("titleAutoHide", false, "titleAutoHide");
    local_1_0.__autoHideArticleBottomBar = local_1_0.createStorageProp("autoHideArticleBottomBar", false, "autoHideArticleBottomBar");
    local_1_0.__buttonSkipAnswer = local_1_0.createStorageProp("buttonSkipAnswer", true, "buttonSkipAnswer");
    local_1_0.__autoHideSkipAnswerButton = local_1_0.createStorageProp("autoHideSkipAnswerButton", true, "autoHideSkipAnswerButton");
    local_1_0.__gripFollowActions = local_1_0.createStorageProp("gripFollowActions", false, "gripFollowActions");
    local_1_0.gripMotionSupported = canIUse("SystemCapability.MultimodalAwareness.Motion");
    local_1_0.gripMotionSubscribed = false;
    local_1_0.__holdingHand = new ObservedPropertySimplePU(motion.HoldingHandStatus.RIGHT_HAND_HELD, local_1_0, "holdingHand");
    local_1_0.__pinAnswerDate = local_1_0.createStorageProp("pinAnswerDate", false, "pinAnswerDate");
    local_1_0.__answerSwitchMode = local_1_0.createStorageProp("answerSwitchMode", "vertical", "answerSwitchMode");
    local_1_0.__answerSwitchSensitivity = local_1_0.createStorageProp("answerSwitchSensitivity", 1, "answerSwitchSensitivity");
    local_1_0.__fabOpacity = local_1_0.createStorageProp("fabOpacity", 100, "fabOpacity");
    local_1_0.__shareActionMode = local_1_0.createStorageProp("shareActionMode", "ask", "shareActionMode");
    local_1_0.__speechPlaybackTick = local_1_0.createStorageProp("speechPlaybackTick", 0, "speechPlaybackTick");
    local_1_0.__pageTurnSwitchAnswer = local_1_0.createStorageProp("pageTurnSwitchAnswer", true, "pageTurnSwitchAnswer");
    local_1_0.__chromeHiddenByScroll = new ObservedPropertySimplePU(false, local_1_0, "chromeHiddenByScroll");
    local_1_0.lastContentScrollOffset = 0;
    local_1_0.__doubleTapAskSheetShown = new ObservedPropertySimplePU(false, local_1_0, "doubleTapAskSheetShown");
    local_1_0.segmentSheetOpenedAt = 0;
    local_1_0.__answersState = new ObservedPropertyObjectPU({
      "phase": QuestionAnswersPhase.IDLE,
      "items": [],
      "loadingMore": false,
      "canLoadMore": false,
      "sortOrder": QuestionAnswerSortOrder.DEFAULT,
      "errorMessage": "",
      "requiresLogin": false
    }, local_1_0, "answersState");
    local_1_0.__answersSortIndexes = new ObservedPropertyObjectPU([0], local_1_0, "answersSortIndexes");
    local_1_0.answersController = undefined;
    local_1_0.__actionMenuShown = new ObservedPropertySimplePU(false, local_1_0, "actionMenuShown");
    local_1_0.__actionMenuWidth = new ObservedPropertySimplePU(400, local_1_0, "actionMenuWidth");
    local_1_0.__segmentInfos = new ObservedPropertyObjectPU([], local_1_0, "segmentInfos");
    local_1_0.__segmentSheetShown = new ObservedPropertySimplePU(false, local_1_0, "segmentSheetShown");
    local_1_0.__segmentSheetPid = new ObservedPropertySimplePU("", local_1_0, "segmentSheetPid");
    local_1_0.__segmentSheetMarkIndex = new ObservedPropertySimplePU(-1, local_1_0, "segmentSheetMarkIndex");
    local_1_0.__segmentLikeBusy = new ObservedPropertySimplePU(false, local_1_0, "segmentLikeBusy");
    local_1_0.__immersiveReading = new ObservedPropertySimplePU(false, local_1_0, "immersiveReading");
    local_1_0.__immersiveExitTick = local_1_0.createStorageProp("detailImmersiveExitTick", 0, "immersiveExitTick");
    local_1_0.__statusBarHeightVp = local_1_0.createStorageProp("statusBarHeight", 0, "statusBarHeightVp");
    local_1_0.__bottomRectHeightVp = local_1_0.createStorageProp("bottomRectHeight", 0, "bottomRectHeightVp");
    local_1_0.immersiveMaterialSupported = false;
    local_1_0.controller = undefined;
    local_1_0.blockingAction = undefined;
    local_1_0.voteController = undefined;
    local_1_0.followController = undefined;
    local_1_0.onHoldingHandChanged = function (p0) {
      if (p0 !== motion.HoldingHandStatus.LEFT_HAND_HELD && p0 !== motion.HoldingHandStatus.RIGHT_HAND_HELD) {
        return;
      }
      if (p0 === local_1_0.holdingHand) {
        return;
      }
      local_1_0.holdingHand = p0;
      local_1_0.snapAnswerFabToHand();
      return;
    };
    v3 = AppStorage.get("resolvedThemeColor") ?? DEFAULT_THEME_COLOR;
    local_1_0.__answersSortOptions = new ObservedPropertyObjectPU(local_0_0(v3), local_1_0, "answersSortOptions");
    local_1_0.setInitiallyProvidedValue(p1);
    local_1_0.declareWatch("refreshingAnswers", local_1_0.syncAnswerRefreshIndicator);
    local_1_0.declareWatch("resolvedThemeColor", local_1_0.onResolvedThemeColorChanged);
    local_1_0.declareWatch("loginTick", local_1_0.onLoginChanged);
    local_1_0.declareWatch("imagePreviewUrl", local_1_0.onImagePreviewChanged);
    local_1_0.declareWatch("gripFollowActions", local_1_0.onGripFollowActionsChanged);
    local_1_0.declareWatch("immersiveReading", local_1_0.onImmersiveReadingChanged);
    local_1_0.declareWatch("immersiveExitTick", local_1_0.onImmersiveExitSignal);
    local_1_0.finalizeConstruction();
    return local_1_0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.kind !== undefined) {
      this.kind = p0.kind;
    }
    if (p0.contentId !== undefined) {
      this.contentId = p0.contentId;
    }
    if (p0.activeContentId !== undefined) {
      this.activeContentId = p0.activeContentId;
    }
    if (p0.refreshingAnswers !== undefined) {
      this.refreshingAnswers = p0.refreshingAnswers;
    }
    if (p0.navigatorBusy !== undefined) {
      this.navigatorBusy = p0.navigatorBusy;
    }
    if (p0.navigatorRevision !== undefined) {
      this.navigatorRevision = p0.navigatorRevision;
    }
    if (p0.answerOverscrollOffset !== undefined) {
      this.answerOverscrollOffset = p0.answerOverscrollOffset;
    }
    if (p0.answerViewportWidthVp !== undefined) {
      this.answerViewportWidthVp = p0.answerViewportWidthVp;
    }
    if (p0.contentAtBottom !== undefined) {
      this.contentAtBottom = p0.contentAtBottom;
    }
    if (p0.contentAtTop !== undefined) {
      this.contentAtTop = p0.contentAtTop;
    }
    if (p0.overscrollRawDrag !== undefined) {
      this.overscrollRawDrag = p0.overscrollRawDrag;
    }
    if (p0.bodyTextSelectionActive !== undefined) {
      this.bodyTextSelectionActive = p0.bodyTextSelectionActive;
    }
    if (p0.overscrollPanPrevY !== undefined) {
      this.overscrollPanPrevY = p0.overscrollPanPrevY;
    }
    if (p0.answerFabOffsetX !== undefined) {
      this.answerFabOffsetX = p0.answerFabOffsetX;
    }
    if (p0.answerFabOffsetY !== undefined) {
      this.answerFabOffsetY = p0.answerFabOffsetY;
    }
    if (p0.answerFabPanPrevX !== undefined) {
      this.answerFabPanPrevX = p0.answerFabPanPrevX;
    }
    if (p0.answerFabPanPrevY !== undefined) {
      this.answerFabPanPrevY = p0.answerFabPanPrevY;
    }
    if (p0.answerFabDragging !== undefined) {
      this.answerFabDragging = p0.answerFabDragging;
    }
    if (p0.answerFabWidthVp !== undefined) {
      this.answerFabWidthVp = p0.answerFabWidthVp;
    }
    if (p0.answerFabOverlayWidthVp !== undefined) {
      this.answerFabOverlayWidthVp = p0.answerFabOverlayWidthVp;
    }
    if (p0.answerFabOverlayHeightVp !== undefined) {
      this.answerFabOverlayHeightVp = p0.answerFabOverlayHeightVp;
    }
    if (p0.answerFabPositionLoaded !== undefined) {
      this.answerFabPositionLoaded = p0.answerFabPositionLoaded;
    }
    if (p0.answerFabPositionReady !== undefined) {
      this.answerFabPositionReady = p0.answerFabPositionReady;
    }
    if (p0.answerFabPositionApplied !== undefined) {
      this.answerFabPositionApplied = p0.answerFabPositionApplied;
    }
    if (p0.savedAnswerFabPosition !== undefined) {
      this.savedAnswerFabPosition = p0.savedAnswerFabPosition;
    }
    if (p0.answerFabPreferences !== undefined) {
      this.answerFabPreferences = p0.answerFabPreferences;
    }
    if (p0.bottomActionBarHeightVp !== undefined) {
      this.bottomActionBarHeightVp = p0.bottomActionBarHeightVp;
    }
    if (p0.authenticated !== undefined) {
      this.authenticated = p0.authenticated;
    }
    if (p0.answerNavigator !== undefined) {
      this.answerNavigator = p0.answerNavigator;
    }
    if (p0.answerDataSource !== undefined) {
      this.answerDataSource = p0.answerDataSource;
    }
    if (p0.indicator !== undefined) {
      this.indicator = p0.indicator;
    }
    if (p0.questionScrolled !== undefined) {
      this.questionScrolled = p0.questionScrolled;
    }
    if (p0.answerQuestionScrolled !== undefined) {
      this.answerQuestionScrolled = p0.answerQuestionScrolled;
    }
    if (p0.articleTitleScrolled !== undefined) {
      this.articleTitleScrolled = p0.articleTitleScrolled;
    }
    if (p0.contentTitleHeightVp !== undefined) {
      this.contentTitleHeightVp = p0.contentTitleHeightVp;
    }
    if (p0.pageActive !== undefined) {
      this.pageActive = p0.pageActive;
    }
    if (p0.repository !== undefined) {
      this.repository = p0.repository;
    }
    if (p0.linkCardMetaRepository !== undefined) {
      this.linkCardMetaRepository = p0.linkCardMetaRepository;
    }
    if (p0.openedContentStore !== undefined) {
      this.openedContentStore = p0.openedContentStore;
    }
    if (p0.historyUploader !== undefined) {
      this.historyUploader = p0.historyUploader;
    }
    if (p0.rules !== undefined) {
      this.rules = p0.rules;
    }
    if (p0.history !== undefined) {
      this.history = p0.history;
    }
    if (p0.voteRepository !== undefined) {
      this.voteRepository = p0.voteRepository;
    }
    if (p0.segmentReactionRepository !== undefined) {
      this.segmentReactionRepository = p0.segmentReactionRepository;
    }
    if (p0.followRepository !== undefined) {
      this.followRepository = p0.followRepository;
    }
    if (p0.collectionRepository !== undefined) {
      this.collectionRepository = p0.collectionRepository;
    }
    if (p0.commentRepository !== undefined) {
      this.commentRepository = p0.commentRepository;
    }
    if (p0.session !== undefined) {
      this.session = p0.session;
    }
    if (p0.navigate !== undefined) {
      this.navigate = p0.navigate;
    }
    if (p0.questionAnswerFeedFactory !== undefined) {
      this.questionAnswerFeedFactory = p0.questionAnswerFeedFactory;
    }
    if (p0.onBack !== undefined) {
      this.onBack = p0.onBack;
    }
    if (p0.phase !== undefined) {
      this.phase = p0.phase;
    }
    if (p0.content !== undefined) {
      this.content = p0.content;
    }
    if (p0.errorMessage !== undefined) {
      this.errorMessage = p0.errorMessage;
    }
    if (p0.requiresLogin !== undefined) {
      this.requiresLogin = p0.requiresLogin;
    }
    if (p0.openedRecordPhase !== undefined) {
      this.openedRecordPhase = p0.openedRecordPhase;
    }
    if (p0.pendingUserBlock !== undefined) {
      this.pendingUserBlock = p0.pendingUserBlock;
    }
    if (p0.keywordBlockVisible !== undefined) {
      this.keywordBlockVisible = p0.keywordBlockVisible;
    }
    if (p0.keywordBlockInput !== undefined) {
      this.keywordBlockInput = p0.keywordBlockInput;
    }
    if (p0.blockingMessage !== undefined) {
      this.blockingMessage = p0.blockingMessage;
    }
    if (p0.blockingBusy !== undefined) {
      this.blockingBusy = p0.blockingBusy;
    }
    if (p0.voteState !== undefined) {
      this.voteState = p0.voteState;
    }
    if (p0.voteupCount !== undefined) {
      this.voteupCount = p0.voteupCount;
    }
    if (p0.thanked !== undefined) {
      this.thanked = p0.thanked;
    }
    if (p0.thanksCount !== undefined) {
      this.thanksCount = p0.thanksCount;
    }
    if (p0.following !== undefined) {
      this.following = p0.following;
    }
    if (p0.followerCount !== undefined) {
      this.followerCount = p0.followerCount;
    }
    if (p0.interactionPending !== undefined) {
      this.interactionPending = p0.interactionPending;
    }
    if (p0.interactionErrorMessage !== undefined) {
      this.interactionErrorMessage = p0.interactionErrorMessage;
    }
    if (p0.interactionRequiresLogin !== undefined) {
      this.interactionRequiresLogin = p0.interactionRequiresLogin;
    }
    if (p0.favoriteDialogShown !== undefined) {
      this.favoriteDialogShown = p0.favoriteDialogShown;
    }
    if (p0.contentFavorited !== undefined) {
      this.contentFavorited = p0.contentFavorited;
    }
    if (p0.favoriteStateContentId !== undefined) {
      this.favoriteStateContentId = p0.favoriteStateContentId;
    }
    if (p0.gripMotionSupported !== undefined) {
      this.gripMotionSupported = p0.gripMotionSupported;
    }
    if (p0.gripMotionSubscribed !== undefined) {
      this.gripMotionSubscribed = p0.gripMotionSubscribed;
    }
    if (p0.holdingHand !== undefined) {
      this.holdingHand = p0.holdingHand;
    }
    if (p0.chromeHiddenByScroll !== undefined) {
      this.chromeHiddenByScroll = p0.chromeHiddenByScroll;
    }
    if (p0.lastContentScrollOffset !== undefined) {
      this.lastContentScrollOffset = p0.lastContentScrollOffset;
    }
    if (p0.doubleTapAskSheetShown !== undefined) {
      this.doubleTapAskSheetShown = p0.doubleTapAskSheetShown;
    }
    if (p0.segmentSheetOpenedAt !== undefined) {
      this.segmentSheetOpenedAt = p0.segmentSheetOpenedAt;
    }
    if (p0.answersState !== undefined) {
      this.answersState = p0.answersState;
    }
    if (p0.answersSortIndexes !== undefined) {
      this.answersSortIndexes = p0.answersSortIndexes;
    }
    if (p0.answersController !== undefined) {
      this.answersController = p0.answersController;
    }
    if (p0.actionMenuShown !== undefined) {
      this.actionMenuShown = p0.actionMenuShown;
    }
    if (p0.actionMenuWidth !== undefined) {
      this.actionMenuWidth = p0.actionMenuWidth;
    }
    if (p0.segmentInfos !== undefined) {
      this.segmentInfos = p0.segmentInfos;
    }
    if (p0.segmentSheetShown !== undefined) {
      this.segmentSheetShown = p0.segmentSheetShown;
    }
    if (p0.segmentSheetPid !== undefined) {
      this.segmentSheetPid = p0.segmentSheetPid;
    }
    if (p0.segmentSheetMarkIndex !== undefined) {
      this.segmentSheetMarkIndex = p0.segmentSheetMarkIndex;
    }
    if (p0.segmentLikeBusy !== undefined) {
      this.segmentLikeBusy = p0.segmentLikeBusy;
    }
    if (p0.immersiveReading !== undefined) {
      this.immersiveReading = p0.immersiveReading;
    }
    if (p0.immersiveMaterialSupported !== undefined) {
      this.immersiveMaterialSupported = p0.immersiveMaterialSupported;
    }
    if (p0.controller !== undefined) {
      this.controller = p0.controller;
    }
    if (p0.blockingAction !== undefined) {
      this.blockingAction = p0.blockingAction;
    }
    if (p0.voteController !== undefined) {
      this.voteController = p0.voteController;
    }
    if (p0.followController !== undefined) {
      this.followController = p0.followController;
    }
    if (p0.onHoldingHandChanged !== undefined) {
      this.onHoldingHandChanged = p0.onHoldingHandChanged;
    }
    if (p0.answersSortOptions !== undefined) {
      this.answersSortOptions = p0.answersSortOptions;
    }
  }
  updateStateVars(p0) {}
  purgeVariableDependenciesOnElmtId(p0) {
    this.__activeContentId.purgeDependencyOnElmtId(p0);
    this.__refreshingAnswers.purgeDependencyOnElmtId(p0);
    this.__navigatorBusy.purgeDependencyOnElmtId(p0);
    this.__navigatorRevision.purgeDependencyOnElmtId(p0);
    this.__answerOverscrollOffset.purgeDependencyOnElmtId(p0);
    this.__answerViewportWidthVp.purgeDependencyOnElmtId(p0);
    this.__contentAtBottom.purgeDependencyOnElmtId(p0);
    this.__contentAtTop.purgeDependencyOnElmtId(p0);
    this.__previewFontSizePercent.purgeDependencyOnElmtId(p0);
    this.__previewLineHeightPercent.purgeDependencyOnElmtId(p0);
    this.__resolvedThemeColor.purgeDependencyOnElmtId(p0);
    this.__answerFabOffsetX.purgeDependencyOnElmtId(p0);
    this.__answerFabOffsetY.purgeDependencyOnElmtId(p0);
    this.__answerFabPositionReady.purgeDependencyOnElmtId(p0);
    this.__loginTick.purgeDependencyOnElmtId(p0);
    this.__imagePreviewUrl.purgeDependencyOnElmtId(p0);
    this.__authenticated.purgeDependencyOnElmtId(p0);
    this.__phase.purgeDependencyOnElmtId(p0);
    this.__content.purgeDependencyOnElmtId(p0);
    this.__errorMessage.purgeDependencyOnElmtId(p0);
    this.__requiresLogin.purgeDependencyOnElmtId(p0);
    this.__openedRecordPhase.purgeDependencyOnElmtId(p0);
    this.__pendingUserBlock.purgeDependencyOnElmtId(p0);
    this.__keywordBlockVisible.purgeDependencyOnElmtId(p0);
    this.__keywordBlockInput.purgeDependencyOnElmtId(p0);
    this.__blockingMessage.purgeDependencyOnElmtId(p0);
    this.__blockingBusy.purgeDependencyOnElmtId(p0);
    this.__voteState.purgeDependencyOnElmtId(p0);
    this.__voteupCount.purgeDependencyOnElmtId(p0);
    this.__thanked.purgeDependencyOnElmtId(p0);
    this.__thanksCount.purgeDependencyOnElmtId(p0);
    this.__following.purgeDependencyOnElmtId(p0);
    this.__followerCount.purgeDependencyOnElmtId(p0);
    this.__interactionPending.purgeDependencyOnElmtId(p0);
    this.__interactionErrorMessage.purgeDependencyOnElmtId(p0);
    this.__interactionRequiresLogin.purgeDependencyOnElmtId(p0);
    this.__favoriteDialogShown.purgeDependencyOnElmtId(p0);
    this.__contentFavorited.purgeDependencyOnElmtId(p0);
    this.__answerDoubleTapAction.purgeDependencyOnElmtId(p0);
    this.__titleAutoHide.purgeDependencyOnElmtId(p0);
    this.__autoHideArticleBottomBar.purgeDependencyOnElmtId(p0);
    this.__buttonSkipAnswer.purgeDependencyOnElmtId(p0);
    this.__autoHideSkipAnswerButton.purgeDependencyOnElmtId(p0);
    this.__gripFollowActions.purgeDependencyOnElmtId(p0);
    this.__holdingHand.purgeDependencyOnElmtId(p0);
    this.__pinAnswerDate.purgeDependencyOnElmtId(p0);
    this.__answerSwitchMode.purgeDependencyOnElmtId(p0);
    this.__answerSwitchSensitivity.purgeDependencyOnElmtId(p0);
    this.__fabOpacity.purgeDependencyOnElmtId(p0);
    this.__shareActionMode.purgeDependencyOnElmtId(p0);
    this.__speechPlaybackTick.purgeDependencyOnElmtId(p0);
    this.__pageTurnSwitchAnswer.purgeDependencyOnElmtId(p0);
    this.__chromeHiddenByScroll.purgeDependencyOnElmtId(p0);
    this.__doubleTapAskSheetShown.purgeDependencyOnElmtId(p0);
    this.__answersState.purgeDependencyOnElmtId(p0);
    this.__answersSortIndexes.purgeDependencyOnElmtId(p0);
    this.__actionMenuShown.purgeDependencyOnElmtId(p0);
    this.__actionMenuWidth.purgeDependencyOnElmtId(p0);
    this.__segmentInfos.purgeDependencyOnElmtId(p0);
    this.__segmentSheetShown.purgeDependencyOnElmtId(p0);
    this.__segmentSheetPid.purgeDependencyOnElmtId(p0);
    this.__segmentSheetMarkIndex.purgeDependencyOnElmtId(p0);
    this.__segmentLikeBusy.purgeDependencyOnElmtId(p0);
    this.__immersiveReading.purgeDependencyOnElmtId(p0);
    this.__immersiveExitTick.purgeDependencyOnElmtId(p0);
    this.__statusBarHeightVp.purgeDependencyOnElmtId(p0);
    this.__bottomRectHeightVp.purgeDependencyOnElmtId(p0);
    this.__answersSortOptions.purgeDependencyOnElmtId(p0);
  }
  aboutToBeDeleted() {
    this.__activeContentId.aboutToBeDeleted();
    this.__refreshingAnswers.aboutToBeDeleted();
    this.__navigatorBusy.aboutToBeDeleted();
    this.__navigatorRevision.aboutToBeDeleted();
    this.__answerOverscrollOffset.aboutToBeDeleted();
    this.__answerViewportWidthVp.aboutToBeDeleted();
    this.__contentAtBottom.aboutToBeDeleted();
    this.__contentAtTop.aboutToBeDeleted();
    this.__previewFontSizePercent.aboutToBeDeleted();
    this.__previewLineHeightPercent.aboutToBeDeleted();
    this.__resolvedThemeColor.aboutToBeDeleted();
    this.__answerFabOffsetX.aboutToBeDeleted();
    this.__answerFabOffsetY.aboutToBeDeleted();
    this.__answerFabPositionReady.aboutToBeDeleted();
    this.__loginTick.aboutToBeDeleted();
    this.__imagePreviewUrl.aboutToBeDeleted();
    this.__authenticated.aboutToBeDeleted();
    this.__phase.aboutToBeDeleted();
    this.__content.aboutToBeDeleted();
    this.__errorMessage.aboutToBeDeleted();
    this.__requiresLogin.aboutToBeDeleted();
    this.__openedRecordPhase.aboutToBeDeleted();
    this.__pendingUserBlock.aboutToBeDeleted();
    this.__keywordBlockVisible.aboutToBeDeleted();
    this.__keywordBlockInput.aboutToBeDeleted();
    this.__blockingMessage.aboutToBeDeleted();
    this.__blockingBusy.aboutToBeDeleted();
    this.__voteState.aboutToBeDeleted();
    this.__voteupCount.aboutToBeDeleted();
    this.__thanked.aboutToBeDeleted();
    this.__thanksCount.aboutToBeDeleted();
    this.__following.aboutToBeDeleted();
    this.__followerCount.aboutToBeDeleted();
    this.__interactionPending.aboutToBeDeleted();
    this.__interactionErrorMessage.aboutToBeDeleted();
    this.__interactionRequiresLogin.aboutToBeDeleted();
    this.__favoriteDialogShown.aboutToBeDeleted();
    this.__contentFavorited.aboutToBeDeleted();
    this.__answerDoubleTapAction.aboutToBeDeleted();
    this.__titleAutoHide.aboutToBeDeleted();
    this.__autoHideArticleBottomBar.aboutToBeDeleted();
    this.__buttonSkipAnswer.aboutToBeDeleted();
    this.__autoHideSkipAnswerButton.aboutToBeDeleted();
    this.__gripFollowActions.aboutToBeDeleted();
    this.__holdingHand.aboutToBeDeleted();
    this.__pinAnswerDate.aboutToBeDeleted();
    this.__answerSwitchMode.aboutToBeDeleted();
    this.__answerSwitchSensitivity.aboutToBeDeleted();
    this.__fabOpacity.aboutToBeDeleted();
    this.__shareActionMode.aboutToBeDeleted();
    this.__speechPlaybackTick.aboutToBeDeleted();
    this.__pageTurnSwitchAnswer.aboutToBeDeleted();
    this.__chromeHiddenByScroll.aboutToBeDeleted();
    this.__doubleTapAskSheetShown.aboutToBeDeleted();
    this.__answersState.aboutToBeDeleted();
    this.__answersSortIndexes.aboutToBeDeleted();
    this.__actionMenuShown.aboutToBeDeleted();
    this.__actionMenuWidth.aboutToBeDeleted();
    this.__segmentInfos.aboutToBeDeleted();
    this.__segmentSheetShown.aboutToBeDeleted();
    this.__segmentSheetPid.aboutToBeDeleted();
    this.__segmentSheetMarkIndex.aboutToBeDeleted();
    this.__segmentLikeBusy.aboutToBeDeleted();
    this.__immersiveReading.aboutToBeDeleted();
    this.__immersiveExitTick.aboutToBeDeleted();
    this.__statusBarHeightVp.aboutToBeDeleted();
    this.__bottomRectHeightVp.aboutToBeDeleted();
    this.__answersSortOptions.aboutToBeDeleted();
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  get activeContentId() {
    return this.__activeContentId.get();
  }
  set activeContentId(p0) {
    this.__activeContentId.set(p0);
  }
  get refreshingAnswers() {
    return this.__refreshingAnswers.get();
  }
  set refreshingAnswers(p0) {
    this.__refreshingAnswers.set(p0);
  }
  get navigatorBusy() {
    return this.__navigatorBusy.get();
  }
  set navigatorBusy(p0) {
    this.__navigatorBusy.set(p0);
  }
  get navigatorRevision() {
    return this.__navigatorRevision.get();
  }
  set navigatorRevision(p0) {
    this.__navigatorRevision.set(p0);
  }
  get answerOverscrollOffset() {
    return this.__answerOverscrollOffset.get();
  }
  set answerOverscrollOffset(p0) {
    this.__answerOverscrollOffset.set(p0);
  }
  get answerViewportWidthVp() {
    return this.__answerViewportWidthVp.get();
  }
  set answerViewportWidthVp(p0) {
    this.__answerViewportWidthVp.set(p0);
  }
  get contentAtBottom() {
    return this.__contentAtBottom.get();
  }
  set contentAtBottom(p0) {
    this.__contentAtBottom.set(p0);
  }
  get contentAtTop() {
    return this.__contentAtTop.get();
  }
  set contentAtTop(p0) {
    this.__contentAtTop.set(p0);
  }
  get previewFontSizePercent() {
    return this.__previewFontSizePercent.get();
  }
  set previewFontSizePercent(p0) {
    this.__previewFontSizePercent.set(p0);
  }
  get previewLineHeightPercent() {
    return this.__previewLineHeightPercent.get();
  }
  set previewLineHeightPercent(p0) {
    this.__previewLineHeightPercent.set(p0);
  }
  get resolvedThemeColor() {
    return this.__resolvedThemeColor.get();
  }
  set resolvedThemeColor(p0) {
    this.__resolvedThemeColor.set(p0);
  }
  get answerFabOffsetX() {
    return this.__answerFabOffsetX.get();
  }
  set answerFabOffsetX(p0) {
    this.__answerFabOffsetX.set(p0);
  }
  get answerFabOffsetY() {
    return this.__answerFabOffsetY.get();
  }
  set answerFabOffsetY(p0) {
    this.__answerFabOffsetY.set(p0);
  }
  get answerFabPositionReady() {
    return this.__answerFabPositionReady.get();
  }
  set answerFabPositionReady(p0) {
    this.__answerFabPositionReady.set(p0);
  }
  get loginTick() {
    return this.__loginTick.get();
  }
  set loginTick(p0) {
    this.__loginTick.set(p0);
  }
  get imagePreviewUrl() {
    return this.__imagePreviewUrl.get();
  }
  set imagePreviewUrl(p0) {
    this.__imagePreviewUrl.set(p0);
  }
  get authenticated() {
    return this.__authenticated.get();
  }
  set authenticated(p0) {
    this.__authenticated.set(p0);
  }
  get phase() {
    return this.__phase.get();
  }
  set phase(p0) {
    this.__phase.set(p0);
  }
  get content() {
    return this.__content.get();
  }
  set content(p0) {
    this.__content.set(p0);
  }
  get errorMessage() {
    return this.__errorMessage.get();
  }
  set errorMessage(p0) {
    this.__errorMessage.set(p0);
  }
  get requiresLogin() {
    return this.__requiresLogin.get();
  }
  set requiresLogin(p0) {
    this.__requiresLogin.set(p0);
  }
  get openedRecordPhase() {
    return this.__openedRecordPhase.get();
  }
  set openedRecordPhase(p0) {
    this.__openedRecordPhase.set(p0);
  }
  get pendingUserBlock() {
    return this.__pendingUserBlock.get();
  }
  set pendingUserBlock(p0) {
    this.__pendingUserBlock.set(p0);
  }
  get keywordBlockVisible() {
    return this.__keywordBlockVisible.get();
  }
  set keywordBlockVisible(p0) {
    this.__keywordBlockVisible.set(p0);
  }
  get keywordBlockInput() {
    return this.__keywordBlockInput.get();
  }
  set keywordBlockInput(p0) {
    this.__keywordBlockInput.set(p0);
  }
  get blockingMessage() {
    return this.__blockingMessage.get();
  }
  set blockingMessage(p0) {
    this.__blockingMessage.set(p0);
  }
  get blockingBusy() {
    return this.__blockingBusy.get();
  }
  set blockingBusy(p0) {
    this.__blockingBusy.set(p0);
  }
  get voteState() {
    return this.__voteState.get();
  }
  set voteState(p0) {
    this.__voteState.set(p0);
  }
  get voteupCount() {
    return this.__voteupCount.get();
  }
  set voteupCount(p0) {
    this.__voteupCount.set(p0);
  }
  get thanked() {
    return this.__thanked.get();
  }
  set thanked(p0) {
    this.__thanked.set(p0);
  }
  get thanksCount() {
    return this.__thanksCount.get();
  }
  set thanksCount(p0) {
    this.__thanksCount.set(p0);
  }
  get following() {
    return this.__following.get();
  }
  set following(p0) {
    this.__following.set(p0);
  }
  get followerCount() {
    return this.__followerCount.get();
  }
  set followerCount(p0) {
    this.__followerCount.set(p0);
  }
  get interactionPending() {
    return this.__interactionPending.get();
  }
  set interactionPending(p0) {
    this.__interactionPending.set(p0);
  }
  get interactionErrorMessage() {
    return this.__interactionErrorMessage.get();
  }
  set interactionErrorMessage(p0) {
    this.__interactionErrorMessage.set(p0);
  }
  get interactionRequiresLogin() {
    return this.__interactionRequiresLogin.get();
  }
  set interactionRequiresLogin(p0) {
    this.__interactionRequiresLogin.set(p0);
  }
  get favoriteDialogShown() {
    return this.__favoriteDialogShown.get();
  }
  set favoriteDialogShown(p0) {
    this.__favoriteDialogShown.set(p0);
  }
  get contentFavorited() {
    return this.__contentFavorited.get();
  }
  set contentFavorited(p0) {
    this.__contentFavorited.set(p0);
  }
  get answerDoubleTapAction() {
    return this.__answerDoubleTapAction.get();
  }
  set answerDoubleTapAction(p0) {
    this.__answerDoubleTapAction.set(p0);
  }
  get titleAutoHide() {
    return this.__titleAutoHide.get();
  }
  set titleAutoHide(p0) {
    this.__titleAutoHide.set(p0);
  }
  get autoHideArticleBottomBar() {
    return this.__autoHideArticleBottomBar.get();
  }
  set autoHideArticleBottomBar(p0) {
    this.__autoHideArticleBottomBar.set(p0);
  }
  get buttonSkipAnswer() {
    return this.__buttonSkipAnswer.get();
  }
  set buttonSkipAnswer(p0) {
    this.__buttonSkipAnswer.set(p0);
  }
  get autoHideSkipAnswerButton() {
    return this.__autoHideSkipAnswerButton.get();
  }
  set autoHideSkipAnswerButton(p0) {
    this.__autoHideSkipAnswerButton.set(p0);
  }
  get gripFollowActions() {
    return this.__gripFollowActions.get();
  }
  set gripFollowActions(p0) {
    this.__gripFollowActions.set(p0);
  }
  get holdingHand() {
    return this.__holdingHand.get();
  }
  set holdingHand(p0) {
    this.__holdingHand.set(p0);
  }
  get pinAnswerDate() {
    return this.__pinAnswerDate.get();
  }
  set pinAnswerDate(p0) {
    this.__pinAnswerDate.set(p0);
  }
  get answerSwitchMode() {
    return this.__answerSwitchMode.get();
  }
  set answerSwitchMode(p0) {
    this.__answerSwitchMode.set(p0);
  }
  get answerSwitchSensitivity() {
    return this.__answerSwitchSensitivity.get();
  }
  set answerSwitchSensitivity(p0) {
    this.__answerSwitchSensitivity.set(p0);
  }
  get fabOpacity() {
    return this.__fabOpacity.get();
  }
  set fabOpacity(p0) {
    this.__fabOpacity.set(p0);
  }
  get shareActionMode() {
    return this.__shareActionMode.get();
  }
  set shareActionMode(p0) {
    this.__shareActionMode.set(p0);
  }
  get speechPlaybackTick() {
    return this.__speechPlaybackTick.get();
  }
  set speechPlaybackTick(p0) {
    this.__speechPlaybackTick.set(p0);
  }
  get pageTurnSwitchAnswer() {
    return this.__pageTurnSwitchAnswer.get();
  }
  set pageTurnSwitchAnswer(p0) {
    this.__pageTurnSwitchAnswer.set(p0);
  }
  get chromeHiddenByScroll() {
    return this.__chromeHiddenByScroll.get();
  }
  set chromeHiddenByScroll(p0) {
    this.__chromeHiddenByScroll.set(p0);
  }
  get doubleTapAskSheetShown() {
    return this.__doubleTapAskSheetShown.get();
  }
  set doubleTapAskSheetShown(p0) {
    this.__doubleTapAskSheetShown.set(p0);
  }
  get answersState() {
    return this.__answersState.get();
  }
  set answersState(p0) {
    this.__answersState.set(p0);
  }
  get answersSortIndexes() {
    return this.__answersSortIndexes.get();
  }
  set answersSortIndexes(p0) {
    this.__answersSortIndexes.set(p0);
  }
  get actionMenuShown() {
    return this.__actionMenuShown.get();
  }
  set actionMenuShown(p0) {
    this.__actionMenuShown.set(p0);
  }
  get actionMenuWidth() {
    return this.__actionMenuWidth.get();
  }
  set actionMenuWidth(p0) {
    this.__actionMenuWidth.set(p0);
  }
  get segmentInfos() {
    return this.__segmentInfos.get();
  }
  set segmentInfos(p0) {
    this.__segmentInfos.set(p0);
  }
  get segmentSheetShown() {
    return this.__segmentSheetShown.get();
  }
  set segmentSheetShown(p0) {
    this.__segmentSheetShown.set(p0);
  }
  get segmentSheetPid() {
    return this.__segmentSheetPid.get();
  }
  set segmentSheetPid(p0) {
    this.__segmentSheetPid.set(p0);
  }
  get segmentSheetMarkIndex() {
    return this.__segmentSheetMarkIndex.get();
  }
  set segmentSheetMarkIndex(p0) {
    this.__segmentSheetMarkIndex.set(p0);
  }
  get segmentLikeBusy() {
    return this.__segmentLikeBusy.get();
  }
  set segmentLikeBusy(p0) {
    this.__segmentLikeBusy.set(p0);
  }
  get immersiveReading() {
    return this.__immersiveReading.get();
  }
  set immersiveReading(p0) {
    this.__immersiveReading.set(p0);
  }
  get immersiveExitTick() {
    return this.__immersiveExitTick.get();
  }
  set immersiveExitTick(p0) {
    this.__immersiveExitTick.set(p0);
  }
  get statusBarHeightVp() {
    return this.__statusBarHeightVp.get();
  }
  set statusBarHeightVp(p0) {
    this.__statusBarHeightVp.set(p0);
  }
  get bottomRectHeightVp() {
    return this.__bottomRectHeightVp.get();
  }
  set bottomRectHeightVp(p0) {
    this.__bottomRectHeightVp.set(p0);
  }
  get answersSortOptions() {
    return this.__answersSortOptions.get();
  }
  set answersSortOptions(p0) {
    this.__answersSortOptions.set(p0);
  }
  aboutToAppear() {
    let local_1_0 = this;
    local_1_0.pageActive = true;
    if (local_1_0.activeContentId.length === 0) {
      local_1_0.activeContentId = local_1_0.contentId;
    }
    local_1_0.authenticated = local_1_0.session?.getState().status === SessionStatus.AUTHENTICATED;
    local_1_0.restoreAnswerDoubleTapAction();
    AppStorage.setOrCreate("detailImmersiveActive", local_1_0.immersiveReading);
    local_1_0.indicator = new FeedPullDownIndicatorHost(local_1_0.getUIContext(), 0);
    if (local_1_0.kind === ContentDetailKind.ANSWER && local_1_0.answerNavigator === undefined) {
      local_1_0.answerNavigator = takeQuestionAnswerNavigator(local_1_0.activeContentId);
    }
    if (local_1_0.answerNavigator !== null && local_1_0.answerNavigator !== undefined) {
      local_1_0.answerNavigator.resume();
    }
    if (local_1_0.kind === ContentDetailKind.ANSWER) {
      if (!local_1_0.answerFabPositionLoaded) {
        local_1_0.loadAnswerFabPosition();
      }
    }
    local_1_0.subscribeHoldingHand();
    try {
      local_1_0.immersiveMaterialSupported = hdsMaterial.getSystemMaterialTypes().includes(hdsMaterial.MaterialType.IMMERSIVE);
    } catch (catchAcc) {
      local_1_0.immersiveMaterialSupported = false;
    }
    if (local_1_0.controller !== undefined) {
      local_1_0.controller.activate();
      if (local_1_0.answersController !== null && local_1_0.answersController !== undefined) {
        local_1_0.answersController.activate();
      }
      local_1_0.ensureAnswers();
      if (local_1_0.phase === ContentDetailPhase.LOADING) {
        local_1_0.controller.load(local_1_0.kind, local_1_0.activeContentId);
      }
      return;
    }
    if (local_1_0.repository === undefined) {
      local_1_0.phase = ContentDetailPhase.ERROR;
      local_1_0.errorMessage = "内容数据源未配置";
      return;
    }
    local_1_0.controller = new ContentDetailController(local_1_0.repository, local_1_0.openedContentStore, function (p0) {
      return local_1_0.applyState(p0);
    }, local_1_0.historyUploader);
    local_1_0.controller.activate();
    local_1_0.controller.load(local_1_0.kind, local_1_0.activeContentId);
    local_1_0.createBlockingAction();
    local_1_0.ensureAnswers();
    return;
  }
  ensureAnswers() {
    let v0;
    let local_1_0 = this;
    if (local_1_0.pageActive && local_1_0.kind === ContentDetailKind.QUESTION) {
      if (!local_1_0.authenticated) {
        return;
      }
      if (local_1_0.answersController === undefined) {
        v0 = local_1_0.questionAnswerFeedFactory();
        if (v0 === undefined) {
          return;
        }
        local_1_0.answersSortIndexes = [0];
        local_1_0.answersController = new QuestionAnswersController(v0, local_1_0.activeContentId, function (p0) {
          local_1_0.answersState = p0;
          local_1_0.answerDataSource.replace(p0.items);
        });
      }
      local_1_0.answersController.activate();
    }
    return;
  }
  onLoginChanged() {
    this.authenticated = (this.session === null || this.session === undefined ? undefined : this.session.getState().status) === SessionStatus.AUTHENTICATED;
    if (!this.pageActive) {
      return;
    }
    if (this.answersController !== null && this.answersController !== undefined) {
      this.answersController.deactivate();
    }
    this.answersController = undefined;
    this.answerDataSource.replace([]);
    this.ensureAnswers();
    if (this.followController !== null && this.followController !== undefined) {
      this.followController.deactivate();
    }
    this.followController = undefined;
    if (this.controller !== null && this.controller !== undefined) {
      this.controller.load(this.kind, this.activeContentId);
    }
    return;
  }
  aboutToDisappear() {
    this.pageActive = false;
    this.unsubscribeHoldingHand();
    if (this.indicator !== null && this.indicator !== undefined) {
      this.indicator.dispose();
    }
    this.indicator = undefined;
    if (this.answersController !== null && this.answersController !== undefined) {
      this.answersController.deactivate();
    }
    if (this.controller !== null && this.controller !== undefined) {
      this.controller.deactivate();
    }
    if (this.voteController !== null && this.voteController !== undefined) {
      this.voteController.deactivate();
    }
    if (this.followController !== null && this.followController !== undefined) {
      this.followController.deactivate();
    }
    this.voteController = undefined;
    this.followController = undefined;
    if (this.answerNavigator !== null && this.answerNavigator !== undefined) {
      this.answerNavigator.pause();
    }
    this.resetAnswerOverscroll(false);
    this.contentAtBottom = false;
    this.pendingUserBlock = undefined;
    this.keywordBlockVisible = false;
    this.keywordBlockInput = "";
    this.immersiveReading = false;
    AppStorage.setOrCreate("detailImmersiveActive", false);
    AppStorage.setOrCreate("detailTitleHiddenByScroll", false);
    AppStorage.setOrCreate("imagePreviewUrl", "");
    setStatusBarHidden(false);
  }
  openSegmentSheet(p0, p1) {
    let acc;
    if (p0.marks[p1] === undefined || (acc = effectiveSegmentMeta(p0.marks[p1]), p0.marks[p1] === undefined === undefined)) {
      return;
    }
    this.segmentSheetPid = p0.pid;
    this.segmentSheetMarkIndex = p1;
    this.segmentSheetOpenedAt = Date.now();
    this.segmentSheetShown = true;
    return;
  }
  guardSegmentSheetDismiss(p0) {
    if (Date.now() - this.segmentSheetOpenedAt < 400) {
      return;
    }
    p0.dismiss();
    return;
  }
  currentSegmentMeta() {
    let v0;
    let local_1_0 = this;
    v0 = local_1_0.segmentInfos.find(function (p0) {
      return p0.pid === local_1_0.segmentSheetPid;
    });
    if (v0 === undefined) {
      return undefined;
    }
    v0 = v0.marks[local_1_0.segmentSheetMarkIndex];
    return v0 === undefined ? undefined : effectiveSegmentMeta(v0);
  }
  currentSegmentQuote() {
    let v0, v1, v2;
    let local_1_0 = this;
    v0 = local_1_0.segmentInfos.find(function (p0) {
      return p0.pid === local_1_0.segmentSheetPid;
    });
    if (v0 === undefined) {
      return "";
    }
    if (v0.marks[local_1_0.segmentSheetMarkIndex] === undefined) {
      return "";
    }
    v2 = Math.max(0, Math.min(v0.text.length, v0.marks[local_1_0.segmentSheetMarkIndex].startIndex));
    v1 = Math.max(0, Math.min(v0.text.length, v0.marks[local_1_0.segmentSheetMarkIndex].endIndex));
    return v1 > v2 ? v0.text.substring(v2, v1) : "";
  }
  applySegmentMeta(p0, p1, p2) {
    let local_1_0 = p0;
    let local_1_2 = p1;
    let local_1_3 = p2;
    let local_1_1 = [];
    this.segmentInfos.forEach(function (p0) {
      let local_2_0;
      if (p0.pid === local_1_0) {
        local_2_0 = [];
        p0.marks.forEach(function (p0, p1) {
          if (p1 === local_1_2) {
            local_2_0.push({
              "startIndex": p0.startIndex,
              "endIndex": p0.endIndex,
              "segInfo": p0.segInfo === undefined ? p0.segInfo : local_1_3,
              "masterSegInfo": p0.masterSegInfo === undefined ? p0.masterSegInfo : local_1_3
            });
            return;
          }
          local_2_0.push(p0);
          return;
        });
        local_1_1.push({
          "pid": p0.pid,
          "text": p0.text,
          "marks": local_2_0
        });
        return;
      }
      local_1_1.push(p0);
      return;
    });
    this.segmentInfos = local_1_1;
  }
  async onSegmentLike() {
    let v3, v5 /*hilog*/, v6, v7 /*pid*/, v8 /*pid*/;
    let local_1_0;
    v3 = 0;
    if (this.segmentLikeBusy || this.segmentReactionRepository === undefined || this.session === undefined || this.segmentSheetMarkIndex < 0) {
      return undefined;
    }
    if (this.kind !== ContentDetailKind.ANSWER && this.kind !== ContentDetailKind.ARTICLE) {
      return undefined;
    }
    local_1_0 = this.segmentSheetPid;
    v5 = this.segmentInfos.find(function (p0) {
      return p0.pid === local_1_0;
    });
    if (v5 === undefined) {
      return undefined;
    }
    v6 = v5.marks[this.segmentSheetMarkIndex] === undefined ? undefined : effectiveSegmentMeta(v5.marks[this.segmentSheetMarkIndex]);
    if (v6 === undefined) {
      return undefined;
    }
    v7 = this.kind === ContentDetailKind.ANSWER ? "answer" : "article";
    v8 = {
      "segIds": v6.segIds,
      "isLike": !v6.isLike,
      "likeCount": v6.isLike ? Math.max(v3, v6.likeCount - 1) : v6.likeCount + 1,
      "commentCount": v6.commentCount,
      "myCommentCount": v6.myCommentCount,
      "isSpan": v6.isSpan
    };
    this.segmentLikeBusy = true;
    try {
      this.applySegmentMeta(local_1_0, this.segmentSheetMarkIndex, v8);
      this.applySegmentMeta(local_1_0, this.segmentSheetMarkIndex, await this.segmentReactionRepository.toggleSegmentLike(v7, this.activeContentId, v5, this.segmentSheetMarkIndex));
    } catch (catchAcc) {
      hilog.warn(53249, "SegmentReaction", "toggle failed content=%{public}s like=%{public}s message=%{public}s", this.activeContentId, "" + v6.isLike + "", catchAcc instanceof Error ? catchAcc.message : "" + catchAcc + "");
      this.applySegmentMeta(local_1_0, this.segmentSheetMarkIndex, v6);
      this.notifySegmentLikeFailure();
    } finally {
      this.segmentLikeBusy = false;
    }
  }
  notifySegmentLikeFailure() {
    try {
      this.getUIContext().getPromptAction().showToast({
        "message": "操作失败，请稍后重试"
      });
    } catch (catchAcc) {
      hilog.warn(53249, "SegmentReaction", "toast failed message=%{public}s", catchAcc instanceof Error ? catchAcc.message : "" + catchAcc + "");
    }
  }
  extractSegmentInfos(p0) {
    if (p0 === undefined || p0.kind === ContentDetailKind.QUESTION) {
      return [];
    }
    return local_0_1(p0.value.segmentInfos ?? []);
  }
  copySegmentQuote() {
    let v0;
    let local_1_0 = this;
    v0 = local_1_0.currentSegmentQuote();
    if (v0.length === 0) {
      return;
    }
    v0 = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, v0);
    v0 = pasteboard.getSystemPasteboard().setData(v0);
    v0.then(function () {
      local_1_0.getUIContext().getPromptAction().showToast({
        "message": "已复制划线内容"
      });
    }).catch(function () {
      local_1_0.getUIContext().getPromptAction().showToast({
        "message": "复制失败"
      });
    });
    return;
  }
  segmentActionSheet(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331690,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.id("segment_action_sheet");
      Column.width("100%");
      Column.padding({
        "top": 16,
        "bottom": 24,
        "left": 20,
        "right": 20
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("划线片段");
      Text.id("segment_sheet_title");
      Text.fontSize({
        "id": 50331680,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("“" + local_1_0.currentSegmentQuote() + "”");
      Text.id("segment_sheet_quote");
      Text.fontSize({
        "id": 50331678,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.lineHeight({
        "id": 50331679,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.copyOption(CopyOptions.LocalDevice);
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.currentSegmentMeta() === undefined) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Row.create({
              "space": {
                "id": 50331691,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              }
            });
            Row.width("100%");
          }, Row);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            let v0 /*SegmentPill*/, v2;
            if (p1) {
              v2 = {
                "icon": local_1_0.currentSegmentMeta().isLike ? {
                  "id": 125832148,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                } : {
                  "id": 125832147,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                },
                "count": "" + local_1_0.currentSegmentMeta().likeCount + "",
                "active": local_1_0.currentSegmentMeta().isLike,
                "iconAccent": false,
                "testId": "segment_sheet_like",
                "label": local_1_0.currentSegmentMeta().isLike ? "取消点赞该划线" : "点赞该划线",
                "onTap": function () {
                  local_1_0.onSegmentLike();
                }
              };
              v0 = new SegmentPill(local_1_0, v2, undefined, p0, function () {}, {
                "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                "line": 569,
                "col": 11
              });
              ViewPU.create(v0);
              v0.paramsGenerator_ = function () {
                return {
                  "icon": local_1_0.currentSegmentMeta().isLike ? {
                    "id": 125832148,
                    "type": 40000,
                    "params": [],
                    "bundleName": "com.github.zhuoyi233.zhplus",
                    "moduleName": "entry"
                  } : {
                    "id": 125832147,
                    "type": 40000,
                    "params": [],
                    "bundleName": "com.github.zhuoyi233.zhplus",
                    "moduleName": "entry"
                  },
                  "count": "" + local_1_0.currentSegmentMeta().likeCount + "",
                  "active": local_1_0.currentSegmentMeta().isLike,
                  "iconAccent": false,
                  "testId": "segment_sheet_like",
                  "label": local_1_0.currentSegmentMeta().isLike ? "取消点赞该划线" : "点赞该划线",
                  "onTap": function () {
                    local_1_0.onSegmentLike();
                  }
                };
              };
            } else {
              local_1_0.updateStateVarsOfChildByElmtId(p0, {
                "icon": local_1_0.currentSegmentMeta().isLike ? {
                  "id": 125832148,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                } : {
                  "id": 125832147,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                },
                "count": "" + local_1_0.currentSegmentMeta().likeCount + "",
                "active": local_1_0.currentSegmentMeta().isLike,
                "iconAccent": false,
                "testId": "segment_sheet_like",
                "label": local_1_0.currentSegmentMeta().isLike ? "取消点赞该划线" : "点赞该划线"
              });
            }
          }, {
            "name": "SegmentPill"
          });
          local_1_0.observeComponentCreation2(function (p0, p1) {
            let v0 /*SegmentPill*/, v2;
            if (p1) {
              v2 = {
                "icon": {
                  "id": 125832126,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                },
                "count": "" + local_1_0.currentSegmentMeta().commentCount + "",
                "active": false,
                "iconAccent": true,
                "testId": "segment_sheet_comment",
                "label": "查看该划线的评论",
                "onTap": function () {
                  local_1_0.segmentSheetShown = false;
                  local_1_0.openSegmentComments();
                }
              };
              v0 = new SegmentPill(local_1_0, v2, undefined, p0, function () {}, {
                "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                "line": 581,
                "col": 11
              });
              ViewPU.create(v0);
              v0.paramsGenerator_ = function () {
                return {
                  "icon": {
                    "id": 125832126,
                    "type": 40000,
                    "params": [],
                    "bundleName": "com.github.zhuoyi233.zhplus",
                    "moduleName": "entry"
                  },
                  "count": "" + local_1_0.currentSegmentMeta().commentCount + "",
                  "active": false,
                  "iconAccent": true,
                  "testId": "segment_sheet_comment",
                  "label": "查看该划线的评论",
                  "onTap": function () {
                    local_1_0.segmentSheetShown = false;
                    local_1_0.openSegmentComments();
                  }
                };
              };
            } else {
              local_1_0.updateStateVarsOfChildByElmtId(p0, {
                "icon": {
                  "id": 125832126,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                },
                "count": "" + local_1_0.currentSegmentMeta().commentCount + "",
                "active": false,
                "iconAccent": true,
                "testId": "segment_sheet_comment",
                "label": "查看该划线的评论"
              });
            }
          }, {
            "name": "SegmentPill"
          });
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Button.createWithChild({
              "type": ButtonType.Normal,
              "stateEffect": true
            });
            Button.id("segment_sheet_copy");
            Button.width({
              "id": 50331676,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            Button.height({
              "id": 50331676,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            Button.padding(0);
            Button.backgroundColor(Color.Transparent);
            Button.accessibilityText("复制划线内容");
            Button.onClick(function () {
              local_1_0.copySegmentQuote();
            });
          }, Button);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125831952,
              "type": 40000,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(20);
            SymbolGlyph.fontColor([{
              "id": 50331664,
              "type": 10001,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            }]);
          }, SymbolGlyph);
          Button.pop();
          Row.pop();
        });
      }
    }, If);
    If.pop();
    Column.pop();
  }
  onImmersiveReadingChanged() {
    AppStorage.setOrCreate("detailImmersiveActive", this.immersiveReading);
    setStatusBarHidden(this.immersiveReading);
  }
  onImagePreviewChanged() {
    setStatusBarHidden(this.immersiveReading || this.imagePreviewUrl.length > 0);
  }
  onImmersiveExitSignal() {
    if (this.immersiveReading) {
      this.immersiveReading = false;
    }
  }
  async refreshQuestion() {
    let v8;
    this.refreshingAnswers = true;
    if (this.followController !== null && this.followController !== undefined) {
      this.followController.deactivate();
    }
    this.followController = undefined;
    try {
      v8 = [];
      v8[0] = (this.controller === null || this.controller === undefined ? undefined : this.controller.load(this.kind, this.activeContentId))
        ?? Promise.resolve();
      v8[1] = (this.answersController === null || this.answersController === undefined ? undefined : this.answersController.refresh())
        ?? Promise.resolve();
      await Promise.all(v8);
    } finally {
      this.refreshingAnswers = false;
    }
  }
  syncAnswerRefreshIndicator() {
    if (this.indicator !== null && this.indicator !== undefined) {
      this.indicator.setRefreshing(this.refreshingAnswers);
    }
  }
  createBlockingAction() {
    let local_1_0 = this;
    if (local_1_0.rules === undefined || local_1_0.history === undefined) {
      return;
    }
    local_1_0.blockingAction = new BlockingActionController(local_1_0.rules, local_1_0.history, function (p0) {
      local_1_0.blockingMessage = p0.message;
      local_1_0.blockingBusy = p0.busy;
    });
    return;
  }
  initialRender() {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.TopStart
      });
      Stack.width("100%");
      Stack.height("100%");
      Stack.clip(true);
      Stack.onAreaChange(function (p0, p1) {
        let v0 = Number(p1.width);
        if (v0 > 0 && Math.abs(v0 - local_1_0.answerViewportWidthVp) > 1) {
          local_1_0.answerViewportWidthVp = v0;
        }
      });
    }, Stack);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.id("content_" + local_1_0.kind + "_detail_page");
      Column.width("100%");
      Column.height("100%");
      Column.padding({
        "top": local_1_0.immersiveReading ? Math.max(local_1_0.statusBarHeightVp, 0) : 0
      });
      Column.backgroundColor({
        "id": 50331662,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.phase === ContentDetailPhase.LOADING || local_1_0.phase === ContentDetailPhase.IDLE) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.statusPanel.bind(local_1_0)("正在加载内容…", false);
        });
      } else if (local_1_0.phase === ContentDetailPhase.ERROR) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {
          local_1_0.statusPanel.bind(local_1_0)(local_1_0.errorMessage, true);
        });
      } else if (local_1_0.content === undefined) {
        local_1_0.ifElseBranchUpdateFunction(3, function () {});
      } else {
        local_1_0.ifElseBranchUpdateFunction(2, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.width("100%");
            Column.layoutWeight(1);
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.layoutWeight(1);
            Column.width("100%");
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.kind === ContentDetailKind.QUESTION) {
              local_1_0.ifElseBranchUpdateFunction(0, function () {
                local_1_0.questionDocument.bind(local_1_0)(ObservedObject.GetRawObject(local_1_0.content));
              });
            } else {
              local_1_0.ifElseBranchUpdateFunction(1, function () {
                local_1_0.loadedContent.bind(local_1_0)(ObservedObject.GetRawObject(local_1_0.content));
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
    Column.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.kind === ContentDetailKind.ANSWER && local_1_0.content !== undefined && local_1_0.phase === ContentDetailPhase.READY) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.answerSwitchMode === "horizontal") {
              local_1_0.ifElseBranchUpdateFunction(0, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  If.create();
                  if (local_1_0.answerOverscrollOffset > 0 && local_1_0.navigatorHasPrevious()) {
                    local_1_0.ifElseBranchUpdateFunction(0, function () {
                      local_1_0.observeComponentCreation2(function (p0, p1) {
                        Stack.create({
                          "alignContent": Alignment.Center
                        });
                        Stack.width("100%");
                        Stack.height("100%");
                        Stack.backgroundColor({
                          "id": 50331662,
                          "type": 10001,
                          "params": [],
                          "bundleName": "com.github.zhuoyi233.zhplus",
                          "moduleName": "entry"
                        });
                        Stack.translate({
                          "x": local_1_0.answerOverscrollOffset - local_1_0.answerViewportWidthVp
                        });
                        Stack.hitTestBehavior(HitTestMode.None);
                      }, Stack);
                      local_1_0.horizontalAnswerPage.bind(local_1_0)(true);
                      Stack.pop();
                    });
                  } else {
                    local_1_0.ifElseBranchUpdateFunction(1, function () {});
                  }
                }, If);
                If.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  If.create();
                  if (local_1_0.answerOverscrollOffset < 0 && local_1_0.navigatorHasNext()) {
                    local_1_0.ifElseBranchUpdateFunction(0, function () {
                      local_1_0.observeComponentCreation2(function (p0, p1) {
                        Stack.create({
                          "alignContent": Alignment.Center
                        });
                        Stack.width("100%");
                        Stack.height("100%");
                        Stack.backgroundColor({
                          "id": 50331662,
                          "type": 10001,
                          "params": [],
                          "bundleName": "com.github.zhuoyi233.zhplus",
                          "moduleName": "entry"
                        });
                        Stack.translate({
                          "x": local_1_0.answerOverscrollOffset + local_1_0.answerViewportWidthVp
                        });
                        Stack.hitTestBehavior(HitTestMode.None);
                      }, Stack);
                      local_1_0.horizontalAnswerPage.bind(local_1_0)(false);
                      Stack.pop();
                    });
                  } else {
                    local_1_0.ifElseBranchUpdateFunction(1, function () {});
                  }
                }, If);
                If.pop();
              });
            } else {
              local_1_0.ifElseBranchUpdateFunction(1, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  If.create();
                  if (local_1_0.answerOverscrollOffset > 0 && local_1_0.navigatorHasPrevious()) {
                    local_1_0.ifElseBranchUpdateFunction(0, function () {
                      local_1_0.observeComponentCreation2(function (p0, p1) {
                        Stack.create({
                          "alignContent": Alignment.Top
                        });
                        Stack.width("100%");
                        Stack.height("100%");
                        Stack.hitTestBehavior(HitTestMode.None);
                      }, Stack);
                      local_1_0.answerPreviewCard.bind(local_1_0)(true);
                      Stack.pop();
                    });
                  } else {
                    local_1_0.ifElseBranchUpdateFunction(1, function () {});
                  }
                }, If);
                If.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  If.create();
                  if (local_1_0.answerOverscrollOffset < 0 && local_1_0.navigatorHasNext()) {
                    local_1_0.ifElseBranchUpdateFunction(0, function () {
                      local_1_0.observeComponentCreation2(function (p0, p1) {
                        Stack.create({
                          "alignContent": Alignment.Bottom
                        });
                        Stack.width("100%");
                        Stack.height("100%");
                        Stack.hitTestBehavior(HitTestMode.None);
                      }, Stack);
                      local_1_0.answerPreviewCard.bind(local_1_0)(false);
                      Stack.pop();
                    });
                  } else {
                    local_1_0.ifElseBranchUpdateFunction(1, function () {});
                  }
                }, If);
                If.pop();
              });
            }
          }, If);
          If.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v0;
      If.create();
      v0 = !local_1_0.immersiveReading;
      if (v0) {
        v0 = !local_1_0.autoHideArticleBottomBar || !local_1_0.chromeHiddenByScroll;
      }
      if (v0) {
        v0 = local_1_0.content !== undefined;
      }
      if (v0 && local_1_0.phase === ContentDetailPhase.READY) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            let v0, v4;
            Stack.create({
              "alignContent": Alignment.Bottom
            });
            Stack.width("100%");
            Stack.height("100%");
            v4 = local_1_0.kind !== ContentDetailKind.ANSWER ? 1 : local_1_0.answerSwitchMode === "horizontal" ? 1 : Math.max(0, 1 - local_1_0.answerOverscrollProgress());
            Stack.opacity(v4);
            v0 = local_1_0.kind !== ContentDetailKind.ANSWER ? HitTestMode.Transparent : local_1_0.answerOverscrollOffset !== 0 || local_1_0.answerOverscrollProgress() >= 1 ? HitTestMode.None : HitTestMode.Transparent;
            Stack.hitTestBehavior(v0);
            Stack.translate({
              "x": local_1_0.answerSwitchMode === "horizontal" ? local_1_0.answerOverscrollOffset : 0,
              "y": local_1_0.answerSwitchMode !== "horizontal" ? local_1_0.answerOverscrollOffset : 0
            });
          }, Stack);
          local_1_0.bottomActionBar.bind(local_1_0)();
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v0;
      If.create();
      v0 = local_1_0.kind === ContentDetailKind.ANSWER
        && local_1_0.buttonSkipAnswer
        && !local_1_0.immersiveReading
        && local_1_0.answerFabPositionReady;
      if (v0) {
        v0 = !local_1_0.autoHideSkipAnswerButton;
        if (!v0) {
          v0 = !local_1_0.chromeHiddenByScroll;
          if (v0) {
            v0 = !local_1_0.contentAtBottom || local_1_0.contentAtTop;
          }
        }
      }
      if (v0) {
        v0 = local_1_0.content !== undefined;
      }
      if (v0) {
        v0 = local_1_0.phase === ContentDetailPhase.READY;
      }
      if (v0) {
        v0 = local_1_0.answerOverscrollOffset >= 0;
      }
      if (v0 && local_1_0.navigatorHasNext()) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Stack.create({
              "alignContent": Alignment.BottomEnd
            });
            Stack.width("100%");
            Stack.height("100%");
            Stack.hitTestBehavior(HitTestMode.Transparent);
            Stack.onAreaChange(function (p0, p1) {
              let v2 = Number(p1.width);
              let v3 = Number(p1.height);
              if (v2 > 0 && Math.abs(v2 - local_1_0.answerFabOverlayWidthVp) > 1) {
                local_1_0.answerFabOverlayWidthVp = v2;
              }
              if (v3 > 0 && Math.abs(v3 - local_1_0.answerFabOverlayHeightVp) > 1) {
                local_1_0.answerFabOverlayHeightVp = v3;
              }
              local_1_0.applySavedAnswerFabPosition();
            });
          }, Stack);
          local_1_0.answerNextFloatingButton.bind(local_1_0)();
          Stack.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.phase === ContentDetailPhase.READY && local_1_0.collectionRepository !== undefined && local_1_0.session !== undefined) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create();
            Column.bindSheet(local_1_0.favoriteDialogShown, {
              "builder": function () {
                local_1_0.favoriteDialog();
              }
            }, {
              "height": SheetSize.LARGE,
              "dragBar": true,
              "showClose": false,
              "maskColor": "#66000000",
              "backgroundColor": {
                "id": 50331666,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              },
              "onDisappear": function () {
                if (local_1_0.favoriteDialogShown) {
                  local_1_0.favoriteDialogShown = false;
                }
              }
            });
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
      if (local_1_0.pendingUserBlock === undefined) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.userBlockDialog.bind(local_1_0)();
        });
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.keywordBlockVisible) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.keywordBlockDialog.bind(local_1_0)();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.bindSheet(local_1_0.actionMenuShown, {
        "builder": function () {
          local_1_0.actionMenuSheet();
        }
      }, {
        "height": SheetSize.FIT_CONTENT,
        "dragBar": true,
        "showClose": false,
        "maskColor": "#66000000",
        "backgroundColor": {
          "id": 50331666,
          "type": 10001,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "onDisappear": function () {
          if (local_1_0.actionMenuShown) {
            local_1_0.actionMenuShown = false;
          }
        }
      });
    }, Column);
    Column.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.bindSheet(local_1_0.doubleTapAskSheetShown, {
        "builder": function () {
          local_1_0.doubleTapAskSheet();
        }
      }, {
        "height": SheetSize.FIT_CONTENT,
        "dragBar": true,
        "showClose": false,
        "maskColor": "#66000000",
        "backgroundColor": {
          "id": 50331666,
          "type": 10001,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "onDisappear": function () {
          if (local_1_0.doubleTapAskSheetShown) {
            local_1_0.doubleTapAskSheetShown = false;
          }
        }
      });
    }, Column);
    Column.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.bindSheet(local_1_0.segmentSheetShown, {
        "builder": function () {
          local_1_0.segmentActionSheet();
        }
      }, {
        "height": SheetSize.FIT_CONTENT,
        "dragBar": true,
        "showClose": false,
        "maskColor": "#66000000",
        "backgroundColor": {
          "id": 50331666,
          "type": 10001,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "onWillDismiss": function (p0) {
          return local_1_0.guardSegmentSheetDismiss(p0);
        },
        "onDisappear": function () {
          if (local_1_0.segmentSheetShown) {
            local_1_0.segmentSheetShown = false;
            local_1_0.segmentSheetPid = "";
            local_1_0.segmentSheetMarkIndex = -1;
          }
        }
      });
    }, Column);
    Column.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.imagePreviewUrl.length > 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake("image_preview_overlay")) {
            local_1_0.observeComponentCreation2(function (p0, p1) {
              Stack.create({
                "alignContent": Alignment.Center
              });
              Stack.id("image_preview_overlay");
              Stack.width("100%");
              Stack.height("100%");
            }, Stack);
            local_1_0.observeComponentCreation2(function (p0, p1) {
              let acc;
              if (p1) {
                acc = new ContentImagePreview(local_1_0, {
                  "url": local_1_0.imagePreviewUrl,
                  "onClose": function () {
                    AppStorage.setOrCreate("imagePreviewUrl", "");
                  }
                }, undefined, p0, function () {}, {
                  "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                  "line": 867,
                  "col": 11
                });
                ViewPU.create(acc);
                acc.paramsGenerator_ = function () {
                  return {
                    "url": local_1_0.imagePreviewUrl,
                    "onClose": function () {
                      AppStorage.setOrCreate("imagePreviewUrl", "");
                    }
                  };
                };
              } else {
                local_1_0.updateStateVarsOfChildByElmtId(p0, {
                  "url": local_1_0.imagePreviewUrl
                });
              }
            }, {
              "name": "ContentImagePreview"
            });
            Stack.pop();
          }
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Stack.pop();
  }
  favoriteDialog(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*CollectionDialogComponent*/;
      if (p1) {
        v0 = new CollectionDialogComponent(local_1_0, {
          "contentType": local_1_0.kind === ContentDetailKind.ARTICLE ? "article" : "answer",
          "contentId": local_1_0.activeContentId,
          "repository": local_1_0.collectionRepository,
          "session": local_1_0.session,
          "navigate": local_1_0.navigate,
          "onDismiss": function () {
            local_1_0.favoriteDialogShown = false;
          },
          "onFavoriteStateChange": function (p0) {
            local_1_0.contentFavorited = p0;
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 892,
          "col": 5
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "contentType": local_1_0.kind === ContentDetailKind.ARTICLE ? "article" : "answer",
            "contentId": local_1_0.activeContentId,
            "repository": local_1_0.collectionRepository,
            "session": local_1_0.session,
            "navigate": local_1_0.navigate,
            "onDismiss": function () {
              local_1_0.favoriteDialogShown = false;
            },
            "onFavoriteStateChange": function (p0) {
              local_1_0.contentFavorited = p0;
            }
          };
        };
      } else {
        local_1_0.updateStateVarsOfChildByElmtId(p0, {});
      }
    }, {
      "name": "CollectionDialogComponent"
    });
  }
  refreshContentFavoriteState() {
    let v1, acc;
    let local_1_0;
    let local_1_1 = this;
    if (local_1_1.collectionRepository === undefined || local_1_1.session === undefined || local_1_1.session.getState().status !== SessionStatus.AUTHENTICATED || local_1_1.kind === ContentDetailKind.QUESTION) {
      local_1_1.contentFavorited = false;
      return;
    }
    v1 = local_1_1.kind === ContentDetailKind.ARTICLE ? "article" : "answer";
    local_1_0 = local_1_1.activeContentId;
    local_1_1.favoriteStateContentId = local_1_0;
    acc = local_1_1.collectionRepository.getContentCollections(v1, local_1_0).then(function (p0) {
      if (!local_1_1.pageActive || local_1_1.favoriteStateContentId !== local_1_0) {
        return;
      }
      local_1_1.contentFavorited = p0.some(function (p0) {
        return p0.isFavorited;
      });
      return;
    });
    acc.catch(function (p0) {});
    return;
  }
  statusPanel(p0, p1, p2) {
    let local_1_2 = this;
    let local_1_1 = p0;
    let local_1_0 = p1;
    local_1_2.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331690,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.justifyContent(FlexAlign.Center);
      Column.alignItems(HorizontalAlign.Center);
      Column.width("100%");
      Column.layoutWeight(1);
      Column.padding({
        "id": 50331674,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Column);
    local_1_2.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (!local_1_0) {
        local_1_2.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake("content_" + local_1_2.kind + "_detail_loading_progress")) {
            local_1_2.observeComponentCreation2(function (p0, p1) {
              LoadingProgress.create();
              LoadingProgress.id("content_" + local_1_2.kind + "_detail_loading_progress");
              LoadingProgress.width(40);
              LoadingProgress.height(40);
              LoadingProgress.color(local_1_2.resolvedThemeColor);
            }, LoadingProgress);
          }
        });
      } else {
        local_1_2.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_2.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_1);
      Text.id("content_" + local_1_2.kind + "_detail_status");
      Text.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.textAlign(TextAlign.Center);
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_2.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0) {
        local_1_2.ifElseBranchUpdateFunction(0, function () {
          local_1_2.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_2.requiresLogin) {
              local_1_2.ifElseBranchUpdateFunction(0, function () {
                if (!If.canRetake("content_" + local_1_2.kind + "_detail_login")) {
                  local_1_2.observeComponentCreation2(function (p0, p1) {
                    Button.createWithLabel("去登录");
                    Button.backgroundColor(local_1_2.resolvedThemeColor);
                    Button.fontColor(onThemeColor(local_1_2.resolvedThemeColor));
                    Button.id("content_" + local_1_2.kind + "_detail_login");
                    Button.onClick(function () {
                      local_1_2.navigate({
                        "name": AppDestinationName.LOGIN
                      });
                    });
                  }, Button);
                  Button.pop();
                }
              });
            } else {
              local_1_2.ifElseBranchUpdateFunction(1, function () {
                if (!If.canRetake("content_" + local_1_2.kind + "_detail_retry")) {
                  local_1_2.observeComponentCreation2(function (p0, p1) {
                    Button.createWithLabel("重新加载");
                    Button.backgroundColor(local_1_2.resolvedThemeColor);
                    Button.fontColor(onThemeColor(local_1_2.resolvedThemeColor));
                    Button.id("content_" + local_1_2.kind + "_detail_retry");
                    Button.onClick(function () {
                      if (local_1_2.controller !== null && local_1_2.controller !== undefined) {
                        local_1_2.controller.load(local_1_2.kind, local_1_2.activeContentId);
                      }
                    });
                  }, Button);
                  Button.pop();
                }
              });
            }
          }, If);
          If.pop();
        });
      } else {
        local_1_2.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Column.pop();
  }
  loadedContent(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Bottom
      });
      Stack.width("100%");
      Stack.height("100%");
      Stack.clip(true);
      globalThis.Gesture.create(GesturePriority.Parallel);
      PanGesture.create({
        "fingers": 1,
        "direction": local_1_1.answerSwitchMode === "horizontal" ? PanDirection.Horizontal : PanDirection.Vertical
      });
      PanGesture.onActionStart(function (p0) {
        local_1_1.overscrollPanPrevY = local_1_1.answerSwitchMode === "horizontal" ? p0.offsetX : p0.offsetY;
      });
      PanGesture.onActionUpdate(function (p0) {
        local_1_1.onAnswerOverscrollPanUpdate(p0);
      });
      PanGesture.onActionEnd(function () {
        local_1_1.onAnswerOverscrollPanEnd();
      });
      PanGesture.onActionCancel(function () {
        local_1_1.cancelAnswerOverscrollPan();
      });
      PanGesture.pop();
      globalThis.Gesture.pop();
      globalThis.Gesture.create(GesturePriority.Low);
      TapGesture.create({
        "count": 2
      });
      TapGesture.onAction(function () {
        local_1_1.onContentDoubleTap();
      });
      TapGesture.pop();
      globalThis.Gesture.pop();
    }, Stack);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.height("100%");
      Column.translate({
        "x": local_1_1.answerSwitchMode === "horizontal" ? local_1_1.answerOverscrollOffset : 0,
        "y": local_1_1.answerSwitchMode !== "horizontal" ? local_1_1.answerOverscrollOffset : 0
      });
    }, Column);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      __Common__.create();
      __Common__.layoutWeight(1);
    }, __Common__);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = {
          "html": contentHtml(local_1_0),
          "emptyMessage": contentEmptyMessage(local_1_0),
          "linkCardMetaRepository": local_1_1.linkCardMetaRepository,
          "disableEdgeSpring": local_1_1.kind === ContentDetailKind.ANSWER,
          "topInsetVp": local_1_1.immersiveReading ? 0 : FLOATING_TITLE_BAR_OFFSET,
          "onVideoOpen": function (p0) {
            return local_1_1.openVideo(p0);
          },
          "onLinkClick": function (p0) {
            return local_1_1.openContentLink(p0);
          },
          "onBodyDoubleTap": function () {
            return local_1_1.onContentDoubleTap();
          },
          "documentHeader": function () {
            local_1_1.contentHeader(local_1_0);
          },
          "documentFooter": function () {
            local_1_1.contentDateFooter(local_1_0);
          },
          "onScrollOffset": function (p0) {
            if (local_1_1.pageActive) {
              if (!acceptsContentDocumentEvent(local_1_1.phase, local_1_1.content, local_1_0)) {
                return;
              }
              local_1_1.updateChromeHiddenByScroll(p0);
              if (local_1_1.kind === ContentDetailKind.ANSWER) {
                local_1_1.updateAnswerTitleScrolled(local_1_0, p0);
              } else {
                local_1_1.updateArticleTitleScrolled(local_1_0, p0);
              }
            }
            return;
          },
          "onBottomEdgeChange": function (p0) {
            if (local_1_1.pageActive) {
              if (!acceptsContentDocumentEvent(local_1_1.phase, local_1_1.content, local_1_0)) {
                return;
              }
              local_1_1.contentAtBottom = p0;
              local_1_1.revealChromeAtBottom(p0);
            }
            return;
          },
          "onTopEdgeChange": function (p0) {
            if (local_1_1.pageActive) {
              if (!acceptsContentDocumentEvent(local_1_1.phase, local_1_1.content, local_1_0)) {
                return;
              }
              local_1_1.contentAtTop = p0;
            }
            return;
          },
          "onPageTurnPastStart": function () {
            if (local_1_1.pageTurnSwitchAnswer && local_1_1.kind === ContentDetailKind.ANSWER) {
              local_1_1.moveAnswer(-1);
            }
          },
          "onPageTurnPastEnd": function () {
            if (local_1_1.pageTurnSwitchAnswer && local_1_1.kind === ContentDetailKind.ANSWER) {
              local_1_1.moveAnswer(1);
            }
          },
          "segmentInfos": local_1_1.segmentInfos,
          "onSegmentClick": function (p0, p1) {
            return local_1_1.openSegmentSheet(p0, p1);
          },
          "onBodySelectionActive": function (p0) {
            local_1_1.bodyTextSelectionActive = p0;
          }
        };
        acc = new NativeContentDocument(local_1_1, acc, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 985,
          "col": 9
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "html": contentHtml(local_1_0),
            "emptyMessage": contentEmptyMessage(local_1_0),
            "linkCardMetaRepository": local_1_1.linkCardMetaRepository,
            "disableEdgeSpring": local_1_1.kind === ContentDetailKind.ANSWER,
            "topInsetVp": local_1_1.immersiveReading ? 0 : FLOATING_TITLE_BAR_OFFSET,
            "onVideoOpen": function (p0) {
              return local_1_1.openVideo(p0);
            },
            "onLinkClick": function (p0) {
              return local_1_1.openContentLink(p0);
            },
            "onBodyDoubleTap": function () {
              return local_1_1.onContentDoubleTap();
            },
            "documentHeader": function () {
              local_1_1.contentHeader(local_1_0);
            },
            "documentFooter": function () {
              local_1_1.contentDateFooter(local_1_0);
            },
            "onScrollOffset": function (p0) {
              if (local_1_1.pageActive) {
                if (!acceptsContentDocumentEvent(local_1_1.phase, local_1_1.content, local_1_0)) {
                  return;
                }
                local_1_1.updateChromeHiddenByScroll(p0);
                if (local_1_1.kind === ContentDetailKind.ANSWER) {
                  local_1_1.updateAnswerTitleScrolled(local_1_0, p0);
                } else {
                  local_1_1.updateArticleTitleScrolled(local_1_0, p0);
                }
              }
              return;
            },
            "onBottomEdgeChange": function (p0) {
              if (local_1_1.pageActive) {
                if (!acceptsContentDocumentEvent(local_1_1.phase, local_1_1.content, local_1_0)) {
                  return;
                }
                local_1_1.contentAtBottom = p0;
                local_1_1.revealChromeAtBottom(p0);
              }
              return;
            },
            "onTopEdgeChange": function (p0) {
              if (local_1_1.pageActive) {
                if (!acceptsContentDocumentEvent(local_1_1.phase, local_1_1.content, local_1_0)) {
                  return;
                }
                local_1_1.contentAtTop = p0;
              }
              return;
            },
            "onPageTurnPastStart": function () {
              if (local_1_1.pageTurnSwitchAnswer && local_1_1.kind === ContentDetailKind.ANSWER) {
                local_1_1.moveAnswer(-1);
              }
            },
            "onPageTurnPastEnd": function () {
              if (local_1_1.pageTurnSwitchAnswer && local_1_1.kind === ContentDetailKind.ANSWER) {
                local_1_1.moveAnswer(1);
              }
            },
            "segmentInfos": local_1_1.segmentInfos,
            "onSegmentClick": function (p0, p1) {
              return local_1_1.openSegmentSheet(p0, p1);
            },
            "onBodySelectionActive": function (p0) {
              local_1_1.bodyTextSelectionActive = p0;
            }
          };
        };
      } else {
        local_1_1.updateStateVarsOfChildByElmtId(p0, {
          "segmentInfos": local_1_1.segmentInfos
        });
      }
    }, {
      "name": "NativeContentDocument"
    });
    __Common__.pop();
    Column.pop();
    Stack.pop();
  }
  horizontalAnswerPage(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.TopStart
      });
      Stack.id(local_1_0 ? "answer_prev_horizontal_page" : "answer_next_horizontal_page");
      Stack.width("100%");
      Stack.height("100%");
      Stack.backgroundColor({
        "id": 50331662,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Stack);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.height("100%");
    }, Column);
    local_1_1.horizontalAnswerTitleBar.bind(local_1_1)();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.layoutWeight(1);
      Column.width("100%");
      Column.padding({
        "left": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "right": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "top": {
          "id": 50331690,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.clip(true);
    }, Column);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_1.currentAnswerQuestionTitle());
      Text.id(local_1_0 ? "answer_prev_horizontal_question" : "answer_next_horizontal_question");
      Text.fontSize({
        "id": 50331673,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(FontWeight.Bold);
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Row.width("100%");
    }, Row);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Center
      });
      Stack.width(40);
      Stack.height(40);
      Stack.clip(true);
    }, Stack);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Circle.create();
      Circle.width(40);
      Circle.height(40);
      Circle.fill({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Circle);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_1.answerPreviewAvatarUrl(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          local_1_1.observeComponentCreation2(function (p0, p1) {
            Image.create(local_1_1.answerPreviewAvatarUrl(local_1_0));
            Image.width(40);
            Image.height(40);
            Image.borderRadius(20);
            Image.objectFit(ImageFit.Cover);
          }, Image);
        });
      } else if (local_1_1.answerPreviewAuthorName(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(1, function () {
          local_1_1.observeComponentCreation2(function (p0, p1) {
            Text.create(local_1_1.answerPreviewAuthorName(local_1_0).substring(0, 1));
            Text.fontSize({
              "id": 50331668,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            Text.fontColor({
              "id": 50331664,
              "type": 10001,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
          }, Text);
          Text.pop();
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(2, function () {});
      }
    }, If);
    If.pop();
    Stack.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": 2
      });
      Column.layoutWeight(1);
      Column.alignItems(HorizontalAlign.Start);
    }, Column);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_1.answerPreviewAuthorName(local_1_0));
      Text.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(FontWeight.Medium);
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.maxLines(1);
      Text.textOverflow({
        "overflow": TextOverflow.Ellipsis
      });
    }, Text);
    Text.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_1.answerPreviewAuthorHeadline(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          local_1_1.observeComponentCreation2(function (p0, p1) {
            Text.create(local_1_1.answerPreviewAuthorHeadline(local_1_0));
            Text.fontSize({
              "id": 50331669,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            Text.fontColor({
              "id": 50331664,
              "type": 10001,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            Text.maxLines(1);
            Text.textOverflow({
              "overflow": TextOverflow.Ellipsis
            });
          }, Text);
          Text.pop();
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Column.pop();
    Row.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Text.create("" + local_1_1.answerPreviewVoteupCount(local_1_0) + " 赞同 · " + local_1_1.answerPreviewCommentCount(local_1_0) + " 条评论");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_1.answerPreviewExcerpt(local_1_0));
      Text.fontSize(readerBodyFontSize(local_1_1.previewFontSizePercent));
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.lineHeight(readerBodyLineHeight(local_1_1.previewFontSizePercent, local_1_1.previewLineHeightPercent));
      Text.width("100%");
    }, Text);
    Text.pop();
    Column.pop();
    Column.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Bottom
      });
      Stack.width("100%");
      Stack.height("100%");
      Stack.hitTestBehavior(HitTestMode.None);
    }, Stack);
    local_1_1.horizontalAnswerBottomBar.bind(local_1_1)(local_1_0);
    Stack.pop();
    Stack.pop();
  }
  horizontalAnswerTitleBar(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.height(FLOATING_TITLE_BAR_OFFSET);
      Column.justifyContent(FlexAlign.Center);
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v0 /*AnswerTitleBar*/;
      if (p1) {
        v0 = new AnswerTitleBar(local_1_0, {
          "answerId": "",
          "previewMode": true
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 1180,
          "col": 7
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "answerId": "",
            "previewMode": true
          };
        };
      } else {
        local_1_0.updateStateVarsOfChildByElmtId(p0, {});
      }
    }, {
      "name": "AnswerTitleBar"
    });
    Column.pop();
  }
  horizontalAnswerBottomBar(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.hitTestBehavior(HitTestMode.None);
    }, Column);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Row.width("100%");
      Row.padding({
        "left": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "right": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "bottom": Math.max(local_1_1.bottomRectHeightVp, 0)
      });
    }, Row);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let v0 /*GlassCapsule*/;
      if (p1) {
        v0 = new GlassCapsule(local_1_1, {
          "useMaterial": local_1_1.immersiveMaterialSupported,
          "content": function () {
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Row.create({
                "space": 0
              });
            }, Row);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Row.create({
                "space": 4
              });
              Row.padding({
                "left": 8,
                "right": 8,
                "top": 8,
                "bottom": 8
              });
            }, Row);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              SymbolGlyph.create({
                "id": 125835554,
                "type": 40000,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              SymbolGlyph.fontSize(20);
              SymbolGlyph.fontColor([local_1_1.resolvedThemeColor]);
              SymbolGlyph.rotate({
                "x": 0,
                "y": 0,
                "z": 1,
                "angle": 90
              });
            }, SymbolGlyph);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create("" + local_1_1.answerPreviewVoteupCount(local_1_0) + "");
              Text.fontSize({
                "id": 50331675,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontWeight(FontWeight.Medium);
              Text.fontColor(local_1_1.resolvedThemeColor);
            }, Text);
            Text.pop();
            Row.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              SymbolGlyph.create({
                "id": 125835554,
                "type": 40000,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              SymbolGlyph.fontSize(20);
              SymbolGlyph.fontColor([local_1_1.resolvedThemeColor]);
              SymbolGlyph.rotate({
                "x": 0,
                "y": 0,
                "z": 1,
                "angle": -90
              });
              SymbolGlyph.padding({
                "left": 8,
                "right": 8,
                "top": 8,
                "bottom": 8
              });
            }, SymbolGlyph);
            Row.pop();
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 1192,
          "col": 9
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "useMaterial": local_1_1.immersiveMaterialSupported,
            "content": function () {
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Row.create({
                  "space": 0
                });
              }, Row);
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Row.create({
                  "space": 4
                });
                Row.padding({
                  "left": 8,
                  "right": 8,
                  "top": 8,
                  "bottom": 8
                });
              }, Row);
              local_1_1.observeComponentCreation2(function (p0, p1) {
                SymbolGlyph.create({
                  "id": 125835554,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                SymbolGlyph.fontSize(20);
                SymbolGlyph.fontColor([local_1_1.resolvedThemeColor]);
                SymbolGlyph.rotate({
                  "x": 0,
                  "y": 0,
                  "z": 1,
                  "angle": 90
                });
              }, SymbolGlyph);
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Text.create("" + local_1_1.answerPreviewVoteupCount(local_1_0) + "");
                Text.fontSize({
                  "id": 50331675,
                  "type": 10002,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                Text.fontWeight(FontWeight.Medium);
                Text.fontColor(local_1_1.resolvedThemeColor);
              }, Text);
              Text.pop();
              Row.pop();
              local_1_1.observeComponentCreation2(function (p0, p1) {
                SymbolGlyph.create({
                  "id": 125835554,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                SymbolGlyph.fontSize(20);
                SymbolGlyph.fontColor([local_1_1.resolvedThemeColor]);
                SymbolGlyph.rotate({
                  "x": 0,
                  "y": 0,
                  "z": 1,
                  "angle": -90
                });
                SymbolGlyph.padding({
                  "left": 8,
                  "right": 8,
                  "top": 8,
                  "bottom": 8
                });
              }, SymbolGlyph);
              Row.pop();
            }
          };
        };
      } else {
        local_1_1.updateStateVarsOfChildByElmtId(p0, {
          "useMaterial": local_1_1.immersiveMaterialSupported
        });
      }
    }, {
      "name": "GlassCapsule"
    });
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Blank.create();
      Blank.layoutWeight(1);
    }, Blank);
    Blank.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let v0 /*GlassCapsule*/;
      if (p1) {
        v0 = new GlassCapsule(local_1_1, {
          "useMaterial": local_1_1.immersiveMaterialSupported,
          "content": function () {
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Row.create({
                "space": 0
              });
            }, Row);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              SymbolGlyph.create({
                "id": 125831605,
                "type": 40000,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              SymbolGlyph.fontSize(20);
              SymbolGlyph.fontColor([{
                "id": 50331664,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              }]);
              SymbolGlyph.width(36);
              SymbolGlyph.height(36);
            }, SymbolGlyph);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Row.create({
                "space": 4
              });
              Row.padding({
                "left": 6,
                "right": 6,
                "top": 8,
                "bottom": 8
              });
            }, Row);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              SymbolGlyph.create({
                "id": 125831766,
                "type": 40000,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              SymbolGlyph.fontSize(20);
              SymbolGlyph.fontColor([{
                "id": 50331664,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              }]);
            }, SymbolGlyph);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create("" + local_1_1.answerPreviewCommentCount(local_1_0) + "");
              Text.fontSize({
                "id": 50331675,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontWeight(FontWeight.Medium);
              Text.fontColor({
                "id": 50331664,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
            }, Text);
            Text.pop();
            Row.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              SymbolGlyph.create({
                "id": 125833751,
                "type": 40000,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              SymbolGlyph.fontSize(20);
              SymbolGlyph.fontColor([{
                "id": 50331664,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              }]);
              SymbolGlyph.width(36);
              SymbolGlyph.height(36);
            }, SymbolGlyph);
            Row.pop();
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 1216,
          "col": 9
        });
        ViewPU.create(v0);
        v0.paramsGenerator_ = function () {
          return {
            "useMaterial": local_1_1.immersiveMaterialSupported,
            "content": function () {
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Row.create({
                  "space": 0
                });
              }, Row);
              local_1_1.observeComponentCreation2(function (p0, p1) {
                SymbolGlyph.create({
                  "id": 125831605,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                SymbolGlyph.fontSize(20);
                SymbolGlyph.fontColor([{
                  "id": 50331664,
                  "type": 10001,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                }]);
                SymbolGlyph.width(36);
                SymbolGlyph.height(36);
              }, SymbolGlyph);
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Row.create({
                  "space": 4
                });
                Row.padding({
                  "left": 6,
                  "right": 6,
                  "top": 8,
                  "bottom": 8
                });
              }, Row);
              local_1_1.observeComponentCreation2(function (p0, p1) {
                SymbolGlyph.create({
                  "id": 125831766,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                SymbolGlyph.fontSize(20);
                SymbolGlyph.fontColor([{
                  "id": 50331664,
                  "type": 10001,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                }]);
              }, SymbolGlyph);
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Text.create("" + local_1_1.answerPreviewCommentCount(local_1_0) + "");
                Text.fontSize({
                  "id": 50331675,
                  "type": 10002,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                Text.fontWeight(FontWeight.Medium);
                Text.fontColor({
                  "id": 50331664,
                  "type": 10001,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
              }, Text);
              Text.pop();
              Row.pop();
              local_1_1.observeComponentCreation2(function (p0, p1) {
                SymbolGlyph.create({
                  "id": 125833751,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                SymbolGlyph.fontSize(20);
                SymbolGlyph.fontColor([{
                  "id": 50331664,
                  "type": 10001,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                }]);
                SymbolGlyph.width(36);
                SymbolGlyph.height(36);
              }, SymbolGlyph);
              Row.pop();
            }
          };
        };
      } else {
        local_1_1.updateStateVarsOfChildByElmtId(p0, {
          "useMaterial": local_1_1.immersiveMaterialSupported
        });
      }
    }, {
      "name": "GlassCapsule"
    });
    Row.pop();
    Column.pop();
  }
  answerPreviewCard(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let v2 /*themeColorContainerColor*/;
      Column.create({
        "space": 8
      });
      Column.id(local_1_0 ? "answer_prev_preview_card" : "answer_next_preview_card");
      Column.width("100%");
      Column.padding(12);
      Column.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      v2 = {
        "left": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "right": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "top": local_1_0 ? Math.max(local_1_1.statusBarHeightVp, 0) : 0,
        "bottom": local_1_0 ? 0 : 8 + Math.max(local_1_1.bottomRectHeightVp, 0)
      };
      Column.margin(v2);
      v2 = local_1_1.answerOverscrollTriggered() ? themeColorContainerColor(local_1_1.resolvedThemeColor) : {
        "id": 50331666,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      };
      Column.backgroundColor(v2);
      Column.opacity(local_1_1.answerOverscrollProgress());
    }, Column);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          local_1_1.answerPreviewLabelRow.bind(local_1_1)(local_1_0);
          local_1_1.answerPreviewAuthorRow.bind(local_1_1)(local_1_0);
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {
          local_1_1.answerPreviewAuthorRow.bind(local_1_1)(local_1_0);
          local_1_1.answerPreviewLabelRow.bind(local_1_1)(local_1_0);
        });
      }
    }, If);
    If.pop();
    Column.pop();
  }
  answerPreviewLabelRow(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 6
      });
      Row.width("100%");
    }, Row);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let v2;
      SymbolGlyph.create(local_1_0 ? {
        "id": 125832671,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      } : {
        "id": 125832675,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(16);
      v2 = [];
      v2[0] = local_1_1.answerOverscrollTriggered() ? local_1_1.resolvedThemeColor : {
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      };
      SymbolGlyph.fontColor(v2);
    }, SymbolGlyph);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let v2 = local_1_1.answerOverscrollTriggered() ? "松手切换" : local_1_0 ? "上一个回答" : "下一个回答";
      Text.create(v2);
      Text.fontSize({
        "id": 50331669,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      v2 = local_1_1.answerOverscrollTriggered() ? FontWeight.Bold : FontWeight.Normal;
      Text.fontWeight(v2);
      v2 = local_1_1.answerOverscrollTriggered() ? local_1_1.resolvedThemeColor : {
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      };
      Text.fontColor(v2);
    }, Text);
    Text.pop();
    Row.pop();
  }
  answerPreviewAuthorRow(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 8
      });
      Row.width("100%");
    }, Row);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Stack.create({
        "alignContent": Alignment.Center
      });
      Stack.width(28);
      Stack.height(28);
      Stack.clip(true);
    }, Stack);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Circle.create();
      Circle.width(28);
      Circle.height(28);
      Circle.fill({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Circle);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_1.answerPreviewAvatarUrl(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake(local_1_0 ? "answer_prev_preview_avatar" : "answer_next_preview_avatar")) {
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Image.create(local_1_1.answerPreviewAvatarUrl(local_1_0));
              Image.id(local_1_0 ? "answer_prev_preview_avatar" : "answer_next_preview_avatar");
              Image.width(28);
              Image.height(28);
              Image.borderRadius(14);
              Image.objectFit(ImageFit.Cover);
            }, Image);
          }
        });
      } else if (local_1_1.answerPreviewAuthorName(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(1, function () {
          local_1_1.observeComponentCreation2(function (p0, p1) {
            Text.create(local_1_1.answerPreviewAuthorName(local_1_0).substring(0, 1));
            Text.fontSize({
              "id": 50331669,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            Text.fontColor({
              "id": 50331664,
              "type": 10001,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
          }, Text);
          Text.pop();
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(2, function () {});
      }
    }, If);
    If.pop();
    Stack.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": 2
      });
      Column.layoutWeight(1);
      Column.alignItems(HorizontalAlign.Start);
    }, Column);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_1.answerPreviewAuthorName(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake(local_1_0 ? "answer_prev_preview_author" : "answer_next_preview_author")) {
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create(local_1_1.answerPreviewAuthorName(local_1_0));
              Text.id(local_1_0 ? "answer_prev_preview_author" : "answer_next_preview_author");
              Text.fontSize({
                "id": 50331668,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontWeight(FontWeight.Medium);
              Text.fontColor({
                "id": 50331663,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.maxLines(1);
              Text.textOverflow({
                "overflow": TextOverflow.Ellipsis
              });
            }, Text);
            Text.pop();
          }
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_1.answerPreviewExcerpt(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake(local_1_0 ? "answer_prev_preview_excerpt" : "answer_next_preview_excerpt")) {
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create(local_1_1.answerPreviewExcerpt(local_1_0));
              Text.id(local_1_0 ? "answer_prev_preview_excerpt" : "answer_next_preview_excerpt");
              Text.fontSize({
                "id": 50331669,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontColor({
                "id": 50331664,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.maxLines(2);
              Text.textOverflow({
                "overflow": TextOverflow.Ellipsis
              });
            }, Text);
            Text.pop();
          }
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Column.pop();
    Row.pop();
  }
  answerNextFloatingButton(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Circle,
        "stateEffect": true
      });
      Button.id("answer_next_floating");
      Button.width(44);
      Button.height(44);
      Button.padding(0);
      Button.backgroundColor(local_1_0.resolvedThemeColor);
      Button.shadow({
        "radius": 12,
        "color": "#33000000",
        "offsetY": 4
      });
      Button.opacity(Math.min(100, Math.max(10, local_1_0.fabOpacity)) / 100);
      Button.margin({
        "right": 0,
        "bottom": 206
      });
      Button.offset({
        "x": local_1_0.answerFabOffsetX,
        "y": local_1_0.answerFabOffsetY
      });
      Button.onAreaChange(function (p0, p1) {
        let v0 = Number(p1.width);
        if (v0 > 0 && Math.abs(v0 - local_1_0.answerFabWidthVp) > 1) {
          local_1_0.answerFabWidthVp = v0;
        }
        local_1_0.applySavedAnswerFabPosition();
      });
      Button.enabled(!local_1_0.navigatorBusy);
      Button.accessibilityText("下一个回答");
      globalThis.Gesture.create(GesturePriority.Low);
      PanGesture.create({
        "fingers": 1
      });
      PanGesture.onActionStart(function (p0) {
        local_1_0.answerFabPanPrevX = p0.offsetX;
        local_1_0.answerFabPanPrevY = p0.offsetY;
        local_1_0.answerFabDragging = true;
      });
      PanGesture.onActionUpdate(function (p0) {
        local_1_0.onAnswerFabPanUpdate(p0);
      });
      PanGesture.onActionEnd(function () {
        local_1_0.answerFabPanPrevX = 0;
        local_1_0.answerFabPanPrevY = 0;
        local_1_0.answerFabDragging = false;
        local_1_0.snapAnswerFabToEdge();
      });
      PanGesture.onActionCancel(function () {
        local_1_0.answerFabPanPrevX = 0;
        local_1_0.answerFabPanPrevY = 0;
        local_1_0.answerFabDragging = false;
        local_1_0.snapAnswerFabToEdge();
      });
      PanGesture.pop();
      globalThis.Gesture.pop();
      Button.onClick(function () {
        local_1_0.moveAnswer(1);
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125831830,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(22);
      SymbolGlyph.fontColor([onThemeColor(local_1_0.resolvedThemeColor)]);
    }, SymbolGlyph);
    Button.pop();
  }
  onAnswerFabPanUpdate(p0) {
    let v3;
    let v1 = p0.offsetX - this.answerFabPanPrevX;
    let v2 = p0.offsetY - this.answerFabPanPrevY;
    this.answerFabPanPrevX = p0.offsetX;
    this.answerFabPanPrevY = p0.offsetY;
    if (v1 === 0 && v2 === 0) {
      return;
    }
    v1 = Math.max(this.answerFabMinX(), this.answerFabOffsetX + v1);
    this.answerFabOffsetX = Math.min(0, v1);
    v3 = this.answerFabMaxDownY();
    v2 = Math.max(this.answerFabMinY(), this.answerFabOffsetY + v2);
    this.answerFabOffsetY = Math.min(v3, v2);
    return;
  }
  answerFabMinX() {
    return this.answerFabWidthVp + 12 - this.answerFabOverlayWidthVp;
  }
  answerFabMinY() {
    return 94 + 12 + 44 + 206 - this.answerFabOverlayHeightVp;
  }
  answerFabMaxDownY() {
    return Math.max(0, 206 - (this.bottomActionBarHeightVp > 0 ? this.bottomActionBarHeightVp : 48) - 4);
  }
  snapAnswerFabToEdge() {}
  answerFabSnapTargetX() {
    return this.answerFabOverlayWidthVp - this.answerFabWidthVp + this.answerFabOffsetX + this.answerFabWidthVp / 2 < this.answerFabOverlayWidthVp / 2 ? this.answerFabWidthVp + 12 - this.answerFabOverlayWidthVp : 0;
  }
  gripIsLeftHand() {
    return this.gripMotionSupported && this.holdingHand === motion.HoldingHandStatus.LEFT_HAND_HELD;
  }
  gripSwapTransition(p0) {
    return TransitionEffect.OPACITY.combine(TransitionEffect.translate({
      "x": p0
    })).animation({
      "curve": curves.springMotion(0.5, 0.85)
    });
  }
  onGripFollowActionsChanged() {
    if (this.gripFollowActions) {
      this.snapAnswerFabToHand();
    }
  }
  snapAnswerFabToHand() {
    let v0, v1 /*ContentDetailKind*/;
    let local_1_0;
    let local_1_1 = this;
    v0 = !local_1_1.gripFollowActions || local_1_1.kind !== ContentDetailKind.ANSWER;
    v1 = 0;
    if (!v0) {
      v0 = local_1_1.answerFabOverlayWidthVp <= 0;
    }
    if (v0 || local_1_1.answerFabWidthVp <= 0) {
      return;
    }
    if (local_1_1.gripIsLeftHand()) {
      v1 = local_1_1.answerFabMinX();
    }
    local_1_0 = v1;
    if (Math.abs(local_1_0 - local_1_1.answerFabOffsetX) >= 1) {
      local_1_1.getUIContext().animateTo({
        "duration": 300,
        "curve": Curve.EaseOut
      }, function () {
        local_1_1.answerFabOffsetX = local_1_0;
      });
    }
    local_1_1.persistAnswerFabPosition(local_1_0);
    return;
  }
  subscribeHoldingHand() {
    if (!this.gripMotionSupported || this.gripMotionSubscribed) {
      return;
    }
    try {
      motion.on("holdingHandChanged", this.onHoldingHandChanged);
      this.gripMotionSubscribed = true;
    } catch (catchAcc) {
      console.error("subscribeHoldingHand failed, code=" + catchAcc.code + "");
      this.gripMotionSubscribed = false;
    }
    return;
  }
  unsubscribeHoldingHand() {
    if (!this.gripMotionSubscribed) {
      return;
    }
    try {
      motion.off("holdingHandChanged", this.onHoldingHandChanged);
    } catch (catchAcc) {
      console.error("unsubscribeHoldingHand failed, code=" + catchAcc.code + "");
    }
    this.gripMotionSubscribed = false;
    return;
  }
  loadAnswerFabPosition() {
    let v0 /*getAbilityContext*/, acc;
    let local_1_0 = this;
    local_1_0.answerFabPositionLoaded = true;
    v0 = getAbilityContext();
    if (v0 === undefined) {
      local_1_0.answerFabPositionReady = true;
      return;
    }
    local_1_0.answerFabPreferences = new AppPreferencesStore(v0);
    acc = local_1_0.answerFabPreferences.loadFabPosition("fabSkipAnswer").then(function (p0) {
      if (p0 !== undefined) {
        local_1_0.savedAnswerFabPosition = p0;
        local_1_0.answerFabOffsetX = p0.x;
        local_1_0.answerFabOffsetY = p0.y;
      }
      local_1_0.answerFabPositionReady = true;
      local_1_0.applySavedAnswerFabPosition();
    });
    acc.catch(function (p0) {
      local_1_0.answerFabPositionReady = true;
    });
    return;
  }
  applySavedAnswerFabPosition() {
    if (this.answerFabPositionApplied || !this.answerFabPositionLoaded || this.savedAnswerFabPosition === undefined) {
      return;
    }
    if (this.answerFabOverlayWidthVp <= 0 || this.answerFabOverlayHeightVp <= 0 || this.answerFabWidthVp <= 0) {
      return;
    }
    this.answerFabPositionApplied = true;
    this.answerFabOffsetX = Math.min(0, Math.max(this.answerFabMinX(), this.savedAnswerFabPosition.x));
    this.answerFabOffsetY = Math.min(this.answerFabMaxDownY(), Math.max(this.answerFabMinY(), this.savedAnswerFabPosition.y));
    return;
  }
  persistAnswerFabPosition(p0) {
    let v0 /*getAbilityContext*/;
    if (this.answerFabPreferences === undefined) {
      v0 = getAbilityContext();
      if (v0 === undefined) {
        return;
      }
      this.answerFabPreferences = new AppPreferencesStore(v0);
    }
    this.answerFabPreferences.saveFabPosition("fabSkipAnswer", {
      "x": p0,
      "y": this.answerFabOffsetY
    }).catch(function (p0) {});
  }
  contentHeader(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if ((local_1_0.kind === ContentDetailKind.ANSWER || local_1_0.kind === ContentDetailKind.ARTICLE) && local_1_1.immersiveReading) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          local_1_1.immersiveAuthorRow.bind(local_1_1)(local_1_0);
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {
          local_1_1.observeComponentCreation2(function (p0, p1) {
            let v3;
            let v0 = 0;
            Column.create({
              "space": {
                "id": 50331691,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              }
            });
            Column.alignItems(HorizontalAlign.Start);
            Column.width("100%");
            v3 = {
              "left": local_1_0.kind === ContentDetailKind.ANSWER ? 0 : local_1_0.kind === ContentDetailKind.ARTICLE ? 0 : {
                "id": 50331674,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              },
              "right": local_1_0.kind === ContentDetailKind.ANSWER ? 0 : local_1_0.kind === ContentDetailKind.ARTICLE ? 0 : {
                "id": 50331674,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              },
              "top": null,
              "bottom": null
            };
            if (local_1_0.kind !== ContentDetailKind.ANSWER && local_1_0.kind !== ContentDetailKind.ARTICLE) {
              v0 = {
                "id": 50331690,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              };
            }
            v3.top = v0;
            v3.bottom = {
              "id": 50331690,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            };
            Column.padding(v3);
            Column.backgroundColor({
              "id": 50331666,
              "type": 10001,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
          }, Column);
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (contentContextTitle(local_1_0).length > 0) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                if (!If.canRetake("" + local_1_0.kind + "_detail_context_title")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(contentContextTitle(local_1_0));
                    Text.id("" + local_1_0.kind + "_detail_context_title");
                    Text.fontSize({
                      "id": 50331673,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontWeight(FontWeight.Bold);
                    Text.fontColor({
                      "id": 50331663,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.copyOption(CopyOptions.LocalDevice);
                    Text.width("100%");
                    Text.onAreaChange(function (p0, p1) {
                      let v0 = Number(p1.height);
                      if (v0 > 0 && Math.abs(v0 - local_1_1.contentTitleHeightVp) > 1) {
                        local_1_1.contentTitleHeightVp = v0;
                      }
                    });
                    Text.accessibilityDescription(local_1_0.kind === ContentDetailKind.ANSWER ? "点击查看问题详情" : "");
                    Text.onClick(function () {
                      if (local_1_0.kind === ContentDetailKind.ANSWER) {
                        local_1_1.navigate({
                          "name": AppDestinationName.QUESTION,
                          "id": local_1_0.value.questionId
                        });
                      }
                    });
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.kind === ContentDetailKind.ANSWER || local_1_0.kind === ContentDetailKind.ARTICLE) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                local_1_1.contentHeaderAuthorRow.bind(local_1_1)(local_1_0);
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            let v0;
            If.create();
            if ((local_1_1.pinAnswerDate || local_1_0.kind === ContentDetailKind.QUESTION) && (v0 = 0, contentCreatedAtText(local_1_0).length > 0)) {
              local_1_1.ifElseBranchUpdateFunction(v0, function () {
                if (!If.canRetake("content_header_" + local_1_0.kind + "_created_at")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(contentCreatedAtText(local_1_0));
                    Text.id("content_header_" + local_1_0.kind + "_created_at");
                    Text.fontSize({
                      "id": 50331669,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.width("100%");
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            let v0;
            If.create();
            if ((local_1_1.pinAnswerDate || local_1_0.kind === ContentDetailKind.QUESTION) && (v0 = 0, contentUpdatedAtText(local_1_0).length > 0)) {
              local_1_1.ifElseBranchUpdateFunction(v0, function () {
                if (!If.canRetake("content_header_" + local_1_0.kind + "_updated_at")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(contentUpdatedAtText(local_1_0));
                    Text.id("content_header_" + local_1_0.kind + "_updated_at");
                    Text.fontSize({
                      "id": 50331669,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.width("100%");
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.kind === ContentDetailKind.QUESTION) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                let v0, v1;
                if (!If.canRetake("question_detail_statistics")) {
                  v0 = 0;
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Row.create({
                      "space": {
                        "id": 50331690,
                        "type": 10002,
                        "params": [],
                        "bundleName": "com.github.zhuoyi233.zhplus",
                        "moduleName": "entry"
                      }
                    });
                    Row.id("question_detail_statistics");
                    Row.width("100%");
                  }, Row);
                  v1 = local_1_1.questionStatItem.bind(local_1_1);
                  if (local_1_0.value.visitCount !== null && local_1_0.value.visitCount !== undefined) {
                    v0 = local_1_0.value.visitCount;
                  }
                  v0 = "" + v0 + " 浏览";
                  v1({
                    "id": 125832271,
                    "type": 40000,
                    "params": [],
                    "bundleName": "com.github.zhuoyi233.zhplus",
                    "moduleName": "entry"
                  }, v0);
                  v0 = local_1_1.questionStatItem.bind(local_1_1);
                  v0({
                    "id": 125831544,
                    "type": 40000,
                    "params": [],
                    "bundleName": "com.github.zhuoyi233.zhplus",
                    "moduleName": "entry"
                  }, "" + (local_1_1.followController === undefined ? local_1_0.value.followerCount : local_1_1.followerCount) + " 关注");
                  local_1_1.questionStatItem.bind(local_1_1)({
                    "id": 125831766,
                    "type": 40000,
                    "params": [],
                    "bundleName": "com.github.zhuoyi233.zhplus",
                    "moduleName": "entry"
                  }, "" + local_1_0.value.commentCount + " 评论");
                  Row.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {
                if (!If.canRetake("" + local_1_0.kind + "_detail_statistics")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(local_1_1.displayedContentStatistics(local_1_0));
                    Text.id("" + local_1_0.kind + "_detail_statistics");
                    Text.fontSize({
                      "id": 50331675,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.width("100%");
                  }, Text);
                  Text.pop();
                }
              });
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.kind !== ContentDetailKind.ARTICLE) {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            } else if (((local_1_0.value.topics === null || local_1_0.value.topics === undefined ? undefined : local_1_0.value.topics.length) ?? 0) > 0) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                let v0 = local_1_1.articleTopicsFlow.bind(local_1_1);
                v0(local_1_0.value.topics ?? []);
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (contentEndorsements(local_1_0).length > 0) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                local_1_1.endorsementFlow.bind(local_1_1)(contentEndorsements(local_1_0));
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_1.blockingMessage.length > 0) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                if (!If.canRetake("" + local_1_0.kind + "_blocking_status")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(local_1_1.blockingMessage);
                    Text.id("" + local_1_0.kind + "_blocking_status");
                    Text.fontSize({
                      "id": 50331675,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.width("100%");
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_1.openedRecordPhase === OpenedRecordPhase.FAILED) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                if (!If.canRetake("" + local_1_0.kind + "_opened_record_failed")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create("本次打开记录未能保存，阅读不受影响");
                    Text.id("" + local_1_0.kind + "_opened_record_failed");
                    Text.fontSize({
                      "id": 50331675,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.width("100%");
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          Column.pop();
        });
      }
    }, If);
    If.pop();
  }
  contentDateFooter(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.kind === ContentDetailKind.ANSWER || local_1_0.kind === ContentDetailKind.ARTICLE) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          local_1_1.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": {
                "id": 50331692,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              }
            });
            Column.width("100%");
            Column.alignItems(HorizontalAlign.End);
            Column.padding({
              "top": {
                "id": 50331690,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              }
            });
          }, Column);
          local_1_1.observeComponentCreation2(function (p0, p1) {
            let v0;
            If.create();
            if (!local_1_1.pinAnswerDate && (v0 = 0, contentCreatedAtText(local_1_0).length > 0)) {
              local_1_1.ifElseBranchUpdateFunction(v0, function () {
                if (!If.canRetake("content_footer_" + local_1_0.kind + "_created_at")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(contentCreatedAtText(local_1_0));
                    Text.id("content_footer_" + local_1_0.kind + "_created_at");
                    Text.fontSize({
                      "id": 50331669,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            let v0;
            If.create();
            if (!local_1_1.pinAnswerDate && (v0 = 0, contentUpdatedAtText(local_1_0).length > 0)) {
              local_1_1.ifElseBranchUpdateFunction(v0, function () {
                if (!If.canRetake("content_footer_" + local_1_0.kind + "_updated_at")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(contentUpdatedAtText(local_1_0));
                    Text.id("content_footer_" + local_1_0.kind + "_updated_at");
                    Text.fontSize({
                      "id": 50331669,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          local_1_1.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (contentIpInfo(local_1_0).length > 0) {
              local_1_1.ifElseBranchUpdateFunction(0, function () {
                if (!If.canRetake("" + local_1_0.kind + "_detail_ip")) {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create("IP属地：" + contentIpInfo(local_1_0) + "");
                    Text.id("" + local_1_0.kind + "_detail_ip");
                    Text.fontSize({
                      "id": 50331669,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                  }, Text);
                  Text.pop();
                }
              });
            } else {
              local_1_1.ifElseBranchUpdateFunction(1, function () {});
            }
          }, If);
          If.pop();
          Column.pop();
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
  }
  immersiveAuthorRow(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (contentAuthorName(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake("" + local_1_0.kind + "_immersive_author_row")) {
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Row.create({
                "space": 6
              });
              Row.id("" + local_1_0.kind + "_immersive_author_row");
              Row.width("100%");
              Row.padding({
                "top": 8,
                "bottom": 8
              });
              Row.onClick(function () {
                if (local_1_0.value.author !== undefined && local_1_0.value.author.id.trim().length > 0) {
                  local_1_1.navigate({
                    "name": AppDestinationName.PEOPLE,
                    "id": local_1_0.value.author.urlToken ?? local_1_0.value.author.id
                  });
                }
              });
            }, Row);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Stack.create({
                "alignContent": Alignment.Center
              });
              Stack.width(24);
              Stack.height(24);
              Stack.clip(true);
            }, Stack);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Circle.create();
              Circle.width(24);
              Circle.height(24);
              Circle.fill({
                "id": 50331657,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
            }, Circle);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create(contentAuthorName(local_1_0).substring(0, 1));
              Text.fontSize({
                "id": 50331669,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontColor({
                "id": 50331664,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
            }, Text);
            Text.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              If.create();
              if (contentAuthorAvatarUrl(local_1_0).length > 0) {
                local_1_1.ifElseBranchUpdateFunction(0, function () {
                  if (!If.canRetake("" + local_1_0.kind + "_immersive_author_avatar")) {
                    local_1_1.observeComponentCreation2(function (p0, p1) {
                      Image.create(contentAuthorAvatarUrl(local_1_0));
                      Image.id("" + local_1_0.kind + "_immersive_author_avatar");
                      Image.width(24);
                      Image.height(24);
                      Image.borderRadius(12);
                      Image.objectFit(ImageFit.Cover);
                    }, Image);
                  }
                });
              } else {
                local_1_1.ifElseBranchUpdateFunction(1, function () {});
              }
            }, If);
            If.pop();
            Stack.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create(contentAuthorName(local_1_0));
              Text.id("" + local_1_0.kind + "_immersive_author_name");
              Text.fontSize({
                "id": 50331668,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontColor({
                "id": 50331663,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.maxLines(1);
              Text.textOverflow({
                "overflow": TextOverflow.Ellipsis
              });
              Text.layoutWeight(1);
            }, Text);
            Text.pop();
            Row.pop();
          }
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
  }
  contentHeaderAuthorRow(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (contentAuthorName(local_1_0).length > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake("" + local_1_0.kind + "_detail_header_author_row")) {
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Row.create({
                "space": {
                  "id": 50331691,
                  "type": 10002,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                }
              });
              Row.id("" + local_1_0.kind + "_detail_header_author_row");
              Row.width("100%");
              Row.onClick(function () {
                if (local_1_0.value.author !== undefined && local_1_0.value.author.id.trim().length > 0) {
                  local_1_1.navigate({
                    "name": AppDestinationName.PEOPLE,
                    "id": local_1_0.value.author.urlToken ?? local_1_0.value.author.id
                  });
                }
              });
            }, Row);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Stack.create({
                "alignContent": Alignment.Center
              });
              Stack.width(40);
              Stack.height(40);
              Stack.clip(true);
            }, Stack);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Circle.create();
              Circle.width(40);
              Circle.height(40);
              Circle.fill({
                "id": 50331657,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
            }, Circle);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create(contentAuthorName(local_1_0).substring(0, 1));
              Text.fontSize({
                "id": 50331668,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontColor({
                "id": 50331664,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
            }, Text);
            Text.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              If.create();
              if (contentAuthorAvatarUrl(local_1_0).length > 0) {
                local_1_1.ifElseBranchUpdateFunction(0, function () {
                  if (!If.canRetake("" + local_1_0.kind + "_detail_header_avatar")) {
                    local_1_1.observeComponentCreation2(function (p0, p1) {
                      Image.create(contentAuthorAvatarUrl(local_1_0));
                      Image.id("" + local_1_0.kind + "_detail_header_avatar");
                      Image.width(40);
                      Image.height(40);
                      Image.borderRadius(20);
                      Image.objectFit(ImageFit.Cover);
                    }, Image);
                  }
                });
              } else {
                local_1_1.ifElseBranchUpdateFunction(1, function () {});
              }
            }, If);
            If.pop();
            Stack.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Column.create({
                "space": 2
              });
              Column.layoutWeight(1);
              Column.alignItems(HorizontalAlign.Start);
            }, Column);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Row.create({
                "space": 4
              });
              Row.alignItems(VerticalAlign.Center);
            }, Row);
            local_1_1.observeComponentCreation2(function (p0, p1) {
              Text.create(contentAuthorName(local_1_0));
              Text.id("" + local_1_0.kind + "_detail_header_author");
              Text.fontSize({
                "id": 50331668,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.fontWeight(FontWeight.Medium);
              Text.fontColor({
                "id": 50331663,
                "type": 10001,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Text.maxLines(1);
              Text.textOverflow({
                "overflow": TextOverflow.Ellipsis
              });
            }, Text);
            Text.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              If.create();
              if (contentAuthorBadge(local_1_0) === undefined) {
                local_1_1.ifElseBranchUpdateFunction(1, function () {});
              } else {
                local_1_1.ifElseBranchUpdateFunction(0, function () {
                  if (!If.canRetake("" + local_1_0.kind + "_detail_header_author_badge")) {
                    local_1_1.observeComponentCreation2(function (p0, p1) {
                      let v2 = contentAuthorBadge(local_1_0)?.iconUrl ?? "";
                      Image.create(v2);
                      Image.id("" + local_1_0.kind + "_detail_header_author_badge");
                      Image.width(18);
                      Image.height(18);
                      Image.objectFit(ImageFit.Contain);
                      Image.draggable(false);
                    }, Image);
                  }
                });
              }
            }, If);
            If.pop();
            Row.pop();
            local_1_1.observeComponentCreation2(function (p0, p1) {
              If.create();
              if (contentAuthorHeadline(local_1_0).length > 0) {
                local_1_1.ifElseBranchUpdateFunction(0, function () {
                  local_1_1.observeComponentCreation2(function (p0, p1) {
                    Text.create(contentAuthorHeadline(local_1_0));
                    Text.fontSize({
                      "id": 50331669,
                      "type": 10002,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.fontColor({
                      "id": 50331664,
                      "type": 10001,
                      "params": [],
                      "bundleName": "com.github.zhuoyi233.zhplus",
                      "moduleName": "entry"
                    });
                    Text.maxLines(1);
                    Text.textOverflow({
                      "overflow": TextOverflow.Ellipsis
                    });
                  }, Text);
                  Text.pop();
                });
              } else {
                local_1_1.ifElseBranchUpdateFunction(1, function () {});
              }
            }, If);
            If.pop();
            Column.pop();
            Row.pop();
          }
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
  }
  updateAnswerTitleScrolled(p0, p1) {
    let local_1_1;
    let local_1_2 = this;
    let local_1_0 = p0;
    if (local_1_0.kind === ContentDetailKind.ANSWER) {
      if (local_1_0.value.id === (local_1_2.content === null || local_1_2.content === undefined ? undefined : local_1_2.content.value.id)) {
        local_1_1 = p1 > (local_1_2.contentTitleHeightVp > 0 ? local_1_2.contentTitleHeightVp + 8 : 64);
        if (local_1_1 !== local_1_2.answerQuestionScrolled) {
          local_1_2.answerQuestionScrolled = local_1_1;
          local_1_2.getUIContext().animateTo({
            "duration": 220,
            "curve": Curve.EaseInOut
          }, function () {
            publishAnswerTitle({
              "id": local_1_2.contentId,
              "questionTitle": contentContextTitle(local_1_0),
              "authorName": contentAuthorName(local_1_0),
              "authorAvatarUrl": contentAuthorAvatarUrl(local_1_0),
              "authorBadgeIconUrl": contentAuthorBadge(local_1_0)?.iconUrl ?? "",
              "scrolled": local_1_1
            });
          });
        }
      }
    }
    return;
  }
  updateChromeHiddenByScroll(p0) {
    let v0 = p0 - this.lastContentScrollOffset;
    this.lastContentScrollOffset = p0;
    if (p0 <= 2) {
      this.chromeHiddenByScroll = false;
    } else if (v0 > 4) {
      this.chromeHiddenByScroll = true;
    } else if (v0 < -4) {
      this.chromeHiddenByScroll = false;
    }
    AppStorage.setOrCreate("detailTitleHiddenByScroll", this.titleAutoHide && this.chromeHiddenByScroll);
  }
  revealChromeAtBottom(p0) {
    if (p0 && this.chromeHiddenByScroll) {
      this.chromeHiddenByScroll = false;
      AppStorage.setOrCreate("detailTitleHiddenByScroll", this.titleAutoHide && this.chromeHiddenByScroll);
    }
  }
  updateArticleTitleScrolled(p0, p1) {
    let local_1_1;
    let local_1_2 = this;
    let local_1_0 = p0;
    if (local_1_0.kind === ContentDetailKind.ARTICLE) {
      if (local_1_0.value.id === (local_1_2.content === null || local_1_2.content === undefined ? undefined : local_1_2.content.value.id)) {
        local_1_1 = p1 > (local_1_2.contentTitleHeightVp > 0 ? local_1_2.contentTitleHeightVp + 8 : 64);
        if (local_1_1 !== local_1_2.articleTitleScrolled) {
          local_1_2.articleTitleScrolled = local_1_1;
          local_1_2.getUIContext().animateTo({
            "duration": 220,
            "curve": Curve.EaseInOut
          }, function () {
            publishArticleTitle({
              "id": local_1_2.contentId,
              "title": contentContextTitle(local_1_0),
              "authorName": contentAuthorName(local_1_0),
              "authorAvatarUrl": contentAuthorAvatarUrl(local_1_0),
              "authorBadgeIconUrl": contentAuthorBadge(local_1_0)?.iconUrl ?? "",
              "scrolled": local_1_1
            });
          });
        }
      }
    }
    return;
  }
  questionDocument(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Refresh.create({
        "refreshing": {
          "value": local_1_1.refreshingAnswers,
          "changeEvent": function (p0) {
            local_1_1.refreshingAnswers = p0;
          }
        },
        "refreshingContent": local_1_1.indicator === null || local_1_1.indicator === undefined ? undefined : local_1_1.indicator.view()
      });
      Refresh.height("100%");
      Refresh.width("100%");
      Refresh.onRefreshing(function () {
        local_1_1.refreshQuestion();
      });
      Refresh.onStateChange(function (p0) {
        return local_1_1.indicator === null || local_1_1.indicator === undefined ? undefined : local_1_1.indicator.onStateChange(p0);
      });
    }, Refresh);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = {
          "html": contentHtml(local_1_0),
          "emptyMessage": contentEmptyMessage(local_1_0),
          "collapsible": true,
          "linkCardMetaRepository": local_1_1.linkCardMetaRepository,
          "topInsetVp": local_1_1.immersiveReading ? 0 : FLOATING_TITLE_BAR_OFFSET,
          "onVideoOpen": function (p0) {
            return local_1_1.openVideo(p0);
          },
          "onLinkClick": function (p0) {
            return local_1_1.openContentLink(p0);
          },
          "documentHeader": function () {
            local_1_1.contentHeader(local_1_0);
          },
          "onBodyDoubleTap": function () {
            return local_1_1.onContentDoubleTap();
          },
          "documentBodyFooter": function () {
            local_1_1.questionBodyFooter(local_1_0);
          },
          "documentItems": function () {
            local_1_1.questionAnswerItems();
          },
          "documentFooter": function () {
            local_1_1.questionAnswersFooter();
          },
          "onListReachEnd": function () {
            if (local_1_1.answersController !== null && local_1_1.answersController !== undefined) {
              local_1_1.answersController.loadMore();
            }
          },
          "onScrollOffset": function (p0) {
            let local_2_0 = p0 > 160;
            if (local_2_0 !== local_1_1.questionScrolled) {
              local_1_1.questionScrolled = local_2_0;
              local_1_1.getUIContext().animateTo({
                "duration": 220,
                "curve": Curve.EaseInOut
              }, function () {
                publishQuestionTitle({
                  "id": local_1_1.activeContentId,
                  "title": contentTitle(local_1_0),
                  "scrolled": local_2_0
                });
              });
            }
          }
        };
        acc = new NativeContentDocument(local_1_1, acc, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 1941,
          "col": 7
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "html": contentHtml(local_1_0),
            "emptyMessage": contentEmptyMessage(local_1_0),
            "collapsible": true,
            "linkCardMetaRepository": local_1_1.linkCardMetaRepository,
            "topInsetVp": local_1_1.immersiveReading ? 0 : FLOATING_TITLE_BAR_OFFSET,
            "onVideoOpen": function (p0) {
              return local_1_1.openVideo(p0);
            },
            "onLinkClick": function (p0) {
              return local_1_1.openContentLink(p0);
            },
            "documentHeader": function () {
              local_1_1.contentHeader(local_1_0);
            },
            "onBodyDoubleTap": function () {
              return local_1_1.onContentDoubleTap();
            },
            "documentBodyFooter": function () {
              local_1_1.questionBodyFooter(local_1_0);
            },
            "documentItems": function () {
              local_1_1.questionAnswerItems();
            },
            "documentFooter": function () {
              local_1_1.questionAnswersFooter();
            },
            "onListReachEnd": function () {
              if (local_1_1.answersController !== null && local_1_1.answersController !== undefined) {
                local_1_1.answersController.loadMore();
              }
            },
            "onScrollOffset": function (p0) {
              let local_2_0 = p0 > 160;
              if (local_2_0 !== local_1_1.questionScrolled) {
                local_1_1.questionScrolled = local_2_0;
                local_1_1.getUIContext().animateTo({
                  "duration": 220,
                  "curve": Curve.EaseInOut
                }, function () {
                  publishQuestionTitle({
                    "id": local_1_1.activeContentId,
                    "title": contentTitle(local_1_0),
                    "scrolled": local_2_0
                  });
                });
              }
            }
          };
        };
      } else {
        local_1_1.updateStateVarsOfChildByElmtId(p0, {});
      }
    }, {
      "name": "NativeContentDocument"
    });
    Refresh.pop();
  }
  openVideo(p0) {
    stageVideoPlaybackContext({
      "videoId": p0,
      "contentId": this.activeContentId,
      "contentType": this.kind === ContentDetailKind.ANSWER ? "answer" : this.kind === ContentDetailKind.ARTICLE ? "article" : "question"
    });
    this.navigate({
      "name": AppDestinationName.VIDEO,
      "id": p0
    });
  }
  openContentLink(p0) {
    let v0 /*getAbilityContext*/;
    let local_1_0 = this;
    v0 = contentLinkDestination(p0);
    if (v0 === undefined) {
      if (!new RegExp("^https?:\\/\\/", "i").test(p0)) {
        return;
      }
      v0 = getAbilityContext();
      if (v0 === undefined) {
        return;
      }
      v0 = v0.startAbility({
        "action": "ohos.want.action.viewData",
        "uri": p0
      });
      v0.catch(function (p0) {
        local_1_0.getUIContext().getPromptAction().showToast({
          "message": "暂时无法打开链接"
        });
      });
      return;
    }
    local_1_0.navigate(v0);
    return;
  }
  questionBodyFooter(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": 12
      });
      Column.width("100%");
    }, Column);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.kind !== ContentDetailKind.QUESTION) {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      } else if (((local_1_0.value.topics === null || local_1_0.value.topics === undefined ? undefined : local_1_0.value.topics.length) ?? 0) > 0) {
        local_1_1.ifElseBranchUpdateFunction(0, function () {
          local_1_1.observeComponentCreation2(function (p0, p1) {
            Flex.create({
              "wrap": FlexWrap.Wrap
            });
            Flex.width("100%");
          }, Flex);
          local_1_1.observeComponentCreation2(function (p0, p1) {
            ForEach.create();
            local_1_1.forEachUpdateFunction(p0, local_1_0.value.topics, function (p0) {
              let local_2_0 = p0;
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Button.createWithLabel("# " + local_2_0.name + "", {
                  "type": ButtonType.Normal,
                  "stateEffect": true
                });
                Button.id("question_topic_" + local_2_0.id + "");
                Button.height(30);
                Button.fontSize({
                  "id": 50331669,
                  "type": 10002,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                Button.fontColor({
                  "id": 50331664,
                  "type": 10001,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                Button.backgroundColor({
                  "id": 50331666,
                  "type": 10001,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                Button.borderRadius(15);
                Button.margin({
                  "right": 8,
                  "bottom": 8
                });
                Button.onClick(function () {
                  return local_1_1.navigate({
                    "name": AppDestinationName.SEARCH,
                    "query": local_2_0.name
                  });
                });
              }, Button);
              Button.pop();
            }, function (p0) {
              return p0.id;
            }, false, false);
          }, ForEach);
          ForEach.pop();
          Flex.pop();
        });
      } else {
        local_1_1.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("写回答");
      Button.id("question_write_answer");
      Button.width("100%");
      Button.fontColor(onThemeColor(local_1_1.resolvedThemeColor));
      Button.backgroundColor(local_1_1.resolvedThemeColor);
      Button.onClick(function () {
        return local_1_1.navigate(local_1_1.authenticated ? {
          "name": AppDestinationName.WRITE_ANSWER,
          "questionId": local_1_1.activeContentId
        } : {
          "name": AppDestinationName.LOGIN
        });
      });
    }, Button);
    Button.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Row.create();
      Row.width("100%");
    }, Row);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_1.questionAnswerCount().toString() + " 回答");
      Text.fontWeight(FontWeight.Medium);
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.layoutWeight(1);
    }, Text);
    Text.pop();
    local_1_1.observeComponentCreation2(function (p0, p1) {
      __Common__.create();
      __Common__.id("question_sort");
      __Common__.width(168);
      __Common__.height(36);
    }, __Common__);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new SegmentButton(local_1_1, {
          "options": local_1_1.answersSortOptions,
          "selectedIndexes": local_1_1.__answersSortIndexes,
          "onItemClicked": function (p0) {
            return local_1_1.selectAnswerSort(p0);
          }
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 2030,
          "col": 9
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "options": local_1_1.answersSortOptions,
            "selectedIndexes": local_1_1.answersSortIndexes,
            "onItemClicked": function (p0) {
              return local_1_1.selectAnswerSort(p0);
            }
          };
        };
      } else {
        local_1_1.updateStateVarsOfChildByElmtId(p0, {
          "options": local_1_1.answersSortOptions
        });
      }
    }, {
      "name": "SegmentButton"
    });
    __Common__.pop();
    Row.pop();
    Column.pop();
  }
  questionAnswerItems(p0) {
    let local_1_0 = this;
    LazyForEach.create("1", local_1_0, local_1_0.answerDataSource, function (p0) {
      let local_2_1 = p0;
      let local_2_0 = function (p0, p1) {
        ListItem.create(function () {}, false);
      };
      (function () {
        local_1_0.observeComponentCreation2(local_2_0, ListItem);
        local_1_0.answerFeedCard.bind(local_1_0)(local_2_1);
        ListItem.pop();
      })();
    }, function (p0) {
      return feedItemIdentity(p0.feedItem);
    });
    LazyForEach.pop();
  }
  userBlockDialog(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.width("100%");
      Column.padding({
        "id": 50331690,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Column.backgroundColor({
        "id": 50331656,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Column.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("确定要屏蔽用户「" + ((local_1_0.pendingUserBlock === null || local_1_0.pendingUserBlock === undefined ? undefined : local_1_0.pendingUserBlock.userName) ?? "") + "」吗？");
      Text.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("屏蔽后，该作者的内容将不再显示。");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Row.width("100%");
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("取消");
      Button.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.layoutWeight(1);
      Button.enabled(!local_1_0.blockingBusy);
      Button.onClick(function () {
        local_1_0.pendingUserBlock = undefined;
      });
    }, Button);
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("确定屏蔽");
      Button.backgroundColor(local_1_0.resolvedThemeColor);
      Button.fontColor(onThemeColor(local_1_0.resolvedThemeColor));
      Button.id("" + local_1_0.kind + "_confirm_block_user");
      Button.layoutWeight(1);
      Button.enabled(!local_1_0.blockingBusy);
      Button.onClick(function () {
        return local_1_0.confirmUserBlock();
      });
    }, Button);
    Button.pop();
    Row.pop();
    Column.pop();
  }
  keywordBlockDialog(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.width("100%");
      Column.padding({
        "id": 50331690,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Column.backgroundColor({
        "id": 50331656,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Column.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("输入要屏蔽的关键词（普通文本，不区分大小写）");
      Text.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      TextInput.create({
        "text": local_1_0.keywordBlockInput,
        "placeholder": "输入关键词"
      });
      TextInput.id("" + local_1_0.kind + "_keyword_block_input");
      TextInput.maxLength(200);
      TextInput.onChange(function (p0) {
        local_1_0.keywordBlockInput = p0;
      });
    }, TextInput);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Row.width("100%");
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("取消");
      Button.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.layoutWeight(1);
      Button.enabled(!local_1_0.blockingBusy);
      Button.onClick(function () {
        local_1_0.keywordBlockVisible = false;
        local_1_0.keywordBlockInput = "";
      });
    }, Button);
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("确认屏蔽");
      Button.backgroundColor(local_1_0.resolvedThemeColor);
      Button.fontColor(onThemeColor(local_1_0.resolvedThemeColor));
      Button.id("" + local_1_0.kind + "_confirm_block_keyword");
      Button.layoutWeight(1);
      Button.enabled(!local_1_0.blockingBusy && local_1_0.keywordBlockInput.trim().length > 0);
      Button.onClick(function () {
        return local_1_0.confirmKeywordBlock();
      });
    }, Button);
    Button.pop();
    Row.pop();
    Column.pop();
  }
  confirmUserBlock() {
    let v0 = this.pendingUserBlock;
    if (this.pendingUserBlock === undefined || this.blockingAction === undefined || this.content === undefined) {
      return;
    }
    this.pendingUserBlock = undefined;
    this.blockingAction.blockUser(v0.userId, v0.userName, this.blockContext(this.content));
    return;
  }
  confirmKeywordBlock() {
    let v3;
    let v1 = this.keywordBlockInput;
    this.keywordBlockVisible = false;
    this.keywordBlockInput = "";
    v3 = this.blockingAction === undefined;
    if (this.blockingAction !== undefined) {
      v3 = v1.trim().length === 0;
    }
    if (v3 || this.content === undefined) {
      return;
    }
    this.blockingAction.blockKeyword(v1, this.blockContext(this.content));
    return;
  }
  blockContext(p0) {
    return {
      "contentTitle": contentBlockingTitle(p0),
      "contentKind": p0.kind,
      "contentId": p0.value.id
    };
  }
  bottomActionBar(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331692,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.width("100%");
      Column.zIndex(2);
      Column.hitTestBehavior(HitTestMode.Default);
      Column.onAreaChange(function (p0, p1) {
        let v0 = Number(p1.height);
        if (v0 > 0 && Math.abs(v0 - local_1_0.bottomActionBarHeightVp) > 1) {
          local_1_0.bottomActionBarHeightVp = v0;
        }
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.interactionErrorMessage.length > 0) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.interactionStatusRow.bind(local_1_0)();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Row.width("100%");
      Row.padding({
        "left": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "right": {
          "id": 50331674,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        },
        "bottom": Math.max(local_1_0.bottomRectHeightVp, 0)
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.kind === ContentDetailKind.QUESTION) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.gripFollowActions && local_1_0.gripIsLeftHand()) {
              local_1_0.ifElseBranchUpdateFunction(0, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Row.create();
                  Row.transition(local_1_0.gripSwapTransition(240));
                }, Row);
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.questionRightActions.bind(local_1_0)();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2162,
                      "col": 15
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.questionRightActions.bind(local_1_0)();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
                Row.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Blank.create();
                  Blank.layoutWeight(1);
                }, Blank);
                Blank.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Row.create();
                  Row.transition(local_1_0.gripSwapTransition(-240));
                }, Row);
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let v0 /*GlassCapsule*/;
                  if (p1) {
                    v0 = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.observeComponentCreation2(function (p0, p1) {
                          If.create();
                          if (local_1_0.followController === undefined) {
                            local_1_0.ifElseBranchUpdateFunction(1, function () {});
                          } else {
                            local_1_0.ifElseBranchUpdateFunction(0, function () {
                              local_1_0.followQuestionAction.bind(local_1_0)();
                            });
                          }
                        }, If);
                        If.pop();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2172,
                      "col": 15
                    });
                    ViewPU.create(v0);
                    v0.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.observeComponentCreation2(function (p0, p1) {
                            If.create();
                            if (local_1_0.followController === undefined) {
                              local_1_0.ifElseBranchUpdateFunction(1, function () {});
                            } else {
                              local_1_0.ifElseBranchUpdateFunction(0, function () {
                                local_1_0.followQuestionAction.bind(local_1_0)();
                              });
                            }
                          }, If);
                          If.pop();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
                Row.pop();
              });
            } else {
              local_1_0.ifElseBranchUpdateFunction(1, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let v0 /*GlassCapsule*/;
                  if (p1) {
                    v0 = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.observeComponentCreation2(function (p0, p1) {
                          If.create();
                          if (local_1_0.followController === undefined) {
                            local_1_0.ifElseBranchUpdateFunction(1, function () {});
                          } else {
                            local_1_0.ifElseBranchUpdateFunction(0, function () {
                              local_1_0.followQuestionAction.bind(local_1_0)();
                            });
                          }
                        }, If);
                        If.pop();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2180,
                      "col": 13
                    });
                    ViewPU.create(v0);
                    v0.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.observeComponentCreation2(function (p0, p1) {
                            If.create();
                            if (local_1_0.followController === undefined) {
                              local_1_0.ifElseBranchUpdateFunction(1, function () {});
                            } else {
                              local_1_0.ifElseBranchUpdateFunction(0, function () {
                                local_1_0.followQuestionAction.bind(local_1_0)();
                              });
                            }
                          }, If);
                          If.pop();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Blank.create();
                  Blank.layoutWeight(1);
                }, Blank);
                Blank.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.questionRightActions.bind(local_1_0)();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2189,
                      "col": 13
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.questionRightActions.bind(local_1_0)();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
              });
            }
          }, If);
          If.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (local_1_0.gripFollowActions && local_1_0.gripIsLeftHand()) {
              local_1_0.ifElseBranchUpdateFunction(0, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Row.create();
                  Row.transition(local_1_0.gripSwapTransition(240));
                }, Row);
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.answerRightActions.bind(local_1_0)();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2199,
                      "col": 15
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.answerRightActions.bind(local_1_0)();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
                Row.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Blank.create();
                  Blank.layoutWeight(1);
                }, Blank);
                Blank.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Row.create();
                  Row.transition(local_1_0.gripSwapTransition(-240));
                }, Row);
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.answerVoteCapsule.bind(local_1_0)();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2209,
                      "col": 15
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.answerVoteCapsule.bind(local_1_0)();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
                Row.pop();
              });
            } else {
              local_1_0.ifElseBranchUpdateFunction(1, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Row.create();
                  Row.transition(local_1_0.gripSwapTransition(240));
                }, Row);
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.answerVoteCapsule.bind(local_1_0)();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2216,
                      "col": 15
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.answerVoteCapsule.bind(local_1_0)();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
                Row.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Blank.create();
                  Blank.layoutWeight(1);
                }, Blank);
                Blank.pop();
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Row.create();
                  Row.transition(local_1_0.gripSwapTransition(-240));
                }, Row);
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new GlassCapsule(local_1_0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported,
                      "content": function () {
                        local_1_0.answerRightActions.bind(local_1_0)();
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2226,
                      "col": 15
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "useMaterial": local_1_0.immersiveMaterialSupported,
                        "content": function () {
                          local_1_0.answerRightActions.bind(local_1_0)();
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {
                      "useMaterial": local_1_0.immersiveMaterialSupported
                    });
                  }
                }, {
                  "name": "GlassCapsule"
                });
                Row.pop();
              });
            }
          }, If);
          If.pop();
        });
      }
    }, If);
    If.pop();
    Row.pop();
    Column.pop();
  }
  answerVoteCapsule(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 0
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.voteState === ContentVoteState.DOWN) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.voteUpAction.bind(local_1_0)();
        });
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.voteState === ContentVoteState.UP) {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      } else {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.voteDownAction.bind(local_1_0)();
        });
      }
    }, If);
    If.pop();
    Row.pop();
  }
  answerRightActions(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.canEditExistingAnswer()) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake("answer_edit_existing")) {
            local_1_0.observeComponentCreation2(function (p0, p1) {
              Button.createWithLabel("编辑");
              Button.backgroundColor(local_1_0.resolvedThemeColor);
              Button.fontColor(onThemeColor(local_1_0.resolvedThemeColor));
              Button.id("answer_edit_existing");
              Button.height(36);
              Button.fontSize({
                "id": 50331675,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Button.onClick(function () {
                return local_1_0.openExistingAnswerEditor();
              });
            }, Button);
            Button.pop();
          }
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("content_" + local_1_0.kind + "_detail_favorite_bar");
      Button.width(36);
      Button.height(36);
      Button.backgroundColor(Color.Transparent);
      Button.accessibilityText(local_1_0.contentFavorited ? "已收藏" : "未收藏");
      Button.onClick(function () {
        if (local_1_0.collectionRepository !== undefined && local_1_0.session !== undefined) {
          local_1_0.favoriteDialogShown = true;
        } else {
          local_1_0.navigate({
            "name": AppDestinationName.LOGIN
          });
        }
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v2;
      SymbolGlyph.create(local_1_0.contentFavorited ? {
        "id": 125831606,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      } : {
        "id": 125831605,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      v2 = [];
      v2[0] = local_1_0.contentFavorited ? local_1_0.resolvedThemeColor : {
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      };
      SymbolGlyph.fontColor(v2);
    }, SymbolGlyph);
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("content_" + local_1_0.kind + "_detail_comment_bar");
      Button.height(36);
      Button.backgroundColor(Color.Transparent);
      Button.onClick(function () {
        if (local_1_0.commentRepository !== undefined && local_1_0.session !== undefined) {
          local_1_0.openComments();
        } else {
          local_1_0.navigate({
            "name": AppDestinationName.LOGIN
          });
        }
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 4
      });
      Row.padding({
        "left": 6,
        "right": 6,
        "top": 8,
        "bottom": 8
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125831766,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      SymbolGlyph.fontColor([{
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      }]);
    }, SymbolGlyph);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("" + ((local_1_0.content === null || local_1_0.content === undefined ? undefined : local_1_0.content.value.commentCount) ?? 0) + "");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(FontWeight.Medium);
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Text);
    Text.pop();
    Row.pop();
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("content_" + local_1_0.kind + "_detail_more");
      Button.width(36);
      Button.height(36);
      Button.backgroundColor(Color.Transparent);
      Button.onClick(function () {
        local_1_0.actionMenuShown = true;
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125833751,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      SymbolGlyph.fontColor([{
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      }]);
    }, SymbolGlyph);
    Button.pop();
  }
  questionRightActions(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("question_detail_comment_bar");
      Button.height(36);
      Button.backgroundColor(Color.Transparent);
      Button.accessibilityText("问题评论");
      Button.onClick(function () {
        if (local_1_0.commentRepository !== undefined && local_1_0.session !== undefined) {
          local_1_0.openComments();
        } else {
          local_1_0.navigate({
            "name": AppDestinationName.LOGIN
          });
        }
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 4
      });
      Row.padding({
        "left": 6,
        "right": 6,
        "top": 8,
        "bottom": 8
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125831766,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      SymbolGlyph.fontColor([{
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      }]);
    }, SymbolGlyph);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("" + ((local_1_0.content === null || local_1_0.content === undefined ? undefined : local_1_0.content.value.commentCount) ?? 0) + "");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(FontWeight.Medium);
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Text);
    Text.pop();
    Row.pop();
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("question_detail_more");
      Button.width(36);
      Button.height(36);
      Button.backgroundColor(Color.Transparent);
      Button.accessibilityText("更多问题操作");
      Button.onClick(function () {
        local_1_0.actionMenuShown = true;
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125833751,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      SymbolGlyph.fontColor([{
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      }]);
    }, SymbolGlyph);
    Button.pop();
  }
  questionStatItem(p0, p1, p2) {
    let local_1_0 = p0;
    let local_1_1 = p1;
    this.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 4
      });
      Row.alignItems(VerticalAlign.Center);
    }, Row);
    this.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create(local_1_0);
      SymbolGlyph.fontSize(14);
      SymbolGlyph.fontColor([{
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      }]);
    }, SymbolGlyph);
    this.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_1);
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Text);
    Text.pop();
    Row.pop();
  }
  questionAnswersFooter(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.kind === ContentDetailKind.QUESTION) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.observeComponentCreation2(function (p0, p1) {
            Column.create({
              "space": 12
            });
            Column.width("100%");
            Column.padding({
              "top": 12,
              "bottom": 12
            });
          }, Column);
          local_1_0.observeComponentCreation2(function (p0, p1) {
            If.create();
            if (!local_1_0.authenticated) {
              local_1_0.ifElseBranchUpdateFunction(0, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new AppPageStatusPanel(local_1_0, {
                      "kind": AppPageStatusKind.EMPTY,
                      "message": "登录后即可查看全部回答",
                      "testId": "question_answers_login",
                      "actionLabel": "去登录",
                      "actionId": "question_answers_login_button",
                      "onAction": function () {
                        return local_1_0.navigate({
                          "name": AppDestinationName.LOGIN
                        });
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2400,
                      "col": 11
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "kind": AppPageStatusKind.EMPTY,
                        "message": "登录后即可查看全部回答",
                        "testId": "question_answers_login",
                        "actionLabel": "去登录",
                        "actionId": "question_answers_login_button",
                        "onAction": function () {
                          return local_1_0.navigate({
                            "name": AppDestinationName.LOGIN
                          });
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {});
                  }
                }, {
                  "name": "AppPageStatusPanel"
                });
              });
            } else if (local_1_0.answersState.phase === QuestionAnswersPhase.INITIAL_LOADING) {
              local_1_0.ifElseBranchUpdateFunction(1, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let v0 /*AppPageStatusPanel*/;
                  if (p1) {
                    v0 = new AppPageStatusPanel(local_1_0, {
                      "message": "正在加载回答…",
                      "testId": "question_answers_loading"
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2404,
                      "col": 11
                    });
                    ViewPU.create(v0);
                    v0.paramsGenerator_ = function () {
                      return {
                        "message": "正在加载回答…",
                        "testId": "question_answers_loading"
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {});
                  }
                }, {
                  "name": "AppPageStatusPanel"
                });
              });
            } else if (local_1_0.answersState.errorMessage.length > 0) {
              local_1_0.ifElseBranchUpdateFunction(2, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let v0 /*AppPageStatusPanel*/;
                  if (p1) {
                    v0 = new AppPageStatusPanel(local_1_0, {
                      "kind": AppPageStatusKind.ERROR,
                      "message": local_1_0.answersState.errorMessage,
                      "testId": "question_answers_error",
                      "actionLabel": local_1_0.answersState.requiresLogin ? "去登录" : "重试",
                      "actionId": "question_answers_retry",
                      "onAction": function () {
                        if (local_1_0.answersState.requiresLogin) {
                          local_1_0.navigate({
                            "name": AppDestinationName.LOGIN
                          });
                        } else if (local_1_0.answersState.phase !== QuestionAnswersPhase.ERROR) {
                          if (local_1_0.answersController !== null && local_1_0.answersController !== undefined) {
                            local_1_0.answersController.loadMore();
                          }
                        } else if (local_1_0.answersController !== null && local_1_0.answersController !== undefined) {
                          local_1_0.answersController.refresh();
                        }
                      }
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2406,
                      "col": 11
                    });
                    ViewPU.create(v0);
                    v0.paramsGenerator_ = function () {
                      return {
                        "kind": AppPageStatusKind.ERROR,
                        "message": local_1_0.answersState.errorMessage,
                        "testId": "question_answers_error",
                        "actionLabel": local_1_0.answersState.requiresLogin ? "去登录" : "重试",
                        "actionId": "question_answers_retry",
                        "onAction": function () {
                          if (local_1_0.answersState.requiresLogin) {
                            local_1_0.navigate({
                              "name": AppDestinationName.LOGIN
                            });
                          } else if (local_1_0.answersState.phase !== QuestionAnswersPhase.ERROR) {
                            if (local_1_0.answersController !== null && local_1_0.answersController !== undefined) {
                              local_1_0.answersController.loadMore();
                            }
                          } else if (local_1_0.answersController !== null && local_1_0.answersController !== undefined) {
                            local_1_0.answersController.refresh();
                          }
                        }
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {});
                  }
                }, {
                  "name": "AppPageStatusPanel"
                });
              });
            } else if (local_1_0.answersState.phase === QuestionAnswersPhase.EMPTY) {
              local_1_0.ifElseBranchUpdateFunction(3, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  let acc;
                  if (p1) {
                    acc = new AppPageStatusPanel(local_1_0, {
                      "kind": AppPageStatusKind.EMPTY,
                      "message": "暂无可显示的回答",
                      "testId": "question_answers_empty"
                    }, undefined, p0, function () {}, {
                      "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
                      "line": 2414,
                      "col": 11
                    });
                    ViewPU.create(acc);
                    acc.paramsGenerator_ = function () {
                      return {
                        "kind": AppPageStatusKind.EMPTY,
                        "message": "暂无可显示的回答",
                        "testId": "question_answers_empty"
                      };
                    };
                  } else {
                    local_1_0.updateStateVarsOfChildByElmtId(p0, {});
                  }
                }, {
                  "name": "AppPageStatusPanel"
                });
              });
            } else if (local_1_0.answersState.loadingMore) {
              local_1_0.ifElseBranchUpdateFunction(4, function () {
                if (!If.canRetake("question_answers_loading_more")) {
                  local_1_0.observeComponentCreation2(function (p0, p1) {
                    LoadingProgress.create();
                    LoadingProgress.id("question_answers_loading_more");
                    LoadingProgress.width(40);
                    LoadingProgress.height(40);
                    LoadingProgress.color(local_1_0.resolvedThemeColor);
                  }, LoadingProgress);
                }
              });
            } else if (local_1_0.answersState.canLoadMore) {
              local_1_0.ifElseBranchUpdateFunction(5, function () {
                if (!If.canRetake("question_answers_more")) {
                  local_1_0.observeComponentCreation2(function (p0, p1) {
                    Button.createWithLabel("加载更多回答");
                    Button.id("question_answers_more");
                    Button.backgroundColor(local_1_0.resolvedThemeColor);
                    Button.fontColor(onThemeColor(local_1_0.resolvedThemeColor));
                    Button.onClick(function () {
                      if (local_1_0.answersController !== null && local_1_0.answersController !== undefined) {
                        local_1_0.answersController.loadMore();
                      }
                    });
                  }, Button);
                  Button.pop();
                }
              });
            } else {
              local_1_0.ifElseBranchUpdateFunction(6, function () {
                local_1_0.observeComponentCreation2(function (p0, p1) {
                  Text.create("已显示全部回答");
                  Text.fontColor({
                    "id": 50331664,
                    "type": 10001,
                    "params": [],
                    "bundleName": "com.github.zhuoyi233.zhplus",
                    "moduleName": "entry"
                  });
                }, Text);
                Text.pop();
              });
            }
          }, If);
          If.pop();
          Column.pop();
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
  }
  answerFeedCard(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id("question_answers_card_" + local_1_0.feedItem.target.id);
      Button.width("100%");
      Button.padding({
        "id": 50331670,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.backgroundColor({
        "id": 50331666,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.accessibilityText("打开回答");
      Button.onClick(function () {
        let v0 = local_1_1.questionAnswerFeedFactory();
        let v1 = local_1_1.answersController === null || local_1_1.answersController === undefined ? undefined : local_1_1.answersController.snapshot();
        if (v0 !== undefined && v1 !== undefined) {
          v0 = new QuestionAnswerNavigator(local_1_1.activeContentId, local_1_0.feedItem.target.id, v1, v0);
          stageQuestionAnswerNavigator(v0);
        }
        local_1_1.navigate({
          "name": AppDestinationName.ANSWER,
          "id": local_1_0.feedItem.target.id
        });
      });
    }, Button);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new FeedContentSummary(local_1_1, {
          "target": local_1_0.feedItem.target,
          "showTitle": false
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 2433,
          "col": 7
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "target": local_1_0.feedItem.target,
            "showTitle": false
          };
        };
      } else {
        local_1_1.updateStateVarsOfChildByElmtId(p0, {});
      }
    }, {
      "name": "FeedContentSummary"
    });
    Button.pop();
  }
  onResolvedThemeColorChanged() {
    this.answersSortOptions = local_0_0(this.resolvedThemeColor);
  }
  questionAnswerCount() {
    return this.content === undefined || this.content.kind !== ContentDetailKind.QUESTION ? 0 : this.content.value.answerCount;
  }
  selectAnswerSort(p0) {
    let v0 /*QuestionAnswerSortOrder*/;
    if (p0 !== 0 && p0 !== 1) {
      return;
    }
    if (this.answersSortIndexes[0] !== p0) {
      this.answersSortIndexes = [p0];
    }
    v0 = p0 === 0 ? QuestionAnswerSortOrder.DEFAULT : QuestionAnswerSortOrder.UPDATED;
    if (this.answersController !== null && this.answersController !== undefined) {
      this.answersController.setSortOrder(v0);
    }
    return;
  }
  navigatorHasPrevious() {
    let v0 = this.navigatorRevision >= 0;
    if (this.navigatorRevision >= 0) {
      v0 = (this.answerNavigator === null || this.answerNavigator === undefined ? undefined : this.answerNavigator.hasPrevious())
        ?? false;
    }
    return v0;
  }
  navigatorHasNext() {
    let v0 = this.navigatorRevision >= 0;
    if (this.navigatorRevision >= 0) {
      v0 = (this.answerNavigator === null || this.answerNavigator === undefined ? undefined : this.answerNavigator.hasNext())
        ?? false;
    }
    return v0;
  }
  openComments() {
    this.navigate({
      "name": AppDestinationName.COMMENT,
      "contentType": this.kind === ContentDetailKind.ARTICLE ? "article" : this.kind === ContentDetailKind.QUESTION ? "question" : "answer",
      "contentId": this.activeContentId
    });
  }
  openSegmentComments() {
    let v1, v2, v5;
    let v0 = 0;
    let local_1_0 = this;
    v1 = local_1_0.currentSegmentMeta();
    if (v1 === undefined || v1.segIds.length === 0) {
      local_1_0.openComments();
      return;
    }
    if (local_1_0.kind !== ContentDetailKind.ANSWER && local_1_0.kind !== ContentDetailKind.ARTICLE) {
      local_1_0.openComments();
      return;
    }
    v2 = local_1_0.segmentInfos.find(function (p0) {
      return p0.pid === local_1_0.segmentSheetPid;
    })?.marks[local_1_0.segmentSheetMarkIndex];
    v5 = {
      "name": AppDestinationName.COMMENT,
      "contentType": local_1_0.kind === ContentDetailKind.ARTICLE ? "article" : "answer",
      "contentId": local_1_0.activeContentId,
      "segmentId": v1.segIds.join(","),
      "segmentContent": local_1_0.currentSegmentQuote(),
      "segmentParagraphId": local_1_0.segmentSheetPid,
      "segmentStartOffset": v2 === undefined ? 0 : v2.startIndex,
      "segmentEndOffset": null
    };
    if (v2 !== undefined) {
      v0 = v2.endIndex;
    }
    v5.segmentEndOffset = v0;
    local_1_0.navigate(v5);
    return;
  }
  onContentDoubleTap() {
    if (this.phase !== ContentDetailPhase.READY || this.navigatorBusy) {
      return;
    }
    switch (this.answerDoubleTapAction) {
      case AnswerDoubleTapAction.NONE:
        return;
      case AnswerDoubleTapAction.OPEN_COMMENTS:
        performConfirmHaptic();
        this.openComments();
        return;
      case AnswerDoubleTapAction.TOGGLE_IMMERSIVE:
        this.immersiveReading = !this.immersiveReading;
        return;
      case AnswerDoubleTapAction.VOTE_UP:
        performConfirmHaptic();
        this.voteUpFromBodyDoubleTap();
        return;
    }
    this.doubleTapAskSheetShown = true;
    return;
  }
  voteUpFromBodyDoubleTap() {
    if (this.kind === ContentDetailKind.QUESTION) {
      this.showMenuToast("问题详情不支持点赞，可在设置中选择打开评论或切换沉浸式");
      return;
    }
    if (this.voteController !== null && this.voteController !== undefined) {
      this.voteController.voteUpFromDoubleTap();
    }
    return;
  }
  async restoreAnswerDoubleTapAction() {
    let v0;
    let v3 /*getAbilityContext*/ = getAbilityContext();
    if (v3 === undefined) {
      return undefined;
    }
    try {
      v0 = await new AppPreferencesStore(v3).loadAnswerDoubleTapAction();
      if (this.pageActive) {
        AppStorage.setOrCreate("answerDoubleTapAction", v0);
      }
    } catch (catchAcc) {
      return undefined;
    }
    return undefined;
  }
  saveAnswerDoubleTapAction(p0) {
    let v0 /*getAbilityContext*/;
    AppStorage.setOrCreate("answerDoubleTapAction", p0);
    v0 = getAbilityContext();
    if (v0 !== undefined) {
      v0 = new AppPreferencesStore(v0).saveAnswerDoubleTapAction(p0);
      v0.catch(function (p0) {});
    }
    this.getUIContext().getPromptAction().showToast({
      "message": "已将双击正文动作设为：" + answerDoubleTapActionLabel(p0) + ""
    });
  }
  async moveAnswer(p0) {
    let v0, v6, v7, v10 /*ContentDetailKind*/, acc;
    if (this.navigatorBusy) {
      return undefined;
    }
    this.navigatorBusy = true;
    this.resetAnswerOverscroll(false);
    try {
      v6 = this.answerNavigator === null || this.answerNavigator === undefined ? undefined : this.answerNavigator.move(p0);
      v0 = await v6;
      this.navigatorRevision = this.navigatorRevision + 1;
      if (!this.pageActive) {
        this.navigatorBusy = false;
        return undefined;
      }
      if (v0 === undefined) {
        v6 = (this.answerNavigator === null || this.answerNavigator === undefined ? undefined : this.answerNavigator.errorMessage())
          ?? "";
        v7 = this.getUIContext().getPromptAction();
        v10 = {
          "message": null
        };
        if (v6.length <= 0) {
          v6 = "暂时无法切换回答";
        }
        v10.message = v6;
        v7.showToast(v10);
        this.navigatorBusy = false;
        return undefined;
      }
      this.contentAtBottom = false;
      this.contentAtTop = true;
      this.answerQuestionScrolled = false;
      this.chromeHiddenByScroll = false;
      this.lastContentScrollOffset = 0;
      AppStorage.setOrCreate("detailTitleHiddenByScroll", false);
      if (this.voteController !== null && this.voteController !== undefined) {
        this.voteController.deactivate();
      }
      this.voteController = undefined;
      this.favoriteDialogShown = false;
      this.contentFavorited = false;
      this.activeContentId = v0;
      acc = this.controller === null || this.controller === undefined ? undefined : this.controller.load(ContentDetailKind.ANSWER, v0);
      await acc;
    } finally {
      this.navigatorBusy = false;
    }
  }
  onAnswerOverscrollPanUpdate(p0) {
    let v1 /*ContentDetailKind*/, v2, acc;
    if (this.kind !== ContentDetailKind.ANSWER || this.answerFabDragging || this.answerSwitchMode === "off") {
      return;
    }
    if (this.bodyTextSelectionActive) {
      if (this.answerOverscrollOffset !== 0) {
        this.cancelAnswerOverscrollPan();
      }
      return;
    }
    v1 = this.answerSwitchMode === "horizontal" ? p0.offsetX : p0.offsetY;
    v2 = v1 - this.overscrollPanPrevY;
    this.overscrollPanPrevY = v1;
    if (v2 === 0 || this.navigatorBusy) {
      return;
    }
    acc = accumulateAnswerSwitchDrag(this.answerSwitchMode, this.overscrollRawDrag, this.answerOverscrollOffset, v2, this.contentAtTop, this.contentAtBottom, this.navigatorHasPrevious(), this.navigatorHasNext());
    if (acc === this.overscrollRawDrag) {
      return;
    }
    this.overscrollRawDrag = acc;
    this.applyOverscrollOffset(local_0_2(this.overscrollRawDrag, this.answerSwitchMode === "horizontal" ? local_0_3 : local_0_4, local_0_5));
    return;
  }
  applyOverscrollOffset(p0) {
    this.answerOverscrollOffset = p0;
    AppStorage.setOrCreate("answerOverscrollActive", p0 !== 0);
    if (this.answerSwitchMode !== "horizontal") {
      p0 = 0;
    }
    AppStorage.setOrCreate("answerOverscrollOffset", p0);
  }
  onAnswerOverscrollPanEnd() {}
  cancelAnswerOverscrollPan() {
    let local_1_0 = this;
    local_1_0.overscrollRawDrag = 0;
    if (local_1_0.answerOverscrollOffset === 0) {
      return;
    }
    local_1_0.getUIContext().animateTo({
      "curve": curves.springMotion(0.32, 0.78)
    }, function () {
      local_1_0.applyOverscrollOffset(0);
    });
    return;
  }
  resetAnswerOverscroll(p0) {}
  answerOverscrollTriggered() {
    return Math.abs(this.answerOverscrollOffset) >= this.answerOverscrollTriggerThreshold() / Math.min(3, Math.max(0.5, this.answerSwitchSensitivity));
  }
  answerOverscrollProgress() {
    let v0 = Math.abs(this.answerOverscrollOffset) / (this.answerOverscrollTriggerThreshold() / Math.min(3, Math.max(0.5, this.answerSwitchSensitivity)));
    return Math.min(1, v0);
  }
  answerOverscrollTriggerThreshold() {
    return this.answerSwitchMode === "horizontal" ? local_0_6 : local_0_7;
  }
  answerPreviewData(p0) {
    return p0 ? this.answerNavigator === null || this.answerNavigator === undefined ? undefined : this.answerNavigator.previousAnswerPreview() : this.answerNavigator === null || this.answerNavigator === undefined ? undefined : this.answerNavigator.nextAnswerPreview();
  }
  answerPreviewAuthorName(p0) {
    return this.answerPreviewData(p0)?.authorName ?? "";
  }
  answerPreviewAvatarUrl(p0) {
    return this.answerPreviewData(p0)?.authorAvatarUrl ?? "";
  }
  answerPreviewExcerpt(p0) {
    let v0 = this.answerPreviewData(p0);
    if (v0 === undefined) {
      return "";
    }
    return v0.detailLoaded ? v0.excerpt : "";
  }
  answerPreviewAuthorHeadline(p0) {
    return this.answerPreviewData(p0)?.authorHeadline ?? "";
  }
  answerPreviewVoteupCount(p0) {
    return this.answerPreviewData(p0)?.voteupCount ?? 0;
  }
  answerPreviewCommentCount(p0) {
    return this.answerPreviewData(p0)?.commentCount ?? 0;
  }
  currentAnswerQuestionTitle() {
    return this.content !== undefined && this.content.kind === ContentDetailKind.ANSWER ? contentContextTitle(this.content) : "";
  }
  canEditExistingAnswer() {
    let v2 = this.session === null || this.session === undefined ? undefined : this.session.getState().profile;
    let v3 /*SessionStatus*/ = this.content !== undefined && this.content.kind === ContentDetailKind.ANSWER;
    if (this.content !== undefined && this.content.kind === ContentDetailKind.ANSWER) {
      v3 = (this.session === null || this.session === undefined ? undefined : this.session.getState().status) === SessionStatus.AUTHENTICATED;
    }
    if (v3) {
      v3 = v2 !== undefined;
    }
    if (v3) {
      v3 = (this.content.value.author === null || this.content.value.author === undefined ? undefined : this.content.value.author.id) === v2.id;
    }
    return v3;
  }
  openExistingAnswerEditor() {
    if (!this.canEditExistingAnswer() || this.content === undefined || this.content.kind !== ContentDetailKind.ANSWER) {
      return;
    }
    if (!stageAnswerEditSeed(this.content.value.id, this.content.value.contentHtml)) {
      return;
    }
    this.navigate({
      "name": AppDestinationName.WRITE_ANSWER,
      "questionId": this.content.value.questionId,
      "answerId": this.content.value.id
    });
    return;
  }
  actionMenuSheet(p0) {
    let v0;
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.id("detail_menu_sheet");
      Column.width("100%");
      Column.padding({
        "id": 50331690,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Column.onAreaChange(function (p0, p1) {
        local_1_0.actionMenuWidth = Number(p1.width);
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Row.width("100%");
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("更多操作");
      Text.fontSize({
        "id": 50331673,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(FontWeight.Bold);
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.layoutWeight(1);
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id("detail_menu_close");
      Button.width(40);
      Button.height(40);
      Button.padding(0);
      Button.backgroundColor(Color.Transparent);
      Button.accessibilityText("关闭更多操作");
      Button.onClick(function () {
        local_1_0.actionMenuShown = false;
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create({
        "id": 125831487,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(18);
      SymbolGlyph.fontColor([{
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      }]);
    }, SymbolGlyph);
    Button.pop();
    Row.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Flex.create({
        "wrap": FlexWrap.Wrap
      });
      Flex.width("100%");
      Flex.padding({
        "top": 8,
        "bottom": 8
      });
    }, Flex);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.kind === ContentDetailKind.ANSWER || local_1_0.kind === ContentDetailKind.ARTICLE) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          let v0 = local_1_0.menuQuickAction.bind(local_1_0);
          let v1 = local_1_0.isCurrentContentSpeaking() ? "停止朗读" : "朗读";
          let v5 = function () {
            local_1_0.actionMenuShown = false;
            local_1_0.toggleSpeechPlayback();
          };
          v0(v1, {
            "id": 125831874,
            "type": 40000,
            "params": [],
            "bundleName": "com.github.zhuoyi233.zhplus",
            "moduleName": "entry"
          }, "detail_menu_speech", local_1_0.isCurrentContentSpeaking(), v5);
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    local_1_0.menuQuickAction.bind(local_1_0)("分享", {
      "id": 125831499,
      "type": 40000,
      "params": [],
      "bundleName": "com.github.zhuoyi233.zhplus",
      "moduleName": "entry"
    }, "detail_menu_share", false, function () {
      local_1_0.actionMenuShown = false;
      if (local_1_0.shareActionMode === "copy") {
        local_1_0.copyContentLink();
      } else {
        local_1_0.shareContentLink();
      }
    });
    local_1_0.menuQuickAction.bind(local_1_0)("复制链接", {
      "id": 125831976,
      "type": 40000,
      "params": [],
      "bundleName": "com.github.zhuoyi233.zhplus",
      "moduleName": "entry"
    }, "detail_menu_copy_link", false, function () {
      local_1_0.actionMenuShown = false;
      local_1_0.copyContentLink();
    });
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.kind === ContentDetailKind.ANSWER || local_1_0.kind === ContentDetailKind.ARTICLE) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          local_1_0.menuQuickAction.bind(local_1_0)("沉浸阅读", {
            "id": 125832700,
            "type": 40000,
            "params": [],
            "bundleName": "com.github.zhuoyi233.zhplus",
            "moduleName": "entry"
          }, "content_" + local_1_0.kind + "_detail_immersive", local_1_0.immersiveReading, function () {
            local_1_0.actionMenuShown = false;
            local_1_0.immersiveReading = !local_1_0.immersiveReading;
            local_1_0.showMenuToast(local_1_0.immersiveReading ? "已进入沉浸式，按返回键即可退出" : "已退出沉浸式");
          });
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Flex.pop();
    local_1_0.menuSettingRow.bind(local_1_0)("外观与阅读体验", {
      "id": 125832271,
      "type": 40000,
      "params": [],
      "bundleName": "com.github.zhuoyi233.zhplus",
      "moduleName": "entry"
    }, "detail_menu_appearance_settings", true, true, function () {
      local_1_0.actionMenuShown = false;
      local_1_0.navigate({
        "name": AppDestinationName.APPEARANCE_SETTINGS
      });
    });
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create();
      Column.width("100%");
      Column.margin({
        "top": 8
      });
      Column.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Column.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v0;
      If.create();
      if (local_1_0.content !== undefined && (v0 = 0, contentAuthorName(local_1_0.content).length > 0)) {
        local_1_0.ifElseBranchUpdateFunction(v0, function () {
          let v0 = local_1_0.menuSettingRow.bind(local_1_0);
          v0("屏蔽作者", {
            "id": 125832135,
            "type": 40000,
            "params": [],
            "bundleName": "com.github.zhuoyi233.zhplus",
            "moduleName": "entry"
          }, "" + local_1_0.kind + "_block_author", false, !local_1_0.blockingBusy
            && local_1_0.blockingAction !== undefined, function () {
            let v0 = local_1_0.content === null || local_1_0.content === undefined ? undefined : local_1_0.content.value.author;
            if (v0 !== undefined) {
              local_1_0.actionMenuShown = false;
              local_1_0.pendingUserBlock = {
                "userId": v0.id,
                "userName": v0.name
              };
            }
          });
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    v0 = local_1_0.menuSettingRow.bind(local_1_0);
    v0("屏蔽关键词", {
      "id": 125832272,
      "type": 40000,
      "params": [],
      "bundleName": "com.github.zhuoyi233.zhplus",
      "moduleName": "entry"
    }, "" + local_1_0.kind + "_block_keyword", false, !local_1_0.blockingBusy
      && local_1_0.blockingAction !== undefined, function () {
      local_1_0.actionMenuShown = false;
      local_1_0.keywordBlockInput = "";
      local_1_0.keywordBlockVisible = true;
    });
    Column.pop();
    Column.pop();
  }
  menuQuickActionWidth() {
    return (getAbilityContext()?.config.fontSizeScale ?? 1) > 1.2 || this.actionMenuWidth < 360 ? "50%" : "25%";
  }
  menuQuickAction(p0, p1, p2, p3, p4, p5) {
    let local_1_5 = this;
    let local_1_1 = p0;
    let local_1_4 = p1;
    let local_1_0 = p2;
    let local_1_3 = p3;
    let local_1_2 = p4;
    local_1_5.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id(local_1_0);
      Button.width(local_1_5.menuQuickActionWidth());
      Button.padding({
        "top": 8,
        "bottom": 8,
        "left": 4,
        "right": 4
      });
      Button.backgroundColor(Color.Transparent);
      Button.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.accessibilityText(local_1_1);
      Button.onClick(local_1_2);
    }, Button);
    local_1_5.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": 8
      });
      Column.width("100%");
    }, Column);
    local_1_5.observeComponentCreation2(function (p0, p1) {
      Stack.create();
      Stack.width(48);
      Stack.height(48);
      Stack.borderRadius(24);
      Stack.backgroundColor(local_1_3 ? local_1_5.resolvedThemeColor : {
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Stack);
    local_1_5.observeComponentCreation2(function (p0, p1) {
      let v2;
      SymbolGlyph.create(local_1_4);
      SymbolGlyph.fontSize(24);
      v2 = [];
      v2[0] = local_1_3 ? onThemeColor(local_1_5.resolvedThemeColor) : local_1_5.resolvedThemeColor;
      SymbolGlyph.fontColor(v2);
    }, SymbolGlyph);
    Stack.pop();
    local_1_5.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_1);
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.textAlign(TextAlign.Center);
      Text.width("100%");
    }, Text);
    Text.pop();
    Column.pop();
    Button.pop();
  }
  menuSettingRow(p0, p1, p2, p3, p4, p5, p6) {
    let local_1_6 = this;
    let local_1_2 = p0;
    let local_1_4 = p1;
    let local_1_0 = p2;
    let local_1_5 = p3;
    let local_1_1 = p4;
    let local_1_3 = p5;
    local_1_6.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id(local_1_0);
      Button.width("100%");
      Button.constraintSize({
        "minHeight": 52
      });
      Button.padding({
        "top": 14,
        "bottom": 14,
        "left": 16,
        "right": 16
      });
      Button.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.enabled(local_1_1);
      Button.accessibilityText(local_1_2);
      Button.onClick(local_1_3);
    }, Button);
    local_1_6.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 12
      });
      Row.width("100%");
    }, Row);
    local_1_6.observeComponentCreation2(function (p0, p1) {
      let v2;
      SymbolGlyph.create(local_1_4);
      SymbolGlyph.fontSize(22);
      v2 = [];
      v2[0] = local_1_5 ? local_1_6.resolvedThemeColor : {
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      };
      SymbolGlyph.fontColor(v2);
    }, SymbolGlyph);
    local_1_6.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_2);
      Text.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.layoutWeight(1);
    }, Text);
    Text.pop();
    local_1_6.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_5) {
        local_1_6.ifElseBranchUpdateFunction(0, function () {
          local_1_6.observeComponentCreation2(function (p0, p1) {
            SymbolGlyph.create({
              "id": 125832664,
              "type": 40000,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            });
            SymbolGlyph.fontSize(14);
            SymbolGlyph.fontColor([{
              "id": 50331664,
              "type": 10001,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            }]);
          }, SymbolGlyph);
        });
      } else {
        local_1_6.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Row.pop();
    Button.pop();
  }
  doubleTapAskSheet(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Column.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Column.id("answer_double_tap_sheet");
      Column.width("100%");
      Column.padding({
        "id": 50331690,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Column);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("设置双击正文动作");
      Text.fontSize({
        "id": 50331673,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(FontWeight.Bold);
      Text.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("选择以后双击正文时默认执行的动作。选择后会立即保存到设置，你也可以稍后在设置中修改。");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.width("100%");
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("设为无操作", {
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id("answer_double_tap_none");
      Button.width("100%");
      Button.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.onClick(function () {
        local_1_0.doubleTapAskSheetShown = false;
        local_1_0.saveAnswerDoubleTapAction(AnswerDoubleTapAction.NONE);
      });
    }, Button);
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("设为点赞", {
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id("answer_double_tap_vote_up");
      Button.enabled(local_1_0.kind !== ContentDetailKind.QUESTION);
      Button.width("100%");
      Button.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.onClick(function () {
        local_1_0.doubleTapAskSheetShown = false;
        local_1_0.saveAnswerDoubleTapAction(AnswerDoubleTapAction.VOTE_UP);
        performConfirmHaptic();
        local_1_0.voteUpFromBodyDoubleTap();
      });
    }, Button);
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("设为打开评论区", {
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id("answer_double_tap_open_comments");
      Button.width("100%");
      Button.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.onClick(function () {
        local_1_0.doubleTapAskSheetShown = false;
        local_1_0.saveAnswerDoubleTapAction(AnswerDoubleTapAction.OPEN_COMMENTS);
        performConfirmHaptic();
        local_1_0.openComments();
      });
    }, Button);
    Button.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithLabel("设为开关沉浸式", {
        "type": ButtonType.Normal,
        "stateEffect": true
      });
      Button.id("answer_double_tap_toggle_immersive");
      Button.width("100%");
      Button.fontSize({
        "id": 50331668,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.fontColor({
        "id": 50331663,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.backgroundColor({
        "id": 50331657,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.borderRadius({
        "id": 50331671,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Button.onClick(function () {
        local_1_0.doubleTapAskSheetShown = false;
        local_1_0.saveAnswerDoubleTapAction(AnswerDoubleTapAction.TOGGLE_IMMERSIVE);
        local_1_0.immersiveReading = !local_1_0.immersiveReading;
      });
    }, Button);
    Button.pop();
    Column.pop();
  }
  showMenuToast(p0) {
    if (p0.length > 0) {
      this.getUIContext().getPromptAction().showToast({
        "message": p0
      });
    }
  }
  copyContentLink() {
    let v0;
    let local_1_0 = this;
    if (local_1_0.content === undefined) {
      return;
    }
    if (local_1_0.content.value.url.trim().length === 0) {
      return;
    }
    try {
      v0 = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, local_1_0.content.value.url);
      v0 = pasteboard.getSystemPasteboard().setData(v0).then(function () {
        local_1_0.showMenuToast("已复制链接");
      });
      v0.catch(function (p0) {
        local_1_0.showMenuToast("复制失败，请重试");
      });
    } catch (catchAcc) {
      local_1_0.showMenuToast("复制失败，请重试");
    }
    return;
  }
  isCurrentContentSpeaking() {
    let v0 /*getSpeechPlaybackService*/ = getSpeechPlaybackService().getSnapshot();
    return (v0.status === SpeechPlaybackStatus.INITIALIZING || v0.status === SpeechPlaybackStatus.SPEAKING)
      && v0.contentId === this.activeContentId;
  }
  async toggleSpeechPlayback() {
    let v3, v4 /*getSpeechPlaybackService*/, v5 /*defaultSpeechPreferences*/, v7 /*AppPreferencesStore*/;
    if (this.content === undefined) {
      return undefined;
    }
    v4 = getSpeechPlaybackService();
    if (this.isCurrentContentSpeaking()) {
      v4.stop();
      this.showMenuToast("已停止朗读");
      return undefined;
    }
    v5 = getAbilityContext();
    try {
      v5 = v5 === undefined ? defaultSpeechPreferences() : await new AppPreferencesStore(v5).loadSpeechPreferences();
      v7 = contentContextTitle(this.content).length > 0 ? contentContextTitle(this.content) : contentDetailPageTitle(this.content.kind);
      await v4.speak(this.activeContentId, v7, contentSpeechText(this.content), v5);
      v3 = v4.getSnapshot();
      v3 = v3.status === SpeechPlaybackStatus.ERROR ? v3.message : "已开始朗读";
      this.showMenuToast(v3);
    } catch (catchAcc) {
      this.showMenuToast("朗读启动失败，请稍后重试");
    }
    return undefined;
  }
  shareContentLink() {
    let v1 /*getAbilityContext*/, v2, v3, v4, acc;
    let local_1_0 = this;
    v1 = getAbilityContext();
    v2 = local_1_0.content === undefined;
    if (local_1_0.content !== undefined) {
      v2 = v1 === undefined;
    }
    if (v2 || (v2 = 0, local_1_0.content.value.url.trim().length === 0)) {
      local_1_0.showMenuToast("暂时无法打开分享面板");
      return;
    }
    v3 = contentContextTitle(local_1_0.content);
    v4 = {
      "kind": SharePayloadKind.TEXT,
      "title": null,
      "summary": null,
      "contentUrl": null,
      "thumbnailUrl": null
    };
    if (v3.length <= v2) {
      v3 = contentDetailPageTitle(local_1_0.content.kind);
    }
    v4.title = v3;
    v4.summary = contentShareSummary(local_1_0.content);
    v4.contentUrl = local_1_0.content.value.url;
    v4.thumbnailUrl = contentShareThumbnailUrl(local_1_0.content);
    acc = createSystemShareService(v1).share(v4).then(function (p0) {
      local_1_0.showMenuToast(p0 === ShareOutcome.CANCELLED ? "" : "已打开系统分享面板");
    });
    acc.catch(function () {
      local_1_0.showMenuToast("暂时无法打开分享面板");
    });
    return;
  }
  articleTopicsFlow(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Flex.create({
        "wrap": FlexWrap.Wrap
      });
      Flex.id("article_detail_topics");
      Flex.width("100%");
    }, Flex);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      ForEach.create();
      local_1_1.forEachUpdateFunction(p0, local_1_0, function (p0) {
        let local_2_0 = p0;
        local_1_1.observeComponentCreation2(function (p0, p1) {
          Button.createWithLabel("# " + local_2_0.name + "", {
            "type": ButtonType.Normal,
            "stateEffect": true
          });
          Button.id("article_topic_" + local_2_0.id + "");
          Button.height(30);
          Button.fontSize({
            "id": 50331669,
            "type": 10002,
            "params": [],
            "bundleName": "com.github.zhuoyi233.zhplus",
            "moduleName": "entry"
          });
          Button.fontColor({
            "id": 50331664,
            "type": 10001,
            "params": [],
            "bundleName": "com.github.zhuoyi233.zhplus",
            "moduleName": "entry"
          });
          Button.backgroundColor({
            "id": 50331666,
            "type": 10001,
            "params": [],
            "bundleName": "com.github.zhuoyi233.zhplus",
            "moduleName": "entry"
          });
          Button.borderRadius(15);
          Button.border({
            "width": 1,
            "color": {
              "id": 50331664,
              "type": 10001,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            },
            "radius": 15
          });
          Button.margin({
            "right": 8,
            "bottom": 8
          });
          Button.onClick(function () {
            return local_1_1.navigate({
              "name": AppDestinationName.SEARCH,
              "query": local_2_0.name
            });
          });
        }, Button);
        Button.pop();
      }, function (p0) {
        return p0.id;
      }, false, false);
    }, ForEach);
    ForEach.pop();
    Flex.pop();
  }
  endorsementFlow(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p0;
    local_1_1.observeComponentCreation2(function (p0, p1) {
      Flex.create({
        "wrap": FlexWrap.Wrap,
        "direction": FlexDirection.Row
      });
      Flex.id("content_" + local_1_1.kind + "_detail_endorsements");
      Flex.width("100%");
    }, Flex);
    local_1_1.observeComponentCreation2(function (p0, p1) {
      ForEach.create();
      local_1_1.forEachUpdateFunction(p0, local_1_0, function (p0) {
        let local_2_0 = p0;
        local_1_1.observeComponentCreation2(function (p0, p1) {
          Row.create({
            "space": 4
          });
          Row.alignItems(VerticalAlign.Center);
          Row.padding({
            "left": 10,
            "right": 10,
            "top": 5,
            "bottom": 5
          });
          Row.borderRadius(16);
          Row.backgroundColor(local_0_8(local_2_0));
          Row.margin({
            "right": {
              "id": 50331691,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            },
            "bottom": {
              "id": 50331691,
              "type": 10002,
              "params": [],
              "bundleName": "com.github.zhuoyi233.zhplus",
              "moduleName": "entry"
            }
          });
        }, Row);
        local_1_1.observeComponentCreation2(function (p0, p1) {
          If.create();
          if ((local_2_0.leadingIconKey ?? "").indexOf("hash") >= 0) {
            local_1_1.ifElseBranchUpdateFunction(0, function () {
              local_1_1.observeComponentCreation2(function (p0, p1) {
                Text.create("#");
                Text.fontSize({
                  "id": 50331669,
                  "type": 10002,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                Text.fontWeight(FontWeight.Bold);
                Text.fontColor(local_0_9(local_2_0));
              }, Text);
              Text.pop();
            });
          } else {
            local_1_1.ifElseBranchUpdateFunction(1, function () {});
          }
        }, If);
        If.pop();
        local_1_1.observeComponentCreation2(function (p0, p1) {
          Text.create(local_2_0.text);
          Text.fontSize({
            "id": 50331669,
            "type": 10002,
            "params": [],
            "bundleName": "com.github.zhuoyi233.zhplus",
            "moduleName": "entry"
          });
          Text.fontWeight(FontWeight.Medium);
          Text.fontColor(local_0_9(local_2_0));
          Text.maxLines(1);
        }, Text);
        Text.pop();
        local_1_1.observeComponentCreation2(function (p0, p1) {
          If.create();
          if ((local_2_0.trailingIconKey ?? "").indexOf("arrow_down") >= 0) {
            local_1_1.ifElseBranchUpdateFunction(0, function () {
              local_1_1.observeComponentCreation2(function (p0, p1) {
                SymbolGlyph.create({
                  "id": 125832666,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                SymbolGlyph.fontSize(14);
                SymbolGlyph.fontColor([local_0_9(local_2_0)]);
              }, SymbolGlyph);
            });
          } else if ((local_2_0.trailingIconKey ?? "").indexOf("arrow_right") >= 0) {
            local_1_1.ifElseBranchUpdateFunction(1, function () {
              local_1_1.observeComponentCreation2(function (p0, p1) {
                SymbolGlyph.create({
                  "id": 125832664,
                  "type": 40000,
                  "params": [],
                  "bundleName": "com.github.zhuoyi233.zhplus",
                  "moduleName": "entry"
                });
                SymbolGlyph.fontSize(14);
                SymbolGlyph.fontColor([local_0_9(local_2_0)]);
              }, SymbolGlyph);
            });
          } else {
            local_1_1.ifElseBranchUpdateFunction(2, function () {});
          }
        }, If);
        If.pop();
        Row.pop();
      }, function (p0) {
        return p0.text;
      }, false, false);
    }, ForEach);
    ForEach.pop();
    Flex.pop();
  }
  voteUpAction(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("" + local_1_0.kind + "_vote_up");
      Button.backgroundColor(Color.Transparent);
      Button.lightUpEffect(1);
      Button.enabled(!local_1_0.interactionPending);
      Button.onClick(function () {
        if (local_1_0.voteController !== null && local_1_0.voteController !== undefined) {
          local_1_0.voteController.toggleVote(true);
        }
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 4
      });
      Row.padding({
        "left": 8,
        "right": 8,
        "top": 8,
        "bottom": 8
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create(local_1_0.voteState === ContentVoteState.UP ? {
        "id": 125835553,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      } : {
        "id": 125835554,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      SymbolGlyph.fontColor([local_1_0.resolvedThemeColor]);
      SymbolGlyph.rotate({
        "x": 0,
        "y": 0,
        "z": 1,
        "angle": 90
      });
    }, SymbolGlyph);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create("" + local_1_0.voteupCount + "");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(local_1_0.voteState === ContentVoteState.UP ? FontWeight.Bold : FontWeight.Medium);
      Text.fontColor(local_1_0.resolvedThemeColor);
    }, Text);
    Text.pop();
    Row.pop();
    Button.pop();
  }
  voteDownAction(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("" + local_1_0.kind + "_vote_down");
      Button.backgroundColor(Color.Transparent);
      Button.lightUpEffect(1);
      Button.enabled(!local_1_0.interactionPending);
      Button.onClick(function () {
        if (local_1_0.voteController !== null && local_1_0.voteController !== undefined) {
          local_1_0.voteController.toggleVote(false);
        }
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 4
      });
      Row.padding({
        "left": 8,
        "right": 8,
        "top": 8,
        "bottom": 8
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      SymbolGlyph.create(local_1_0.voteState === ContentVoteState.DOWN ? {
        "id": 125835553,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      } : {
        "id": 125835554,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      SymbolGlyph.fontColor([local_1_0.resolvedThemeColor]);
      SymbolGlyph.rotate({
        "x": 0,
        "y": 0,
        "z": 1,
        "angle": -90
      });
    }, SymbolGlyph);
    Row.pop();
    Button.pop();
  }
  followQuestionAction(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Button.createWithChild({
        "type": ButtonType.Normal,
        "stateEffect": false
      });
      Button.id("question_follow");
      Button.height(36);
      Button.backgroundColor(Color.Transparent);
      Button.enabled(!local_1_0.interactionPending);
      Button.onClick(function () {
        if (local_1_0.followController !== null && local_1_0.followController !== undefined) {
          local_1_0.followController.toggleFollow();
        }
      });
    }, Button);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": 4
      });
      Row.padding({
        "left": 6,
        "right": 6,
        "top": 8,
        "bottom": 8
      });
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let v2;
      SymbolGlyph.create(local_1_0.following ? {
        "id": 125831490,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      } : {
        "id": 125831481,
        "type": 40000,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      SymbolGlyph.fontSize(20);
      v2 = [];
      v2[0] = local_1_0.following ? local_1_0.resolvedThemeColor : {
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      };
      SymbolGlyph.fontColor(v2);
    }, SymbolGlyph);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_0.following ? "已关注 " + local_1_0.followerCount + "" : "关注问题 " + local_1_0.followerCount + "");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontWeight(FontWeight.Medium);
      Text.fontColor(local_1_0.following ? local_1_0.resolvedThemeColor : {
        "id": 50331664,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
    }, Text);
    Text.pop();
    Row.pop();
    Button.pop();
  }
  interactionStatusRow(p0) {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Row.create({
        "space": {
          "id": 50331691,
          "type": 10002,
          "params": [],
          "bundleName": "com.github.zhuoyi233.zhplus",
          "moduleName": "entry"
        }
      });
      Row.width("100%");
    }, Row);
    local_1_0.observeComponentCreation2(function (p0, p1) {
      Text.create(local_1_0.interactionErrorMessage);
      Text.id("" + local_1_0.kind + "_interaction_status");
      Text.fontSize({
        "id": 50331675,
        "type": 10002,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.fontColor({
        "id": 50331659,
        "type": 10001,
        "params": [],
        "bundleName": "com.github.zhuoyi233.zhplus",
        "moduleName": "entry"
      });
      Text.layoutWeight(1);
    }, Text);
    Text.pop();
    local_1_0.observeComponentCreation2(function (p0, p1) {
      If.create();
      if (local_1_0.interactionRequiresLogin) {
        local_1_0.ifElseBranchUpdateFunction(0, function () {
          if (!If.canRetake("" + local_1_0.kind + "_interaction_login")) {
            local_1_0.observeComponentCreation2(function (p0, p1) {
              Button.createWithLabel("去登录");
              Button.backgroundColor(local_1_0.resolvedThemeColor);
              Button.fontColor(onThemeColor(local_1_0.resolvedThemeColor));
              Button.id("" + local_1_0.kind + "_interaction_login");
              Button.fontSize({
                "id": 50331675,
                "type": 10002,
                "params": [],
                "bundleName": "com.github.zhuoyi233.zhplus",
                "moduleName": "entry"
              });
              Button.onClick(function () {
                local_1_0.navigate({
                  "name": AppDestinationName.LOGIN
                });
              });
            }, Button);
            Button.pop();
          }
        });
      } else {
        local_1_0.ifElseBranchUpdateFunction(1, function () {});
      }
    }, If);
    If.pop();
    Row.pop();
  }
  applyState(p0) {
    let v1 /*ContentDetailKind*/;
    this.phase = p0.phase;
    this.content = p0.content;
    this.segmentInfos = this.extractSegmentInfos(p0.content);
    this.errorMessage = p0.errorMessage ?? "";
    this.requiresLogin = p0.requiresLogin;
    this.openedRecordPhase = p0.openedRecordPhase;
    if (p0.phase === ContentDetailPhase.READY && p0.content !== undefined) {
      this.refreshContentFavoriteState();
      this.activateInteraction(p0.content);
      if (p0.content.kind === ContentDetailKind.QUESTION) {
        publishQuestionTitle({
          "id": this.activeContentId,
          "title": p0.content.value.title,
          "scrolled": this.questionScrolled
        });
      }
      if (p0.content.kind === ContentDetailKind.ANSWER) {
        v1 = {
          "id": this.contentId,
          "questionTitle": contentContextTitle(p0.content),
          "authorName": contentAuthorName(p0.content),
          "authorAvatarUrl": contentAuthorAvatarUrl(p0.content),
          "authorBadgeIconUrl": contentAuthorBadge(p0.content)?.iconUrl ?? "",
          "scrolled": this.answerQuestionScrolled
        };
        publishAnswerTitle(v1);
      }
      if (p0.content.kind === ContentDetailKind.ARTICLE) {
        publishArticleTitle({
          "id": this.contentId,
          "title": contentContextTitle(p0.content),
          "authorName": contentAuthorName(p0.content),
          "authorAvatarUrl": contentAuthorAvatarUrl(p0.content),
          "authorBadgeIconUrl": contentAuthorBadge(p0.content)?.iconUrl ?? "",
          "scrolled": this.articleTitleScrolled
        });
      }
      if (p0.content.kind === ContentDetailKind.ANSWER && this.answerNavigator === undefined) {
        this.ensureAnswerNavigator(p0.content.value.questionId);
      }
    }
  }
  ensureAnswerNavigator(p0) {
    let v0;
    let local_1_0 = this;
    v0 = local_1_0.questionAnswerFeedFactory();
    if (v0 === undefined) {
      return;
    }
    local_1_0.answerNavigator = new QuestionAnswerNavigator(p0, local_1_0.activeContentId, undefined, v0, function () {
      local_1_0.navigatorRevision = local_1_0.navigatorRevision + 1;
    });
    return;
  }
  activateInteraction(p0) {
    let v0;
    let local_1_0, local_1_1;
    let local_1_2 = this;
    if (p0.kind === ContentDetailKind.QUESTION) {
      v0 = local_1_2.followController !== undefined;
      if (local_1_2.followController === undefined) {
        v0 = local_1_2.followRepository === undefined;
      }
      if (v0 || local_1_2.session === undefined) {
        return;
      }
      local_1_0 = local_1_2.followRepository;
      local_1_1 = local_1_2.activeContentId;
      local_1_2.followController = new FollowController(local_1_0, local_1_2.session, function (p0) {
        return local_1_0.followQuestion(local_1_1, p0);
      }, function (p0) {
        return local_1_2.applyFollowState(p0);
      });
      local_1_2.followController.activate();
      local_1_2.followController.applyInitial(p0.value.isFollowing ?? false, p0.value.followerCount);
    } else {
      if (local_1_2.voteController !== undefined || local_1_2.voteRepository === undefined || local_1_2.session === undefined) {
        return;
      }
      local_1_2.voteController = new ContentVoteController(local_1_2.voteRepository, local_1_2.session, local_1_2.kind, local_1_2.activeContentId, function (p0) {
        return local_1_2.applyVoteState(p0);
      });
      local_1_2.voteController.activate();
      local_1_2.voteController.applyInitial(p0);
    }
  }
  applyVoteState(p0) {
    this.voteState = p0.voteState;
    this.voteupCount = p0.voteupCount;
    this.thanked = p0.thanked;
    this.thanksCount = p0.thanksCount;
    this.interactionPending = p0.pending;
    this.interactionErrorMessage = p0.errorMessage ?? "";
    this.interactionRequiresLogin = p0.requiresLogin;
  }
  applyFollowState(p0) {
    this.following = p0.following;
    this.followerCount = p0.followerCount;
    this.interactionPending = p0.pending;
    this.interactionErrorMessage = p0.errorMessage ?? "";
    this.interactionRequiresLogin = p0.requiresLogin;
  }
  displayedContentStatistics(p0) {
    return contentStatistics(p0, this.voteController === undefined ? undefined : this.voteupCount, this.followController === undefined ? undefined : this.followerCount);
  }
  rerender() {
    this.updateDirtyElements();
  }
}
export class QuestionDetailPage extends ViewPU {
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
    v0.questionAnswerFeedFactory = function () {
      return undefined;
    };
    v0.contentId = "";
    v0.repository = undefined;
    v0.linkCardMetaRepository = undefined;
    v0.openedContentStore = undefined;
    v0.historyUploader = undefined;
    v0.rules = undefined;
    v0.history = undefined;
    v0.voteRepository = undefined;
    v0.segmentReactionRepository = undefined;
    v0.followRepository = undefined;
    v0.collectionRepository = undefined;
    v0.commentRepository = undefined;
    v0.session = undefined;
    v0.navigate = function (p0) {};
    v0.onBack = function () {};
    v0.setInitiallyProvidedValue(p1);
    v0.finalizeConstruction();
    return v0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.questionAnswerFeedFactory !== undefined) {
      this.questionAnswerFeedFactory = p0.questionAnswerFeedFactory;
    }
    if (p0.contentId !== undefined) {
      this.contentId = p0.contentId;
    }
    if (p0.repository !== undefined) {
      this.repository = p0.repository;
    }
    if (p0.linkCardMetaRepository !== undefined) {
      this.linkCardMetaRepository = p0.linkCardMetaRepository;
    }
    if (p0.openedContentStore !== undefined) {
      this.openedContentStore = p0.openedContentStore;
    }
    if (p0.historyUploader !== undefined) {
      this.historyUploader = p0.historyUploader;
    }
    if (p0.rules !== undefined) {
      this.rules = p0.rules;
    }
    if (p0.history !== undefined) {
      this.history = p0.history;
    }
    if (p0.voteRepository !== undefined) {
      this.voteRepository = p0.voteRepository;
    }
    if (p0.segmentReactionRepository !== undefined) {
      this.segmentReactionRepository = p0.segmentReactionRepository;
    }
    if (p0.followRepository !== undefined) {
      this.followRepository = p0.followRepository;
    }
    if (p0.collectionRepository !== undefined) {
      this.collectionRepository = p0.collectionRepository;
    }
    if (p0.commentRepository !== undefined) {
      this.commentRepository = p0.commentRepository;
    }
    if (p0.session !== undefined) {
      this.session = p0.session;
    }
    if (p0.navigate !== undefined) {
      this.navigate = p0.navigate;
    }
    if (p0.onBack !== undefined) {
      this.onBack = p0.onBack;
    }
  }
  updateStateVars(p0) {}
  purgeVariableDependenciesOnElmtId(p0) {}
  aboutToBeDeleted() {
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  initialRender() {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new ContentDetailPage(local_1_0, {
          "kind": ContentDetailKind.QUESTION,
          "questionAnswerFeedFactory": local_1_0.questionAnswerFeedFactory,
          "contentId": local_1_0.contentId,
          "repository": local_1_0.repository,
          "linkCardMetaRepository": local_1_0.linkCardMetaRepository,
          "openedContentStore": local_1_0.openedContentStore,
          "historyUploader": local_1_0.historyUploader,
          "rules": local_1_0.rules,
          "history": local_1_0.history,
          "voteRepository": local_1_0.voteRepository,
          "followRepository": local_1_0.followRepository,
          "collectionRepository": local_1_0.collectionRepository,
          "commentRepository": local_1_0.commentRepository,
          "session": local_1_0.session,
          "navigate": local_1_0.navigate,
          "onBack": local_1_0.onBack,
          "segmentReactionRepository": local_1_0.segmentReactionRepository
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 3372,
          "col": 5
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "kind": ContentDetailKind.QUESTION,
            "questionAnswerFeedFactory": local_1_0.questionAnswerFeedFactory,
            "contentId": local_1_0.contentId,
            "repository": local_1_0.repository,
            "linkCardMetaRepository": local_1_0.linkCardMetaRepository,
            "openedContentStore": local_1_0.openedContentStore,
            "historyUploader": local_1_0.historyUploader,
            "rules": local_1_0.rules,
            "history": local_1_0.history,
            "voteRepository": local_1_0.voteRepository,
            "followRepository": local_1_0.followRepository,
            "collectionRepository": local_1_0.collectionRepository,
            "commentRepository": local_1_0.commentRepository,
            "session": local_1_0.session,
            "navigate": local_1_0.navigate,
            "onBack": local_1_0.onBack,
            "segmentReactionRepository": local_1_0.segmentReactionRepository
          };
        };
      } else {
        local_1_0.updateStateVarsOfChildByElmtId(p0, {});
      }
    }, {
      "name": "ContentDetailPage"
    });
  }
  rerender() {
    this.updateDirtyElements();
  }
}
export class AnswerDetailPage extends ViewPU {
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
    v0.questionAnswerFeedFactory = function () {
      return undefined;
    };
    v0.contentId = "";
    v0.repository = undefined;
    v0.linkCardMetaRepository = undefined;
    v0.openedContentStore = undefined;
    v0.historyUploader = undefined;
    v0.rules = undefined;
    v0.history = undefined;
    v0.voteRepository = undefined;
    v0.segmentReactionRepository = undefined;
    v0.followRepository = undefined;
    v0.collectionRepository = undefined;
    v0.commentRepository = undefined;
    v0.session = undefined;
    v0.navigate = function (p0) {};
    v0.onBack = function () {};
    v0.setInitiallyProvidedValue(p1);
    v0.finalizeConstruction();
    return v0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.questionAnswerFeedFactory !== undefined) {
      this.questionAnswerFeedFactory = p0.questionAnswerFeedFactory;
    }
    if (p0.contentId !== undefined) {
      this.contentId = p0.contentId;
    }
    if (p0.repository !== undefined) {
      this.repository = p0.repository;
    }
    if (p0.linkCardMetaRepository !== undefined) {
      this.linkCardMetaRepository = p0.linkCardMetaRepository;
    }
    if (p0.openedContentStore !== undefined) {
      this.openedContentStore = p0.openedContentStore;
    }
    if (p0.historyUploader !== undefined) {
      this.historyUploader = p0.historyUploader;
    }
    if (p0.rules !== undefined) {
      this.rules = p0.rules;
    }
    if (p0.history !== undefined) {
      this.history = p0.history;
    }
    if (p0.voteRepository !== undefined) {
      this.voteRepository = p0.voteRepository;
    }
    if (p0.segmentReactionRepository !== undefined) {
      this.segmentReactionRepository = p0.segmentReactionRepository;
    }
    if (p0.followRepository !== undefined) {
      this.followRepository = p0.followRepository;
    }
    if (p0.collectionRepository !== undefined) {
      this.collectionRepository = p0.collectionRepository;
    }
    if (p0.commentRepository !== undefined) {
      this.commentRepository = p0.commentRepository;
    }
    if (p0.session !== undefined) {
      this.session = p0.session;
    }
    if (p0.navigate !== undefined) {
      this.navigate = p0.navigate;
    }
    if (p0.onBack !== undefined) {
      this.onBack = p0.onBack;
    }
  }
  updateStateVars(p0) {}
  purgeVariableDependenciesOnElmtId(p0) {}
  aboutToBeDeleted() {
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  initialRender() {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new ContentDetailPage(local_1_0, {
          "kind": ContentDetailKind.ANSWER,
          "questionAnswerFeedFactory": local_1_0.questionAnswerFeedFactory,
          "contentId": local_1_0.contentId,
          "repository": local_1_0.repository,
          "linkCardMetaRepository": local_1_0.linkCardMetaRepository,
          "openedContentStore": local_1_0.openedContentStore,
          "historyUploader": local_1_0.historyUploader,
          "rules": local_1_0.rules,
          "history": local_1_0.history,
          "voteRepository": local_1_0.voteRepository,
          "followRepository": local_1_0.followRepository,
          "collectionRepository": local_1_0.collectionRepository,
          "commentRepository": local_1_0.commentRepository,
          "session": local_1_0.session,
          "navigate": local_1_0.navigate,
          "onBack": local_1_0.onBack,
          "segmentReactionRepository": local_1_0.segmentReactionRepository
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 3419,
          "col": 5
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "kind": ContentDetailKind.ANSWER,
            "questionAnswerFeedFactory": local_1_0.questionAnswerFeedFactory,
            "contentId": local_1_0.contentId,
            "repository": local_1_0.repository,
            "linkCardMetaRepository": local_1_0.linkCardMetaRepository,
            "openedContentStore": local_1_0.openedContentStore,
            "historyUploader": local_1_0.historyUploader,
            "rules": local_1_0.rules,
            "history": local_1_0.history,
            "voteRepository": local_1_0.voteRepository,
            "followRepository": local_1_0.followRepository,
            "collectionRepository": local_1_0.collectionRepository,
            "commentRepository": local_1_0.commentRepository,
            "session": local_1_0.session,
            "navigate": local_1_0.navigate,
            "onBack": local_1_0.onBack,
            "segmentReactionRepository": local_1_0.segmentReactionRepository
          };
        };
      } else {
        local_1_0.updateStateVarsOfChildByElmtId(p0, {});
      }
    }, {
      "name": "ContentDetailPage"
    });
  }
  rerender() {
    this.updateDirtyElements();
  }
}
export class ArticleDetailPage extends ViewPU {
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
    v0.contentId = "";
    v0.repository = undefined;
    v0.linkCardMetaRepository = undefined;
    v0.openedContentStore = undefined;
    v0.historyUploader = undefined;
    v0.rules = undefined;
    v0.history = undefined;
    v0.voteRepository = undefined;
    v0.segmentReactionRepository = undefined;
    v0.followRepository = undefined;
    v0.collectionRepository = undefined;
    v0.commentRepository = undefined;
    v0.session = undefined;
    v0.navigate = function (p0) {};
    v0.onBack = function () {};
    v0.setInitiallyProvidedValue(p1);
    v0.finalizeConstruction();
    return v0;
  }
  setInitiallyProvidedValue(p0) {
    if (p0.contentId !== undefined) {
      this.contentId = p0.contentId;
    }
    if (p0.repository !== undefined) {
      this.repository = p0.repository;
    }
    if (p0.linkCardMetaRepository !== undefined) {
      this.linkCardMetaRepository = p0.linkCardMetaRepository;
    }
    if (p0.openedContentStore !== undefined) {
      this.openedContentStore = p0.openedContentStore;
    }
    if (p0.historyUploader !== undefined) {
      this.historyUploader = p0.historyUploader;
    }
    if (p0.rules !== undefined) {
      this.rules = p0.rules;
    }
    if (p0.history !== undefined) {
      this.history = p0.history;
    }
    if (p0.voteRepository !== undefined) {
      this.voteRepository = p0.voteRepository;
    }
    if (p0.segmentReactionRepository !== undefined) {
      this.segmentReactionRepository = p0.segmentReactionRepository;
    }
    if (p0.followRepository !== undefined) {
      this.followRepository = p0.followRepository;
    }
    if (p0.collectionRepository !== undefined) {
      this.collectionRepository = p0.collectionRepository;
    }
    if (p0.commentRepository !== undefined) {
      this.commentRepository = p0.commentRepository;
    }
    if (p0.session !== undefined) {
      this.session = p0.session;
    }
    if (p0.navigate !== undefined) {
      this.navigate = p0.navigate;
    }
    if (p0.onBack !== undefined) {
      this.onBack = p0.onBack;
    }
  }
  updateStateVars(p0) {}
  purgeVariableDependenciesOnElmtId(p0) {}
  aboutToBeDeleted() {
    SubscriberManager.Get().delete(this.id__());
    this.aboutToBeDeletedInternal();
  }
  initialRender() {
    let local_1_0 = this;
    local_1_0.observeComponentCreation2(function (p0, p1) {
      let acc;
      if (p1) {
        acc = new ContentDetailPage(local_1_0, {
          "kind": ContentDetailKind.ARTICLE,
          "contentId": local_1_0.contentId,
          "repository": local_1_0.repository,
          "linkCardMetaRepository": local_1_0.linkCardMetaRepository,
          "openedContentStore": local_1_0.openedContentStore,
          "historyUploader": local_1_0.historyUploader,
          "rules": local_1_0.rules,
          "history": local_1_0.history,
          "voteRepository": local_1_0.voteRepository,
          "followRepository": local_1_0.followRepository,
          "collectionRepository": local_1_0.collectionRepository,
          "commentRepository": local_1_0.commentRepository,
          "session": local_1_0.session,
          "navigate": local_1_0.navigate,
          "onBack": local_1_0.onBack,
          "segmentReactionRepository": local_1_0.segmentReactionRepository
        }, undefined, p0, function () {}, {
          "page": "entry/src/main/ets/pages/ContentDetailPages.ets",
          "line": 3465,
          "col": 5
        });
        ViewPU.create(acc);
        acc.paramsGenerator_ = function () {
          return {
            "kind": ContentDetailKind.ARTICLE,
            "contentId": local_1_0.contentId,
            "repository": local_1_0.repository,
            "linkCardMetaRepository": local_1_0.linkCardMetaRepository,
            "openedContentStore": local_1_0.openedContentStore,
            "historyUploader": local_1_0.historyUploader,
            "rules": local_1_0.rules,
            "history": local_1_0.history,
            "voteRepository": local_1_0.voteRepository,
            "followRepository": local_1_0.followRepository,
            "collectionRepository": local_1_0.collectionRepository,
            "commentRepository": local_1_0.commentRepository,
            "session": local_1_0.session,
            "navigate": local_1_0.navigate,
            "onBack": local_1_0.onBack,
            "segmentReactionRepository": local_1_0.segmentReactionRepository
          };
        };
      } else {
        local_1_0.updateStateVarsOfChildByElmtId(p0, {});
      }
    }, {
      "name": "ContentDetailPage"
    });
  }
  rerender() {
    this.updateDirtyElements();
  }
}
local_0_4 = 200;
local_0_3 = 300;
local_0_6 = 46;
local_0_7 = 80;
local_0_5 = 1.2;