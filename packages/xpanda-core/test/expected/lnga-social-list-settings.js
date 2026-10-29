/*
* class name:Lcom.example.nga_oh/entry/ets/store/settings/domain/SocialListSettings;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { AuthScope } from "@bundle:com.example.nga_oh/entry/ets/store/AuthScope";
import { DOMAIN_SETTINGS } from "@bundle:com.example.nga_oh/entry/ets/common/utils/Logger";
import { FavBoard } from "@bundle:com.example.nga_oh/entry/ets/model/SocialEntries";
import { FilterListManager } from "@bundle:com.example.nga_oh/entry/ets/common/utils/FilterListManager";
import { KEY_BLACKLIST_VERSION } from "@bundle:com.example.nga_oh/entry/ets/common/constants/AppStorageKeys";
import { KEY_FAV_VERSION } from "@bundle:com.example.nga_oh/entry/ets/common/constants/AppStorageKeys";
import { Logger } from "@bundle:com.example.nga_oh/entry/ets/common/utils/Logger";
import { areBlacklistEntriesEqual } from "@bundle:com.example.nga_oh/entry/ets/common/utils/BlacklistUtils";
import { bumpAppStorageVersion } from "@bundle:com.example.nga_oh/entry/ets/common/utils/AppStorageVersion";
import { fetchForumFavorites } from "@bundle:com.example.nga_oh/entry/ets/service/api/FavoriteApi";
import { normalizeBlacklistEntries } from "@bundle:com.example.nga_oh/entry/ets/common/utils/BlacklistUtils";
import { normalizeBlacklistUserId } from "@bundle:com.example.nga_oh/entry/ets/common/utils/BlacklistUtils";
import { syncForumFavorites } from "@bundle:com.example.nga_oh/entry/ets/service/api/FavoriteApi";
let local_0_2 = function (p0, p1) {
  let v0;
  if (p0.length === p1.length) {
    for (v0 = 0; v0 < p0.length; v0 += 1) {
      if (p0[v0].fid !== p1[v0].fid) {
        return false;
      }
    }
    return true;
  }
  return false;
};
let local_0_1 = new Logger(DOMAIN_SETTINGS, "SocialListSettings");
let local_0_0 = 10000;
export class SocialListSettings {
  constructor(p0) {
    this.blacklistManager = new FilterListManager();
    this.favoritesLoaded = false;
    this.favoritesSyncRunning = false;
    this.favoritesSyncDirty = false;
    this.favoritesSyncBefore = [];
    this.ctx = p0;
  }
  addBlacklist(p0) {
    let v0 /*bumpAppStorageVersion*/, v1 /*KEY_BLACKLIST_VERSION*/;
    let local_1_0 = normalizeBlacklistUserId(p0.userId);
    v0 = normalizeBlacklistUserId((this.ctx.auth === null || this.ctx.auth === undefined ? undefined : this.ctx.auth.uid) ?? "");
    v1 = local_1_0 === null;
    if (local_1_0 !== null) {
      v1 = local_1_0 === v0;
    }
    if (v1 || this.ctx.state.blacklist.some(function (p0) {
      return p0.userId === local_1_0;
    })) {
      return false;
    }
    this.ctx.state.blacklist = this.blacklistManager.add({
      "userId": local_1_0,
      "nickName": p0.nickName.trim() || "User" + local_1_0 + ""
    });
    this.ctx.persist();
    bumpAppStorageVersion(KEY_BLACKLIST_VERSION);
    return true;
  }
  removeBlacklist(p0) {
    let local_1_0 = normalizeBlacklistUserId(p0);
    if (local_1_0 === null) {
      return false;
    }
    if (!this.ctx.state.blacklist.some(function (p0) {
      return p0.userId === local_1_0;
    })) {
      return false;
    }
    this.ctx.state.blacklist = this.blacklistManager.remove(function (p0) {
      return p0.userId === local_1_0;
    });
    this.ctx.persist();
    bumpAppStorageVersion(KEY_BLACKLIST_VERSION);
    return true;
  }
  removeAllBlacklist() {
    if (this.ctx.state.blacklist.length === 0) {
      return false;
    }
    this.ctx.state.blacklist = this.blacklistManager.clear();
    this.ctx.persist();
    bumpAppStorageVersion(KEY_BLACKLIST_VERSION);
    return true;
  }
  getBlacklistIds() {
    let v1;
    let v0 = 0;
    for (v1 = new Set(); v0 < this.ctx.state.blacklist.length; v0 += 1) {
      v1.add(this.ctx.state.blacklist[v0].userId);
    }
    return v1;
  }
  isBlacklisted(p0) {
    let local_1_0 = normalizeBlacklistUserId(p0);
    return local_1_0 !== null && this.ctx.state.blacklist.some(function (p0) {
      return p0.userId === local_1_0;
    });
  }
  getBlacklistHeaderString() {
    return this.ctx.state.blacklist.map(function (p0) {
      return p0.userId;
    }).join(",");
  }
  ensureFavorites() {
    let v3;
    let local_1_0 = this;
    if (!local_1_0.favoritesLoaded) {
      if (!local_1_0.ctx.auth.isAuthenticated) {
        return;
      }
      if (local_1_0.ctx.state.favorites.length > 0) {
        local_1_0.favoritesLoaded = true;
      }
      v3 = async function () {
        await local_1_0.doRefreshFavorites();
        return undefined;
      };
      setTimeout(v3, local_1_0.ctx.state.favorites.length > 0 ? local_0_0 : 0);
    }
    return;
  }
  async doRefreshFavorites() {
    let v0, v3 /*logger*/, v4 /*KEY_FAV_VERSION*/, v7 /*FavBoard*/;
    if (!this.ctx.auth.isAuthenticated) {
      return undefined;
    }
    v3 = 0;
    v4 = AuthScope.capture(this.ctx.auth, 0);
    try {
      v0 = await fetchForumFavorites(this.ctx.auth.token);
      if (!v4.isCurrent(this.ctx.auth, 0)) {
        return undefined;
      }
      if (this.favoritesSyncRunning || this.favoritesSyncDirty) {
        this.favoritesLoaded = true;
        return undefined;
      }
      if (v0.ok) {
        for (v4 = []; v3 < v0.data.length; v3 += 1) {
          v7 = new FavBoard();
          v7.fid = v0.data[v3].fid;
          v7.stid = v0.data[v3].stid;
          v7.name = v0.data[v3].name;
          v4.push(v7);
        }
        this.ctx.state.favorites = v4;
        this.ctx.persist();
        bumpAppStorageVersion(KEY_FAV_VERSION);
      }
      this.favoritesLoaded = true;
    } catch (catchAcc) {
      local_0_1.error("fetchFavorites failed");
    }
    return undefined;
  }
  addFavorite(p0) {
    let v0 = this.ctx.state.favorites.slice();
    let v2 /*KEY_FAV_VERSION*/ = [];
    v2.splice(0, 0, ...v0);
    v2[v2.length] = p0;
    this.ctx.state.favorites = v2;
    this.ctx.persist();
    bumpAppStorageVersion(KEY_FAV_VERSION);
    this.scheduleFavoritesSync(v0);
  }
  removeFavorite(p0) {
    let v0;
    let local_1_0 = p0;
    v0 = this.ctx.state.favorites.slice();
    this.ctx.state.favorites = v0.filter(function (p0) {
      return p0.fid !== local_1_0;
    });
    this.ctx.persist();
    bumpAppStorageVersion(KEY_FAV_VERSION);
    this.scheduleFavoritesSync(v0);
  }
  scheduleFavoritesSync(p0) {
    if (this.ctx.auth) {
      if (!this.ctx.auth.isAuthenticated) {
        return;
      }
      this.favoritesSyncBefore = p0;
      if (this.favoritesSyncRunning) {
        this.favoritesSyncDirty = true;
        return;
      }
      this.favoritesSyncRunning = true;
      this.runFavoritesSyncLoop();
    }
    return;
  }
  async runFavoritesSyncLoop() {
    let v7;
    try {
      do {
        this.favoritesSyncDirty = false;
        await this.syncFavoritesOnce();
        v7 = this.favoritesSyncDirty && this.ctx.auth;
      } while (v7 && this.ctx.auth.isAuthenticated);
    } finally {
      this.favoritesSyncRunning = false;
    }
  }
  async syncFavoritesOnce() {
    let v2, v4 /*AuthScope*/, v5;
    if (this.ctx.auth) {
      if (!this.ctx.auth.isAuthenticated) {
        return undefined;
      }
      v4 = AuthScope.capture(this.ctx.auth, 0);
      v5 = this.ctx.state.favorites.slice();
      v2 = await syncForumFavorites(this.ctx.auth.token, v5.map(function (p0) {
        return p0.fid;
      }).join(","));
      if (!v4.isCurrent(this.ctx.auth, 0)) {
        return undefined;
      }
      if (!v2.ok) {
        local_0_1.warn("收藏版面同步失败: %{public}s", v2.error);
        this.rollbackFavoritesIfUnchanged(v5);
      }
    }
    return undefined;
  }
  rollbackFavoritesIfUnchanged(p0) {
    if (!local_0_2(this.ctx.state.favorites, p0)) {
      return;
    }
    this.ctx.state.favorites = this.favoritesSyncBefore.slice();
    this.ctx.persist();
    bumpAppStorageVersion(KEY_FAV_VERSION);
    return;
  }
  load(p0) {
    let v0 /*normalizeBlacklistEntries*/;
    if (p0.favorites) {
      this.ctx.state.favorites = p0.favorites;
    }
    if (p0.blacklist) {
      v0 = normalizeBlacklistEntries(p0.blacklist, (this.ctx.auth === null || this.ctx.auth === undefined ? undefined : this.ctx.auth.uid) ?? "");
      this.ctx.state.blacklist = v0;
      this.blacklistManager.init(v0);
      if (!areBlacklistEntriesEqual(v0, p0.blacklist)) {
        this.ctx.persist();
      }
    }
  }
  reset() {
    this.blacklistManager = new FilterListManager();
    this.favoritesLoaded = false;
  }
}