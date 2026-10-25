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
let a421, a422, b1360, b1361, b421, b474, c1359, c1360, c1361, c421, d1359, d1360, d1361, d421, e1360, e421, f1360, f421, g1359, g421, h1359, h421, i421, l50, n374, o301, o374, p301, p374, q301, q374, r301, r374, r421, s301, s421, t301, t421, u301, v301, v421, w1359, w1360, w301, w374, w412, w421, x1358, x1359, x301, x374, y1358, y301, y374, y420, y421, y473, z1359, z374, z420, z421;
let local_0_0, local_0_1, local_0_2, local_0_3, local_0_4, local_0_5, local_0_6, local_0_7, local_0_8, local_0_9, local_0_10, local_0_11, local_0_12, local_0_13, local_0_14, local_0_15, local_0_16, local_0_17, local_0_18, local_0_19, local_0_20, local_0_21, local_0_22;
local_0_1 = function (p0, p1) {
  let v0;
  v0 = {
    "id": null,
    "label": null,
    "type": null,
    "keyOrMouse": null,
    "keys": null,
    "modifiers": null,
    "trigger": null,
    "xPct": null,
    "yPct": null,
    "baseWidth": null,
    "baseHeight": null,
    "itemScale": null,
    "isCircle": null,
    "style": null,
    "alignGroup": null,
    "alignIndex": null,
    "grabbedOnly": null,
    "menuOnly": null,
    "hidden": null,
    "locked": null,
    "visibilityOverride": null,
    "hideOnInput": null,
    "dragLook": null,
    "swipeGroup": null,
    "controlGroupId": null,
    "groupActions": null,
    "phaseBindings": null,
    "gesturePolicy": null,
    "hotbarUserPlaced": null,
    "systemAction": null,
    "children": null
  };
  v0.id = p0.id;
  v0.label = p0.label;
  v0.type = p0.type;
  v0.keyOrMouse = p0.keyOrMouse;
  v0.keys = p0.keys ? p0.keys.slice() : undefined;
  v0.modifiers = p0.modifiers;
  v0.trigger = p0.trigger;
  v0.xPct = p0.xPct;
  v0.yPct = p0.yPct;
  v0.baseWidth = p0.baseWidth;
  v0.baseHeight = p0.baseHeight;
  v0.itemScale = p0.itemScale;
  v0.isCircle = p0.isCircle;
  v0.style = p0.style ? {
    "bg": p0.style.bg,
    "bgPressed": p0.style.bgPressed,
    "fg": p0.style.fg,
    "opacity": p0.style.opacity,
    "shape": p0.style.shape,
    "cornerRadius": p0.style.cornerRadius
  } : undefined;
  v0.alignGroup = p0.alignGroup;
  v0.alignIndex = p0.alignIndex;
  v0.grabbedOnly = p0.grabbedOnly;
  v0.menuOnly = p0.menuOnly;
  v0.hidden = p0.hidden;
  v0.locked = p0.locked;
  v0.visibilityOverride = p0.visibilityOverride;
  v0.hideOnInput = p0.hideOnInput ? p0.hideOnInput.slice() : undefined;
  v0.dragLook = p0.dragLook;
  v0.swipeGroup = p0.swipeGroup;
  v0.controlGroupId = p0.controlGroupId;
  v0.groupActions = o1357(p0.groupActions);
  v0.phaseBindings = p1357(p0.phaseBindings);
  v0.gesturePolicy = p0.gesturePolicy;
  v0.hotbarUserPlaced = p0.hotbarUserPlaced;
  v0.systemAction = p0.systemAction;
  v0.children = p1;
  return v0;
};
local_0_17 = function (p0) {
  return p0 === "⚔" || p0 === "🛡" || p0 === "▲" || p0 === "▼";
};
a421 = function (p0) {
  return w1359(p0).profile;
};
a422 = function (p0, p1, p2) {
  let v0, v4;
  let local_1_0, local_1_1, local_1_2;
  local_1_0 = p1;
  local_1_1 = p2;
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
};
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
b1360 = function (p0) {
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
};
b474 = function (p0, p1) {
  let v0, v1;
  let local_1_0;
  local_1_0 = p1;
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
};
c1359 = function (p0) {
  return p0.controlGroups !== undefined ? b422 : p0.lookPolicies === undefined ? b421 : r374;
};
c1360 = function (p0, p1, p2) {
  let v0, v1;
  v0 = p0.visibilityOverride ?? "auto";
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
};
d1359 = function (p0) {
  let v0;
  v0 = (p0.groupActions === null || p0.groupActions === undefined ? undefined : p0.groupActions.some(function (p0) {
    return p0.targets.length > 0;
  })) ?? false;
  if (!v0) {
    v0 = p0.phaseBindings === undefined ? t301(p0).length > 0 : p0.phaseBindings.some(function (p0) {
      return p0.keys.length > 0;
    });
  }
  return v0;
};
d1360 = function (p0) {
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
};
local_0_20 = function (p0) {
  let v1 /*r1367*/, v2 /*c422*/, v4, v5, acc;
  let local_1_0, local_1_1, local_1_2, local_1_3, local_1_4, local_1_5;
  local_1_1 = p0.version === b422;
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
        v4 = v4.id;
        acc = local_1_2.add(v4);
      }
      if (!Array.isArray(p0.requiredCapabilities) || p0.requiredCapabilities.length > 2 || p0.requiredCapabilities.indexOf(v1357) < 0) {
        return "groups.capabilities";
      }
      v1 = new Set();
      v2 = p0.requiredCapabilities[Symbol.iterator]();
      while (true) {
        v5 = v2.next();
        if (v5.done) break;
        v5 = v5.value;
        if (v5 !== v1357 && v5 !== c422 || v1.has(v5)) {
          if (v2.return != undefined) {
            v2.return();
          }
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
      v4 = v4.id;
      acc = local_1_2.add(v4);
    }
    if (!Array.isArray(p0.requiredCapabilities) || p0.requiredCapabilities.length > 2 || p0.requiredCapabilities.indexOf(v1357) < 0) {
      return "groups.capabilities";
    }
    v1 = new Set();
    v2 = p0.requiredCapabilities[Symbol.iterator]();
    while (true) {
      v5 = v2.next();
      if (v5.done) break;
      v5 = v5.value;
      if (v5 !== v1357 && v5 !== c422 || v1.has(v5)) {
        if (v2.return != undefined) {
          v2.return();
        }
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
e1360 = function (p0, p1, p2, p3) {
  let v1 /*c421*/, v2 /*e421*/, acc;
  acc = {
    "id": d1360(p0),
    "label": null,
    "type": null,
    "systemAction": null,
    "keyOrMouse": null,
    "xPct": null,
    "yPct": null,
    "baseWidth": null,
    "baseHeight": null,
    "itemScale": 1,
    "isCircle": false,
    "style": null,
    "alignGroup": null,
    "alignIndex": null,
    "grabbedOnly": null,
    "menuOnly": false
  };
  v1 = p0 === "input" ? "输入" : p0 === "edit" ? "设置" : p0 === "mouse" ? "鼠标" : "显示";
  v2 = 0;
  acc.label = v1;
  acc.type = o301.BUTTON;
  acc.systemAction = p0;
  if (p0 === "input") {
    v2 = i1360;
  }
  acc.keyOrMouse = v2;
  acc.xPct = p1;
  acc.yPct = p2;
  acc.baseWidth = c421;
  acc.baseHeight = c421;
  acc.style = {
    "cornerRadius": e421
  };
  acc.alignGroup = p301.FUNC_TOP_RIGHT;
  acc.alignIndex = p3;
  acc.grabbedOnly = p0 === "visibility";
  return acc;
};
local_0_3 = function (p0, p1) {
  let v1, v3;
  let local_1_0;
  local_1_0 = p1;
  if (p0.controlGroupId !== undefined) {
    p0.controlGroupId = local_1_0.get(p0.controlGroupId) ?? p0.controlGroupId;
  }
  v1 = p0.groupActions ?? [];
  for (v3 of v1) {
    v3.targets = v3.targets.map(function (p0) {
      let v0;
      v0 = local_1_0.get(p0);
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
f1360 = function () {
  let v0;
  v0 = e1360("mouse", 0.94, 0.9, 7);
  v0.alignGroup = p301.NONE;
  return v0;
};
g1359 = function (p0) {
  let v3 /*w1366*/, v5;
  let local_1_0, local_1_1;
  local_1_0 = r301(p0);
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
    let v0;
    v0 = y420(p0, local_1_0.controls);
    local_0_3(v0, local_1_1);
    return v0;
  });
  return local_1_0;
};
g421 = function (p0) {
  let v0 /*d421*/;
  v0 = p0.style === null || p0.style === undefined ? undefined : p0.style.opacity;
  if (v0 === undefined) {
    return d421;
  }
  if (v0 < 0.1) {
    v0 = 0.1;
  } else if (v0 > 1) {
    v0 = 1;
  }
  return v0;
};
h1359 = function (p0) {
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
};
h421 = function (p0) {
  if (p0.menuOnly === true) {
    return "menu";
  }
  if (p0.grabbedOnly === true) {
    return "game";
  }
  return "always";
};
local_0_4 = function (p0, p1) {
  let v0;
  for (v0 = 0; v0 < p0.length; v0 += 1) {
    p1.add(p0[v0].id);
    if (p0[v0].children) {
      local_0_4(p0[v0].children, p1);
    }
  }
};
i421 = function (p0, p1) {
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
};
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
l50 = function (p0) {
  let v10, v11, v12;
  v10 = 0;
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
};
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
q301 = function () {
  let v8, v9, acc;
  v8 = [];
  v8[0] = {
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
  };
  v8[1] = local_0_0("atk", o1360(m1360), 0.833, 0.36, p301.ACTION_RIGHT, 0, true);
  v8[2] = local_0_0("place", o1360(n1360), 0.917, 0.36, p301.ACTION_RIGHT, 1, true);
  v8[3] = local_0_0("jump", n421, 0.889, 0.64, p301.MOVE_RIGHT, 0, true);
  v8[4] = local_0_0("sneak", o421, 0.8, 0.81, p301.MOVE_RIGHT, 1, true);
  v8[5] = local_0_0("key_E", p421, 0.778, 0.017, p301.FUNC_TOP_RIGHT, 0, false);
  v8[6] = local_0_0("key_ESC", q421, 0.846, 0.017, p301.FUNC_TOP_RIGHT, 1, false);
  v8[7] = e1360("input", 0.778, 0.106, 2);
  v8[8] = e1360("edit", 0.914, 0.017, 5);
  v8[9] = e1360("visibility", 0.778, 0.195, 6);
  v8[10] = local_0_0("key_Q", h1360, 0.846, 0.106, p301.FUNC_TOP_RIGHT, 3, true);
  v8[11] = local_0_0("key_F", g1360, 0.914, 0.106, p301.FUNC_TOP_RIGHT, 4, true);
  v8[12] = local_0_0("key_F3", k1360, 0.014, 0.017, p301.DEBUG_TOP_LEFT, 0, false);
  v8[13] = local_0_0("key_F5", l1360, 0.082, 0.017, p301.DEBUG_TOP_LEFT, 1, false);
  v8[14] = local_0_0("key_TAB", j1360, 0.15, 0.017, p301.DEBUG_TOP_LEFT, 2, false);
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
};
local_0_16 = function (p0) {
  return p0 === undefined || typeof p0 === "boolean";
};
r301 = function (p0) {
  let v0 /*d285*/, v1, v2;
  v0 = 0;
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
};
r421 = function (p0, p1, p2, p3) {
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
};
local_0_10 = function (p0, p1, p2) {
  if (p0.reason.length === 0) {
    p0.reason = p1 + "." + p2;
  }
  return null;
};
s421 = function (p0, p1) {
  let v3;
  v3 = 1;
  while (true) {
    if (v3 >= p0 || v3 >= p1 || Math.floor(p0 / (v3 + 1)) < 320 || Math.floor(p1 / (v3 + 1)) < 240) break;
    v3 += 1;
  }
  return v3;
};
local_0_18 = function (p0, p1, p2, p3) //The function was created by SimpleAnalysis,because StructureAnalysis failed.
{
  let v2, v3, v8;
  entry: {
    if (p0) decompiler_goto(label_10);
  }
  label_7: {
    decompiler_goto(label_11);
  }
  label_10: {}
  label_11: {
    decompiler_goto(label_33);
  }
  label_16: {
    return local_0_10(p2, p3, "not-object");
  }
  label_33: {
    if (p1 <= 8) decompiler_goto(label_60);
  }
  label_43: {
    return local_0_10(p2, p3, "depth");
  }
  label_60: {
    if (p2.count < 256) decompiler_goto(label_100);
  }
  label_83: {
    return local_0_10(p2, p3, "count");
  }
  label_100: {
    if (typeof p0.id !== "string") decompiler_goto(label_154);
  }
  label_123: {
    if (p0.id.length !== 0) decompiler_goto(label_171);
  }
  label_154: {
    return local_0_10(p2, p3, "id-missing");
  }
  label_171: {
    if (l50(p0.id) <= 23) decompiler_goto(label_222);
  }
  label_205: {
    return local_0_10(p2, p3, "id-length");
  }
  label_222: {
    if (!p2.usedIds.has(p0.id)) decompiler_goto(label_275);
  }
  label_258: {
    return local_0_10(p2, p3, "id-duplicate");
  }
  label_275: {
    if (typeof p0.label !== "string") decompiler_goto(label_328);
  }
  label_298: {
    if (l50(p0.label) <= local_0_10) decompiler_goto(label_345);
  }
  label_328: {
    return local_0_10(p2, p3, "label");
  }
  label_345: {
    if (local_0_11(p0.type)) decompiler_goto(label_371);
  }
  label_368: {
    decompiler_goto(label_372);
  }
  label_371: {}
  label_372: {
    decompiler_goto(label_394);
  }
  label_377: {
    return local_0_10(p2, p3, "type");
  }
  label_394: {
    if (local_0_12(p0.keyOrMouse)) decompiler_goto(label_420);
  }
  label_417: {
    decompiler_goto(label_421);
  }
  label_420: {}
  label_421: {
    decompiler_goto(label_443);
  }
  label_426: {
    return local_0_10(p2, p3, "keyOrMouse");
  }
  label_443: {
    if (local_0_13(p0.xPct, "keyOrMouse", 1)) decompiler_goto(label_478);
  }
  label_475: {
    decompiler_goto(label_479);
  }
  label_478: {}
  label_479: {}
  label_484: {
    if (local_0_13(p0.yPct, "keyOrMouse", 1)) decompiler_goto(label_512);
  }
  label_509: {
    decompiler_goto(label_513);
  }
  label_512: {}
  label_513: {
    decompiler_goto(label_535);
  }
  label_518: {
    return local_0_10(p2, p3, "position");
  }
  label_535: {
    if (local_0_13(p0.baseWidth, local_0_10, 4096)) decompiler_goto(label_570);
  }
  label_567: {
    decompiler_goto(label_571);
  }
  label_570: {}
  label_571: {}
  label_576: {
    if (local_0_13(p0.baseHeight, local_0_10, 4096)) decompiler_goto(label_604);
  }
  label_601: {
    decompiler_goto(label_605);
  }
  label_604: {}
  label_605: {
    decompiler_goto(label_627);
  }
  label_610: {
    return local_0_10(p2, p3, "size");
  }
  label_627: {
    if (p0.itemScale === undefined) decompiler_goto(label_714);
  }
  label_645: {
    if (local_0_13(p0.itemScale, 0.1, 10)) decompiler_goto(label_691);
  }
  label_688: {
    decompiler_goto(label_692);
  }
  label_691: {}
  label_692: {
    decompiler_goto(label_714);
  }
  label_697: {
    return local_0_10(p2, p3, "itemScale");
  }
  label_714: {
    if (typeof p0.isCircle === "boolean") decompiler_goto(label_751);
  }
  label_734: {
    return local_0_10(p2, p3, "isCircle");
  }
  label_751: {
    if (p0.trigger === undefined) decompiler_goto(label_818);
  }
  label_769: {
    if (local_0_14(p0.trigger)) decompiler_goto(label_795);
  }
  label_792: {
    decompiler_goto(label_796);
  }
  label_795: {}
  label_796: {
    decompiler_goto(label_818);
  }
  label_801: {
    return local_0_10(p2, p3, "trigger");
  }
  label_818: {
    if (p0.alignGroup === undefined) decompiler_goto(label_885);
  }
  label_836: {
    if (local_0_15(p0.alignGroup)) decompiler_goto(label_862);
  }
  label_859: {
    decompiler_goto(label_863);
  }
  label_862: {}
  label_863: {
    decompiler_goto(label_885);
  }
  label_868: {
    return local_0_10(p2, p3, "alignGroup");
  }
  label_885: {
    if (p0.alignIndex === undefined) decompiler_goto(label_961);
  }
  label_903: {
    if (local_0_8(p0.alignIndex, "alignGroup", 255)) decompiler_goto(label_938);
  }
  label_935: {
    decompiler_goto(label_939);
  }
  label_938: {}
  label_939: {
    decompiler_goto(label_961);
  }
  label_944: {
    return local_0_10(p2, p3, "alignIndex");
  }
  label_961: {
    if (p0.grabbedOnly === undefined) decompiler_goto(label_1019);
  }
  label_979: {
    if (typeof p0.grabbedOnly === "boolean") decompiler_goto(label_1019);
  }
  label_1002: {
    return local_0_10(p2, p3, "grabbedOnly");
  }
  label_1019: {
    if (p0.trigger === null) decompiler_goto(label_1040);
  }
  label_1034: {
    if (p0.trigger !== undefined) decompiler_goto(label_1045);
  }
  label_1040: {}
  label_1045: {
    if (p0.alignGroup === null) decompiler_goto(label_1066);
  }
  label_1060: {
    if (p0.alignGroup !== undefined) decompiler_goto(label_1075);
  }
  label_1066: {}
  label_1075: {
    if (p0.alignIndex === null) decompiler_goto(label_1100);
  }
  label_1090: {
    if (p0.alignIndex !== undefined) decompiler_goto(label_1102);
  }
  label_1096: {
    decompiler_goto(label_1102);
  }
  label_1100: {}
  label_1102: {
    if (p0.grabbedOnly === null) decompiler_goto(label_1123);
  }
  label_1117: {
    if (p0.grabbedOnly !== undefined) decompiler_goto(label_1126);
  }
  label_1123: {}
  label_1126: {
    if (local_0_16(p0.menuOnly)) decompiler_goto(label_1155);
  }
  label_1150: {
    decompiler_goto(label_1158);
  }
  label_1155: {}
  label_1158: {}
  label_1165: {
    if (local_0_16(p0.hidden)) decompiler_goto(label_1194);
  }
  label_1189: {
    decompiler_goto(label_1197);
  }
  label_1194: {}
  label_1197: {}
  label_1204: {
    if (local_0_16(p0.locked)) decompiler_goto(label_1233);
  }
  label_1228: {
    decompiler_goto(label_1236);
  }
  label_1233: {}
  label_1236: {}
  label_1243: {
    if (local_0_16(p0.dragLook)) decompiler_goto(label_1270);
  }
  label_1267: {
    decompiler_goto(label_1271);
  }
  label_1270: {}
  label_1271: {
    decompiler_goto(label_1293);
  }
  label_1276: {
    return local_0_10(p2, p3, "flags");
  }
  label_1293: {
    if (p0.keys === undefined) decompiler_goto(label_1482);
  }
  label_1309: {
    if (Array.isArray(p0.keys)) decompiler_goto(label_1346);
  }
  label_1343: {
    decompiler_goto(label_1347);
  }
  label_1346: {}
  label_1347: {}
  label_1352: {
    if (p0.keys.length <= 6) decompiler_goto(label_1396);
  }
  label_1379: {
    return local_0_10(p2, p3, "keys");
  }
  label_1396: {}
  label_1398: {
    if ("keys" >= p0.keys.length) decompiler_goto(label_1482);
  }
  label_1415: {
    if (local_0_9(p0.keys.keys)) decompiler_goto(label_1449);
  }
  label_1446: {
    decompiler_goto(label_1450);
  }
  label_1449: {}
  label_1450: {
    decompiler_goto(label_1472);
  }
  label_1455: {
    return local_0_10(p2, p3, "keys");
  }
  label_1472: {
    decompiler_goto(label_1398);
  }
  label_1482: {
    if (p0.systemAction === undefined) decompiler_goto(label_1519);
  }
  label_1502: {}
  label_1519: {
    if (p0.systemAction === "input") decompiler_goto(label_1543);
  }
  label_1526: {}
  label_1543: {
    if (p0.systemAction === "edit") decompiler_goto(label_1567);
  }
  label_1550: {}
  label_1567: {
    if (p0.systemAction === "visibility") decompiler_goto(label_1611);
  }
  label_1574: {
    if (p0.systemAction === "mouse") decompiler_goto(label_1611);
  }
  label_1594: {
    return local_0_10(p2, p3, "systemAction");
  }
  label_1611: {
    if (p0.type !== o301.BUTTON) decompiler_goto(label_1652);
  }
  label_1637: {}
  label_1652: {
    if (p0.systemAction !== undefined) decompiler_goto(label_1707);
  }
  label_1659: {
    if (p0.keys) decompiler_goto(label_1676);
  }
  label_1671: {
    decompiler_goto(label_1679);
  }
  label_1676: {}
  label_1679: {}
  label_1686: {}
  label_1707: {
    if (p0.keys.length !== "systemAction") decompiler_goto(label_1745);
  }
  label_1714: {
    if (local_0_9(p0.keyOrMouse)) decompiler_goto(label_1742);
  }
  label_1737: {
    decompiler_goto(label_1745);
  }
  label_1742: {}
  label_1745: {
    decompiler_goto(label_1849);
  }
  label_1752: {
    if (p0.keys === undefined) decompiler_goto(label_1793);
  }
  label_1772: {}
  label_1793: {
    if (p0.keys.length !== "systemAction") decompiler_goto(label_1816);
  }
  label_1800: {}
  label_1816: {
    if (p0.keyOrMouse === "systemAction") decompiler_goto(label_1826);
  }
  label_1823: {
    decompiler_goto(label_1827);
  }
  label_1826: {}
  label_1827: {
    decompiler_goto(label_1849);
  }
  label_1832: {
    return local_0_10(p2, p3, "no-output");
  }
  label_1849: {
    if (p0.modifiers === undefined) decompiler_goto(label_1925);
  }
  label_1867: {
    if (local_0_8(p0.modifiers, "no-output", 65535)) decompiler_goto(label_1902);
  }
  label_1899: {
    decompiler_goto(label_1903);
  }
  label_1902: {}
  label_1903: {
    decompiler_goto(label_1925);
  }
  label_1908: {
    return local_0_10(p2, p3, "modifiers");
  }
  label_1925: {
    if (p0.swipeGroup === undefined) decompiler_goto(label_2131);
  }
  label_1944: {
    if (typeof p0.swipeGroup !== "string") decompiler_goto(label_1996);
  }
  label_1969: {
    v8 = l50(p0.swipeGroup) > 23;
  }
  label_1996: {
    if (v8) decompiler_goto(label_2107);
  }
  label_2003: {
    if (p0.swipeGroup.length <= "modifiers") decompiler_goto(label_2107);
  }
  label_2029: {
    if (p0.type !== o301.BUTTON) decompiler_goto(label_2063);
  }
  label_2055: {}
  label_2063: {}
  label_2070: {}
  label_2085: {
    if (p0.dragLook === true) decompiler_goto(label_2107);
  }
  label_2092: {}
  label_2107: {
    if (p0.systemAction === undefined) decompiler_goto(label_2131);
  }
  label_2114: {
    return local_0_10(p2, p3, "swipeGroup");
  }
  label_2131: {
    if (p0.visibilityOverride === undefined) decompiler_goto(label_2168);
  }
  label_2151: {}
  label_2168: {
    if (p0.visibilityOverride === "auto") decompiler_goto(label_2192);
  }
  label_2175: {}
  label_2192: {
    if (p0.visibilityOverride === "force_show") decompiler_goto(label_2236);
  }
  label_2199: {
    if (p0.visibilityOverride === "force_hide") decompiler_goto(label_2236);
  }
  label_2219: {
    return local_0_10(p2, p3, "visibilityOverride");
  }
  label_2236: {
    if (p0.hideOnInput === undefined) decompiler_goto(label_2441);
  }
  label_2252: {
    if (Array.isArray(p0.hideOnInput)) decompiler_goto(label_2289);
  }
  label_2286: {
    decompiler_goto(label_2290);
  }
  label_2289: {}
  label_2290: {}
  label_2295: {
    if (p0.hideOnInput.length <= 3) decompiler_goto(label_2339);
  }
  label_2322: {
    return local_0_10(p2, p3, "hideOnInput");
  }
  label_2339: {}
  label_2341: {
    if ("hideOnInput" >= p0.hideOnInput.length) decompiler_goto(label_2441);
  }
  label_2358: {
    if (p0.hideOnInput.hideOnInput === "mouse") decompiler_goto(label_2396);
  }
  label_2388: {}
  label_2396: {
    if (p0.hideOnInput.hideOnInput === "keyboard") decompiler_goto(label_2431);
  }
  label_2403: {
    if (p0.hideOnInput.hideOnInput === "mouse_and_keyboard") decompiler_goto(label_2431);
  }
  label_2414: {
    return local_0_10(p2, p3, "hideOnInput");
  }
  label_2431: {
    decompiler_goto(label_2341);
  }
  label_2441: {
    if (p0.style === undefined) decompiler_goto(label_3046);
  }
  label_2457: {
    if (p0.style) decompiler_goto(label_2472);
  }
  label_2469: {
    decompiler_goto(label_2473);
  }
  label_2472: {}
  label_2473: {}
  label_2478: {
    if (typeof p0.style === "object") decompiler_goto(label_2518);
  }
  label_2501: {
    return local_0_10(p2, p3, "style");
  }
  label_2518: {
    if (p0.style.bg === undefined) decompiler_goto(label_2598);
  }
  label_2552: {
    if (typeof p0.style.bg !== "string") decompiler_goto(label_2598);
  }
  label_2577: {}
  label_2598: {
    if (p0.style.bg.length > 64) decompiler_goto(label_2671);
  }
  label_2605: {
    if (p0.style.bgPressed === undefined) decompiler_goto(label_2671);
  }
  label_2625: {
    if (typeof p0.style.bgPressed !== "string") decompiler_goto(label_2671);
  }
  label_2650: {}
  label_2671: {
    if (p0.style.bgPressed.length > 64) decompiler_goto(label_2751);
  }
  label_2678: {
    if (p0.style.fg === undefined) decompiler_goto(label_2744);
  }
  label_2698: {
    if (typeof p0.style.fg !== "string") decompiler_goto(label_2744);
  }
  label_2723: {}
  label_2744: {
    if (p0.style.fg.length <= 64) decompiler_goto(label_2768);
  }
  label_2751: {
    return local_0_10(p2, p3, "style");
  }
  label_2768: {
    if (p0.style.opacity === undefined) decompiler_goto(label_2848);
  }
  label_2786: {
    if (local_0_13(p0.style.opacity, 0.1, local_0_10)) decompiler_goto(label_2825);
  }
  label_2822: {
    decompiler_goto(label_2826);
  }
  label_2825: {}
  label_2826: {
    decompiler_goto(label_2848);
  }
  label_2831: {
    return local_0_10(p2, p3, "style");
  }
  label_2848: {
    if (p0.style.cornerRadius === undefined) decompiler_goto(label_2917);
  }
  label_2866: {
    if (local_0_13(p0.style.cornerRadius, "style", local_0_10)) decompiler_goto(label_2894);
  }
  label_2891: {
    decompiler_goto(label_2895);
  }
  label_2894: {}
  label_2895: {
    decompiler_goto(label_2917);
  }
  label_2900: {
    return local_0_10(p2, p3, "style");
  }
  label_2917: {
    if (p0.style.shape === undefined) decompiler_goto(label_2954);
  }
  label_2937: {}
  label_2954: {
    if (p0.style.shape === "circle") decompiler_goto(label_2978);
  }
  label_2961: {}
  label_2978: {
    if (p0.style.shape === "square") decompiler_goto(label_3002);
  }
  label_2985: {}
  label_3002: {
    if (p0.style.shape === "rounded") decompiler_goto(label_3046);
  }
  label_3009: {
    if (p0.style.shape === "diamond") decompiler_goto(label_3046);
  }
  label_3029: {
    return local_0_10(p2, p3, "style");
  }
  label_3046: {
    if (p0.children === undefined) decompiler_goto(label_3124);
  }
  label_3064: {
    if (Array.isArray(p0.children)) decompiler_goto(label_3101);
  }
  label_3098: {
    decompiler_goto(label_3102);
  }
  label_3101: {}
  label_3102: {
    decompiler_goto(label_3124);
  }
  label_3107: {
    return local_0_10(p2, p3, "children");
  }
  label_3124: {
    if (p0.hotbarUserPlaced === undefined) decompiler_goto(label_3182);
  }
  label_3142: {
    if (typeof p0.hotbarUserPlaced === "boolean") decompiler_goto(label_3182);
  }
  label_3165: {
    return local_0_10(p2, p3, "hotbarUserPlaced");
  }
  label_3182: {
    p2.usedIds.add(p0.id);
    p2.count = p2.count + 1;
    v2 = local_0_1(p0, undefined);
    if (p0.itemScale === null) decompiler_goto(label_3270);
  }
  label_3260: {
    if (p0.itemScale !== undefined) decompiler_goto(label_3272);
  }
  label_3266: {
    decompiler_goto(label_3272);
  }
  label_3270: {}
  label_3272: {
    v2.itemScale = local_0_10;
    v2.trigger = "press";
    v2.alignGroup = p301.NONE;
    v2.alignIndex = "grabbedOnly";
    v2.grabbedOnly = false;
    if (!local_0_17(v2.label)) decompiler_goto(label_3345);
  }
  label_3336: {
    v2.label = "";
  }
  label_3345: {
    if (v2.hideOnInput !== undefined) decompiler_goto(label_3371);
  }
  label_3360: {
    v2.hideOnInput = b1360(v2);
  }
  label_3371: {
    if (v2.id !== "joystick") decompiler_goto(label_3426);
  }
  label_3391: {
    if (v2.hideOnInput.length !== "hotbarUserPlaced") decompiler_goto(label_3426);
  }
  label_3415: {
    v2.hideOnInput = b1360(v2);
  }
  label_3426: {
    if (!p0.children) decompiler_goto(label_3588);
  }
  label_3439: {
    v2.children = [];
  }
  label_3448: {
    if ("hotbarUserPlaced" >= p0.children.length) decompiler_goto(label_3588);
  }
  label_3466: {
    if (local_0_18(p0.children.hotbarUserPlaced, p1 + local_0_10, p2, p3 + ".children[" + "hotbarUserPlaced".toString() + "]")) decompiler_goto(label_3551);
  }
  label_3548: {
    decompiler_goto(label_3552);
  }
  label_3551: {}
  label_3552: {
    decompiler_goto(label_3559);
  }
  label_3557: {
    return null;
  }
  label_3559: {
    v2.children.push(v3);
    decompiler_goto(label_3448);
  }
  label_3588: {
    return v2;
  }
};
t301 = function (p0) {
  if (p0.keys && p0.keys.length > 0) {
    return p0.keys;
  }
  if (p0.keys !== undefined && p0.keys.length === 0 && p0.keyOrMouse === 0) {
    return [];
  }
  return [p0.keyOrMouse];
};
t421 = function (p0, p1, p2) {
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
};
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
w1359 = function (p0) //The function was created by SimpleAnalysis,because StructureAnalysis failed.
{
  let v0 /*d285*/, v3, v4 /*s374*/, v5 /*b422*/;
  entry: {
    if (p0) decompiler_goto(label_10);
  }
  label_7: {
    decompiler_goto(label_11);
  }
  label_10: {}
  label_11: {
    decompiler_goto(label_32);
  }
  label_16: {
    return local_0_19("profile.not-object");
  }
  label_32: {
    if (p0.profileId === undefined) decompiler_goto(label_158);
  }
  label_50: {
    if (typeof p0.profileId !== "string") decompiler_goto(label_135);
  }
  label_75: {
    if (new RegExp("^[a-zA-Z0-9_-]{1,64}$").test(p0.profileId)) decompiler_goto(label_132);
  }
  label_127: {
    decompiler_goto(label_135);
  }
  label_132: {}
  label_135: {
    decompiler_goto(label_158);
  }
  label_142: {
    return local_0_19("profile.identity");
  }
  label_158: {
    if (p0.profileRevision === undefined) decompiler_goto(label_271);
  }
  label_183: {
    if (Number.isSafeInteger(p0.profileRevision)) decompiler_goto(label_222);
  }
  label_217: {
    decompiler_goto(label_225);
  }
  label_222: {}
  label_225: {}
  label_232: {}
  label_248: {
    if (p0.profileRevision >= 1) decompiler_goto(label_271);
  }
  label_255: {
    return local_0_19("profile.revision");
  }
  label_271: {
    if (typeof p0.name !== "string") decompiler_goto(label_324);
  }
  label_303: {}
  label_324: {
    if (p0.name.length === 0) decompiler_goto(label_368);
  }
  label_331: {
    if (l50(p0.name) <= 256) decompiler_goto(label_384);
  }
  label_368: {
    return local_0_19("profile.name");
  }
  label_384: {
    if (Array.isArray(p0.controls)) decompiler_goto(label_421);
  }
  label_418: {
    decompiler_goto(label_422);
  }
  label_421: {}
  label_422: {
    decompiler_goto(label_443);
  }
  label_427: {
    return local_0_19("profile.controls");
  }
  label_443: {
    if (p0.version === undefined) decompiler_goto(label_519);
  }
  label_461: {
    if (local_0_8(p0.version, local_0_19, b422)) decompiler_goto(label_497);
  }
  label_494: {
    decompiler_goto(label_498);
  }
  label_497: {}
  label_498: {
    decompiler_goto(label_519);
  }
  label_503: {
    return local_0_19("profile.version");
  }
  label_519: {
    if (p0.lookPolicies === undefined) decompiler_goto(label_649);
  }
  label_544: {
    if (p0.version === 4) decompiler_goto(label_589);
  }
  label_565: {}
  label_589: {
    if (p0.version !== b422) decompiler_goto(label_626);
  }
  label_596: {
    v4 = s374(p0.lookPolicies) === undefined;
  }
  label_626: {
    if (!v4) decompiler_goto(label_649);
  }
  label_633: {
    return local_0_19("profile.lookPolicies");
  }
  label_649: {
    if (p0.version !== 4) decompiler_goto(label_702);
  }
  label_668: {
    if (p0.lookPolicies !== undefined) decompiler_goto(label_702);
  }
  label_686: {
    return local_0_19("profile.lookPolicies.missing");
  }
  label_702: {
    v3 = local_0_20(p0);
    if (v3.length <= "profile.lookPolicies.missing") decompiler_goto(label_747);
  }
  label_724: {
    return local_0_19("profile." + v3);
  }
  label_747: {
    if (p0.globalScale === undefined) decompiler_goto(label_833);
  }
  label_772: {
    if (local_0_13(p0.globalScale, 0.5, 2)) decompiler_goto(label_811);
  }
  label_808: {
    decompiler_goto(label_812);
  }
  label_811: {}
  label_812: {
    decompiler_goto(label_833);
  }
  label_817: {
    return local_0_19("profile.globalScale");
  }
  label_833: {
    if (p0.lookSensitivity === undefined) decompiler_goto(label_919);
  }
  label_858: {
    if (local_0_13(p0.lookSensitivity, 0.3, 3)) decompiler_goto(label_897);
  }
  label_894: {
    decompiler_goto(label_898);
  }
  label_897: {}
  label_898: {
    decompiler_goto(label_919);
  }
  label_903: {
    return local_0_19("profile.lookSensitivity");
  }
  label_919: {
    if (p0.lookSmoothing === undefined) decompiler_goto(label_998);
  }
  label_937: {
    if (local_0_13(p0.lookSmoothing, 0.1, local_0_19)) decompiler_goto(label_976);
  }
  label_973: {
    decompiler_goto(label_977);
  }
  label_976: {}
  label_977: {
    decompiler_goto(label_998);
  }
  label_982: {
    return local_0_19("profile.lookSmoothing");
  }
  label_998: {
    if (p0.lookAccel === undefined) decompiler_goto(label_1066);
  }
  label_1016: {
    if (local_0_13(p0.lookAccel, "profile.lookSmoothing", local_0_19)) decompiler_goto(label_1044);
  }
  label_1041: {
    decompiler_goto(label_1045);
  }
  label_1044: {}
  label_1045: {
    decompiler_goto(label_1066);
  }
  label_1050: {
    return local_0_19("profile.lookAccel");
  }
  label_1066: {
    if (p0.joystickDeadZone === undefined) decompiler_goto(label_1156);
  }
  label_1084: {
    if (local_0_13(p0.joystickDeadZone, 0.01, 0.95)) decompiler_goto(label_1134);
  }
  label_1131: {
    decompiler_goto(label_1135);
  }
  label_1134: {}
  label_1135: {
    decompiler_goto(label_1156);
  }
  label_1140: {
    return local_0_19("profile.joystickDeadZone");
  }
  label_1156: {
    if (p0.globalOpacity === undefined) decompiler_goto(label_1235);
  }
  label_1174: {
    if (local_0_13(p0.globalOpacity, 0.1, local_0_19)) decompiler_goto(label_1213);
  }
  label_1210: {
    decompiler_goto(label_1214);
  }
  label_1213: {}
  label_1214: {
    decompiler_goto(label_1235);
  }
  label_1219: {
    return local_0_19("profile.globalOpacity");
  }
  label_1235: {
    if (p0.globalScale === null) decompiler_goto(label_1260);
  }
  label_1250: {
    if (p0.globalScale !== undefined) decompiler_goto(label_1262);
  }
  label_1256: {
    decompiler_goto(label_1262);
  }
  label_1260: {}
  label_1262: {
    if (p0.lookSensitivity === null) decompiler_goto(label_1287);
  }
  label_1277: {
    if (p0.lookSensitivity !== undefined) decompiler_goto(label_1289);
  }
  label_1283: {
    decompiler_goto(label_1289);
  }
  label_1287: {}
  label_1289: {
    if (p0.lookSmoothing === null) decompiler_goto(label_1310);
  }
  label_1304: {
    if (p0.lookSmoothing !== undefined) decompiler_goto(label_1321);
  }
  label_1310: {}
  label_1321: {
    if (p0.lookAccel === null) decompiler_goto(label_1346);
  }
  label_1336: {
    if (p0.lookAccel !== undefined) decompiler_goto(label_1348);
  }
  label_1342: {
    decompiler_goto(label_1348);
  }
  label_1346: {}
  label_1348: {
    if (p0.joystickDeadZone === null) decompiler_goto(label_1369);
  }
  label_1363: {
    if (p0.joystickDeadZone !== undefined) decompiler_goto(label_1380);
  }
  label_1369: {}
  label_1380: {
    if (p0.globalOpacity === null) decompiler_goto(label_1405);
  }
  label_1395: {
    if (p0.globalOpacity !== undefined) decompiler_goto(label_1407);
  }
  label_1401: {
    decompiler_goto(label_1407);
  }
  label_1405: {}
  label_1407: {
    if (local_0_13(local_0_19, 0.5, 2)) decompiler_goto(label_1439);
  }
  label_1434: {
    decompiler_goto(label_1442);
  }
  label_1439: {}
  label_1442: {}
  label_1449: {
    if (local_0_13(local_0_19, 0.3, 3)) decompiler_goto(label_1481);
  }
  label_1476: {
    decompiler_goto(label_1484);
  }
  label_1481: {}
  label_1484: {}
  label_1491: {
    if (local_0_13(0.6, 0.1, local_0_19)) decompiler_goto(label_1523);
  }
  label_1518: {
    decompiler_goto(label_1526);
  }
  label_1523: {}
  label_1526: {}
  label_1533: {
    if (local_0_13("profile.globalOpacity", "profile.globalOpacity", local_0_19)) decompiler_goto(label_1550);
  }
  label_1545: {
    decompiler_goto(label_1553);
  }
  label_1550: {}
  label_1553: {}
  label_1560: {
    if (local_0_13(0.18, 0.01, 0.95)) decompiler_goto(label_1603);
  }
  label_1598: {
    decompiler_goto(label_1606);
  }
  label_1603: {}
  label_1606: {}
  label_1613: {
    if (local_0_13(local_0_19, 0.1, local_0_19)) decompiler_goto(label_1643);
  }
  label_1640: {
    decompiler_goto(label_1644);
  }
  label_1643: {}
  label_1644: {
    decompiler_goto(label_1665);
  }
  label_1649: {
    return local_0_19("profile.defaults");
  }
  label_1665: {
    if (local_0_16(p0.invertY)) decompiler_goto(label_1694);
  }
  label_1689: {
    decompiler_goto(label_1697);
  }
  label_1694: {}
  label_1697: {}
  label_1704: {
    if (local_0_16(p0.haptic)) decompiler_goto(label_1733);
  }
  label_1728: {
    decompiler_goto(label_1736);
  }
  label_1733: {}
  label_1736: {}
  label_1743: {
    if (local_0_16(p0.isPreset)) decompiler_goto(label_1772);
  }
  label_1767: {
    decompiler_goto(label_1775);
  }
  label_1772: {}
  label_1775: {}
  label_1782: {
    if (local_0_16(p0.hotbarAutoAdded)) decompiler_goto(label_1811);
  }
  label_1806: {
    decompiler_goto(label_1814);
  }
  label_1811: {}
  label_1814: {}
  label_1821: {
    if (local_0_16(p0.snapEnabled)) decompiler_goto(label_1848);
  }
  label_1845: {
    decompiler_goto(label_1849);
  }
  label_1848: {}
  label_1849: {
    decompiler_goto(label_1870);
  }
  label_1854: {
    return local_0_19("profile.flags");
  }
  label_1870: {
    if (p0.snapGap === undefined) decompiler_goto(label_1945);
  }
  label_1888: {
    if (local_0_13(p0.snapGap, "profile.flags", 400)) decompiler_goto(label_1923);
  }
  label_1920: {
    decompiler_goto(label_1924);
  }
  label_1923: {}
  label_1924: {
    decompiler_goto(label_1945);
  }
  label_1929: {
    return local_0_19("profile.snapGap");
  }
  label_1945: {
    if (p0.snapStrength === undefined) decompiler_goto(label_2020);
  }
  label_1963: {
    if (local_0_13(p0.snapStrength, local_0_19, 60)) decompiler_goto(label_1998);
  }
  label_1995: {
    decompiler_goto(label_1999);
  }
  label_1998: {}
  label_1999: {
    decompiler_goto(label_2020);
  }
  label_2004: {
    return local_0_19("profile.snapStrength");
  }
  label_2020: {
    if (p0.targetDevice === undefined) decompiler_goto(label_2057);
  }
  label_2040: {}
  label_2057: {
    if (p0.targetDevice === "phone") decompiler_goto(label_2081);
  }
  label_2064: {}
  label_2081: {
    if (p0.targetDevice === "tablet") decompiler_goto(label_2105);
  }
  label_2088: {}
  label_2105: {
    if (p0.targetDevice === "foldable") decompiler_goto(label_2148);
  }
  label_2112: {
    if (p0.targetDevice === "any") decompiler_goto(label_2148);
  }
  label_2132: {
    return local_0_19("profile.targetDevice");
  }
  label_2148: {
    if (local_0_21(p0.gamepad)) decompiler_goto(label_2175);
  }
  label_2172: {
    decompiler_goto(label_2176);
  }
  label_2175: {}
  label_2176: {
    decompiler_goto(label_2197);
  }
  label_2181: {
    return local_0_19("profile.gamepad");
  }
  label_2197: {
    if (d285(p0.touch) !== undefined) decompiler_goto(label_2243);
  }
  label_2227: {
    return local_0_19("profile.touch");
  }
  label_2243: {
    v0 = {
      "usedIds": new Set(),
      "count": 0,
      "reason": ""
    };
  }
  label_2277: {
    if ("profile.touch" >= p0.controls.length) decompiler_goto(label_2472);
  }
  label_2295: {
    if (local_0_18(p0.controls["profile.touch"], "profile.touch", v0, "control[" + "profile.touch".toString() + "]")) decompiler_goto(label_2373);
  }
  label_2370: {
    decompiler_goto(label_2374);
  }
  label_2373: {}
  label_2374: {
    decompiler_goto(label_2450);
  }
  label_2379: {
    if (v0.reason.length <= "profile.touch") decompiler_goto(label_2416);
  }
  label_2405: {
    decompiler_goto(label_2444);
  }
  label_2416: {
    v0 = "control[" + "profile.touch".toString() + "].invalid";
  }
  label_2444: {
    return local_0_19(v0);
  }
  label_2450: {
    v3.push(v5);
    decompiler_goto(label_2277);
  }
  label_2472: {
    v0 = r301(p0);
    v0.version = c1359(p0);
    v0.globalScale = local_0_19;
    v0.lookSensitivity = local_0_19;
    if (p0.invertY === null) decompiler_goto(label_2527);
  }
  label_2521: {
    if (p0.invertY !== undefined) decompiler_goto(label_2535);
  }
  label_2527: {}
  label_2535: {
    v0.invertY = o374;
    v0.lookSmoothing = 0.6;
    v0.lookAccel = "profile.globalOpacity";
    v0.joystickDeadZone = 0.18;
    if (p0.haptic === null) decompiler_goto(label_2588);
  }
  label_2582: {
    if (p0.haptic !== undefined) decompiler_goto(label_2591);
  }
  label_2588: {}
  label_2591: {
    v0.haptic = true;
    v0.globalOpacity = local_0_19;
    if (p0.targetDevice === null) decompiler_goto(label_2628);
  }
  label_2622: {
    if (p0.targetDevice !== undefined) decompiler_goto(label_2633);
  }
  label_2628: {}
  label_2633: {
    v0.targetDevice = "any";
    if (typeof p0.deviceModel !== "string") decompiler_goto(label_2703);
  }
  label_2664: {
    if (l50(p0.deviceModel) > local_0_19) decompiler_goto(label_2703);
  }
  label_2694: {
    decompiler_goto(label_2704);
  }
  label_2703: {}
  label_2704: {
    v0.deviceModel = undefined;
    v0.controls = v3;
    return {
      "profile": v0,
      "reason": ""
    };
  }
};
w301 = function (p0) {
  let v0 /*e421*/;
  v0 = p0.style === null || p0.style === undefined ? undefined : p0.style.cornerRadius;
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
};
w374 = function () {
  return {
    "enabled": true,
    "buttonMap": x374(),
    "leftStick": "move",
    "rightStick": "look",
    "stickDeadZone": y374,
    "triggerThreshold": z374,
    "lookScale": 1
  };
};
x1358 = function (p0, p1) {
  let v0;
  v0 = h421(p0);
  if (v0 === "always") {
    return true;
  }
  if (v0 === "game") {
    return p1;
  }
  return !p1;
};
x1359 = function (p0) {
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
};
x301 = function (p0) {
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
};
x374 = function () {
  let v0;
  v0 = {};
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
};
y1358 = function (p0) {
  let v0 /*f421*/;
  v0 = p0.globalOpacity;
  if (p0.globalOpacity === undefined) {
    return f421;
  }
  if (p0.globalOpacity < 0.1) {
    v0 = 0.1;
  } else if (p0.globalOpacity > 1) {
    v0 = 1;
  }
  return v0;
};
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
y301 = function (p0, p1) {
  let v0, v2;
  v0 = 1;
  v2 = g421(p0) * y1358(p1);
  if (v2 < 0.05) {
    v0 = 0.05;
  } else if (v2 <= 1) {
    v0 = v2;
  }
  return v0;
};
y420 = function (p0, p1) {
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
};
y421 = function (p0) {
  let v0, v1, v5;
  v0 = r301(p0);
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
};
y473 = function (p0) {
  let v0, v1;
  v0 = p0.children === undefined ? undefined : [];
  if (p0.children && v0) {
    for (v1 = 0; v1 < p0.children.length; v1 += 1) {
      v0.push(y473(p0.children[v1]));
    }
  }
  return local_0_1(p0, v0);
};
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
z1359 = function (p0) {
  return a421(p0);
};
z420 = function (p0) {
  let v0;
  v0 = new Set();
  local_0_4(p0, v0);
  return local_0_7(v0);
};
z421 = function (p0, p1, p2) {
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
};
b421 = 3;
r374 = 4;
o301 = {
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
p301 = {
  NONE: "none",
  HOTBAR: "hotbar",
  ACTION_RIGHT: "action_right",
  MOVE_RIGHT: "move_right",
  FUNC_TOP_RIGHT: "func_top_right",
  DEBUG_TOP_LEFT: "debug_top_left"
};
w421 = 5;
n374 = 1;
o374 = false;
p374 = 0.6;
q374 = 0;
s301 = 0.18;
f421 = 1;
c421 = 48;
d421 = 1;
e421 = 0.12;
y374 = 0.18;
z374 = 0.5;
local_0_5 = 0;
local_0_6 = Math.floor(Math.random() * 1679616).toString(36);
w1360 = 256;
w412 = 6;
u301 = 9;
b1361 = "ime_chat";
c1361 = "sys_edit";
d1361 = "sys_vis";
export { a421 };
export { a422 };
export { b1360 };
export { b1361 };
export { b421 };
export { b474 };
export { c1359 };
export { c1360 };
export { c1361 };
export { c421 };
export { d1359 };
export { d1360 };
export { d1361 };
export { d421 };
export { e1360 };
export { e421 };
export { f1360 };
export { f421 };
export { g1359 };
export { g421 };
export { h1359 };
export { h421 };
export { i421 };
export { l50 };
export { n374 };
export { o301 };
export { o374 };
export { p301 };
export { p374 };
export { q301 };
export { q374 };
export { r301 };
export { r374 };
export { r421 };
export { s301 };
export { s421 };
export { t301 };
export { t421 };
export { u301 };
export { v301 };
export { v421 };
export { w1359 };
export { w1360 };
export { w301 };
export { w374 };
export { w412 };
export { w421 };
export { x1358 };
export { x1359 };
export { x301 };
export { x374 };
export { y1358 };
export { y301 };
export { y374 };
export { y420 };
export { y421 };
export { y473 };
export { z1359 };
export { z374 };
export { z420 };
export { z421 };