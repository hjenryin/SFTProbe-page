(() => {
  let revision = 0;
  window.setInteractiveCaption = async html => {
    const el = document.getElementById("caption");
    const turn = ++revision;
    el.getAnimations().forEach(animation => animation.cancel());
    if (el.innerHTML) {
      try {
        await el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }],
          { duration: 160, fill: "forwards", easing: "ease-in-out" }).finished;
      } catch (_) { return; }
      if (turn !== revision) return;
    }
    el.innerHTML = html;
    el.getAnimations().forEach(animation => animation.cancel());
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-in-out" });
  };
})();
