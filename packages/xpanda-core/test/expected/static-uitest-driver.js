/*
* class name:L@ohos/UiTest/Driver;
* Source code created from an ArkTS-Sta .abc file.
* powered by xpanda decompiler, author: jmp0
*/
class Driver {
  nativeDriver;
  drag(p0, p1, p2, p3, p4) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.dragSync(p0, p1, p2, p3, p4);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  click(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.clickSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  fling(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.flingSyncDirection(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  swipe(p0, p1, p2, p3, p4) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.swipeSync(p0, p1, p2, p3, p4);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  constructor(p0) {
    this.nativeDriver = "";
    doSetupIfNeeded();
    info(domain, tag, concatStrings("driver:", p0), new Array());
    this.nativeDriver = p0;
  }
  static create() {
    doSetupIfNeeded();
    return createInner();
  }
  clickAt(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.clickAtSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  delayMs(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.delayMsSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  dragSync(p0, p1, p2, p3, p4) {
    /* native method */
  }
  penClick(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.penClickSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  penSwipe(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.penSwipeSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  clickSync(p0, p1) {
    /* native method */
  }
  flingSync(p0, p1, p2, p3) {
    /* native method */
  }
  inputText(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.inputTextSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  longClick(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.longClickSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  mouseDrag(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseDragSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  pressBack() {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.pressBackSync();
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  pressHome() {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.pressHomeSync();
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  screenCap(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.screenCapSync(p0, null);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  swipeSync(p0, p1, p2, p3, p4) {
    /* native method */
  }
  dumpLayout(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.dumpLayoutSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  findWindow(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.findWindowSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc;
        if (arg0) {
          info(domain, tag, "findWindow return UIWindow object", new Array());
          acc = resolve(arg0);
          if (acc === null) {
            return null;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        }
        acc = resolve(null);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  mouseClick(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseClickSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  triggerKey(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.triggerKeySync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  clickAtSync(p0) {
    /* native method */
  }
  static createInner() {
    /* native method */
  }
  crownRotate(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.crownRotateSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  delayMsSync(p0) {
    /* native method */
  }
  doubleClick(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.doubleClickSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  dragBetween(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.dragBetweenSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  longClickAt(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.longClickAtSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  mouseMoveTo(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseMoveToSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  mouseScroll(p0, p1, p2, p3, p4) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseScrollSync(p0, p1, p2, p3, p4, new Int(20));
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  waitForIdle(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.waitForIdleSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  knuckleKnock(p0, p1) {
    return new Promise((resolve, reject) => {
      let v3;
      let acc = p0.get_length();
      let v2 = acc;
      if (!(acc < 1 ? 1 : 0) && acc <= 2) {
        acc = new BusinessError();
        acc.set_code(17000007);
        acc.set_name("Error");
        acc.set_message("Point counts must be 1 to 2.");
        v3 = reject(acc);
        if (v3 !== null) {
          throw failedTypeCastInclUndefinedStub(v3, null);
        }
      }
      v3 = p0.$_get(0);
      if (v2 === 1) {
        execute(() => {
          return this.kunckleClickOnePointSync(v3, p1);
        }, new Array(0)).then(arg0 => {
          let acc = resolve(Promise.resolve());
          if (acc === null) {
            return null;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        }, arg0 => {
          let acc = reject(arg0);
          if (acc === null) {
            return;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        });
      } else {
        execute(new lambda_lambda_invoke_442(this, p1, v3, p0.$_get(1)), new Array(0)).then(arg0 => {
          let acc = resolve(Promise.resolve());
          if (acc === null) {
            return null;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        }, arg0 => {
          let acc = reject(arg0);
          if (acc === null) {
            return;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        });
      }
    });
  }
  penClickSync(p0) {
    /* native method */
  }
  penLongClick(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.penLongClickSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  penSwipeSync(p0, p1, p2, p3) {
    /* native method */
  }
  swipeBetween(p0, p1, p2) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.swipeBetweenSync(p0, p1, p2);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  doubleClickAt(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.doubleClickAtSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  findComponent(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.findComponentSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc;
        if (arg0) {
          info(domain, tag, "findComponent return Component object", new Array());
          acc = resolve(arg0);
          if (acc === null) {
            return null;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        }
        acc = resolve(null);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  inputTextSync(p0, p1) {
    /* native method */
  }
  longClickSync(p0, p1) {
    /* native method */
  }
  mouseDragSync(p0, p1, p2, p3) {
    /* native method */
  }
  pressBackSync() {
    /* native method */
  }
  pressHomeSync() {
    /* native method */
  }
  screenCapSync(p0, p1) {
    /* native method */
  }
  screenCapture(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.screenCaptureSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  triggerPenKey(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.triggerPenKeySync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  wakeUpDisplay() {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.wakeUpDisplaySync();
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  dumpLayoutSync(p0, p1) {
    /* native method */
  }
  findComponents(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.findComponentsSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc;
        if (arg0) {
          acc = resolve(arg0);
          if (acc === null) {
            return null;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        }
        acc = resolve(null);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  findWindowSync(p0) {
    /* native method */
  }
  getDisplaySize() {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.getDisplaySizeSync();
      }, new Array(0)).then(arg0 => {
        let acc = resolve(arg0);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  mouseClickSync(p0, p1, p2, p3) {
    /* native method */
  }
  mouseLongClick(p0, p1, p2, p3, p4) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseLongClickSync(p0, p1, p2, p3, p4);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  penDoubleClick(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.penDoubleClickSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  triggerKeySync(p0) {
    /* native method */
  }
  crownRotateSync(p0, p1) {
    /* native method */
  }
  doubleClickSync(p0, p1) {
    /* native method */
  }
  dragBetweenSync(p0, p1, p2, p3) {
    /* native method */
  }
  longClickAtSync(p0, p1) {
    /* native method */
  }
  mouseMoveToSync(p0) {
    /* native method */
  }
  mouseScrollSync(p0, p1, p2, p3, p4, p5) {
    /* native method */
  }
  waitForIdleSync(p0, p1) {
    /* native method */
  }
  mouseDoubleClick(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseDoubleClickSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  penLongClickSync(p0, p1) {
    /* native method */
  }
  swipeBetweenSync(p0, p1, p2) {
    /* native method */
  }
  waitForComponent(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.waitForComponentSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc;
        if (arg0) {
          acc = resolve(arg0);
          if (acc === null) {
            return null;
          }
          throw failedTypeCastInclUndefinedStub(acc, null);
        }
        acc = resolve(null);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  doubleClickAtSync(p0) {
    /* native method */
  }
  findComponentSync(p0) {
    /* native method */
  }
  getDisplayDensity() {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.getDisplayDensitySync(null);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(arg0);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  lambda_invoke_442(p0, p1, p2) {
    return this.kunckleClickTwoPointSync(p1, p2, p0);
  }
  screenCaptureSync(p0, p1) {
    /* native method */
  }
  triggerPenKeySync(p0, p1, p2, p3) {
    /* native method */
  }
  wakeUpDisplaySync() {
    /* native method */
  }
  clickAtWithOptions(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.clickAtTouchOptionsSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  findComponentsSync(p0) {
    /* native method */
  }
  flingSyncDirection(p0, p1) {
    /* native method */
  }
  getDisplayRotation() {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.getDisplayRotationSync(null);
      }, new Array(0)).then(arg0 => {
        let acc;
        info(domain, tag, "getDisplayRotationSync return DisplayRotation", new Array());
        acc = resolve(arg0);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  getDisplaySizeSync() {
    /* native method */
  }
  mouseLongClickSync(p0, p1, p2, p3, p4) {
    /* native method */
  }
  mouseMoveWithTrack(p0, p1, p2) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseMoveWithTrackSync(p0, p1, p2);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  penDoubleClickSync(p0) {
    /* native method */
  }
  setDisplayRotation(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.setDisplayRotationSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  triggerCombineKeys(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.triggerCombineKeysSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  assertComponentExist(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.assertComponentExistSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  mouseDoubleClickSync(p0, p1, p2, p3) {
    /* native method */
  }
  mouseDragWithOptions(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.mouseDragWithOptionsSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  waitForComponentSync(p0, p1) {
    /* native method */
  }
  createUIEventObserver() {
    /* native method */
  }
  getDisplayDensitySync(p0) {
    /* native method */
  }
  inputTextWithModeSync(p0, p1, p2) {
    /* native method */
  }
  dragBetweenWithOptions(p0, p1, p2) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.dragBetweenTouchOptionsSync(p0, p1, p2);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  flingWithDisplayIdSync(p0, p1, p2) {
    /* native method */
  }
  getDisplayRotationSync(p0) {
    /* native method */
  }
  injectPenPointerAction(p0, p1, p2) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.injectPenPointerActionSync(p0, p1, p2);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  longClickAtWithOptions(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.longClickAtTouchOptionsSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  mouseMoveWithTrackSync(p0, p1, p2) {
    /* native method */
  }
  setDisplayRotationSync(p0) {
    /* native method */
  }
  triggerCombineKeysSync(p0, p1, p2, p3) {
    /* native method */
  }
  clickAtTouchOptionsSync(p0, p1) {
    /* native method */
  }
  swipeBetweenWithOptions(p0, p1, p2) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.swipeBetweenTouchOptionsSync(p0, p1, p2);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  assertComponentExistSync(p0) {
    /* native method */
  }
  injectMultiPointerAction(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.injectMultiPointerActionSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  kunckleClickOnePointSync(p0, p1) {
    /* native method */
  }
  kunckleClickTwoPointSync(p0, p1, p2) {
    /* native method */
  }
  mouseDragWithOptionsSync(p0, p1, p2, p3) {
    /* native method */
  }
  touchPadMultiFingerSwipe(p0, p1, p2) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.touchPadMultiFingerSwipeSync(p0, p1, p2);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  touchPadTwoFingersScroll(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.touchPadTwoFingersScrollSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  setDisplayRotationEnabled(p0) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.setDisplayRotationEnabledSync(p0);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  injectKnucklePointerAction(p0, p1) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.injectKnucklePointerActionSync(p0, p1);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(Promise.resolve());
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  injectPenPointerActionSync(p0, p1, p2) {
    /* native method */
  }
  isComponentPresentWhenDrag(p0, p1, p2, p3, p4) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.isComponentPresentWhenDragSync(p0, p1, p2, p3, p4);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  pressBackWithDisplayIdSync(p0) {
    /* native method */
  }
  pressHomeWithDisplayIdSync(p0) {
    /* native method */
  }
  dragBetweenTouchOptionsSync(p0, p1, p2) {
    /* native method */
  }
  isComponentPresentWhenSwipe(p0, p1, p2, p3) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.isComponentPresentWhenSwipeSync(p0, p1, p2, p3);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  longClickAtTouchOptionsSync(p0, p1) {
    /* native method */
  }
  triggerKeyWithDisplayIdSync(p0, p1) {
    /* native method */
  }
  injectMultiPointerActionSync(p0, p1) {
    /* native method */
  }
  swipeBetweenTouchOptionsSync(p0, p1, p2) {
    /* native method */
  }
  touchPadMultiFingerSwipeSync(p0, p1, p2) {
    /* native method */
  }
  touchPadTwoFingersScrollSync(p0, p1, p2, p3) {
    /* native method */
  }
  setDisplayRotationEnabledSync(p0) {
    /* native method */
  }
  injectKnucklePointerActionSync(p0, p1) {
    /* native method */
  }
  isComponentPresentWhenDragSync(p0, p1, p2, p3, p4) {
    /* native method */
  }
  getDisplaySizeWithDisplayIdSync(p0) {
    /* native method */
  }
  isComponentPresentWhenLongClick(p0, p1, p2) {
    return new Promise((resolve, reject) => {
      execute(() => {
        return this.isComponentPresentWhenLongClickSync(p0, p1, p2);
      }, new Array(0)).then(arg0 => {
        let acc = resolve(new Boolean(arg0.toBoolean()));
        if (acc === null) {
          return null;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      }, arg0 => {
        let acc = reject(arg0);
        if (acc === null) {
          return;
        }
        throw failedTypeCastInclUndefinedStub(acc, null);
      });
    });
  }
  isComponentPresentWhenSwipeSync(p0, p1, p2, p3) {
    /* native method */
  }
  isComponentPresentWhenLongClickSync(p0, p1, p2) {
    /* native method */
  }
}