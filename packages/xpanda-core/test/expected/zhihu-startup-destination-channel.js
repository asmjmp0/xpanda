/*
* class name:L&core/src/main/ets/navigation/StartupDestinationChannel&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AppDestinationName } from "@normalized:N&&&core/src/main/ets/navigation/AppDestination&1.0.0";
import { DeepLinkType } from "@normalized:N&&&core/src/main/ets/navigation/DeepLinkResolver&1.0.0";
import { decodeAppDestination } from "@normalized:N&&&core/src/main/ets/navigation/AppDestination&1.0.0";
let appDestinationIdentity, findAppDestinationStackIndex, shouldPushAppDestination, startupDestinationChannel, toAppDestination;
appDestinationIdentity = function (p0) {
  switch (p0.name) {
    case AppDestinationName.QUESTION:
    case AppDestinationName.ANSWER:
    case AppDestinationName.ARTICLE:
    case AppDestinationName.VIDEO:
    case AppDestinationName.PIN:
    case AppDestinationName.PEOPLE:
    case AppDestinationName.COLLECTION:
    case AppDestinationName.COLLECTIONS:
      return "" + p0.name + ":" + encodeURIComponent(p0.id) + "";
    case AppDestinationName.WRITE_ANSWER:
      return "" + p0.name + ":" + encodeURIComponent(p0.questionId) + ":" + encodeURIComponent(p0.answerId ?? "");
    case AppDestinationName.WRITE_PIN:
      return "" + p0.name + ":" + encodeURIComponent(p0.draftId) + "";
    case AppDestinationName.COMMENT:
      return "" + p0.name + ":" + p0.contentType + ":" + encodeURIComponent(p0.contentId) + ":" + encodeURIComponent(p0.commentId ?? "") + ":" + encodeURIComponent(p0.segmentId ?? "");
    case AppDestinationName.SEARCH:
      return "" + p0.name + ":" + encodeURIComponent(p0.query) + "";
    case AppDestinationName.WHATS_NEW:
      return "" + p0.name + ":" + encodeURIComponent(p0.version ?? "") + "";
    default:
      return p0.name;
  }
};
findAppDestinationStackIndex = function (p0, p1) {
  let v1, v2, v3 /*decodeAppDestination*/;
  v1 = 0;
  for (v2 = appDestinationIdentity(p1); v1 < p0.length; v1 += 1) {
    v3 = p0[v1].param === undefined ? decodeAppDestination(p0[v1].name, new Object()) : decodeAppDestination(p0[v1].name, p0[v1].param);
    if (v3 !== undefined && appDestinationIdentity(v3) === v2) {
      return v1;
    }
  }
  return -1;
};
shouldPushAppDestination = function (p0, p1) {
  let v0;
  v0 = p0 === undefined;
  if (p0 !== undefined) {
    v0 = appDestinationIdentity(p0) !== appDestinationIdentity(p1);
  }
  return v0;
};
toAppDestination = function (p0) {
  switch (p0.type) {
    case DeepLinkType.MAIN_TABS:
      return {
        "name": AppDestinationName.HOME
      };
    case DeepLinkType.ANSWER:
      return {
        "name": AppDestinationName.ANSWER,
        "id": p0.id
      };
    case DeepLinkType.QUESTION:
      return {
        "name": AppDestinationName.QUESTION,
        "id": p0.id
      };
    case DeepLinkType.ARTICLE:
      return {
        "name": AppDestinationName.ARTICLE,
        "id": p0.id
      };
    case DeepLinkType.VIDEO:
      return {
        "name": AppDestinationName.VIDEO,
        "id": p0.id
      };
    case DeepLinkType.PIN:
      return {
        "name": AppDestinationName.PIN,
        "id": p0.id
      };
    case DeepLinkType.PERSON:
      return {
        "name": AppDestinationName.PEOPLE,
        "id": p0.id
      };
    case DeepLinkType.SEARCH:
      return {
        "name": AppDestinationName.SEARCH,
        "query": p0.query
      };
    default:
      return;
  }
};
class LatestOperationGuard {
  constructor() {
    this.generation = 0;
  }
  next() {
    this.generation = this.generation + 1;
    return this.generation;
  }
  invalidate() {
    this.generation = this.generation + 1;
  }
  isCurrent(p0) {
    return p0 === this.generation;
  }
}
class StartupDestinationChannel {
  constructor() {
    this.listeners = [];
    this.pending = undefined;
    this.activeIdentity = undefined;
  }
  publish(p0) {
    let v0;
    let local_0_0;
    local_0_0 = p0;
    if (this.listeners.length === 0) {
      this.pending = local_0_0;
      return;
    }
    v0 = appDestinationIdentity(local_0_0);
    if (v0 === this.activeIdentity) {
      return;
    }
    this.activeIdentity = v0;
    this.listeners.slice().forEach(function (p0) {
      return p0(local_0_0);
    });
    return;
  }
  subscribe(p0) {
    let v0;
    let local_0_0, local_0_1;
    local_0_1 = this;
    local_0_0 = p0;
    local_0_1.listeners.push(local_0_0);
    v0 = local_0_1.pending;
    local_0_1.pending = undefined;
    if (v0 !== undefined) {
      local_0_1.activeIdentity = appDestinationIdentity(v0);
      local_0_0(v0);
    }
    return function () {
      let v1;
      v1 = local_0_1.listeners.indexOf(local_0_0);
      if (v1 >= 0) {
        local_0_1.listeners.splice(v1, 1);
      }
      if (local_0_1.listeners.length === 0) {
        local_0_1.activeIdentity = undefined;
      }
    };
  }
}
startupDestinationChannel = new StartupDestinationChannel();
export { LatestOperationGuard };
export { StartupDestinationChannel };
export { appDestinationIdentity };
export { findAppDestinationStackIndex };
export { shouldPushAppDestination };
export { startupDestinationChannel };
export { toAppDestination };