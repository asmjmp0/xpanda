/*
* class name:L&core/src/main/ets/navigation/DeepLinkResolver&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { isSafeDecimalContentId } from "@normalized:N&&&core/src/main/ets/navigation/AppDestination&1.0.0";
import { isSafeSearchDestinationQuery } from "@normalized:N&&&core/src/main/ets/navigation/AppDestination&1.0.0";
import { parseAbsoluteUrl } from "@normalized:N&&&core/src/main/ets/navigation/AbsoluteUrlParser&1.0.0";
let DeepLinkType, MAX_DEEP_LINK_INPUT_LENGTH, describeDeepLink, extractZhihuLinkFromText, resolveZhihuLink;
let local_0_0;
describeDeepLink = function (p0) {
  switch (p0.type) {
    case DeepLinkType.ANSWER:
      return "回答：" + p0.id + "";
    case DeepLinkType.QUESTION:
      return "问题：" + p0.id + "";
    case DeepLinkType.ARTICLE:
      return "文章：" + p0.id + "";
    case DeepLinkType.PERSON:
      return "用户：" + p0.id + "";
    case DeepLinkType.VIDEO:
      return "视频：" + p0.id + "";
    case DeepLinkType.PIN:
      return "想法：" + p0.id + "";
    case DeepLinkType.SEARCH:
      return "搜索：" + p0.query + "";
    case DeepLinkType.MAIN_TABS:
      return "首页";
    default:
      return;
  }
};
extractZhihuLinkFromText = function (p0) {
  let v1, v2;
  if (p0.length === 0) {
    return undefined;
  } else {
    v1 = new RegExp("https?:\\/\\/[-a-zA-Z0-9@:%_+.~#?&/=]*", "g");
    for (v2 = v1.exec(p0); v2 !== null; v2 = v1.exec(p0)) {
      v2 = resolveZhihuLink(v2[0]);
      if (v2 !== undefined) {
        return v2;
      }
    }
    return undefined;
  }
};
resolveZhihuLink = function (p0) {
  let v1, v2;
  v1 = 8192;
  if (p0.length === 0 || p0.length > 8192) {
    return undefined;
  } else {
    v2 = p0.trim();
    return v2.length === 0 || v2.length > v1 ? undefined : local_0_0(v2, 0);
  }
};
local_0_0 = function (p0, p1) {
  let v0 /*isSafeDecimalContentId*/, v1 /*isSafeDecimalContentId*/, v2 /*parseAbsoluteUrl*/, v4 /*isSafeDecimalContentId*/, v5, v6;
  v1 = 2;
  if (p0.length === 0 || p0.length > 8192 || p1 > 2) {
    return undefined;
  } else {
    v2 = parseAbsoluteUrl(p0);
    if (v2 === undefined) {
      return undefined;
    } else {
      v4 = v2.protocol.toLowerCase();
      v5 = v2.hostname.toLowerCase();
      v6 = v2.pathname.split("/").filter(function (p0) {
        return p0.length > 0;
      });
      if (v4 !== "http:" && v4 !== "https:") {
        if (v4 !== "zhihu:") {
          return undefined;
        } else if (v5 === "feed" && v6.length === 0) {
          return {
            "type": DeepLinkType.MAIN_TABS,
            "id": "",
            "query": ""
          };
        } else if (v5 === "search" && v6.length === 0) {
          v0 = v2.params.get("q");
          if (v0 == null) {
            v0 = "";
          }
          return isSafeSearchDestinationQuery(v0) ? {
            "type": DeepLinkType.SEARCH,
            "id": "",
            "query": v0
          } : undefined;
        } else if (v6.length !== 1) {
          return undefined;
        } else if (!isSafeDecimalContentId(v6[0])) {
          return undefined;
        } else if (v5 === "answers") {
          return {
            "type": DeepLinkType.ANSWER,
            "id": v6[0],
            "query": ""
          };
        } else if (v5 === "questions") {
          return {
            "type": DeepLinkType.QUESTION,
            "id": v6[0],
            "query": ""
          };
        } else if (v5 === "articles") {
          return {
            "type": DeepLinkType.ARTICLE,
            "id": v6[0],
            "query": ""
          };
        } else if (v5 === "pin") {
          return {
            "type": DeepLinkType.PIN,
            "id": v6[0],
            "query": ""
          };
        } else {
          return undefined;
        }
      } else if (v2.hasUserInfo || v2.port.length > 0) {
        return undefined;
      } else if (v5 === "link.zhihu.com") {
        v0 = v2.params.get("target");
        return v0 === undefined ? undefined : local_0_0(v0, p1 + 1);
      } else if (v5 !== "zhuanlan.zhihu.com") {
        if (v5 !== "zhihu.com" && v5 !== "www.zhihu.com") {
          return undefined;
        } else if (v6.length === 4 && v6[0] === "question" && isSafeDecimalContentId(v6[1]) && v6[v1] === "answer" && isSafeDecimalContentId(v6[3])) {
          return {
            "type": DeepLinkType.ANSWER,
            "id": v6[3],
            "query": ""
          };
        } else if (v6.length === v1 && v6[0] === "answer" && isSafeDecimalContentId(v6[1])) {
          return {
            "type": DeepLinkType.ANSWER,
            "id": v6[1],
            "query": ""
          };
        } else if (v6.length === v1 && v6[0] === "question" && isSafeDecimalContentId(v6[1])) {
          return {
            "type": DeepLinkType.QUESTION,
            "id": v6[1],
            "query": ""
          };
        } else if (v6.length === 3 && v6[0] === "oia" && v6[1] === "articles" && isSafeDecimalContentId(v6[v1])) {
          return {
            "type": DeepLinkType.ARTICLE,
            "id": v6[v1],
            "query": ""
          };
        } else if (v6.length === v1 && v6[0] === "people" && v6[1].length > 0) {
          return {
            "type": DeepLinkType.PERSON,
            "id": v6[1],
            "query": ""
          };
        } else if (v6.length === v1 && v6[0] === "video" && isSafeDecimalContentId(v6[1])) {
          return {
            "type": DeepLinkType.VIDEO,
            "id": v6[1],
            "query": ""
          };
        } else if (v6.length === v1 && v6[0] === "pin" && isSafeDecimalContentId(v6[1])) {
          return {
            "type": DeepLinkType.PIN,
            "id": v6[1],
            "query": ""
          };
        } else if (v6.length === 3 && v6[0] === "appview" && isSafeDecimalContentId(v6[v1])) {
          if (v6[1] === "pin") {
            return {
              "type": DeepLinkType.PIN,
              "id": v6[v1],
              "query": ""
            };
          } else if (v6[1] === "answer") {
            return {
              "type": DeepLinkType.ANSWER,
              "id": v6[v1],
              "query": ""
            };
          } else if (v6[1] === "p") {
            return {
              "type": DeepLinkType.ARTICLE,
              "id": v6[v1],
              "query": ""
            };
          } else {
            return undefined;
          }
        } else if (v6.length === 1 && v6[0] === "search") {
          v0 = v2.params.get("q");
          if (v0 == null) {
            v0 = "";
          }
          return isSafeSearchDestinationQuery(v0) ? {
            "type": DeepLinkType.SEARCH,
            "id": "",
            "query": v0
          } : undefined;
        } else {
          return undefined;
        }
      } else if (v6.length === v1 && v6[0] === "p" && isSafeDecimalContentId(v6[1])) {
        return {
          "type": DeepLinkType.ARTICLE,
          "id": v6[1],
          "query": ""
        };
      } else {
        return undefined;
      }
    }
  }
};
DeepLinkType = {
  ANSWER: "answer",
  QUESTION: "question",
  ARTICLE: "article",
  PERSON: "person",
  VIDEO: "video",
  PIN: "pin",
  SEARCH: "search",
  MAIN_TABS: "main_tabs"
};
MAX_DEEP_LINK_INPUT_LENGTH = 8192;
export { DeepLinkType };
export { MAX_DEEP_LINK_INPUT_LENGTH };
export { describeDeepLink };
export { extractZhihuLinkFromText };
export { resolveZhihuLink };