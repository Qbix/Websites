(function (Q, $, window, undefined) {

/**
 * Full referral link management tool.
 * Shows click analytics, metadata editing, message history.
 * Use Streams/participants separately for access management.
 * @class Websites/referral
 * @constructor
 * @param {Object} options
 *   @param {String} options.publisherId
 *   @param {String} options.streamName
 *   @param {String} [options.baseUrl] Override for branded URLs
 */
Q.Tool.define("Websites/referral",

function _Websites_referral(options) {
    var tool = this;
    var state = tool.state;

    if (!state.publisherId || !state.streamName) {
        throw new Q.Error("Websites/referral: publisherId and streamName required");
    }

    Q.Streams.retainWith(tool).get(state.publisherId, state.streamName, function () {
        tool._stream = this;
        tool.refresh();

        // Live click updates
        this.onMessage('Websites/referral/clicked').set(function (stream, msg) {
            tool._addClickRow(msg);
            tool._updateStats();
        }, tool);
    });
},

{
    publisherId: null,
    streamName: null,
    baseUrl: null,
    maxClicks: 50,
    onRefresh: new Q.Event()
},

{
    refresh: function () {
        var tool = this;
        var state = tool.state;
        var stream = tool._stream;
        if (!stream) return;

        var attrs = stream.getAllAttributes();
        var scraped = attrs.scraped || {};
        var slug = attrs.slug || '';
        var baseUrl = state.baseUrl || Q.info.baseUrl;
        var referralUrl = baseUrl + '/' + slug;
        var editable = stream.testWriteLevel('edit');
        var canSeeMessages = stream.testReadLevel('messages');
        var text = tool.text.referral || {};

        var html = '<div class="Websites_ref_tool">';

        // ── Header with URL + copy ──
        html += '<div class="Websites_ref_header">'
            + '<div class="Websites_ref_url_row">'
            + '<span class="Websites_ref_url">' + Q.htmlEntities(referralUrl) + '</span>'
            + '<button class="Websites_ref_copy">' + (text.Copy || 'Copy') + '</button>'
            + '</div>'
            + '<div class="Websites_ref_dest">'
            + '→ ' + Q.htmlEntities(attrs.destination || stream.fields.content)
            + '</div>'
            + '</div>';

        // ── Stats row ──
        html += '<div class="Websites_ref_stats" id="' + tool.prefix + 'stats">'
            + '</div>';

        // ── Metadata (editable if writeLevel >= edit) ──
        if (editable) {
            html += '<details class="Websites_ref_panel">'
                + '<summary>' + (text.Metadata || 'Sharing Metadata') + '</summary>'
                + '<div class="Websites_ref_panel_inner">'
                + '<div class="Websites_ref_meta_fields"></div>'
                + '</div></details>';
        }

        // ── Click log (if readLevel >= messages) ──
        if (canSeeMessages) {
            html += '<div class="Websites_ref_clicks">'
                + '<h3 class="Websites_ref_section_title">'
                + (text.RecentClicks || 'Recent Clicks') + '</h3>'
                + '<div class="Websites_ref_click_grid" id="' + tool.prefix + 'clicks">'
                + '<div class="Websites_ref_click_header">'
                + '<span>' + (text.Time || 'Time') + '</span>'
                + '<span>' + (text.Platform || 'Platform') + '</span>'
                + '<span>' + (text.Device || 'Device') + '</span>'
                + '</div>'
                + '</div>'
                + '</div>';
        }

        html += '</div>';

        tool.element.innerHTML = html;

        // Wire copy button
        tool.$('.Websites_ref_copy').on(Q.Pointer.fastclick, function () {
            Q.Links.copyToClipboard(referralUrl);
            this.textContent = text.Copied || 'Copied!';
            var btn = this;
            setTimeout(function () { btn.textContent = text.Copy || 'Copy'; }, 1500);
        });

        // Load stats
        tool._updateStats();

        // Load metadata editor
        if (editable) {
            tool._renderMetaEditor(stream, attrs, scraped);
        }

        // Load click history from messages
        if (canSeeMessages) {
            tool._loadClicks();
        }

        Q.handle(state.onRefresh, tool, [stream]);
    },

    _updateStats: function () {
        var tool = this;
        var stream = tool._stream;
        if (!stream) return;
        var text = tool.text.referral || {};

        var clickCount = stream.fields.messageCount || 0;
        var attrs = stream.getAllAttributes();
        var trackerId = attrs.trackerId || '';

        var statsElement = tool.element.querySelector('[id$="stats"]');
        if (!statsElement) return;

        statsElement.innerHTML =
            '<div class="Websites_ref_stat">'
            + '<span class="Websites_ref_stat_num">' + clickCount + '</span>'
            + '<span class="Websites_ref_stat_label">' + (text.Clicks || 'Clicks') + '</span>'
            + '</div>'
            + '<div class="Websites_ref_stat">'
            + '<span class="Websites_ref_stat_num">' + (attrs.slug || '—') + '</span>'
            + '<span class="Websites_ref_stat_label">' + (text.Slug || 'Slug') + '</span>'
            + '</div>'
            + '<div class="Websites_ref_stat">'
            + '<span class="Websites_ref_stat_num">'
            + (attrs.inviterId || '—') + '</span>'
            + '<span class="Websites_ref_stat_label">' + (text.Inviter || 'Inviter') + '</span>'
            + '</div>';
    },

    _renderMetaEditor: function (stream, attrs, scraped) {
        var tool = this;
        var container = tool.element.querySelector('.Websites_ref_meta_fields');
        if (!container) return;

        var fields = [
            { key: 'title', label: 'Title (OG + Twitter)', placeholder: scraped.title || 'From destination' },
            { key: 'description', label: 'Description (OG + Twitter)', placeholder: scraped.description || 'From destination' },
            { key: 'image', label: 'Image URL (OG + Twitter)', placeholder: scraped.image || 'From destination' },
            { key: 'twitter:card', label: 'Twitter Card Type', placeholder: 'summary_large_image',
              options: ['summary_large_image', 'summary', 'player'] },
            { key: 'keywords', label: 'Keywords', placeholder: 'keyword1, keyword2' }
        ];

        var meta = attrs.meta || {};

        fields.forEach(function (f) {
            var row = document.createElement('div');
            row.className = 'Websites_ref_meta_row';
            var inputHtml;
            if (f.options) {
                inputHtml = '<select data-key="' + f.key + '">'
                    + '<option value="">' + Q.htmlEntities(f.placeholder) + '</option>';
                f.options.forEach(function (opt) {
                    var sel = (meta[f.key] === opt) ? ' selected' : '';
                    inputHtml += '<option value="' + opt + '"' + sel + '>' + opt + '</option>';
                });
                inputHtml += '</select>';
            } else {
                inputHtml = '<input type="text" data-key="' + f.key + '" '
                    + 'value="' + Q.htmlEntities(meta[f.key] || '') + '" '
                    + 'placeholder="' + Q.htmlEntities(f.placeholder) + '" />';
            }
            row.innerHTML = '<label>' + f.label + '</label>' + inputHtml;
            container.appendChild(row);
        });

        // Save on blur/change
        $(container).on('change', 'input, select', function () {
            var key = this.getAttribute('data-key');
            var val = this.value.trim();
            var currentMeta = stream.getAttribute('meta') || {};
            if (val) {
                currentMeta[key] = val;
            } else {
                delete currentMeta[key];
            }
            stream.setAttribute('meta', currentMeta);
            stream.save();
        });
    },

    _loadClicks: function () {
        var tool = this;
        var state = tool.state;

        Q.Streams.Message.get(state.publisherId, state.streamName, {
            type: 'Websites/referral/clicked',
            limit: state.maxClicks,
            ascending: false
        }, function (err, messages) {
            if (err) return;
            Q.each(messages, function (ordinal, msg) {
                tool._addClickRow(msg);
            });
        });
    },

    _addClickRow: function (msg) {
        var tool = this;
        var grid = tool.element.querySelector('[id$="clicks"]');
        if (!grid) return;

        var inst = {};
        try { inst = JSON.parse(msg.instructions || '{}'); } catch (e) {}

        var time = msg.sentTime || msg.insertedTime || '';
        var timeStr = time ? new Date(time.replace(' ', 'T') + 'Z').toLocaleString() : '—';

        var row = document.createElement('div');
        row.className = 'Websites_ref_click_row';
        row.innerHTML =
            '<span class="Websites_ref_click_time">' + timeStr + '</span>'
            + '<span class="Websites_ref_click_platform">' + Q.htmlEntities(inst.platform || '—') + '</span>'
            + '<span class="Websites_ref_click_device">' + Q.htmlEntities(inst.formFactor || '—') + '</span>';

        // Insert after header
        var header = grid.querySelector('.Websites_ref_click_header');
        if (header && header.nextSibling) {
            grid.insertBefore(row, header.nextSibling);
        } else {
            grid.appendChild(row);
        }
    },

    Q: {
        beforeRemove: function () {
            this._stream = null;
        }
    }
});

})(Q, Q.jQuery, window);
