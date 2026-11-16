/*
* class name:L@ohos/UiTest/ComponentEventType;
* Source code created from an ArkTS-Sta .abc file.
* powered by xpanda decompiler, author: jmp0
*/
class ComponentEventType extends BaseEnum {
  #ordinal;
  static COMPONENT_UNDEFINED;
  static COMPONENT_CLICKED;
  static COMPONENT_LONG_CLICKED;
  static COMPONENT_SCROLL_START;
  static COMPONENT_SCROLL_END;
  static COMPONENT_TEXT_CHANGED;
  static #NamesArray;
  static #ValuesArray;
  static #StringValuesArray;
  static #ItemsArray;
  static {
    (function () {
      let v0;
      ComponentEventType.COMPONENT_UNDEFINED = new ComponentEventType(0, 0);
      ComponentEventType.COMPONENT_CLICKED = new ComponentEventType(1, 1);
      ComponentEventType.COMPONENT_LONG_CLICKED = new ComponentEventType(2, 2);
      ComponentEventType.COMPONENT_SCROLL_START = new ComponentEventType(3, 3);
      ComponentEventType.COMPONENT_SCROLL_END = new ComponentEventType(4, 4);
      ComponentEventType.COMPONENT_TEXT_CHANGED = new ComponentEventType(5, 5);
      v0 = new Array(6);
      v0[0] = "COMPONENT_UNDEFINED";
      v0[1] = "COMPONENT_CLICKED";
      v0[2] = "COMPONENT_LONG_CLICKED";
      v0[3] = "COMPONENT_SCROLL_START";
      v0[4] = "COMPONENT_SCROLL_END";
      v0[5] = "COMPONENT_TEXT_CHANGED";
      ComponentEventType.#NamesArray = v0;
      v0 = new Array(6);
      v0[0] = new Int(0);
      v0[1] = new Int(1);
      v0[2] = new Int(2);
      v0[3] = new Int(3);
      v0[4] = new Int(4);
      v0[5] = new Int(5);
      ComponentEventType.#ValuesArray = v0;
      v0 = new Array(6);
      v0[0] = "0";
      v0[1] = "1";
      v0[2] = "2";
      v0[3] = "3";
      v0[4] = "4";
      v0[5] = "5";
      ComponentEventType.#StringValuesArray = v0;
      v0 = new Array(6);
      v0[0] = ComponentEventType.COMPONENT_UNDEFINED;
      v0[1] = ComponentEventType.COMPONENT_CLICKED;
      v0[2] = ComponentEventType.COMPONENT_LONG_CLICKED;
      v0[3] = ComponentEventType.COMPONENT_SCROLL_START;
      v0[4] = ComponentEventType.COMPONENT_SCROLL_END;
      v0[5] = ComponentEventType.COMPONENT_TEXT_CHANGED;
      ComponentEventType.#ItemsArray = v0;
    })();
  }
  static $_get(p0) {
    return p0.getName();
  }
  constructor(p0, p1) {
    super(new Int(p1));
    this.#ordinal = p0;
  }
  static values() {
    return ComponentEventType.#ItemsArray;
  }
  getName() {
    return ComponentEventType.#NamesArray[this.#ordinal];
  }
  valueOf() {
    return ComponentEventType.#ValuesArray[this.#ordinal].toInt();
  }
  toString() {
    return ComponentEventType.#StringValuesArray[this.#ordinal];
  }
  static fromValue(p0) {
    let v0;
    for (v0 = ComponentEventType.#ValuesArray.length - 1; v0 >= 0; v0 += -1) {
      if (ComponentEventType.#ValuesArray[v0].toInt() === p0) {
        return ComponentEventType.#ItemsArray[v0];
      }
    }
    throw new Error(concatStrings("No enum ComponentEventType with value ", toString(p0)), null);
  }
  getOrdinal() {
    return this.#ordinal;
  }
  static getValueOf(p0) {
    let v0;
    for (v0 = ComponentEventType.#NamesArray.length - 1; v0 >= 0; v0 += -1) {
      if (p0.equals(ComponentEventType.#NamesArray[v0])) {
        return ComponentEventType.#ItemsArray[v0];
      }
    }
    throw new Error(concatStrings("No enum constant ComponentEventType.", p0), null);
  }
}