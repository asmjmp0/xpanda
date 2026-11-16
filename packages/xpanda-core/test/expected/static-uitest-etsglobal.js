/*
* class name:L@ohos/UiTest/ETSGLOBAL;
* Source code created from an ArkTS-Sta .abc file.
* powered by xpanda decompiler, author: jmp0
*/
let domain, tag, currentState, executeTime;
(function () {
  domain = 0;
  tag = "uitestTag";
  currentState = 0;
  executeTime = 3;
})();
function doSetupIfNeeded() {
  if (!GetConnectionStat()) {
    info(0, "uitestTag", concatStrings("On static loadAndSetUpUiTest: ", toString(loadAndSetUpUiTest())), new Array());
  }
}
function loadAndSetUpUiTest() {
  let v2, v3;
  info(0, "uitestTag", "loadAndSetUpUiTest", new Array());
  if (GetConnectionStat() === 1) {
    info(0, "uitestTag", concatStrings("Uitest is already connected: ", toString(GetConnectionStat())), new Array());
    return 1;
  }
  v2 = getAbilityDelegator();
  info(0, "uitestTag", "after abilityDelegatorRegistry.getAbilityDelegator();", new Array());
  try {
    info(0, "uitestTag", "UiTestKit_exporter: Got AbilityDelegator", new Array());
    info(0, "uitestTag", concatStrings("Uitest.ScheduleEstablishConnection(): ", toString(ScheduleEstablishConnection("default"))), new Array());
    info(0, "uitestTag", "UiTestKit_exporter: Begin executing shell command to start server-daemon", new Array());
    v2 = v2.executeShellCommand("uitest start-daemon default", new Long(executeTime)).then(arg0 => {
      info(0, "uitestTag", "UiTestKit_exporter: Start server-daemon finished!!!!", new Array());
      return null;
    }, null);
    v2.catch(arg0 => {
      error(0, "uitestTag", concatStrings("UiTestKit_exporter: Start server-daemon failed:", arg0.toString()), new Array());
    });
    return 1;
  } catch (catchAcc) {
    v3 = catchAcc.get_stack();
    error(0, "uitestTag", concatStrings("loadAndSetUpUiTest failed", v3 !== null ? v3.toString() : "undefined"), new Array());
    error(0, "uitestTag", concatStrings("Uitest.GetConnectionStat(): ", toString(GetConnectionStat())), new Array());
    return 0;
  }
}