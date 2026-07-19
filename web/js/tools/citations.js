(function (Q, $, window, undefined) {

/**
 * @module Websites
 */

/**
 * Renders a row of citation badges with an optional hover/tap popup
 * showing the cited quote, favicon, domain, and a Websites/webpage/preview.
 *
 * Designed to drop in under any AI-generated card or article that has
 * citations attached. Handles both desktop (hover) and touchscreen (tap-toggle).
 *
 * @class Websites/citations
 * @constructor
 * @param {Object} [options]
 *   @param {Array}    [options.citations=[]] [{url, title, quote, domain, favicon}]
 *   @param {Boolean}  [options.icons=true]
 *   @param {Boolean}  [options.domains=true]
 *   @param {Boolean}  [options.titles=false]
 *   @param {Boolean}  [options.hover=true]   true: hover/tap popup. false: inline expanded blocks.
 *   @param {Number}   [options.max=5]
 *   @param {Q.Event}  [options.onInvoke]
 */
Q.Tool.define("Websites/citations", function () {
    var tool = this;

    // Load CSS once
    Q.addStylesheet('{{Websites}}/css/tools/citations.css',
        { slotName: 'Websites' });

    tool.refresh();
},

{
    citations: [],
    icons:   true,
    domains: true,
    titles:  false,
    hover:   true,
    max:     5,
    onInvoke: new Q.Event()
},

{
    refresh: function () {
        var tool  = this;
        var state = tool.state;
        var $el   = $(tool.element);
        $el.empty();

        var citations = (state.citations || []).filter(function (s) {
            return s && s.url;
        });
        if (!citations.length) { $el.hide(); return; }
        $el.show();
        $el.addClass('Websites_citations');

        var $label = $('<div class="Websites_citations_label">Sources</div>');
        $el.append($label);

        var $list = $('<div class="Websites_citations_list"></div>');
        $el.append($list);

        var shown  = citations.slice(0, state.max);
        var hidden = citations.length - shown.length;

        shown.forEach(function (src, i) {
            $list.append(tool._buildItem(src, i));
        });

        if (hidden > 0) {
            $list.append(
                '<span class="Websites_citations_more">+'
                + hidden + ' more</span>'
            );
        }

        if (!state.hover) {
            // Always-on inline mode — render expanded blocks below the badges
            var $alwaysOn = $('<div class="Websites_citations_alwayson"></div>');
            $el.append($alwaysOn);
            shown.forEach(function (src) {
                $alwaysOn.append(tool._buildAlwaysOn(src));
            });
        }
    },

    _buildItem: function (src, i) {
        var tool  = this;
        var state = tool.state;
        var isTouch = Q.info && Q.info.isTouchscreen;

        var $item = $('<a class="Websites_citations_item" target="_blank" rel="noopener noreferrer"></a>');
        $item.attr('href', src.url);
        $item.attr('data-domain', src.domain || '');
        $item.attr('data-index',  i + 1);

        // Numbered prefix — always shown (good for screen readers, references)
        $item.append('<span class="Websites_citations_num">' + (i + 1) + '</span>');

        if (state.icons && src.favicon) {
            var $icon = $('<img class="Websites_citations_icon" alt="" />');
            $icon.attr('src', src.favicon);
            $icon.on('error', function () { $(this).hide(); });
            $item.append($icon);
        }

        if (state.domains && src.domain) {
            $item.append(
                '<span class="Websites_citations_domain">'
                + Q.Html.text(src.domain) + '</span>'
            );
        }

        if (state.titles && src.title) {
            $item.append(
                '<span class="Websites_citations_title">'
                + Q.Html.text(src.title) + '</span>'
            );
        }

        if (state.hover) {
            tool._attachPopup($item, src, isTouch);
        }

        return $item;
    },

    _attachPopup: function ($item, src, isTouch) {
        var tool   = this;
        var $popup = null;
        var docId  = 'Websites_citations_' + Math.random().toString(36).slice(2, 10);

        function show() {
            if ($popup) return;
            $popup = tool._buildPopup(src);
            $('body').append($popup);
            tool._positionPopup($popup, $item);
            Q.handle(tool.state.onInvoke, tool, [src]);
        }
        function hide() {
            if (!$popup) return;
            $popup.remove();
            $popup = null;
            $(document).off('click.' + docId);
        }

        if (isTouch) {
            // Tap-to-toggle on touch devices. The first tap opens the popup
            // and prevents navigation; tapping the link inside the popup
            // (or the "↗" button) opens the URL.
            $item.on('click', function (e) {
                if ($popup) { hide(); return; }
                e.preventDefault();
                e.stopPropagation();
                show();
                // Tap-outside-to-close
                setTimeout(function () {
                    $(document).on('click.' + docId, function (e2) {
                        if (!$popup) return;
                        if (
                            $.contains($popup[0], e2.target) ||
                            $.contains($item[0], e2.target)
                        ) return;
                        hide();
                    });
                }, 0);
            });
        } else {
            // Desktop: hover open with grace period so user can move into popup
            $item.on('mouseenter', show);
            $item.on('mouseleave', function () {
                setTimeout(function () {
                    if (!$popup) return;
                    if ($popup.is(':hover')) {
                        $popup.one('mouseleave', hide);
                    } else {
                        hide();
                    }
                }, 120);
            });
        }
    },

    _buildPopup: function (src) {
        var $popup = $('<div class="Websites_citations_popup"></div>');

        // Header — favicon + domain + open-link
        var $head = $('<div class="Websites_citations_popup_head"></div>');
        if (src.favicon) {
            $head.append(
                '<img class="Websites_citations_popup_favicon" src="'
                + Q.Html.text(src.favicon) + '" alt="" />'
            );
        }
        $head.append(
            '<span class="Websites_citations_popup_domain">'
            + Q.Html.text(src.domain || '') + '</span>'
        );
        $head.append(
            '<a class="Websites_citations_popup_link" href="'
            + Q.Html.text(src.url)
            + '" target="_blank" rel="noopener noreferrer">↗</a>'
        );
        $popup.append($head);

        if (src.title) {
            $popup.append(
                '<div class="Websites_citations_popup_title">'
                + Q.Html.text(src.title) + '</div>'
            );
        }

        if (src.quote) {
            $popup.append(
                '<div class="Websites_citations_popup_quote">"'
                + Q.Html.text(src.quote) + '"</div>'
            );
        }

        // Lazy-load Websites/webpage/preview for richer metadata
        // (favicon variants, OG image, description, etc.)
        if (Q.Tool.constructors['Websites/webpage/preview']) {
            var $preview = $('<div class="Websites_citations_popup_preview"></div>');
            $popup.append($preview);
            $preview.tool('Websites/webpage/preview', {
                url: src.url,
                mode: 'title',
                showDomainOnly: true,
                streamRequired: false
            }).activate();
        }

        return $popup;
    },

    _buildAlwaysOn: function (src) {
        var $b = $('<div class="Websites_citations_alwayson_item"></div>');
        if (src.favicon) {
            $b.append(
                '<img class="Websites_citations_alwayson_icon" src="'
                + Q.Html.text(src.favicon) + '" alt="" />'
            );
        }
        var $meta = $('<div class="Websites_citations_alwayson_meta"></div>');
        if (src.domain) $meta.append(
            '<div class="Websites_citations_alwayson_domain">'
            + Q.Html.text(src.domain) + '</div>'
        );
        if (src.title) $meta.append(
            '<div class="Websites_citations_alwayson_title">'
            + Q.Html.text(src.title) + '</div>'
        );
        if (src.quote) $meta.append(
            '<div class="Websites_citations_alwayson_quote">"'
            + Q.Html.text(src.quote) + '"</div>'
        );
        $meta.append(
            '<a class="Websites_citations_alwayson_link" href="'
            + Q.Html.text(src.url)
            + '" target="_blank" rel="noopener noreferrer">Open source →</a>'
        );
        $b.append($meta);
        return $b;
    },

    _positionPopup: function ($popup, $anchor) {
        var aRect = $anchor[0].getBoundingClientRect();
        var pW    = $popup.outerWidth();
        var pH    = $popup.outerHeight();
        var vw    = window.innerWidth;
        var vh    = window.innerHeight;

        // Default: appear above the anchor
        var top  = aRect.top  + window.scrollY - pH - 10;
        var left = aRect.left + window.scrollX;

        // Flip below if no room above
        if (aRect.top < pH + 16) {
            top = aRect.bottom + window.scrollY + 10;
        }
        // Clamp horizontally
        if (left + pW > vw - 12) {
            left = Math.max(12, vw - pW - 12);
        }
        if (left < 12) left = 12;

        $popup.css({ top: top + 'px', left: left + 'px' });
    },

    Q: {
        beforeRemove: function () {
            $('.Websites_citations_popup').remove();
        }
    }
});

})(Q, Q.jQuery, window);
