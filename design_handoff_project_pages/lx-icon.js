// <lx-icon name="house"></lx-icon> — renders a Lucide line icon (the design
// system's icon set) from the lucide UMD global, inheriting currentColor.
// Draws into a shadow root so the host framework never sees the svg.
(function () {
  if (customElements.get("lx-icon")) return;
  const pascal = (n) => n.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
  class LxIcon extends HTMLElement {
    static get observedAttributes() { return ["name", "size", "stroke"]; }
    constructor() { super(); this.attachShadow({ mode: "open" }); }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      const name = this.getAttribute("name");
      if (!name) return;
      const L = window.lucide;
      if (!L) { if (!this._t) this._t = setTimeout(() => { this._t = null; this.render(); }, 40); return; }
      const key = pascal(name);
      const node = (L.icons && (L.icons[key] || L.icons[name])) || L[key];
      if (!node) return;
      const size = this.getAttribute("size") || "16";
      const stroke = this.getAttribute("stroke") || "1.5";
      let svg;
      try { svg = L.createElement(node, { width: size, height: size, "stroke-width": stroke }); }
      catch (e) { return; }
      svg.setAttribute("width", size); svg.setAttribute("height", size); svg.setAttribute("stroke-width", stroke);
      svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
      const style = document.createElement("style");
      style.textContent = ":host{display:inline-flex;flex:0 0 auto;vertical-align:middle;line-height:0}svg{display:block;width:100%;height:100%}";
      this.shadowRoot.replaceChildren(style, svg);
    }
  }
  customElements.define("lx-icon", LxIcon);
})();
