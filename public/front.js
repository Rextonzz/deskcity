// The front door's script (src/hub/modules.js frontDoorHtml): go to this device's pick from the campus's View picker
// (campus.display in the browser), else the hub's display setting. "pages" goes to the page named in the meta tag.
// A file, not inline, so the Content-Security-Policy can refuse inline scripts (security plan 05).
(function () {
  var meta = function (name) { var el = document.querySelector('meta[name="' + name + '"]'); return el ? el.getAttribute("content") || "" : ""; };
  var d = null;
  try { d = localStorage.getItem("campus.display"); } catch (e) {}
  location.replace((d || meta("hub-display")) === "pages" ? meta("hub-pages") || "/agents.html" : "/campus.html");
})();
