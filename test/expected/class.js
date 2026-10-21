/*
* class name:L_GLOBAL;
* Source code created from a .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let v0, acc;
acc = class panda_jmp0_reserved_class_0 {
  constructor() {
    this.c = 10;
  }
  test() {
    console.log("123");
  }
};
v0 = acc;
acc = acc.prototype;
acc.__defineGetter__("c", function c() {
  return "10";
});
let Test = v0;
new Test().test();