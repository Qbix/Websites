(function (Q, $, window, undefined) {

/**
 * Preview for Websites/page streams — authored pages.
 * When appearing in a list (e.g. related to a brand), shows
 * title, description snippet, and icon.
 * onInvoke navigates to the page or opens it in a column.
 * @class Websites/page/preview
 * @constructor
 */
Q.Tool.define("Websites/page/preview", ["Streams/preview"],

function _Websites_page_preview(options, preview) {
    var tool = this;
    tool.preview = preview;
    preview.state.onRefresh.add(tool.refresh.bind(tool), tool);
    preview.state.imagepicker = Q.extend({}, preview.state.imagepicker, {
        showSize: '80',
        fullSize: '400x'
    });
},

{
    inplace: {},
    templates: {
        view: {
            name: 'Websites/page/preview/view',
            fields: {}
        },
        edit: {
            name: 'Websites/page/preview/edit',
            fields: {}
        }
    },
    onInvoke: new Q.Event(function () {
        var ps = this.preview.state;
        if (!ps.publisherId || !ps.streamName) return;
        Q.Streams.get(ps.publisherId, ps.streamName, function () {
            var url = this.url && this.url();
            if (url) {
                Q.handle(url);
            } else {
                Q.invoke({
                    title: this.fields.title,
                    trigger: this.element,
                    url: Q.url('Websites/page', {
                        publisherId: ps.publisherId,
                        streamName: ps.streamName
                    })
                });
            }
        });
    }),
    onRefresh: new Q.Event()
},

{
    refresh: function (stream, onLoad) {
        var tool = this;
        var state = tool.state;
        var ps = tool.preview.state;
        var editable = stream.testWriteLevel('suggest');
        var mode = editable ? 'edit' : 'view';

        var p = Q.pipe(['inplace', 'icon'], function () {
            Q.handle(onLoad, tool);
        });

        var inplace = null;
        if (editable && state.inplace) {
            inplace = tool.setUpElementHTML('div', 'Streams/inplace', Q.extend({
                publisherId: ps.publisherId,
                streamName: ps.streamName,
                field: 'title',
                inplaceType: 'text',
                editable: true
            }, state.inplace));
        }

        var fields = Q.extend({}, state.templates[mode].fields, {
            title: stream.fields.title,
            description: (stream.fields.content || '').substring(0, 120),
            inplace: inplace
        });

        Q.Template.render(
            state.templates[mode].name,
            fields,
            function (err, html) {
                if (err) return;
                Q.replace(tool.element, html);
                Q.activate(tool, function () {
                    var jq = tool.$('img.Websites_page_preview_icon');
                    if (jq.length) {
                        tool.preview.icon(jq[0], p.fill('icon'));
                    } else {
                        p.fill('icon')();
                    }
                    var inplaceTool = tool.child('Streams_inplace');
                    if (inplaceTool) {
                        inplaceTool.state.onLoad.add(p.fill('inplace'));
                    } else {
                        p.fill('inplace')();
                    }
                    Q.handle(state.onRefresh, tool, [stream]);
                });
            },
            state.templates[mode]
        );
    }
});

Q.Template.set('Websites/page/preview/view',
    '<div class="Websites_page_preview_container Websites_page_preview_view Q_clearfix">'
    + '<img alt="" class="Websites_page_preview_icon Q_square" src="">'
    + '<div class="Websites_page_preview_contents">'
    + '<h3 class="Websites_page_preview_title">{{title}}</h3>'
    + '{{#if description}}<p class="Websites_page_preview_desc">{{description}}</p>{{/if}}'
    + '</div></div>'
);

Q.Template.set('Websites/page/preview/edit',
    '<div class="Websites_page_preview_container Websites_page_preview_edit Q_clearfix">'
    + '<img alt="" class="Websites_page_preview_icon Q_square" src="">'
    + '<div class="Websites_page_preview_contents">'
    + '<h3 class="Websites_page_preview_title">{{{inplace}}}</h3>'
    + '{{#if description}}<p class="Websites_page_preview_desc">{{description}}</p>{{/if}}'
    + '</div></div>'
);

})(Q, Q.jQuery, window);