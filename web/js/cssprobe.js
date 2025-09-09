(function(){
    function uniq(a){var s={},o=[],i;for(i=0;i<a.length;i++){if(!s[a[i]]){s[a[i]]=1;o.push(a[i]);}}return o;}
    var hrefs=[],i,s=document.styleSheets;
    for(i=0;i<s.length;i++){
        try{
            if(s[i].href) hrefs.push(s[i].href);
            else if(s[i].ownerNode&&s[i].ownerNode.href) hrefs.push(s[i].ownerNode.href);
        }catch(e){}
    }
    var ls=document.querySelectorAll('link[rel~="stylesheet"][href]');
    for(i=0;i<ls.length;i++){
        var h=ls[i].href||ls[i].getAttribute('href');
        if(h) hrefs.push(h);
    }

    // foreground/background tallies (hex only)
    function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
    function rgb2hex(r,g,b){
        function h(n){n=n.toString(16);return n.length===1?'0'+n:n;}
        return '#'+h(r)+h(g)+h(b);
    }
    function toHex(c){
        if(!c||c==='transparent'||c==='inherit')return null;
        var d=document.createElement('canvas');d.width=1;d.height=1;
        var x=d.getContext('2d');
        x.fillStyle='#000';
        x.fillStyle=c;
        var n=x.fillStyle;
        if(!n||typeof n!=='string')return null;
        if(n.charAt(0)==='#'){
            if(n.length===4){
                return ('#'+n[1]+n[1]+n[2]+n[2]+n[3]+n[3]).toLowerCase();
            }
            return n.toLowerCase();
        }
        var m=n.match(/^rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*(\\d*\\.?\\d+))?\\)$/i);
        if(!m) return null;
        var a=(m[4]==null)?1:parseFloat(m[4]); if(a===0) return null;
        var r=clamp(parseInt(m[1],10),0,255),
            g=clamp(parseInt(m[2],10),0,255),
            b=clamp(parseInt(m[3],10),0,255);
        return rgb2hex(r,g,b).toLowerCase();
    }

    var MAX=2000,fg={},bg={},scanned=0,
        w=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_ELEMENT,null,false),
        n=w.currentNode;
    while(n&&scanned<MAX){
        if(n.nodeType===1){
            var cs=getComputedStyle(n);
            if(cs){
                var c=toHex(cs.color);
                var b=toHex(cs.backgroundColor);
                if(c){fg[c]=(fg[c]||0)+1;}
                if(b){bg[b]=(bg[b]||0)+1;}
            }
            scanned++;
        }
        n=w.nextNode();
    }

    function topK(map,k){
        var a=[],x;
        for(x in map){if(map.hasOwnProperty(x)){a.push({hex:x,count:map[x]});}}
        a.sort(function(A,B){return B.count-A.count;});
        return a.slice(0,k);
    }

    return {css: uniq(hrefs), colors:{foreground: topK(fg,16), background: topK(bg,16)}};
})();