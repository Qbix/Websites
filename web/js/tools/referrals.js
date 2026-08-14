(function (Q, $, window, undefined) {

/**
 * Management tool for a collection of referral links.
 * Shows related Websites/referral streams with previews.
 * Clicking a preview opens the full Websites/referral tool
 * via Q.invoke() (column or dialog).
 * Admins can create new referrals inline.
 * @class Websites/referrals
 * @constructor
 * @param {Object} options
 *   @param {String} options.publisherId Publisher of the category stream
 *   @param {String} options.streamName The category stream that referrals relate to
 *   @param {String} [options.relationType="Websites/referral"] Relation type
 *   @param {String} [options.baseUrl] Override for branded URLs
 *   @param {Boolean} [options.creatable=true] Show create button for admins
 *   @param {Boolean} [options.sortable=true] Allow drag reordering
 *   @param {Q.Event} [options.onInvoke] Override what happens when a referral is clicked
 */
Q.Tool.define("Websites/referrals",

function _Websites_referrals(options) {
    var tool = this;
    var state = tool.state;

    if (!state.publisherId || !state.streamName) {
        throw new Q.Error("Websites/referrals: publisherId and streamName required");
    }

    Q.Streams.retainWith(tool).get(state.publisherId, state.streamName, function () {
        tool._categoryStream = this;
        tool.refresh();
    });
},

{
    publisherId: null,
    streamName: null,
    relationType: 'Websites/referral',
    baseUrl: null,
    creatable: true,
    sortable: true,
    maxShow: 50,
    onInvoke: new Q.Event(function (publisherId, streamName, element) {
        // Default: open the full Websites/referral tool via Q.invoke
        var tool = this;
        Q.Streams.get(publisherId, streamName, function () {
            var stream = this;
            Q.invoke({
                title: stream.fields.title || 'Referral Link',
                trigger: element,
                className: 'Websites_referral_column',
                template: {
                    name: 'Websites/referrals/invoke',
                    fields: {
                        publisherId: publisherId,
                        streamName: streamName,
                        baseUrl: tool.state.baseUrl || ''
                    }
                },
                onActivate: function (dialog) {
                    // Activate the Websites/referral tool inside
                    var container = dialog.querySelector
                        ? dialog.querySelector('.Websites_referral_invoke')
                        : $(dialog).find('.Websites_referral_invoke')[0];
                    if (container) {
                        $(container).tool('Websites/referral', {
                            publisherId: publisherId,
                            streamName: streamName,
                            baseUrl: tool.state.baseUrl || null
                        }).activate();
                    }
                }
            });
        });
    }),
    onRefresh: new Q.Event()
},

{
    refresh: function () {
        var tool = this;
        var state = tool.state;
        var stream = tool._categoryStream;
        if (!stream) return;

        var editable = stream.testWriteLevel('relate');
        var text = Q.getObject('Websites.content.referral', Q.text) || {};

        // Build header with title + create button
        var header = document.createElement('div');
        header.className = 'Websites_referrals_header';

        var title = document.createElement('h3');
        title.className = 'Websites_referrals_title';
        title.textContent = text.ManageLinks || 'Referral Links';
        header.appendChild(title);

        tool.element.innerHTML = '';
        tool.element.appendChild(header);

        // Render Streams/related with referral previews
        var relatedElement = Q.Tool.setUpElement('div', 'Streams/related', {
            publisherId: state.publisherId,
            streamName: state.streamName,
            relationType: state.relationType,
            isCategory: true,
            editable: editable,
            closeable: editable,
            sortable: editable && state.sortable,
            realtime: true,
            limit: state.maxShow,
            creatable: (editable && state.creatable) ? {
                'Websites/referral': {
                    title: text.Create || 'Create Referral Link'
                }
            } : false
        }, null, tool.prefix);
        relatedElement.classList.add('Websites_referrals_list');
        tool.element.appendChild(relatedElement);

        Q.activate(tool.element, function () {
            // Wire up onInvoke for each referral preview
            tool._bindPreviews();
            Q.handle(state.onRefresh, tool, [stream]);
        });
    },

    _bindPreviews: function () {
        var tool = this;
        var state = tool.state;

        // Listen for new preview tools being activated
        var relatedTool = tool.child('Streams_related');
        if (!relatedTool) return;

        // Bind invoke on each preview
        var _bindPreview = function (previewTool) {
            if (!previewTool || previewTool._referralsInvokeBound) return;
            previewTool._referralsInvokeBound = true;

            var ps = previewTool.state;
            // Override the preview's onInvoke to use our handler
            previewTool.state.onInvoke.set(function () {
                Q.handle(state.onInvoke, tool, [
                    ps.publisherId,
                    ps.streamName,
                    previewTool.element
                ]);
            }, tool);
        };

        // Bind existing previews
        Q.each(relatedTool.children('Streams_preview'), function (id, preview) {
            _bindPreview(preview);
        });

        // Bind future previews as they're added
        relatedTool.state.onUpdate.set(function () {
            Q.each(relatedTool.children('Streams_preview'), function (id, preview) {
                _bindPreview(preview);
            });
        }, tool);
    },

    Q: {
        beforeRemove: function () {
            this._categoryStream = null;
        }
    }
});

// Template for the invoked referral detail view
Q.Template.set('Websites/referrals/invoke',
    '<div class="Websites_referral_invoke"'
    + ' data-publisherid="{{publisherId}}"'
    + ' data-streamname="{{streamName}}"'
    + ' data-baseurl="{{baseUrl}}">'
    + '</div>'
);

})(Q, Q.jQuery, window);
