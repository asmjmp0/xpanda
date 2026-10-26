/*
* class name:L&core/src/main/ets/navigation/AppDestination&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { JsonNumberValue } from "@normalized:N&&&core/src/main/ets/navigation/StrictJson&1.0.0";
import { JsonObjectValue } from "@normalized:N&&&core/src/main/ets/navigation/StrictJson&1.0.0";
import { JsonStringValue } from "@normalized:N&&&core/src/main/ets/navigation/StrictJson&1.0.0";
import { parseStrictJson } from "@normalized:N&&&core/src/main/ets/navigation/StrictJson&1.0.0";
let AppDestinationName, LOCAL_DRAFT_ID_LENGTH, MAX_DECIMAL_CONTENT_ID_LENGTH, MAX_PEOPLE_IDENTIFIER_LENGTH, MAX_SEARCH_QUERY_LENGTH, decodeAppDestination, isAppDestinationName, isInfrastructureDestination, isSafeDecimalContentId, isSafeLocalDraftId, isSafePeopleIdentifier, isSafePinContentId, isSafeSearchDestinationQuery, isSafeWhatsNewVersion, shouldReloadAfterAuthentication;
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_9, local_0_10, local_0_11, local_0_12, local_0_13, local_0_14, local_0_15, local_0_16;
decodeAppDestination = function (p0, p1) {
  let v0 /*parseStrictJson*/, v1 /*JsonObjectValue*/, v2, v3, v4, v5, v6, v7, v8, v10;
  if (!isAppDestinationName(p0)) {
    return undefined;
  }
  v0 = parseStrictJson(JSON.stringify(p1));
  if (!(v0 instanceof JsonObjectValue)) {
    return undefined;
  }
  if (local_0_0(v0, "name") !== p0) {
    return undefined;
  }
  switch (p0) {
    case AppDestinationName.HOME:
      return local_0_1(v0) ? {
        "name": AppDestinationName.HOME
      } : undefined;
    case AppDestinationName.FOLLOWING:
      return local_0_1(v0) ? {
        "name": AppDestinationName.FOLLOWING
      } : undefined;
    case AppDestinationName.HOT:
      return local_0_1(v0) ? {
        "name": AppDestinationName.HOT
      } : undefined;
    case AppDestinationName.DAILY:
      return local_0_1(v0) ? {
        "name": AppDestinationName.DAILY
      } : undefined;
    case AppDestinationName.DAILY_STORY:
      return local_0_2(v0, AppDestinationName.DAILY_STORY);
    case AppDestinationName.NOTIFICATION:
      return local_0_1(v0) ? {
        "name": AppDestinationName.NOTIFICATION
      } : undefined;
    case AppDestinationName.NOTIFICATION_ENTRY:
      return local_0_3(v0);
    case AppDestinationName.PRIVATE_MESSAGE:
      return local_0_4(v0);
    case AppDestinationName.NOTIFICATION_SETTINGS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.NOTIFICATION_SETTINGS
      } : undefined;
    case AppDestinationName.APPEARANCE_SETTINGS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.APPEARANCE_SETTINGS
      } : undefined;
    case AppDestinationName.THEME_COLOR_SETTINGS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.THEME_COLOR_SETTINGS
      } : undefined;
    case AppDestinationName.IDENTITY_MANAGEMENT:
      return local_0_1(v0) ? {
        "name": AppDestinationName.IDENTITY_MANAGEMENT
      } : undefined;
    case AppDestinationName.READING_SETTINGS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.READING_SETTINGS
      } : undefined;
    case AppDestinationName.SYSTEM_UPDATE_SETTINGS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.SYSTEM_UPDATE_SETTINGS
      } : undefined;
    case AppDestinationName.WHATS_NEW:
      return local_0_5(v0);
    case AppDestinationName.RECOMMENDATION_FILTER_SETTINGS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.RECOMMENDATION_FILTER_SETTINGS
      } : undefined;
    case AppDestinationName.LOGIN:
      return local_0_1(v0) ? {
        "name": AppDestinationName.LOGIN
      } : undefined;
    case AppDestinationName.SETTINGS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.SETTINGS
      } : undefined;
    case AppDestinationName.BLOCKING_RULES:
      return local_0_1(v0) ? {
        "name": AppDestinationName.BLOCKING_RULES
      } : undefined;
    case AppDestinationName.BLOCKED_FEED_HISTORY:
      return local_0_1(v0) ? {
        "name": AppDestinationName.BLOCKED_FEED_HISTORY
      } : undefined;
    case AppDestinationName.READ_HISTORY:
      return local_0_1(v0) ? {
        "name": AppDestinationName.READ_HISTORY
      } : undefined;
    case AppDestinationName.LOCAL_HISTORY:
      return local_0_1(v0) ? {
        "name": AppDestinationName.LOCAL_HISTORY
      } : undefined;
    case AppDestinationName.TECHNICAL_LAB:
      return local_0_1(v0) ? {
        "name": AppDestinationName.TECHNICAL_LAB
      } : undefined;
    case AppDestinationName.READER_PROBE:
      return local_0_1(v0) ? {
        "name": AppDestinationName.READER_PROBE
      } : undefined;
    case AppDestinationName.IMAGE_PROBE:
      return local_0_1(v0) ? {
        "name": AppDestinationName.IMAGE_PROBE
      } : undefined;
    case AppDestinationName.DATABASE_PROBE:
      return local_0_1(v0) ? {
        "name": AppDestinationName.DATABASE_PROBE
      } : undefined;
    case AppDestinationName.DEEP_LINK_PROBE:
      return local_0_1(v0) ? {
        "name": AppDestinationName.DEEP_LINK_PROBE
      } : undefined;
    case AppDestinationName.QR_SCAN_PROBE:
      return local_0_1(v0) ? {
        "name": AppDestinationName.QR_SCAN_PROBE
      } : undefined;
    case AppDestinationName.QR_DESKTOP_LOGIN_SCAN:
      return local_0_1(v0) ? {
        "name": AppDestinationName.QR_DESKTOP_LOGIN_SCAN
      } : undefined;
    case AppDestinationName.BACKGROUND_TASK_PROBE:
      return local_0_1(v0) ? {
        "name": AppDestinationName.BACKGROUND_TASK_PROBE
      } : undefined;
    case AppDestinationName.DOMAIN_FIXTURE_PROBE:
      return local_0_1(v0) ? {
        "name": AppDestinationName.DOMAIN_FIXTURE_PROBE
      } : undefined;
    case AppDestinationName.PIN_DRAFTS:
      return local_0_1(v0) ? {
        "name": AppDestinationName.PIN_DRAFTS
      } : undefined;
    case AppDestinationName.QUESTION:
      return local_0_2(v0, AppDestinationName.QUESTION);
    case AppDestinationName.ANSWER:
      return local_0_2(v0, AppDestinationName.ANSWER);
    case AppDestinationName.ARTICLE:
      return local_0_2(v0, AppDestinationName.ARTICLE);
    case AppDestinationName.VIDEO:
      return local_0_2(v0, AppDestinationName.VIDEO);
    case AppDestinationName.PIN:
      return local_0_2(v0, AppDestinationName.PIN);
    case AppDestinationName.PEOPLE:
      return local_0_2(v0, AppDestinationName.PEOPLE);
    case AppDestinationName.COLLECTION:
      return local_0_2(v0, AppDestinationName.COLLECTION);
    case AppDestinationName.COLLECTIONS:
      return local_0_2(v0, AppDestinationName.COLLECTIONS);
    case AppDestinationName.WRITE_ANSWER:
      return local_0_6(v0);
    case AppDestinationName.WRITE_PIN:
      return local_0_7(v0);
    case AppDestinationName.COMMENT:
      v1 = local_0_0(v0, "contentType");
      v2 = local_0_0(v0, "contentId");
      v3 = local_0_0(v0, "commentId");
      v4 = local_0_0(v0, "segmentId");
      v5 = local_0_0(v0, "segmentContent");
      v6 = local_0_0(v0, "segmentParagraphId");
      v7 = local_0_8(v0, "segmentStartOffset");
      v8 = local_0_8(v0, "segmentEndOffset");
      v10 = v1 !== "answer" && v1 !== "article" && v1 !== "question" && v1 !== "pin" || v2 === undefined;
      if ((v1 === "answer" || v1 === "article" || v1 === "question" || v1 === "pin") && v2 !== undefined) {
        v10 = !local_0_9(v2);
      }
      if (!v10) {
        v10 = local_0_0(v0, "id") !== undefined;
      }
      if (!v10) {
        v10 = local_0_0(v0, "query") !== undefined;
      }
      if (!v10 && (v10 = v3 !== undefined, v3 !== undefined)) {
        v10 = !local_0_9(v3);
      }
      if (!v10) {
        if (v4 !== undefined || v5 !== undefined || v6 !== undefined || v7 !== undefined || v8 !== undefined) {
          v10 = v4 === undefined;
          if (v4 !== undefined) {
            v10 = !local_0_10(v4);
          }
          if (!v10) {
            v10 = v5 === undefined;
          }
          if (!v10) {
            v10 = !local_0_9(v5);
          }
          if (!v10) {
            v10 = v6 === undefined;
          }
          if (!v10) {
            v10 = !local_0_9(v6);
          }
          if (!v10) {
            v10 = v7 === undefined;
          }
          if (!v10) {
            v10 = v8 === undefined;
          }
          if (!v10) {
            v10 = v8 < v7;
          }
        } else {
          v10 = v4 !== undefined || v5 !== undefined || v6 !== undefined || v7 !== undefined || v8 !== undefined;
        }
      }
      if (!v10) {
        if (!local_0_11(v0, ["name", "contentType", "contentId", "commentId", "segmentId", "segmentContent", "segmentParagraphId", "segmentStartOffset", "segmentEndOffset"])) {
          return undefined;
        }
        if (v4 !== undefined || v5 !== undefined || v6 !== undefined || v7 !== undefined || v8 !== undefined) {
          return {
            "name": AppDestinationName.COMMENT,
            "contentType": v1,
            "contentId": v2,
            "segmentId": v4,
            "segmentContent": v5,
            "segmentParagraphId": v6,
            "segmentStartOffset": v7,
            "segmentEndOffset": v8
          };
        }
        return v3 === undefined ? {
          "name": AppDestinationName.COMMENT,
          "contentType": v1,
          "contentId": v2
        } : {
          "name": AppDestinationName.COMMENT,
          "contentType": v1,
          "contentId": v2,
          "commentId": v3
        };
      }
      return undefined;
    case AppDestinationName.SEARCH:
      v1 = local_0_0(v0, "query");
      v2 = v1 === undefined;
      if (v1 !== undefined) {
        v2 = !isSafeSearchDestinationQuery(v1);
      }
      if (!v2) {
        v2 = local_0_0(v0, "id") !== undefined;
      }
      if (!v2) {
        v2 = local_0_0(v0, "contentId") !== undefined;
      }
      if (!v2) {
        v2 = local_0_0(v0, "commentId") !== undefined;
      }
      if (!v2) {
        return local_0_11(v0, ["name", "query"]) ? {
          "name": AppDestinationName.SEARCH,
          "query": v1
        } : undefined;
      }
      return undefined;
    default:
      return undefined;
  }
};
local_0_2 = function (p0, p1) {
  let v0 = local_0_0(p0, "id");
  let v1 = v0 === undefined;
  if (v0 !== undefined) {
    v1 = !local_0_9(v0);
  }
  if (!v1) {
    v1 = local_0_0(p0, "contentId") !== undefined;
  }
  if (!v1) {
    v1 = local_0_0(p0, "commentId") !== undefined;
  }
  if (!v1) {
    v1 = local_0_0(p0, "query") !== undefined;
  }
  if (!v1) {
    if (!local_0_11(p0, ["name", "id"])) {
      return undefined;
    }
    v1 = true;
    switch (p1) {
      case AppDestinationName.PIN:
      case AppDestinationName.DAILY_STORY:
        v1 = isSafePinContentId(v0);
        break;
      case AppDestinationName.PEOPLE:
      case AppDestinationName.COLLECTIONS:
        v1 = isSafePeopleIdentifier(v0);
        break;
      case AppDestinationName.QUESTION:
      case AppDestinationName.ANSWER:
      case AppDestinationName.ARTICLE:
      case AppDestinationName.COLLECTION:
        v1 = isSafeDecimalContentId(v0);
        break;
    }
    return v1 ? {
      "name": p1,
      "id": v0
    } : undefined;
  }
  return undefined;
};
local_0_3 = function (p0) {
  let v0 = local_0_0(p0, "entryName");
  let v1 = local_0_0(p0, "title");
  if (local_0_12(v0) && local_0_13(v1)) {
    return local_0_11(p0, ["name", "entryName", "title"]) ? {
      "name": AppDestinationName.NOTIFICATION_ENTRY,
      "entryName": v0,
      "title": v1
    } : undefined;
  }
  return undefined;
};
local_0_4 = function (p0) {
  let v0 = local_0_0(p0, "peerId");
  let v1 = local_0_0(p0, "peerName");
  let v2 = local_0_0(p0, "avatarUrl");
  let v3 = !local_0_14(v0);
  if (!v3 && (v3 = v1 !== undefined, v1 !== undefined)) {
    v3 = !local_0_15(v1);
  }
  if (!v3 && (v3 = v2 !== undefined, v2 !== undefined)) {
    v3 = !local_0_16(v2);
  }
  if (!v3) {
    return local_0_11(p0, ["name", "peerId", "peerName", "avatarUrl"]) ? {
      "name": AppDestinationName.PRIVATE_MESSAGE,
      "peerId": v0,
      "peerName": v1,
      "avatarUrl": v2
    } : undefined;
  }
  return undefined;
};
local_0_5 = function (p0) {
  let v0 = local_0_0(p0, "version");
  if (v0 === undefined || isSafeWhatsNewVersion(v0)) {
    if (!local_0_11(p0, v0 === undefined ? ["name"] : ["name", "version"])) {
      return undefined;
    }
    return v0 === undefined ? {
      "name": AppDestinationName.WHATS_NEW
    } : {
      "name": AppDestinationName.WHATS_NEW,
      "version": v0
    };
  }
  return undefined;
};
local_0_6 = function (p0) {
  let v0 = local_0_0(p0, "questionId");
  let v1 = local_0_0(p0, "answerId");
  let v2 = v0 === undefined;
  if (v0 !== undefined) {
    v2 = !isSafeDecimalContentId(v0);
  }
  if (!v2 && (v2 = v1 !== undefined, v1 !== undefined)) {
    v2 = !isSafeDecimalContentId(v1);
  }
  if (!v2) {
    if (!local_0_11(p0, ["name", "questionId", "answerId"])) {
      return undefined;
    }
    return v1 === undefined ? {
      "name": AppDestinationName.WRITE_ANSWER,
      "questionId": v0
    } : {
      "name": AppDestinationName.WRITE_ANSWER,
      "questionId": v0,
      "answerId": v1
    };
  }
  return undefined;
};
local_0_7 = function (p0) {
  let v0 = local_0_0(p0, "draftId");
  let v1 = v0 === undefined;
  if (v0 !== undefined) {
    v1 = !isSafeLocalDraftId(v0);
  }
  if (!v1) {
    return local_0_11(p0, ["name", "draftId"]) ? {
      "name": AppDestinationName.WRITE_PIN,
      "draftId": v0
    } : undefined;
  }
  return undefined;
};
local_0_1 = function (p0) {
  return local_0_0(p0, "id") === undefined
    && local_0_0(p0, "contentId") === undefined
    && local_0_0(p0, "commentId") === undefined
    && local_0_0(p0, "query") === undefined
    && local_0_0(p0, "questionId") === undefined
    && local_0_0(p0, "answerId") === undefined
    && local_0_0(p0, "draftId") === undefined
    && local_0_11(p0, ["name"]);
};
local_0_11 = function (p0, p1) {
  let local_1_0 = p1;
  return p0.entries.every(function (p0) {
    return local_1_0.includes(p0.name);
  });
};
local_0_9 = function (p0) {
  return typeof p0 === "string" && p0.trim().length > 0;
};
isAppDestinationName = function (p0) {
  return p0 === AppDestinationName.HOME
    || p0 === AppDestinationName.FOLLOWING
    || p0 === AppDestinationName.HOT
    || p0 === AppDestinationName.DAILY
    || p0 === AppDestinationName.DAILY_STORY
    || p0 === AppDestinationName.QUESTION
    || p0 === AppDestinationName.ANSWER
    || p0 === AppDestinationName.ARTICLE
    || p0 === AppDestinationName.VIDEO
    || p0 === AppDestinationName.PIN
    || p0 === AppDestinationName.PEOPLE
    || p0 === AppDestinationName.COMMENT
    || p0 === AppDestinationName.SEARCH
    || p0 === AppDestinationName.COLLECTION
    || p0 === AppDestinationName.COLLECTIONS
    || p0 === AppDestinationName.NOTIFICATION
    || p0 === AppDestinationName.NOTIFICATION_ENTRY
    || p0 === AppDestinationName.NOTIFICATION_SETTINGS
    || p0 === AppDestinationName.PRIVATE_MESSAGE
    || p0 === AppDestinationName.LOGIN
    || p0 === AppDestinationName.SETTINGS
    || p0 === AppDestinationName.APPEARANCE_SETTINGS
    || p0 === AppDestinationName.THEME_COLOR_SETTINGS
    || p0 === AppDestinationName.IDENTITY_MANAGEMENT
    || p0 === AppDestinationName.READING_SETTINGS
    || p0 === AppDestinationName.SYSTEM_UPDATE_SETTINGS
    || p0 === AppDestinationName.WHATS_NEW
    || p0 === AppDestinationName.RECOMMENDATION_FILTER_SETTINGS
    || p0 === AppDestinationName.BLOCKING_RULES
    || p0 === AppDestinationName.BLOCKED_FEED_HISTORY
    || p0 === AppDestinationName.READ_HISTORY
    || p0 === AppDestinationName.LOCAL_HISTORY
    || p0 === AppDestinationName.TECHNICAL_LAB
    || p0 === AppDestinationName.READER_PROBE
    || p0 === AppDestinationName.IMAGE_PROBE
    || p0 === AppDestinationName.DATABASE_PROBE
    || p0 === AppDestinationName.DEEP_LINK_PROBE
    || p0 === AppDestinationName.QR_SCAN_PROBE
    || p0 === AppDestinationName.QR_DESKTOP_LOGIN_SCAN
    || p0 === AppDestinationName.BACKGROUND_TASK_PROBE
    || p0 === AppDestinationName.DOMAIN_FIXTURE_PROBE
    || p0 === AppDestinationName.WRITE_ANSWER
    || p0 === AppDestinationName.WRITE_PIN
    || p0 === AppDestinationName.PIN_DRAFTS;
};
isInfrastructureDestination = function (p0) {
  return p0.name === AppDestinationName.LOGIN
    || p0.name === AppDestinationName.SETTINGS
    || p0.name === AppDestinationName.APPEARANCE_SETTINGS
    || p0.name === AppDestinationName.THEME_COLOR_SETTINGS
    || p0.name === AppDestinationName.IDENTITY_MANAGEMENT
    || p0.name === AppDestinationName.READING_SETTINGS
    || p0.name === AppDestinationName.SYSTEM_UPDATE_SETTINGS
    || p0.name === AppDestinationName.WHATS_NEW
    || p0.name === AppDestinationName.RECOMMENDATION_FILTER_SETTINGS
    || p0.name === AppDestinationName.BLOCKING_RULES
    || p0.name === AppDestinationName.BLOCKED_FEED_HISTORY
    || p0.name === AppDestinationName.READ_HISTORY
    || p0.name === AppDestinationName.LOCAL_HISTORY
    || p0.name === AppDestinationName.TECHNICAL_LAB
    || p0.name === AppDestinationName.NOTIFICATION_SETTINGS
    || p0.name === AppDestinationName.NOTIFICATION_ENTRY
    || p0.name === AppDestinationName.PRIVATE_MESSAGE
    || p0.name === AppDestinationName.READER_PROBE
    || p0.name === AppDestinationName.IMAGE_PROBE
    || p0.name === AppDestinationName.DATABASE_PROBE
    || p0.name === AppDestinationName.DEEP_LINK_PROBE
    || p0.name === AppDestinationName.QR_SCAN_PROBE
    || p0.name === AppDestinationName.QR_DESKTOP_LOGIN_SCAN
    || p0.name === AppDestinationName.BACKGROUND_TASK_PROBE
    || p0.name === AppDestinationName.DOMAIN_FIXTURE_PROBE
    || p0.name === AppDestinationName.PIN_DRAFTS;
};
isSafeDecimalContentId = function (p0) {
  return typeof p0 === "string" && new RegExp("^\\d{1,30}$").test(p0);
};
isSafeLocalDraftId = function (p0) {
  return typeof p0 === "string"
    && p0.length === 36
    && new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").test(p0);
};
local_0_12 = function (p0) {
  return typeof p0 === "string" && new RegExp("^[a-z_]{1,40}$").test(p0);
};
local_0_13 = function (p0) {
  return typeof p0 === "string"
    && p0.trim().length > 0
    && p0.length <= 60
    && !new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]").test(p0);
};
isSafePeopleIdentifier = function (p0) {
  return typeof p0 === "string" && new RegExp("^[A-Za-z0-9_-]{1,200}$").test(p0);
};
isSafePinContentId = function (p0) {
  return typeof p0 === "string" && new RegExp("^[1-9][0-9]{0,29}$").test(p0);
};
local_0_16 = function (p0) {
  return typeof p0 === "string"
    && p0.length > 0
    && p0.length <= 500
    && new RegExp("^https:\\/\\/[A-Za-z0-9.-]+(?::\\d{2,5})?\\/[A-Za-z0-9._~/%-]*(\\?[A-Za-z0-9._~&=%-]*)?$").test(p0);
};
local_0_14 = function (p0) {
  return typeof p0 === "string" && new RegExp("^[A-Za-z0-9_-]{1,128}$").test(p0);
};
local_0_15 = function (p0) {
  return typeof p0 === "string"
    && p0.trim().length > 0
    && p0.length <= 60
    && !new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]").test(p0);
};
isSafeSearchDestinationQuery = function (p0) {
  return typeof p0 === "string" && p0.length <= 200 && !new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]").test(p0);
};
local_0_10 = function (p0) {
  return new RegExp("^[1-9][0-9]{0,29}(,[1-9][0-9]{0,29})*$").test(p0);
};
isSafeWhatsNewVersion = function (p0) {
  return typeof p0 === "string" && new RegExp("^\\d{1,4}(\\.\\d{1,4}){0,3}$").test(p0);
};
local_0_8 = function (p0, p1) {
  let v0 = p0.get(p1);
  return v0 instanceof JsonNumberValue && Number.isSafeInteger(v0.value) && v0.value >= 0 ? v0.value : undefined;
};
local_0_0 = function (p0, p1) {
  let v0 = p0.get(p1);
  return v0 instanceof JsonStringValue ? v0.value : undefined;
};
shouldReloadAfterAuthentication = function (p0) {
  return p0.name === AppDestinationName.QUESTION
    || p0.name === AppDestinationName.ANSWER
    || p0.name === AppDestinationName.ARTICLE
    || p0.name === AppDestinationName.SEARCH
    || p0.name === AppDestinationName.FOLLOWING
    || p0.name === AppDestinationName.HOT
    || p0.name === AppDestinationName.PIN
    || p0.name === AppDestinationName.PEOPLE
    || p0.name === AppDestinationName.READ_HISTORY
    || p0.name === AppDestinationName.COLLECTION
    || p0.name === AppDestinationName.COLLECTIONS
    || p0.name === AppDestinationName.NOTIFICATION
    || p0.name === AppDestinationName.NOTIFICATION_ENTRY
    || p0.name === AppDestinationName.PRIVATE_MESSAGE
    || p0.name === AppDestinationName.WRITE_ANSWER
    || p0.name === AppDestinationName.WRITE_PIN
    || p0.name === AppDestinationName.PIN_DRAFTS;
};
AppDestinationName = {
  HOME: "Home",
  FOLLOWING: "Following",
  HOT: "Hot",
  DAILY: "Daily",
  DAILY_STORY: "DailyStory",
  QUESTION: "Question",
  ANSWER: "Answer",
  ARTICLE: "Article",
  VIDEO: "Video",
  PIN: "Pin",
  PEOPLE: "People",
  COMMENT: "Comment",
  SEARCH: "Search",
  COLLECTION: "Collection",
  COLLECTIONS: "Collections",
  NOTIFICATION: "Notification",
  NOTIFICATION_ENTRY: "NotificationEntry",
  NOTIFICATION_SETTINGS: "NotificationSettings",
  PRIVATE_MESSAGE: "PrivateMessage",
  LOGIN: "Login",
  SETTINGS: "Settings",
  APPEARANCE_SETTINGS: "AppearanceSettings",
  THEME_COLOR_SETTINGS: "ThemeColorSettings",
  IDENTITY_MANAGEMENT: "IdentityManagement",
  READING_SETTINGS: "ReadingSettings",
  SYSTEM_UPDATE_SETTINGS: "SystemUpdateSettings",
  WHATS_NEW: "WhatsNew",
  RECOMMENDATION_FILTER_SETTINGS: "RecommendationFilterSettings",
  BLOCKING_RULES: "BlockingRules",
  BLOCKED_FEED_HISTORY: "BlockedFeedHistory",
  READ_HISTORY: "ReadHistory",
  LOCAL_HISTORY: "LocalHistory",
  TECHNICAL_LAB: "TechnicalLab",
  READER_PROBE: "ReaderProbe",
  IMAGE_PROBE: "ImageProbe",
  DATABASE_PROBE: "DatabaseProbe",
  DEEP_LINK_PROBE: "DeepLinkProbe",
  QR_SCAN_PROBE: "QrScanProbe",
  QR_DESKTOP_LOGIN_SCAN: "QrDesktopLoginScan",
  BACKGROUND_TASK_PROBE: "BackgroundTaskProbe",
  DOMAIN_FIXTURE_PROBE: "DomainFixtureProbe",
  WRITE_ANSWER: "WriteAnswer",
  WRITE_PIN: "WritePin",
  PIN_DRAFTS: "PinDrafts"
};
MAX_SEARCH_QUERY_LENGTH = 200;
MAX_DECIMAL_CONTENT_ID_LENGTH = 30;
MAX_PEOPLE_IDENTIFIER_LENGTH = 200;
LOCAL_DRAFT_ID_LENGTH = 36;
export { AppDestinationName };
export { LOCAL_DRAFT_ID_LENGTH };
export { MAX_DECIMAL_CONTENT_ID_LENGTH };
export { MAX_PEOPLE_IDENTIFIER_LENGTH };
export { MAX_SEARCH_QUERY_LENGTH };
export { decodeAppDestination };
export { isAppDestinationName };
export { isInfrastructureDestination };
export { isSafeDecimalContentId };
export { isSafeLocalDraftId };
export { isSafePeopleIdentifier };
export { isSafePinContentId };
export { isSafeSearchDestinationQuery };
export { isSafeWhatsNewVersion };
export { shouldReloadAfterAuthentication };