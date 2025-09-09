/* eslint-disable no-undef */
/*
 * analyze.js (v2)
 * - Baseline page analysis (stylesBySelector, fonts, dominant colors, root CSS vars)
 * - Navigation detection + packaged HTML snapshot with inline styles
 * - Largest content elements (by visible area) with fg/bg color + basic style summary
 *
 * Safe caps to avoid heavy work on giant pages.
 */

(function () {
  // ---------------------- Config ----------------------
  var SELECTORS = [
    "h1","h2","h3","h4","h5","h6",
    "p","div","span","a","ul","li","button","input","label",
    "blockquote","code","pre","small","strong","em",
    "section","article","nav","header","footer","main","aside"
  ];
  var NAV_HINTS = [
    "nav","navbar","navigation","menu","menubar","site-nav","top-nav","header-nav","main-nav"
  ];
  var MAX_SCAN_ELEMENTS = 2000;        // general traversal cap
  var MAX_INLINE_NODES   = 200;        // limit nodes to inline-style in nav snapshot
  var MAX_LINKS_IN_NAV   = 200;        // cap link export
  var LARGEST_COUNT      = 3;          // how many largest blocks to report

  // ---------------------- Utilities ----------------------
  function toArray(list){ return Array.prototype.slice.call(list || []); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
  function rgbToHex(r,g,b){
    function h(n){ n = n.toString(16); return n.length===1 ? "0"+n : n; }
    return ("#" + h(r)+h(g)+h(b)).toLowerCase();
  }
  function parseColorToHex(str){
    if (!str || str === "transparent" || str === "inherit") return null;
    var ctx = parseColorToHex._ctx;
    if (!ctx) {
      var c = document.createElement("canvas");
      c.width = 1; c.height = 1;
      parseColorToHex._ctx = c.getContext("2d");
      ctx = parseColorToHex._ctx;
    }
    ctx.clearRect(0,0,1,1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = str;
    var normalized = ctx.fillStyle;
    if (!normalized || typeof normalized !== "string") return null;
    if (normalized[0] === "#") {
      if (normalized.length === 4) {
        var r = normalized[1], g = normalized[2], b = normalized[3];
        return ("#" + r+r + g*g + b*b).toLowerCase();
      }
      return normalized.toLowerCase();
    }
    var m = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/i);
    if (!m) return null;
    var a = m[4] == null ? 1 : parseFloat(m[4]);
    if (a === 0) return null;
    var r = clamp(parseInt(m[1],10), 0, 255);
    var g = clamp(parseInt(m[2],10), 0, 255);
    var b = clamp(parseInt(m[3],10), 0, 255);
    return rgbToHex(r,g,b);
  }
  function getComputedSubset(cs){
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      borderTopColor: cs.borderTopColor,
      borderRightColor: cs.borderRightColor,
      borderBottomColor: cs.borderBottomColor,
      borderLeftColor: cs.borderLeftColor,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
      boxShadow: cs.boxShadow,
      borderRadius: cs.borderRadius
    };
  }
  function uniqueSorted(arr){
    var s = {};
    var out = [];
    for (var i=0;i<arr.length;i++){
      var v = arr[i];
      if (v != null) {
        v = String(v).trim();
        if (v && !s[v]) { s[v] = 1; out.push(v); }
      }
    }
    out.sort();
    return out;
  }

  // ---------------------- Baseline analysis ----------------------
  function collectSelectorStyles(){
    var out = {};
    for (var i=0;i<SELECTORS.length;i++){
      var sel = SELECTORS[i];
      var el = document.querySelector(sel);
      if (!el) continue;
      var cs = getComputedStyle(el);
      out[sel] = getComputedSubset(cs);
    }
    return out;
  }

  function collectFonts(){
    var fonts = [], scanned = 0;
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null, false);
    var node = walker.currentNode;
    while (node && scanned < MAX_SCAN_ELEMENTS){
      if (node.nodeType === 1){
        var cs = getComputedStyle(node);
        if (cs && cs.fontFamily) fonts.push(cs.fontFamily);
        scanned++;
      }
      node = walker.nextNode();
    }
    return uniqueSorted(fonts);
  }

  function tallyColor(map, hex){ if (hex) map[hex] = (map[hex]||0)+1; }
  function isNearWhite(hex){
    if (!hex || hex[0] !== "#" || hex.length !== 7) return false;
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    return (r+g+b) > (255*3 - 45);
  }

  function collectDominantColors(){
    var counts = {}, scanned = 0;
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null, false);
    var node = walker.currentNode;
    while (node && scanned < MAX_SCAN_ELEMENTS){
      if (node.nodeType === 1){
        var cs = getComputedStyle(node);
        if (cs){
          tallyColor(counts, parseColorToHex(cs.color));
          tallyColor(counts, parseColorToHex(cs.backgroundColor));
          tallyColor(counts, parseColorToHex(cs.borderTopColor));
          tallyColor(counts, parseColorToHex(cs.borderRightColor));
          tallyColor(counts, parseColorToHex(cs.borderBottomColor));
          tallyColor(counts, parseColorToHex(cs.borderLeftColor));
        }
        scanned++;
      }
      node = walker.nextNode();
    }
    var entries = [];
    for (var hex in counts){
      if (counts.hasOwnProperty(hex)) {
        if (hex && !isNearWhite(hex)) entries.push({ hex: hex, count: counts[hex] });
      }
    }
    entries.sort(function(a,b){ return b.count - a.count; });
    return entries.slice(0, 16);
  }

  function collectRootCSSVars(){
    var root = document.documentElement;
    var styles = getComputedStyle(root);
    var out = {};
    for (var i=0;i<styles.length;i++){
      var prop = styles[i];
      if (prop.indexOf("--") === 0){
        var val = styles.getPropertyValue(prop).trim();
        var hex = parseColorToHex(val);
        if (hex) out[prop] = hex;
      }
    }
    return out;
  }

  // ---------------------- Navigation detection ----------------------
  function cssPath(el){
    if (!el || el.nodeType !== 1) return "";
    var path = [];
    while (el && el.nodeType === 1 && el !== document){
      var part = el.nodeName.toLowerCase();
      if (el.id) {
        part += "#" + el.id.replace(/:/g, "\\:");
        path.unshift(part);
        break;
      } else {
        var sibling = el, nth = 1;
        while ((sibling = sibling.previousElementSibling)){
          if (sibling.nodeName.toLowerCase() === el.nodeName.toLowerCase()) nth++;
        }
        part += ":nth-of-type(" + nth + ")";
      }
      path.unshift(part);
      el = el.parentElement;
    }
    return path.join(" > ");
  }

  function isLikelyInternalLink(a){
    if (!a || !a.href) return false;
    try{
      var u = new URL(a.href, location.href);
      return u.host === location.host;
    } catch(e){ return false; }
  }

  function scoreNavCandidate(el){
    if (!el) return -1;
    var rect = el.getBoundingClientRect();
    var topPenalty = Math.max(0, rect.top);
    var links = toArray(el.querySelectorAll("a"));
    var internalLinks = links.filter(isLikelyInternalLink);
    var uniqueHrefs = {};
    for (var i=0;i<internalLinks.length;i++){
      var href = (internalLinks[i].href||"").split("#")[0];
      if (href) uniqueHrefs[href] = 1;
    }
    var hint = false;
    var cls = (el.className || "") + " " + (el.id || "");
    var lower = cls.toLowerCase();
    for (var j=0;j<NAV_HINTS.length;j++){
      if (lower.indexOf(NAV_HINTS[j]) !== -1) { hint = true; break; }
    }
    var linkCountScore = Math.min(Object.keys ? Object.keys(uniqueHrefs).length : (function(o){var c=0;for(var k in o){if(o.hasOwnProperty(k)) c++;}return c;})(uniqueHrefs), 20) * 10;
    var hintBonus = hint ? 50 : 0;
    var topBonus  = rect.top < 200 ? 30 : 0;
    var areaPenalty = Math.max(0, rect.height - 300) * 0.1;
    return linkCountScore + hintBonus + topBonus - areaPenalty - (topPenalty * 0.01);
  }

  function gatherNavCandidates(){
    var cands = [];
    toArray(document.querySelectorAll("nav, header, [role='navigation']")).forEach(function(el){ cands.push(el); });
    for (var i=0;i<NAV_HINTS.length;i++){
      var h = NAV_HINTS[i];
      toArray(document.querySelectorAll("[class*='" + h + "'], [id*='" + h + "']")).forEach(function(el){
        if (cands.indexOf(el) === -1) cands.push(el);
      });
    }
    if (cands.length === 0){
      var probe = document.elementFromPoint(window.innerWidth/2, 20) || document.body;
      var cur = probe, depth = 0;
      while (cur && depth < 8){
        if (cur.querySelector && cur.querySelectorAll("a").length >= 3) { cands.push(cur); break; }
        cur = cur.parentElement; depth++;
      }
    }
    var scored = cands.map(function(el){
      var r = el.getBoundingClientRect();
      return {
        element: el,
        selector: cssPath(el),
        score: scoreNavCandidate(el),
        rect: { top: r.top, left: r.left, width: r.width, height: r.height }
      };
    }).filter(function(c){ return c.score > 0; })
      .sort(function(a,b){ return b.score - a.score; });

    return scored;
  }

  // ---------------------- Inline-style snapshot (limited) ----------------------
  function inlineComputedStyles(root, cap){
    var count = 0;
    var clone = root.cloneNode(true);

    function apply(elSrc, elDst){
      if (count >= cap) return;
      count++;

      if (elSrc.nodeType === 1){
        var cs = getComputedStyle(elSrc);
        if (cs){
          // Choose a focused, theme-relevant subset
          var styles = [
            "color","background-color","font-family","font-size","font-weight","line-height","letter-spacing",
            "text-transform","text-decoration","border","border-color","border-style","border-width",
            "border-top","border-right","border-bottom","border-left",
            "padding","padding-top","padding-right","padding-bottom","padding-left",
            "margin","margin-top","margin-right","margin-bottom","margin-left",
            "display","position","top","left","right","bottom","z-index",
            "width","height","max-width","min-width","max-height","min-height",
            "box-shadow","border-radius","gap","column-gap","row-gap","justify-content","align-items","flex","flex-direction"
          ];
          var inline = [];
          for (var i=0;i<styles.length;i++){
            var prop = styles[i];
            var val = cs.getPropertyValue(prop);
            if (val && String(val).trim() !== "") {
              // normalize background-color to explicit value
              if (prop === "background-color" || prop === "color") {
                var hex = parseColorToHex(val);
                if (hex) val = hex;
              }
              inline.push(prop + ":" + val + ";");
            }
          }
          if (inline.length) elDst.setAttribute("style", inline.join(""));
        }
      }
      var srcKids = elSrc.childNodes, dstKids = elDst.childNodes;
      var len = Math.min(srcKids.length, dstKids.length);
      for (var j=0;j<len;j++){
        apply(srcKids[j], dstKids[j]);
        if (count >= cap) break;
      }
    }

    apply(root, clone);
    return clone.outerHTML || new XMLSerializer().serializeToString(clone);
  }

  // ---------------------- Nav summarizer ----------------------
  function summarizeNav(el){
    if (!el) return null;
    var cs = getComputedStyle(el);
    var fg = parseColorToHex(cs.color);
    var bg = parseColorToHex(cs.backgroundColor);
    var r  = el.getBoundingClientRect();
    var links = toArray(el.querySelectorAll("a")).slice(0, MAX_LINKS_IN_NAV).map(function(a){
      var href = a.getAttribute("href") || a.href || "";
      try { href = new URL(href, location.href).href; } catch(e){}
      return {
        text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200),
        href: href
      };
    });
    return {
      selector: cssPath(el),
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      display: cs.display,
      position: cs.position,
      color: fg,
      backgroundColor: bg,
      links: links,
      // packaged HTML snapshot with inline styles
      content: inlineComputedStyles(el, MAX_INLINE_NODES)
    };
  }

  // ---------------------- Largest content blocks ----------------------
  function isSkippable(el){
    if (!el || el.nodeType !== 1) return true;
    var n = el.nodeName.toLowerCase();
    if (n === "nav" || n === "header" || n === "footer") return true;
    var cs = getComputedStyle(el);
    if (!cs) return true;
    if (cs.visibility === "hidden" || cs.display === "none") return true;
    var r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 25) return true; // tiny
    return false;
  }

  function collectLargestContent(){
    var items = [];
    var scanned = 0;
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null, false);
    var node = walker.currentNode;
    while (node && scanned < MAX_SCAN_ELEMENTS){
      if (node.nodeType === 1 && !isSkippable(node)){
        var r = node.getBoundingClientRect();
        var area = Math.max(0, r.width) * Math.max(0, r.height);
        if (area > 0){
          var cs = getComputedStyle(node);
          items.push({
            selector: cssPath(node),
            rect: { top: r.top, left: r.left, width: r.width, height: r.height },
            area: area,
            display: cs.display,
            position: cs.position,
            color: parseColorToHex(cs.color),
            backgroundColor: parseColorToHex(cs.backgroundColor),
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            sampleText: (node.innerText || node.textContent || "").trim().replace(/\s+/g," ").slice(0,240)
          });
        }
        scanned++;
      }
      node = walker.nextNode();
    }
    items.sort(function(a,b){ return b.area - a.area; });
    return items.slice(0, LARGEST_COUNT);
  }

  // ---------------------- Compose result ----------------------
  function analyze(){
    var stylesBySelector = collectSelectorStyles();
    var fonts            = collectFonts();
    var dominantColors   = collectDominantColors();
    var rootCSSVars      = collectRootCSSVars();
    var navCandidates    = gatherNavCandidates();
    var detectedNav      = navCandidates.length ? navCandidates[0].element : null;
    var navSummary       = summarizeNav(detectedNav);
    var largestBlocks    = collectLargestContent();

    // keep original shape for backwards compat
    var navCandidatesLight = navCandidates.map(function(c){
      return { selector: c.selector, score: c.score, rect: c.rect };
    });

    return {
      title: document.title || "",
      url: location.href,
      stylesBySelector: stylesBySelector,
      fonts: fonts,
      dominantColors: dominantColors,
      rootThemeColors: rootCSSVars,
      navCandidates: navCandidatesLight,
      detectedNav: navSummary,     // now a rich object (was previously just the top candidate)
      largestBlocks: largestBlocks // new: top N largest content blocks
    };
  }

  if (typeof window !== "undefined") {
    window.__WebsitesAnalyze = analyze;
  }
  return analyze();
})();