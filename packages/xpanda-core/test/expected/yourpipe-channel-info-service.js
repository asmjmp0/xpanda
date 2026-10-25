/*
* class name:L&entry/src/main/ets/features/user/ChannelInfoService&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { ContentCountry } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { Localization } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { fetchBrowsePage } from "@normalized:N&&&youtube_core/Index&1.0.0";
import i18n from "@ohos:i18n";
let ChannelDetails, ChannelInfoService, ChannelProfile;
let local_0_0;
ChannelDetails = class panda_jmp0_reserved_anonymous_0 {
  constructor(p0, p1) {
    let v3, v4;
    v3 = p0 === undefined ? "" : p0;
    v4 = p1 === undefined ? "" : p1;
    this.description = v3;
    this.bannerUrl = v4;
  }
};
ChannelProfile = class panda_jmp0_reserved_anonymous_1 {
  constructor(p0, p1, p2, p3, p4, p5, p6) {
    let v3, v4, v5, v6, v7, v8, v9;
    v3 = p0 === undefined ? "" : p0;
    v4 = p1 === undefined ? "" : p1;
    v5 = p2 === undefined ? "" : p2;
    v6 = p3 === undefined ? "" : p3;
    v7 = p4 === undefined ? "" : p4;
    v8 = p5 === undefined ? "" : p5;
    v9 = p6 === undefined ? "" : p6;
    this.name = v3;
    this.description = v4;
    this.bannerUrl = v5;
    this.avatarUrl = v6;
    this.subscriberText = v7;
    this.videoCountText = v8;
    this.handle = v9;
  }
};
local_0_0 = class panda_jmp0_reserved_anonymous_2 {
  constructor(p0, p1) {
    this.localization = p0;
    this.contentCountry = p1;
  }
};
ChannelInfoService = class panda_jmp0_reserved_anonymous_3 {
  constructor() {
    this.VIDEOS_TAB_PARAMS = "EgZ2aWRlb3PyBgQKAjoA";
  }
  async fetchChannelDetails(p0) {
    let v7, v11, v12;
    v11 = (p0 || "").trim();
    if (!v11) {
      return new ChannelDetails();
    }
    v7 = this.resolveLocale();
    v12 = await fetchBrowsePage(v7.localization, v7.contentCountry, v11, this.VIDEOS_TAB_PARAMS);
    return v12 ? new ChannelDetails(this.extractDescription(v12), this.extractBannerUrl(v12)) : new ChannelDetails();
  }
  async fetchChannelProfile(p0) {
    let v7, v9, v11, v15, v17;
    v15 = (p0 || "").trim();
    if (!v15) {
      return new ChannelProfile();
    }
    v9 = this.resolveLocale();
    v17 = await fetchBrowsePage(v9.localization, v9.contentCountry, v15, this.VIDEOS_TAB_PARAMS);
    if (!v17) {
      return new ChannelProfile();
    }
    v11 = this.extractChannelName(v17);
    v7 = this.extractDescription(v17);
    return new ChannelProfile(v11, v7, this.extractBannerUrl(v17), this.extractAvatarUrl(v17), this.extractSubscriberText(v17), this.extractVideoCountText(v17), this.extractHandle(v17));
  }
  resolveLocale() {
    return new local_0_0 /*LocaleContext*/(new Localization(i18n.System.getSystemLanguage() || Localization.DEFAULT.getLanguageCode(), "GB"), new ContentCountry("GB"));
  }
  extractDescription(p0) {
    let v5, v8, v9;
    v9 = this.asRecord(p0.metadata);
    v5 = this.asString(this.asRecord(v9?.channelMetadataRenderer)?.description);
    if (v5) {
      return v5;
    }
    v8 = this.asRecord(this.asRecord(p0.header)?.interactiveTabbedHeaderRenderer);
    return (v8 ? this.readText(v8.description) : "") || "";
  }
  extractBannerUrl(p0) {
    let v5, v8, v9, v12, v16, v17, v18, acc;
    v5 = this.asRecord(p0.header);
    if (!v5) {
      return "";
    }
    v9 = this.asRecord(v5.pageHeaderRenderer);
    acc = this.asRecord(v9?.content)?.pageHeaderViewModel;
    acc = this.asRecord(acc)?.banner;
    acc = this.asRecord(acc)?.imageBannerViewModel;
    acc = this.asRecord(acc)?.image;
    acc = this.asRecord(acc)?.sources;
    v8 = this.pickLargestImageUrl(this.asArray(acc));
    if (v8) {
      return this.normalizeUrl(v8);
    }
    v12 = ["c4TabbedHeaderRenderer", "interactiveTabbedHeaderRenderer", "carouselHeaderRenderer"];
    for (v16 = 0; v16 < v12.length; v16 += 1) {
      v18 = this.asRecord(v5[v12[v16]]);
      v17 = this.pickLargestImageUrl(this.asArray(this.asRecord(v18?.banner)?.thumbnails));
      if (v17) {
        return this.normalizeUrl(v17);
      }
    }
    return "";
  }
  extractChannelName(p0) {
    let v4, v8, v9;
    v8 = this.asRecord(p0.metadata);
    v9 = this.asString(this.asRecord(v8?.channelMetadataRenderer)?.title);
    if (v9) {
      return v9;
    }
    v4 = this.asRecord(this.asRecord(p0.header)?.c4TabbedHeaderRenderer);
    return (v4 ? this.readText(v4.title) : "") || "";
  }
  extractHandle(p0) {
    let v4, v7, v9, acc;
    v9 = this.asRecord(p0.metadata);
    v7 = this.handleFromVanityUrl(this.asString(this.asRecord(v9?.channelMetadataRenderer)?.vanityChannelUrl));
    if (v7) {
      return v7;
    }
    v4 = this.asRecord(this.asRecord(p0.header)?.c4TabbedHeaderRenderer);
    acc = v4 ? this.readText(v4.vanityChannelUrl) : "";
    return this.handleFromVanityUrl(acc);
  }
  handleFromVanityUrl(p0) {
    let v4, acc;
    acc = p0 || "";
    v4 = acc.indexOf("@");
    return v4 >= 0 ? p0.substring(v4) : "";
  }
  extractAvatarUrl(p0) {
    let v4, v5, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, acc;
    v4 = this.asRecord(p0.header);
    if (v4) {
      v7 = this.asRecord(v4.c4TabbedHeaderRenderer);
      if (v7) {
        acc = this.asRecord(v7.avatar)?.thumbnails;
        v13 = this.pickLargestImageUrl(this.asArray(acc));
        if (v13) {
          return this.normalizeUrl(v13);
        }
      }
      v9 = this.asRecord(v4.interactiveTabbedHeaderRenderer);
      if (v9) {
        acc = this.asRecord(v9.boxArt)?.thumbnails;
        v13 = this.pickLargestImageUrl(this.asArray(acc));
        if (v13) {
          return this.normalizeUrl(v13);
        }
      }
      v8 = this.asRecord(v4.carouselHeaderRenderer);
      if (v8 && (v11 = this.asArray(v8.contents)) && v11.length > 0 && (acc = this.asRecord(v11[0]), v12 = acc) && (v13 = this.asRecord(v12.topicChannelDetailsRenderer), acc)) {
        v16 = this.pickLargestImageUrl(this.asArray(this.asRecord(v13.avatar)?.thumbnails));
        if (v16) {
          return this.normalizeUrl(v16);
        }
      }
      v10 = this.asRecord(v4.pageHeaderRenderer);
      if (v10) {
        v12 = this.asRecord(this.asRecord(v10.content)?.pageHeaderViewModel);
        if (v12) {
          v13 = this.asRecord(v12.avatar);
          if (v13) {
            v17 = this.pickLargestImageUrl(this.asArray(this.asRecord(v13.image)?.sources));
            if (v17) {
              return this.normalizeUrl(v17);
            }
          }
          v14 = this.asRecord(v12.image);
          if (v14 && (v15 = this.asRecord(v14.contentPreviewImageViewModel), !v14)) {
            v18 = this.pickLargestImageUrl(this.asArray(this.asRecord(v15.image)?.sources));
            if (v18) {
              return this.normalizeUrl(v18);
            }
          }
        }
      }
    }
    v10 = "metadata";
    v5 = this.asRecord(p0.metadata);
    return v5 && (v7 = this.asRecord(v5.channelMetadataRenderer)) && (v8 = this.asRecord(v7.avatar)) && (v10 = this.pickLargestImageUrl(this.asArray(v8.thumbnails))) ? this.normalizeUrl(v10) : "";
  }
  extractSubscriberText(p0) {
    let v4, v6, v7, v8, v9, v10, v11, v12, v13, v14, v16, acc;
    v4 = this.asRecord(p0.header);
    if (v4) {
      v7 = ["c4TabbedHeaderRenderer", "interactiveTabbedHeaderRenderer", "carouselHeaderRenderer"];
      for (v9 = 0; v9 < v7.length; v9 += 1) {
        v10 = this.asRecord(v4[v7[v9]]);
        if (v10) {
          v11 = this.asRecord(v10.subscriberCountText);
          acc = v11 ? this.readContent(v11) : "";
          if (acc) {
            return acc;
          }
          v12 = this.asRecord(v10.subtitle);
          if (v12) {
            acc = this.readContent(v12);
          } else {
            acc = "";
          }
          v13 = acc;
          acc = !acc;
          if (!acc) {
            return v13;
          }
        }
      }
      v6 = this.asRecord(v4.pageHeaderRenderer);
      if (v6) {
        v8 = this.readHeaderMetadataParts(v6);
        for (v14 of v8) {
          v16 = v14;
          if (v14.content.toLowerCase().includes("subscriber")) return v16.content;
        }
        for (v14 of v8) {
          v16 = v14;
          if (!v14.hasLabel) {
            continue;
          }
          if (!v14.content.startsWith("@")) return v16.content;
        }
      }
    }
    return "";
  }
  extractVideoCountText(p0) {
    let v4, v6, v7, v8, v9, v10, v11, v12, v16, v18, acc;
    v4 = this.asRecord(p0.header);
    if (v4) {
      v7 = ["c4TabbedHeaderRenderer"];
      for (v9 = 0; v9 < v7.length; v9 += 1) {
        v10 = this.asRecord(v4[v7[v9]]);
        if (v10) {
          v12 = this.asRecord(v10.videoCountText);
          v11 = v12 ? this.readContent(v12) : "";
          if (v11) {
            return v11;
          }
        }
      }
      v6 = this.asRecord(v4.pageHeaderRenderer);
      if (v6) {
        v9 = this.readHeaderMetadataParts(v6);
        for (v16 of v9) {
          v18 = v16;
          if (v16.content.toLowerCase().includes("video")) return v18.content;
        }
        v8 = v9.filter(function (p0) {
          return p0.content.length <= 0 ? p0.content.length > 0 : !p0.content.startsWith("@");
        });
        acc = v8.filter(function (p0) {
          return !p0.hasLabel;
        });
        if (acc.length > 0) {
          return acc[0].content;
        }
        if (v8.length > 1) {
          return v8[1].content;
        }
      }
    }
    return "";
  }
  readHeaderMetadataParts(p0) {
    let v6, v7, v9, v12, v13, v16, v17, v18, acc;
    v9 = [];
    v7 = this.asRecord(p0.content);
    acc = this.asRecord(v7?.pageHeaderViewModel)?.metadata;
    acc = this.asRecord(acc)?.contentMetadataViewModel;
    acc = this.asRecord(acc)?.metadataRows;
    v6 = this.asArray(acc);
    if (!v6) {
      return [];
    }
    for (v12 = 0; v12 < v6.length; v12 += 1) {
      v13 = this.asArray(this.asRecord(v6[v12])?.metadataParts);
      acc = !!v13;
      if (acc) {
        for (v16 = 0; v16 < v13.length; v16 += 1) {
          v18 = this.asRecord(v13[v16]);
          v17 = this.asString(this.asRecord(v18?.text)?.content);
          if (v17) {
            v9.push({
              "content": v17,
              "hasLabel": !!v18?.accessibilityLabel
            });
          }
        }
      }
    }
    return v9;
  }
  pickLargestImageUrl(p0) {
    let v4, v5, v8, v9, v11, v12, v13, acc;
    if (!p0 || p0.length === 0) {
      return "";
    }
    v5 = "";
    v4 = -1;
    for (v8 = 0; v8 < p0.length; v8 += 1) {
      v11 = this.asRecord(p0[v8]);
      v12 = this.normalizeUrl(this.asString(v11?.url));
      if (v12) {
        v13 = this.asNumber(v11?.width);
        acc = this.asNumber(v11?.height);
        v9 = v13 > 0 && acc > 0 ? v13 * acc : v13 > 0 ? v13 * 1000 : acc > 0 ? acc * 1000 : v8;
        if (v9 >= v4) {
          v4 = v9;
          v5 = v12;
        }
      }
    }
    return v5;
  }
  normalizeUrl(p0) {
    let v4;
    v4 = (p0 || "").trim();
    if (!v4) {
      return "";
    }
    if (v4.startsWith("//")) {
      return "https:" + v4 + "";
    }
    return v4;
  }
  readText(p0) {
    let v4;
    v4 = this.asRecord(p0);
    return v4 ? this.asString(v4.content) : "";
  }
  readContent(p0) {
    let v4;
    if (!p0) {
      return "";
    }
    v4 = this.asString(p0.content);
    return v4 || this.readText(p0);
  }
  asRecord(p0) {
    return !p0 || typeof p0 !== "object" ? null : p0;
  }
  asArray(p0) {
    return Array.isArray(p0) ? p0 : null;
  }
  asString(p0) {
    return typeof p0 === "string" ? p0 : "";
  }
  asNumber(p0) {
    return typeof p0 === "number" ? p0 : -1;
  }
};
export { ChannelDetails };
export { ChannelInfoService };
export { ChannelProfile };