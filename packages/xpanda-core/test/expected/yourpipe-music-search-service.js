/*
* class name:L&entry/src/main/ets/features/home/MusicSearchService&;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { SearchPlaylistItem } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { SearchStreamItem } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { ThumbnailPlaceholder } from "@normalized:N&&&entry/src/main/ets/common/ThumbnailPlaceholder&";
import { VideoItem } from "@normalized:N&&&youtube_core/Index&1.0.0";
import { getMusicContinuationToken } from "@normalized:N&&&entry/src/main/ets/features/home/utils/ContinuationUtils&";
import { getTextFromRuns } from "@normalized:N&&&entry/src/main/ets/features/home/utils/TextUtils&";
import { getThumbnailUrlFromThumbnailObject } from "@normalized:N&&&entry/src/main/ets/features/home/utils/ThumbnailUtils&";
class MusicSearchService {
  constructor() {}
  static isMusicSearch(p0) {
    let v5;
    v5 = p0 && p0.length > 0;
    return !!(v5 && p0[0].startsWith("music_"));
  }
  static parseInitialMusicSearchResponse(p0, p1, p2) {
    let v7, v8, v9, v15, v22, v28;
    v7 = [];
    v8 = null;
    v15 = p0.contents?.tabbedSearchResultsRenderer?.tabs;
    v9 = (v15 && v15.length > 0 ? v15[0] : undefined)?.tabRenderer?.content?.sectionListRenderer;
    for (v22 of v9 ? v9.contents : []) {
      if (v22.musicShelfRenderer) {
        if (v22.musicShelfRenderer.contents && v22.musicShelfRenderer.contents.length > 0) {
          v7 = v7.concat(MusicSearchService.buildMusicSearchItemsFromContents(v22.musicShelfRenderer.contents, p1 + v7.length, p2));
        }
        v28 = getMusicContinuationToken(v22.musicShelfRenderer.continuations);
        if (v28) {
          v8 = v28;
        }
      }
    }
    return {
      "items": v7,
      "nextPageToken": v8
    };
  }
  static parseMusicSearchContinuationResponse(p0, p1, p2) {
    let v7, v9, v13, acc;
    v7 = [];
    v9 = null;
    acc = p0.continuationContents?.musicShelfContinuation;
    if (acc) {
      if (acc.contents && acc.contents.length > 0) {
        v7 = MusicSearchService.buildMusicSearchItemsFromContents(acc.contents, p1, p2);
      }
      v13 = getMusicContinuationToken(acc.continuations);
      if (v13) {
        v9 = v13;
      }
    }
    return {
      "items": v7,
      "nextPageToken": v9
    };
  }
  static buildMusicSearchItemsFromContents(p0, p1, p2) {
    let local_1_0, local_1_1, local_1_2;
    local_1_1 = p1;
    local_1_2 = [];
    local_1_0 = p2 && p2.length > 0 ? p2[0] : "";
    p0.forEach(function (p0) {
      let v4, v8, v10, v12, v13, v15;
      if (!p0.musicResponsiveListItemRenderer) {
        return;
      }
      if ((p0.musicResponsiveListItemRenderer.musicItemRendererDisplayPolicy || "") === "MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT") {
        return;
      }
      v8 = MusicSearchService.getMusicTextFromFlexColumn(p0.musicResponsiveListItemRenderer.flexColumns, 0)
        || "Untitled";
      v4 = MusicSearchService.getMusicDescriptionRuns(p0.musicResponsiveListItemRenderer);
      if (local_1_0 /*searchType*/ === "music_songs" || local_1_0 /*searchType*/ === "music_videos") {
        v13 = MusicSearchService.getMusicVideoId(p0.musicResponsiveListItemRenderer);
        if (!v13) {
          return;
        }
        v10 = MusicSearchService.getMusicAuthorFromRuns(v4) || "Unknown";
        v15 = local_1_0 /*searchType*/ === "music_videos" ? MusicSearchService.getMusicViewCountFromRuns(v4) : "";
        v12 = MusicSearchService.getMusicThumbnailUrl(p0.musicResponsiveListItemRenderer);
        local_1_2 /*items*/.push(new SearchStreamItem(local_1_1 /*idCounter*/, new VideoItem(local_1_1 /*idCounter*/, v13, v8, v10, v15, v12, false, ThumbnailPlaceholder.pickColor(v13 || v8, local_1_1 /*idCounter*/), "", "", "", "")));
        local_1_1 += 1;
        return;
      }
      if (local_1_0 /*searchType*/ === "music_albums" || local_1_0 /*searchType*/ === "music_playlists") {
        v12 = MusicSearchService.getMusicPlaylistId(p0.musicResponsiveListItemRenderer);
        v13 = MusicSearchService.getMusicUploaderFromRuns(v4, local_1_0 /*searchType*/);
        v10 = MusicSearchService.getMusicThumbnailUrl(p0.musicResponsiveListItemRenderer);
        local_1_2 /*items*/.push(new SearchPlaylistItem(local_1_1 /*idCounter*/, v12, v8, v13, "", v10, "", ThumbnailPlaceholder.pickColor(v12 || v8, local_1_1 /*idCounter*/)));
        local_1_1 += 1;
      }
      return;
    });
    return local_1_2 /*items*/;
  }
  static getMusicTextFromFlexColumn(p0, p1) {
    let v6;
    if (!p0 || p0.length <= p1) {
      return "";
    }
    v6 = p0[p1]?.musicResponsiveListItemFlexColumnRenderer;
    return getTextFromRuns(v6?.text);
  }
  static getMusicDescriptionRuns(p0) {
    let v8;
    if (!p0.flexColumns || p0.flexColumns.length < 2) {
      return [];
    }
    v8 = p0.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text;
    return v8?.runs ?? [];
  }
  static getMusicAuthorFromRuns(p0) {
    let v4;
    v4 = p0 && p0.length > 0 ? p0[0] : undefined;
    return v4 ? v4.text || "" : "";
  }
  static getMusicUploaderFromRuns(p0, p1) {
    let v7;
    if (!p0 || p0.length === 0) {
      return "";
    }
    if (p1 === "music_albums") {
      v7 = p0.length > 2 ? p0[2] : p0[0];
      return v7 ? v7.text || "" : "";
    }
    return p0[0] ? p0[0].text || "" : "";
  }
  static getMusicViewCountFromRuns(p0) {
    let v4;
    if (!p0 || p0.length === 0) {
      return "";
    }
    v4 = p0.length >= 3 ? p0[p0.length - 3] : p0[p0.length - 1];
    return v4 ? v4.text || "" : "";
  }
  static getMusicVideoId(p0) {
    return p0.playlistItemData ? p0.playlistItemData.videoId || "" : "";
  }
  static getMusicPlaylistId(p0) {
    let v12, v19, v23, v24, acc;
    acc = p0.menu?.menuRenderer?.items;
    if (acc) {
      for (v19 of acc) {
        v24 = v19.toggleMenuServiceItemRenderer?.toggledServiceEndpoint?.likeEndpoint?.target;
        v23 = v24 ? v24.playlistId : "";
        if (v23) return v23;
      }
    }
    v12 = p0.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchPlaylistEndpoint;
    return v12 ? v12.playlistId || "" : "";
  }
  static getMusicThumbnailUrl(p0) {
    let v5;
    v5 = p0.thumbnail?.musicThumbnailRenderer;
    return getThumbnailUrlFromThumbnailObject(v5?.thumbnail);
  }
}
export { MusicSearchService };