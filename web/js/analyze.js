/* eslint-disable no-undef */
/*
 * analyze.js (v3)
 *
 * Improvements over v2:
 *   - Color tallying weighted by visible text length, not raw element count
 *   - Foreground/background color tallies kept separate (don't filter near-white)
 *   - Body and heading fonts tracked separately, with weights
 *   - Explicit brand-color detection via saturation scoring
 *   - Link color detection
 *   - Fixes #abc shorthand color expansion bug
 *   - Direct-text filter on font/color tallies skips wrapper elements
 *
 * Preserves from v2:
 *   - stylesBySelector, dominantColors, rootThemeColors, fonts (legacy shape)
 *   - Nav candidate scoring with class/id hints
 *   - Inline-style HTML snapshot of detected nav
 *   - Largest content blocks scan with skip rules
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
  var MAX_SCAN_ELEMENTS = 2000;
  var MAX_INLINE_NODES  = 200;
  var MAX_LINKS_IN_NAV  = 200;
  var LARGEST_COUNT     = 3;
  var TEXT_WEIGHT_CAP   = 500;   // max chars to count per element

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
        // #abc → #aabbcc. v2 had a bug here using g*g (multiplication, NaN).
        var r = normalized[1], g = normalized[2], b = normalized[3];
        return ("#" + r+r + g+g + b+b).toLowerCase();
      }
      return normalized.toLowerCase();
    }
    var m = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/i);
    if (!m) return null;
    var a = m[4] == null ? 1 : parseFloat(m[4]);
    if (a < 0.1) return null;
    var R = clamp(parseInt(m[1],10), 0, 255);
    var G = clamp(parseInt(m[2],10), 0, 255);
    var B = clamp(parseInt(m[3],10), 0, 255);
    return rgbToHex(R,G,B);
  }

  function hexToHsl(hex){
    var m = hex && hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return null;
    var r = parseInt(m[1], 16) / 255;
    var g = parseInt(m[2], 16) / 255;
    var b = parseInt(m[3], 16) / 255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s, l: l };
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

  // Get direct text length (children that are text nodes), not innerText.
  // Used to weight elements by their actual contribution to visible text,
  // rather than counting wrapper divs equally with content paragraphs.
  function directTextLength(el){
    if (!el || el.nodeType !== 1) return 0;
    var total = 0;
    for (var i=0;i<el.childNodes.length;i++){
      var n = el.childNodes[i];
      if (n.nodeType === 3) {
        total += (n.textContent || "").trim().length;
        if (total >= TEXT_WEIGHT_CAP) return TEXT_WEIGHT_CAP;
      }
    }
    return total;
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

  // ---------------------- Color tallying (weighted) ----------------------
  // Walks the DOM once and tallies fg color (per element with direct text)
  // and bg color (per element with significant area), each weighted appropriately.
  // Returns separate foreground and background lists.
  function collectColorRoles(){
    var fgCounts = {};
    var bgCounts = {};
    var scanned = 0;
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null, false);
    var node = walker.currentNode;
    while (node && scanned < MAX_SCAN_ELEMENTS){
      if (node.nodeType === 1){
        var cs = getComputedStyle(node);
        if (cs){
          // Foreground: weight by direct text length
          var textLen = directTextLength(node);
          if (textLen > 0) {
            var fg = parseColorToHex(cs.color);
            if (fg) fgCounts[fg] = (fgCounts[fg] || 0) + textLen;
          }
          // Background: weight by visible area (only elements with non-transparent bg)
          var bg = parseColorToHex(cs.backgroundColor);
          if (bg) {
            var rect = node.getBoundingClientRect();
            var area = Math.max(0, rect.width) * Math.max(0, rect.height);
            if (area > 10000) {  // only count substantial surfaces
              bgCounts[bg] = (bgCounts[bg] || 0) + area;
            }
          }
        }
        scanned++;
      }
      node = walker.nextNode();
    }
    function toSorted(counts){
      var arr = [];
      for (var hex in counts){
        if (counts.hasOwnProperty(hex)) arr.push({ hex: hex, count: counts[hex] });
      }
      arr.sort(function(a,b){ return b.count - a.count; });
      return arr;
    }
    return {
      foreground: toSorted(fgCounts).slice(0, 16),
      background: toSorted(bgCounts).slice(0, 16)
    };
  }

  // Legacy dominantColors: union of fg and bg (sorted, deduped), excluding near-white.
  // Kept for backwards compat with v2 consumers that read `dominantColors`.
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

  function tallyColor(map, hex){ if (hex) map[hex] = (map[hex]||0)+1; }
  function isNearWhite(hex){
    if (!hex || hex[0] !== "#" || hex.length !== 7) return false;
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    return (r+g+b) > (255*3 - 45);
  }

  // ---------------------- Brand & link color detection ----------------------
  function findBrandColor(foregrounds, bodyColor){
    var best = null, bestScore = 0;
    for (var i = 0; i < foregrounds.length; i++) {
      var entry = foregrounds[i];
      if (entry.hex === bodyColor) continue;
      var hsl = hexToHsl(entry.hex);
      if (!hsl) continue;
      var lDistance = Math.min(hsl.l, 1 - hsl.l);
      var score = hsl.s * lDistance * Math.log(entry.count + 1);
      if (score > bestScore) { bestScore = score; best = entry.hex; }
    }
    return best;
  }

  function findLinkColor(){
    var links = document.querySelectorAll("a");
    var counts = {};
    for (var i = 0; i < links.length; i++) {
      var t = (links[i].textContent || "").trim();
      if (!t) continue;
      var color = window.getComputedStyle(links[i]).color;
      var hex = parseColorToHex(color);
      if (!hex) continue;
      counts[hex] = (counts[hex] || 0) + Math.min(t.length, TEXT_WEIGHT_CAP);
    }
    var best = null, bestCount = 0;
    for (var k in counts) {
      if (counts[k] > bestCount) { bestCount = counts[k]; best = k; }
    }
    return best;
  }

  // ---------------------- Font tallying (weighted, body vs heading) ----------------------
  function tallyFonts(selector){
    var counts = {};
    var weights = {};
    var nodes = document.querySelectorAll(selector);
    for (var i=0;i<nodes.length && i<MAX_SCAN_ELEMENTS;i++){
      var el = nodes[i];
      var textLen = directTextLength(el);
      if (textLen === 0) continue;
      var cs = getComputedStyle(el);
      if (!cs) continue;
      var family = cs.fontFamily;
      var weight = cs.fontWeight;
      if (family) counts[family] = (counts[family] || 0) + textLen;
      if (weight) weights[weight] = (weights[weight] || 0) + textLen;
    }
    function topOf(map){
      var arr = [];
      for (var k in map){
        if (map.hasOwnProperty(k)) arr.push({ value: k, count: map[k] });
      }
      arr.sort(function(a,b){ return b.count - a.count; });
      return arr;
    }
    var families = topOf(counts);
    var weightsArr = topOf(weights);
    return {
      top: families.length ? families[0].value : null,
      all: families,
      topWeight: weightsArr.length ? weightsArr[0].value : null,
      weights: weightsArr
    };
  }

  function collectFontsLegacy(){
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

  // ---------------------- Nav detection (unchanged from v2 with minor cleanup) ----------------------
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

  function objSize(o){
    if (Object.keys) return Object.keys(o).length;
    var c = 0; for (var k in o){ if (o.hasOwnProperty(k)) c++; } return c;
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
    var lower = (typeof cls === "string" ? cls : "").toLowerCase();
    for (var j=0;j<NAV_HINTS.length;j++){
      if (lower.indexOf(NAV_HINTS[j]) !== -1) { hint = true; break; }
    }
    var linkCountScore = Math.min(objSize(uniqueHrefs), 20) * 10;
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

  // ---------------------- Inline-style snapshot (unchanged) ----------------------
  function inlineComputedStyles(root, cap){
    var count = 0;
    var clone = root.cloneNode(true);

    function apply(elSrc, elDst){
      if (count >= cap) return;
      count++;

      if (elSrc.nodeType === 1){
        var cs = getComputedStyle(elSrc);
        if (cs){
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
      content: inlineComputedStyles(el, MAX_INLINE_NODES)
    };
  }

  // ---------------------- Largest content (unchanged) ----------------------
  function isSkippable(el){
    if (!el || el.nodeType !== 1) return true;
    var n = el.nodeName.toLowerCase();
    if (n === "nav" || n === "header" || n === "footer") return true;
    var cs = getComputedStyle(el);
    if (!cs) return true;
    if (cs.visibility === "hidden" || cs.display === "none") return true;
    var r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 25) return true;
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

    // v2 outputs (unchanged behavior)
    var fonts            = collectFontsLegacy();
    var dominantColors   = collectDominantColors();
    var rootCSSVars      = collectRootCSSVars();
    var navCandidates    = gatherNavCandidates();
    var detectedNav      = navCandidates.length ? navCandidates[0].element : null;
    var navSummary       = summarizeNav(detectedNav);
    var largestBlocks    = collectLargestContent();
    var navCandidatesLight = navCandidates.map(function(c){
      return { selector: c.selector, score: c.score, rect: c.rect };
    });

    // v3 additions
    var colorRoles      = collectColorRoles();
    var bodyFontInfo    = tallyFonts("p, li, td, span");
    var headingFontInfo = tallyFonts("h1, h2, h3, h4, h5, h6");
    var bodyForeground  = colorRoles.foreground.length ? colorRoles.foreground[0].hex : null;
    var bodyBackground  = colorRoles.background.length ? colorRoles.background[0].hex : null;
    var brandColor      = findBrandColor(colorRoles.foreground, bodyForeground);
    var linkColor       = findLinkColor();

    return {
      title: document.title || "",
      url: location.href,

      // v2 shape — identical behavior
      stylesBySelector: stylesBySelector,
      fonts: fonts,
      dominantColors: dominantColors,
      rootThemeColors: rootCSSVars,
      navCandidates: navCandidatesLight,
      detectedNav: navSummary,
      largestBlocks: largestBlocks,

      // v3 additions
      colorRoles: colorRoles,
      bodyForeground: bodyForeground,
      bodyBackground: bodyBackground,
      brandColor: brandColor,
      linkColor: linkColor,
      bodyFont: bodyFontInfo.top,
      headingFont: headingFontInfo.top,
      bodyFontWeight: bodyFontInfo.topWeight,
      headingFontWeight: headingFontInfo.topWeight,
      bodyFontsAll: bodyFontInfo.all,
      headingFontsAll: headingFontInfo.all
    };
  }

  if (typeof window !== "undefined") {
    window.__WebsitesAnalyze = analyze;
  }
  return analyze();
})();