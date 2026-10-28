/*
* class name:L&feature_system/src/main/ets/y12&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { d398 } from "@normalized:N&&&feature_core/Index&1.0.0";
import { d84 } from "@normalized:N&&&commons/Index&1.0.0";
import fileUri from "@ohos:file.fileuri";
import g50 from "@ohos:file.fs";
import hilog from "@ohos:hilog";
import photoAccessHelper from "@ohos:file.photoAccessHelper";
let local_0_0 = "AlbumSaver";
export class p995 {
  constructor() {}
  static async saveImageUrl(p0, p1) {
    let v0 /*g50*/, v3 /*hilog*/, v4, v5, v7 /*g50*/, v15 /*p995*/, v16 /*a1*/;
    if (p1) {
      if (!p1.startsWith("http://") && !p1.startsWith("https://")) {
        throw new Error("不支持的图片地址");
      }
      v3 = p995.extFromUrl_(p1);
      v4 = p0.cacheDir + "/amcl_save_" + Date.now() + "." + v3;
      v5 = {
        "name": "album-save-" + Date.now(),
        "files": [{
          "localPath": v4,
          "urls": [p1],
          "allowedRoot": p0.cacheDir
        }]
      };
      try {
        if (!(await d398.instance().createAndWait(v5)).success) {
          try {
            g50.unlinkSync(v4);
          } catch (catchAcc) {}
          throw new Error("图片下载失败");
        }
        v15 = photoAccessHelper.getPhotoAccessHelper(p0);
        v16 = {
          "title": "AMCL_" + Date.now(),
          "fileNameExtension": v3,
          "photoType": photoAccessHelper.PhotoType.IMAGE,
          "subtype": photoAccessHelper.PhotoSubtype.DEFAULT
        };
        v0 = await v15.showAssetsCreationDialog([fileUri.getUriFromPath(v4)], [v16]);
        v7 = 0;
        if (!v0 || v0.length === 0) {
          try {
            g50.unlinkSync(v4);
          } catch (catchAcc) {}
          return "cancelled";
        }
        p995.copyInto_(v4, v0[v7]);
        hilog.info(v7, local_0_0, "saved image to album");
        try {
          g50.unlinkSync(v4);
        } catch (catchAcc) {}
        return "saved";
      } catch (catchAcc) {
        try {
          g50.unlinkSync(v4);
        } catch (catchAcc) {}
        throw catchAcc;
      }
    } else {
      throw new Error("不支持的图片地址");
    }
  }
  static copyInto_(p0, p1) {
    let v3, v4, v6 /*a1*/, v7;
    try {
      v7 = g50.openSync(p0, g50.OpenMode.READ_ONLY);
      v4 = v7;
      v6 = g50.openSync(p1, g50.OpenMode.READ_WRITE);
      v3 = v6;
      g50.copyFileSync(v7.fd, v6.fd);
    } catch (catchAcc) {
      v3 = v6;
      v4 = v7;
      hilog.error(0, local_0_0, "copyInto failed: %{public}s", d84(catchAcc));
      throw catchAcc;
    } finally {
      if (v4) {
        try {
          g50.closeSync(v4);
        } catch (catchAcc) {}
      }
      if (v3) {
        try {
          g50.closeSync(v3);
        } catch (catchAcc) {}
      }
    }
  }
  static extFromUrl_(p0) {
    let v0;
    let v1 = p0.indexOf("?");
    if (v1 >= 0) {
      p0 = p0.substring(0, v1);
    }
    v1 = p0.lastIndexOf(".");
    if (v1 >= 0) {
      v0 = p0.substring(v1 + 1).toLowerCase();
      return v0 === "png" || v0 === "jpg" || v0 === "jpeg" || v0 === "webp" || v0 === "gif" ? v0 : "png";
    }
    return "png";
  }
}