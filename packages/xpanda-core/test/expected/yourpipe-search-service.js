/*
* class name:L&entry/src/main/ets/features/home/SearchService&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { MusicSearchService } from "@normalized:N&&&entry/src/main/ets/features/home/MusicSearchService&";
import { SearchChannelItem } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { SearchPlaylistItem } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { SearchStreamItem } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { ThumbnailPlaceholder } from "@normalized:N&&&entry/src/main/ets/common/ThumbnailPlaceholder&";
import { VideoItem } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { buildVideoItemFromReelRenderer } from "@normalized:N&&&entry/src/main/ets/features/home/utils/VideoItemBuilder&";
import { buildVideoItemFromRenderer } from "@normalized:N&&&entry/src/main/ets/features/home/utils/VideoItemBuilder&";
import { buildVideoItemFromShortsLockupViewModel } from "@normalized:N&&&entry/src/main/ets/features/home/utils/VideoItemBuilder&";
import { fetchSearchContinuation } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { fetchSearchPage } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { getContinuationToken } from "@normalized:N&&&entry/src/main/ets/features/home/utils/ContinuationUtils&";
import { getLockupChannelId } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupDurationText } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupPlaylistCoverUrl } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupPlaylistId } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupPublishedTimeText } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupTitle } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupUploaderName } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupUploaderVerified } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupVideoId } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupVideoThumbnailUrl } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupViewCount } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getLockupViewCountExact } from "@normalized:N&&&entry/src/main/ets/features/home/utils/LockupViewModelParser&";
import { getTextFromRuns } from "@normalized:N&&&entry/src/main/ets/features/home/utils/TextUtils&";
import { getThumbnailUrlFromThumbnailObject } from "@normalized:N&&&entry/src/main/ets/features/home/utils/ThumbnailUtils&";
import { pickBestThumbUrl } from "@normalized:N&&&entry/src/main/ets/features/home/utils/ThumbnailUtils&";
export class SearchService {
  constructor(p0, p1) {
    this.currentFilters = [];
    this.videoItemIdCursor = 0;
    this.localization = p0;
    this.contentCountry = p1;
  }
  setFilters(p0) {
    this.currentFilters = p0 ?? [];
  }
  async fetchInitial(p0, p1) {
    let v7;
    let v6 = (p0 || "").trim();
    if (!v6) {
      return {
        "items": [],
        "nextPageToken": null
      };
    }
    v7 = await fetchSearchPage(this.localization, this.contentCountry, v6, [], "");
    if (!v7) {
      throw new Error("Empty search response");
    }
    return this.parseVideoInitialResponse(v7, p1);
  }
  async fetchNext(p0, p1) {
    let v7;
    let v6 = (p0 || "").trim();
    if (!v6) {
      return {
        "items": [],
        "nextPageToken": null
      };
    }
    v7 = await fetchSearchContinuation(this.localization, this.contentCountry, v6);
    if (!v7) {
      throw new Error("Empty continuation response");
    }
    return this.parseVideoContinuationResponse(v7, p1);
  }
  async searchInitial(p0, p1) {
    let v8;
    let v7 = (p0 || "").trim();
    if (!v7) {
      return {
        "items": [],
        "nextPageToken": null
      };
    }
    v8 = await fetchSearchPage(this.localization, this.contentCountry, v7, this.currentFilters, "");
    if (!v8) {
      throw new Error("Empty search response");
    }
    if (MusicSearchService.isMusicSearch(this.currentFilters)) {
      return MusicSearchService.parseInitialMusicSearchResponse(v8, p1, this.currentFilters);
    }
    return this.parseMixedInitialResponse(v8, p1);
  }
  async searchNext(p0, p1) {
    let v8;
    let v7 = (p0 || "").trim();
    if (!v7) {
      return {
        "items": [],
        "nextPageToken": null
      };
    }
    v8 = await fetchSearchContinuation(this.localization, this.contentCountry, v7, this.currentFilters);
    if (!v8) {
      throw new Error("Empty continuation response");
    }
    if (MusicSearchService.isMusicSearch(this.currentFilters)) {
      return MusicSearchService.parseMusicSearchContinuationResponse(v8, p1, this.currentFilters);
    }
    return this.parseMixedContinuationResponse(v8, p1);
  }
  parseVideoInitialResponse(p0, p1) {
    let acc;
    let local_0_3 = this;
    let local_0_0 = p1;
    let local_0_1 = [];
    let local_0_2 = null;
    acc = p0.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (acc) {
      acc.forEach(function (p0) {
        let v6, v7;
        let v5 = p0.itemSectionRenderer?.contents;
        if (v5 && v5.length > 0) {
          local_0_1 = local_0_1 /*items*/.concat(local_0_3.buildVideoItemsFromContents(v5, local_0_0 + local_0_1 /*items*/.length));
        }
        v7 = local_0_3.getContinuationTokenFromSection(p0);
        v6 = local_0_3.getContinuationTokenFromContents(v5);
        local_0_2 = v7 || v6 || local_0_2 /*nextPageToken*/;
      });
    }
    return {
      "items": local_0_1 /*items*/,
      "nextPageToken": local_0_2 /*nextPageToken*/
    };
  }
  parseVideoContinuationResponse(p0, p1) {
    let local_0_3 = this;
    let local_0_0 = p1;
    let local_0_1 = [];
    let local_0_2 = null;
    if (p0.onResponseReceivedCommands) {
      p0.onResponseReceivedCommands.forEach(function (p0) {
        let v5 = p0.appendContinuationItemsAction?.continuationItems;
        if (!v5) {
          return;
        }
        v5.forEach(function (p0) {
          let v6 = p0.itemSectionRenderer?.contents;
          if (v6 && v6.length > 0) {
            local_0_1 = local_0_1 /*items*/.concat(local_0_3.buildVideoItemsFromContents(v6, local_0_0 + local_0_1 /*items*/.length));
          }
          if (p0.continuationItemRenderer) {
            local_0_2 = getContinuationToken(p0.continuationItemRenderer) ?? local_0_2 /*nextPageToken*/;
          }
        });
        return;
      });
    }
    return {
      "items": local_0_1 /*items*/,
      "nextPageToken": local_0_2 /*nextPageToken*/
    };
  }
  parseMixedInitialResponse(p0, p1) {
    let acc;
    let local_0_3 = this;
    let local_0_0 = p1;
    let local_0_1 = [];
    let local_0_2 = null;
    acc = p0.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (acc) {
      acc.forEach(function (p0) {
        let v8;
        let v5 = p0.itemSectionRenderer?.contents;
        if (v5 && v5.length > 0) {
          v8 = local_0_3.buildSearchItemsFromContents(v5, local_0_0 + local_0_1 /*items*/.length);
          local_0_1 = local_0_1 /*items*/.concat(v8.items);
          local_0_2 = v8.nextPageToken ?? local_0_2 /*nextPageToken*/;
        }
        local_0_2 = local_0_3.getContinuationTokenFromSection(p0) ?? local_0_2 /*nextPageToken*/;
      });
    }
    return {
      "items": local_0_1 /*items*/,
      "nextPageToken": local_0_2 /*nextPageToken*/
    };
  }
  parseMixedContinuationResponse(p0, p1) {
    let local_0_3 = this;
    let local_0_0 = p1;
    let local_0_1 = [];
    let local_0_2 = null;
    if (p0.onResponseReceivedCommands && p0.onResponseReceivedCommands.length > 0) {
      p0.onResponseReceivedCommands.forEach(function (p0) {
        let v5 = p0.appendContinuationItemsAction?.continuationItems;
        if (!v5) {
          return;
        }
        v5.forEach(function (p0) {
          let v6 = p0.itemSectionRenderer?.contents;
          if (v6 && v6.length > 0) {
            local_0_1 = local_0_1 /*items*/.concat(local_0_3.buildSearchItemsFromContents(v6, local_0_0 + local_0_1 /*items*/.length).items);
          }
          if (p0.continuationItemRenderer) {
            local_0_2 = getContinuationToken(p0.continuationItemRenderer) ?? local_0_2 /*nextPageToken*/;
          }
        });
        return;
      });
    }
    return {
      "items": local_0_1 /*items*/,
      "nextPageToken": local_0_2 /*nextPageToken*/
    };
  }
  buildVideoItemsFromContents(p0, p1) {
    let v5 = [];
    p0.forEach(function (p0) {
      let acc;
      if (p0.backgroundPromoRenderer) {
        acc = getTextFromRuns(p0.backgroundPromoRenderer.bodyText) || getContext().resourceManager.getStringSync({
          "id": 16777956,
          "type": 10003,
          "params": [],
          "bundleName": "com.talon.yourpipe",
          "moduleName": "entry"
        }.id);
        throw new Error(acc);
      }
      return;
    });
    this.videoItemIdCursor = p1;
    this.collectVideoItemsFromContents(p0, v5);
    return v5;
  }
  collectVideoItemsFromContents(p0, p1) {
    let v7;
    if (!p0 || p0.length === 0) {
      return;
    }
    for (v7 = 0; v7 < p0.length; v7 += 1) {
      if (p0[v7]) {
        if (!p0[v7].richItemRenderer) {
          if (p0[v7].gridShelfViewModel) {
            this.collectVideoItemsFromContents(p0[v7].gridShelfViewModel.contents, p1);
          } else if (p0[v7].richShelfRenderer) {
            this.collectVideoItemsFromContents(p0[v7].richShelfRenderer.contents, p1);
          } else if (!p0[v7].shelfRenderer) {
            if (p0[v7].itemSectionRenderer) {
              this.collectVideoItemsFromContents(p0[v7].itemSectionRenderer.contents, p1);
            } else {
              this.collectVideoItemFromNode(p0[v7], p1);
            }
          } else if (p0[v7].shelfRenderer.content) {
            if (p0[v7].shelfRenderer.content.gridRenderer) {
              this.collectVideoItemsFromContents(p0[v7].shelfRenderer.content.gridRenderer.items, p1);
            } else if (p0[v7].shelfRenderer.content.horizontalListRenderer) {
              this.collectVideoItemsFromContents(p0[v7].shelfRenderer.content.horizontalListRenderer.items, p1);
            } else if (p0[v7].shelfRenderer.content.expandedShelfContentsRenderer) {
              this.collectVideoItemsFromContents(p0[v7].shelfRenderer.content.expandedShelfContentsRenderer.items, p1);
            }
          }
        } else if (p0[v7].richItemRenderer.content) {
          this.collectVideoItemFromNode(p0[v7].richItemRenderer.content, p1);
        }
      }
    }
    return;
  }
  collectVideoItemFromNode(p0, p1) {
    let v9;
    if (p0.videoRenderer) {
      v9 = buildVideoItemFromRenderer(p0.videoRenderer, this.videoItemIdCursor, "");
      if (v9) {
        p1.push(v9);
        this.videoItemIdCursor = this.videoItemIdCursor + 1;
      }
      return;
    }
    if (p0.reelItemRenderer) {
      v9 = buildVideoItemFromReelRenderer(p0.reelItemRenderer, this.videoItemIdCursor);
      if (v9) {
        p1.push(v9);
        this.videoItemIdCursor = this.videoItemIdCursor + 1;
      }
      return;
    }
    if (p0.shortsLockupViewModel && (v9 = buildVideoItemFromShortsLockupViewModel(p0.shortsLockupViewModel, this.videoItemIdCursor), !p0.shortsLockupViewModel)) {
      p1.push(v9);
      this.videoItemIdCursor = this.videoItemIdCursor + 1;
    }
    return;
  }
  buildSearchItemsFromContents(p0, p1) {
    let local_0_3 = this;
    let local_0_0 = p1;
    let local_0_1 = [];
    let local_0_2 = null;
    p0.forEach(function (p0) {
      let v12, v13, v14, v15, v16, v17, v18, v19, acc;
      if (p0.videoRenderer) {
        v12 = buildVideoItemFromRenderer(p0.videoRenderer, local_0_0 /*idCounter*/, "");
        if (v12) {
          local_0_1 /*items*/.push(new SearchStreamItem(v12.id, v12));
          local_0_0 += 1;
        }
        return;
      }
      if (p0.reelItemRenderer) {
        v12 = buildVideoItemFromReelRenderer(p0.reelItemRenderer, local_0_0 /*idCounter*/);
        if (v12) {
          local_0_1 /*items*/.push(new SearchStreamItem(v12.id, v12));
          local_0_0 += 1;
        }
        return;
      }
      if (p0.shortsLockupViewModel) {
        v12 = buildVideoItemFromShortsLockupViewModel(p0.shortsLockupViewModel, local_0_0 /*idCounter*/);
        if (v12) {
          local_0_1 /*items*/.push(new SearchStreamItem(v12.id, v12));
          local_0_0 += 1;
        }
        return;
      }
      if (p0.channelRenderer) {
        v12 = local_0_3.buildChannelItem(p0.channelRenderer, local_0_0 /*idCounter*/);
        if (v12) {
          local_0_1 /*items*/.push(v12);
          local_0_0 += 1;
        }
        return;
      }
      if (p0.playlistRenderer) {
        v12 = local_0_3.buildPlaylistItem(p0.playlistRenderer, local_0_0 /*idCounter*/);
        if (v12) {
          local_0_1 /*items*/.push(v12);
          local_0_0 += 1;
        }
        return;
      }
      if (p0.lockupViewModel) {
        acc = p0.lockupViewModel.contentType || "";
        switch (acc) {
          case "LOCKUP_CONTENT_TYPE_VIDEO":
            v18 = getLockupVideoId(p0.lockupViewModel);
            v17 = getLockupTitle(p0.lockupViewModel) || "Untitled";
            v13 = getLockupUploaderName(p0.lockupViewModel) || "Unknown";
            v16 = getLockupVideoThumbnailUrl(p0.lockupViewModel);
            v15 = ThumbnailPlaceholder.pickColor(v18 || v17, local_0_0 /*idCounter*/);
            v14 = getLockupChannelId(p0.lockupViewModel);
            v19 = new VideoItem(local_0_0 /*idCounter*/, v18, v17, v13, getLockupViewCount(p0.lockupViewModel), v16, false, v15, v14, "", "", "");
            v19.publishedTimeText = getLockupPublishedTimeText(p0.lockupViewModel);
            v19.durationText = getLockupDurationText(p0.lockupViewModel);
            v19.viewCountExact = getLockupViewCountExact(p0.lockupViewModel);
            v19.uploaderVerified = getLockupUploaderVerified(p0.lockupViewModel);
            local_0_1 /*items*/.push(new SearchStreamItem(v19.id, v19));
            local_0_0 += 1;
            return;
          case "LOCKUP_CONTENT_TYPE_SHORTS":
            v18 = getLockupVideoId(p0.lockupViewModel);
            acc = getLockupTitle(p0.lockupViewModel) || "Untitled";
            v17 = acc;
            v16 = getLockupVideoThumbnailUrl(p0.lockupViewModel);
            if (v18) {
              acc = v18;
            }
            v15 = ThumbnailPlaceholder.pickColor(acc, local_0_0 /*idCounter*/);
            v19 = new VideoItem(local_0_0 /*idCounter*/, v18, v17, getLockupUploaderName(p0.lockupViewModel) || "", "", v16, false, v15, getLockupChannelId(p0.lockupViewModel), "", "", "");
            v19.isShort = true;
            local_0_1 /*items*/.push(new SearchStreamItem(v19.id, v19));
            local_0_0 += 1;
            return;
          case "LOCKUP_CONTENT_TYPE_PLAYLIST":
          case "LOCKUP_CONTENT_TYPE_PODCAST":
            v16 = getLockupPlaylistId(p0.lockupViewModel);
            v14 = getLockupTitle(p0.lockupViewModel) || "Untitled";
            v17 = getLockupUploaderName(p0.lockupViewModel) || "";
            v13 = getLockupPlaylistCoverUrl(p0.lockupViewModel);
            local_0_1 /*items*/.push(new SearchPlaylistItem(local_0_0 /*idCounter*/, v16, v14, v17, "", v13, "", ThumbnailPlaceholder.pickColor(v16 || v14, local_0_0 /*idCounter*/)));
            local_0_0 += 1;
            return;
          case "LOCKUP_CONTENT_TYPE_CHANNEL":
            v13 = getLockupChannelId(p0.lockupViewModel);
            v18 = getLockupTitle(p0.lockupViewModel) || "Untitled";
            v17 = getThumbnailUrlFromThumbnailObject(p0.lockupViewModel.thumbnail);
            v16 = getLockupUploaderName(p0.lockupViewModel) || "";
            local_0_1 /*items*/.push(new SearchChannelItem(local_0_0 /*idCounter*/, v13, v18, v16, "", v17, "", ThumbnailPlaceholder.pickColor(v13 || v18, local_0_0 /*idCounter*/), ""));
            local_0_0 += 1;
            return;
          default:
            if (p0.continuationItemRenderer) {
              local_0_2 = getContinuationToken(p0.continuationItemRenderer) ?? local_0_2 /*nextPageToken*/;
            }
            return;
        }
      } else {
        if (p0.continuationItemRenderer) {
          local_0_2 = getContinuationToken(p0.continuationItemRenderer) ?? local_0_2 /*nextPageToken*/;
        }
        return;
      }
    });
    return {
      "items": local_0_1 /*items*/,
      "nextPageToken": local_0_2 /*nextPageToken*/
    };
  }
  buildChannelItem(p0, p1) {
    let acc = p0.channelId || "";
    let v5 = acc;
    let v11 = getTextFromRuns(p0.title) || "Untitled";
    let v8 = getTextFromRuns(p0.subscriberCountText) || "";
    let v12 = getTextFromRuns(p0.videoCountText) || "";
    let v6 = getTextFromRuns(p0.descriptionSnippet) || "";
    let v10 = getThumbnailUrlFromThumbnailObject(p0.thumbnail);
    if (!acc) {
      acc = v11;
    }
    return new SearchChannelItem(p1, v5, v11, v8, v12, v10, v6, ThumbnailPlaceholder.pickColor(acc, p1), "");
  }
  buildPlaylistItem(p0, p1) {
    let v15;
    let v7 = p0.playlistId || "";
    let v10 = getTextFromRuns(p0.title) || "Untitled";
    let v11 = getTextFromRuns(p0.shortBylineText) || "Unknown";
    let v12 = getTextFromRuns(p0.videoCount) || "";
    let v5 = "";
    if (p0.thumbnails && p0.thumbnails.length > 0) {
      v15 = p0.thumbnails[0]?.thumbnails;
      if (v15 && v15.length > 0) {
        v5 = pickBestThumbUrl(v15);
      }
    }
    return new SearchPlaylistItem(p1, v7, v10, v11, v12, v5, "", ThumbnailPlaceholder.pickColor(v7 || v10, p1));
  }
  getContinuationTokenFromSection(p0) {
    return p0.continuationItemRenderer ? getContinuationToken(p0.continuationItemRenderer) : null;
  }
  getContinuationTokenFromContents(p0) {
    if (!p0 || p0.length === 0) {
      return null;
    }
    if (!p0[p0.length - 1]) {
      return null;
    }
    return p0[p0.length - 1].continuationItemRenderer ? getContinuationToken(p0[p0.length - 1].continuationItemRenderer) : null;
  }
  hasLiveBadge(p0) {
    let v6, v11, v14, v15, v16, v18, v19, v20;
    if (p0.badges) {
      for (v15 of p0.badges) {
        if (!v15.metadataBadgeRenderer) {
          continue;
        }
        v20 = (v15.metadataBadgeRenderer.style || "").toUpperCase();
        if (v20 === "BADGE_STYLE_TYPE_LIVE_NOW" || v20 === "BADGE_STYLE_TYPE_LIVE" || v20.indexOf("LIVE") >= 0) {
          return true;
        }
        v19 = (v15.metadataBadgeRenderer.label || "").toLowerCase();
        if (v19 === "live" || v19 === "live now" || v19.indexOf("live") >= 0) {
          return true;
        }
        if ((v15.metadataBadgeRenderer.label || "").indexOf("直播") >= 0) return true;
      }
    }
    if (p0.thumbnailOverlays) {
      for (v15 of p0.thumbnailOverlays) {
        if (!v15.thumbnailOverlayTimeStatusRenderer) {
          continue;
        }
        if ((v15.thumbnailOverlayTimeStatusRenderer.style || "").toUpperCase() === "LIVE") return true;
      }
    }
    v6 = p0.contentImage?.thumbnailViewModel?.overlays;
    if (v6) {
      for (v11 = 0; v11 < v6.length; v11 += 1) {
        v14 = v6[v11]?.thumbnailBottomOverlayViewModel?.badges;
        if (v14) {
          for (v18 = 0; v18 < v14.length; v18 += 1) {
            v20 = v14[v18]?.thumbnailBadgeViewModel;
            if ((v20 ? (v20.badgeStyle || "").toUpperCase() : "").indexOf("LIVE") >= 0) {
              return true;
            }
          }
        }
        v16 = v6[v11]?.thumbnailOverlayBadgeViewModel?.thumbnailBadges;
        if (v16) {
          for (v18 = 0; v18 < v16.length; v18 += 1) {
            v20 = v16[v18]?.thumbnailBadgeViewModel;
            if ((v20 ? (v20.badgeStyle || "").toUpperCase() : "").indexOf("LIVE") >= 0) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }
  getChannelId(p0) {
    let v5, acc;
    let v7 = p0.ownerText?.runs;
    if (v7 && v7.length > 0) {
      acc = v7[0]?.navigationEndpoint?.browseEndpoint;
      if (acc) {
        return acc.browseId || "";
      }
    }
    v5 = p0.longBylineText?.runs;
    if (v5 && v5.length > 0) {
      acc = v5[0]?.navigationEndpoint?.browseEndpoint;
      if (acc) {
        return acc.browseId || "";
      }
    }
    return "";
  }
}