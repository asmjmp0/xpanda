/*
* class name:Lpkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/plugin/common/BackgroundBasicMessageChannel;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import Log from "@package:pkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/util/Log";
import MessageChannelUtils from "@package:pkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/util/MessageChannelUtils";
import StringUtils from "@package:pkg_modules/.ohpm/@ohos+flutter_ohos@zl5sgaygqsqrqqtvxitwwita9ctgsvucjvbitoqeitg=/pkg_modules/@ohos/flutter_ohos/src/main/ets/util/StringUtils";
export default class BackgroundBasicMessageChannel {
  static TAG = "BackgroundBasicMessageChannel#";
  static CHANNEL_BUFFERS_CHANNEL = "dev.flutter/channel-buffers";
  constructor(p0, p1, p2, p3) {
    this.messenger = p0;
    this.name = p1;
    this.codec = p2;
    if (p3 == null) {
      p3 = p0.makeBackgroundTaskQueue();
    }
    this.taskQueue = p3;
  }
  send(p0, p1) {
    let v3 = this.codec.encodeMessage(p0);
    let v4 /*IncomingReplyHandler*/ = p1 == null ? null : new IncomingReplyHandler(p1, this.codec);
    this.messenger.send(this.name, v3, v4);
  }
  setMessageHandler(p0) {
    let v3 /*IncomingSendableMessageHandler*/ = p0 == null ? null : new IncomingSendableMessageHandler(p0, this.codec);
    this.messenger.setMessageHandler(this.name, v3, this.taskQueue);
  }
  resizeChannelBuffer(p0) {
    MessageChannelUtils.resizeChannelBuffer(this.messenger, this.name, p0);
  }
}
class IncomingReplyHandler {
  constructor(p0, p1) {
    this.callback = p0;
    this.codec = p1;
  }
  reply(p0) {
    try {
      this.callback(this.codec.decodeMessage(p0));
    } catch (catchAcc) {
      Log.e(BackgroundBasicMessageChannel.TAG, "Failed to handle message reply", catchAcc);
    }
  }
}
@Sendable
class IncomingSendableMessageHandler {
  handler;
  codec;
  constructor(p0, p1) {
    this.handler = p0;
    this.codec = p1;
  }
  onMessage(p0, p1) {
    let local_1_1 = this;
    let local_1_0 = p1;
    try {
      local_1_1.handler.onMessage(local_1_1.codec.decodeMessage(p0), {
        "reply": function (p0) {
          local_1_0.reply(local_1_1.codec.encodeMessage(p0));
        }
      });
    } catch (catchAcc) {
      Log.e("WARNNING", "Failed to handle message: ", catchAcc);
      local_1_0.reply(StringUtils.stringToArrayBuffer(""));
    }
  }
}