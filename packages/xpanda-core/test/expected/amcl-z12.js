/*
* class name:L&gamecontrol/src/main/ets/z12&1.0.0;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
import { b422 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { c422 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { d285 } from "@normalized:N&&&gamecontrol/src/main/ets/b13&1.0.0";
import { g1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { h1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { i1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { j1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { k1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { l1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { l1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { l301 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { m1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { n1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { n421 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { o1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { o1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { o421 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { p1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { p1360 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { p421 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { q1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { q421 } from "@normalized:N&&&gamecontrol/src/main/ets/f13&1.0.0";
import { r1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { s1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { s374 } from "@normalized:N&&&gamecontrol/src/main/ets/u13&1.0.0";
import { u1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { v1357 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
import { x421 } from "@normalized:N&&&gamecontrol/src/main/ets/a13&1.0.0";
export let d1361;
export let c1361;
export let b1361;
let local_0_0, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_9, local_0_10, local_0_11, local_0_12, local_0_13, local_0_14, local_0_15, local_0_16, local_0_18, local_0_19, local_0_20, local_0_21, local_0_22;
let local_0_1 = function (p0, p1) {
  return {
    "id": p0.id,
    "label": p0.label,
    "type": p0.type,
    "keyOrMouse": p0.keyOrMouse,
    "keys": p0.keys ? p0.keys.slice() : undefined,
    "modifiers": p0.modifiers,
    "trigger": p0.trigger,
    "xPct": p0.xPct,
    "yPct": p0.yPct,
    "baseWidth": p0.baseWidth,
    "baseHeight": p0.baseHeight,
    "itemScale": p0.itemScale,
    "isCircle": p0.isCircle,
    "style": p0.style ? {
      "bg": p0.style.bg,
      "bgPressed": p0.style.bgPressed,
      "fg": p0.style.fg,
      "opacity": p0.style.opacity,
      "shape": p0.style.shape,
      "cornerRadius": p0.style.cornerRadius
    } : undefined,
    "alignGroup": p0.alignGroup,
    "alignIndex": p0.alignIndex,
    "grabbedOnly": p0.grabbedOnly,
    "menuOnly": p0.menuOnly,
    "hidden": p0.hidden,
    "locked": p0.locked,
    "visibilityOverride": p0.visibilityOverride,
    "hideOnInput": p0.hideOnInput ? p0.hideOnInput.slice() : undefined,
    "dragLook": p0.dragLook,
    "swipeGroup": p0.swipeGroup,
    "controlGroupId": p0.controlGroupId,
    "groupActions": o1357(p0.groupActions),
    "phaseBindings": p1357(p0.phaseBindings),
    "gesturePolicy": p0.gesturePolicy,
    "hotbarUserPlaced": p0.hotbarUserPlaced,
    "systemAction": p0.systemAction,
    "children": p1
  };
};
let local_0_17 = function (p0) {
  return p0 === "⚔" || p0 === "🛡" || p0 === "▲" || p0 === "▼";
};
export function a421(p0) {
  return w1359(p0).profile;
}
export function a422(p0, p1, p2) {
  let v0, v4;
  let local_1_2;
  let local_1_0 = p1;
  let local_1_1 = p2;
  if (p0.controlGroups !== undefined && local_1_0 !== p0.defaultControlGroupId) {
    if (!p0.controlGroups.some(function (p0) {
      return p0.id === local_1_0;
    })) {
      return null;
    }
    if (local_1_1 === undefined) {
      v0 = r301(p0);
      v0.controlGroups = v0.controlGroups.filter(function (p0) {
        return p0.id !== local_1_0;
      });
      v0.controls = v0.controls.filter(function (p0) {
        return p0.controlGroupId !== local_1_0 || local_1_1 !== undefined;
      });
      local_1_2 = function (p0) {
        let v1, v3;
        if (p0.controlGroupId === local_1_0) {
          p0.controlGroupId = local_1_1;
        }
        if (p0.groupActions !== undefined) {
          for (v3 of p0.groupActions) {
            v3.targets = v3.targets.filter(function (p0) {
              return p0 !== local_1_0;
            });
          }
          p0.groupActions = p0.groupActions.filter(function (p0) {
            return p0.targets.length > 0;
          });
        }
        v1 = p0.children ?? [];
        for (v3 of v1) {
          local_1_2(v3);
        }
      };
      for (v4 of v0.controls) {
        local_1_2(v4);
      }
      return a421(v0);
    }
    v0 = local_1_1 === local_1_0;
    if (local_1_1 !== local_1_0) {
      v0 = !p0.controlGroups.some(function (p0) {
        return p0.id === local_1_1;
      });
    }
    if (v0) {
      return null;
    }
    v0 = r301(p0);
    v0.controlGroups = v0.controlGroups.filter(function (p0) {
      return p0.id !== local_1_0;
    });
    v0.controls = v0.controls.filter(function (p0) {
      return p0.controlGroupId !== local_1_0 || local_1_1 !== undefined;
    });
    local_1_2 = function (p0) {
      let v1, v3;
      if (p0.controlGroupId === local_1_0) {
        p0.controlGroupId = local_1_1;
      }
      if (p0.groupActions !== undefined) {
        for (v3 of p0.groupActions) {
          v3.targets = v3.targets.filter(function (p0) {
            return p0 !== local_1_0;
          });
        }
        p0.groupActions = p0.groupActions.filter(function (p0) {
          return p0.targets.length > 0;
        });
      }
      v1 = p0.children ?? [];
      for (v3 of v1) {
        local_1_2(v3);
      }
    };
    for (v4 of v0.controls) {
      local_1_2(v4);
    }
    return a421(v0);
  }
  return null;
}
local_0_2 = function (p0) {
  let v0, v1, v2;
  if (!p0) {
    return undefined;
  }
  v0 = undefined;
  if (p0.buttonMap) {
    v1 = 0;
    v0 = {};
    for (v2 = Object.keys(p0.buttonMap); v1 < v2.length; v1 += 1) {
      v0[v2[v1]] = {
        "kind": p0.buttonMap[v2[v1]].kind,
        "code": p0.buttonMap[v2[v1]].code
      };
    }
  }
  return {
    "enabled": p0.enabled,
    "buttonMap": v0,
    "leftStick": p0.leftStick,
    "rightStick": p0.rightStick,
    "stickDeadZone": p0.stickDeadZone,
    "triggerThreshold": p0.triggerThreshold,
    "lookScale": p0.lookScale
  };
};
export function b1360(p0) {
  let v1, v2, v3;
  if (p0.id === "joystick") {
    return ["keyboard"];
  }
  if (p0.type === o301.SCROLL_WHEEL) {
    return ["mouse"];
  }
  if (p0.id.startsWith("hb")) {
    return ["mouse_and_keyboard"];
  }
  v1 = t301(p0);
  v2 = false;
  for (v3 = 0; v3 < v1.length; v3 += 1) {
    if (v1[v3] < 0) {
      v2 = true;
      break;
    }
  }
  if (v2) {
    return ["mouse"];
  }
  if (p0.type === o301.BUTTON && p0.keyOrMouse > 0) {
    return ["keyboard"];
  }
  return [];
}
export function b474(p0, p1) {
  let v0, v1;
  let local_1_0 = p1;
  if (p0.controlGroups === undefined || local_1_0.controlGroupId === undefined) {
    return true;
  }
  v0 = p0.controlGroups.find(function (p0) {
    return p0.id === local_1_0.controlGroupId;
  });
  v1 = v0 !== undefined;
  if (v0 !== undefined && (v1 = v0.initialVisible, v0.initialVisible !== null) && v0.initialVisible !== undefined) {
    v1 = true;
  }
  return v1;
}
export function c1359(p0) {
  return p0.controlGroups !== undefined ? b422 : p0.lookPolicies === undefined ? b421 : r374;
}
export function c1360(p0, p1, p2) {
  let v1;
  let v0 = p0.visibilityOverride ?? "auto";
  if (v0 === "force_show") {
    return false;
  }
  if (v0 === "force_hide") {
    return true;
  }
  v0 = p0.hideOnInput ?? [];
  for (v1 = 0; v1 < v0.length; v1 += 1) {
    if (v0[v1] === "mouse" && p1) {
      return true;
    }
    if (v0[v1] === "keyboard" && p2) {
      return true;
    }
    if (v0[v1] === "mouse_and_keyboard" && p1 && p2) {
      return true;
    }
  }
  return false;
}
export function d1359(p0) {
  let v0 = (p0.groupActions === null || p0.groupActions === undefined ? undefined : p0.groupActions.some(function (p0) {
    return p0.targets.length > 0;
  })) ?? false;
  if (!v0) {
    v0 = p0.phaseBindings === undefined ? t301(p0).length > 0 : p0.phaseBindings.some(function (p0) {
      return p0.keys.length > 0;
    });
  }
  return v0;
}
export function d1360(p0) {
  switch (p0) {
    case "input":
      return b1361;
    case "edit":
      return c1361;
    case "mouse":
      return "sys_mouse";
    default:
      return d1361;
  }
}
local_0_20 = function (p0) {
  let v1 /*r1367*/, v4, v5, acc;
  let local_1_0, local_1_2, local_1_3, local_1_4, local_1_5;
  let local_1_1 = p0.version === b422;
  if (local_1_1) {
    local_1_2 = new Set();
    if (local_1_1) {
      if (!l1357(p0, ["version", "profileId", "profileRevision", "name", "globalScale", "lookSensitivity", "invertY", "lookSmoothing", "lookAccel", "lookPolicies", "joystickDeadZone", "haptic", "touch", "globalOpacity", "targetDevice", "isPreset", "deviceModel", "hotbarAutoAdded", "snapEnabled", "snapGap", "snapStrength", "gamepad", "controls", "controlGroups", "defaultControlGroupId", "requiredCapabilities"])) {
        return "groups.profile-fields";
      }
      v1 = q1357(p0.controlGroups, p0.defaultControlGroupId);
      if (v1.length > 0) {
        return v1;
      }
      for (v4 of p0.controlGroups) {
        acc = local_1_2.add(v4.id);
      }
      if (!Array.isArray(p0.requiredCapabilities) || p0.requiredCapabilities.length > 2 || p0.requiredCapabilities.indexOf(v1357) < 0) {
        return "groups.capabilities";
      }
      v1 = new Set();
      for (v5 of p0.requiredCapabilities) {
        if (v5 !== v1357 && v5 !== c422 || v1.has(v5)) {
          return "groups.capability";
        }
        acc = v1.add(v5);
      }
    }
    local_1_0 = 0;
    local_1_4 = 0;
    local_1_3 = false;
    local_1_5 = function (p0, p1, p2) {
      let v3, v6, v10 /*r1367*/, v11 /*u1357*/, v13, acc;
      if (!Array.isArray(p0) || p2 > 8) {
        return "groups.children";
      }
      v3 = p0[Symbol.iterator]();
      label_90: while (true) {
        v6 = v3.next();
        if (v6.done) {
          return "";
        }
        v6 = v6.value;
        acc = !v6;
        if (acc || local_1_0 /*o1367*/ + 1 > 256) {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.members";
        }
        acc = !local_1_1;
        if (!acc) {
          acc = !l1357(v6, ["id", "label", "type", "keyOrMouse", "keys", "modifiers", "trigger", "xPct", "yPct", "baseWidth", "baseHeight", "itemScale", "isCircle", "style", "alignGroup", "alignIndex", "grabbedOnly", "menuOnly", "hidden", "locked", "visibilityOverride", "hideOnInput", "dragLook", "swipeGroup", "hotbarUserPlaced", "systemAction", "children", "controlGroupId", "groupActions", "phaseBindings", "gesturePolicy"]);
          if (acc) {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.control-fields";
          }
          v11 = v6.controlGroupId ?? p1;
          if (v6.systemAction === "visibility" || v6.systemAction === "edit") {
            v10 = v11 !== undefined;
          } else {
            v10 = v11 === undefined;
            if (v11 !== undefined) {
              v10 = !local_1_2.has(v11);
            }
          }
          if (v10) {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.member";
          }
          if (p1 !== undefined && v11 !== p1) {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.child-membership";
          }
          if (v6.gesturePolicy !== undefined && v6.gesturePolicy !== "amcl" && v6.gesturePolicy !== "fcl") {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.policy";
          }
          if (v6.gesturePolicy !== undefined && v6.phaseBindings === undefined) {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.policy-bindings";
          }
          v10 = r1357(v6.groupActions, local_1_2);
          if (v10.length > 0) {
            if (v3.return != undefined) {
              v3.return();
            }
            return v10;
          }
          v10 = s1357(v6.phaseBindings);
          if (v10.length > 0) {
            if (v3.return != undefined) {
              v3.return();
            }
            return v10;
          }
          if (v6.groupActions !== undefined || v6.phaseBindings !== undefined) {
            if (v6.type !== o301.BUTTON || v6.systemAction !== undefined) {
              if (v3.return != undefined) {
                v3.return();
              }
              return "groups.action-kind";
            }
          }
          if (v6.phaseBindings !== undefined) {
            local_1_3 = true;
            v10 = !Array.isArray(v6.keys) || v6.keys.length !== 0 || v6.keyOrMouse !== 0;
            if (v10) {
              if (v3.return != undefined) {
                v3.return();
              }
              return "groups.phase-binding-conflict";
            }
            if (v6.trigger !== undefined && v6.trigger !== "press") {
              if (v3.return != undefined) {
                v3.return();
              }
              return "groups.phase-binding-conflict";
            }
          }
          if (v6.gesturePolicy === "fcl") {
            local_1_3 = true;
          }
          v11 = v6.groupActions ?? [];
          for (v13 of v11) {
            local_1_4 += v13.targets.length;
          }
          if (local_1_4 /*p1367*/ > u1357) {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.operation-budget";
          }
        } else if (v6.controlGroupId !== undefined || v6.groupActions !== undefined || v6.phaseBindings !== undefined || v6.gesturePolicy !== undefined) {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.version";
        }
        if (v6.children === undefined) {
          continue;
        }
        v11 = v6.children;
        v6 = v6.controlGroupId ?? p1;
        v6 = local_1_5(v11, v6, p2 + 1);
        acc = v6.length;
        if (acc > 0) {
          if (v3.return != undefined) {
            v3.return();
          }
          return v6;
        }
      }
    };
    v1 = local_1_5(p0.controls, undefined, 0);
    if (v1.length > 0) {
      return v1;
    }
    if (local_1_3) {
      acc = (p0.requiredCapabilities === null || p0.requiredCapabilities === undefined ? undefined : p0.requiredCapabilities.indexOf(c422)) === -1 ? "groups.phase-capability" : "";
    } else {
      acc = "";
    }
    return acc;
  }
  if (p0.controlGroups !== undefined || p0.defaultControlGroupId !== undefined || p0.requiredCapabilities !== undefined) {
    return "groups.version";
  }
  local_1_2 = new Set();
  if (local_1_1) {
    if (!l1357(p0, ["version", "profileId", "profileRevision", "name", "globalScale", "lookSensitivity", "invertY", "lookSmoothing", "lookAccel", "lookPolicies", "joystickDeadZone", "haptic", "touch", "globalOpacity", "targetDevice", "isPreset", "deviceModel", "hotbarAutoAdded", "snapEnabled", "snapGap", "snapStrength", "gamepad", "controls", "controlGroups", "defaultControlGroupId", "requiredCapabilities"])) {
      return "groups.profile-fields";
    }
    v1 = q1357(p0.controlGroups, p0.defaultControlGroupId);
    if (v1.length > 0) {
      return v1;
    }
    for (v4 of p0.controlGroups) {
      acc = local_1_2.add(v4.id);
    }
    if (!Array.isArray(p0.requiredCapabilities) || p0.requiredCapabilities.length > 2 || p0.requiredCapabilities.indexOf(v1357) < 0) {
      return "groups.capabilities";
    }
    v1 = new Set();
    for (v5 of p0.requiredCapabilities) {
      if (v5 !== v1357 && v5 !== c422 || v1.has(v5)) {
        return "groups.capability";
      }
      acc = v1.add(v5);
    }
  }
  local_1_0 = 0;
  local_1_4 = 0;
  local_1_3 = false;
  local_1_5 = function (p0, p1, p2) {
    let v3, v6, v10 /*r1367*/, v11 /*u1357*/, v13, acc;
    if (!Array.isArray(p0) || p2 > 8) {
      return "groups.children";
    }
    v3 = p0[Symbol.iterator]();
    label_90: while (true) {
      v6 = v3.next();
      if (v6.done) {
        return "";
      }
      v6 = v6.value;
      acc = !v6;
      if (acc || local_1_0 /*o1367*/ + 1 > 256) {
        if (v3.return != undefined) {
          v3.return();
        }
        return "groups.members";
      }
      acc = !local_1_1;
      if (!acc) {
        acc = !l1357(v6, ["id", "label", "type", "keyOrMouse", "keys", "modifiers", "trigger", "xPct", "yPct", "baseWidth", "baseHeight", "itemScale", "isCircle", "style", "alignGroup", "alignIndex", "grabbedOnly", "menuOnly", "hidden", "locked", "visibilityOverride", "hideOnInput", "dragLook", "swipeGroup", "hotbarUserPlaced", "systemAction", "children", "controlGroupId", "groupActions", "phaseBindings", "gesturePolicy"]);
        if (acc) {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.control-fields";
        }
        v11 = v6.controlGroupId ?? p1;
        if (v6.systemAction === "visibility" || v6.systemAction === "edit") {
          v10 = v11 !== undefined;
        } else {
          v10 = v11 === undefined;
          if (v11 !== undefined) {
            v10 = !local_1_2.has(v11);
          }
        }
        if (v10) {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.member";
        }
        if (p1 !== undefined && v11 !== p1) {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.child-membership";
        }
        if (v6.gesturePolicy !== undefined && v6.gesturePolicy !== "amcl" && v6.gesturePolicy !== "fcl") {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.policy";
        }
        if (v6.gesturePolicy !== undefined && v6.phaseBindings === undefined) {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.policy-bindings";
        }
        v10 = r1357(v6.groupActions, local_1_2);
        if (v10.length > 0) {
          if (v3.return != undefined) {
            v3.return();
          }
          return v10;
        }
        v10 = s1357(v6.phaseBindings);
        if (v10.length > 0) {
          if (v3.return != undefined) {
            v3.return();
          }
          return v10;
        }
        if (v6.groupActions !== undefined || v6.phaseBindings !== undefined) {
          if (v6.type !== o301.BUTTON || v6.systemAction !== undefined) {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.action-kind";
          }
        }
        if (v6.phaseBindings !== undefined) {
          local_1_3 = true;
          v10 = !Array.isArray(v6.keys) || v6.keys.length !== 0 || v6.keyOrMouse !== 0;
          if (v10) {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.phase-binding-conflict";
          }
          if (v6.trigger !== undefined && v6.trigger !== "press") {
            if (v3.return != undefined) {
              v3.return();
            }
            return "groups.phase-binding-conflict";
          }
        }
        if (v6.gesturePolicy === "fcl") {
          local_1_3 = true;
        }
        v11 = v6.groupActions ?? [];
        for (v13 of v11) {
          local_1_4 += v13.targets.length;
        }
        if (local_1_4 /*p1367*/ > u1357) {
          if (v3.return != undefined) {
            v3.return();
          }
          return "groups.operation-budget";
        }
      } else if (v6.controlGroupId !== undefined || v6.groupActions !== undefined || v6.phaseBindings !== undefined || v6.gesturePolicy !== undefined) {
        if (v3.return != undefined) {
          v3.return();
        }
        return "groups.version";
      }
      if (v6.children === undefined) {
        continue;
      }
      v11 = v6.children;
      v6 = v6.controlGroupId ?? p1;
      v6 = local_1_5(v11, v6, p2 + 1);
      acc = v6.length;
      if (acc > 0) {
        if (v3.return != undefined) {
          v3.return();
        }
        return v6;
      }
    }
  };
  v1 = local_1_5(p0.controls, undefined, 0);
  if (v1.length > 0) {
    return v1;
  }
  if (local_1_3) {
    acc = (p0.requiredCapabilities === null || p0.requiredCapabilities === undefined ? undefined : p0.requiredCapabilities.indexOf(c422)) === -1 ? "groups.phase-capability" : "";
  } else {
    acc = "";
  }
  return acc;
};
export function e1360(p0, p1, p2, p3) {
  return {
    "id": d1360(p0),
    "label": p0 === "input" ? "输入" : p0 === "edit" ? "设置" : p0 === "mouse" ? "鼠标" : "显示",
    "type": o301.BUTTON,
    "systemAction": p0,
    "keyOrMouse": p0 === "input" ? i1360 : 0,
    "xPct": p1,
    "yPct": p2,
    "baseWidth": c421,
    "baseHeight": c421,
    "itemScale": 1,
    "isCircle": false,
    "style": {
      "cornerRadius": e421
    },
    "alignGroup": p301.FUNC_TOP_RIGHT,
    "alignIndex": p3,
    "grabbedOnly": p0 === "visibility",
    "menuOnly": false
  };
}
local_0_3 = function (p0, p1) {
  let v1, v3;
  let local_1_0 = p1;
  if (p0.controlGroupId !== undefined) {
    p0.controlGroupId = local_1_0.get(p0.controlGroupId) ?? p0.controlGroupId;
  }
  v1 = p0.groupActions ?? [];
  for (v3 of v1) {
    v3.targets = v3.targets.map(function (p0) {
      let v0 = local_1_0.get(p0);
      if (v0 != null) {
        p0 = v0;
      }
      return p0;
    });
  }
  v1 = p0.children ?? [];
  for (v3 of v1) {
    local_0_3(v3, local_1_0);
  }
};
export function f1360() {
  let v0 = e1360("mouse", 0.94, 0.9, 7);
  v0.alignGroup = p301.NONE;
  return v0;
}
export function g1359(p0) {
  let v3 /*w1366*/, v5;
  let local_1_1;
  let local_1_0 = r301(p0);
  if (local_1_0.controlGroups === undefined) {
    return local_1_0;
  }
  local_1_1 = new Map();
  for (v3 of local_1_0.controlGroups) {
    v5 = z420(local_1_0.controls);
    local_1_1.set(v3.id, v5);
    v3.id = v5;
  }
  local_1_0.defaultControlGroupId = local_1_1.get(local_1_0.defaultControlGroupId ?? "");
  local_1_0.controls = local_1_0.controls.map(function (p0) {
    let v0 = y420(p0, local_1_0.controls);
    local_0_3(v0, local_1_1);
    return v0;
  });
  return local_1_0;
}
export function g421(p0) {
  let v0 /*d421*/ = p0.style === null || p0.style === undefined ? undefined : p0.style.opacity;
  if (v0 === undefined) {
    return d421;
  }
  if (v0 < 0.1) {
    v0 = 0.1;
  } else if (v0 > 1) {
    v0 = 1;
  }
  return v0;
}
export function h1359(p0) {
  let v0, v1 /*b422*/;
  if (p0.controlGroups !== undefined || p0.version === b422) {
    return null;
  }
  v0 = a421(p0);
  if (v0 === null) {
    return null;
  }
  v1 = r301(v0);
  if (v0.lookPolicies !== undefined) {
    v1.lookSensitivity = v0.lookPolicies.legacy.sensitivity;
    v1.invertY = v0.lookPolicies.legacy.invertY;
    v1.lookSmoothing = v0.lookPolicies.legacy.smoothing;
    v1.lookAccel = v0.lookPolicies.legacy.acceleration;
  }
  v1.lookPolicies = undefined;
  v1.version = 3;
  return v1;
}
export function h421(p0) {
  if (p0.menuOnly === true) {
    return "menu";
  }
  if (p0.grabbedOnly === true) {
    return "game";
  }
  return "always";
}
local_0_4 = function (p0, p1) {
  let v0;
  for (v0 = 0; v0 < p0.length; v0 += 1) {
    p1.add(p0[v0].id);
    if (p0[v0].children) {
      local_0_4(p0[v0].children, p1);
    }
  }
};
export function i421(p0, p1) {
  if (p1 === "game") {
    p0.grabbedOnly = true;
    p0.menuOnly = false;
  } else if (p1 === "menu") {
    p0.grabbedOnly = false;
    p0.menuOnly = true;
  } else {
    p0.grabbedOnly = false;
    p0.menuOnly = false;
  }
}
local_0_7 = function (p0) {
  let v2 /*u1360*/, v3 /*u1360*/, acc;
  do {} while ((local_0_5 += 1, acc = Date.now().toString(36), v2 = "c" + acc + local_0_6, v3 = local_0_5 /*u1360*/, acc = local_0_5 /*u1360*/.toString(36), v2 += acc, acc = p0.has(v2), acc) || (v3 = l50(v2), acc = !(v3 > 23), v3 > 23));
  p0.add(v2);
  return v2;
};
local_0_13 = function (p0, p1, p2) {
  return Number.isFinite(p0) && p0 >= p1 && p0 <= p2;
};
local_0_8 = function (p0, p1, p2) {
  return Number.isFinite(p0) && Math.floor(p0) === p0 && p0 >= p1 && p0 <= p2;
};
export function l50(p0) {
  let v11, v12;
  let v10 = 0;
  for (v11 = 0; v11 < p0.length; v11 += 1) {
    v12 = p0.charCodeAt(v11);
    if (v12 <= 127) {
      v10 += 1;
    } else if (v12 <= 2047) {
      v10 += 2;
    } else if (v12 < 55296 || v12 > 56319) {
      v10 += 3;
    } else if (v11 + 1 < p0.length && (v12 = p0.charCodeAt(v11 + 1), v12 >= 56320) && v12 <= 57343) {
      v10 += 4;
      v11 += 1;
    } else {
      v10 += 3;
    }
  }
  return v10;
}
local_0_9 = function (p0) {
  return local_0_8(p0, 1, 512) || local_0_8(p0, -16, -1);
};
local_0_12 = function (p0) {
  return p0 === 0 || local_0_9(p0);
};
local_0_11 = function (p0) {
  return p0 === o301.BUTTON
    || p0 === o301.JOYSTICK
    || p0 === o301.SCROLL_WHEEL
    || p0 === o301.DRAWER
    || p0 === o301.HOTBAR_SELECTOR;
};
local_0_15 = function (p0) {
  return p0 === p301.NONE
    || p0 === p301.HOTBAR
    || p0 === p301.ACTION_RIGHT
    || p0 === p301.MOVE_RIGHT
    || p0 === p301.FUNC_TOP_RIGHT
    || p0 === p301.DEBUG_TOP_LEFT;
};
local_0_14 = function (p0) {
  return p0 === "press" || p0 === "toggle" || p0 === "doubleTap" || p0 === "longPress";
};
export function q301() {
  let v9, acc;
  let v8 = [{
    "id": "joystick",
    "label": "",
    "type": o301.JOYSTICK,
    "keyOrMouse": 0,
    "xPct": 0.021,
    "yPct": 0.57,
    "baseWidth": 140,
    "baseHeight": 140,
    "itemScale": 1,
    "isCircle": true,
    "style": {
      "cornerRadius": 1
    },
    "alignGroup": p301.NONE,
    "alignIndex": 0,
    "grabbedOnly": true
  }, local_0_0("atk", o1360(m1360), 0.833, 0.36, p301.ACTION_RIGHT, 0, true), local_0_0("place", o1360(n1360), 0.917, 0.36, p301.ACTION_RIGHT, 1, true), local_0_0("jump", n421, 0.889, 0.64, p301.MOVE_RIGHT, 0, true), local_0_0("sneak", o421, 0.8, 0.81, p301.MOVE_RIGHT, 1, true), local_0_0("key_E", p421, 0.778, 0.017, p301.FUNC_TOP_RIGHT, 0, false), local_0_0("key_ESC", q421, 0.846, 0.017, p301.FUNC_TOP_RIGHT, 1, false), e1360("input", 0.778, 0.106, 2), e1360("edit", 0.914, 0.017, 5), e1360("visibility", 0.778, 0.195, 6), local_0_0("key_Q", h1360, 0.846, 0.106, p301.FUNC_TOP_RIGHT, 3, true), local_0_0("key_F", g1360, 0.914, 0.106, p301.FUNC_TOP_RIGHT, 4, true), local_0_0("key_F3", k1360, 0.014, 0.017, p301.DEBUG_TOP_LEFT, 0, false), local_0_0("key_F5", l1360, 0.082, 0.017, p301.DEBUG_TOP_LEFT, 1, false), local_0_0("key_TAB", j1360, 0.15, 0.017, p301.DEBUG_TOP_LEFT, 2, false)];
  for (v9 = 1; v9 <= 9; v9 += 1) {
    acc = {
      "id": "hb" + v9.toString(),
      "label": "",
      "type": o301.BUTTON,
      "keyOrMouse": l301 + v9 - 1,
      "xPct": 0.5 + ((v9 - 5) * 54 - 48 / 2) / 720,
      "yPct": 0.017,
      "baseWidth": c421,
      "baseHeight": c421,
      "itemScale": 1,
      "isCircle": false,
      "style": {
        "cornerRadius": e421
      },
      "alignGroup": p301.HOTBAR,
      "alignIndex": v9 - 1,
      "grabbedOnly": true
    };
    v8.push(acc);
  }
  v8.push(f1360());
  v8.push(r421(0.34, 0.9, 300, 36));
  return {
    "version": b421,
    "name": "默认",
    "globalScale": 1,
    "lookSensitivity": n374,
    "invertY": o374,
    "joystickDeadZone": s301,
    "haptic": true,
    "targetDevice": "any",
    "hotbarAutoAdded": true,
    "controls": v8
  };
}
local_0_16 = function (p0) {
  return p0 === undefined || typeof p0 === "boolean";
};
export function r301(p0) {
  let v1, v2;
  let v0 /*d285*/ = 0;
  for (v1 = []; v0 < p0.controls.length; v0 += 1) {
    v1.push(y473(p0.controls[v0]));
  }
  v0 = 3;
  v2 = {
    "version": null,
    "controlGroups": null,
    "defaultControlGroupId": null,
    "requiredCapabilities": null,
    "profileId": null,
    "profileRevision": null,
    "name": null,
    "globalScale": null,
    "lookSensitivity": null,
    "invertY": null,
    "lookSmoothing": null,
    "lookAccel": null,
    "lookPolicies": null,
    "joystickDeadZone": null,
    "haptic": null,
    "touch": null,
    "globalOpacity": null,
    "targetDevice": null,
    "isPreset": null,
    "deviceModel": null,
    "hotbarAutoAdded": null,
    "snapEnabled": null,
    "snapGap": null,
    "snapStrength": null,
    "gamepad": null,
    "controls": null
  };
  if (p0.version !== null && p0.version !== undefined) {
    v0 = p0.version;
  }
  v2.version = v0;
  v2.controlGroups = x421(p0.controlGroups);
  v2.defaultControlGroupId = p0.defaultControlGroupId;
  v2.requiredCapabilities = p0.requiredCapabilities === null || p0.requiredCapabilities === undefined ? undefined : p0.requiredCapabilities.slice();
  v2.profileId = p0.profileId;
  v2.profileRevision = p0.profileRevision;
  v2.name = p0.name;
  v2.globalScale = p0.globalScale;
  v2.lookSensitivity = p0.lookSensitivity;
  v2.invertY = p0.invertY;
  v2.lookSmoothing = p0.lookSmoothing;
  v2.lookAccel = p0.lookAccel;
  v2.lookPolicies = s374(p0.lookPolicies);
  v2.joystickDeadZone = p0.joystickDeadZone;
  v2.haptic = p0.haptic;
  v2.touch = p0.touch === undefined ? undefined : d285(p0.touch);
  v2.globalOpacity = p0.globalOpacity;
  v2.targetDevice = p0.targetDevice;
  v2.isPreset = p0.isPreset;
  v2.deviceModel = p0.deviceModel;
  v2.hotbarAutoAdded = p0.hotbarAutoAdded;
  v2.snapEnabled = p0.snapEnabled;
  v2.snapGap = p0.snapGap;
  v2.snapStrength = p0.snapStrength;
  v2.gamepad = local_0_2(p0.gamepad);
  v2.controls = v1;
  return v2;
}
export function r421(p0, p1, p2, p3) {
  return {
    "id": "hotbar_sel",
    "label": "",
    "type": o301.HOTBAR_SELECTOR,
    "keyOrMouse": l301,
    "xPct": p0,
    "yPct": p1,
    "baseWidth": p2,
    "baseHeight": p3,
    "itemScale": 1,
    "isCircle": false,
    "style": {
      "cornerRadius": 0.12
    },
    "alignGroup": p301.NONE,
    "alignIndex": 0,
    "grabbedOnly": true,
    "hideOnInput": []
  };
}
local_0_10 = function (p0, p1, p2) {
  if (p0.reason.length === 0) {
    p0.reason = p1 + "." + p2;
  }
  return null;
};
export function s421(p0, p1) {
  let v3 = 1;
  while (true) {
    if (v3 >= p0 || v3 >= p1 || Math.floor(p0 / (v3 + 1)) < 320 || Math.floor(p1 / (v3 + 1)) < 240) break;
    v3 += 1;
  }
  return v3;
}
local_0_18 = function (p0, p1, p2, p3) {
  let v1, v2, v3, v4, v5, v6, v7, v8, v9, acc;
  if (!p0) {
    return local_0_10(p2, p3, "not-object");
  }
  if (p1 > 8) {
    return local_0_10(p2, p3, "depth");
  }
  if (p2.count >= 256) {
    return local_0_10(p2, p3, "count");
  }
  v1 = 0;
  if (typeof p0.id !== "string" || p0.id.length === 0) {
    return local_0_10(p2, p3, "id-missing");
  }
  if (l50(p0.id) > 23) {
    return local_0_10(p2, p3, "id-length");
  }
  if (p2.usedIds.has(p0.id)) {
    return local_0_10(p2, p3, "id-duplicate");
  }
  if (typeof p0.label !== "string" || (acc = l50(p0.label), (typeof p0.label !== "string") > 256)) {
    return local_0_10(p2, p3, "label");
  }
  if (!local_0_11(p0.type)) {
    return local_0_10(p2, p3, "type");
  }
  if (!local_0_12(p0.keyOrMouse)) {
    return local_0_10(p2, p3, "keyOrMouse");
  }
  if (local_0_13(p0.xPct, v1, 1)) {
    if (!local_0_13(p0.yPct, v1, 1)) {
      return local_0_10(p2, p3, "position");
    }
    if (local_0_13(p0.baseWidth, 1, 4096)) {
      if (!local_0_13(p0.baseHeight, 1, 4096)) {
        return local_0_10(p2, p3, "size");
      }
      if (p0.itemScale !== undefined) {
        if (!local_0_13(p0.itemScale, 0.1, 10)) {
          return local_0_10(p2, p3, "itemScale");
        }
      }
      if (typeof p0.isCircle === "boolean") {
        if (p0.trigger !== undefined) {
          if (!local_0_14(p0.trigger)) {
            return local_0_10(p2, p3, "trigger");
          }
        }
        if (p0.alignGroup !== undefined) {
          if (!local_0_15(p0.alignGroup)) {
            return local_0_10(p2, p3, "alignGroup");
          }
        }
        if (p0.alignIndex !== undefined) {
          if (!local_0_8(p0.alignIndex, v1, 255)) {
            return local_0_10(p2, p3, "alignIndex");
          }
        }
        if (p0.grabbedOnly !== undefined && typeof p0.grabbedOnly !== "boolean") {
          return local_0_10(p2, p3, "grabbedOnly");
        }
        v4 = p0.trigger ?? "press";
        v5 = p0.alignGroup ?? p301.NONE;
        v6 = p0.alignIndex ?? v1;
        v7 = p0.grabbedOnly ?? false;
        v8 = !local_0_16(p0.menuOnly) || !local_0_16(p0.hidden) || !local_0_16(p0.locked);
        if (!v8) {
          if (!local_0_16(p0.dragLook)) {
            return local_0_10(p2, p3, "flags");
          }
          if (p0.keys !== undefined) {
            if (!Array.isArray(p0.keys) || p0.keys.length > 6) {
              return local_0_10(p2, p3, "keys");
            }
            for (v8 = v1; v8 < p0.keys.length; v8 += 1) {
              if (!local_0_9(p0.keys[v8])) {
                return local_0_10(p2, p3, "keys");
              }
            }
          }
          if (p0.systemAction !== undefined && p0.systemAction !== "input" && p0.systemAction !== "edit" && p0.systemAction !== "visibility" && p0.systemAction !== "mouse") {
            return local_0_10(p2, p3, "systemAction");
          }
          v8 = p0.type === o301.BUTTON && p0.systemAction === undefined;
          if (p0.type === o301.BUTTON && p0.systemAction === undefined) {
            v8 = !p0.keys || p0.keys.length === v1;
          }
          if (v8) {
            v8 = !local_0_9(p0.keyOrMouse);
          }
          if (v8) {
            if (p0.keys === undefined || p0.keys.length !== v1 || p0.keyOrMouse !== v1) {
              return local_0_10(p2, p3, "no-output");
            }
          }
          if (p0.modifiers !== undefined) {
            if (!local_0_8(p0.modifiers, v1, 65535)) {
              return local_0_10(p2, p3, "modifiers");
            }
          }
          if (p0.swipeGroup !== undefined) {
            v8 = typeof p0.swipeGroup !== "string";
            if (typeof p0.swipeGroup === "string") {
              v8 = l50(p0.swipeGroup) > 23;
            }
            if (!v8) {
              v8 = p0.swipeGroup.length > v1;
              if (p0.swipeGroup.length > v1) {
                v8 = p0.type !== o301.BUTTON || v4 !== "press" || p0.dragLook === true || p0.systemAction !== undefined;
              }
            }
            if (v8) {
              return local_0_10(p2, p3, "swipeGroup");
            }
          }
          if (p0.visibilityOverride !== undefined && p0.visibilityOverride !== "auto" && p0.visibilityOverride !== "force_show" && p0.visibilityOverride !== "force_hide") {
            return local_0_10(p2, p3, "visibilityOverride");
          }
          if (p0.hideOnInput !== undefined) {
            if (!Array.isArray(p0.hideOnInput) || p0.hideOnInput.length > 3) {
              return local_0_10(p2, p3, "hideOnInput");
            }
            for (v2 = v1; v2 < p0.hideOnInput.length; v2 += 1) {
              if (p0.hideOnInput[v2] !== "mouse" && p0.hideOnInput[v2] !== "keyboard" && p0.hideOnInput[v2] !== "mouse_and_keyboard") {
                return local_0_10(p2, p3, "hideOnInput");
              }
            }
          }
          if (p0.style === undefined) {
            if (p0.children !== undefined) {
              if (!Array.isArray(p0.children)) {
                return local_0_10(p2, p3, "children");
              }
            }
            if (p0.hotbarUserPlaced !== undefined && typeof p0.hotbarUserPlaced !== "boolean") {
              return local_0_10(p2, p3, "hotbarUserPlaced");
            }
            p2.usedIds.add(p0.id);
            p2.count = p2.count + 1;
            v2 = local_0_1(p0, undefined);
            v2.itemScale = p0.itemScale ?? 1;
            v2.trigger = v4;
            v2.alignGroup = v5;
            v2.alignIndex = v6;
            v2.grabbedOnly = v7;
            if (local_0_17(v2.label)) {
              v2.label = "";
            }
            if (v2.hideOnInput === undefined) {
              v2.hideOnInput = b1360(v2);
            }
            if (v2.id === "joystick" && v2.hideOnInput.length === v1) {
              v2.hideOnInput = b1360(v2);
            }
            if (p0.children) {
              for (v2.children = []; v1 < p0.children.length; v1 += 1) {
                v3 = local_0_18(p0.children[v1], p1 + 1, p2, p3 + ".children[" + v1.toString() + "]");
                if (!v3) {
                  return null;
                }
                v2.children.push(v3);
              }
            }
            return v2;
          }
          if (!p0.style || typeof p0.style !== "object") {
            return local_0_10(p2, p3, "style");
          }
          v9 = p0.style.bg !== undefined;
          if (p0.style.bg !== undefined) {
            v9 = typeof p0.style.bg !== "string";
            if (typeof p0.style.bg === "string") {
              v9 = p0.style.bg.length > 64;
            }
          }
          if (!v9 && (v9 = p0.style.bgPressed !== undefined, p0.style.bgPressed !== undefined)) {
            v9 = typeof p0.style.bgPressed !== "string";
            if (typeof p0.style.bgPressed === "string") {
              v9 = p0.style.bgPressed.length > 64;
            }
          }
          if (!v9) {
            v9 = p0.style.fg !== undefined;
            if (p0.style.fg !== undefined) {
              v9 = typeof p0.style.fg !== "string";
              if (typeof p0.style.fg === "string") {
                v9 = p0.style.fg.length > 64;
              }
            }
            if (v9) {
              return local_0_10(p2, p3, "style");
            }
            if (p0.style.opacity !== undefined) {
              if (!local_0_13(p0.style.opacity, 0.1, 1)) {
                return local_0_10(p2, p3, "style");
              }
            }
            if (p0.style.cornerRadius !== undefined) {
              if (!local_0_13(p0.style.cornerRadius, v1, 1)) {
                return local_0_10(p2, p3, "style");
              }
            }
            if (p0.style.shape !== undefined && p0.style.shape !== "circle" && p0.style.shape !== "square" && p0.style.shape !== "rounded" && p0.style.shape !== "diamond") {
              return local_0_10(p2, p3, "style");
            }
            if (p0.children !== undefined) {
              if (!Array.isArray(p0.children)) {
                return local_0_10(p2, p3, "children");
              }
            }
            if (p0.hotbarUserPlaced !== undefined && typeof p0.hotbarUserPlaced !== "boolean") {
              return local_0_10(p2, p3, "hotbarUserPlaced");
            }
            p2.usedIds.add(p0.id);
            p2.count = p2.count + 1;
            v2 = local_0_1(p0, undefined);
            v2.itemScale = p0.itemScale ?? 1;
            v2.trigger = v4;
            v2.alignGroup = v5;
            v2.alignIndex = v6;
            v2.grabbedOnly = v7;
            if (local_0_17(v2.label)) {
              v2.label = "";
            }
            if (v2.hideOnInput === undefined) {
              v2.hideOnInput = b1360(v2);
            }
            if (v2.id === "joystick" && v2.hideOnInput.length === v1) {
              v2.hideOnInput = b1360(v2);
            }
            if (p0.children) {
              for (v2.children = []; v1 < p0.children.length; v1 += 1) {
                v3 = local_0_18(p0.children[v1], p1 + 1, p2, p3 + ".children[" + v1.toString() + "]");
                if (!v3) {
                  return null;
                }
                v2.children.push(v3);
              }
            }
            return v2;
          }
          return local_0_10(p2, p3, "style");
        }
        return local_0_10(p2, p3, "flags");
      }
      return local_0_10(p2, p3, "isCircle");
    }
    return local_0_10(p2, p3, "size");
  }
  return local_0_10(p2, p3, "position");
};
export function t301(p0) {
  if (p0.keys && p0.keys.length > 0) {
    return p0.keys;
  }
  if (p0.keys !== undefined && p0.keys.length === 0 && p0.keyOrMouse === 0) {
    return [];
  }
  return [p0.keyOrMouse];
}
export function t421(p0, p1, p2) {
  let v0, v1;
  if (p2 < 1) {
    p2 = 1;
  }
  v0 = (Math.floor(Math.ceil(p0 / p2) / 2) - 90) * p2;
  v1 = (Math.ceil(p1 / p2) - 22) * p2;
  if (v0 + 180 * p2 > p0) {
    v0 = p0 - 180 * p2;
  }
  if (v0 < 0) {
    v0 = 0;
  }
  if (v1 + 22 * p2 > p1) {
    v1 = p1 - 22 * p2;
  }
  if (v1 < 0) {
    v1 = 0;
  }
  return {
    "leftPx": v0,
    "topPx": v1,
    "widthPx": 180 * p2,
    "heightPx": 22 * p2
  };
}
local_0_21 = function (p0) {
  let v0, v1, v3;
  if (p0 === undefined) {
    return true;
  }
  if (!p0 || typeof p0 !== "object") {
    return false;
  }
  if (!local_0_16(p0.enabled)) {
    return false;
  }
  if (p0.leftStick !== undefined && p0.leftStick !== "move" && p0.leftStick !== "look" && p0.leftStick !== "none") {
    return false;
  }
  if (p0.rightStick !== undefined && p0.rightStick !== "move" && p0.rightStick !== "look" && p0.rightStick !== "none") {
    return false;
  }
  v0 = 0;
  if (p0.stickDeadZone !== undefined) {
    if (!local_0_13(p0.stickDeadZone, 0, 0.95)) {
      return false;
    }
  }
  if (p0.triggerThreshold !== undefined) {
    if (!local_0_13(p0.triggerThreshold, 0, 1)) {
      return false;
    }
  }
  if (p0.lookScale !== undefined) {
    if (!local_0_13(p0.lookScale, 0.1, 10)) {
      return false;
    }
  }
  if (p0.buttonMap !== undefined) {
    if (!p0.buttonMap || typeof p0.buttonMap !== "object" || Array.isArray(p0.buttonMap)) {
      return false;
    }
    v1 = Object.keys(p0.buttonMap);
    if (v1.length > 64) {
      return false;
    }
    while (v0 < v1.length) {
      if (!p0.buttonMap[v1[v0]]) {
        return false;
      }
      if (p0.buttonMap[v1[v0]].kind !== "key" && p0.buttonMap[v1[v0]].kind !== "hotbarPrev" && p0.buttonMap[v1[v0]].kind !== "hotbarNext" && p0.buttonMap[v1[v0]].kind !== "none") {
        return false;
      }
      if (p0.buttonMap[v1[v0]].kind === "key") {
        v3 = p0.buttonMap[v1[v0]].code === undefined;
        if (p0.buttonMap[v1[v0]].code !== undefined) {
          v3 = !local_0_9(p0.buttonMap[v1[v0]].code);
        }
        if (v3) {
          return false;
        }
      }
      if (p0.buttonMap[v1[v0]].kind !== "key" && p0.buttonMap[v1[v0]].code !== undefined) {
        return false;
      }
      v0 += 1;
    }
  }
  return true;
};
local_0_19 = function (p0) {
  return {
    "profile": null,
    "reason": p0
  };
};
export function w1359(p0) {
  let v0 /*d285*/, v2, v3, v4 /*s374*/, v5 /*b422*/, v10, v11, v12, v13, v14, v15, acc;
  if (!p0) {
    return local_0_19("profile.not-object");
  }
  if (p0.profileId !== undefined) {
    v0 = typeof p0.profileId !== "string";
    if (typeof p0.profileId === "string") {
      v0 = !new RegExp("^[a-zA-Z0-9_-]{1,64}$").test(p0.profileId);
    }
    if (v0) {
      return local_0_19("profile.identity");
    }
  }
  if (p0.profileRevision !== undefined) {
    if (!Number.isSafeInteger(p0.profileRevision) || p0.profileRevision < 1) {
      return local_0_19("profile.revision");
    }
  }
  v2 = typeof p0.name !== "string";
  if (typeof p0.name === "string") {
    v2 = p0.name.length === 0;
  }
  if (v2 || (v2 = 256, l50(p0.name) > 256)) {
    return local_0_19("profile.name");
  }
  if (!Array.isArray(p0.controls)) {
    return local_0_19("profile.controls");
  }
  if (p0.version !== undefined) {
    if (!local_0_8(p0.version, 1, b422)) {
      return local_0_19("profile.version");
    }
  }
  if (p0.lookPolicies !== undefined) {
    if (p0.version !== 4 && p0.version !== b422 || s374(p0.lookPolicies) === undefined) {
      return local_0_19("profile.lookPolicies");
    }
  }
  if (p0.version === 4 && p0.lookPolicies === undefined) {
    return local_0_19("profile.lookPolicies.missing");
  }
  v3 = local_0_20(p0);
  if (v3.length > 0) {
    return local_0_19("profile." + v3);
  }
  if (p0.globalScale !== undefined) {
    if (!local_0_13(p0.globalScale, 0.5, 2)) {
      return local_0_19("profile.globalScale");
    }
  }
  if (p0.lookSensitivity !== undefined) {
    if (!local_0_13(p0.lookSensitivity, 0.3, 3)) {
      return local_0_19("profile.lookSensitivity");
    }
  }
  if (p0.lookSmoothing !== undefined) {
    if (!local_0_13(p0.lookSmoothing, 0.1, 1)) {
      return local_0_19("profile.lookSmoothing");
    }
  }
  if (p0.lookAccel !== undefined) {
    if (!local_0_13(p0.lookAccel, 0, 1)) {
      return local_0_19("profile.lookAccel");
    }
  }
  if (p0.joystickDeadZone !== undefined) {
    if (!local_0_13(p0.joystickDeadZone, 0.01, 0.95)) {
      return local_0_19("profile.joystickDeadZone");
    }
  }
  if (p0.globalOpacity !== undefined) {
    if (!local_0_13(p0.globalOpacity, 0.1, 1)) {
      return local_0_19("profile.globalOpacity");
    }
  }
  v10 = p0.globalScale ?? 1;
  v11 = p0.lookSensitivity ?? 1;
  v12 = p0.lookSmoothing ?? 0.6;
  v13 = p0.lookAccel ?? 0;
  v14 = p0.joystickDeadZone ?? 0.18;
  v15 = p0.globalOpacity ?? 1;
  if (local_0_13(v10, 0.5, 2) && local_0_13(v11, 0.3, 3) && local_0_13(v12, 0.1, 1) && local_0_13(v13, 0, 1) && local_0_13(v14, 0.01, 0.95)) {
    if (!local_0_13(v15, 0.1, 1)) {
      return local_0_19("profile.defaults");
    }
    if (local_0_16(p0.invertY) && local_0_16(p0.haptic) && local_0_16(p0.isPreset) && local_0_16(p0.hotbarAutoAdded)) {
      if (!local_0_16(p0.snapEnabled)) {
        return local_0_19("profile.flags");
      }
      if (p0.snapGap !== undefined) {
        if (!local_0_13(p0.snapGap, 0, 400)) {
          return local_0_19("profile.snapGap");
        }
      }
      if (p0.snapStrength !== undefined) {
        if (!local_0_13(p0.snapStrength, 1, 60)) {
          return local_0_19("profile.snapStrength");
        }
      }
      if (p0.targetDevice !== undefined && p0.targetDevice !== "phone" && p0.targetDevice !== "tablet" && p0.targetDevice !== "foldable" && p0.targetDevice !== "any") {
        return local_0_19("profile.targetDevice");
      }
      if (!local_0_21(p0.gamepad)) {
        return local_0_19("profile.gamepad");
      }
      if (d285(p0.touch) === undefined) {
        return local_0_19("profile.touch");
      }
      v0 = {
        "usedIds": new Set(),
        "count": 0,
        "reason": ""
      };
      v3 = [];
      for (v4 = 0; v4 < p0.controls.length; v4 += 1) {
        v5 = local_0_18(p0.controls[v4], 0, v0, "control[" + v4.toString() + "]");
        if (!v5) {
          v0 = v0.reason.length > 0 ? v0.reason : "control[" + v4.toString() + "].invalid";
          return local_0_19(v0);
        }
        v3.push(v5);
      }
      v0 = r301(p0);
      v0.version = c1359(p0);
      v0.globalScale = v10;
      v0.lookSensitivity = v11;
      v0.invertY = p0.invertY ?? o374;
      v0.lookSmoothing = v12;
      v0.lookAccel = v13;
      v0.joystickDeadZone = v14;
      v0.haptic = p0.haptic ?? true;
      v0.globalOpacity = v15;
      v0.targetDevice = p0.targetDevice ?? "any";
      v0.deviceModel = typeof p0.deviceModel === "string" && (v4 = p0.deviceModel, acc = l50(p0.deviceModel), acc <= v2) ? p0.deviceModel : undefined;
      v0.controls = v3;
      return {
        "profile": v0,
        "reason": ""
      };
    }
    return local_0_19("profile.flags");
  }
  return local_0_19("profile.defaults");
}
export function w301(p0) {
  let v0 /*e421*/ = p0.style === null || p0.style === undefined ? undefined : p0.style.cornerRadius;
  if (v0 === undefined) {
    v0 = p0.style === null || p0.style === undefined ? undefined : p0.style.shape;
    switch (v0) {
      case "circle":
        return 1;
      case "square":
        return 0;
      case "rounded":
        return 0.3;
      default:
        if (p0.isCircle) {
          return 1;
        }
        return e421;
    }
  } else {
    if (v0 < 0) {
      v0 = 0;
    } else if (v0 > 1) {
      v0 = 1;
    }
    return v0;
  }
}
export function w374() {
  return {
    "enabled": true,
    "buttonMap": x374(),
    "leftStick": "move",
    "rightStick": "look",
    "stickDeadZone": y374,
    "triggerThreshold": z374,
    "lookScale": 1
  };
}
export function x1358(p0, p1) {
  let v0 = h421(p0);
  if (v0 === "always") {
    return true;
  }
  if (v0 === "game") {
    return p1;
  }
  return !p1;
}
export function x1359(p0) {
  let v0, v1, v2, v3;
  if (p0 && typeof p0 === "object") {
    if (!Array.isArray(p0.controls)) {
      return null;
    }
    v0 = 0;
    v1 = JSON.parse(JSON.stringify(p0));
    v2 = new Set();
    v3 = [];
    local_0_22(v1.controls, 0, v2, v3);
    if (v3.length === 0) {
      return null;
    }
    while (v0 < v3.length) {
      v3[v0].id = local_0_7(v2);
      v0 += 1;
    }
    return {
      "profile": v1,
      "repaired": v3.length
    };
  }
  return null;
}
export function x301(p0) {
  let v1;
  if (p0.label && p0.label.length > 0) {
    return p0.label;
  }
  switch (p0.type) {
    case o301.JOYSTICK:
    case o301.SCROLL_WHEEL:
    case o301.HOTBAR_SELECTOR:
      return "";
  }
  v1 = t301(p0);
  if (v1.length === 0) {
    return p0.type === o301.BUTTON ? "未绑定" : "";
  }
  if (v1.length > 1) {
    return v1.map(function (p0) {
      return p1360(p0);
    }).join("+");
  }
  return p1360(v1[0]);
}
export function x374() {
  let v0 = {};
  v0.A = {
    "kind": "key",
    "code": n421
  };
  v0.B = {
    "kind": "key",
    "code": o421
  };
  v0.X = {
    "kind": "key",
    "code": o1360(n1360)
  };
  v0.Y = {
    "kind": "key",
    "code": g1360
  };
  v0.L1 = {
    "kind": "hotbarPrev"
  };
  v0.R1 = {
    "kind": "hotbarNext"
  };
  v0.L2 = {
    "kind": "key",
    "code": h1360
  };
  v0.R2 = {
    "kind": "key",
    "code": o1360(m1360)
  };
  v0.START = {
    "kind": "key",
    "code": q421
  };
  v0.SELECT = {
    "kind": "key",
    "code": j1360
  };
  v0.MODE = {
    "kind": "none"
  };
  v0.L3 = {
    "kind": "none"
  };
  v0.R3 = {
    "kind": "none"
  };
  v0.DPAD_UP = {
    "kind": "none"
  };
  v0.DPAD_DOWN = {
    "kind": "none"
  };
  v0.DPAD_LEFT = {
    "kind": "hotbarPrev"
  };
  v0.DPAD_RIGHT = {
    "kind": "hotbarNext"
  };
  return v0;
}
export function y1358(p0) {
  let v0 /*f421*/ = p0.globalOpacity;
  if (p0.globalOpacity === undefined) {
    return f421;
  }
  if (p0.globalOpacity < 0.1) {
    v0 = 0.1;
  } else if (p0.globalOpacity > 1) {
    v0 = 1;
  }
  return v0;
}
local_0_22 = function (p0, p1, p2, p3) {
  let v3;
  if (p1 > 8) {
    return;
  }
  for (v3 = 0; v3 < p0.length; v3 += 1) {
    if (p0[v3] && typeof p0[v3] === "object") {
      if (typeof p0[v3].id === "string" && p0[v3].id.length > 0) {
        if (l50(p0[v3].id) > 23 || p2.has(p0[v3].id)) {
          p3.push(p0[v3]);
        } else {
          p2.add(p0[v3].id);
        }
      }
      if (p0[v3].children !== undefined && Array.isArray(p0[v3].children)) {
        local_0_22(p0[v3].children, p1 + 1, p2, p3);
      }
    }
  }
  return;
};
export function y301(p0, p1) {
  let v0 = 1;
  let v2 = g421(p0) * y1358(p1);
  if (v2 < 0.05) {
    v0 = 0.05;
  } else if (v2 <= 1) {
    v0 = v2;
  }
  return v0;
}
export function y420(p0, p1) {
  let v0;
  let local_1_0, local_1_1;
  v0 = y473(p0);
  local_1_0 = new Set();
  local_0_4(p1, local_1_0);
  local_1_1 = function (p0) {
    let v0;
    p0.id = local_0_7(local_1_0);
    if (p0.children) {
      for (v0 = 0; v0 < p0.children.length; v0 += 1) {
        local_1_1(p0.children[v0]);
      }
    }
  };
  local_1_1(v0);
  return v0;
}
export function y421(p0) {
  let v1, v5;
  let v0 = r301(p0);
  if (v0.controlGroups === undefined) {
    v1 = z420(v0.controls);
    v0.controlGroups = [{
      "id": v1,
      "name": "默认组",
      "initialVisible": true
    }];
    v0.defaultControlGroupId = v1;
    v0.requiredCapabilities = [v1357];
    v0.version = b422;
    for (v5 of v0.controls) {
      if (v5.systemAction !== "visibility" && v5.systemAction !== "edit") {
        v5.controlGroupId = v1;
      }
    }
  }
  return v0;
}
export function y473(p0) {
  let v1;
  let v0 = p0.children === undefined ? undefined : [];
  if (p0.children && v0) {
    for (v1 = 0; v1 < p0.children.length; v1 += 1) {
      v0.push(y473(p0.children[v1]));
    }
  }
  return local_0_1(p0, v0);
}
local_0_0 = function (p0, p1, p2, p3, p4, p5, p6) {
  return {
    "id": p0,
    "label": "",
    "type": o301.BUTTON,
    "keyOrMouse": p1,
    "xPct": p2,
    "yPct": p3,
    "baseWidth": c421,
    "baseHeight": c421,
    "itemScale": 1,
    "isCircle": false,
    "style": {
      "cornerRadius": e421
    },
    "alignGroup": p4,
    "alignIndex": p5,
    "grabbedOnly": p6
  };
};
export function z1359(p0) {
  return a421(p0);
}
export function z420(p0) {
  let v0 = new Set();
  local_0_4(p0, v0);
  return local_0_7(v0);
}
export function z421(p0, p1, p2) {
  let v0, v1, v2, v5;
  if (v1 === undefined) {
    return null;
  }
  v2 = z420(v0.controls);
  v0.controlGroups.push({
    "id": v2,
    "name": p2,
    "initialVisible": v1.initialVisible
  });
  v1 = new Map();
  v1.set(local_1_0, v2);
  for (v5 of p0.controls) {
    if (v5.controlGroupId === local_1_0) {
      v5 = y420(v5, v0.controls);
      local_0_3(v5, v1);
      v0.controls.push(v5);
    }
  }
  return a421(v0);
}
export const b421 = 3;
export const r374 = 4;
export const o301 = {
  BUTTON: 0,
  0: "BUTTON",
  JOYSTICK: 1,
  1: "JOYSTICK",
  SCROLL_WHEEL: 2,
  2: "SCROLL_WHEEL",
  DRAWER: 3,
  3: "DRAWER",
  HOTBAR_SELECTOR: 4,
  4: "HOTBAR_SELECTOR"
};
export const p301 = {
  NONE: "none",
  HOTBAR: "hotbar",
  ACTION_RIGHT: "action_right",
  MOVE_RIGHT: "move_right",
  FUNC_TOP_RIGHT: "func_top_right",
  DEBUG_TOP_LEFT: "debug_top_left"
};
export const v421 = 6;
export const w421 = 5;
export const n374 = 1;
export const o374 = false;
export const p374 = 0.6;
export const q374 = 0;
export const s301 = 0.18;
export const f421 = 1;
export const c421 = 48;
export const d421 = 1;
export const e421 = 0.12;
export const y374 = 0.18;
export const z374 = 0.5;
local_0_5 = 0;
local_0_6 = Math.floor(Math.random() * 1679616).toString(36);
export const w1360 = 256;
export const w412 = 6;
export const v301 = 8;
export const u301 = 9;
b1361 = "ime_chat";
c1361 = "sys_edit";
d1361 = "sys_vis";