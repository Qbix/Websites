(function (Q, $, window, undefined) {

/**
 * Preview for Websites/referral streams — tracked referral links.
 * Shows destination metadata (via scraped data), copy button, click count.
 * Composer: URL input + optional slug + traits.
 * @class Websites/referral/preview
 * @constructor
 */
Q.Tool.define("Websites/referral/preview", ["Streams/preview"],

function _Websites_referral_preview(options, preview) {
    var tool = this;
    tool.preview = preview;
    preview.state.onRefresh.add(tool.refresh.bind(tool), tool);
    preview.state.onComposer.add(tool.composer.bind(tool), tool);
},

{
    baseUrl: null, // override for branded URLs (e.g. brand.invites.to)
    onInvoke: new Q.Event(function () {
        var ps = this.preview.state;
        Q.Streams.get(ps.publisherId, ps.streamName, function () {
            var attrs = this.getAllAttributes();
            if (attrs.destination) {
                window.open(attrs.destination, '_blank');
            }
        });
    }),
    onRefresh: new Q.Event()
},

{
    refresh: function (stream, onLoad) {
        var tool = this;
        var ps = tool.preview.state;
        var attrs = stream.getAllAttributes();
        var scraped = attrs.scraped || {};
        var slug = attrs.slug || '';
        var editable = stream.testWriteLevel('suggest');
        var baseUrl = tool.state.baseUrl || Q.info.baseUrl;
        var referralUrl = baseUrl + '/' + slug;

        var container = document.createElement('div');
        container.className = 'Websites_rp_container'
            + (editable ? ' Websites_rp_edit' : ' Websites_rp_view');

        // Drag handle (edit mode)
        if (editable) {
            var drag = document.createElement('span');
            drag.className = 'Websites_rp_drag';
            drag.textContent = '⠿';
            container.appendChild(drag);
        }

        // Favicon
        var icon = scraped.iconSmall || scraped.iconBig || '';
        if (icon) {
            var img = document.createElement('img');
            img.className = 'Websites_rp_favicon';
            img.src = icon;
            img.alt = '';
            img.onerror = function () { this.style.display = 'none'; };
            container.appendChild(img);
        } else {
            var ph = document.createElement('div');
            ph.className = 'Websites_rp_favicon_ph';
            ph.textContent = '🔗';
            container.appendChild(ph);
        }

        // Body
        var body = document.createElement('div');
        body.className = 'Websites_rp_body';

        var title = document.createElement('span');
        title.className = 'Websites_rp_title';
        title.textContent = stream.fields.title || scraped.title || attrs.destination;
        body.appendChild(title);

        if (scraped.description) {
            var desc = document.createElement('span');
            desc.className = 'Websites_rp_desc';
            desc.textContent = scraped.description.substring(0, 80);
            body.appendChild(desc);
        }

        var dest = document.createElement('span');
        dest.className = 'Websites_rp_dest';
        dest.textContent = attrs.destination || stream.fields.content;
        body.appendChild(dest);

        container.appendChild(body);

        // Copy button
        var copyBtn = document.createElement('button');
        copyBtn.className = 'Websites_rp_copy';
        copyBtn.textContent = tool.text.referral && tool.text.referral.Copy || 'Copy';
        copyBtn.addEventListener(Q.Pointer.fastclick, function (e) {
            e.stopPropagation();
            Q.Links.copyToClipboard(referralUrl);
            copyBtn.textContent = tool.text.referral && tool.text.referral.Copied || 'Copied!';
            setTimeout(function () {
                copyBtn.textContent = tool.text.referral && tool.text.referral.Copy || 'Copy';
            }, 1500);
        });
        container.appendChild(copyBtn);

        Q.Tool.clear(tool.element);
        tool.element.innerHTML = '';
        tool.element.appendChild(container);
        Q.activate(tool.element, function () {
            Q.handle(tool.state.onRefresh, tool, [stream]);
            Q.handle(onLoad, tool);
        });
    },

    composer: function () {
        var tool = this;
        var ps = tool.preview.state;
        var text = tool.text.referral || {};

        ps.creatable.preprocess = function (proceed) {
            Q.Dialogs.push({
                title: text.Create || 'Create Referral Link',
                className: 'Websites_rp_composer_dialog',
                content: '<div class="Websites_rp_composer">'
                    + '<label>' + (text.Destination || 'Destination URL') + '</label>'
                    + '<input type="url" class="Websites_rp_dest_input" placeholder="https://..." />'
                    + '<label>' + (text.Slug || 'Custom slug (optional)') + '</label>'
                    + '<input type="text" class="Websites_rp_slug_input" placeholder="auto-generated" />'
                    + '<label>' + (text.Title || 'Title (optional)') + '</label>'
                    + '<input type="text" class="Websites_rp_title_input" placeholder="Auto-detected" />'
                    + '<button class="Q_button Websites_rp_submit">'
                    + (text.Create || 'Create') + '</button>'
                    + '</div>',
                onActivate: function (dialog) {
                    $(dialog).find('.Websites_rp_submit').on(Q.Pointer.fastclick, function () {
                        var dest = $(dialog).find('.Websites_rp_dest_input').val().trim();
                        if (!dest) return;
                        if (!/^https?:\/\//.test(dest)) dest = 'https://' + dest;
                        var slug = $(dialog).find('.Websites_rp_slug_input').val().trim();
                        var title = $(dialog).find('.Websites_rp_title_input').val().trim();
                        Q.Dialogs.pop();

                        // Use Websites_Referral::create via POST
                        Q.req('Websites/referral', ['result'], function (err, res) {
                            var msg = Q.firstErrorMessage(err, res && res.errors);
                            if (msg) return Q.alert(msg);
                            var result = res.slots.result;
                            proceed({
                                publisherId: result.publisherId,
                                streamName: result.streamName
                            });
                        }, {
                            method: 'POST',
                            fields: {
                                destination: dest,
                                slug: slug,
                                title: title
                            }
                        });
                    });
                }
            });
        };
        return false;
    }
});

})(Q, Q.jQuery, window);
