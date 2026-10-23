/*
* class name:L&entry/src/main/ets/platform/ShareContracts&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let MAX_SHARE_SUMMARY_LENGTH, MAX_SHARE_TITLE_LENGTH, MAX_SHARE_URL_LENGTH, SHARE_PANEL_GRACE_MILLIS, SHARE_TEMPORARY_DIRECTORY, SHARE_TEMPORARY_MAX_AGE_MILLIS, ShareDispatchKind, ShareFailure, ShareFailureKind, ShareImageSourceKind, ShareOutcome, SharePayloadKind, createTemporaryShareLifecycle, markSharePanelOpened, prepareSharePayload, shouldCleanupTemporaryShareFile, toShareFailure;
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_9, local_0_10, local_0_11, local_0_12, local_0_13, local_0_14;
createTemporaryShareLifecycle = function (p0) {
  if (!local_0_7(p0.createdAtMillis)) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return {
      "path": p0.path,
      "createdAtMillis": p0.createdAtMillis,
      "cleanupAfterMillis": p0.createdAtMillis + SHARE_TEMPORARY_MAX_AGE_MILLIS
    };
  }
};
local_0_12 = function (p0) {
  return local_0_11(p0) || p0 === "text/plain" || p0 === "application/pdf";
};
local_0_11 = function (p0) {
  return p0 === "image/jpeg" || p0 === "image/png" || p0 === "image/webp" || p0 === "image/gif";
};
local_0_7 = function (p0) {
  return Number.isFinite(p0) && p0 >= 0 && Math.floor(p0) === p0;
};
local_0_14 = function (p0, p1) {
  let v0, v1;
  v0 = p0.length === 0 || p0.length > 2048 || new RegExp("[\\r\\n\\t ]").test(p0) || p0.includes("@");
  if (v0 || p0.includes("\\")) {
    return false;
  } else {
    v1 = new RegExp("^https:\\/\\/([^/?#:]+)(?::[0-9]+)?\\/").exec(p0);
    return v1 !== null && v1[1] !== undefined && p1.test(v1[1]) && !p0.includes("..");
  }
};
local_0_10 = function (p0) {
  return new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$").test(p0) && !p0.includes("..");
};
local_0_13 = function (p0, p1) {
  let v0;
  v0 = p0.length === 0;
  if (p0.length !== 0) {
    v0 = p0.length > p1;
  }
  if (v0 || (v0 = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]"), v0.test.call(v0, p0))) {
    return false;
  } else {
    return !new RegExp("<\\/?[A-Za-z][^>]*>").test(p0)
      && !new RegExp("(?:cookie|set-cookie|authorization)\\s*:", "i").test(p0)
      && !new RegExp("(?:cookie|authorization)=", "i").test(p0);
  }
};
markSharePanelOpened = function (p0, p1) {
  let acc;
  acc = !local_0_7(p1);
  if (acc || p1 < p0.createdAtMillis) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return {
      "path": p0.path,
      "createdAtMillis": p0.createdAtMillis,
      "panelOpenedAtMillis": p1,
      "cleanupAfterMillis": Math.min(p1 + SHARE_PANEL_GRACE_MILLIS, p0.createdAtMillis + SHARE_TEMPORARY_MAX_AGE_MILLIS)
    };
  }
};
local_0_9 = function (p0) {
  let v0 /*ShareFailure*/, acc;
  v0 = p0.replace(new RegExp("\\\\", "g"), "/").replace(new RegExp("\\/+$", "g"), "");
  acc = !new RegExp("^\\/[A-Za-z0-9._/-]+$").test(v0);
  if (acc || v0.includes("..")) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return v0;
  }
};
local_0_2 = function (p0) {
  let v0 /*ShareFailure*/;
  v0 = p0.trim();
  if (!local_0_13(v0, MAX_SHARE_SUMMARY_LENGTH)) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return v0;
  }
};
local_0_8 = function (p0, p1, p2) {
  let v0 /*ShareFailure*/;
  v0 = !local_0_7(p0.createdAtMillis) || p0.createdAtMillis > p1.nowMillis;
  if (v0 || p1.nowMillis - p0.createdAtMillis > SHARE_TEMPORARY_MAX_AGE_MILLIS) {
    throw new ShareFailure(ShareFailureKind.FILE_UNAVAILABLE);
  } else {
    v0 = local_0_9(p1.cacheDir) + "/" + SHARE_TEMPORARY_DIRECTORY + "/";
    if (p0.path.startsWith(v0)) {
      v0 = p0.path.substring(v0.length);
      if (!local_0_10(v0)) {
        throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
      } else if (p2 ? !local_0_11(p0.mimeType) : !local_0_12(p0.mimeType)) {
        throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
      } else {
        return p0;
      }
    } else {
      throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
    }
  }
};
local_0_1 = function (p0) {
  let v0 /*ShareFailure*/;
  v0 = p0.trim();
  if (!local_0_13(v0, MAX_SHARE_TITLE_LENGTH)) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return v0;
  }
};
local_0_3 = function (p0) {
  if (!local_0_14(p0, new RegExp("^(?:www\\.zhihu\\.com|zhuanlan\\.zhihu\\.com)$"))) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else if (!new RegExp("^https:\\/\\/(?:www\\.zhihu\\.com\\/(?:question\\/[1-9][0-9]{0,29}(?:\\/answer\\/[1-9][0-9]{0,29})?|answer\\/[1-9][0-9]{0,29}|pin\\/[1-9][0-9]{0,29}|people\\/[A-Za-z0-9-]{1,100}|zvideo\\/[1-9][0-9]{0,29})|zhuanlan\\.zhihu\\.com\\/p\\/[1-9][0-9]{0,29})(?:[?#][A-Za-z0-9%&=._~!$'()*+,;:@/?-]*)?$").test(p0)) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return p0;
  }
};
local_0_4 = function (p0) {
  if (!local_0_14(p0, new RegExp("^(?:pic|pica|picx|pic[0-9]+)\\.zhimg\\.com$"))) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else if (!new RegExp("^https:\\/\\/(?:pic|pica|picx|pic[0-9]+)\\.zhimg\\.com\\/[A-Za-z0-9%&=._~!$'()*+,;:@/?-]+$").test(p0)) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return p0;
  }
};
local_0_6 = function (p0, p1, p2, p3) {
  let v0;
  v0 = local_0_8(p0.temporaryFile, p1, false);
  return {
    "kind": SharePayloadKind.FILE,
    "dispatchKind": ShareDispatchKind.TEMPORARY_FILE,
    "title": p2,
    "summary": p3,
    "mimeType": v0.mimeType,
    "source": v0.path
  };
};
local_0_5 = function (p0, p1, p2, p3) {
  let v0 /*ShareFailure*/;
  if (p0.sourceKind !== ShareImageSourceKind.TRUSTED_URL) {
    if (p0.trustedImageUrl !== undefined || p0.temporaryFile === undefined) {
      throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
    } else {
      v0 = local_0_8(p0.temporaryFile, p1, true);
      return {
        "kind": SharePayloadKind.IMAGE,
        "dispatchKind": ShareDispatchKind.TEMPORARY_FILE,
        "title": p2,
        "summary": p3,
        "mimeType": v0.mimeType,
        "source": v0.path
      };
    }
  } else if (p0.temporaryFile !== undefined || p0.trustedImageUrl === undefined) {
    throw new ShareFailure(ShareFailureKind.INVALID_PAYLOAD);
  } else {
    return {
      "kind": SharePayloadKind.IMAGE,
      "dispatchKind": ShareDispatchKind.REMOTE_IMAGE_LINK,
      "title": p2,
      "summary": p3,
      "mimeType": "text/plain",
      "source": local_0_4(p0.trustedImageUrl)
    };
  }
};
prepareSharePayload = function (p0, p1) {
  let v0, v1, v2, v3, v4;
  v0 = local_0_1(p0.title);
  v1 = local_0_2(p0.summary);
  switch (p0.kind) {
    case SharePayloadKind.TEXT:
      v2 = local_0_3(p0.contentUrl);
      v3 = p0.thumbnailUrl === undefined ? undefined : local_0_4(p0.thumbnailUrl);
      v4 = {
        "kind": SharePayloadKind.TEXT,
        "dispatchKind": ShareDispatchKind.TEXT_LINK,
        "title": v0,
        "summary": v1,
        "mimeType": "text/plain",
        "source": v2
      };
      if (v3 !== undefined) {
        v0 = {
          "kind": v4.kind,
          "dispatchKind": v4.dispatchKind,
          "title": v4.title,
          "summary": v4.summary,
          "mimeType": v4.mimeType,
          "source": v4.source,
          "thumbnailUrl": v3
        };
        v4 = v0;
      }
      return v4;
    case SharePayloadKind.IMAGE:
      return local_0_5(p0, p1, v0, v1);
    default:
      return local_0_6(p0, p1, v0, v1);
  }
};
local_0_0 = function (p0) {
  switch (p0) {
    case ShareFailureKind.NO_HANDLER:
      return "没有可用的分享应用";
    case ShareFailureKind.FILE_UNAVAILABLE:
      return "分享文件已不可用";
    case ShareFailureKind.PERMISSION_DENIED:
      return "分享权限不足";
    case ShareFailureKind.CANCELLED:
      return "已取消分享";
    case ShareFailureKind.INVALID_PAYLOAD:
      return "分享内容不受支持";
    default:
      return "暂时无法打开分享面板";
  }
};
shouldCleanupTemporaryShareFile = function (p0, p1) {
  return local_0_7(p1) && p1 >= p0.cleanupAfterMillis;
};
toShareFailure = function (p0) {
  let v0 /*ShareFailure*/;
  if (p0 instanceof ShareFailure) {
    return p0;
  } else {
    v0 = p0.message.toLowerCase();
    if (v0.includes("cancel")) {
      return new ShareFailure(ShareFailureKind.CANCELLED);
    } else if (v0.includes("permission") || v0.includes("denied")) {
      return new ShareFailure(ShareFailureKind.PERMISSION_DENIED);
    } else if (v0.includes("not found") || v0.includes("no handler") || v0.includes("ability")) {
      return new ShareFailure(ShareFailureKind.NO_HANDLER);
    } else if (v0.includes("file") || v0.includes("uri")) {
      return new ShareFailure(ShareFailureKind.FILE_UNAVAILABLE);
    } else {
      return new ShareFailure(ShareFailureKind.TEMPORARY_FAILURE);
    }
  }
};
MAX_SHARE_TITLE_LENGTH = 120;
MAX_SHARE_SUMMARY_LENGTH = 1000;
MAX_SHARE_URL_LENGTH = 2048;
SHARE_TEMPORARY_DIRECTORY = "share";
SHARE_PANEL_GRACE_MILLIS = 30 * 60 * 1000;
SHARE_TEMPORARY_MAX_AGE_MILLIS = 24 * 60 * 60 * 1000;
SharePayloadKind = {
  TEXT: "text",
  IMAGE: "image",
  FILE: "file"
};
ShareImageSourceKind = {
  TRUSTED_URL: "trusted_url",
  TEMPORARY_FILE: "temporary_file"
};
ShareDispatchKind = {
  TEXT_LINK: "text_link",
  REMOTE_IMAGE_LINK: "remote_image_link",
  TEMPORARY_FILE: "temporary_file"
};
ShareFailureKind = {
  INVALID_PAYLOAD: "invalid_payload",
  NO_HANDLER: "no_handler",
  FILE_UNAVAILABLE: "file_unavailable",
  PERMISSION_DENIED: "permission_denied",
  CANCELLED: "cancelled",
  TEMPORARY_FAILURE: "temporary_failure"
};
ShareOutcome = {
  OPENED: "opened",
  CANCELLED: "cancelled"
};
ShareFailure = class panda_jmp0_reserved_anonymous_0 extends Error {
  constructor(p0) {
    let v0;
    v0 = super(local_0_0(p0));
    v0.name = "ShareFailure";
    v0.kind = p0;
    return v0;
  }
};
export { MAX_SHARE_SUMMARY_LENGTH };
export { MAX_SHARE_TITLE_LENGTH };
export { MAX_SHARE_URL_LENGTH };
export { SHARE_PANEL_GRACE_MILLIS };
export { SHARE_TEMPORARY_DIRECTORY };
export { SHARE_TEMPORARY_MAX_AGE_MILLIS };
export { ShareDispatchKind };
export { ShareFailure };
export { ShareFailureKind };
export { ShareImageSourceKind };
export { ShareOutcome };
export { SharePayloadKind };
export { createTemporaryShareLifecycle };
export { markSharePanelOpened };
export { prepareSharePayload };
export { shouldCleanupTemporaryShareFile };
export { toShareFailure };